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

    if (request.method === "GET" && url.pathname === "/profile") {
      return handleProfile(request, env, cors);
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

// Proxies the WoW Account Profile Summary — the list of the signed-in
// user's characters across their linked WoW accounts, with class/race/
// faction/level per character. Requires the `wow.profile` OAuth scope.
async function handleProfile(request, env, cors) {
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) {
    return new Response("Missing bearer token", { status: 401, headers: cors });
  }

  const apiUrl = `https://${env.REGION}.api.blizzard.com/profile/user/wow?namespace=profile-${env.REGION}&locale=en_US`;
  const apiRes = await fetch(apiUrl, { headers: { Authorization: auth } });

  return new Response(await apiRes.text(), {
    status: apiRes.status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
