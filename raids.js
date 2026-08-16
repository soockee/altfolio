// Reads each character's raid record — the only dated, per-character progress
// the API reports that account-wide sharing cannot contaminate.
//
// `/encounters/raids` returns every raid instance a character has set foot in,
// grouped under a *named expansion*, and every boss inside carries
// `completed_count` and `last_kill_timestamp`. Two things follow from that,
// and both are things achievement timestamps could not give us:
//
//   1. The expansion name arrives in the response. Eras can be labelled
//      "Legion" rather than "2017", which is how players actually remember
//      their own history.
//   2. A boss kill is unambiguously this character's. Nothing here needs the
//      shared-completion detection that activity.js has to do.
//
// The one thing to be careful about: `last_kill_timestamp` is the *last* kill,
// not every kill. A character who raided Ulduar weekly for a year reports one
// date near the end of that year, not fifty across it. So these timestamps are
// good for "which expansion was this character raiding in" and bad for "how
// busy was this character that month" — the wording downstream stays on the
// right side of that.
(function () {
  async function fetchRaids(accessToken, character) {
    const cfg = window.OAUTH_CONFIG;
    const params = new URLSearchParams({ realm: character.realmSlug, character: character.name });
    const body = await window.BnetApi.getJson(
      `${cfg.raidsEndpoint}?${params}`,
      accessToken,
      `Failed to load raid history for ${character.name}`
    );

    // expansion name -> tally. Bosses are counted as a set of encounter ids
    // rather than a running total, because the same boss appears once per
    // difficulty the character cleared it on and would otherwise be counted
    // three or four times over.
    const byExpansion = new Map();

    for (const group of body.expansions || []) {
      const name = group.expansion && group.expansion.name;
      if (!name) continue;

      const tally = byExpansion.get(name) || {
        expansion: name,
        expansionId: (group.expansion && group.expansion.id) || null,
        bosses: new Set(),
        kills: 0,
        first: null,
        last: null,
      };

      for (const instance of group.instances || []) {
        for (const mode of instance.modes || []) {
          const progress = mode.progress;
          for (const encounter of (progress && progress.encounters) || []) {
            const id = encounter.encounter && encounter.encounter.id;
            if (typeof id === "number") tally.bosses.add(id);
            if (typeof encounter.completed_count === "number") tally.kills += encounter.completed_count;

            const ts = encounter.last_kill_timestamp;
            if (typeof ts === "number") {
              if (tally.first === null || ts < tally.first) tally.first = ts;
              if (tally.last === null || ts > tally.last) tally.last = ts;
            }
          }
        }
      }

      byExpansion.set(name, tally);
    }

    return Array.from(byExpansion.values())
      .filter((t) => t.bosses.size > 0)
      .map((t) => ({ ...t, bosses: t.bosses.size }));
  }

  // Fetches raid records for every character with a known realm.
  //
  // Returns { rows, failures } where a row is one (character, expansion) pair.
  // Flat rather than nested because every consumer downstream groups it by
  // expansion, never by character.
  //
  // Same failure posture as the rest of the reads: a character that 404s is
  // recorded and skipped, never fatal. An account that has never raided is a
  // perfectly ordinary account, so an empty result is not an error either.
  async function fetchAllRaids(accessToken, characters, onProgress) {
    const withRealm = characters.filter((c) => c.realmSlug);
    const settled = await window.BnetApi.settleLimit(
      withRealm,
      (c) => fetchRaids(accessToken, c),
      onProgress
    );

    const rows = [];
    const failures = [];
    for (const { item, value, error } of settled) {
      if (!value) {
        failures.push({ character: item, error });
        continue;
      }
      for (const tally of value) rows.push({ character: item, ...tally });
    }

    return { rows, failures };
  }

  window.BnetRaids = { fetchAllRaids };
})();
