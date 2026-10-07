# OpenInfra — two-minute demo script

A shot-by-shot walkthrough building to the money shot: an official signs a
milestone release in MetaMask, and the payment appears on a public dashboard
with a live Etherscan link that anyone can check.

**Live:**
- Frontend — https://open-infra-nine.vercel.app
- Public dashboard — https://open-infra-nine.vercel.app/transparency
- API — https://openinfra.onrender.com/api/health
- Contract — [`0x0e1aDF96…eF3F` on Sepolia](https://sepolia.etherscan.io/address/0x0e1aDF967b3f6dCE355C8509B816F33356abeF3F)

---

## Before you record

Four things, or the recording stalls halfway.

1. **Create a fresh project with an unpaid milestone.** The existing project is
   fully paid — all three milestones released — so there is nothing left to sign.
   Run one project through report → approve → publish → bid → award → lock funds
   → submit progress, and stop there. That leaves exactly one milestone
   *submitted* and waiting, which is the shot you are building to.
2. **Wake the API.** Render's free tier sleeps; the first request takes up to a
   minute. Load https://openinfra.onrender.com/api/health and wait for
   `"status":"ok"` before you start.
3. **MetaMask:** unlocked, on **Sepolia**, admin account
   `0x7D28330Ef4918b5d6Ad37b0f95a00764F8c8CC34` selected, with a little test ETH
   for gas. That wallet owns the contract and is the only one that can release.
4. **Have three tabs ready:** the admin milestone queue, the public dashboard,
   and an empty tab for Etherscan.

Record at 1920×1080, browser zoom 100%, and keep MetaMask's popup visible when
it appears — that popup is the whole point.

---

## 0:00 – 0:15 · The problem

**Screen:** the public dashboard, https://open-infra-nine.vercel.app/transparency

> "When a city repairs a road, citizens have no idea what it cost or whether the
> work was done. OpenInfra makes every stage of that provable. This dashboard
> needs no login — and every number on it can be checked against the blockchain."

Scroll once, slowly, past the project cards and the locked-versus-released
figures. Do not click yet.

---

## 0:15 – 0:35 · A citizen reports a problem, and AI prices it

**Screen:** the citizen report form, `/citizen/report`

> "A citizen photographs a pothole. Google Gemini Vision first checks the photo
> genuinely shows public infrastructure — that is a spam gate — then estimates a
> fair repair cost."

Upload the photo, submit, and let the AI spinner run.

> "It returns a *range*, not one number, because a photo has no measuring
> reference. The expected figure plus a plausible floor and ceiling, with the
> assumptions it made."

**Point at the range on screen.** If you have one, show an irrelevant photo
being rejected — it is a fast, convincing beat.

---

## 0:35 – 0:55 · Bidding, and the flagged bid

**Screen:** admin bid review, `/admin/projects`

> "An official publishes it for bidding. Contractors bid, and every bid is
> scored against the AI's upper bound. Anything more than twenty per cent above
> it is flagged automatically."

**Point at the red flagged bid.**

> "The official still has the final say — the system surfaces the outlier, it
> does not block it. Judgement stays with a person; the machine just makes the
> outlier impossible to miss."

---

## 0:55 – 1:15 · Funds locked in escrow

**Screen:** the awarded project card

> "On award, the budget is locked in an Ethereum smart contract, split across
> milestones. The contract has no withdraw function at all — once money is in,
> the only way out is to the awarded contractor, milestone by milestone. Not even
> the administrator can pull it back."

Show the "Escrow funded and locked on-chain" banner and the funding transaction
link.

---

## 1:15 – 1:35 · The contractor submits work, AI verifies it

**Screen:** contractor view, `/contractor/awarded`

> "The contractor uploads a progress photo. Gemini compares it against the
> original report — same site, work actually done — and gives a verdict with its
> confidence and any concerns."

Show the verdict.

> "If the AI rejects it, an official can still approve, but only with a written
> justification that gets hashed onto the blockchain. Overruling the machine is a
> recorded act, not a quiet click."

---

## 1:35 – 1:55 · ★ The money shot

**Screen:** admin milestone queue, `/admin/milestones`

> "Now the part that matters. The server holds no private key. It prepares the
> transaction, and the official signs it with their own wallet."

Click **Approve & release**. **MetaMask opens — pause here, let it breathe.**

> "This is a named official authorising public money from their own wallet, not
> a server doing it on their behalf."

Click **Confirm**. Let the confirmation spinner run.

> "The backend then re-reads the receipt from the chain before it records
> anything — it does not trust the browser's word that the payment happened."

**Switch to the public dashboard tab and refresh.** The milestone now reads
*paid*.

> "Same payment, now on the public record."

**Click the Etherscan link.** Let the real transaction load.

> "And there it is on Sepolia — the amount, the contractor's address, and a hash
> of the evidence that justified it. Anyone can verify this without asking me to
> be honest."

---

## 1:55 – 2:00 · Close

**Screen:** back to `/transparency`

> "React and Express, MongoDB, Gemini Vision, and a Solidity escrow contract on
> Ethereum. Every payment publicly provable. Built by MD SHAHJAD KHAN."

---

## If something goes wrong mid-take

| Problem | What is happening | Do this |
|---|---|---|
| "Wrong network" while on Sepolia | stale wallet state | reload the page; the chain check accepts either chain-id notation now |
| MetaMask never opens | wallet not connected, or not the admin account | reconnect, select `0x7D28330E…CC34` |
| Request hangs ~60s | Render cold start | wait; it only happens once |
| Milestone already paid | nothing left to release | you skipped the prep step — set up a fresh project |
| AI step errors | Gemini free-tier daily quota | demo the AI beats from an existing project instead |

## Shot list, if you prefer to edit rather than narrate live

1. Public dashboard, slow scroll — 10s
2. Report form, upload, AI range appearing — 20s
3. Bid table with the flagged row — 15s
4. Escrow locked banner — 15s
5. Contractor progress photo and AI verdict — 20s
6. **MetaMask signing popup** — 15s *(the one shot you cannot cut)*
7. Public dashboard refreshed, milestone paid — 10s
8. Etherscan transaction page — 10s
9. Title card — 5s
