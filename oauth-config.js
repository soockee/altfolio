// Fill in clientId after creating an OAuth client at
// https://develop.battle.net/access/clients
window.OAUTH_CONFIG = {
  clientId: "61b0558e871b48c99121be11a892a87e",
  region: "eu", // us | eu | kr | tw
  scope: "openid wow.profile",
  redirectUri: window.location.origin + window.location.pathname,
  // Both served by the same Worker from `wrangler deploy` in backend/ — e.g.
  // "https://altfolio-oauth.<subdomain>.workers.dev"
  tokenEndpoint: "https://altfolio-oauth.gamingsockee.workers.dev/token",
  profileEndpoint: "https://altfolio-oauth.gamingsockee.workers.dev/profile",
};
