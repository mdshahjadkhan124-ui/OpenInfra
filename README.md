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

_Milestone endpoints are documented as their phases land._

---

## Smart contract

<!-- Contract address, ABI notes, and design rationale land in Phase 6. -->

_Coming in Phase 6._

---

## Build progress

- [x] **Phase 0** — Monorepo setup, git identity, `.gitignore`, `.env.example` files, tooling
- [x] **Phase 1** — Backend foundation (Express, Mongo, error handling, health check)
- [x] **Phase 2** — Authentication & roles (JWT + Google OAuth + RBAC)
- [x] **Phase 3** — Citizen reporting + Gemini relevance gate + cost estimate
- [x] **Phase 4** — Admin review & project publishing
- [x] **Phase 5** — Bidding + 20% anomaly detection
- [ ] **Phase 6** — Solidity staged escrow on Sepolia
- [ ] **Phase 7** — Milestones + AI verification + fund release
- [ ] **Phase 8** — Consolidated notification service
- [ ] **Phase 9** — React frontend
- [ ] **Phase 10** — Public transparency dashboard
- [ ] **Phase 11** — Polish, docs & tests

---

## Credits

Designed and built by **MD SHAHJAD KHAN**.
