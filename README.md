AI Agent for Aster Futures (Next.js + Supabase)
===============================================

Overview
--------

This project is a chat UI that lets users query Aster Futures public market data and perform signed trading actions via an AI agent. The agent uses OpenAI function calling to invoke Aster REST tools and persists chats/messages per wallet in Supabase.

What’s included
---------------

- Next.js App Router (edge runtime for APIs)
- Supabase persistence: `profiles`, `chats`, `messages` (plus per-user Aster credentials)
- Wallet connect (RainbowKit/WC) on the frontend
- AI agent endpoint that calls Aster public and signed endpoints
- Quick Actions for common market queries (price, depth, funding, klines)

Getting started
---------------

1) Configure environment

Create `.env.local` and set:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
OPENAI_API_KEY=
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=
NEXT_PUBLIC_ASTER_BASE_URL=https://fapi.asterdex.com

# Optional server-side fallback trading keys (admin/testing)
ASTER_API_KEY=
ASTER_API_SECRET=
ASTER_API_PASSPHRASE=
```

2) Prepare database

- Apply the SQL in `supabase.sql` to create tables and row-level security (RLS) policies for `profiles`, `chats`, `messages`. The file also defines policies that reference `public.aster_credentials` (expected columns: `user_id text primary key`, `api_key text`, `api_secret text`, `passphrase text null`). Ensure that table exists in your project or create it accordingly.

3) Run the app

```
npm install
npm run dev
```

Architecture
------------

- Agent orchestration: `src/app/api/agent/route.ts`
- Aster REST client: `src/lib/aster.ts` (public + signed v1/v3)
- Persistence helpers: `src/lib/supabase/*`
- Chat UI: `src/components/Chat.tsx`

Environment variables
---------------------

- `OPENAI_API_KEY` — required to run the agent.
- `NEXT_PUBLIC_ASTER_BASE_URL` — Aster REST base URL, default `https://fapi.asterdex.com`.
- `ASTER_API_KEY`, `ASTER_API_SECRET`, `ASTER_API_PASSPHRASE` — optional server fallback trading creds.
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase project.
- `SUPABASE_SERVICE_ROLE_KEY` — used on the server for persistence.
- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` — WalletConnect (RainbowKit).

Data model (Supabase)
---------------------

- `profiles(id text primary key, wallet text unique)`
- `chats(id uuid pk, user_id text fk→profiles, title text, created_at timestamptz)`
- `messages(id uuid pk, chat_id uuid fk→chats, role text, content text, created_at timestamptz)`
- `aster_credentials(user_id text pk, api_key text, api_secret text, passphrase text null)` — referenced by APIs/policies

RLS is enabled so that only the owner can access their chats/messages/credentials. Adjust policies to match your auth strategy.

API reference
-------------

All endpoints return JSON and most run on the edge runtime.

Auth (demo)
-----------

POST `/api/auth`

Request:

```json
{ "address": "0xYourWallet" }
```

Response:

```json
{ "user": { "id": "0xyourwallet", "wallet": "0xyourwallet", "created_at": "..." } }
```

Chats
-----

GET `/api/chats?wallet=0xYourWallet`

Response:

```json
{ "chats": [ { "id": "uuid", "title": "...", "created_at": "..." } ] }
```

Messages
--------

GET `/api/messages?chatId=uuid&wallet=0xYourWallet`

Response:

```json
{ "messages": [ { "id": "uuid", "role": "user|assistant", "content": "...", "created_at": "..." } ] }
```

Per‑user Aster credentials
--------------------------

POST `/api/credentials`

Request:

```json
{ "wallet": "0xYourWallet", "apiKey": "...", "apiSecret": "...", "passphrase": "optional" }
```

Response: `{ "ok": true }`

DELETE `/api/credentials`

Request:

```json
{ "wallet": "0xYourWallet" }
```

Response: `{ "ok": true }`

GET `/api/credentials?wallet=0xYourWallet`

Response: `{ "exists": true | false }`

Aster connectivity check
------------------------

POST `/api/aster/check`

Request (optional):

```json
{ "asterCredentials": { "apiKey": "...", "apiSecret": "...", "passphrase": "optional" } }
```

Response:

```json
{ "connectivity": { "ok": true }, "auth": { "ok": true } }
```

Agent endpoint
--------------

POST `/api/agent`

Request:

```json
{
  "messages": [
    { "role": "user", "content": "price btc" }
  ],
  "walletAddress": "0xYourWallet",            // optional, enables persistence
  "chatId": "uuid",                           // optional, appends to existing chat
  "asterCredentials": {                        // optional, ephemeral signed actions
    "apiKey": "...",
    "apiSecret": "...",
    "passphrase": "optional"
  }
}
```

Response:

```json
{ "message": { "role": "assistant", "content": "..." }, "chatId": "uuid-or-existing" }
```

Behavior
--------

- Uses OpenAI `gpt-4o` with tools for Aster public data and signed trading actions.
- If a request implies market/trade operations (buy/sell/leverage/etc.), the agent enforces tool calls.
- On tool responses, raw API JSON is appended to the assistant reply as an appendix for transparency.
- Persistence: when `walletAddress` is provided, the API ensures a `profiles` row, creates a `chats` row on first message, and appends `messages`.
- Canned responses (no network call) for these exact prompts:
  - "give me my last 24hour trading pnl on the platform"
  - "can you close all my open positions if bitcoin retraces 5% in the next 48 hours"

Trading credentials resolution
------------------------------

For signed tools (place/cancel/list orders, balances, positions, leverage/margin):

1) If `walletAddress` is provided and `public.aster_credentials` exists for that user, use it.
2) Else, if `asterCredentials` is sent in the request and they look valid, use them ephemerally (not persisted).
3) Else, if server env `ASTER_API_KEY`/`ASTER_API_SECRET` exist, use them (admin/testing).
4) Else, return a concise guidance error explaining how to provide keys.

Available tools (high level)
----------------------------

- Public: `get_markets`, `get_ticker`, `get_orderbook`, `get_time`, `ping`, `get_24h`, `get_book_ticker`, `get_funding_rate`, `get_klines`.
- Signed: `place_order`, `cancel_order`, `open_orders`, `get_balances`, `get_positions`, `set_leverage`, `set_margin_type`.

Aster client (`src/lib/aster.ts`)
---------------------------------

- Public wrappers call `/fapi/v1/*` endpoints and normalize common error messages.
- Signed client computes EVM-style signatures using `user`, `signer`, `nonce`, and the sorted params, then calls `/fapi/v1`/`/fapi/v3` endpoints.
- Credentials can be provided as either `{ user, signer, privateKey }` or back‑compat `{ apiKey, apiSecret, passphrase }` (where addresses/private key are derived when possible).

Security notes
--------------

- Keep `SUPABASE_SERVICE_ROLE_KEY` and trading keys on the server only.
- RLS is enforced for chats/messages and credentials; adapt policies to your auth method (JWT/custom claims/signatures).
- Do not expose signed Aster endpoints to unauthenticated users in production.

Example requests (curl)
-----------------------

Set credentials

```bash
curl -X POST http://localhost:3000/api/credentials \
  -H 'content-type: application/json' \
  -d '{
        "wallet": "0xYourWallet",
        "apiKey": "0xUserAddressOrKey",
        "apiSecret": "0xSignerAddressOrPrivateKey",
        "passphrase": "0xOptionalPrivateKey"
      }'
```

Ask for price via the agent

```bash
curl -X POST http://localhost:3000/api/agent \
  -H 'content-type: application/json' \
  -d '{
        "messages": [{"role":"user","content":"price btc"}],
        "walletAddress": "0xYourWallet"
      }'
```

List chats

```bash
curl 'http://localhost:3000/api/chats?wallet=0xYourWallet'
```

List messages in a chat

```bash
curl 'http://localhost:3000/api/messages?chatId=YOUR_UUID&wallet=0xYourWallet'
```

Troubleshooting
---------------

- "OPENAI_API_KEY is not set on the server" → add the key to your env.
- Network/403 errors to Aster → confirm `NEXT_PUBLIC_ASTER_BASE_URL` and HTTP method.
- Signed requests failing → verify that `user`, `signer`, and private key resolve correctly (see credentials resolution above).

