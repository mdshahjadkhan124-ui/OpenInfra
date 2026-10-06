/**
 * Hardhat 3 configuration.
 *
 * Hardhat 2's toolchain carried several high-severity advisories in its own
 * dev dependencies (undici / @fastify/busboy), all of which resolve only by
 * moving to Hardhat 3 — so this project is on 3.x with 0 advisories.
 */
import 'dotenv/config';
import hardhatToolboxMochaEthers from '@nomicfoundation/hardhat-toolbox-mocha-ethers';

const { SEPOLIA_RPC_URL, PRIVATE_KEY, ETHERSCAN_API_KEY } = process.env;

/** Accept a private key with or without the 0x prefix. */
const normaliseKey = (key) => {
  if (!key || key.trim() === '') return undefined;
  const trimmed = key.trim();
  return trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
};

const deployerKey = normaliseKey(PRIVATE_KEY);

/** @type {import('hardhat/config').HardhatUserConfig} */
export default {
  plugins: [hardhatToolboxMochaEthers],

  solidity: {
    version: '0.8.28',
    settings: {
      optimizer: {
        enabled: true,
        // The contract is written once and called many times; favour cheaper
        // calls (release, views) over a cheaper one-off deployment.
        runs: 200,
      },
      // Needed for Etherscan to match the deployed bytecode exactly.
      metadata: { bytecodeHash: 'ipfs' },
    },
  },

  networks: {
    // In-process chain used by `npm test`.
    hardhat: {
      type: 'edr-simulated',
      chainType: 'l1',
    },

    sepolia: {
      type: 'http',
      chainType: 'l1',
      /**
       * A placeholder when no RPC URL is configured, rather than an empty
       * string.
       *
       * Hardhat validates every network entry at startup, including ones the
       * current command will never touch, and rejects an empty URL outright.
       * That made `npm test` — which runs entirely on the in-process chain and
       * needs no RPC at all — fail on a fresh clone until the reader had signed
       * up for an Alchemy key. The unit tests should run immediately after
       * `npm install`.
       *
       * Any command that actually reaches Sepolia still fails loudly, because
       * this host does not resolve.
       */
      url: SEPOLIA_RPC_URL?.trim() || 'https://sepolia.rpc.not-configured.invalid',
      accounts: deployerKey ? [deployerKey] : [],
      chainId: 11155111,
    },
  },

  verify: {
    etherscan: {
      apiKey: ETHERSCAN_API_KEY ?? '',
    },
  },

  paths: {
    sources: './contracts',
    tests: { mocha: './test' },
    cache: './cache',
    artifacts: './artifacts',
  },
};
