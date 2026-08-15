// Exchanges a Battle.net authorization code for an access token, and proxies
// WoW profile reads.
//
// Both have to live server-side: the token exchange requires client_secret,
// and neither Battle.net's token endpoint nor api.blizzard.com send CORS
// headers for browser calls.
export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/token") {
      return handleToken(request, env, cors);
    }

    if (request.method === "GET") {
      // The WoW Account Profile Summary — the list of the signed-in user's
      // characters across their linked WoW accounts, with class/race/faction/
      // level per character. Requires the `wow.profile` OAuth scope.
      if (url.pathname === "/profile") {
        return proxy(request, env, cors, "/profile/user/wow");
      }

      // Both per-character reads take the same realm/character pair.
      if (url.pathname === "/character" || url.pathname === "/achievements") {
        const realm = url.searchParams.get("realm");
        const character = url.searchParams.get("character");
        if (!realm || !character) {
          return new Response("Missing realm or character", { status: 400, headers: cors });
        }

        // Character Profile Summary carries `last_login_timestamp`, the only
        // first-class "when was this played" field in the API. The
        // achievements summary carries a `completed_timestamp` per
        // achievement — the closest thing to a history the API exposes,
        // since there is no playtime or character-creation-date endpoint.
        const base = `/profile/wow/character/${encodeURIComponent(realm.toLowerCase())}/${encodeURIComponent(character.toLowerCase())}`;
        return proxy(request, env, cors, url.pathname === "/achievements" ? `${base}/achievements` : base);
      }
    }

    return new Response("Not found", { status: 404, headers: cors });
  },
};

async function handleToken(request, env, cors) {
  if (!env.CLIENT_SECRET) {
    return new Response("Worker misconfigured: CLIENT_SECRET not set", {
      status: 500,
      headers: cors,
    });
  }

  let code;
  try {
    ({ code } = await request.json());
  } catch {
    return new Response("Invalid JSON body", { status: 400, headers: cors });
  }
  if (!code) {
    return new Response("Missing code", { status: 400, headers: cors });
  }

  const basicAuth = btoa(`${env.CLIENT_ID}:${env.CLIENT_SECRET}`);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: env.REDIRECT_URI,
  });

  const tokenRes = await fetch(`https://${env.REGION}.battle.net/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  return new Response(await tokenRes.text(), {
    status: tokenRes.status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

// Every profile read is the same shape: require the caller's bearer token,
// forward it to the profile namespace, hand the response straight back. The
// Worker never inspects or stores the token — it only relays it, because the
// browser can't reach api.blizzard.com itself (no CORS headers there).
async function proxy(request, env, cors, apiPath) {
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) {
    return new Response("Missing bearer token", { status: 401, headers: cors });
  }

  const apiUrl = `https://${env.REGION}.api.blizzard.com${apiPath}?namespace=profile-${env.REGION}&locale=en_US`;
  const apiRes = await fetch(apiUrl, { headers: { Authorization: auth } });

  return new Response(await apiRes.text(), {
    status: apiRes.status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
