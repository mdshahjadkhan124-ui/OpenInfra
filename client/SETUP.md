# `/client` — React (Vite) + Tailwind

```
src/
  components/   reusable UI (buttons, cards, badges, modals, toasts)
  layouts/      shells: public, dashboard-with-sidebar
  pages/        route-level screens, grouped by role
  context/      auth, theme (light/dark), wallet
  hooks/        useAuth, useWallet, useTheme, data-fetching hooks
  services/     axios API client, ethers contract client
  lib/          formatters, constants, helpers
```

## Setup

```bash
cp .env.example .env     # fill in every value
npm install
npm run dev              # http://localhost:5173
```

## Notes

- Only variables prefixed `VITE_` reach the browser. Never put a secret in this `.env`.
- MetaMask must be set to the **Sepolia** test network; the app prompts for a switch
  using `VITE_CHAIN_ID`.
- The public transparency dashboard at `/transparency` requires no login.
