// Battle.net OAuth "Authorization Code" flow — browser-side half only.
//
// Battle.net's token endpoint requires a client_secret and does not send
// CORS headers, so the code -> token exchange cannot happen here. This
// handles step 1 (redirect to Battle.net, get back an authorization code)
// and leaves the exchange to a server-side component added later.
(function () {
  const STATE_KEY = "bnet_oauth_state";

  function randomState() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  function authorizeUrl() {
    const cfg = window.OAUTH_CONFIG;
    const state = randomState();
    sessionStorage.setItem(STATE_KEY, state);

    const params = new URLSearchParams({
      response_type: "code",
      client_id: cfg.clientId,
      redirect_uri: cfg.redirectUri,
      scope: cfg.scope,
      state,
    });

    return `https://${cfg.region}.battle.net/oauth/authorize?${params}`;
  }

  function login() {
    window.location.assign(authorizeUrl());
  }

  function parseCallback() {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");
    if (!code && !error) return null;

    const expected = sessionStorage.getItem(STATE_KEY);
    sessionStorage.removeItem(STATE_KEY);
    window.history.replaceState({}, document.title, window.location.pathname);

    if (error) {
      return { error: url.searchParams.get("error_description") || error };
    }
    if (state !== expected) {
      return { error: "State mismatch — possible CSRF, discarding code." };
    }
    return { code };
  }

  window.BnetAuth = { login, parseCallback };
})();
