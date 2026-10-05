# `/blockchain` — Hardhat + Solidity

The staged escrow contract that holds project funds and releases them milestone by milestone.

```
contracts/     Solidity sources
scripts/       deploy + helper scripts
test/          contract tests
```

## Setup

```bash
cp .env.example .env     # fill in every value
npm install
npm run compile
npm test                 # runs against the in-process Hardhat network
```

## Deploying to Sepolia

```bash
npm run deploy:sepolia
npm run verify:sepolia -- <deployed-address>
```

Then copy the deployed address into:
- `server/.env`  → `CONTRACT_ADDRESS`
- `client/.env`  → `VITE_CONTRACT_ADDRESS`

## Notes

- **Use a throwaway wallet.** `PRIVATE_KEY` belongs to a testnet-only account.
  Never put a key that controls real funds in a `.env` file.
- Fund the deployer with Sepolia ETH from a faucet before deploying.
- `artifacts/` and `cache/` are generated and gitignored; the ABI the server needs is
  copied out explicitly by the deploy script.
