/**
 * MetaMask wallet.
 *
 * Two jobs:
 *   • contractors connect a wallet so they have a payout address;
 *   • admins sign the escrow transactions the server prepares.
 *
 * The second is the important one. The server holds no private key, so every
 * movement of public money is signed here, in the official's own browser, with
 * their own key. `sendPrepared` is the single function that does it.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { SEPOLIA_CHAIN_ID } from '../lib/constants.js';

const WalletContext = createContext(null);

const STORAGE_KEY = 'openinfra-wallet-connected';

/** Sepolia, for the "switch network" prompt when MetaMask has never seen it. */
const SEPOLIA_PARAMS = {
  chainId: SEPOLIA_CHAIN_ID,
  chainName: 'Sepolia test network',
  nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: ['https://rpc.sepolia.org'],
  blockExplorerUrls: ['https://sepolia.etherscan.io'],
};

export const hasMetaMask = () =>
  typeof window !== 'undefined' && Boolean(window.ethereum);

/**
 * Turn a wallet error into something worth showing a user.
 *
 * MetaMask's codes matter here: 4001 is the user clicking Reject, which is a
 * deliberate choice and not an error to apologise for.
 */
const walletError = (err) => {
  const code = err?.code ?? err?.cause?.code;
  if (code === 4001 || /user rejected|user denied/i.test(err?.message ?? '')) {
    return { cancelled: true, message: 'You cancelled the request in your wallet.' };
  }
  if (code === -32002) {
    return { message: 'MetaMask is already asking for something — open the extension to respond.' };
  }
  if (code === -32603) {
    return { message: err?.data?.message ?? 'The transaction was rejected by the network.' };
  }
  if (code === 4902) {
    return { message: 'Sepolia is not available in this wallet.' };
  }
  return { message: err?.data?.message ?? err?.message ?? 'The wallet request failed.' };
};

export const WalletProvider = ({ children }) => {
  const [address, setAddress] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState(null);

  const available = hasMetaMask();
  const onSepolia = chainId?.toLowerCase() === SEPOLIA_CHAIN_ID.toLowerCase();

  /** Read the current account without prompting — for silent reconnection. */
  const readAccounts = useCallback(async () => {
    if (!hasMetaMask()) return null;
    const accounts = await window.ethereum.request({ method: 'eth_accounts' });
    return accounts?.[0] ?? null;
  }, []);

  const readChain = useCallback(async () => {
    if (!hasMetaMask()) return null;
    return window.ethereum.request({ method: 'eth_chainId' });
  }, []);

  // Reconnect silently on load, but only if the user connected before — so a
  // first-time visitor is never shown a wallet prompt they did not ask for.
  useEffect(() => {
    if (!available) return;
    let cancelled = false;

    (async () => {
      try {
        const previouslyConnected = localStorage.getItem(STORAGE_KEY) === 'true';
        if (!previouslyConnected) return;
        const [account, chain] = await Promise.all([readAccounts(), readChain()]);
        if (cancelled) return;
        if (account) {
          setAddress(account.toLowerCase());
          setChainId(chain);
        }
      } catch {
        /* a failed silent reconnect is not worth surfacing */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [available, readAccounts, readChain]);

  // Keep in step when the user switches account or network in MetaMask.
  useEffect(() => {
    if (!available) return undefined;

    const onAccountsChanged = (accounts) => {
      const next = accounts?.[0] ?? null;
      setAddress(next ? next.toLowerCase() : null);
      if (!next) {
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {
          /* ignore */
        }
      }
    };
    const onChainChanged = (id) => setChainId(id);

    window.ethereum.on('accountsChanged', onAccountsChanged);
    window.ethereum.on('chainChanged', onChainChanged);
    return () => {
      window.ethereum.removeListener?.('accountsChanged', onAccountsChanged);
      window.ethereum.removeListener?.('chainChanged', onChainChanged);
    };
  }, [available]);

  const connect = useCallback(async () => {
    setError(null);
    if (!hasMetaMask()) {
      const message = 'MetaMask was not detected. Install it to connect a wallet.';
      setError(message);
      throw new Error(message);
    }

    setConnecting(true);
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      const account = accounts?.[0];
      if (!account) throw new Error('No account was returned by the wallet.');

      const chain = await readChain();
      setAddress(account.toLowerCase());
      setChainId(chain);
      try {
        localStorage.setItem(STORAGE_KEY, 'true');
      } catch {
        /* ignore */
      }
      return account.toLowerCase();
    } catch (err) {
      const { message } = walletError(err);
      setError(message);
      throw new Error(message);
    } finally {
      setConnecting(false);
    }
  }, [readChain]);

  const disconnect = useCallback(() => {
    // MetaMask has no programmatic disconnect; this forgets the connection on
    // our side, which is what the user means by "disconnect".
    setAddress(null);
    setChainId(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  /** Switch to Sepolia, adding it if the wallet has never seen it. */
  const switchToSepolia = useCallback(async () => {
    if (!hasMetaMask()) throw new Error('MetaMask was not detected.');
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: SEPOLIA_CHAIN_ID }],
      });
    } catch (err) {
      if (err?.code === 4902) {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [SEPOLIA_PARAMS],
        });
      } else {
        throw new Error(walletError(err).message);
      }
    }
    setChainId(await readChain());
  }, [readChain]);

  /**
   * Sign and broadcast a transaction the server prepared.
   *
   * This is the whole point of the Phase 9 migration: the backend returns
   * unsigned calldata and cannot send it, so the signature below is a
   * deliberate act by a named official holding their own key.
   *
   * Returns the transaction hash. The caller then hands it to the server's
   * `confirm` endpoint, which verifies it against the chain before recording
   * anything — the hash is not taken on trust.
   */
  const sendPrepared = useCallback(
    async (prepared) => {
      if (!hasMetaMask()) throw new Error('MetaMask was not detected.');
      if (!address) throw new Error('Connect your wallet first.');

      // Refuse to sign on the wrong network rather than letting the user
      // broadcast a transaction to a chain where the contract does not exist.
      const currentChain = await readChain();
      if (currentChain?.toLowerCase() !== SEPOLIA_CHAIN_ID.toLowerCase()) {
        throw new Error('Your wallet is on the wrong network. Switch to Sepolia and try again.');
      }

      try {
        return await window.ethereum.request({
          method: 'eth_sendTransaction',
          params: [
            {
              from: address,
              to: prepared.to,
              data: prepared.data,
              ...(prepared.value && prepared.value !== '0x0' ? { value: prepared.value } : {}),
            },
          ],
        });
      } catch (err) {
        const { cancelled, message } = walletError(err);
        const wrapped = new Error(message);
        wrapped.cancelled = Boolean(cancelled);
        throw wrapped;
      }
    },
    [address, readChain]
  );

  const value = useMemo(
    () => ({
      available,
      address,
      chainId,
      onSepolia,
      connecting,
      error,
      connect,
      disconnect,
      switchToSepolia,
      sendPrepared,
    }),
    [available, address, chainId, onSepolia, connecting, error, connect, disconnect, switchToSepolia, sendPrepared]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
};

export const useWallet = () => {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used inside WalletProvider');
  return ctx;
};
