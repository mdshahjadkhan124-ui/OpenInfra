# `/server` — Express API

Layered architecture. Dependencies point **downward only**:

```
routes/        HTTP surface: paths, middleware wiring, nothing else
  └── controllers/   parse request → call service → shape response
        └── services/    all business logic, AI calls, email, chain calls
              └── models/    Mongoose schemas
config/        env loading, db connection, third-party clients
middlewares/   auth (JWT), role guard, upload (Multer), error handler
utils/         custom error classes, async wrapper, validators
```

**Rule of thumb:** a controller never talks to Mongoose directly, and a service never
touches `req`/`res`. That keeps services reusable from scripts, jobs and tests.

## Setup

```bash
cp .env.example .env     # fill in every value
npm install
npm run dev              # nodemon, http://localhost:5000
```

Health check: `GET http://localhost:5000/api/health`

## Notes

- `EMAIL_PASS` must be a Gmail **App Password** (16 chars, no spaces), not your login password.
  App Passwords require 2-Step Verification to be enabled on the Google account.
- `MONGO_URI` for a local install is `mongodb://127.0.0.1:27017/openinfra`.
- `CONTRACT_ADDRESS` stays empty until the contract is deployed in Phase 6.
