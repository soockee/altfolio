# backend

Cloudflare Worker with six routes:

- `POST /token` — exchanges a Battle.net authorization `code` for an
  access token. Needs `client_secret`, which can't live in the static
  frontend.
- `GET /profile` — proxies the WoW Account Profile Summary
  (`api.blizzard.com`) using the caller's `Authorization: Bearer` header.
  Exists because that endpoint doesn't send CORS headers, so the browser
  can't call it directly.
- `GET /character?realm=<slug>&character=<name>` — proxies the WoW
  Character Profile Summary for one character. Read for
  `last_login_timestamp`, the only first-class "when was this played"
  field in the API.
- `GET /achievements?realm=<slug>&character=<name>` — proxies the WoW
  Character Achievements Summary for one character. The frontend calls
  this once per character and reconstructs a history from the
  `completed_timestamp` on each achievement — there's no playtime or
  character-creation-date endpoint in the Battle.net API, so this is the
  closest available signal.
- `GET /media/character?realm=<slug>&character=<name>` — proxies the same
  character's `character-media` sub-resource (Armory portrait renders).
  Same auth story as the two routes above: forwards the caller's own
  `wow.profile`-scoped bearer token.
- `GET /media/class?id=<classId>` — proxies the Game Data API's class icon
  (`/data/wow/media/playable-class/{id}`). Different from every other route
  here: this is public static data, not tied to any player, so the Worker
  mints and forwards its **own** `client_credentials` app token instead of
  the caller's, and caches successful responses at Cloudflare's edge for a
  day (`caches.default`, in `handleClassMedia`) since the artwork never
  changes.

The five `GET /profile`-namespace routes share one `proxy()` helper: they
differ only in the API path, and none of them inspects or stores the
caller's token — the Worker exists purely because `api.blizzard.com` sends
no CORS headers. `/media/class` can't reuse `proxy()`: it needs the
`static-<region>` namespace and the app's own token rather than the
caller's, so it's handled by `handleClassMedia` instead. See
[../docs/wow-art-resources.md](../docs/wow-art-resources.md) for why these
two media routes exist and how the frontend uses them.

There is no account-wide achievements endpoint to proxy. Account-wide
achievements surface through the per-character summary instead, reporting an
identical `completed_timestamp` on every character; the frontend separates
them out (see [activity.js](../activity.js)).

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
