# OpenInfra — making public infrastructure spending provable

**Built by MD SHAHJAD KHAN**

**Live frontend:** https://open-infra-nine.vercel.app
**Public dashboard (no login):** https://open-infra-nine.vercel.app/transparency
**API:** https://openinfra.onrender.com/api/health
**Escrow contract:** [`0x0e1aDF967b3f6dCE355C8509B816F33356abeF3F`](https://sepolia.etherscan.io/address/0x0e1aDF967b3f6dCE355C8509B816F33356abeF3F) (Ethereum Sepolia, verified)

---

## The problem

When a pothole gets fixed, a citizen has no way to answer three basic questions:
what was it supposed to cost, who was paid, and was the work actually done?

The information exists — in a procurement file, a contractor invoice, an
inspector's report — but it exists in places the public cannot reach, held by the
same parties it would indict. Asking citizens to trust the record is the whole
problem, and publishing a PDF does not fix it: a document can be edited, and
nobody can tell.

So the question I set out to answer was narrower and more tractable than
"corruption": **can you build a system where the public does not have to take
anyone's word for it?**

## The solution

OpenInfra puts the money itself somewhere nobody can quietly change it.

A citizen photographs a problem. AI screens the photo and estimates a fair repair
cost. An official publishes it for bidding, and every bid is automatically scored
against that estimate so outliers cannot pass unnoticed. On award, the budget is
locked into an Ethereum smart contract and released **milestone by milestone** —
each release requiring a progress photo, an AI verification, and a named
official's own wallet signature.

Every stage lands on a dashboard that needs no login, and every payment carries an
Etherscan link. The database records *decisions*; the contract records *money*.
Where they disagree, the contract wins — and there is an endpoint that reads the
chain live and reports the comparison, so a mismatch is visible to any citizen
rather than only to me.

### Key features

- **AI cost estimation as a range.** Gemini Vision returns min / expected / max
  with its assumptions, not a single figure. I measured roughly 60% variance
  across repeated runs on the *identical* photo before settling on this — a
  photograph has no measuring reference, so a confident point estimate is a
  fiction. Temperature 0 with a constrained response schema, so there is no prose
  to parse.
- **A relevance gate before anything else.** The first AI call simply asks whether
  the photo shows public infrastructure at all. A rejected photo never reaches the
  costing stage.
- **Anomaly detection on bids.** Each bid is scored against the *frozen* estimate
  ceiling — snapshotted at publication so bids are judged against one unchanging
  number — and banded. Anything beyond a configurable margin (default 20%) is
  flagged in red. The official still decides; the system only makes the outlier
  impossible to miss.
- **Staged escrow with no exit.** `InfraEscrow` has `lockFunds` and
  `releaseMilestone`, and **no withdraw, sweep or refund function of any kind**.
  Once funds are in, the only path out is to the awarded contractor, one milestone
  at a time. Milestone amounts must sum exactly to the deposit; a milestone can
  never be paid twice.
- **Milestone verification against the original.** The contractor's progress photo
  is compared with the original report photo — same site, work genuinely done —
  and the verdict is published with its confidence and concerns. An official may
  overrule a rejection, but only with a written justification that is hashed onto
  the chain alongside the payment. Overruling the machine is a recorded act.
- **Public verifiability.** Unauthenticated endpoints publish every project,
  milestone, bid and payment through explicit per-field redaction, and
  `/api/public/projects/:id/verify` compares the stored record against the live
  contract field by field.

## Architecture

```
  Citizen · Contractor · Admin
             │
      ┌──────▼───────┐   REST/JSON   ┌────────────────────┐
      │    client    │ ────────────▶ │       server       │────▶ Gemini Vision
      │ React 19     │ ◀──────────── │ Express + Mongoose │────▶ Cloudinary
      │ Vite · TW 4  │               └────┬───────────────┘────▶ MongoDB Atlas
      └──────┬───────┘                    │
             │  unsigned tx               │ reads receipts & events
             ▼                            ▼
       ┌───────────┐            ┌────────────────────┐
       │ MetaMask  │───signs───▶│  InfraEscrow.sol   │
       │ admin key │            │  Ethereum Sepolia  │
       └───────────┘            │  holds the funds   │
                                └────────────────────┘
```

An npm-workspaces monorepo with three deployables: `client`, `server`,
`blockchain`. The server is strictly layered and the constraints are the point —
controllers handle HTTP and never touch Mongoose; services hold the business
rules and never touch `req`/`res`. A controller reaching into a model would put
business logic somewhere untestable; a service reading `req` could not be called
from a script or a test.

`chain.service.js` is the **only** module that talks to Ethereum, and it holds no
private key.

### Who is trusted with what

| Fact | Authority | Why |
|---|---|---|
| Does this repair deserve payment? | AI, then a human | the AI is a gate, not the decision |
| What is a fair cost? | the frozen estimate range | one unchanging number to judge bids against |
| Has money moved? | **the contract** | the database can only *record* what the chain did |
| Who approved it? | the signing wallet | an act by a named official, not by a server |

**The browser is never trusted about anything on-chain.** It reports a
transaction hash; the server fetches the receipt itself and re-verifies the event,
its emitting address, and its arguments before recording anything.

**JWT role claims are never trusted either** — `authenticate` re-reads the user
from MongoDB on every request, so a revoked admin loses access immediately rather
than when their token expires.

### Stack

React 19 · Vite · Tailwind 4 · Express · MongoDB/Mongoose · JWT + Google OAuth ·
Google Gemini Vision · Cloudinary · Solidity 0.8.28 · Hardhat 3 · ethers v6 ·
Nodemailer · deployed on Vercel and Render

**251 automated tests** (178 server, 10 client, 63 contract) plus a **169-check
end-to-end suite** that drives the real HTTP API against a real database.

---

## What I learned

### Four of my bugs were a correct actor being told it was wrong

That pattern cost me more time than anything else, and I did not see it as a
pattern until the fourth one.

- **A contract simulation with no caller.** Releases are dry-run with `eth_call`
  before MetaMask opens, so an already-paid milestone cannot cost an official gas.
  That call passed no `from`, and an `eth_call` without one is made by the zero
  address — so an `onlyOwner` function failed its very first check, every time,
  for everyone. The revert was `OwnableUnauthorizedAccount(0x0)` and my error
  translator rendered it as *"the connected wallet is not the administrator"*,
  naming a wallet that had never been part of the call.
- **EIP-7702 smart-account batching.** Payment verification required the
  transaction's `to` to be the escrow. MetaMask routed a release through a
  delegation contract, so `to` was the smart account and the escrow appeared only
  as the *emitter* of the log. The funds moved, the contract emitted the event,
  and the platform refused to record it — a contractor paid on-chain and unpaid on
  the public ledger. Filtering logs by emitter is both correct for batching and
  *strictly stronger*: only our contract can emit a log bearing its own address,
  whereas a transaction sent to it could revert in an inner call and emit nothing.
- **A hex/decimal chain id.** `VITE_CHAIN_ID` was deployed as `11155111` —
  correct for ethers, server-side — instead of `0xaa36a7`. `eth_chainId` returns
  hex, so the network check was permanently false and no transaction could be
  signed in production.

The lesson I actually took: **test the rejection paths against a live chain
early.** Fixture mode cannot exercise them, so they are exactly where a confident
green test suite tells you nothing.

### A dry run that lies is worse than no dry run

Twice I "proved" a hypothesis wrong with a test that was quietly testing something
else. Hardhat's `ethers` plugin silently attaches the first configured account as a
default signer — so my "no `from`" probe was secretly "from = the owner" and
passed, which sent me chasing the wrong cause for hours.

Worse, I twice wrote a guard that could never run: an idempotency check placed
*after* the function that rejects the case it was meant to handle, and a weak-secret
list checked *after* a length floor that every entry already failed. Both read
correctly and did nothing. I now check whether a guard is **reachable**, not just
whether it is present — and I have tests asserting the ordering.

### Interruptible flows need a recoverable intermediate state

`prepare → sign → confirm` has a gap no amount of care in the happy path removes:
the browser broadcasts, and only the browser knows the hash until it tells the
server. Close the tab in that window and the money has moved while the database
never heard.

The fix was to record the hash *before* verifying it, clearly marked unverified,
and to make confirmation idempotent — a retry of a payment already recorded is a
retry, not a 409 telling an official their payment failed when it succeeded. Plus
a one-way chain→DB reconciliation that recovers a lost hash by binary-searching
block timestamps, because the free-tier RPC caps `eth_getLogs` at **ten blocks**
and estimating the block from an off-chain timestamp was hours out.

### "The credentials work" is not evidence that the thing works

A rotated image-storage key authenticated fine — a signed admin ping returned
`ok` — but was permission-scoped without `create`. Every upload returned 403, and
every citizen was told *"Please try again"*: a retry that could never succeed.
Failures are now classified by HTTP status, so a misconfiguration says so and
only genuinely transient failures invite a retry.

And deleting an image removed the stored asset while the CDN kept serving the
URL for thirty days. For a citizen who deletes their own report, that is the
difference between deleting a record and deleting a photograph.

### Precision is a correctness problem, not a style one

Wei values exceed `Number.MAX_SAFE_INTEGER`, so every total is summed with
`BigInt` and stored as a decimal string — never with MongoDB's `$sum`, which
silently overflows a double at 1e18. On a platform whose entire claim is "these
numbers are true", a rounding error is not cosmetic.

---

## What it is not

Worth stating plainly, because the honest limits are part of the engineering.

- It runs on **Sepolia testnet**, not mainnet. No real money has moved.
- The AI is a **gate and an aid**, not an authority. It is wrong often enough that
  the human override exists on purpose, and a photograph cannot actually measure a
  pothole.
- There is **no browser-level UI test suite**. The frontend is verified by building
  it and using it.
- A **single administrator wallet** is a centralisation point. The contract's
  no-withdraw guarantee bounds the damage — funds can only reach the awarded
  contractor — but a lost key would freeze a project's remaining escrow
  permanently. That trade-off is documented rather than hidden, and a multisig
  would be the obvious next step.

---

*Designed and built by **MD SHAHJAD KHAN**.*
