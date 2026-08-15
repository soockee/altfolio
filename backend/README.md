# backend

Cloudflare Worker that exchanges a Battle.net authorization `code` for an
access token. Exists because that exchange needs `client_secret`, which
can't live in the static frontend.

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
