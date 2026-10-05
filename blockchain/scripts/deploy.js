/**
 * Deploy InfraEscrow.
 *
 *   npm run deploy:local      # in-process chain, for a smoke test
 *   npm run deploy:sepolia    # real testnet
 *
 * On success it writes `deployments/<network>.json` and prints the exact
 * `hardhat verify` command plus the two .env lines the rest of the project
 * needs, so nothing has to be copied by hand from scrollback.
 */
import fs from 'node:fs';
import path from 'node:path';
import { network } from 'hardhat';

const { ethers, networkName } = await network.getOrCreate();

const line = (char = '-') => console.log(char.repeat(68));

const main = async () => {
  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error(
      'No signer available. Set PRIVATE_KEY in blockchain/.env before deploying to a live network.'
    );
  }

  const balance = await ethers.provider.getBalance(deployer.address);
  const net = await ethers.provider.getNetwork();

  line('=');
  console.log('  Deploying InfraEscrow');
  line('=');
  console.log(`  network   : ${networkName} (chainId ${net.chainId})`);
  console.log(`  deployer  : ${deployer.address}`);
  console.log(`  balance   : ${ethers.formatEther(balance)} ETH`);

  // The admin is the deployer: whoever funds the escrow must be the account
  // able to release milestones from it. Ownable's transferOwnership can move
  // this later without redeploying.
  const admin = process.env.ADMIN_ADDRESS?.trim() || deployer.address;
  console.log(`  admin     : ${admin}${admin === deployer.address ? ' (deployer)' : ' (from ADMIN_ADDRESS)'}`);

  if (balance === 0n) {
    throw new Error(
      'Deployer has no ETH. Fund it from a Sepolia faucet (e.g. https://sepoliafaucet.com) and retry.'
    );
  }

  line();
  const Factory = await ethers.getContractFactory('InfraEscrow');

  // Show the cost before spending it.
  const deployTx = await Factory.getDeployTransaction(admin);
  const estimatedGas = await ethers.provider.estimateGas({ ...deployTx, from: deployer.address });
  const feeData = await ethers.provider.getFeeData();
  const gasPrice = feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n;
  console.log(`  estimated gas  : ${estimatedGas.toString()}`);
  console.log(`  estimated cost : ~${ethers.formatEther(estimatedGas * gasPrice)} ETH`);

  line();
  console.log('  Sending deployment transaction...');

  const escrow = await Factory.deploy(admin);
  const tx = escrow.deploymentTransaction();
  console.log(`  tx hash   : ${tx.hash}`);
  console.log('  waiting for confirmation...');

  await escrow.waitForDeployment();
  const address = await escrow.getAddress();
  const receipt = await tx.wait();

  line('=');
  console.log('  Deployed');
  line('=');
  console.log(`  address      : ${address}`);
  console.log(`  block        : ${receipt.blockNumber}`);
  console.log(`  gas used     : ${receipt.gasUsed.toString()}`);
  console.log(`  actual cost  : ${ethers.formatEther(receipt.gasUsed * receipt.gasPrice)} ETH`);

  // --- Sanity check the live contract ---------------------------------
  const owner = await escrow.owner();
  const count = await escrow.projectCount();
  console.log(`  owner        : ${owner}`);
  console.log(`  projectCount : ${count}`);
  if (owner.toLowerCase() !== admin.toLowerCase()) {
    throw new Error(`Deployed owner ${owner} does not match the intended admin ${admin}.`);
  }

  // --- Record it -------------------------------------------------------
  // Detect by chain id, not name: Hardhat 3's in-process network is called
  // "default", so a name check would treat a local run as a live deployment.
  const SIMULATED_CHAIN_IDS = new Set([31337n, 1337n]);
  const isLive = !SIMULATED_CHAIN_IDS.has(net.chainId);
  const explorer = net.chainId === 11155111n ? 'https://sepolia.etherscan.io' : null;

  const record = {
    network: networkName,
    chainId: Number(net.chainId),
    address,
    admin,
    deployer: deployer.address,
    transactionHash: tx.hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
    compiler: '0.8.28',
    optimizer: { enabled: true, runs: 200 },
    deployedAt: new Date().toISOString(),
    explorer: explorer ? `${explorer}/address/${address}` : null,
  };

  const dir = path.resolve(import.meta.dirname, '../deployments');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${networkName}.json`);
  fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`\n  recorded in  : deployments/${networkName}.json`);

  // --- Export the ABI for the server and client ------------------------
  // Copied out of artifacts/ explicitly, because artifacts/ is gitignored
  // generated output and the other workspaces must not reach into it.
  const artifact = JSON.parse(
    fs.readFileSync(
      path.resolve(import.meta.dirname, '../artifacts/contracts/InfraEscrow.sol/InfraEscrow.json'),
      'utf8'
    )
  );
  const abiDir = path.resolve(import.meta.dirname, '../abi');
  fs.mkdirSync(abiDir, { recursive: true });
  fs.writeFileSync(
    path.join(abiDir, 'InfraEscrow.json'),
    `${JSON.stringify({ contractName: 'InfraEscrow', abi: artifact.abi }, null, 2)}\n`
  );
  console.log('  ABI exported : abi/InfraEscrow.json');

  if (isLive) {
    line('=');
    console.log('  Next steps');
    line('=');
    console.log('  1. Verify on Etherscan:');
    console.log(`\n       npx hardhat verify --network ${networkName} ${address} ${admin}\n`);
    console.log('  2. Add to server/.env:');
    console.log(`\n       CONTRACT_ADDRESS=${address}\n`);
    console.log('  3. Add to client/.env:');
    console.log(`\n       VITE_CONTRACT_ADDRESS=${address}\n`);
    if (explorer) console.log(`  Explorer: ${explorer}/address/${address}`);
    line('=');
  }

  return record;
};

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n  Deployment failed:', err.message);
    if (/insufficient funds/i.test(err.message)) {
      console.error('  Hint: fund the deployer from a Sepolia faucet.');
    }
    if (/could not detect network|ECONNREFUSED|ENOTFOUND/i.test(err.message)) {
      console.error('  Hint: check SEPOLIA_RPC_URL in blockchain/.env.');
    }
    if (/invalid private key|invalid BytesLike/i.test(err.message)) {
      console.error('  Hint: PRIVATE_KEY must be 64 hex characters (0x prefix optional).');
    }
    process.exit(1);
  });
