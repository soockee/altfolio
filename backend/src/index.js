// Exchanges a Battle.net authorization code for an access token.
//
// This has to live server-side: the exchange requires client_secret, and
// Battle.net's token endpoint doesn't send CORS headers for browser calls.
export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/token") {
      return new Response("Not found", { status: 404, headers: cors });
    }

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
  },
};
