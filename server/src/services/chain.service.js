/**
 * Ethereum escrow bridge.
 *
 * The only module in the backend that talks to the chain. Everything else
 * deals in project ids and wei strings and never touches ethers.
 *
 * ===========================================================================
 * SECURITY TRADE-OFF — THE SERVER HOLDS THE ADMIN KEY
 * ===========================================================================
 *
 * `CHAIN_ADMIN_PRIVATE_KEY` is the escrow contract's owner. This process can
 * therefore lock funds and release milestones with no human present. That is a
 * real and significant weakness, and it is worth being explicit about what it
 * costs:
 *
 *   • Anyone who reads the server's environment — through a logging mistake, a
 *     compromised dependency, a leaked backup, a misconfigured container — can
 *     drain every project's escrow to its contractors. The contract's
 *     "admin can never withdraw" guarantee still holds, so the money can only
 *     go to the awarded contractors; but an attacker could release every
 *     milestone of every project immediately, paying for work never done.
 *
 *   • Every payment becomes an action of *the platform*, not of an identifiable
 *     official. The on-chain record shows the admin wallet approved a release,
 *     which is exactly the accountability the project exists to provide — and
 *     it is undermined if the signature was produced by a web server reacting
 *     to an HTTP request.
 *
 * WHY IT IS HERE ANYWAY: Phase 7 is a backend phase with no browser in the
 * loop, and the milestone flow has to be demonstrable end to end before the
 * frontend exists. A server signer is the only way to do that.
 *
 * RECOMMENDATION: move signing to the admin's MetaMask in Phase 9 and delete
 * this key. The backend should prepare an unsigned transaction, the admin's
 * wallet should sign it, and the backend should then record the resulting
 * hash. That makes the signature a deliberate human act by a named official
 * holding their own key, which is what a transparency platform should be able
 * to claim. The functions below are already shaped for it: `releaseMilestone`
 * returns a receipt, and `buildReleaseTransaction` produces the same call as
 * unsigned calldata for a wallet to sign — so Phase 9 swaps the caller, not
 * the contract or the data model.
 *
 * Until then, the mitigations in place are: the key is a throwaway testnet
 * account, it never appears in a log line, and `releaseMilestone` refuses to
 * run twice for the same milestone (checked here and enforced on-chain).
 */
import { ethers } from 'ethers';
import crypto from 'node:crypto';
import { config } from '../config/env.js';
import { ServiceUnavailableError, ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';
import { INFRA_ESCROW_ABI } from './__abi__/infraEscrow.js';

let provider = null;
let signer = null;
let contract = null;

const assertConfigured = () => {
  if (config.chain.mock) return;
  if (!config.chain.ready) {
    throw new ServiceUnavailableError(
      `The blockchain integration is not configured on this server (missing ${config.chain.missing.join(', ')}).`
    );
  }
};

/** Normalise a private key that may or may not carry the 0x prefix. */
const normaliseKey = (key) => (key.startsWith('0x') ? key : `0x${key}`);

const getContract = () => {
  assertConfigured();
  if (!contract) {
    provider = new ethers.JsonRpcProvider(config.chain.rpcUrl, config.chain.chainId);
    signer = new ethers.Wallet(normaliseKey(config.chain.adminPrivateKey), provider);
    contract = new ethers.Contract(config.chain.contractAddress, INFRA_ESCROW_ABI, signer);
  }
  return contract;
};

export const explorerTxUrl = (hash) => (hash ? `${config.chain.etherscanBaseUrl}/tx/${hash}` : null);
export const explorerAddressUrl = (address) =>
  address ? `${config.chain.etherscanBaseUrl}/address/${address}` : null;

/** keccak256 of a stable JSON record — the evidence hash stored on-chain. */
export const hashEvidence = (record) =>
  ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(record)));

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
// Mock mode
// ---------------------------------------------------------------------------

/**
 * Deterministic fake chain, used by the test suite and by routine development
 * so neither needs a funded wallet or a live RPC endpoint. Hashes are derived
 * from the inputs, so the same action always produces the same "transaction".
 */
const mockTx = (label, ...parts) => {
  const hash = `0x${crypto.createHash('sha256').update([label, ...parts].join(':')).digest('hex')}`;
  return {
    transactionHash: hash,
    blockNumber: 11_900_000 + (Number.parseInt(hash.slice(2, 8), 16) % 1000),
    gasUsed: label === 'lock' ? '232682' : '146622',
    mock: true,
  };
};

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Create the project on-chain and deposit the full amount in one transaction.
 *
 * `createAndFundProject` rather than create-then-lock: two transactions can
 * leave a project declared on-chain but unfunded, which is a confusing thing
 * to show on a public dashboard and needs its own recovery path.
 */
export const lockFunds = async ({ offChainId, contractorAddress, amountsWei }) => {
  const total = amountsWei.reduce((a, b) => a + BigInt(b), 0n);

  if (config.chain.mock) {
    logger.debug(`Chain fixture mode: lockFunds ${offChainId} (${ethers.formatEther(total)} ETH)`);
    return {
      ...mockTx('lock', offChainId, String(total)),
      contractAddress: '0x0000000000000000000000000000000000000000',
      onChainProjectId: Number.parseInt(crypto.createHash('sha256').update(offChainId).digest('hex').slice(0, 6), 16) % 10_000,
      totalLockedWei: total.toString(),
    };
  }

  const escrow = getContract();

  try {
    // Fail before spending gas if the backend has somehow already funded this.
    const [found] = await escrow.projectIdForOffChainId(offChainId);
    if (found) {
      throw new ApiError(409, 'This project has already been funded on-chain.', {
        code: 'ALREADY_FUNDED_ON_CHAIN',
      });
    }

    const balance = await provider.getBalance(signer.address);
    if (balance < total) {
      throw new ServiceUnavailableError(
        `The platform's escrow wallet holds ${ethers.formatEther(balance)} ETH but ${ethers.formatEther(total)} ETH is needed. Top it up from a Sepolia faucet.`
      );
    }

    logger.info(`Locking ${ethers.formatEther(total)} ETH for project ${offChainId}...`);

    const tx = await escrow.createAndFundProject(offChainId, contractorAddress, amountsWei, {
      value: total,
    });
    logger.info(`lockFunds tx submitted: ${tx.hash}`);

    const receipt = await tx.wait(config.chain.confirmations);
    const [, onChainProjectId] = await escrow.projectIdForOffChainId(offChainId);

    logger.success(
      `Funds locked for ${offChainId}: on-chain project ${onChainProjectId}, block ${receipt.blockNumber}`
    );

    return {
      transactionHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      contractAddress: config.chain.contractAddress,
      onChainProjectId: Number(onChainProjectId),
      totalLockedWei: total.toString(),
      mock: false,
    };
  } catch (err) {
    throw translateChainError(err, 'lock the escrow funds');
  }
};

/**
 * Release one milestone's funds to the contractor.
 *
 * The on-chain call is the authority on whether this milestone has already
 * been paid — `MilestoneAlreadyReleased` is enforced in the contract, so a
 * duplicate request cannot double-pay even if the database is inconsistent.
 */
export const releaseMilestone = async ({ onChainProjectId, onChainIndex, evidenceHash }) => {
  if (config.chain.mock) {
    logger.debug(`Chain fixture mode: releaseMilestone(${onChainProjectId}, ${onChainIndex})`);
    return mockTx('release', String(onChainProjectId), String(onChainIndex), evidenceHash ?? '');
  }

  const escrow = getContract();

  try {
    // Cheap pre-flight: a static call reverts with the contract's own error
    // before any gas is spent, so a double-release returns a clean 409 rather
    // than a failed transaction the admin has paid for.
    await escrow.releaseMilestone.staticCall(
      onChainProjectId,
      onChainIndex,
      evidenceHash ?? ethers.ZeroHash
    );

    logger.info(`Releasing milestone ${onChainIndex} of on-chain project ${onChainProjectId}...`);

    const tx = await escrow.releaseMilestone(
      onChainProjectId,
      onChainIndex,
      evidenceHash ?? ethers.ZeroHash
    );
    logger.info(`releaseMilestone tx submitted: ${tx.hash}`);

    const receipt = await tx.wait(config.chain.confirmations);
    logger.success(`Milestone released in block ${receipt.blockNumber}: ${receipt.hash}`);

    return {
      transactionHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      mock: false,
    };
  } catch (err) {
    throw translateChainError(err, 'release the milestone funds');
  }
};

/**
 * The same call as unsigned calldata, for the admin's wallet to sign.
 *
 * Unused in Phase 7 but deliberately present: it is the seam along which
 * Phase 9 replaces the server signer with MetaMask, without touching the
 * milestone service or the data model.
 */
export const buildReleaseTransaction = ({ onChainProjectId, onChainIndex, evidenceHash }) => {
  const iface = new ethers.Interface(INFRA_ESCROW_ABI);
  return {
    to: config.chain.contractAddress,
    data: iface.encodeFunctionData('releaseMilestone', [
      onChainProjectId,
      onChainIndex,
      evidenceHash ?? ethers.ZeroHash,
    ]),
    value: '0x0',
    chainId: config.chain.chainId,
  };
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

export const getEscrowWalletStatus = async () => {
  if (config.chain.mock) {
    return { address: '0x' + '0'.repeat(40), balanceEth: '999', mock: true };
  }
  getContract();
  const balance = await provider.getBalance(signer.address);
  return { address: signer.address, balanceEth: ethers.formatEther(balance), mock: false };
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

  // Decode a custom error from the revert data if present.
  let decodedName = null;
  const data = err.data ?? err.info?.error?.data ?? err.error?.data;
  if (typeof data === 'string' && data.startsWith('0x') && data.length > 2) {
    try {
      decodedName = new ethers.Interface(INFRA_ESCROW_ABI).parseError(data)?.name ?? null;
    } catch {
      decodedName = null;
    }
  }
  if (!decodedName) {
    const match = raw.match(/(MilestoneAlreadyReleased|ProjectNotFunded|ProjectDoesNotExist|DuplicateOffChainId|MilestoneIndexOutOfRange|IncorrectDepositAmount|OwnableUnauthorizedAccount|TransferFailed)/);
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
      503,
      "The platform's escrow wallet is not the admin of the contract. Check CONTRACT_ADDRESS and CHAIN_ADMIN_PRIVATE_KEY.",
    ],
    TransferFailed: [502, "The payment to the contractor's wallet was rejected."],
  };

  if (decodedName && KNOWN[decodedName]) {
    const [status, message] = KNOWN[decodedName];
    logger.error(`Chain error (${decodedName}) while trying to ${action}`);
    return new ApiError(status, message, { code: decodedName, cause: err });
  }

  if (/insufficient funds/i.test(raw)) {
    logger.error(`Escrow wallet out of gas while trying to ${action}`);
    return new ServiceUnavailableError(
      "The platform's escrow wallet has insufficient ETH for gas. Top it up from a Sepolia faucet.",
      { cause: err }
    );
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

export default {
  lockFunds,
  releaseMilestone,
  buildReleaseTransaction,
  getOnChainProject,
  getEscrowWalletStatus,
  splitByPercentage,
  hashEvidence,
  explorerTxUrl,
  explorerAddressUrl,
};
