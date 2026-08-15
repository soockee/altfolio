# altfolio

Battle.net OAuth sign-in with no traditional server: a static frontend on
GitHub Pages plus a small Cloudflare Worker that holds the one thing the
frontend can't — the `client_secret`.

- `/` — static site: sends the user to Battle.net, receives the
  authorization `code`, and hands it to the Worker.
- `backend/` — Cloudflare Worker: exchanges that `code` for an access
  token using `client_secret` (Battle.net's token endpoint requires it and
  doesn't support CORS, so this step can't happen in the browser).

## Setup

### 1. GitHub Pages

Settings → Pages → Source: **Deploy from a branch** → Branch: **main**, folder **/ (root)** → Save.

Your frontend URL:

    https://soockee.github.io/altfolio/

### 2. Register the OAuth client

In the [Battle.net Developer Portal](https://develop.battle.net/access/clients):

- Create a client (or edit yours).
- Add the URL above as a **Redirect URI** — must match exactly, including the trailing slash.
- Copy the **Client ID** and **Client Secret**.

### 3. Deploy the Worker

See [backend/README.md](backend/README.md). You'll end up with a Worker URL
like `https://altfolio-oauth.<subdomain>.workers.dev`.

### 4. Configure the frontend

Edit [oauth-config.js](oauth-config.js):

- `clientId` — from the developer portal.
- `region` — `us`, `eu`, `kr`, or `tw` (whichever your client targets).
- `scope` — `openid` for basic sign-in; add game-specific scopes (e.g. `wow.profile`) as needed.
- `tokenEndpoint` — `<your Worker URL>/token`.

Commit and push — GitHub Pages redeploys automatically.

## Local dev

    python3 -m http.server 8080

Battle.net requires HTTPS redirect URIs, so the full round trip only works
once deployed to Pages (or another HTTPS host) — the local server above is
just for checking the page itself.
