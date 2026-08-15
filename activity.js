// Reconstructs per-character activity over time from achievement completion
// timestamps — the only place the Battle.net API exposes anything
// historical. There is no playtime or character-creation-date data
// anywhere in the API; the earliest surviving timestamp below is a lower
// bound on activity, not a creation date.
//
// Caveat this file works around: account-wide achievements report the
// exact same completed_timestamp on every character on the account (a
// known Blizzard API quirk), which would otherwise fake an identical
// activity spike on every alt whenever any one of them earns a shared
// achievement. We detect and drop those by looking for the same
// (achievement, timestamp) pair recurring across two or more of the
// signed-in user's characters — a genuinely character-specific completion
// can't happen at the same instant on two different characters.
(function () {
  async function fetchAchievements(accessToken, character) {
    const cfg = window.OAUTH_CONFIG;
    const params = new URLSearchParams({ realm: character.realmSlug, character: character.name });
    const res = await fetch(`${cfg.achievementsEndpoint}?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const body = await res.json();
    if (!res.ok) {
      throw new Error(body.detail || body.error_description || body.error || `Failed to load achievements for ${character.name}`);
    }

    const entries = [];
    for (const a of body.achievements || []) {
      const achievementId = (a.achievement && a.achievement.id) || a.id;
      if (typeof achievementId === "number" && typeof a.completed_timestamp === "number") {
        entries.push({ achievementId, timestamp: a.completed_timestamp });
      }
    }
    return entries;
  }

  // Fetches achievements for every character with a known realm, and
  // returns only the entries that survive account-wide dedup, each tagged
  // with the character that earned it.
  async function fetchActivity(accessToken, characters) {
    const withRealm = characters.filter((c) => c.realmSlug);
    const perCharacter = await Promise.all(
      withRealm.map(async (c) => ({ character: c, entries: await fetchAchievements(accessToken, c) }))
    );

    // achievementId -> timestamp -> set of character names that completed it then.
    const byAchievement = new Map();
    for (const { character, entries } of perCharacter) {
      for (const { achievementId, timestamp } of entries) {
        if (!byAchievement.has(achievementId)) byAchievement.set(achievementId, new Map());
        const byTimestamp = byAchievement.get(achievementId);
        if (!byTimestamp.has(timestamp)) byTimestamp.set(timestamp, new Set());
        byTimestamp.get(timestamp).add(character.name);
      }
    }

    let excludedCount = 0;
    const kept = [];
    for (const { character, entries } of perCharacter) {
      for (const { achievementId, timestamp } of entries) {
        const sharedWith = byAchievement.get(achievementId).get(timestamp);
        if (sharedWith.size > 1) {
          excludedCount++;
          continue;
        }
        kept.push({ character: character.name, achievementId, timestamp });
      }
    }

    return { entries: kept, excludedCount };
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

  // Each character's single busiest month, most active character first.
  function peakMonthPerCharacter(entries) {
    const byCharacter = new Map();
    for (const { character, timestamp } of entries) {
      if (!byCharacter.has(character)) byCharacter.set(character, new Map());
      const months = byCharacter.get(character);
      const key = monthKey(timestamp);
      months.set(key, (months.get(key) || 0) + 1);
    }

    const peaks = [];
    for (const [character, months] of byCharacter) {
      let bestMonth = null;
      let bestCount = 0;
      for (const [month, count] of months) {
        if (count > bestCount) {
          bestMonth = month;
          bestCount = count;
        }
      }
      if (bestMonth) peaks.push({ label: `${character} — ${bestMonth}`, count: bestCount });
    }
    return peaks.sort((a, b) => b.count - a.count);
  }

  // Earliest surviving completion timestamp per character, as a
  // character -> timestamp(ms) map.
  function earliestActivity(entries) {
    const earliest = new Map();
    for (const { character, timestamp } of entries) {
      const prev = earliest.get(character);
      if (prev === undefined || timestamp < prev) earliest.set(character, timestamp);
    }
    return earliest;
  }

  window.BnetActivity = { fetchActivity, monthlyTotals, peakMonthPerCharacter, earliestActivity };
})();
