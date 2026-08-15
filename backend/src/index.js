// Exchanges a Battle.net authorization code for an access token, and proxies
// WoW profile reads.
//
// Both have to live server-side: the token exchange requires client_secret,
// and neither Battle.net's token endpoint nor api.blizzard.com send CORS
// headers for browser calls.
export default {
  async fetch(request, env, ctx) {
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

      // All three take the same realm/character pair and differ only in
      // which profile sub-resource they read.
      if (url.pathname === "/character" || url.pathname === "/achievements" || url.pathname === "/media/character") {
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
        // character-media carries the Armory portrait renders — see
        // docs/wow-art-resources.md for why these are fetched live rather
        // than bundled.
        const base = `/profile/wow/character/${encodeURIComponent(realm.toLowerCase())}/${encodeURIComponent(character.toLowerCase())}`;
        const suffix = { "/achievements": "/achievements", "/media/character": "/character-media" }[url.pathname] || "";
        return proxy(request, env, cors, `${base}${suffix}`);
      }

      // Class icons are public Game Data, not any one player's profile, so
      // this authenticates as the app itself (client-credentials) rather
      // than forwarding the caller's bearer token, and caches the result at
      // the edge since the artwork never changes.
      if (url.pathname === "/media/class") {
        return handleClassMedia(request, env, cors, ctx);
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

// Client-credentials app token, memoized in module scope for the isolate's
// lifetime. Game Data reads like class icons aren't tied to any one player,
// so the Worker authenticates as itself here instead of forwarding a user's
// bearer token — the same CLIENT_ID/CLIENT_SECRET used for the code exchange
// in handleToken, just a different grant_type and no redirect_uri.
let appToken = null;
let appTokenExpiry = 0;

async function getAppToken(env) {
  if (appToken && Date.now() < appTokenExpiry) return appToken;

  const basicAuth = btoa(`${env.CLIENT_ID}:${env.CLIENT_SECRET}`);
  const res = await fetch(`https://${env.REGION}.battle.net/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`App token request failed: ${res.status}`);

  const body = await res.json();
  appToken = body.access_token;
  // Refresh a minute early so an in-flight request never races expiry.
  appTokenExpiry = Date.now() + (body.expires_in - 60) * 1000;
  return appToken;
}

// Proxies the WoW Game Data media endpoint for a playable class's icon
// (?id=<classId>, e.g. 1 = Warrior). Static data namespace, not profile —
// this is the same artwork for every player, which is also why it's safe to
// cache at the edge for a day.
async function handleClassMedia(request, env, cors, ctx) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id || !/^\d+$/.test(id)) {
    return new Response("Missing or invalid id", { status: 400, headers: cors });
  }

  const cache = caches.default;
  const cacheKey = new Request(request.url, request);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  let token;
  try {
    token = await getAppToken(env);
  } catch (err) {
    return new Response(err.message, { status: 502, headers: cors });
  }

  const apiUrl = `https://${env.REGION}.api.blizzard.com/data/wow/media/playable-class/${id}?namespace=static-${env.REGION}&locale=en_US`;
  const apiRes = await fetch(apiUrl, { headers: { Authorization: `Bearer ${token}` } });

  const response = new Response(await apiRes.text(), {
    status: apiRes.status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "public, max-age=86400" },
  });
  if (apiRes.ok) ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}
