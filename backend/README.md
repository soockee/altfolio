# backend

Cloudflare Worker with two routes:

- `POST /token` — exchanges a Battle.net authorization `code` for an
  access token. Needs `client_secret`, which can't live in the static
  frontend.
- `GET /profile` — proxies the WoW Account Profile Summary
  (`api.blizzard.com`) using the caller's `Authorization: Bearer` header.
  Exists because that endpoint doesn't send CORS headers, so the browser
  can't call it directly.
- `GET /achievements?realm=<slug>&character=<name>` — proxies the WoW
  Character Achievements Summary for one character, same CORS reason as
  `/profile`. The frontend calls this once per character and reconstructs
  an activity-over-time view from the `completed_timestamp` on each
  achievement — there's no playtime or history endpoint in the Battle.net
  API, so this is the closest available signal.

## Setup

    cd backend
    npm install

Copy `.dev.vars.example` to `.dev.vars` and fill in your client secret (this
file is gitignored, never committed):

    cp .dev.vars.example .dev.vars

Edit [wrangler.jsonc](wrangler.jsonc):

- `vars.CLIENT_ID` — same client ID used in the frontend's `oauth-config.js`.
- `vars.REGION` — must match the frontend (`us`, `eu`, `kr`, or `tw`).
- `vars.REDIRECT_URI` — must exactly match the redirect URI registered with
  Battle.net and used by the frontend.
- `vars.ALLOWED_ORIGIN` — the origin the frontend is served from (already
  set to the GitHub Pages origin).

## Run locally

    npm run dev

## Deploy

    npx wrangler login   # first time only
    npm run deploy

Then push the real secret to Cloudflare (separate from `.dev.vars`, which is
local-only):

    npx wrangler secret put CLIENT_SECRET

`wrangler deploy` prints the Worker's URL, something like
`https://altfolio-oauth.<your-subdomain>.workers.dev`. Put
`<that-url>/token` into the frontend's `oauth-config.js` as `tokenEndpoint`.
