/**
 * Copy the contract ABI from the blockchain workspace into the server.
 *
 * Run after any redeploy that changes the contract interface:
 *   npm run sync-abi --workspace server
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, '../../blockchain/abi/InfraEscrow.json');
const target = path.resolve(here, '../src/services/__abi__/infraEscrow.js');

if (!fs.existsSync(source)) {
  console.error(`\n  Not found: ${source}`);
  console.error('  Deploy the contract first — the deploy script exports the ABI.\n');
  process.exit(1);
}

const { abi } = JSON.parse(fs.readFileSync(source, 'utf8'));

const header = `/**
 * InfraEscrow ABI.
 *
 * Generated from blockchain/abi/InfraEscrow.json, which the deploy script
 * exports. Copied in rather than imported across workspaces so the server has
 * no build-time dependency on the Hardhat project, and so a redeploy that
 * changes the interface is a visible diff here.
 *
 * Regenerate with:  npm run sync-abi --workspace server
 */
export const INFRA_ESCROW_ABI = `;

fs.writeFileSync(target, `${header}${JSON.stringify(abi, null, 2)};\n\nexport default INFRA_ESCROW_ABI;\n`);
console.log(`  ABI synced: ${abi.filter((e) => e.type === 'function').length} functions, ${abi.filter((e) => e.type === 'event').length} events`);
