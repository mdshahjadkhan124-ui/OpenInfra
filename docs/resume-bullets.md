# Résumé bullets — OpenInfra

**MD SHAHJAD KHAN**

Live: https://open-infra-nine.vercel.app · API: https://openinfra.onrender.com ·
Contract: [`0x0e1aDF96…eF3F` on Sepolia](https://sepolia.etherscan.io/address/0x0e1aDF967b3f6dCE355C8509B816F33356abeF3F)

> **A note on wording.** These say *monorepo with a layered API and an on-chain
> settlement layer*, not *microservices*. The project is one Express service, one
> React SPA and one Solidity contract in an npm-workspaces monorepo — which is
> genuinely non-trivial distributed work across three trust domains, but it is
> not a microservice topology. An interviewer who asks "how do your services
> communicate?" would expose the word immediately, and the real architecture is
> impressive enough without it.

---

## The four-bullet version (recommended)

- **Architected and shipped OpenInfra**, a full-stack civic-infrastructure
  transparency platform — React 19/Vite SPA, layered Express/MongoDB API, and a
  Solidity 0.8.28 staged-escrow contract on Ethereum Sepolia — in an
  npm-workspaces monorepo with strict routes → controllers → services → models
  boundaries. **Deployed to production** (Vercel + Render) with a verified
  on-chain contract and **251 automated tests plus a 169-check end-to-end suite**
  driving the real HTTP API.

- **Designed the payment path so the server never holds a private key**:
  milestone releases use a prepare → sign → confirm flow where the backend emits
  unsigned calldata, the official signs in MetaMask, and the server
  re-verifies the on-chain receipt — matching the event's *emitter*, project id,
  milestone index and a keccak256 hash of the approval evidence — before
  recording payment. The escrow contract exposes **no withdraw function**, so
  locked funds can only ever reach the awarded contractor.

- **Diagnosed and fixed four production-only failures** that unit tests could not
  surface: an owner-only `eth_call` simulated with no `from`, which reverted as
  `OwnableUnauthorizedAccount(0x0)` and told the correct admin their wallet was
  wrong; **EIP-7702 smart-account batching**, where verifying by `receipt.to`
  rejected a genuine payment and left a contractor paid on-chain but unpaid on the
  public ledger; an on-chain/DB desync that destroyed the only copy of a
  transaction hash when a browser closed mid-confirm; and a hex-vs-decimal
  `chainId` mismatch that silently blocked every signature in production. Each
  fix shipped with a regression test.

- **Integrated Google Gemini Vision** as a two-stage gate — relevance screening,
  then a *ranged* cost estimate (min/expected/max at temperature 0 with a
  constrained response schema, after measuring ~60% variance on point estimates)
  — feeding an anomaly detector that flags bids exceeding the assessed ceiling by
  a configurable margin. Built recovery tooling that reconciles database state
  from chain events via **binary search over block timestamps**, working within a
  free-tier 10-block `eth_getLogs` limit.

---

## The three-bullet version (tighter)

- **Built and deployed OpenInfra** end to end — React 19 SPA, layered
  Express/MongoDB API, and a Solidity 0.8.28 escrow contract verified on Ethereum
  Sepolia — in an npm-workspaces monorepo. Funds are escrowed and released
  milestone-by-milestone after AI verification and human approval, with every
  payment publicly auditable on Etherscan. **251 automated tests + 169 end-to-end
  checks**; live at open-infra-nine.vercel.app.

- **Eliminated server-side custody of signing keys** by moving all on-chain
  authorisation to the administrator's MetaMask via prepare → sign → confirm,
  with server-side receipt verification keyed on the event's **emitter address**
  rather than the transaction recipient — the distinction that made payments
  through EIP-7702 smart-account batching verify correctly after they had been
  silently rejected in production.

- **Found and fixed four production-only bugs** through live diagnosis: a
  zero-address contract simulation blocking the legitimate admin, EIP-7702
  verification rejecting valid payments, an on-chain/DB desync that lost a
  transaction hash mid-confirm, and a hex/decimal `chainId` mismatch that blocked
  all signing. Built one-way chain→DB reconciliation (binary search over block
  timestamps within a 10-block `eth_getLogs` cap) and shipped a regression test
  with every fix.

---

## One-liner, for a profile headline

> Full-stack engineer — React, Node/Express, MongoDB, Solidity. Built and deployed
> a civic-infrastructure escrow platform where AI prices repairs, bids are scored
> for anomalies, and public funds are released milestone-by-milestone from an
> Ethereum contract with no withdraw function — every payment verifiable on-chain.

---

## Interview ammunition

Expect to be asked about these; each has a real, specific answer.

| If they ask | Lead with |
|---|---|
| "What was the hardest bug?" | EIP-7702. Verification required the transaction to be *sent to* the escrow, but MetaMask routed it through a delegation contract, so `receipt.to` was the smart account. The funds moved, the contract emitted the event, and the platform refused to record it. Filtering logs by **emitter** is both correct for batching and strictly stronger — only our contract can emit a log bearing its address, whereas a transaction sent to it could revert in an inner call and emit nothing. |
| "Why a cost *range*?" | A point estimate had roughly 60% coefficient of variation across repeated runs on the identical photo — a photo has no measuring reference. A range is honest about that, and bids get scored against the ceiling rather than a number the model cannot actually produce reliably. |
| "Why no server-side key?" | Anyone who could read the server's environment could release every milestone of every project. And the on-chain record naming *which wallet* approved a payment is the accountability the project exists to provide — it is worthless if a web server produced the signature. |
| "How do you know the database is right?" | You do not have to trust it. `GET /api/public/projects/:id/verify` reads the contract live and reports a field-by-field comparison, so a mismatch is visible to any citizen rather than only to me. |
| "What would you do differently?" | Three of the four production bugs were a correct actor being told it was wrong. I would test the *rejection* paths against a live chain much earlier — they are exactly what fixture mode cannot exercise. |
