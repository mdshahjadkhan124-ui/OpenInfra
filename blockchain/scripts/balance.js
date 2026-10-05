/**
 * Report the deployer's address, balance and the network it is on.
 * Useful before a deploy, to confirm the faucet actually paid out.
 */
import { network } from 'hardhat';

const { ethers, networkName } = await network.getOrCreate();

const main = async () => {
  const [signer] = await ethers.getSigners();
  if (!signer) {
    console.log('No signer configured. Set PRIVATE_KEY in blockchain/.env.');
    return;
  }

  const net = await ethers.provider.getNetwork();
  const balance = await ethers.provider.getBalance(signer.address);
  const blockNumber = await ethers.provider.getBlockNumber();

  console.log(`  network : ${networkName} (chainId ${net.chainId})`);
  console.log(`  block   : ${blockNumber}`);
  console.log(`  address : ${signer.address}`);
  console.log(`  balance : ${ethers.formatEther(balance)} ETH`);

  if (balance === 0n) {
    console.log('\n  Fund this address from a Sepolia faucet before deploying:');
    console.log('    https://sepoliafaucet.com  ·  https://www.alchemy.com/faucets/ethereum-sepolia');
  }
};

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('  Failed:', err.message);
    process.exit(1);
  });
