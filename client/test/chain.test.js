/**
 * Chain id notation.
 *
 * This exists because of a live outage. `VITE_CHAIN_ID` was deployed to Vercel
 * as `11155111` — the decimal form, which is what ethers wants server-side —
 * instead of `0xaa36a7`. `eth_chainId` returns hex (EIP-695), so the network
 * check compared `'0xaa36a7'` against `'11155111'` and was permanently false:
 * every admin was told they were on the wrong network while standing on
 * Sepolia, the switch button failed because `wallet_switchEthereumChain`
 * requires hex (EIP-3326), and no milestone could be released.
 *
 * Run with `npm test --workspace client`. No test framework: these are plain
 * functions with no Vite dependency, so node:test runs them directly.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { toHexChainId, sameChain } from '../src/lib/chain.js';

const SEPOLIA_HEX = '0xaa36a7';
const SEPOLIA_DEC = '11155111';

// ---------------------------------------------------------------------------
// The bug that happened
// ---------------------------------------------------------------------------

test('a decimal chain id matches the hex form the wallet reports', () => {
  // The exact comparison that was false in production.
  assert.equal(sameChain(SEPOLIA_HEX, SEPOLIA_DEC), true);
  assert.equal(sameChain(SEPOLIA_DEC, SEPOLIA_HEX), true);
});

test('a decimal configuration still yields hex for the wallet APIs', () => {
  // wallet_switchEthereumChain and wallet_addEthereumChain both reject a
  // decimal string, so whatever was configured has to leave here as hex.
  assert.equal(toHexChainId(SEPOLIA_DEC), SEPOLIA_HEX);
  assert.match(toHexChainId(SEPOLIA_DEC), /^0x[0-9a-f]+$/);
});

// ---------------------------------------------------------------------------
// Notation the same chain can arrive in
// ---------------------------------------------------------------------------

test('hex is normalised for case and leading zeros', () => {
  for (const form of ['0xaa36a7', '0xAA36A7', '0xAa36A7', '0x0aa36a7', '0x000aa36a7']) {
    assert.equal(toHexChainId(form), SEPOLIA_HEX, form);
    assert.equal(sameChain(form, SEPOLIA_HEX), true, form);
  }
});

test('surrounding whitespace does not break a match', () => {
  // An env var pasted with a trailing space is a very ordinary mistake.
  assert.equal(toHexChainId('  0xaa36a7  '), SEPOLIA_HEX);
  assert.equal(toHexChainId('\t11155111\n'), SEPOLIA_HEX);
  assert.equal(sameChain(' 11155111 ', '0xAA36A7'), true);
});

test('numbers and bigints are accepted, not just strings', () => {
  assert.equal(toHexChainId(11155111), SEPOLIA_HEX);
  assert.equal(toHexChainId(11155111n), SEPOLIA_HEX);
  assert.equal(sameChain(11155111, SEPOLIA_HEX), true);
});

// ---------------------------------------------------------------------------
// It must not match too eagerly
// ---------------------------------------------------------------------------

test('a different chain does not match Sepolia', () => {
  // Mainnet in both notations, and a couple of other live chains. A false
  // positive here means signing against a chain with no contract on it.
  for (const other of ['0x1', '1', '0x89', '137', '0xaa36a8', '11155112']) {
    assert.equal(sameChain(other, SEPOLIA_HEX), false, other);
  }
});

test('unparseable input is null, and never matches anything', () => {
  for (const junk of [null, undefined, '', '   ', 'sepolia', '0x', '0xzz', '1.5', '-1', '0x-1', true, false, {}, []]) {
    assert.equal(toHexChainId(junk), null, JSON.stringify(junk));
    assert.equal(sameChain(junk, SEPOLIA_HEX), false, JSON.stringify(junk));
    assert.equal(sameChain(SEPOLIA_HEX, junk), false, JSON.stringify(junk));
  }
});

test('two unparseable values do not match each other', () => {
  // Without the explicit null check, null === null would read as a match and a
  // wallet reporting nothing would look like it was on the right network.
  assert.equal(sameChain(null, null), false);
  assert.equal(sameChain(undefined, undefined), false);
  assert.equal(sameChain('nonsense', 'nonsense'), false);
});

// ---------------------------------------------------------------------------
// How the app actually uses it
// ---------------------------------------------------------------------------

test('a wallet on Sepolia reads as on-network however the app was configured', () => {
  // `onSepolia` in WalletContext, with the wallet always reporting hex and the
  // configured value arriving in either notation.
  const fromWallet = '0xaa36a7';
  for (const configured of [SEPOLIA_HEX, SEPOLIA_DEC, '0xAA36A7', ' 11155111 ']) {
    assert.equal(sameChain(fromWallet, configured), true, `configured as ${configured}`);
  }
});

test('a wallet on mainnet reads as off-network however the app was configured', () => {
  const fromWallet = '0x1';
  for (const configured of [SEPOLIA_HEX, SEPOLIA_DEC]) {
    assert.equal(sameChain(fromWallet, configured), false, `configured as ${configured}`);
  }
});
