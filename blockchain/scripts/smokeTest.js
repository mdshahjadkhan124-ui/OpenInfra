/**
 * Live on-chain smoke test.
 *
 * Proves the deployed contract actually works end to end against a real chain:
 * lock funds for a project, release one milestone, and show that the test ETH
 * moved. Prints an Etherscan link for every transaction.
 *
 *   npx hardhat run scripts/smokeTest.js --network sepolia
 *
 * Deliberately tiny amounts. Safe to re-run: each run uses a unique off-chain
 * id, so it never collides with a previous project.
 */
import fs from 'node:fs';
import path from 'node:path';
import { network } from 'hardhat';

const { ethers } = await network.getOrCreate();

const EXPLORER = 'https://sepolia.etherscan.io';
const line = (c = '-') => console.log(c.repeat(68));

/** Two milestones, 60/40, totalling 0.002 ETH. */
const MILESTONES = [ethers.parseEther('0.0012'), ethers.parseEther('0.0008')];
const TOTAL = MILESTONES.reduce((a, b) => a + b, 0n);

const main = async () => {
  const net = await ethers.provider.getNetwork();
  if (net.chainId !== 11155111n) {
    throw new Error(`Expected Sepolia (11155111) but connected to chain ${net.chainId}.`);
  }

  const deploymentFile = path.resolve(import.meta.dirname, '../deployments/sepolia.json');
  if (!fs.existsSync(deploymentFile)) {
    throw new Error('deployments/sepolia.json not found — deploy first.');
  }
  const { address } = JSON.parse(fs.readFileSync(deploymentFile, 'utf8'));

  const [admin] = await ethers.getSigners();
  const escrow = await ethers.getContractAt('InfraEscrow', address);

  // A freshly generated address, so the payout is visibly a transfer and the
  // balance delta is actually observable.
  //
  // NOT the standard Hardhat test account (0xf39Fd6e5...92266): its private
  // key is publicly known, so on a live testnet sweeper bots drain anything
  // sent to it within moments. A first run of this script used it and the
  // milestone payment vanished — the contract was correct, the recipient was
  // the problem.
  const contractor = ethers.Wallet.createRandom().address;

  line('=');
  console.log('  Live smoke test on Sepolia');
  line('=');
  console.log(`  contract   : ${address}`);
  console.log(`  admin      : ${admin.address}`);
  console.log(`  contractor : ${contractor}`);
  console.log(`  total      : ${ethers.formatEther(TOTAL)} ETH across ${MILESTONES.length} milestones`);
  console.log(`  admin bal  : ${ethers.formatEther(await ethers.provider.getBalance(admin.address))} ETH`);

  const offChainId = `smoke-${Date.now().toString(36)}`;

  // --- 1. Create and fund ------------------------------------------------
  line();
  console.log('  [1/3] createAndFundProject — locking funds...');
  let tx = await escrow.createAndFundProject(offChainId, contractor, MILESTONES, { value: TOTAL });
  console.log(`        tx: ${EXPLORER}/tx/${tx.hash}`);
  let receipt = await tx.wait();
  console.log(`        confirmed in block ${receipt.blockNumber}, gas ${receipt.gasUsed}`);

  const [, projectId] = await escrow.projectIdForOffChainId(offChainId);
  const afterLock = await escrow.getProject(projectId);
  console.log(`        projectId ${projectId} · locked ${ethers.formatEther(afterLock.totalAmount)} ETH`);
  console.log(`        contract balance now ${ethers.formatEther(await escrow.contractBalance())} ETH`);

  // Confirm the events actually landed in the logs.
  const created = receipt.logs
    .map((l) => {
      try {
        return escrow.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .map((e) => e.name);
  console.log(`        events: ${created.join(', ')}`);

  // --- 2. Release milestone 0 --------------------------------------------
  line();
  console.log('  [2/3] releaseMilestone(0) — paying the contractor...');
  const before = await ethers.provider.getBalance(contractor);

  const evidence = ethers.keccak256(ethers.toUtf8Bytes(`${offChainId}:milestone:0:approved`));
  tx = await escrow.releaseMilestone(projectId, 0, evidence);
  const releaseTxHash = tx.hash;
  console.log(`        tx: ${EXPLORER}/tx/${releaseTxHash}`);
  receipt = await tx.wait();
  console.log(`        confirmed in block ${receipt.blockNumber}, gas ${receipt.gasUsed}`);

  const after = await ethers.provider.getBalance(contractor);
  console.log(`        contractor received ${ethers.formatEther(after - before)} ETH`);
  if (after - before !== MILESTONES[0]) {
    throw new Error(
      `Expected the contractor to receive ${ethers.formatEther(MILESTONES[0])} ETH, got ${ethers.formatEther(after - before)}.`
    );
  }

  const m0 = await escrow.getMilestone(projectId, 0);
  console.log(`        milestone 0 status: ${m0.status === 1n ? 'Released' : 'Pending'}`);
  console.log(`        evidence hash on-chain: ${m0.evidenceHash}`);

  // --- 3. Prove it cannot be paid twice ----------------------------------
  line();
  console.log('  [3/3] attempting to release milestone 0 again (must fail)...');
  try {
    await escrow.releaseMilestone.staticCall(projectId, 0, evidence);
    throw new Error('SECURITY FAILURE: a released milestone was releasable again.');
  } catch (err) {
    if (/SECURITY FAILURE/.test(err.message)) throw err;
    const decoded = escrow.interface.parseError(err.data ?? '0x') ?? null;
    console.log(`        reverted as expected: ${decoded?.name ?? 'revert'}`);
  }

  const final = await escrow.getProject(projectId);
  line('=');
  console.log('  Result');
  line('=');
  console.log(`  released   : ${ethers.formatEther(final.releasedAmount)} ETH`);
  console.log(`  remaining  : ${ethers.formatEther(final.remainingAmount)} ETH (milestone 1, still locked)`);
  console.log(`  complete   : ${final.completed}`);
  console.log(`  totalEscrowed (all projects) : ${ethers.formatEther(await escrow.totalEscrowed())} ETH`);
  console.log(`  totalReleased (all projects) : ${ethers.formatEther(await escrow.totalReleased())} ETH`);
  console.log(`  contract balance             : ${ethers.formatEther(await escrow.contractBalance())} ETH`);
  line();
  console.log(`  Contract : ${EXPLORER}/address/${address}`);
  console.log(`  Payout tx: ${EXPLORER}/tx/${releaseTxHash}`);
  line('=');
};

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n  Smoke test failed:', err.message);
    process.exit(1);
  });
