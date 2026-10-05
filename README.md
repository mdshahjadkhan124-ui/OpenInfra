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

# Create the first administrator (admin is never self-assignable via the API)
cd server && npm run create-admin -- --email you@example.com --password "yourpassword" --name "Your Name"
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

_Report, project, bid and milestone endpoints are documented as their phases land._

---

## Smart contract

<!-- Contract address, ABI notes, and design rationale land in Phase 6. -->

_Coming in Phase 6._

---

## Build progress

- [x] **Phase 0** — Monorepo setup, git identity, `.gitignore`, `.env.example` files, tooling
- [x] **Phase 1** — Backend foundation (Express, Mongo, error handling, health check)
- [x] **Phase 2** — Authentication & roles (JWT + Google OAuth + RBAC)
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
