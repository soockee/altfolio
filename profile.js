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

  // Per-character detail. This read was originally here only for
  // `last_login_timestamp` — the one first-class "when was this character last
  // played" field in the API, and a firmer end-of-life signal than the last
  // achievement a character happened to earn.
  //
  // The same response carries far more than that date, and the rest of it is
  // the best evidence the API has for *which character is the main*:
  //
  //   equipped_item_level  nobody gears an alt past their main
  //   guild                mains sit in the real guild, alts in a bank guild
  //   active_title         you only equip a title on the one you identify with
  //
  // None of that costs an extra request — it is in the body already, and was
  // simply being discarded. Returns a character key -> detail map; characters
  // whose read fails are simply absent.
  //
  // onProgress is (done, total, settled) — see settleLimit in api.js.
  async function fetchDetail(accessToken, characters, onProgress) {
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

    const detail = new Map();
    for (const { item, value } of settled) {
      if (!value) continue;
      detail.set(item.key, {
        lastLogin: num(value.last_login_timestamp),
        // Equipped is what the character is actually wearing; average counts
        // empty slots against them. Equipped is the fairer read of "how far
        // has this one been taken", so it leads and average is the fallback.
        itemLevel: num(value.equipped_item_level) ?? num(value.average_item_level),
        guild: (value.guild && value.guild.name) || null,
        activeTitle: titleOf(value.active_title, item.name),
        activeSpec: (value.active_spec && value.active_spec.name) || null,
        achievementPoints: num(value.achievement_points),
      });
    }
    return detail;
  }

  function num(value) {
    return typeof value === "number" ? value : null;
  }

  // `display_string` is the title as it reads in game, with `%s` standing in
  // for the character's name ("%s, Champion of the Naaru"). Substituting it
  // gives the line the recap actually wants to print; `name` is the bare
  // fallback for a title that arrives without one.
  function titleOf(title, characterName) {
    if (!title) return null;
    if (title.display_string) return title.display_string.replace("%s", characterName);
    return title.name || null;
  }

  // Just the last-login timestamps out of a detail map, for the callers that
  // only ever wanted the date.
  function lastLoginsFrom(detail) {
    const logins = new Map();
    for (const [key, d] of detail) {
      if (d.lastLogin !== null) logins.set(key, d.lastLogin);
    }
    return logins;
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

  window.BnetProfile = { fetchCharacters, fetchDetail, lastLoginsFrom, countBy };
})();
