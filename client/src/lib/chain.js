/**
 * Chain id notation.
 *
 * Deliberately free of `import.meta.env` and of anything else Vite-specific, so
 * these are plain functions that Node's test runner can import directly. The
 * environment reading lives in `constants.js`.
 */

/**
 * Normalise a chain id to the `0x`-prefixed lowercase hex form the wallet APIs
 * use.
 *
 * Both notations are in circulation for the same chain, and mixing them has
 * already cost a production outage: `VITE_CHAIN_ID` was deployed as `11155111`
 * — correct for ethers, server-side — rather than `0xaa36a7`, which is what
 * the browser wallet wants. `eth_chainId` returns hex per EIP-695, so the
 * comparison was `'0xaa36a7' === '11155111'`: permanently false. Every admin
 * was told they were on the wrong network while standing on Sepolia, the
 * switch button failed because EIP-3326 requires hex, and nothing could be
 * signed.
 *
 * Accepting either notation means that misconfiguration cannot recur, and hex
 * is what reaches the wallet however the value was set.
 *
 * @param {string|number|bigint|null|undefined} value
 * @returns {string|null} `0x…` lowercase, or null if it cannot be parsed
 */
export const toHexChainId = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return null;

  const raw = String(value).trim().toLowerCase();
  if (raw === '') return null;

  // Already hex. Re-rendered through BigInt so `0x0AA36A7`, `0XAA36A7` and
  // `0xaa36a7` all converge rather than differing by case or a leading zero.
  if (raw.startsWith('0x')) {
    if (!/^0x[0-9a-f]+$/.test(raw)) return null;
    return `0x${BigInt(raw).toString(16)}`;
  }

  if (/^\d+$/.test(raw)) return `0x${BigInt(raw).toString(16)}`;

  return null;
};

/**
 * Do two chain ids refer to the same chain, whichever notation each uses?
 *
 * Returns false when either side is unparseable — an unknown chain is never
 * treated as a match, because the consequence of a false positive is signing a
 * transaction against a chain where the contract does not exist.
 */
export const sameChain = (a, b) => {
  const left = toHexChainId(a);
  const right = toHexChainId(b);
  return left !== null && left === right;
};
