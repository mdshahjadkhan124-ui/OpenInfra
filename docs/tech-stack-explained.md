# OpenInfra — every technology, in plain English

**MD SHAHJAD KHAN**

Written for a viva or interview: what each piece does, and why it is in *this*
project. Compiled by reading the three `package.json` files and the source, so the
list is what the code actually uses — not what a project like this usually uses.

> **One correction worth knowing before you are asked.** **Ethers.js is not used
> in the frontend.** It is listed in `client/package.json` but imported nowhere,
> and nothing from it appears in the built bundle. The browser talks to MetaMask
> directly through `window.ethereum.request(...)`, the standard wallet interface.
> Ethers *is* used on the **server** and in the **contract tests**. See
> [Unused leftovers](#unused-leftovers) — safest to delete the dependency.

---

## Frontend

| Technology | What it does | Why it is used here |
|---|---|---|
| **React 19** | Builds the interface out of reusable components that redraw themselves when data changes. | Four different dashboards (citizen, contractor, admin, public) share the same cards, badges and modals. |
| **Vite 8** | Development server and build tool: serves code instantly while coding, bundles it for production. | Starts in under a second and produces one small optimised bundle; also injects the `VITE_*` settings at build time. |
| **Tailwind CSS 4** | Styling by writing small utility classes directly in the markup instead of separate CSS files. | Light and dark mode stay consistent across every screen without maintaining a stylesheet that drifts. |
| **React Router 7** | Shows a different page for each URL without reloading the browser. | Gives real, shareable links like `/transparency/projects/:id` that a citizen can send to anyone. |
| **Axios** | Sends HTTP requests to the backend and handles the replies. | One place to attach the login token to every request and turn any server error into a readable message. |
| **MetaMask** | A browser wallet that holds the user's Ethereum account and signs transactions. | The administrator signs each payment themselves, so the server never holds a key that could move public money. |
| **`window.ethereum`** | The standard interface a wallet exposes to a web page (connect, read network, send transaction). | Used directly instead of a library — the app only needs four calls, so a full library would be dead weight. |
| **Node's built-in test runner** | Runs test files with no extra framework installed. | Ten tests cover chain-id handling; adding Jest or Vitest for that would be more setup than it is worth. |

## Backend

| Technology | What it does | Why it is used here |
|---|---|---|
| **Node.js** | Runs JavaScript on the server. | Same language as the frontend, so there is one mental model across the whole project. |
| **Express 4** | Web framework: maps URLs to functions and runs middleware in order. | Small and explicit; the request path reads top to bottom, which matters when security middleware must run in a fixed order. |
| **jsonwebtoken (JWT)** | Creates and checks a signed token that proves who a user is, so they do not resend their password. | Keeps the API stateless — no server-side sessions to store. The token is *checked* here, but the user's role is re-read from the database on every request, so a demoted admin loses access immediately. |
| **Passport + passport-google-oauth20** | Handles "Sign in with Google" — the redirect out, and the identity that comes back. | Lets citizens sign in without creating another password, using a well-tested library rather than hand-rolling OAuth. |
| **bcryptjs** | Turns a password into an irreversible hash, deliberately slowly. | Stolen database rows reveal no passwords. Cost factor 12 makes guessing expensive. (`bcryptjs` is the pure-JavaScript version — no compiler needed to install.) |
| **Multer** | Reads an uploaded file out of a form submission. | Configured for **memory** storage, so a stranger's photo is never written to the API server's disk — it goes straight to Gemini and Cloudinary. |
| **express-validator** | Checks and cleans incoming request data before any logic runs. | Rejects malformed input at the edge, which also blocks database-operator injection — `{"$gt":""}` where an email belongs fails here. |
| **validator** | The underlying library of individual checks (is this an email, an Ethereum address). | Used directly in the user model so the database enforces the same rules as the API. |
| **Helmet** | Sets protective HTTP response headers. | One line turns on sensible browser defences (no framing, no MIME sniffing, HSTS). |
| **CORS** | Decides which other websites may call this API from a browser. | Only the deployed frontend is allowed; any other origin is refused with a clean 403. |
| **express-rate-limit** | Caps how many requests one caller may make in a time window. | A global fair-use cap, plus a stricter one on login that counts **only failures** — so brute force is throttled but a legitimate user never is. |
| **Morgan** | Logs each HTTP request. | Shows what was called and how long it took, which is how slow AI and chain calls were spotted. |
| **compression** | Shrinks responses before sending them. | Project lists with long AI explanations get noticeably smaller. |
| **dotenv** | Loads settings from a `.env` file into the program. | Keeps keys and database URLs out of the code and out of git. |

## Database

| Technology | What it does | Why it is used here |
|---|---|---|
| **MongoDB** | A database that stores records as flexible documents rather than fixed table rows. | Reports, bids and milestones carry nested AI results whose shape differs per record; that fits a document naturally. |
| **Mongoose** | Adds a schema, validation and helper methods on top of MongoDB. | Gives the flexible database firm rules — required fields, allowed statuses, uniqueness — in one place. |
| **MongoDB Atlas** | MongoDB hosted in the cloud by MongoDB themselves. | No database to run or back up myself, and the deployed API can reach it. |
| **bcryptjs** | (see Backend) hashes passwords. | Runs automatically before every save, so no code path can store a plain password by mistake. |

### How money is stored, and why it is unusual

Ethereum amounts are in **wei** — the smallest unit, where 1 ETH is
1,000,000,000,000,000,000 wei.

That number is larger than JavaScript's ordinary numbers can hold exactly
(safe up to about 9,007,199,254,740,991). Storing wei as a normal number would
silently round it, and on a platform whose whole claim is "these figures are
true", a rounding error is a correctness bug.

So:

- **Stored as a text string** in MongoDB (`amountWei: "1200000000000000"`), because
  it is a precise quantity, not something to do arithmetic on in the database.
- **Added up with `BigInt`**, JavaScript's exact large-integer type, whenever
  totals are needed.
- **Never summed with MongoDB's `$sum`**, which would convert to a floating-point
  number and lose precision at these magnitudes.
- **Sent to the browser as a string too**, so it is not rounded in transit.

That is a good viva answer in one line: *wei exceeds the safe range of a normal
JavaScript number, so it is stored as a string and summed with BigInt.*

## AI

| Technology | What it does | Why it is used here |
|---|---|---|
| **Google Gemini Vision** (`@google/genai`) | Looks at an image and answers questions about it. | Three separate jobs below. Called with **temperature 0** and a **required response shape**, so it returns predictable data instead of prose to parse. |

**The three places it is used:**

1. **Relevance gate** — "does this photo actually show public infrastructure?"
   A spam filter. A photo that fails is rejected immediately and never costed.
2. **Cost estimate** — "what would this repair fairly cost?" Returns a **range**
   (lowest / expected / highest) plus its assumptions. A range, not one number,
   because a photo contains nothing to measure against; repeated runs on the same
   photo varied by roughly 60% when asked for a single figure.
3. **Milestone verification** — compares the contractor's progress photo against
   the original report photo: same place, work genuinely done? Returns a verdict,
   a confidence score and any concerns. An official can overrule a rejection, but
   only with a written justification that is recorded on the blockchain.

## Blockchain

| Technology | What it does | Why it is used here |
|---|---|---|
| **Solidity 0.8.28** | The language for writing programs that run on Ethereum. | The escrow rules are written as code nobody can later edit — including me. |
| **Ethereum Sepolia** | A free public test version of Ethereum, with valueless practice coins. | Proves the whole mechanism publicly without risking real money. |
| **Hardhat 3** | Developer toolkit for contracts: compile, test on a private in-memory chain, deploy. | 63 tests run instantly against a throwaway chain before anything touches the real network. |
| **OpenZeppelin Contracts** | Audited, community-reviewed building blocks for common contract needs. | `Ownable` (only the admin can release funds) and `ReentrancyGuard` (blocks a classic drain attack) — security code I should not be inventing myself. |
| **Ethers.js v6** | JavaScript library for talking to Ethereum: build calls, read events, decode data. | Used on the **server** to prepare unsigned transactions, verify receipts and read contract state — and in the contract tests. Not in the browser. |
| **MetaMask signing** | The admin's wallet approves each transaction. | The backend prepares the transaction, the human signs it, the backend then re-checks the result on-chain. The server holds **no private key**. |
| **Etherscan verification** | Publishes the contract's source code against its deployed address. | Anyone can read exactly what the contract does rather than trusting my description — the contract is verified as `InfraEscrow`, compiler 0.8.28. |
| **Chai / Mocha** | Test framework used by Hardhat for contract tests. | Comes with Hardhat's standard toolbox; writes readable assertions about contract behaviour. |

### The one contract guarantee worth memorising

`InfraEscrow` has **no withdraw, sweep or refund function of any kind**. Once funds
are locked, the only way out is `releaseMilestone`, which pays the awarded
contractor. Not even the administrator can take the money back. The trade-off,
stated honestly: a lost admin key freezes that project's remaining funds forever.

## Storage and email

| Technology | What it does | Why it is used here |
|---|---|---|
| **Cloudinary** | Stores and serves images from the cloud, and can transform them. | Photos must outlive a server restart and be fast to load. It also **strips EXIF data**, which would otherwise leak the reporter's GPS location and device, and caps size to 1600px. |
| **Nodemailer** | Sends email from Node.js. | One service handles all 21 notification events (report received, bid flagged, milestone paid, and so on). |
| **Gmail + App Password** | The actual mail account that sends the messages. | Free and sufficient for this scale. Uses a dedicated app password, never the real account password. Email failure is **never fatal** — it is logged and never undoes a payment. |

## Deployment

| Technology | What it does | Why it is used here |
|---|---|---|
| **Vercel** | Hosts the frontend and rebuilds it automatically on every git push. | Built for single-page apps; serves the site worldwide from a free tier. A small `vercel.json` makes every URL load the app so links and refreshes work. |
| **Render** | Hosts the backend Node server, redeploying on every git push. | Simplest free way to run a long-lived API. The free tier sleeps when idle, so the first request after a quiet spell takes up to a minute. |
| **GitHub** | Stores the code and triggers both deployments. | One `git push` updates the live site and the live API. |
| **npm workspaces** | Lets three projects (`client`, `server`, `blockchain`) live in one repository with one install. | Shared tooling and one command to test everything, without publishing packages. |
| **npm-run-all** | Runs several npm scripts, in parallel or in sequence. | `npm run dev` starts the frontend and backend together; `npm test` runs all three suites. |
| **Prettier** | Formats code automatically to one consistent style. | Removes formatting from code review entirely. |

---

## Technologies I do NOT use (and why people might assume I do)

Say these plainly. Claiming a technology you have not used is the fastest way to
lose credibility in a viva, and each of these has a sound reason for its absence.

| Technology | Status | What to say |
|---|---|---|
| **Redis** | **Not used.** | Redis is an in-memory store for caching and sessions. Not needed: authentication uses stateless JWTs, so there are no sessions to store, and rate limiting uses in-process counters. Adding Redis would be a second database to run for no present benefit. *If asked what would need it:* rate limiting across more than one server instance. |
| **Docker** | **Not used.** | Docker packages an app with its environment so it runs identically anywhere. Not needed: Vercel and Render build directly from the GitHub repository, and the only local requirement is Node.js. *If asked:* it would matter for self-hosting or for giving every developer an identical environment. |
| **TypeScript** | **Not used.** The project is plain JavaScript (ES modules). | TypeScript adds compile-time type checking. I used JSDoc comments and runtime validation (`express-validator`, Mongoose schemas) instead, which catch bad *data* — the actual risk here — rather than bad types. *Honest reflection:* on a codebase this size TypeScript would genuinely have helped, especially around wei values and AI response shapes. |
| **Microservices** | **Not used.** This is a **monorepo**, not microservices. | Microservices mean many small independently deployed services talking over a network. This is **one** Express API, **one** React app and **one** smart contract, kept in one repository with npm workspaces. The API is internally *layered* (routes → controllers → services → models) with enforced boundaries, which is good structure — but it is a single service. *Correct phrasing:* "a monorepo with a layered API and an on-chain settlement layer." |

### Also commonly assumed, also absent

| Technology | Status | What to say |
|---|---|---|
| **Next.js** | Not used. | Plain React with Vite. There is no server-side rendering; the public dashboard is rendered in the browser. |
| **Redux / Zustand** | Not used. | React's own Context handles the little shared state there is (auth, wallet, theme). A state library would be more machinery than the problem needs. |
| **GraphQL** | Not used. | A plain REST API with a consistent JSON envelope. |
| **Jest / Vitest** | Not used for JavaScript. | Node's built-in test runner for the API and the frontend; Mocha and Chai (via Hardhat) for the contract. |
| **WebSockets / Socket.io** | Not used. | No live push. Pages fetch when opened; nothing here needs sub-second updates. |
| **Kubernetes / CI pipelines** | Not used. | Vercel and Render deploy straight from GitHub. There is no GitHub Actions workflow. |
| **IPFS** | Not used. | Images are on Cloudinary. Only a *hash* of the approval evidence goes on-chain, not the files. |
| **Hardware wallet / multisig** | Not used. | A single MetaMask account owns the contract. A multisig would be the obvious next step for real funds. |

### Unused leftovers

Honest housekeeping, in case someone reads `package.json` closely:

- **`ethers` in `client/package.json`** — declared but imported nowhere in the
  frontend, and absent from the built bundle. The browser uses `window.ethereum`
  directly. Safe to remove with `npm uninstall ethers --workspace client`.

---

## The whole stack in four sentences

A **React** app talks to an **Express** API over HTTP. The API stores decisions in
**MongoDB**, images in **Cloudinary**, and asks **Gemini Vision** to judge photos.
Money lives in a **Solidity** contract on **Ethereum Sepolia**, and only the
administrator's **MetaMask** can release it — the server never holds a key. The
frontend runs on **Vercel**, the API on **Render**, and anyone can check the
figures against the blockchain without trusting either.

---

*Compiled by **MD SHAHJAD KHAN** from the project source.*
