# altfolio

Minimal static app that does the browser-side half of Battle.net's OAuth
Authorization Code flow, deployable to GitHub Pages with no backend.

## Why "half"

Battle.net's `/oauth/token` endpoint requires a `client_secret` and doesn't
send CORS headers, so the authorization-code-for-token exchange can't happen
in browser JS — a secret embedded in a static site is public, and the
browser can't call the endpoint directly either way. This app handles
sending the user to Battle.net and capturing the `code` that comes back;
exchanging that code for a token needs a small server-side piece (a
Cloudflare Worker, Netlify/Vercel function, etc.) added later.

## 1. Enable GitHub Pages

Settings → Pages → Source: **Deploy from a branch** → Branch: **main**, folder **/ (root)** → Save.

Your URL:

    https://soockee.github.io/altfolio/

## 2. Register the OAuth client

In the [Battle.net Developer Portal](https://develop.battle.net/access/clients):

- Create a client (or edit yours).
- Add the URL above as a **Redirect URI** — must match exactly, including the trailing slash.
- Copy the **Client ID**.

## 3. Configure

Edit [oauth-config.js](oauth-config.js):

- `clientId` — from the developer portal.
- `region` — `us`, `eu`, `kr`, or `tw` (whichever your client targets).
- `scope` — `openid` for basic sign-in; add game-specific scopes (e.g. `wow.profile`) as needed.

Commit and push — GitHub Pages redeploys automatically.

## Local dev

    python3 -m http.server 8080

Battle.net requires HTTPS redirect URIs, so the full round trip (redirect
out and back with a `code`) only works once deployed to Pages or another
HTTPS host — the local server above is just for checking the page itself.
