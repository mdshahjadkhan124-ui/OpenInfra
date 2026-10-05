# OpenInfra — AI-Powered Civic Infrastructure Transparency Platform

> Citizens report broken public infrastructure with a photo. Google Gemini judges whether the
> photo is genuinely civic and estimates a fair repair cost. Government admins publish the work,
> contractors bid on it, and the awarded funds sit in an Ethereum escrow contract that pays out
> **one milestone at a time**, only after the work is verified. Every rupee/wei of that money
> trail is publicly auditable on Etherscan — no login required.

**Author:** MD SHAHJAD KHAN · [mdshahjadkhan124@gmail.com](mailto:mdshahjadkhan124@gmail.com)
**License:** MIT

---

## Why this exists

Public works budgets are opaque. A citizen who reports a pothole has no way to learn what the
repair was priced at, who won the contract, whether the price was inflated, or whether the money
actually moved. OpenInfra closes that loop with three mechanisms:

| Problem | Mechanism |
| --- | --- |
| No independent price benchmark | Gemini Vision estimates a fair repair cost from the photo itself |
| Inflated bids pass unnoticed | Any bid **>20% above the AI estimate** is auto-flagged as an anomaly |
| No proof the money was spent as promised | Funds are escrowed on-chain and released per milestone, each payout a public Sepolia transaction |

---

## Monorepo layout

```
openInfra/
├── client/        React (Vite) + Tailwind + Ethers.js frontend
├── server/        Node + Express + Mongoose API  (routes → controllers → services → models)
├── blockchain/    Hardhat project: Solidity staged-escrow contract, tests, deploy scripts
├── package.json   npm workspaces root
└── README.md
```

Each folder has its own `SETUP.md` with folder-specific notes.

---

## Roles

| Role | Can do |
| --- | --- |
| **Citizen** | Report a problem with a photo, track their reports, view the public transparency trail |
| **Contractor** | Browse open projects, submit bids, upload milestone progress photos, receive on-chain payouts |
| **Admin / Government** | Review & approve reports, publish projects, review bids (flagged ones highlighted), award projects, define milestones, approve milestones to release escrowed funds |

---

## End-to-end flow

1. **Report** — Citizen uploads a photo + location + description.
2. **AI gate** — Gemini checks the image is genuinely civic infrastructure. If not → auto-reject + rejection email. Stop.
3. **AI pricing** — Gemini estimates a fair repair cost and assesses severity from the photo.
4. **Publish** — Admin reviews the report and publishes it as an open project.
5. **Bid** — Contractors bid. Bids >20% over the AI estimate are flagged red.
6. **Award + Lock** — Admin awards the project and defines milestones (percentages summing to 100%). Admin's MetaMask deposits the agreed Sepolia ETH into the escrow contract.
7. **Verify** — Contractor uploads progress photos per milestone → Gemini verifies the work looks complete → admin gives final approval.
8. **Release** — The contract pays that milestone's share to the contractor's wallet. A milestone can never be paid twice (enforced on-chain).
9. **Notify** — Emails fire at every event; milestone payout emails carry the Etherscan link so recipients can verify the money independently.

---

## Tech stack

| Layer | Choice |
| --- | --- |
| Frontend | React (Vite), Tailwind CSS, Ethers.js, MetaMask |
| Backend | Node.js, Express.js, layered architecture |
| Database | MongoDB + Mongoose |
| AI | Google Gemini Vision (relevance + cost estimate, and milestone verification) |
| Images | Cloudinary via Multer |
| Email | Nodemailer (Gmail) |
| Blockchain | Solidity on Ethereum **Sepolia**, built and deployed with Hardhat |
| Explorer | Etherscan |
| Auth | JWT (email/password) + Google OAuth 2.0 (Passport.js), role-based access control |

---

## Quick start

> Full, account-by-account setup instructions live in **[Setup](#setup)** below.
> This is the short version once your keys are in place.

```bash
git clone <repo-url> openInfra
cd openInfra
npm install                 # installs all three workspaces

cp server/.env.example     server/.env        # then fill in
cp blockchain/.env.example blockchain/.env    # then fill in
cp client/.env.example     client/.env        # then fill in

npm run dev                 # server on :5000, client on :5173
```

---

## Setup

<!-- Filled in progressively; completed in Phase 11. -->

### Prerequisites

- Node.js **>= 18.18** (built on v24)
- A MongoDB database (local `mongod`, or a free MongoDB Atlas cluster)
- MetaMask browser extension with a **Sepolia testnet** account funded from a faucet

### Accounts / API keys you will need

| Service | Used for | Where to get it |
| --- | --- | --- |
| MongoDB Atlas | Database | https://www.mongodb.com/cloud/atlas |
| Google AI Studio | Gemini Vision API key | https://aistudio.google.com/app/apikey |
| Cloudinary | Image hosting | https://cloudinary.com |
| Google Cloud Console | OAuth 2.0 Client ID/Secret | https://console.cloud.google.com/apis/credentials |
| Gmail App Password | Sending email | https://myaccount.google.com/apppasswords |
| Alchemy or Infura | Sepolia RPC URL | https://alchemy.com · https://infura.io |
| Etherscan | Contract verification API key | https://etherscan.io/myapikey |
| Sepolia faucet | Test ETH | https://sepoliafaucet.com |

---

## API reference

<!-- Documented endpoint-by-endpoint as phases land; consolidated in Phase 11. -->

_Coming in later phases._

---

## Smart contract

<!-- Contract address, ABI notes, and design rationale land in Phase 6. -->

_Coming in Phase 6._

---

## Build progress

- [x] **Phase 0** — Monorepo setup, git identity, `.gitignore`, `.env.example` files, tooling
- [ ] **Phase 1** — Backend foundation (Express, Mongo, error handling, health check)
- [ ] **Phase 2** — Authentication & roles (JWT + Google OAuth + RBAC)
- [ ] **Phase 3** — Citizen reporting + Gemini relevance gate + cost estimate
- [ ] **Phase 4** — Admin review & project publishing
- [ ] **Phase 5** — Bidding + 20% anomaly detection
- [ ] **Phase 6** — Solidity staged escrow on Sepolia
- [ ] **Phase 7** — Milestones + AI verification + fund release
- [ ] **Phase 8** — Consolidated notification service
- [ ] **Phase 9** — React frontend
- [ ] **Phase 10** — Public transparency dashboard
- [ ] **Phase 11** — Polish, docs & tests

---

## Credits

Designed and built by **MD SHAHJAD KHAN**.
