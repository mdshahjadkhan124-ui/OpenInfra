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

  /**
   * The simulation MUST declare a caller.
   *
   * `releaseMilestone` is `onlyOwner`. An `eth_call` with no `from` is made by
   * the zero address, so the very first thing the contract checks fails, and
   * every simulation reverted with `OwnableUnauthorizedAccount(0x0)` — which
   * the error translator reported as "the connected wallet is not the
   * administrator", naming a wallet that was never part of the call. The real
   * admin was blocked from releasing funds and told to switch wallets.
   *
   * The signing wallet is passed in by the caller. When it is absent (a
   * scripted call, say), fall back to the contract's own owner so the
   * simulation still tests what it is meant to test — the milestone's state —
   * rather than failing on an ownership check nobody asked for.
   */
  const caller = from ?? (await getContract().owner());

  try {
    await getContract().releaseMilestone.staticCall(
      onChainProjectId,
      onChainIndex,
      evidenceHash ?? ethers.ZeroHash,
      { from: ethers.getAddress(caller) }
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

/**
 * Locate the block containing a given timestamp, by binary search.
 *
 * Needed because a hosted RPC commonly restricts the block range of a single
 * `eth_getLogs` call — Alchemy's free tier caps it at TEN blocks, so scanning
 * from the deployment block is rejected outright. Guessing the block from an
 * average block time is not good enough either: an off-chain timestamp can be
 * hours away from when the transaction was actually sent.
 *
 * The contract records `fundedAt` and `releasedAt` itself, so the exact
 * second is known. Binary search turns that into a block in ~14 cheap calls,
 * and the log scan then needs a single narrow window.
 */
const findBlockByTimestamp = async (targetTimestamp) => {
  const p = getProvider();
  let low = config.chain.deployBlock;
  let high = await p.getBlockNumber();

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const block = await p.getBlock(mid);
    if (!block) break;
    if (block.timestamp < targetTimestamp) low = mid + 1;
    else high = mid;
  }
  return low;
};

/**
 * Scan a small set of narrow windows around a block for a matching log.
 *
 * Windows are kept at or below `config.chain.logWindow` so the call is
 * accepted by a restricted provider, and the search walks outward a bounded
 * number of times rather than unbounded.
 */
const scanNearBlock = async (centreBlock, filter) => {
  const p = getProvider();
  const window = config.chain.logWindow;
  const maxSteps = 6;

  for (let step = 0; step <= maxSteps; step += 1) {
    const offsets = step === 0 ? [0] : [-step, step];
    for (const direction of offsets) {
      const from = Math.max(
        config.chain.deployBlock,
        centreBlock + direction * window - Math.floor(window / 2)
      );
      try {
        const logs = await p.getLogs({ ...filter, fromBlock: from, toBlock: from + window - 1 });
        if (logs.length > 0) return logs;
      } catch (err) {
        // A provider refusing the range is worth one warning, not a crash.
        logger.debug(`getLogs ${from}-${from + window - 1} refused: ${err.shortMessage ?? err.message}`);
      }
    }
  }
  return [];
};

/**
 * Find the transaction that funded a project, from the contract's event log.
 *
 * Needed because prepare -> sign -> confirm is interruptible: the browser can
 * close, or lose its connection, between MetaMask broadcasting the deposit and
 * the backend being told the hash. The money has moved and the contract knows
 * about it, but our record of *which* transaction did it is gone.
 */
export const findFundingTransaction = async (onChainProjectId) => {
  if (config.chain.mock) return null;

  const escrow = getContract();
  try {
    const project = await escrow.getProject(onChainProjectId);
    if (!project.funded || project.fundedAt === 0n) return null;

    const centre = await findBlockByTimestamp(Number(project.fundedAt));
    const logs = await scanNearBlock(centre, {
      address: config.chain.contractAddress,
      topics: [
        ethers.id('FundsLocked(uint256,address,uint256)'),
        ethers.zeroPadValue(ethers.toBeHex(onChainProjectId), 32),
      ],
    });

    if (logs.length === 0) {
      logger.warn(
        `FundsLocked event for on-chain project ${onChainProjectId} not found near block ${centre}.`
      );
      return null;
    }

    const log = logs[0];
    return {
      transactionHash: log.transactionHash,
      blockNumber: log.blockNumber,
      depositor: ethers.getAddress(`0x${log.topics[2].slice(26)}`),
      amountWei: BigInt(log.data).toString(),
    };
  } catch (err) {
    logger.warn(
      `Could not recover the funding transaction for on-chain project ${onChainProjectId}: ${err.message}`
    );
    return null;
  }
};

/**
 * Find the release transaction for each paid milestone.
 *
 * Same reasoning as findFundingTransaction, and the same technique: each
 * milestone carries its own `releasedAt`, so each lookup is targeted rather
 * than a sweep.
 *
 * @returns {Promise<Map<number, object>>} keyed by milestone index
 */
export const findMilestoneReleaseTransactions = async (onChainProjectId) => {
  const byIndex = new Map();
  if (config.chain.mock) return byIndex;

  const escrow = getContract();
  try {
    const milestones = await escrow.getMilestones(onChainProjectId);

    for (const [index, milestone] of milestones.entries()) {
      if (milestone.status !== 1n || milestone.releasedAt === 0n) continue;

      const centre = await findBlockByTimestamp(Number(milestone.releasedAt));
      const logs = await scanNearBlock(centre, {
        address: config.chain.contractAddress,
        topics: [
          ethers.id('MilestoneReleased(uint256,uint256,address,uint256,bytes32)'),
          ethers.zeroPadValue(ethers.toBeHex(onChainProjectId), 32),
          ethers.zeroPadValue(ethers.toBeHex(index), 32),
        ],
      });

      if (logs.length === 0) continue;

      const log = logs[0];
      // amount and evidenceHash are the two unindexed arguments.
      const [amount, evidenceHash] = getInterface().decodeEventLog(
        'MilestoneReleased',
        log.data,
        log.topics
      ).slice(3);

      byIndex.set(index, {
        transactionHash: log.transactionHash,
        blockNumber: log.blockNumber,
        contractor: ethers.getAddress(`0x${log.topics[3].slice(26)}`),
        amountWei: amount?.toString() ?? null,
        evidenceHash: evidenceHash ?? null,
      });
    }
  } catch (err) {
    logger.warn(
      `Could not recover release transactions for on-chain project ${onChainProjectId}: ${err.message}`
    );
  }

  return byIndex;
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
  let decodedArgs = [];
  const data = err.data ?? err.info?.error?.data ?? err.error?.data;
  if (typeof data === 'string' && data.startsWith('0x') && data.length > 2) {
    try {
      const parsed = getInterface().parseError(data);
      decodedName = parsed?.name ?? null;
      decodedArgs = parsed?.args ? Array.from(parsed.args, String) : [];
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

    /**
     * Name the address the contract actually rejected.
     *
     * A bare "the connected wallet is not the administrator" once sent the
     * genuine admin hunting for a wallet problem that did not exist: the
     * rejected caller was the zero address, because the simulation declared no
     * caller at all. Reporting the address makes that mistake self-evident.
     */
    const rejected = decodedName === 'OwnableUnauthorizedAccount' ? decodedArgs[0] : null;
    const detail =
      rejected === ethers.ZeroAddress
        ? ' (the request reached the contract with no caller address — this is a server fault, not a wallet problem)'
        : rejected
          ? ` (rejected ${rejected})`
          : '';

    logger.error(
      `Chain error (${decodedName}${rejected ? `: ${rejected}` : ''}) while trying to ${action}`
    );
    return new ApiError(status, `${message}${detail}`, { code: decodedName, cause: err });
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
  findFundingTransaction,
  findMilestoneReleaseTransactions,
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
