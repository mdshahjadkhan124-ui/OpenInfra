/**
 * Ethereum escrow bridge.
 *
 * The only module in the backend that talks to the chain. Everything else
 * deals in project ids and wei strings and never touches ethers.
 *
 * ===========================================================================
 * THE SERVER CANNOT SIGN. IT ONLY PREPARES AND VERIFIES.
 * ===========================================================================
 *
 * Phase 7 held the admin's private key here and signed transactions itself.
 * That was a deliberate, documented stopgap and it is now gone, along with
 * CHAIN_ADMIN_PRIVATE_KEY. The reasons it had to go:
 *
 *   • Anyone who could read the server's environment could release every
 *     milestone of every project, paying for work never done.
 *   • Every payment was an act of *the platform* rather than of an
 *     identifiable official. The on-chain record said "the admin wallet
 *     approved this", which is worthless as accountability if a web server
 *     produced the signature.
 *
 * The flow is now prepare → sign → confirm:
 *
 *   1. The admin's browser asks the server to PREPARE a transaction. The
 *      server returns unsigned calldata. It holds no key and cannot send it.
 *   2. The admin's MetaMask signs and broadcasts. The signature is the act of
 *      a named human holding their own key.
 *   3. The browser hands the resulting hash back to CONFIRM, and the server
 *      verifies it against the chain before recording anything.
 *
 * Step 3 is the part that actually matters for integrity. The browser is not
 * trusted: a client could post any hash it liked. So `confirm` fetches the
 * receipt itself and refuses unless the transaction succeeded, went to OUR
 * contract address, and emitted the specific event for the specific milestone
 * being claimed. A forged or unrelated hash cannot mark a milestone paid.
 */
import { ethers } from 'ethers';
import crypto from 'node:crypto';
import { config } from '../config/env.js';
import { ServiceUnavailableError, ApiError, BadRequestError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';
import { INFRA_ESCROW_ABI } from './__abi__/infraEscrow.js';

let provider = null;
let contract = null;
let iface = null;

const assertConfigured = () => {
  if (config.chain.mock) return;
  if (!config.chain.ready) {
    throw new ServiceUnavailableError(
      `The blockchain integration is not configured on this server (missing ${config.chain.missing.join(', ')}).`
    );
  }
};

/** Read-only provider. There is no signer here by design. */
const getProvider = () => {
  assertConfigured();
  provider ??= new ethers.JsonRpcProvider(config.chain.rpcUrl, config.chain.chainId);
  return provider;
};

const getContract = () => {
  contract ??= new ethers.Contract(config.chain.contractAddress, INFRA_ESCROW_ABI, getProvider());
  return contract;
};

export const getInterface = () => {
  iface ??= new ethers.Interface(INFRA_ESCROW_ABI);
  return iface;
};

export const explorerTxUrl = (hash) => (hash ? `${config.chain.etherscanBaseUrl}/tx/${hash}` : null);
export const explorerAddressUrl = (address) =>
  address ? `${config.chain.etherscanBaseUrl}/address/${address}` : null;

/** keccak256 of a stable JSON record — the evidence hash stored on-chain. */
export const hashEvidence = (record) => ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(record)));

/**
 * Split a total into exact wei shares from percentages.
 *
 * Integer arithmetic throughout, with any rounding remainder pushed onto the
 * final milestone. The contract requires the shares to sum exactly to the
 * deposit, so a dropped wei would make the last milestone unreleasable.
 */
export const splitByPercentage = (totalWei, percentages) => {
  const total = BigInt(totalWei);
  // Work in basis points so 33.33% is representable without floats.
  const bps = percentages.map((p) => BigInt(Math.round(p * 100)));

  const shares = bps.map((b) => (total * b) / 10_000n);
  const allocated = shares.reduce((a, b) => a + b, 0n);
  const remainder = total - allocated;

  if (remainder > 0n) shares[shares.length - 1] += remainder;

  return shares;
};

// ---------------------------------------------------------------------------
// Fixture mode
// ---------------------------------------------------------------------------

/** Deterministic fake receipt, so tests need no wallet and no RPC endpoint. */
const mockReceipt = (label, ...parts) => {
  const hash = `0x${crypto.createHash('sha256').update([label, ...parts].join(':')).digest('hex')}`;
  return {
    transactionHash: hash,
    blockNumber: 11_900_000 + (Number.parseInt(hash.slice(2, 8), 16) % 1000),
    gasUsed: label === 'lock' ? '232682' : '146622',
    mock: true,
  };
};

// ---------------------------------------------------------------------------
// PREPARE — unsigned transactions for the admin's wallet
// ---------------------------------------------------------------------------

/**
 * Unsigned calldata to create and fund a project.
 *
 * `createAndFundProject` rather than create-then-lock: two transactions can
 * leave a project declared on-chain but unfunded, and asking an official to
 * approve two MetaMask prompts for one action invites them to click through
 * the second without reading it.
 */
export const buildLockFundsTransaction = ({ offChainId, contractorAddress, amountsWei }) => {
  const total = amountsWei.reduce((a, b) => a + BigInt(b), 0n);

  return {
    to: config.chain.contractAddress,
    data: getInterface().encodeFunctionData('createAndFundProject', [
      offChainId,
      contractorAddress,
      amountsWei,
    ]),
    value: `0x${total.toString(16)}`,
    chainId: config.chain.chainId,
    // Shown in the UI before the wallet opens, so the official knows what they
    // are about to approve rather than reading raw hex in MetaMask.
    summary: {
      action: 'lockFunds',
      contract: config.chain.contractAddress,
      totalWei: total.toString(),
      totalEth: ethers.formatEther(total),
      milestoneCount: amountsWei.length,
      contractorAddress,
    },
  };
};

/** Unsigned calldata to release one milestone. */
export const buildReleaseTransaction = ({ onChainProjectId, onChainIndex, evidenceHash, amountWei }) => ({
  to: config.chain.contractAddress,
  data: getInterface().encodeFunctionData('releaseMilestone', [
    onChainProjectId,
    onChainIndex,
    evidenceHash ?? ethers.ZeroHash,
  ]),
  value: '0x0',
  chainId: config.chain.chainId,
  summary: {
    action: 'releaseMilestone',
    contract: config.chain.contractAddress,
    onChainProjectId,
    milestoneIndex: onChainIndex,
    amountWei: amountWei ?? null,
    amountEth: amountWei ? ethers.formatEther(BigInt(amountWei)) : null,
    evidenceHash: evidenceHash ?? ethers.ZeroHash,
  },
});

/**
 * Simulate a call before offering it to the wallet.
 *
 * A static call reverts with the contract's own error for free. Without this,
 * an already-paid milestone would open MetaMask, the official would approve,
 * and the transaction would fail on-chain having cost them gas.
 */
export const simulateRelease = async ({ onChainProjectId, onChainIndex, evidenceHash, from }) => {
  if (config.chain.mock) return { ok: true };

  try {
    await getContract().releaseMilestone.staticCall(
      onChainProjectId,
      onChainIndex,
      evidenceHash ?? ethers.ZeroHash,
      { from }
    );
    return { ok: true };
  } catch (err) {
    throw translateChainError(err, 'release the milestone funds');
  }
};

// ---------------------------------------------------------------------------
// CONFIRM — verify a hash the browser claims to have broadcast
// ---------------------------------------------------------------------------

const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;

/**
 * Wait for a receipt, tolerating the gap between MetaMask returning a hash and
 * the RPC node having seen the transaction.
 */
const waitForReceipt = async (transactionHash, { timeoutMs = 120_000 } = {}) => {
  const p = getProvider();
  const deadline = Date.now() + timeoutMs;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const receipt = await p.getTransactionReceipt(transactionHash).catch(() => null);
    if (receipt) return receipt;
    if (Date.now() > deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
};

/**
 * Verify a transaction really did what the client says it did.
 *
 * The browser is untrusted. Every claim is checked against the chain:
 *   • the hash is well-formed
 *   • a receipt exists and status is success
 *   • it was sent to OUR contract, not some look-alike
 *   • it emitted the expected event with the expected arguments
 *
 * Only then is the result returned for recording.
 */
export const confirmTransaction = async ({ transactionHash, expectEvent, matchArgs }) => {
  if (!HASH_PATTERN.test(String(transactionHash ?? ''))) {
    throw new BadRequestError('That is not a valid transaction hash.');
  }

  if (config.chain.mock) {
    return {
      transactionHash,
      blockNumber: 11_900_000,
      gasUsed: '146622',
      event: expectEvent,
      args: matchArgs ?? {},
      mock: true,
    };
  }

  const receipt = await waitForReceipt(transactionHash);
  if (!receipt) {
    throw new ApiError(
      409,
      'That transaction has not been mined yet. Wait for it to confirm and try again.',
      { code: 'TX_NOT_MINED' }
    );
  }
  if (receipt.status !== 1) {
    throw new ApiError(422, 'That transaction failed on-chain, so nothing was recorded.', {
      code: 'TX_REVERTED',
    });
  }

  // A transaction to a different address proves nothing about our escrow.
  const expectedTo = config.chain.contractAddress.toLowerCase();
  if ((receipt.to ?? '').toLowerCase() !== expectedTo) {
    throw new ApiError(
      422,
      'That transaction was not sent to this platform\'s escrow contract.',
      { code: 'TX_WRONG_CONTRACT' }
    );
  }

  // Decode our own events out of the logs.
  const escrowInterface = getInterface();
  const events = receipt.logs
    .map((log) => {
      try {
        return escrowInterface.parseLog(log);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const match = events.find((e) => e.name === expectEvent);
  if (!match) {
    throw new ApiError(
      422,
      `That transaction did not emit a ${expectEvent} event, so it did not do what was claimed.`,
      { code: 'TX_WRONG_EVENT' }
    );
  }

  // And it must be the event for THIS milestone, not another one.
  if (matchArgs) {
    for (const [key, expected] of Object.entries(matchArgs)) {
      const actual = match.args[key];
      if (actual === undefined) continue;
      if (String(actual).toLowerCase() !== String(expected).toLowerCase()) {
        throw new ApiError(
          422,
          `That transaction's ${key} does not match what was expected (${actual} vs ${expected}).`,
          { code: 'TX_ARG_MISMATCH' }
        );
      }
    }
  }

  logger.success(
    `Verified ${expectEvent} in ${transactionHash} (block ${receipt.blockNumber})`
  );

  return {
    transactionHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
    from: receipt.from,
    event: match.name,
    args: Object.fromEntries(
      match.fragment.inputs.map((input, i) => [input.name, String(match.args[i])])
    ),
    mock: false,
  };
};

/** The on-chain project id for a platform project, after funding. */
export const resolveOnChainProjectId = async (offChainId) => {
  if (config.chain.mock) {
    return Number.parseInt(crypto.createHash('sha256').update(offChainId).digest('hex').slice(0, 6), 16) % 10_000;
  }
  const [found, id] = await getContract().projectIdForOffChainId(offChainId);
  if (!found) return null;
  return Number(id);
};

/** Has this project already been funded on-chain? Guards a double deposit. */
export const isAlreadyFundedOnChain = async (offChainId) => {
  if (config.chain.mock) return false;
  const [found] = await getContract().projectIdForOffChainId(offChainId);
  return found;
};

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Live on-chain state for a project — the independent source of truth. */
export const getOnChainProject = async (onChainProjectId) => {
  if (config.chain.mock) return null;

  const escrow = getContract();
  try {
    const p = await escrow.getProject(onChainProjectId);
    const milestones = await escrow.getMilestones(onChainProjectId);

    return {
      offChainId: p.offChainId,
      contractor: p.contractor,
      totalWei: p.totalAmount.toString(),
      releasedWei: p.releasedAmount.toString(),
      remainingWei: p.remainingAmount.toString(),
      funded: p.funded,
      completed: p.completed,
      milestones: milestones.map((m, i) => ({
        index: i,
        amountWei: m.amount.toString(),
        released: m.status === 1n,
        releasedAt: m.releasedAt > 0n ? new Date(Number(m.releasedAt) * 1000) : null,
        evidenceHash: m.evidenceHash,
      })),
    };
  } catch (err) {
    throw translateChainError(err, 'read the on-chain project');
  }
};

/**
 * Who the contract will accept transactions from.
 *
 * The frontend compares this with the connected MetaMask account, so an
 * official using the wrong wallet is told before they try to sign rather than
 * after they have paid gas for a reverted transaction.
 */
export const getContractAdmin = async () => {
  if (config.chain.mock) {
    return { admin: '0x' + '0'.repeat(40), contractAddress: config.chain.contractAddress, mock: true };
  }
  const admin = await getContract().owner();
  return {
    admin,
    contractAddress: config.chain.contractAddress,
    chainId: config.chain.chainId,
    explorerUrl: explorerAddressUrl(config.chain.contractAddress),
    mock: false,
  };
};

// ---------------------------------------------------------------------------
// Error translation
// ---------------------------------------------------------------------------

/**
 * Turn an ethers/RPC failure into something the API can return.
 *
 * Contract custom errors are decoded by name, so "MilestoneAlreadyReleased"
 * becomes a 409 with a readable message instead of an opaque revert blob.
 */
const translateChainError = (err, action) => {
  if (err instanceof ApiError) return err;

  const raw = err.shortMessage ?? err.message ?? '';

  let decodedName = null;
  const data = err.data ?? err.info?.error?.data ?? err.error?.data;
  if (typeof data === 'string' && data.startsWith('0x') && data.length > 2) {
    try {
      decodedName = getInterface().parseError(data)?.name ?? null;
    } catch {
      decodedName = null;
    }
  }
  if (!decodedName) {
    const match = raw.match(
      /(MilestoneAlreadyReleased|ProjectNotFunded|ProjectDoesNotExist|DuplicateOffChainId|MilestoneIndexOutOfRange|IncorrectDepositAmount|OwnableUnauthorizedAccount|TransferFailed)/
    );
    decodedName = match?.[1] ?? null;
  }

  const KNOWN = {
    MilestoneAlreadyReleased: [
      409,
      'That milestone has already been paid on-chain and cannot be released twice.',
    ],
    ProjectNotFunded: [409, 'The escrow for this project has not been funded yet.'],
    ProjectDoesNotExist: [404, 'This project does not exist in the escrow contract.'],
    DuplicateOffChainId: [409, 'This project has already been funded on-chain.'],
    MilestoneIndexOutOfRange: [400, 'That milestone does not exist in the escrow contract.'],
    IncorrectDepositAmount: [400, 'The deposit did not match the milestone total exactly.'],
    OwnableUnauthorizedAccount: [
      403,
      'The connected wallet is not the administrator of the escrow contract. Switch to the admin wallet.',
    ],
    TransferFailed: [502, "The payment to the contractor's wallet was rejected."],
  };

  if (decodedName && KNOWN[decodedName]) {
    const [status, message] = KNOWN[decodedName];
    logger.error(`Chain error (${decodedName}) while trying to ${action}`);
    return new ApiError(status, message, { code: decodedName, cause: err });
  }

  if (/could not detect network|ECONNREFUSED|ENOTFOUND|timeout|SERVER_ERROR/i.test(raw)) {
    logger.error(`RPC unreachable while trying to ${action}: ${raw}`);
    return new ServiceUnavailableError(
      'The Ethereum network is unreachable right now. Please try again shortly.',
      { cause: err }
    );
  }

  logger.error(`Unexpected chain error while trying to ${action}:`, raw);
  return new ServiceUnavailableError(`Could not ${action}. Please try again.`, { cause: err });
};

export { mockReceipt };

export default {
  buildLockFundsTransaction,
  buildReleaseTransaction,
  simulateRelease,
  confirmTransaction,
  resolveOnChainProjectId,
  isAlreadyFundedOnChain,
  getOnChainProject,
  getContractAdmin,
  splitByPercentage,
  hashEvidence,
  explorerTxUrl,
  explorerAddressUrl,
};
