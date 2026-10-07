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

## Architecture

Three deployables and two external authorities. The database records *decisions*; the
contract records *money*. Where they disagree, the contract wins — and there is an explicit
path to make the database agree again.

```
                                ┌──────────────────────────┐
  Citizen ─┐                    │   Google Gemini Vision   │
           │                    │  relevance gate + cost   │
  Contractor ─┐                 │  estimate + work check   │
           │  │                 └────────────▲─────────────┘
  Admin ───┐  │                              │
         ┌─┴──┴──┴──┐    REST/JSON    ┌───────┴──────────────┐
         │  client  │ ──────────────▶ │       server         │
         │  React   │ ◀────────────── │   Express + Mongoose │
         │  Vite    │                 └───┬──────────────┬───┘
         └────┬─────┘                     │              │
              │                   ┌───────▼──────┐  ┌────▼─────────┐
              │                   │ MongoDB Atlas│  │  Cloudinary  │
              │                   │  decisions   │  │    images    │
              │                   └──────────────┘  └──────────────┘
              │
              │  unsigned tx ──▶ signed in MetaMask ──▶ broadcast
              │                                             │
              ▼                                             ▼
      ┌───────────────┐                        ┌──────────────────────┐
      │   MetaMask    │                        │  InfraEscrow.sol     │
      │ admin's key   │                        │  Ethereum Sepolia    │
      └───────────────┘                        │  holds the funds     │
                                               └──────────┬───────────┘
              server reads receipts & events ◀────────────┘
                     (verification + reconciliation)
```

### Layers, and what each may not do

The server is strictly layered, and the constraints are the point:

```
routes/        URL shape, middleware order, validation rules
controllers/   HTTP only — req/res in, status codes out.  Never touches Mongoose.
services/      all business rules and external calls.     Never touches req/res.
models/        schema, indexes, invariants
```

A controller that reached into a model would put business rules somewhere untestable; a
service that read `req` could not be called from a script or a test. Both are avoided
throughout.

`chain.service.js` is the **only** module that talks to Ethereum, and it holds no private
key. Every other module asks it for an unsigned transaction.

### Who holds the truth

| Fact | Authority | Why |
|---|---|---|
| Does this repair deserve payment? | Gemini, then a human admin | the AI is a gate, not the decision |
| How much is fair? | Gemini's frozen estimate range | snapshotted at publish so bids are judged against one number |
| Has the money moved? | the contract | the database can only *record* what the chain did |
| Who approved it? | the admin's wallet signature | an act by a named official, not by a server |

### Trust boundaries

- **The browser is not trusted** about anything on-chain. It reports a transaction hash;
  the server fetches the receipt and re-verifies the event, its emitter and its arguments
  before recording anything.
- **Role claims in a JWT are not trusted.** `authenticate` re-reads the user from MongoDB on
  every request, so a revoked admin loses access immediately rather than when their token
  expires.
- **The contract trusts only its owner** for releases, and has no withdraw function at all —
  so not even a fully compromised server can route escrowed funds anywhere but the awarded
  contractor.

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

# Create the first administrator (admin is never self-assignable via the API)
cd server && npm run create-admin -- --email you@example.com --password "yourpassword" --name "Your Name"
```

---

## Setup

Follow these in order. Steps 1–4 get the app running with **no external accounts at all**
(fixture mode); steps 5–8 connect the real services one at a time, so a failure is always
attributable to the thing you just added.

### Prerequisites

- Node.js **>= 18.18** (built and tested on v24)
- A MongoDB database — a free [Atlas](https://www.mongodb.com/cloud/atlas) cluster or a
  local `mongod`
- For the on-chain half: the **MetaMask** browser extension with a **Sepolia** account
  holding a little test ETH

### Accounts / API keys you will need

Nothing here costs money. Gemini, Cloudinary, Alchemy and Etherscan all have free tiers
sufficient for this project, and Sepolia ETH comes from a faucet.

| Service | Used for | Env var(s) | Where to get it |
| --- | --- | --- | --- |
| MongoDB Atlas | the database | `MONGO_URI`, `MONGO_DB_NAME` | https://www.mongodb.com/cloud/atlas |
| Google AI Studio | Gemini Vision — relevance, cost, work checks | `GEMINI_API_KEY` | https://aistudio.google.com/app/apikey |
| Cloudinary | image hosting | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | https://cloudinary.com |
| Google Cloud Console | OAuth 2.0 sign-in | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `VITE_GOOGLE_CLIENT_ID` | https://console.cloud.google.com/apis/credentials |
| Gmail App Password | sending notification email | `EMAIL_USER`, `EMAIL_PASS` | https://myaccount.google.com/apppasswords |
| Alchemy (or Infura) | Sepolia RPC endpoint | `SEPOLIA_RPC_URL` | https://alchemy.com · https://infura.io |
| Etherscan | contract verification | `ETHERSCAN_API_KEY` | https://etherscan.io/myapikey |
| MetaMask | the admin signs every payment | — (browser extension) | https://metamask.io |
| Sepolia faucet | test ETH for the admin wallet | — | https://sepoliafaucet.com |

> **`JWT_SECRET` is not from a service — you generate it.** Use
> `openssl rand -base64 48`. The server refuses to start on a secret under 32 characters
> or a known placeholder, because anyone who guesses it can forge a session token for any
> account, including an administrator.

---

### 1. Install

```bash
git clone <repo-url> openInfra
cd openInfra
npm install          # one install covers all three workspaces
```

### 2. Create the three env files

```bash
cp server/.env.example     server/.env
cp client/.env.example     client/.env
cp blockchain/.env.example blockchain/.env
```

### 3. Fill in the minimum to boot

Only two variables are required for the server to start. Everything else is a *feature
group*: it is reported as not ready at boot and fails only if you use it.

In `server/.env`:

```ini
MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/?retryWrites=true&w=majority
MONGO_DB_NAME=openinfra
JWT_SECRET=<paste the output of: openssl rand -base64 48>
```

> Set `MONGO_DB_NAME` explicitly. An Atlas URI with no database path makes Mongoose
> silently use a database called `test`, and your data appears to vanish.

Turn on fixture mode so nothing external is needed yet:

```ini
MOCK_EXTERNAL=true
```

### 4. Run it

```bash
npm run dev          # server on :5000, client on :5173
```

Check the server came up and see which integrations are live:

```bash
curl http://localhost:5000/api/health
```

Create the first administrator — the admin role is never self-assignable through the API,
so this script is the only way to make one:

```bash
npm run create-admin --workspace server -- \
  --email you@example.com --password "at-least-8-chars" --name "Your Name"
```

Open http://localhost:5173, register a citizen and a contractor through the UI, and sign in
as the admin. The whole flow works in fixture mode except the real on-chain steps.

---

### 5. Gemini and Cloudinary (real AI and uploads)

In `server/.env`, add the keys and turn fixture mode off:

```ini
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-2.5-flash
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
MOCK_EXTERNAL=false
```

The free Gemini tier allows a limited number of requests per day, and one citizen report
spends two (relevance, then cost). `MOCK_AI=true` keeps fixtures for the AI while leaving
real uploads on — see [Fixture mode](#fixture-mode-running-without-api-quota).

### 6. Google OAuth (optional)

Create an OAuth 2.0 Client ID, add
`http://localhost:5000/api/auth/google/callback` as an authorised redirect URI, then set
`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in `server/.env` and the **same client id** as
`VITE_GOOGLE_CLIENT_ID` in `client/.env`.

### 7. Email (optional)

Gmail needs an **App Password**, not your account password, and 2FA must be on. Set
`EMAIL_USER` and `EMAIL_PASS`. Leave them blank and email runs in **preview mode**: every
message is written to `server/.email-preview/` as HTML you can open in a browser, which is
the better way to check templates anyway. A failed send is never fatal — it is logged, and
never rolls back a payment or an on-chain action.

### 8. The smart contract

A contract is **already deployed and verified** on Sepolia, so you can point at it instead
of deploying your own:

```ini
# server/.env
CONTRACT_ADDRESS=0x0e1aDF967b3f6dCE355C8509B816F33356abeF3F
CONTRACT_DEPLOY_BLOCK=11851337
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/<your-key>
CHAIN_ID=11155111
```

```ini
# client/.env
# Hex, not decimal — the wallet APIs reject a decimal chain id.
VITE_CHAIN_ID=0xaa36a7
```

> Check the RPC host is **`eth-sepolia`**, not `eth-mainnet`. A mainnet URL with a Sepolia
> chain id pin fails confusingly, and it is an easy copy-paste mistake.

Releasing funds requires the wallet that **owns** that contract, which you will not have.
To run the on-chain half yourself, deploy your own:

```bash
cd blockchain

# The 63 unit tests run on the in-process chain and need no configuration at
# all — they work straight after `npm install`.
npm test

# Deploying does need blockchain/.env: SEPOLIA_RPC_URL, PRIVATE_KEY (a
# throwaway testnet key, never one holding real funds), and ETHERSCAN_API_KEY.
npm run deploy:sepolia          # prints the address and the deploy block
npm run verify:sepolia -- <address> <admin-address>
```

Put the new address and deploy block into `server/.env` and `client/.env`, then run
`npm run sync-abi --workspace server` if you changed the contract's interface.

The deploying account becomes the contract owner and is the only account that can release
funds. Import it into MetaMask and use it as your admin wallet.

### Running the on-chain flow

1. Sign in as the admin, connect MetaMask, and switch it to Sepolia.
2. Publish a report as a project, award it to a contractor, and define the milestones.
3. **Lock escrow funds** — MetaMask asks you to sign the deposit.
4. As the contractor, upload a progress photo for milestone 1.
5. As the admin, approve it — MetaMask asks you to sign the release.
6. Watch it appear on the public dashboard at `/transparency`, with a live Etherscan link.

---

## Deploying the frontend

The client is a single-page app, so the host has to serve `index.html` for paths
that are not real files — otherwise the server looks for a directory called
`auth/callback`, finds nothing, and returns its own 404. That breaks two things
that matter: refreshing any route, and the Google OAuth return, which lands on
`/auth/callback#token=…` as a fresh navigation rather than a client-side one.

`client/vercel.json` is what fixes it:

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

A catch-all looks alarming but is safe here, because Vercel resolves a request
in this order:

```
redirects  ->  filesystem  ->  rewrites  ->  404
```

The filesystem is checked **before** rewrites, so `/assets/index-a1b2c3.js` is
served as the real file and only unmatched paths ever reach the rewrite. The
build also emits absolute asset references (`/assets/…`, not `./assets/…`), so
`index.html` loads correctly even when served for a deep route like
`/transparency/projects/:id`.

The file deliberately sets **only** `rewrites`. Adding `buildCommand`,
`outputDirectory` or `framework` here would override the dashboard settings,
which matter in this repo: the Vercel root directory is `client`, while
`npm install` has to run at the repo root for the workspaces to resolve.

### One environment variable that must be set

`VITE_API_URL` has to be set in the Vercel project, to the **absolute** URL of
the deployed API (`https://your-api.example.com/api`).

It is not optional in production. The client falls back to a relative `/api`
when the variable is missing, and with the catch-all rewrite in place that
relative path resolves to `index.html` — so every API call would come back as
a page of HTML, and the app would fail with JSON parse errors that point
nowhere near the real cause.

Also set `VITE_GOOGLE_CLIENT_ID`, `VITE_CHAIN_ID` (**hex**, e.g. `0xaa36a7` — the
wallet APIs reject a decimal chain id) and `VITE_ETHERSCAN_BASE_URL`; every `VITE_*` value is compiled into the bundle and
is therefore public by definition, so none of them is a secret.

Two more things have to agree with the deployed origin, and neither lives in
this repo:

- the API's `CLIENT_URL`, which CORS and the OAuth redirect are built from
- the Google OAuth **authorised redirect URI**, which must list the deployed
  callback alongside the localhost one

---

## API reference

Every response uses one envelope, so the frontend never has to guess a payload shape.

**Success**
```json
{ "success": true, "message": "...", "data": { }, "meta": { } }
```

**Failure**
```json
{ "success": false, "message": "...", "code": "MACHINE_READABLE_CODE", "details": [ ] }
```

`details` appears on validation failures. `stack` is added for unexpected errors in
development only — never in production.

### Every endpoint at a glance

42 routes. "Access" is enforced by middleware on the route and, where ownership matters,
again in the service. Sample requests and responses for each are in the sections below.

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/health` | public | liveness, DB ping, which integrations are ready |
| GET | `/` | public | API banner and version |
| **Auth** | | | |
| POST | `/api/auth/register` | public | create a citizen or contractor account |
| POST | `/api/auth/login` | public | email + password, returns a JWT |
| POST | `/api/auth/logout` | public | client-side token discard |
| GET | `/api/auth/google` | public | begin Google OAuth |
| GET | `/api/auth/google/callback` | public | OAuth return; token in the URL **fragment** |
| GET | `/api/auth/me` | any signed in | the current user |
| PATCH | `/api/auth/wallet` | any signed in | set the caller's wallet address |
| GET | `/api/auth/users` | admin | list accounts |
| **Reports** | | | |
| POST | `/api/reports` | citizen | photo upload, AI relevance gate, cost estimate |
| GET | `/api/reports/mine` | any signed in | the caller's reports |
| GET | `/api/reports/mine/stats` | any signed in | the caller's report counts |
| GET | `/api/reports/:id` | owner or admin | one report (404 to anyone else) |
| DELETE | `/api/reports/:id` | owner | withdraw a pending or rejected report |
| **Projects** | | | |
| GET | `/api/projects` | any signed in | projects open for bidding |
| GET | `/api/projects/mine` | contractor | projects awarded to the caller |
| GET | `/api/projects/:id` | any signed in | one project |
| **Bids** | | | |
| POST | `/api/bids` | contractor | submit a bid; scored for anomaly on the way in |
| GET | `/api/bids/mine` | contractor | the caller's bids |
| PATCH | `/api/bids/:id/withdraw` | contractor | withdraw an undecided bid |
| **Milestones** | | | |
| GET | `/api/milestones/mine` | contractor | the caller's milestones across projects |
| POST | `/api/milestones/:id/progress` | contractor | progress photo, AI work verification |
| GET | `/api/milestones/project/:projectId` | assigned contractor or admin | full schedule and progress |
| **Admin** | | | |
| GET | `/api/admin/stats` | admin | dashboard counts |
| GET | `/api/admin/reports` | admin | the review queue |
| PATCH | `/api/admin/reports/:id/approve` | admin | approve a report |
| PATCH | `/api/admin/reports/:id/reject` | admin | reject with a reason |
| POST | `/api/admin/reports/:id/publish` | admin | publish as a project open for bids |
| GET | `/api/admin/projects/:id/bids` | admin | all bids, flagged ones marked |
| POST | `/api/admin/projects/:id/award` | admin | award and define the milestone schedule |
| POST | `/api/admin/projects/:id/lock-funds/prepare` | admin | unsigned deposit transaction |
| POST | `/api/admin/projects/:id/lock-funds/confirm` | admin | verify and record the deposit |
| POST | `/api/admin/projects/:id/sync-from-chain` | admin | reconcile the record from the contract |
| POST | `/api/admin/projects/:id/reconcile` | admin | alias of the above |
| GET | `/api/admin/milestones` | admin | the milestone review queue |
| POST | `/api/admin/milestones/:id/approve/prepare` | admin | unsigned release transaction |
| POST | `/api/admin/milestones/:id/approve/confirm` | admin | verify and record the payment |
| PATCH | `/api/admin/milestones/:id/reject` | admin | reject with a reason; contractor may resubmit |
| GET | `/api/admin/escrow-contract` | admin | contract address, live `owner()`, chain id |
| **Public — no login** | | | |
| GET | `/api/public/stats` | public | platform totals |
| GET | `/api/public/activity` | public | recent on-chain and off-chain activity |
| GET | `/api/public/projects` | public | every project, redacted |
| GET | `/api/public/projects/:id` | public | one project with milestones and bids |
| GET | `/api/public/projects/:id/verify` | public | compare the record against the chain live |

All `/api/public` routes are separately rate limited and pass every field through explicit
redaction — see [What is published, and what is not](#what-is-published-and-what-is-not).

### Error codes

| Status | Code | Meaning |
| --- | --- | --- |
| 400 | `BAD_REQUEST`, `MALFORMED_JSON`, `INVALID_ID` | Malformed or invalid input |
| 401 | `UNAUTHORIZED`, `INVALID_TOKEN`, `TOKEN_EXPIRED` | Not authenticated |
| 403 | `FORBIDDEN` | Authenticated, but the role may not do this |
| 404 | `NOT_FOUND`, `ROUTE_NOT_FOUND` | No such resource or route |
| 409 | `CONFLICT`, `DUPLICATE_KEY` | Conflicts with current state |
| 422 | `VALIDATION_FAILED` | Well-formed but semantically invalid |
| 429 | `RATE_LIMITED` | Too many requests |
| 503 | `SERVICE_UNAVAILABLE` | An upstream integration is down or unconfigured |

---

### `GET /api/health`

Liveness plus dependency check. Public, and exempt from rate limiting so uptime
monitors don't consume a user's budget. Returns **200** when the database answers a
ping, **503** when it does not.

**Request**
```http
GET /api/health
```

**Response — 200**
```json
{
  "success": true,
  "message": "OpenInfra API is healthy.",
  "data": {
    "status": "ok",
    "service": "openinfra-api",
    "environment": "development",
    "uptimeSeconds": 13,
    "timestamp": "2026-10-05T16:33:46.506Z",
    "database": {
      "status": "connected",
      "readyState": 1,
      "name": "openinfra",
      "host": "ac-vmfxnok-shard-00-02.zxtgt5u.mongodb.net",
      "pingMs": 51
    },
    "pendingIntegrations": ["Gemini", "Cloudinary", "Google OAuth", "Email", "Blockchain"]
  }
}
```

`pendingIntegrations` lists feature groups whose API keys are not yet set. It is a
development aid: the server boots without them, and only the service that needs a
missing key fails, with a `503 SERVICE_UNAVAILABLE` naming it.

**Response — 503 (database unreachable)**
```json
{
  "success": false,
  "message": "OpenInfra API is degraded.",
  "data": { "status": "degraded", "database": { "status": "disconnected", "pingMs": null } }
}
```

### `GET /`

Service banner. Public.

```json
{ "success": true, "message": "OpenInfra API", "data": { "docs": "/api/health", "version": "0.1.0" } }
```

---

## Authentication

All protected endpoints expect a bearer token:

```http
Authorization: Bearer <token>
```

Tokens are HS256 JWTs issued by this API (`iss: openinfra-api`), valid for `JWT_EXPIRES_IN`
(default 7 days). The payload carries `sub` (user id) and `role`. **The `role` claim is a
UI hint only** — the server re-reads the role from the database on every request, so editing
a token's claim or deactivating an account takes effect immediately rather than at expiry.

### Roles

| Role | Self-assignable at signup? |
| --- | --- |
| `citizen` | yes (default) |
| `contractor` | yes |
| `admin` | **no** — created only by `npm run create-admin` |

### `POST /api/auth/register`

Public. Rate limited (failures only).

```json
{
  "name": "Asha Citizen",
  "email": "asha@example.com",
  "password": "pothole2026",
  "role": "citizen",
  "walletAddress": "0x742d...f44e"
}
```

`role` and `walletAddress` are optional. Password must be 8–128 characters with at least one
letter and one number.

**201**
```json
{
  "success": true,
  "message": "Account created successfully.",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "user": {
      "id": "6ac3e283fd2b6c9f44e29a7f",
      "name": "Asha Citizen",
      "email": "asha@example.com",
      "role": "citizen",
      "walletAddress": null,
      "avatarUrl": null,
      "isActive": true,
      "lastLoginAt": null,
      "createdAt": "2026-10-05T17:46:43.234Z"
    }
  }
}
```

Errors: **422** validation (includes `role: "admin"`), **409** email already registered.

### `POST /api/auth/login`

Public. Rate limited (failures only).

```json
{ "email": "asha@example.com", "password": "pothole2026" }
```

**200** — same `{ token, user }` shape as register.

**401** — `"Incorrect email or password."` for both a wrong password *and* an unknown email,
so the endpoint cannot be used to discover which addresses have accounts.

### `POST /api/auth/logout`

Public. JWTs are stateless, so this only tells the client to discard its token.

### `GET /api/auth/me`

Requires a token. Returns `{ user }` for the token's own account.

### `PATCH /api/auth/wallet`

Requires a token. Sets the caller's Ethereum payout address.

```json
{ "walletAddress": "0x742D35CC6634C0532925A3B844BC454E4438F44E" }
```

Stored lowercased. **409** if another account already claims that address — two contractors
sharing one address would make an on-chain payout ambiguous to audit.

### `GET /api/auth/users`

**Admin only.** Paginated user directory.

Query: `?role=contractor&page=1&limit=20` (limit capped at 100).

```json
{
  "success": true,
  "message": "Users retrieved.",
  "data": { "users": [ ] },
  "meta": { "total": 7, "page": 1, "limit": 20, "pages": 1 }
}
```

**403** for any non-admin, with a message naming the required role.

### `GET /api/auth/google`

Public. Starts the OAuth handshake and redirects to Google.

Query: `?role=contractor` — the requested role rides along in the OAuth `state` parameter
and is applied when the account is first created. Anything other than `citizen` or
`contractor` is coerced to `citizen`.

**503** if `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are not configured.

### `GET /api/auth/google/callback`

Public. Google redirects here. Never returns JSON — always a redirect back to the SPA.

| Outcome | Redirect |
| --- | --- |
| Success | `{CLIENT_URL}/auth/callback#token=<jwt>&role=<role>` |
| Cancelled / failed | `{CLIENT_URL}/login?error=<message>` |

The token is returned in the URL **fragment**, not the query string. Fragments are never sent
to a server, keeping the token out of access logs, proxy logs and the `Referer` header. The
frontend reads `location.hash` and clears it with `history.replaceState`.

**Account linking:** if the Google email matches an existing local account, the Google
identity is attached to that account rather than creating a duplicate. The existing password
keeps working, and the existing role is preserved — signing in with `?role=contractor` cannot
change an established account's role.

---

## Reports

### `POST /api/reports`

**Citizen only.** `multipart/form-data`. Rate limited per user (AI + storage cost).

| Field | Required | Notes |
| --- | --- | --- |
| `image` | yes | JPEG, PNG, WebP or HEIC. Max `MAX_UPLOAD_MB` (default 10). |
| `description` | yes | 10–1000 characters. |
| `address` | yes | 3–300 characters. |
| `city` | no | |
| `latitude` / `longitude` | no | Decimal degrees. |

```bash
curl -X POST http://localhost:5000/api/reports   -H "Authorization: Bearer <token>"   -F image=@pothole.jpg   -F "description=Deep pothole in the carriageway, two-wheelers are swerving."   -F "address=14 MG Road, Bengaluru"   -F "city=Bengaluru" -F "latitude=12.9716" -F "longitude=77.5946"
```

The request returns **201 whether or not the AI accepts the photo** — a report document
was created either way, and the verdict is carried in `status`. Returning an error for
"this is not infrastructure" would conflate a client mistake with a judgement the system
made and recorded.

**201 — accepted** (`status: "pending"`)
```json
{
  "success": true,
  "message": "Report submitted. Our AI has estimated the repair cost and an official will review it shortly.",
  "data": {
    "report": {
      "id": "6ac3ebd3b429b13e1ae2329d",
      "status": "pending",
      "imageUrl": "https://res.cloudinary.com/.../openinfra/reports/abc123.jpg",
      "location": { "address": "14 MG Road, Bengaluru", "city": "Bengaluru", "latitude": 12.9716, "longitude": 77.5946 },
      "description": "Deep pothole in the carriageway...",
      "aiRelevanceResult": {
        "isRelevant": true,
        "category": "road_damage",
        "confidence": 1,
        "reason": "The image clearly shows a damaged public road surface.",
        "model": "gemini-2.5-flash",
        "latencyMs": 9120
      },
      "aiCostEstimate": {
        "amount": 10500,
        "minAmount": 7000,
        "maxAmount": 16000,
        "currency": "INR",
        "severity": "high",
        "observedIssue": "A large, deep pothole has formed in the asphalt carriageway...",
        "breakdown": [
          { "item": "Site preparation, cutting, and debris removal", "cost": 700 },
          { "item": "Hot mix asphalt (approx. 0.72 tons) and tack coat", "cost": 7350 },
          { "item": "Compaction, finishing, and equipment use", "cost": 750 },
          { "item": "Traffic management (cones, signage)", "cost": 500 },
          { "item": "Contingency and overheads", "cost": 1200 }
        ],
        "assumptions": ["Pothole dimensions assumed to be approximately 1.5m x 1m x 0.2m deep.", "..."],
        "confidence": 0.8,
        "model": "gemini-2.5-flash"
      },
      "rejectionSource": null,
      "rejectionReason": null,
      "createdAt": "2026-10-05T18:21:07.133Z"
    }
  }
}
```

**201 — auto-rejected** (`status: "rejected"`)
```json
{
  "success": true,
  "message": "We reviewed your photo but could not accept it as an infrastructure report.",
  "data": {
    "report": {
      "status": "rejected",
      "rejectionSource": "ai_relevance_gate",
      "rejectionReason": "This image shows a cat in a costume, which is not public civic infrastructure. Please submit photos of damaged roads, footpaths, or other public facilities.",
      "aiCostEstimate": null,
      "aiRelevanceResult": { "isRelevant": false, "category": "not_infrastructure", "confidence": 1 }
    }
  }
}
```

`aiCostEstimate` is `null` — never a fake zero — so no fictional benchmark can leak into
the bid-anomaly logic. The image is still stored, because the AI can be wrong and a citizen
appealing an auto-rejection needs the photo to exist.

Errors: **400** missing or non-image file · **422** field validation · **403** non-citizen ·
**503** Gemini or Cloudinary unavailable or unconfigured.

### `GET /api/reports/mine`

Requires a token. The caller's own reports, newest first.
Query: `?status=pending&page=1&limit=20`.

### `GET /api/reports/mine/stats`

Requires a token. Counts by status for the citizen dashboard.

```json
{ "data": { "stats": { "total": 4, "pending": 2, "approved": 0, "rejected": 2, "published": 0 } } }
```

### `GET /api/reports/:id`

Owner or admin only. Anyone else gets **404**, not 403 — confirming a report exists at an
id would leak that someone else filed one.

### `DELETE /api/reports/:id`

Owner only, and only while `pending` or `rejected`. An approved or published report is part
of a public record a bid or a funded project may reference, so deleting it returns **403**.
Deleting also removes the Cloudinary asset.

---

## Why the cost estimate is a range

`aiCostEstimate` stores three figures — `minAmount`, `amount` (expected) and `maxAmount` —
rather than one.

A photograph carries no measuring reference, so the model cannot pin down the damage's
physical size. Measured over six runs of an **identical** photo and description, a single
point estimate ranged from **₹3,000 to ₹14,000** (coefficient of variation ~60%). The model's
own `assumptions` showed exactly why: it re-guessed the pothole as anywhere from
"50 cm × 40 cm" to "1.8 m × 1.0 m" — a ~9× area difference, and cost follows area.

That spread is not noise to suppress; it is real uncertainty about scale, and a point
estimate merely hides it. It also broke the feature that depends on it: Phase 5 flags bids
more than 20% above the estimate, and a benchmark swinging 160% cannot support a 20%
threshold.

So the model is asked for what it actually knows — a plausible range under stated
assumptions — and **bid anomaly detection scores against `maxAmount`**:

```
flagged  ⟺  bid > maxAmount × (1 + ANOMALY_MARGIN_PERCENT/100)
```

| Band | Condition | Flagged? |
| --- | --- | --- |
| `none` | bid ≤ `maxAmount` | no |
| `elevated` | above `maxAmount`, within the margin | no — shown to the admin |
| `flagged` | past the threshold | **yes** |
| `severe` | more than 2× `maxAmount` | **yes** |

A flag therefore means *"this bid exceeds even the highest cost our assessment considered
plausible, by more than 20%"* — a claim the platform can defend to a contractor who disputes
it. It also fails safe: a wider range (more genuine uncertainty) produces **fewer**
accusations, not more.

Scoring lives in [`anomaly.service.js`](server/src/services/anomaly.service.js) as a pure
function with no I/O, and the margin is set by `ANOMALY_MARGIN_PERCENT` (default 20).

---

## Fixture mode (running without API quota)

The Gemini free tier allows **20 requests per day per model**, which a single test run can
exhaust. Both external integrations therefore have a deterministic fixture mode:

| Variable | Effect |
| --- | --- |
| `MOCK_EXTERNAL=true` | mock both Gemini and Cloudinary |
| `MOCK_AI=true` | mock Gemini only |
| `MOCK_UPLOADS=true` | mock Cloudinary only |

**`NODE_ENV=test` forces both on**, so `npm test` never spends quota and needs no
credentials — the suite runs on a fresh clone with no `.env` at all.

Fixture responses are keyed by the **SHA-256 of the image bytes**
([`__fixtures__/aiResponses.js`](server/src/services/__fixtures__/aiResponses.js)), so a test
picks its outcome by choosing which image in [`server/test/fixtures/`](server/test/fixtures/)
it uploads — no magic request fields. Unknown images fall back to a standard "relevant"
response. Mocked uploads return a stable fake Cloudinary URL derived from the same hash.

Only final phase verification hits the real APIs.

---

## Admin review & projects

All `/api/admin/*` routes require the **admin** role. The guard is applied once at the
router level, so a route added later cannot accidentally ship unprotected.

### `GET /api/admin/reports`

The review queue. Defaults to `status=pending`; pass `approved`, `rejected`, `published`
or `all` to audit — including what the AI rejected.

### `GET /api/admin/stats`

Counts for the dashboard header.

```json
{
  "data": { "stats": {
    "reports":  { "total": 6, "pending": 4, "approved": 0, "rejected": 2, "published": 0 },
    "projects": { "total": 2, "open": 2, "awarded": 0, "inProgress": 0, "completed": 0 }
  } }
}
```

### `PATCH /api/admin/reports/:id/approve`

Approves a report. **Also accepts an AI-rejected report** — the relevance gate is a filter,
not a verdict, and Phase 3 deliberately keeps the image so a wrong auto-rejection can be
overturned. An overturned report carries no AI estimate, so publishing it will require a
manual one.

Errors: **409** already approved or already published.

### `PATCH /api/admin/reports/:id/reject`

```json
{ "reason": "This street light is on private land and falls outside municipal responsibility." }
```

`reason` is required (10–500 chars) because it is shown verbatim to the citizen. Sets
`rejectionSource: "admin_review"`, keeping human decisions distinguishable from the AI gate.

### `POST /api/admin/reports/:id/publish`

Publishes an **approved** report as an open project. Body is optional:

| Field | Notes |
| --- | --- |
| `title` | defaults to a generated one, e.g. *"Road Damage repair — 14 MG Road, Bengaluru"* |
| `description` | defaults to the report's |
| `bidsCloseAt` | ISO 8601, must be in the future |
| `estimate` | `{ minAmount, amount, maxAmount }` — overrides the AI range |

`estimate` is **required** when the report has no AI estimate (the overturned-rejection
case); without a benchmark Phase 5 could not score any bid. Bounds must satisfy
`minAmount ≤ amount ≤ maxAmount` and `maxAmount > 0`.

**201**
```json
{
  "data": { "project": {
    "id": "6ac3f4de25f39e11c0f1a621",
    "title": "Road Damage repair — 14 MG Road, Bengaluru",
    "status": "open",
    "category": "road_damage",
    "aiEstimatedCost": {
      "minAmount": 7000, "amount": 10500, "maxAmount": 16000, "currency": "INR",
      "source": "ai_vision_estimate", "producedBy": "gemini-2.5-flash"
    },
    "biddingBenchmark": 16000,
    "isAcceptingBids": true,
    "totalLockedFunds": "0",
    "totalReleasedFunds": "0",
    "smartContractAddress": null,
    "awardedContractor": null
  } }
}
```

Errors: **409** report not approved / already published · **422** missing or invalid estimate.

**Publication is transactional.** Creating the Project and flipping the Report to
`published` happen together or not at all — a Project whose Report still read `approved`
would reappear in the review queue and could be published twice. A unique index on
`report` is the backstop.

**The estimate is copied onto the project, not referenced through it.** It is the benchmark
bids are judged against and the basis on which a contractor may be publicly flagged. Read
live, re-analysing the underlying report would retroactively change what bidders were
measured against. Freezing it at publication makes the record defensible after the fact.
`source` records whether the figure came from the AI or an admin override.

### `GET /api/projects`

Requires a token. Defaults to `status=open` — the contractor's board. Filters: `status`
(or `all`), `category`, `page`, `limit`.

### `GET /api/projects/mine`

Projects awarded to the calling contractor.

### `GET /api/projects/:id`

Requires a token. **404** if unknown.

> Escrow denominations (`totalLockedFunds`, `totalReleasedFunds`) are decimal **strings in
> wei**: `Number` cannot hold 1e18 safely and Mongoose has no native bigint, so the chain
> layer parses them with `BigInt()`.

---

## Bidding & anomaly detection

### `POST /api/bids`

**Contractor only.**

```json
{
  "projectId": "6ac3f4de25f39e11c0f1a621",
  "bidAmount": 14500,
  "proposal": "Full-depth patch with hot mix, two-day closure.",
  "estimatedDays": 3,
  "walletAddress": "0x742d...f44e"
}
```

`walletAddress` falls back to the account's. **One of the two is required** — milestone
funds are released to it on-chain, and discovering it missing after the escrow is funded
would strand the money.

A flagged bid is still **accepted (201)**. Flagging is a signal to the admin, not a
rejection: the contractor may know something the photo did not show, and refusing the
submission would hide that from the record. The response says so plainly, and the
contractor is told their bid was flagged.

**201**
```json
{
  "data": { "bid": {
    "id": "6ac3f778cda32cb3e1623f44",
    "bidAmount": 25600,
    "currency": "INR",
    "status": "pending",
    "isFlagged": true,
    "walletAddress": "0x742d...f44e",
    "anomaly": {
      "band": "flagged",
      "benchmarkAmount": 16000,
      "expectedAmount": 10500,
      "thresholdAmount": 19200,
      "marginPercent": 20,
      "deviationPercent": 60,
      "deviationFromExpectedPercent": 143.81,
      "basis": "max_estimate",
      "explanation": "Bid of INR 25,600 exceeds the upper assessed cost of INR 16,000 by 60%, beyond the 20% allowance (threshold INR 19,200)."
    }
  } }
}
```

The verdict is **frozen onto the bid**, not computed on read. A flag is an accusation with a
timestamp: the benchmark and margin that produced it must be preserved, or a later change to
either would silently rewrite history — and a contractor disputing a flag deserves to see the
exact figures used against them.

Errors: **400** no wallet · **404** unknown project · **409** project not open / deadline
passed / already has a live bid from this contractor · **403** citizen or admin, or bidding
on a project from your own report · **422** validation.

### `GET /api/bids/mine`

Contractor only. Their own bids, newest first. Filters: `status`, `page`, `limit`.

### `PATCH /api/bids/:id/withdraw`

Contractor only, own pending bid. **409** if accepted or already withdrawn. **404** for
someone else's bid — confirming it exists would leak a competitor's activity.

One live bid per contractor per project, enforced by a partial unique index on
`{project, contractor}` over `pending`/`accepted`. Withdrawing frees a resubmission;
stacking several pending bids to game the comparison is not possible.

### `GET /api/admin/projects/:id/bids`

**Admin only.** Every bid, sorted **flagged-first, then cheapest** — the admin's job is to
spot anomalies, so they lead; within each group the cheapest offer is the likeliest award.

```json
{
  "data": {
    "project": { "id": "...", "status": "open", "biddingBenchmark": 16000, "isAcceptingBids": true },
    "bids": [ ],
    "summary": { "total": 12, "live": 11, "flagged": 3, "lowest": 7000, "highest": 40000 }
  }
}
```

### `POST /api/admin/projects/:id/award`

**Admin only.**

```json
{ "bidId": "6ac3f778cda32cb3e1623f44" }
```

Sets the project to `awarded`, records `awardedContractor`, `awardedBid`, `awardedAmount`
and `awardedAt`, and rejects every other pending bid. Awarding a **flagged** bid is allowed —
an official may have good reason — but the response says so explicitly.

**Transactional.** The winning bid, every losing bid and the project must all move together:
a partial application would leave a project awarded with no accepted bid, or two accepted
bids on one project — and the next step locks real funds against this decision.

**No funds are locked here.** The escrow fields stay at their defaults
(`totalLockedFunds: "0"`, `smartContractAddress: null`) for Phase 6 to fill when the admin's
wallet actually deposits. The response carries a `nextStep` saying so.

Errors: **404** unknown project or bid · **400** bid belongs to another project · **409**
project not open / bid not pending / already awarded · **422** missing `bidId` or bid has no
payout wallet.

### Deviation scoring in practice

With a frozen estimate of **min 7,000 / expected 10,500 / max 16,000 INR** and the default
20% margin (threshold **19,200**):

| Bid | Band | Flagged |
| --- | --- | --- |
| 7,000 | `none` | no |
| 13,250 | `none` | no |
| 16,000 (at the bound) | `none` | no |
| 17,600 | `elevated` | no |
| 19,200 (at the threshold) | `elevated` | no |
| 19,201 | `flagged` | **yes** |
| 25,600 | `flagged` | **yes** |
| 40,000 (>2× bound) | `severe` | **yes** |

A bid of **13,125** is **+25% over the expected value** — a naive point-estimate rule would
flag it — but **−18% against the upper bound**, so it is clean. That false accusation is
exactly what scoring against the range avoids.

---

## Milestones, AI verification & fund release

### `POST /api/admin/projects/:id/award` (extended in Phase 7)

Award now carries the milestone schedule and the escrow amount:

```json
{
  "bidId": "6ac3f778cda32cb3e1623f44",
  "escrowAmountEth": "0.004",
  "milestones": [
    { "description": "Excavation, debris removal and base preparation", "fundPercentage": 30 },
    { "description": "Base layer laid and compacted", "fundPercentage": 45 },
    { "description": "Surface course, sealing and site reinstatement", "fundPercentage": 25 }
  ]
}
```

**Percentages must sum to 100%**, checked before anything is written. This is not
cosmetic: the escrow contract has no withdrawal function, so funds not allocated to a
milestone would be locked in it permanently. The error names the actual total.

Percentages are resolved to **exact wei** off-chain, with any rounding remainder pushed
onto the final milestone — the contract requires the shares to equal the deposit exactly.

The award commits first, then the escrow is funded. A chain call cannot be rolled back
into a database transaction, so a funding failure leaves the project `awarded` with its
schedule intact and `escrowError` set, rather than losing the decision.
`POST /api/admin/projects/:id/lock-funds` retries it.

On success the project becomes `in_progress` with `smartContractAddress`,
`onChainProjectId`, `fundingTxHash` and `totalLockedFunds` filled in.

### `POST /api/milestones/:id/progress`

**Contractor only**, own milestone. `multipart/form-data`: `image` plus an optional `note`.

Gemini sees **two** images — the original report photo and the progress photo — so it can
judge whether this is even the same site. Without that comparison a photo of any finished
road anywhere would pass.

Returns **200** either way; the outcome is in `status`:

| AI verdict | Status | Effect |
| --- | --- | --- |
| work complete, site matches | `submitted` | enters the admin queue |
| work incomplete | `ai_rejected` | never reaches the admin; contractor may resubmit |
| different site | `ai_rejected` | `matchesOriginalIssue: false` |

```json
{
  "data": { "milestone": {
    "status": "ai_rejected",
    "submissionCount": 2,
    "aiVerificationResult": {
      "looksComplete": false,
      "confidence": 0.84,
      "matchesOriginalIssue": true,
      "workQuality": "poor",
      "assessment": "The pothole has been partially filled but the surface is uneven and not compacted...",
      "concerns": ["Surface is not level with the surrounding carriageway.", "Fill material appears uncompacted."],
      "model": "gemini-2.5-flash"
    }
  } }
}
```

The prompt is deliberately sceptical, and says so: the contractor supplying the photo is
the party who gets paid if it passes, so a model that defaults to agreeable would make the
gate a formality.

### `POST /api/admin/milestones/:id/approve/prepare`

**Admin only.** Step 1 of two. Returns an **unsigned** transaction for the admin's MetaMask
to sign. The server holds no private key, so this is as far as it can take a payment on its
own. Nothing is written to the database — a prepared transaction the official never
approves must leave no trace.

Send the wallet that will sign, so the release is simulated as the real caller:

```json
{ "walletAddress": "0x7D28330Ef4918b5d6Ad37b0f95a00764F8c8CC34" }
```

```json
{
  "success": true,
  "message": "Transaction prepared. Sign it in your wallet to release the funds.",
  "data": {
    "transaction": {
      "to": "0x0e1aDF967b3f6dCE355C8509B816F33356abeF3F",
      "data": "0x6c3e4f21000000...",
      "value": "0x0"
    },
    "evidenceHash": "0xca19bad0aacb17658c0b76e45985cfc1193d2a55180123012d82567b9c809274",
    "milestone": {
      "id": "6ac493b17f7ea1f37629bd3f",
      "number": 1,
      "amountWei": "1200000000000000",
      "displayAmount": "0.0012 ETH"
    },
    "project": { "id": "6ac48fed7f7ea1f37629bc1c", "title": "Urgent work in Aurangabad" }
  }
}
```

The call is **simulated first** (`eth_call`), so an already-paid milestone is refused here
rather than after the official has approved a transaction that then reverts and costs them
gas for nothing. The simulation runs as the wallet that will sign: `releaseMilestone` is
`onlyOwner`, and a simulation with no caller is made by the zero address, which fails the
ownership check every time regardless of who is connected.

| Refusal | Status | Meaning |
|---|---|---|
| `MilestoneAlreadyReleased` | 409 | already paid on-chain; cannot be paid twice |
| `ProjectNotFunded` | 409 | the escrow was never funded |
| `MilestoneIndexOutOfRange` | 400 | no such milestone in the contract |
| `OwnableUnauthorizedAccount` | 403 | that wallet is not the contract owner |

A keccak256 hash of the approval record — progress photo, AI verdict, approving admin — is
written **on-chain** with the payment, so a citizen can check that a payout had a documented
basis. It deliberately contains no timestamp, because `prepare` and `confirm` must derive
the same hash and the official may take a minute to approve in MetaMask.

**Overriding the AI.** An AI rejection is a gate, not a verdict; the model can be wrong
about a sound repair (bad angle, poor light, unusual surface), and without an escape hatch
the contractor would be locked out of payment permanently. An admin may approve anyway:

```json
{
  "overrideAiRejection": true,
  "justification": "Site inspection confirms the carriageway has been properly reinstated.",
  "walletAddress": "0x7D28330Ef4918b5d6Ad37b0f95a00764F8c8CC34"
}
```

The justification is required (at least 20 characters), stored on the milestone, **and
hashed into the on-chain evidence** — so overruling the machine is a recorded act, not a
quiet click.

### `POST /api/admin/milestones/:id/approve/confirm`

**Admin only.** Step 2. Takes the hash MetaMask produced and records the payment — but only
after verifying it against the chain. The browser is not trusted to tell the truth about
what it broadcast.

```json
{ "transactionHash": "0x40aa4bfe2f8efca72cee560ec4fdf9a9affc4a6a2685e0cda72f769ee696f14e" }
```

```json
{
  "data": {
    "milestone": {
      "status": "paid",
      "transactionHash": "0x40aa4bfe...",
      "blockNumber": 11856564,
      "gasUsed": "146610"
    },
    "explorerUrl": "https://sepolia.etherscan.io/tx/0x40aa4bfe...",
    "projectCompleted": false,
    "project": { "status": "in_progress", "totalReleasedFunds": "1200000000000000" }
  }
}
```

The receipt must have succeeded **and** contain a `MilestoneReleased` event emitted by the
escrow contract for this project id, this milestone index, and this evidence hash. A hash
from an unrelated transaction, or from the release of a different milestone, is rejected
with **422**.

Verification is by **event emitter**, not by the transaction's recipient. A wallet may
legitimately reach the contract through another address: MetaMask's smart-account batching
(EIP-7702) routes the call through a delegation contract, so `receipt.to` is the smart
account and the escrow appears only as the emitter of the log. Filtering by emitter is also
strictly stronger than checking `to` — only the escrow can emit a log bearing its own
address, whereas a transaction *sent* to the escrow could revert in an inner call and emit
nothing at all.

A repeat confirmation of a payment already recorded is treated as a **retry, not an error**,
so a flaky connection cannot make a completed payment look like a failure. The hash is also
written to the milestone *before* verification begins — see
[Recovering from an interrupted confirmation](#recovering-from-an-interrupted-confirmation).

### `PATCH /api/admin/milestones/:id/reject`

**Admin only.** `{ "reason": "..." }` (10-500 chars, shown to the contractor, who may resubmit).

### Reads

| Endpoint | Who |
| --- | --- |
| `GET /api/admin/milestones` | admin review queue, defaults to `submitted` |
| `GET /api/milestones/mine` | the contractor's own |
| `GET /api/milestones/project/:projectId` | the trail for a project, with an Etherscan link per paid milestone |
| `POST /api/admin/projects/:id/reconcile` | re-sync the database against the chain |
| `GET /api/admin/escrow-wallet` | address and balance of the gas-paying wallet |

Reconciliation exists because the chain is the authority: a release can be mined after the
backend has given up on it, leaving a milestone stuck in `approving` while the contractor
has in fact been paid.

---

## Transaction signing

Every on-chain action is signed by **the admin's own MetaMask**. The server holds no private
key: `CHAIN_ADMIN_PRIVATE_KEY` existed during Phase 7, when there was no browser in the
loop, and was deleted in Phase 9.

Why that is the design and not a nicety:

- A server-held key means anyone who can read the server's environment — a logging mistake,
  a compromised dependency, a leaked backup — can release **every** milestone of **every**
  project immediately, paying for work never done. The contract's "admin can never
  withdraw" guarantee still holds, so funds can only ever reach the awarded contractor, but
  that is cold comfort.
- Every payment would become an act of *the platform* rather than of an identifiable
  official. The on-chain record showing which wallet approved a release **is** the
  accountability this project exists to provide, and it is undermined if the signature was
  produced by a web server reacting to an HTTP request.

See [Signing moved to MetaMask](#signing-moved-to-metamask) below for the
prepare → sign → confirm mechanics and the checks performed on the way back.

---

## Recovering from an interrupted confirmation

`prepare → sign → confirm` has a gap that no amount of care in the happy path removes: the
transaction is broadcast by the browser, and only the browser knows its hash until it tells
the server. Close the tab, lose the connection, or kill the laptop in that window and the
money has moved while the database never heard about it.

This happened during live testing, twice, in two different ways. Both are now handled.

**The hash is recorded before it is verified.** `confirm` used to verify for up to 120
seconds *before* writing anything, so an interruption destroyed the only copy of the hash.
A project now stores `pendingFundingTxHash`, and a milestone `pendingTxHash`, the instant the
browser reports it — clearly separate from the verified `fundingTxHash` / `transactionHash`
fields, so an unverified hash can never be mistaken for proof of payment on the public
record.

**Confirmation and preparation are both idempotent.** Re-confirming a payment already
recorded returns success rather than a 409, because a flaky connection should not make a
completed payment look like a failure. Preparing a deposit for a project already funded
on-chain reconciles instead of refusing — refusing left the project permanently stuck,
showing a "lock the funds" prompt that could never succeed.

### `POST /api/admin/projects/:id/sync-from-chain`

**Admin only.** Also available as `POST /api/admin/projects/:id/reconcile`.

Reads the escrow contract and corrects the local record to match. **One-way**: it never
writes on-chain, so it is always safe to press.

```json
{
  "success": true,
  "message": "Reconciled from the chain: 3 correction(s) applied.",
  "data": {
    "corrections": [
      {
        "milestone": 1,
        "from": "submitted",
        "to": "paid",
        "reason": "released on-chain in 0x40aa4bfe..."
      },
      {
        "field": "totalReleasedFunds",
        "from": "2800000000000000",
        "to": "4000000000000000",
        "reason": "read from the contract"
      },
      { "field": "status", "from": "in_progress", "to": "completed" }
    ]
  }
}
```

What it reconciles: a missing `onChainProjectId`, an unrecorded deposit, milestones released
on-chain but not locally, the released total, and the project status.

It corrects in **one direction only**. A milestone the database thinks is paid but the chain
says is not is the dangerous direction, so it is reported with `requiresAttention: true` and
logged as an error rather than silently "fixed".

**Recovering a lost hash.** The contract records `fundedAt` and `releasedAt` itself, so the
exact second is known. A binary search over block timestamps turns that into a block in
roughly fourteen cheap calls, and one narrow `eth_getLogs` window then finds the event.
Scanning from the deployment block is not an option — Alchemy's free tier caps a single
`eth_getLogs` at **ten blocks** (`RPC_LOG_WINDOW`), and estimating the block from an
off-chain timestamp proved to be hours out. If the log still cannot be found, a recorded
`pendingTxHash` is adopted, since the contract has already confirmed the payment happened.

**Completion follows the milestones, never the total.** The contract's own completion flag
tracks the released amount, so it flips as soon as the last wei leaves escrow — even if one
milestone's payment was never recorded. Treating that as sufficient would close the project
and strand that milestone, because an approval cannot be released against a completed
project. A project is marked completed only when **every** milestone reads paid, after each
has been reconciled against the chain; a contract reporting everything released while a
milestone reads unpaid is surfaced for attention instead.

---

## Smart contract

**`InfraEscrow`** — deployed and verified on Ethereum **Sepolia**.

| | |
| --- | --- |
| Address | [`0x0e1aDF967b3f6dCE355C8509B816F33356abeF3F`](https://sepolia.etherscan.io/address/0x0e1aDF967b3f6dCE355C8509B816F33356abeF3F) |
| Verified source | [Etherscan](https://sepolia.etherscan.io/address/0x0e1aDF967b3f6dCE355C8509B816F33356abeF3F#code) · also [Blockscout](https://eth-sepolia.blockscout.com/address/0x0e1aDF967b3f6dCE355C8509B816F33356abeF3F#code) and [Sourcify](https://sourcify.dev/server/repo-ui/11155111/0x0e1aDF967b3f6dCE355C8509B816F33356abeF3F) |
| Compiler | Solidity 0.8.28, optimizer on, 200 runs |
| Toolchain | Hardhat 3.18 |
| Tests | 63 passing |

### What it guarantees

| Guarantee | How |
| --- | --- |
| Only the admin can move money | `onlyOwner` on `createProject`, `lockFunds`, `releaseMilestone` |
| **The admin can never withdraw** | There is no withdraw/sweep/refund function, and no `receive`/`fallback`. The only exit is `releaseMilestone`, which pays the project's own contractor |
| A milestone can never be paid twice | Status set to `Released` *before* the transfer; a second attempt reverts `MilestoneAlreadyReleased` |
| Funds cannot leave before they arrive | `releaseMilestone` reverts `ProjectNotFunded` on an unfunded project, even when the contract holds other projects' ether |
| Milestone amounts always sum to the total | The total is **derived** from the milestone array, never supplied — true by construction. `lockFunds` then demands that exact amount |
| Reentrancy is safe | Checks-effects-interactions, plus `nonReentrant` |

### Functions

| Function | Access | Notes |
| --- | --- | --- |
| `createProject(offChainId, contractor, amounts[])` | admin | Declares a project; total derived from `amounts` |
| `lockFunds(projectId)` payable | admin | Requires **exactly** the total |
| `createAndFundProject(...)` payable | admin | Both in one transaction |
| `releaseMilestone(projectId, index, evidenceHash)` | admin | Pays the contractor; records the hash of the off-chain approval |
| `getProject` · `getMilestone` · `getMilestones` · `remainingFunds` · `isMilestoneReleased` · `isProjectComplete` · `projectIdForOffChainId` · `contractBalance` · `totalEscrowed` · `totalReleased` | public view | |

Events on every state change: `ProjectCreated`, `FundsLocked`, `MilestoneReleased`,
`ProjectCompleted` — so the whole money trail is reconstructable from logs alone.

### Design notes

**One registry, not one contract per project.** A contract per project would cost a
deployment every time and scatter the trail across dozens of addresses. One registry gives
the transparency dashboard a single permanent address and makes `totalEscrowed` meaningful.

**Amounts are wei, resolved off-chain.** Milestone percentages are converted to wei by the
backend before they reach the contract. Dividing a percentage on-chain would leave dust and
break the "milestones sum to the deposit" invariant.

**`evidenceHash`** ties each payout to the off-chain record that justified it (progress
photo, AI verdict, admin sign-off), so a citizen can check that a payment had a basis.

**Known limitation, accepted deliberately.** Because the admin can never withdraw, a project
abandoned part-way leaves its remaining funds locked in the contract forever. A production
system would want a time-locked dispute path (an arbitrator, or a refund unlockable after
prolonged inactivity). That is left out because any escape hatch weakens the core guarantee,
and designing one that cannot be abused is a bigger problem than this project needs to solve.

### Working with it

```bash
cd blockchain
npm run compile
npm test                  # 63 tests on the in-process chain
npm run balance           # deployer address + Sepolia balance
npm run deploy:sepolia
npm run verify:sepolia -- <address> <adminAddress>
npm run inspect           # live ledger and every project's milestones
npm run smoke             # live lock + release, prints Etherscan links
```

> **Use a throwaway wallet.** `PRIVATE_KEY` in `blockchain/.env` belongs to a testnet-only
> account. `hardhat.config.js` pins `chainId: 11155111`, so a mis-pointed RPC URL fails
> before any transaction is sent rather than deploying somewhere expensive.

---

## Tests

```bash
npm test                        # everything offline: 251 tests
npm run test:server             # 178 — node:test, no database required
npm run test:client             # 10  — chain-id notation, no framework
npm run test:chain              # 63  — Hardhat, in-process chain
npm run test:e2e                # 169 checks against the real API (needs MONGO_URI)
```

Neither suite needs a database, an API key or a network. `NODE_ENV=test` forces fixture
mode on, so a full run spends no Gemini quota and uploads nothing.

| Area | What is covered |
|---|---|
| `app`, `errors` | the response envelope, error mapping, CORS refusal as a clean 403 |
| `auth` | token signing and forgery, the role guard, self-assignable roles |
| `report` | status lifecycle, upload filtering, the AI gate's shape |
| `anomaly` | deviation scoring and its four bands, against the range's upper bound |
| `gemini-fixture` | fixtures keyed by image hash, so tests are deterministic |
| `project`, `bid` | publishing, the frozen estimate, bid rules, award transactionality |
| `milestone` | schedule validation, exact-sum splitting, wei arithmetic in BigInt |
| `email` | all 21 templates build, retry classification, failures stay non-fatal |
| `public` | per-field redaction — the tests exist so a leak fails the build |
| `desync` | the recovery path's schema and config, verification by event emitter |
| `security` | who may read full milestone records; the JWT secret guard |
| `InfraEscrow` | ownership, double-payment, sums, no-withdraw, reentrancy, batching |

### End-to-end

```bash
npm run test:e2e                # 169 checks against the real HTTP API
```

Separate from `npm test` on purpose: this one starts the actual Express app and
drives it over HTTP against a real MongoDB, which is the only way to exercise
middleware order, role guards, multipart uploads, validation and the service layer
*together*. It uses its own database (`openinfra_e2e`) and its own port, and drops
the database when it finishes, so it never touches development data.

It needs `MONGO_URI` and nothing else. Fixture mode is forced on, so no Gemini
quota is spent, nothing is uploaded, no email is sent and no transaction is
broadcast.

One complete lifecycle, plus the negative paths:

| Section | What it drives |
|---|---|
| 1 | citizen registers; report passes the AI gate with the expected range; admin role refused at registration |
| 2 | admin reviews, approves, publishes; the estimate is frozen onto the project |
| 3 | a reasonable bid and a 56%-over bid — the second flagged at the 19,200 threshold |
| 4 | award with a 30/45/25 schedule; a schedule not summing to 100% refused; escrow funded |
| 5 | three rounds of submit → AI verify → prepare → confirm → paid, then project completed |
| 6 | the public dashboard, redaction, payment proofs, verify-against-chain |
| 7 | an irrelevant photo rejected, with no cost estimate and a rejection email |
| 8 | half-done work rejected by the AI, then a justified admin override, surfaced publicly |
| 9 | every admin route refused to a citizen; forged tokens; cross-tenant reads as 404 |
| 10 | prompt injection in a description; XSS; NoSQL operators; malformed ids and hashes |

Both the unit suite and this run first verify the fixture images against the
SHA-256 digests in `test/fixtures/hashes.json`, and against the keys in
`aiResponses.js`. Responses are looked up by image hash and an unknown hash falls
back to a *passing* verdict, so a re-saved PNG would not turn the build red — it
would make the negative sections pass for the wrong reason. The check names the
file and the fix, and the end-to-end run aborts before executing a single check.

Emails are asserted by reading the preview directory fixture mode writes to. Note
the event names are dotted (`report.received`, not `reportReceived`) — asserting on
the camelCase function names silently matches nothing.

#### What it chooses not to claim

Five checks are reported as **skipped**, with the reason, rather than quietly
omitted:

- **wrong-wallet release** — `simulateRelease` short-circuits in fixture mode, so
  this cannot be exercised here. Verified against live Sepolia: the owner passes,
  a random address reverts `OwnableUnauthorizedAccount`.
- **a real MetaMask signature** — needs a browser and a funded key.
- **the Google OAuth round trip** — needs Google to redirect back.
- **real Gemini output** — the fixtures are canned by design.
- **real email delivery** — preview mode writes to disk instead of sending.

### What is *not* covered

Stated plainly, because a test count is misleading without it.

The three layers divide like this. The **unit suite** pins logic a refactor could silently
break — redaction rules, money arithmetic, role and ownership checks — and needs nothing
external. The **contract suite** pins the escrow's guarantees on a real EVM. The
**end-to-end run** drives registration, login, uploads, bidding, award, escrow and the full
milestone cycle through the real HTTP API against a real database.

What none of them touch is anything requiring a browser, a funded key or a live third party:
a real MetaMask signature, the Google OAuth redirect, genuine Gemini output, and actual email
delivery. Those were verified by running them during the phases that built them, and the
on-chain half is verifiable by anyone against Sepolia: project 3 of
[`0x0e1aDF96…eF3F`](https://sepolia.etherscan.io/address/0x0e1aDF967b3f6dCE355C8509B816F33356abeF3F)
holds a complete run — 0.004 ETH escrowed and three milestones released, each signed in
MetaMask. There is also no browser-level UI test: the frontend is checked by building it and
using it, not by assertion.

Three bugs found by testing rather than by reading are now regression-tested rather than
merely fixed: verification by event emitter, the participant guard on milestone reads, and
confirm-retry idempotency on a milestone payment.

---

## Build progress

- [x] **Phase 0** — Monorepo setup, git identity, `.gitignore`, `.env.example` files, tooling
- [x] **Phase 1** — Backend foundation (Express, Mongo, error handling, health check)
- [x] **Phase 2** — Authentication & roles (JWT + Google OAuth + RBAC)
- [x] **Phase 3** — Citizen reporting + Gemini relevance gate + cost estimate
- [x] **Phase 4** — Admin review & project publishing
- [x] **Phase 5** — Bidding + 20% anomaly detection
- [x] **Phase 6** — Solidity staged escrow on Sepolia
- [x] **Phase 7** — Milestones + AI verification + fund release
- [x] **Phase 8** — Consolidated notification service
- [x] **Phase 9** — React frontend
- [x] **Phase 10** — Public transparency dashboard
- [x] **Phase 11** — Polish, docs & tests

All eleven phases are complete, and the full flow has been exercised end to end against
live Sepolia: a real report, a real AI estimate, a real bid, a real escrow deposit, and
three real milestone payments signed in MetaMask and verified on Etherscan.

---

---

## Notifications

One service sends every email on the platform. The rest of the codebase calls a named
function per event and never touches a transport or a template:

```js
notify.milestoneApproved({ contractor, reporter, project, milestone, transactionHash, explorerUrl });
```

That shape landed in **Phase 3** with a stubbed body, so services have been calling it all
along. Phase 8 replaced exactly one function — `dispatch()` — rather than hunting through
five services for places that should have been sending mail.

```
notification.service.js   one named function per event (21 of them)
  └── dispatch()          the only thing that knows both halves exist
        ├── email/templates.js   event -> { html, text }
        └── email/transport.js   Nodemailer, preview mode, retry policy
              └── email/layout.js  shared blocks: tables, badges, buttons, proof panel
```

### The 21 events

| Phase | Events |
| --- | --- |
| 3 | `report.received` · `report.rejected` · `report.awaiting_review` |
| 4 | `report.approved` · `report.rejected_by_admin` · `project.published` · `project.open_for_bids` |
| 5 | `bid.submitted` · `bid.received` · `bid.flagged` · `project.awarded` · `bid.not_selected` · `project.awarded_reporter` |
| 7 | `escrow.funded` · `milestone.submitted` · `milestone.ai_rejected` · `milestone.rejected` · `milestone.paid.contractor` · `milestone.paid.citizen` · `project.completed.contractor` · `project.completed.citizen` |

A test scrapes the event names out of the notification service and asserts each one has a
template and each template has a sender — so adding a hook without a template fails the
build instead of reaching someone as a blank email.

### Email failures are never fatal

A notification is a side effect of something that has **already succeeded** — a filed
report, an awarded project, an on-chain payment. A dead mail server must not turn any of
those into a failure. Three layers enforce that:

1. Callers **do not await**. The citizen does not wait on Gmail to see their report was accepted.
2. Every dispatch is wrapped so a rejection can never escape. This matters specifically
   because `server.js` shuts down on an unhandled rejection — an unguarded mail error
   would turn a Gmail outage into an outage here.
3. Rendering is caught separately from delivery, so a template bug is loud in the logs
   but still invisible to the caller.

Verified by running the server with a deliberately wrong password: filing a report still
returned **201 in 245 ms**, the report persisted, and the failure was logged as
`Email 'report.received' ... could not be delivered`.

### Retry policy

Transient failures are retried with backoff; permanent ones are not. The decision is made
from the **SMTP response code** (4xx transient, 5xx permanent) and the Node error code —
deliberately not from a regex over the error text. An earlier version matched `/4\d\d/`
against the message, and Gmail's rejection embeds a session id like `5a478bee46e88-…` whose
"478" matched — so wrong credentials were retried three times, repeatedly presenting bad
logins to Gmail. That is how a sending account gets throttled.

### Preview mode

Gmail allows roughly 500 sends a day, and nobody wants 21 test emails in a real inbox.

| Variable | Effect |
| --- | --- |
| `MOCK_EMAIL=true` | render every email to `EMAIL_PREVIEW_DIR` (default `.email-preview/`) and send nothing |
| `MOCK_EXTERNAL=true` | the same, alongside the AI, upload and chain mocks |

**`NODE_ENV=test` forces it on**, so `npm test` needs no credentials and spends no quota.
Each preview writes a `.html` and a `.txt` file with the event, recipient and subject in a
header comment, so a file is self-describing when opened on its own.

### Template notes

- **Every email has a plain-text part.** Not decoration: a message with no text part is
  markedly more likely to be spam-filtered, and it is the version screen readers and
  watch notifications show. Tests assert both parts exist and that neither contains
  `undefined`, `NaN` or `[object Object]`.
- **Table-based with inline styles**, because that is what email clients actually render.
  Templates compose from shared builders in `layout.js` rather than writing markup, so one
  fix propagates everywhere.
- **All interpolated text is escaped.** Rejection reasons, AI assessments and contractor
  notes are user input that lands in HTML; a test fires `<script>` and `<img onerror>`
  payloads through a template and asserts no tag survives.
- **Wei renders as ETH with integer arithmetic**, never `Number` division.

### The payment email

The citizen's `milestone.paid.citizen` email is the one the whole project exists for. It
carries the Etherscan transaction link in **both** the HTML and the text part, shows the
exact ETH amount, and says plainly:

> You do not have to take our word for it — this record is public and we cannot alter it.

A transparency platform asserting "we paid them" is worth little. A link to a ledger it
does not control is the actual claim.

### Gmail setup

```bash
EMAIL_USER=you@gmail.com
EMAIL_PASS=abcd efgh ijkl mnop   # a 16-character App Password
```

2-Step Verification must be on before Google will issue an App Password
(https://myaccount.google.com/apppasswords). The transport **strips whitespace** from
`EMAIL_PASS` before authenticating, because Google displays the password in four groups
of four and pasting it verbatim otherwise fails with a misleading "Username and Password
not accepted".

Credentials are checked once at boot, so a bad password appears in the startup log rather
than silently swallowing a citizen's notification hours later. A failed check is a warning,
not a crash — the API works fine without email.

---

---

## Frontend

React 19 + Vite 8 + Tailwind 4, in `/client`.

```
src/
  components/   ui.jsx (primitives), Toaster, WalletButton, ThemeToggle, ProtectedRoute
  layouts/      PublicLayout, AuthLayout, DashboardLayout (role-driven sidebar)
  pages/        auth/ citizen/ contractor/ admin/ public/
  context/      Theme, Toast, Auth, Wallet
  services/     api.js — one axios client, one error-message policy
  hooks/        useFetch (loading / error / data / refetch), useAction
  lib/          constants.js (status vocabulary + tones), format.js
```

### Design

Teal/blue accent on neutral greys, with three semantic status colours used everywhere:
**green** approved and paid, **red** flagged and rejected, **amber** awaiting a decision. One
`STATUS_TONE` map in `lib/constants.js` drives every badge, so "approved" is the same green on a
report, a bid and a milestone.

- **Light and dark mode**, toggled and persisted to `localStorage`. An inline script in
  `index.html` applies the class before React boots, so a dark-mode user never sees a white
  flash. It follows the OS preference until the user makes an explicit choice.
- Card-based, generous whitespace, rounded corners, soft shadows, subtle hover lift.
- Inter via Google Fonts; sidebar on desktop, slide-over drawer on mobile.
- Toasts bottom-centre on phones (thumb reach) and top-right on desktop. On-chain
  confirmations get a longer-lived toast carrying the Etherscan link.
- `prefers-reduced-motion` disables every animation.

### The AI wait

Filing a report runs a Cloudinary upload and a Gemini vision call — 5 to 15 seconds. A bare
spinner for that long reads as broken, so both upload forms narrate the actual stages
("Uploading your photo…", "Checking it shows public infrastructure…", "Estimating a fair
repair cost…").

An AI rejection returns **HTTP 201** — the submission succeeded, the verdict was no. It is
presented as a considered answer with the model's own reason and advice on retaking the
photo, never as an error the citizen caused.

### Live anomaly feedback

The bid dialog shows the assessed range and the flag threshold, and updates the band as the
contractor types. Telling someone in advance that a figure will be flagged is fairer than
flagging it silently afterwards — and the copy says plainly that **a flag is not a
rejection**, which is what the backend actually does.

Flagged bids are rendered in red with a left border, sorted first, and the frozen verdict is
shown in full (bid, assessed upper bound, flag threshold, deviation) on both the admin screen
and the contractor’s own bid list.

---

## Signing moved to MetaMask

**`CHAIN_ADMIN_PRIVATE_KEY` is gone.** The server no longer holds a key and cannot send a
transaction. Phase 7 documented why that had to change:

- anyone who could read the server's environment could release every milestone of every
  project, paying for work never done;
- every payment was an act of *the platform* rather than of an identifiable official, which
  is precisely the accountability this project exists to provide.

### prepare -> sign -> confirm

| Step | Who | What |
| --- | --- | --- |
| 1. prepare | server | returns **unsigned** calldata. Writes nothing to the database. |
| 2. sign | the official's MetaMask | signs and broadcasts. The only way funds can move. |
| 3. confirm | server | verifies the hash **against the chain**, then records the payment. |

```http
POST /api/admin/projects/:id/lock-funds/prepare     -> { transaction, milestones }
POST /api/admin/projects/:id/lock-funds/confirm     { transactionHash }
POST /api/admin/milestones/:id/approve/prepare      -> { transaction, evidenceHash }
POST /api/admin/milestones/:id/approve/confirm      { transactionHash }
GET  /api/admin/escrow-contract                     -> { admin, contractAddress, chainId }
```

**Step 3 is the part that matters for integrity.** The browser is not trusted: a client could
post any hash it liked. So `confirm` fetches the receipt itself and refuses unless the
transaction

1. exists and was mined,
2. succeeded (`status === 1`),
3. emitted the expected event (`FundsLocked` / `MilestoneReleased`) **from our contract
   address** — the logs are filtered by emitter, not by where the transaction was sent, and
4. carries the right arguments — the specific `projectId`, `milestoneIndex` and
   `evidenceHash` being claimed.

A forged hash, an unrelated transaction, or a release of a *different* milestone is rejected
with a 422 and nothing is recorded.

Checking the emitter rather than `receipt.to` matters in both directions. A wallet can
legitimately reach the contract through another address — MetaMask's smart-account batching
routes the call through a delegation contract — so requiring `to` to be the escrow rejects
real payments. It is also the weaker test: a transaction *sent* to the escrow could revert in
an inner call and emit nothing, whereas only the escrow can emit a log bearing its own
address.

### Other safeguards

- **Simulated before the wallet opens.** `prepare` makes a static call first, so an
  already-paid milestone is refused before the official approves a transaction that would
  revert and cost them gas for nothing.
- **Wrong-wallet detection.** `GET /api/admin/escrow-contract` returns the contract’s owner,
  and the UI compares it with the connected account. An official on the wrong address is told
  before they sign, not after an `OwnableUnauthorizedAccount` revert.
- **Wrong-network refusal.** `sendPrepared` re-reads the chain id and refuses to sign off
  Sepolia, where the contract does not exist.
- **Stable evidence hash.** The approval record hashed on-chain deliberately excludes a
  timestamp, so prepare and confirm derive the same hash even if the official takes a minute
  in MetaMask.
- **A failed confirm never claims the money did not move.** If the broadcast succeeded but
  verification failed, the error says so and points at `Reconcile`, which re-syncs from the
  chain.
- **Award no longer funds.** Awarding records the decision; the escrow is locked in a separate
  wallet-signed step, so a project sits at `awarded` with its schedule intact until an
  official signs the deposit.

### What is recorded

`Project.fundedBy` and `Milestone.approvedByWallet` store the address that actually signed,
taken from the verified receipt rather than from anything the client said. That is the point
of the migration: the on-chain record now names a person’s own key, not a web server.

---

## Running the whole thing

```bash
npm install

# fill in the three .env files, then:
cd server && npm run create-admin -- --email you@example.com --password "yourpassword"

npm run dev        # API on :5000, client on :5173
```

Vite proxies `/api` to port 5000, so the browser makes same-origin requests and the Google
OAuth redirect works without CORS or cookie complications.

### Developing without API quota

The Gemini free tier allows 20 requests per day per model, which a single test run can
exhaust. Every external integration has a fixture mode:

```bash
MOCK_EXTERNAL=true npm run dev --workspace server   # mock AI, uploads, chain and email
```

Or individually: `MOCK_AI`, `MOCK_UPLOADS`, `MOCK_CHAIN`, `MOCK_EMAIL`. All are forced on
under `NODE_ENV=test`, so `npm test` needs no credentials at all.

---

---

## Public transparency dashboard

No login, no account, no API key. `/transparency` and
`/transparency/projects/:id` are the pages every link in the app and in every email
resolves to.

### Endpoints

| Endpoint | Returns |
| --- | --- |
| `GET /api/public/stats` | platform totals: funds locked and released, project and bid counts |
| `GET /api/public/activity` | recent on-chain money movements, newest first |
| `GET /api/public/projects` | project list with filters, search and sort |
| `GET /api/public/projects/:id` | one project: assessment, bids, milestones, payments |
| `GET /api/public/projects/:id/verify` | **live comparison against the chain** |

A separate router from `/api/projects` rather than an `optionalAuth` variant of it, because
the two have different audiences and must be able to diverge: the authenticated view shows a
contractor's email to an admin, and this one must never show it to anyone.

Reads are cached for 60 seconds (30 for activity) — these are the only endpoints a crawler or
a shared link can hammer, and the data changes on the order of minutes. `/verify` is
`no-store`: its entire value is freshness, so a cached "everything matches" would defeat it.
They also have their own rate limiter, since there is no login to throttle behind.

### What is published, and what is not

Every field is an explicit decision rather than a `.find()` with whatever the model holds. A
transparency platform that leaks personal data is a worse problem than an opaque one.

**Published**

- The project, its photo, location, status and dates.
- The AI cost assessment **in full, including its assumptions**. This is the benchmark bids
  are judged against; publishing the number while hiding the reasoning would be worse than
  publishing neither.
- Every milestone, its share, its AI verdict, and the transaction that paid it.
- The winning contractor's name and payout address. They won public money, and the address is
  already visible on-chain — concealing it here would be theatre.
- Every bid **amount** and its anomaly band, so the spread and the number flagged are visible.
- The admin wallet that signed each payment, taken from the verified receipt.
- When an official **overruled the AI**, with their written justification. That is exactly the
  kind of decision a transparency platform should surface rather than bury.

**Not published**

- Any email address, ever.
- The reporting citizen's full name. They are credited by **first name only**: reporting a
  pothole should not put your full name on a public ledger page alongside your neighbourhood.
- **Losing bidders' identities.** Their amounts and bands are published; their names are not.
  A losing contractor publicly labelled "flagged", with no process to contest it, is a
  reputational penalty the platform has no business imposing — the figure is the
  accountability, the name would just be punishment. The winner is named, because that is
  where the money went.
- Internal review notes, admin user ids, and rejection reasons on reports that never became
  projects.

These rules are unit-tested directly against the shaping functions, so a regression fails the
build rather than quietly leaking.

### Check it against the chain

The feature the dashboard exists for. Everything else on the page is this platform’s claim
about itself; `/verify` reads the escrow contract live and compares, field by field:

```
available: true | allMatch: false

  DIFFER  Total locked         ours=6000000000000000  chain=2000000000000000
  DIFFER  Total released       ours=6000000000000000  chain=1200000000000000
  DIFFER  Contractor address   ours=0xc7b7a4f5...     chain=0xd3b3b6ec...
  DIFFER  stage 2 paid         ours=true              chain=false
```

**When they disagree it says so.** The panel reports the mismatch and states that the chain
is authoritative, rather than showing the comfortable number. A dashboard that could only ever
say "verified" would be worthless.

Fetched on a deliberate click rather than on page load — it costs an RPC round trip, and
making the visitor ask the question is the more honest framing.

### Money arithmetic

Every wei total is summed with `BigInt` in application code, never with `$sum` in an
aggregation. Mongo would overflow a double on 1e18 values and silently return a wrong total —
on this page, worse than showing nothing. Wei also crosses the wire as a **string**, so no
precision is lost to JSON number parsing.

---

## Further reading

In [`docs/`](docs/):

- [`project-writeup.md`](docs/project-writeup.md) — the problem, the design, the
  architecture, and what the production bugs taught me. Includes what this
  project deliberately is *not*.
- [`demo-script.md`](docs/demo-script.md) — a two-minute walkthrough, shot by shot.
- [`resume-bullets.md`](docs/resume-bullets.md) — condensed for a CV, with the
  answers to the questions each bullet invites.

---

## Credits

Designed and built by **MD SHAHJAD KHAN**.
