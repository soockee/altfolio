// Fetches the signed-in user's WoW characters and aggregates them into the
// breakdowns the stats view renders (faction / race / class).
//
// Reads directly from the browser go through the Worker (see backend/),
// since api.blizzard.com doesn't send CORS headers either.
(function () {
  async function fetchCharacters(accessToken) {
    const cfg = window.OAUTH_CONFIG;
    const res = await fetch(cfg.profileEndpoint, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const body = await res.json();
    if (!res.ok) {
      throw new Error(body.detail || body.error_description || body.error || "Failed to load characters");
    }

    const characters = [];
    for (const account of body.wow_accounts || []) {
      for (const c of account.characters || []) {
        characters.push({
          name: c.name,
          realm: c.realm && c.realm.name,
          level: c.level,
          class: c.playable_class && c.playable_class.name,
          race: c.playable_race && c.playable_race.name,
          faction: c.faction && c.faction.name,
        });
      }
    }
    return characters;
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

  window.BnetProfile = { fetchCharacters, countBy };
})();
