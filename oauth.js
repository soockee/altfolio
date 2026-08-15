// Battle.net OAuth "Authorization Code" flow.
//
// The redirect and callback happen here in the browser. The code -> token
// exchange is delegated to the backend/ Worker, since it requires
// client_secret and Battle.net's token endpoint doesn't send CORS headers.
(function () {
  const STATE_KEY = "bnet_oauth_state";
  const TOKEN_KEY = "bnet_access_token";

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

  async function exchangeCode(code) {
    const cfg = window.OAUTH_CONFIG;
    const res = await fetch(cfg.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });

    const tokens = await res.json();
    if (!res.ok) {
      throw new Error(tokens.error_description || tokens.error || "Token exchange failed");
    }

    sessionStorage.setItem(TOKEN_KEY, tokens.access_token);
    return tokens;
  }

  function getAccessToken() {
    return sessionStorage.getItem(TOKEN_KEY);
  }

  function logout() {
    sessionStorage.removeItem(TOKEN_KEY);
  }

  window.BnetAuth = { login, logout, parseCallback, exchangeCode, getAccessToken };
})();
