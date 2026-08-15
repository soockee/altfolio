// Fetches the signed-in user's WoW characters, and the per-character detail
// the journey needs on top of the account summary.
//
// Reads from the browser go through the Worker (see backend/), since
// api.blizzard.com doesn't send CORS headers.
(function () {
  async function fetchCharacters(accessToken) {
    const cfg = window.OAUTH_CONFIG;
    const body = await window.BnetApi.getJson(cfg.profileEndpoint, accessToken, "Failed to load characters");

    const characters = [];
    for (const account of body.wow_accounts || []) {
      for (const c of account.characters || []) {
        const realmSlug = c.realm && c.realm.slug;
        characters.push({
          // Character names repeat across realms, so identity is realm+name,
          // never the name alone — everything downstream keys off this.
          key: `${realmSlug || "?"}/${String(c.name).toLowerCase()}`,
          name: c.name,
          realm: c.realm && c.realm.name,
          realmSlug,
          level: c.level,
          class: c.playable_class && c.playable_class.name,
          classId: c.playable_class && c.playable_class.id,
          race: c.playable_race && c.playable_race.name,
          faction: c.faction && c.faction.name,
        });
      }
    }
    return characters;
  }

  // Per-character detail, read for `last_login_timestamp` — the one
  // first-class "when was this character last played" field in the API, and a
  // firmer end-of-life signal than the last achievement a character happened
  // to earn. Returns a character key -> timestamp(ms) map; characters whose
  // detail read fails are simply absent.
  //
  // onProgress is (done, total, settled) — see settleLimit in api.js.
  async function fetchLastLogins(accessToken, characters, onProgress) {
    const cfg = window.OAUTH_CONFIG;
    const withRealm = characters.filter((c) => c.realmSlug);

    const settled = await window.BnetApi.settleLimit(
      withRealm,
      (c) => {
        const params = new URLSearchParams({ realm: c.realmSlug, character: c.name });
        return window.BnetApi.getJson(`${cfg.characterEndpoint}?${params}`, accessToken, `Failed to load ${c.name}`);
      },
      onProgress
    );

    const lastLogins = new Map();
    for (const { item, value } of settled) {
      if (value && typeof value.last_login_timestamp === "number") {
        lastLogins.set(item.key, value.last_login_timestamp);
      }
    }
    return lastLogins;
  }

  // Counts characters per value of `key`, descending, dropping missing values.
  function countBy(characters, key) {
    const counts = new Map();
    for (const c of characters) {
      const label = c[key];
      if (!label) continue;
      counts.set(label, (counts.get(label) || 0) + 1);
    }
    return Array.from(counts, ([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
  }

  window.BnetProfile = { fetchCharacters, fetchLastLogins, countBy };
})();
