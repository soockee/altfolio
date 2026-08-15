// Fill in clientId after creating an OAuth client at
// https://develop.battle.net/access/clients
window.OAUTH_CONFIG = {
  clientId: "YOUR_CLIENT_ID",
  region: "us", // us | eu | kr | tw
  scope: "openid",
  redirectUri: window.location.origin + window.location.pathname,
};
