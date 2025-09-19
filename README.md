AI Agent UI for Aster Futures
================================

Setup
-----

1. Copy `.env.example` to `.env.local` and fill values:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
OPENAI_API_KEY=
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=
NEXT_PUBLIC_ASTER_BASE_URL=https://api.aster.finance
```

2. Apply Supabase schema in `supabase.sql`.

3. Develop locally:

```
npm run dev
```

Notes
-----

This project includes a dark chat UI with quick actions, RainbowKit wallet connect, Supabase persistence, and an agent API that uses GPT‑5 tool-calling to query Aster public endpoints.

Per-user Aster trading credentials
---------------------------------

- Users provide their own Aster API credentials (from the Aster admin) and we store them per-wallet in Supabase under `public.aster_credentials` with Row-Level Security.
- Endpoints:
  - POST `/api/credentials` { wallet, apiKey, apiSecret, passphrase? } → upsert credentials
  - DELETE `/api/credentials` { wallet } → delete credentials
  - GET `/api/credentials?wallet=0x...` → returns `{ exists: boolean }`
- Order placement (`place_order` tool) first tries per-user credentials; if not found, it falls back to server env `ASTER_API_KEY`/`ASTER_API_SECRET` (useful for admin/testing), otherwise it returns a clear error.

Security notes
--------------
- RLS ensures only the owner (by wallet id) can access their own credentials. Ensure your Supabase service key is set on the server and not exposed to the client.
- Do not call `/api/credentials` from unauthenticated contexts in production without additional auth checks (e.g., Supabase Auth with wallets, signatures, or JWT).
