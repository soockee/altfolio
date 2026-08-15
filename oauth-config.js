// Fill in clientId after creating an OAuth client at
// https://develop.battle.net/access/clients
window.OAUTH_CONFIG = {
  clientId: "61b0558e871b48c99121be11a892a87e",
  region: "eu", // us | eu | kr | tw
  scope: "openid",
  redirectUri: window.location.origin + window.location.pathname,
  // From `wrangler deploy` in backend/ — e.g.
  // "https://altfolio-oauth.<subdomain>.workers.dev/token"
  tokenEndpoint: "https://YOUR_WORKER.YOUR_SUBDOMAIN.workers.dev/token",
};
