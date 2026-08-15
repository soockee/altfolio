// Shared plumbing for the Battle.net reads: authenticated JSON GETs through
// the Worker proxy, plus a bounded-concurrency map for the per-character
// fetches.
//
// The concurrency cap matters: building the journey costs two requests per
// character (detail + achievements), so a 40-alt account is 80 requests.
// Firing those all at once risks Blizzard's rate limit and saturates the
// browser's connection pool for no gain.
(function () {
  const CONCURRENCY = 6;

  async function getJson(url, accessToken, fallbackMessage) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });

    let body = null;
    try {
      body = await res.json();
    } catch {
      // Non-JSON error bodies (the Worker's own plain-text 4xx) fall through
      // to fallbackMessage below.
    }

    if (!res.ok) {
      const detail = body && (body.detail || body.error_description || body.error);
      throw new Error(detail || fallbackMessage);
    }
    return body;
  }

  // Runs `fn` over `items`, at most `CONCURRENCY` in flight, preserving input
  // order in the result.
  //
  // Rejections are captured rather than thrown: one character that 404s (too
  // low level, recently renamed or transferred) must not take down the whole
  // journey. Returns [{ item, value } | { item, error }, ...].
  async function settleLimit(items, fn, onProgress) {
    const results = new Array(items.length);
    let next = 0;
    let done = 0;

    async function worker() {
      while (next < items.length) {
        const index = next++;
        try {
          results[index] = { item: items[index], value: await fn(items[index]) };
        } catch (error) {
          results[index] = { item: items[index], error };
        }
        done++;
        if (onProgress) onProgress(done, items.length);
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
    return results;
  }

  window.BnetApi = { getJson, settleLimit };
})();
