/**
 * Read the live state of the deployed escrow.
 *
 *   npx hardhat run scripts/inspect.js --network sepolia
 *
 * Prints the contract-wide ledger and every project it holds, including each
 * milestone's status. Useful for confirming what the chain actually says,
 * independently of the platform's own database.
 */
import fs from 'node:fs';
import path from 'node:path';
import { network } from 'hardhat';

const { ethers, networkName } = await network.getOrCreate();

const EXPLORERS = { 11155111: 'https://sepolia.etherscan.io' };

const main = async () => {
  const net = await ethers.provider.getNetwork();
  const file = path.resolve(import.meta.dirname, `../deployments/${networkName}.json`);

  // Allow an explicit override, so this works against any deployment.
  const address = process.env.CONTRACT_ADDRESS?.trim() || (fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, 'utf8')).address
    : null);

  if (!address) {
    throw new Error(
      `No deployment record at deployments/${networkName}.json. Deploy first, or set CONTRACT_ADDRESS.`
    );
  }

  const escrow = await ethers.getContractAt('InfraEscrow', address);
  const explorer = EXPLORERS[Number(net.chainId)];

  const [owner, count, escrowed, released, balance] = await Promise.all([
    escrow.owner(),
    escrow.projectCount(),
    escrow.totalEscrowed(),
    escrow.totalReleased(),
    escrow.contractBalance(),
  ]);

  console.log('='.repeat(68));
  console.log(`  InfraEscrow on ${networkName} (chainId ${net.chainId})`);
  console.log('='.repeat(68));
  console.log(`  address        : ${address}`);
  console.log(`  admin (owner)  : ${owner}`);
  console.log(`  projects       : ${count}`);
  console.log(`  totalEscrowed  : ${ethers.formatEther(escrowed)} ETH`);
  console.log(`  totalReleased  : ${ethers.formatEther(released)} ETH`);
  console.log(`  balance        : ${ethers.formatEther(balance)} ETH`);

  // The invariant worth checking on every inspection.
  const expected = escrowed - released;
  const balanced = balance === expected;
  console.log(`  ledger balanced: ${balanced ? 'yes' : `NO — expected ${ethers.formatEther(expected)} ETH`}`);
  if (explorer) console.log(`  explorer       : ${explorer}/address/${address}`);

  for (let id = 0n; id < count; id += 1n) {
    const p = await escrow.getProject(id);
    const milestones = await escrow.getMilestones(id);

    console.log('-'.repeat(68));
    console.log(`  project ${id}  "${p.offChainId}"`);
    console.log(`    contractor : ${p.contractor}`);
    console.log(
      `    funded     : ${p.funded}   complete: ${p.completed}   ` +
        `released ${ethers.formatEther(p.releasedAmount)} / ${ethers.formatEther(p.totalAmount)} ETH`
    );
    milestones.forEach((m, i) => {
      const status = m.status === 1n ? 'Released' : 'Pending ';
      const when = m.releasedAt > 0n ? new Date(Number(m.releasedAt) * 1000).toISOString() : '';
      console.log(`      [${i}] ${status}  ${ethers.formatEther(m.amount).padStart(10)} ETH  ${when}`);
    });
  }
  console.log('='.repeat(68));
};

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('  Failed:', err.message);
    process.exit(1);
  });
