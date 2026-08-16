// Reconstructs per-character activity over time from achievement completion
// timestamps — the only place the Battle.net API exposes anything
// historical. There is no playtime or character-creation-date data anywhere
// in the API; the earliest surviving timestamp below is a lower bound on
// activity, not a creation date.
//
// Caveat this file works around: account-wide achievements report the exact
// same completed_timestamp on every character on the account (a known
// Blizzard API quirk), which would otherwise fake an identical activity spike
// on every alt whenever any one of them earns a shared achievement. We detect
// them by looking for the same (achievement, timestamp) pair recurring across
// two or more of the signed-in user's characters — a genuinely
// character-specific completion can't happen at the same instant on two
// different characters.
//
// Those shared completions aren't discarded, though: stripped of the
// character that happens to report them, they *are* the account-wide
// milestone history, so they come back as `accountWide`.
(function () {
  // Alongside the completion list, the same response carries `total_points`,
  // `total_quantity` and — the useful one — `category_progress`: points and
  // quantity per achievement category (Raiding, PvP, Exploration, Professions,
  // Pet Battles…), already bucketed by Blizzard. That is a playstyle
  // fingerprint for free, in a request we were making anyway and reading one
  // field of.
  async function fetchAchievements(accessToken, character) {
    const cfg = window.OAUTH_CONFIG;
    const params = new URLSearchParams({ realm: character.realmSlug, character: character.name });
    const body = await window.BnetApi.getJson(
      `${cfg.achievementsEndpoint}?${params}`,
      accessToken,
      `Failed to load achievements for ${character.name}`
    );

    const entries = [];
    for (const a of body.achievements || []) {
      const achievementId = (a.achievement && a.achievement.id) || a.id;
      const name = (a.achievement && a.achievement.name) || null;
      if (typeof achievementId === "number" && typeof a.completed_timestamp === "number") {
        entries.push({ achievementId, name, timestamp: a.completed_timestamp });
      }
    }

    const categories = [];
    for (const c of body.category_progress || []) {
      const label = c.category && c.category.name;
      if (label && typeof c.points === "number") {
        categories.push({ label, points: c.points, quantity: c.quantity || 0 });
      }
    }

    return {
      entries,
      categories,
      totalPoints: typeof body.total_points === "number" ? body.total_points : null,
      totalQuantity: typeof body.total_quantity === "number" ? body.total_quantity : null,
    };
  }

  // Account-level category totals, taken as the **maximum** across characters
  // rather than the sum. Achievement points are largely account-wide now, so
  // every character reports most of the same categories; summing would count
  // the account's Exploration points once per alt. The best-placed character's
  // figure is the closest single honest estimate of the account's total.
  function mergeCategories(perCharacter) {
    const best = new Map();
    for (const { categories } of perCharacter) {
      for (const { label, points, quantity } of categories || []) {
        const current = best.get(label);
        if (!current || points > current.points) best.set(label, { label, points, quantity });
      }
    }
    return Array.from(best.values()).sort((a, b) => b.points - a.points);
  }

  // Fetches achievements for every character with a known realm and splits
  // the result in two: `entries` are character-specific completions (each
  // tagged with the character that earned it), `accountWide` are the shared
  // ones, deduped to one row per achievement.
  async function fetchActivity(accessToken, characters, onProgress) {
    const withRealm = characters.filter((c) => c.realmSlug);
    const settled = await window.BnetApi.settleLimit(
      withRealm,
      (c) => fetchAchievements(accessToken, c),
      onProgress
    );

    const perCharacter = [];
    const failures = [];
    for (const { item, value, error } of settled) {
      if (value) {
        perCharacter.push({
          character: item,
          entries: value.entries,
          categories: value.categories,
          totalPoints: value.totalPoints,
          totalQuantity: value.totalQuantity,
        });
      } else {
        failures.push({ character: item, error });
      }
    }

    if (perCharacter.length === 0) {
      throw new Error("No achievement history could be read for any character.");
    }

    // achievementId -> timestamp -> set of character keys that completed it then.
    const byAchievement = new Map();
    for (const { character, entries } of perCharacter) {
      for (const { achievementId, timestamp } of entries) {
        if (!byAchievement.has(achievementId)) byAchievement.set(achievementId, new Map());
        const byTimestamp = byAchievement.get(achievementId);
        if (!byTimestamp.has(timestamp)) byTimestamp.set(timestamp, new Set());
        byTimestamp.get(timestamp).add(character.key);
      }
    }

    const kept = [];
    const accountWide = [];
    const seenShared = new Set();

    for (const { character, entries } of perCharacter) {
      for (const { achievementId, name, timestamp } of entries) {
        const sharedWith = byAchievement.get(achievementId).get(timestamp);
        if (sharedWith.size > 1) {
          if (!seenShared.has(achievementId)) {
            seenShared.add(achievementId);
            accountWide.push({ achievementId, name, timestamp, characterCount: sharedWith.size });
          }
          continue;
        }
        kept.push({ character, achievementId, name, timestamp });
      }
    }

    accountWide.sort((a, b) => a.timestamp - b.timestamp);
    return { entries: kept, accountWide, failures, categories: mergeCategories(perCharacter) };
  }

  function monthKey(timestampMs) {
    const d = new Date(timestampMs);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  }

  // Total completions per month across all characters, oldest first.
  function monthlyTotals(entries) {
    const counts = new Map();
    for (const { timestamp } of entries) {
      const key = monthKey(timestamp);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return Array.from(counts, ([label, count]) => ({ label, count })).sort((a, b) => (a.label < b.label ? -1 : 1));
  }

  window.BnetActivity = { fetchActivity, monthlyTotals, mergeCategories };
})();
