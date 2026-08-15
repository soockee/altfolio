// Turns the raw Battle.net reads into the chapters the journey narrates and
// the archetype it ends on.
//
// Everything historical here is *reconstructed*, not reported. The API has no
// character-creation date and no playtime counter, so two signals stand in:
// achievement completion timestamps (a lower bound on when a character was
// active) and `last_login_timestamp`. The wording this module emits stays
// hedged to match — "first seen", never "created".
(function () {
  // A race's home faction. Only races locked to one side are listed: Pandaren,
  // Dracthyr and Earthen can be either, so they carry no signal and are
  // deliberately absent.
  //
  // This is the journey's one piece of *hard* history. A character whose race
  // is locked to one faction but who currently belongs to the other can only
  // have got there through a faction change — the API never reports that
  // event, but the mismatch it leaves behind is unambiguous.
  const RACE_FACTION = {
    Human: "Alliance",
    Dwarf: "Alliance",
    "Night Elf": "Alliance",
    Gnome: "Alliance",
    Draenei: "Alliance",
    Worgen: "Alliance",
    "Void Elf": "Alliance",
    "Lightforged Draenei": "Alliance",
    "Dark Iron Dwarf": "Alliance",
    "Kul Tiran": "Alliance",
    Mechagnome: "Alliance",

    Orc: "Horde",
    Undead: "Horde",
    Forsaken: "Horde",
    Tauren: "Horde",
    Troll: "Horde",
    "Blood Elf": "Horde",
    Goblin: "Horde",
    Nightborne: "Horde",
    "Highmountain Tauren": "Horde",
    "Mag'har Orc": "Horde",
    "Zandalari Troll": "Horde",
    Vulpera: "Horde",
  };

  // Playable class roster, used only to phrase coverage ("9 of 13 classes").
  // Bump it when an expansion adds a class.
  const CLASS_ROSTER = 13;

  const MS_PER_DAY = 86400000;

  const clamp = (x) => Math.max(0, Math.min(1, x));
  const yearOf = (ts) => new Date(ts).getUTCFullYear();
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  function monthIndex(ts) {
    const d = new Date(ts);
    return d.getUTCFullYear() * 12 + d.getUTCMonth();
  }

  function formatMonthYear(ts) {
    return new Date(ts).toLocaleDateString(undefined, { year: "numeric", month: "long", timeZone: "UTC" });
  }

  // A highlighted bar, or a "you keep coming back to X" headline, both claim
  // that one entry is *the* point. With a tie at the top that claim is false —
  // three classes at two characters each is not a favourite — so the chapters
  // check these before singling anything out.
  function isUniqueTop(counts) {
    return counts.length > 0 && (counts.length === 1 || counts[0].count > counts[1].count);
  }

  // The rarest entry, but only when nothing ties it. Ten classes played once
  // each gives no grounds to pick on any one of them.
  function uniqueLeast(counts) {
    if (counts.length < 2) return null;
    const last = counts[counts.length - 1];
    const runnerUp = counts[counts.length - 2];
    return runnerUp.count > last.count ? last : null;
  }

  function listNames(characters, limit = 3) {
    const names = characters.slice(0, limit).map((c) => c.name);
    const rest = characters.length - names.length;
    const joined =
      names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
    return rest > 0 ? `${joined} (+${rest} more)` : joined;
  }

  // --- chapter builders -----------------------------------------------------

  function buildFactions(characters) {
    const counts = { Alliance: 0, Horde: 0 };
    for (const c of characters) {
      if (c.faction === "Alliance" || c.faction === "Horde") counts[c.faction]++;
    }
    const total = counts.Alliance + counts.Horde;

    const changers = characters.filter((c) => {
      const home = RACE_FACTION[c.race];
      return home && c.faction && home !== c.faction;
    });

    const dominant = counts.Alliance >= counts.Horde ? "Alliance" : "Horde";
    return {
      alliance: counts.Alliance,
      horde: counts.Horde,
      total,
      dominant,
      dominantShare: total ? Math.max(counts.Alliance, counts.Horde) / total : 0,
      minorityShare: total ? Math.min(counts.Alliance, counts.Horde) / total : 0,
      changers,
    };
  }

  // Per-character lifelines: when each character was first and last seen, and
  // how much they did in each calendar year. This is what the timeline
  // chapter plots, one row per character.
  function buildLanes(characters, entries, lastLogins) {
    const byKey = new Map();
    for (const c of characters) {
      byKey.set(c.key, {
        character: c,
        firstSeen: null,
        lastSeen: null,
        total: 0,
        byYear: new Map(),
      });
    }

    for (const { character, timestamp } of entries) {
      const lane = byKey.get(character.key);
      if (!lane) continue;
      lane.total++;
      if (lane.firstSeen === null || timestamp < lane.firstSeen) lane.firstSeen = timestamp;
      if (lane.lastSeen === null || timestamp > lane.lastSeen) lane.lastSeen = timestamp;
      const year = yearOf(timestamp);
      lane.byYear.set(year, (lane.byYear.get(year) || 0) + 1);
    }

    // last_login is a firmer end-of-life signal than "the last achievement
    // this character happened to earn", so it extends the lane when it's later.
    for (const lane of byKey.values()) {
      const lastLogin = lastLogins.get(lane.character.key);
      if (lastLogin && (lane.lastSeen === null || lastLogin > lane.lastSeen)) lane.lastSeen = lastLogin;
      lane.lastLogin = lastLogin || null;
    }

    const lanes = Array.from(byKey.values()).filter((l) => l.firstSeen !== null || l.lastLogin !== null);
    lanes.sort((a, b) => (a.firstSeen || a.lastLogin) - (b.firstSeen || b.lastLogin));

    const years = [];
    let minYear = Infinity;
    let maxYear = -Infinity;
    for (const lane of lanes) {
      if (lane.firstSeen !== null) minYear = Math.min(minYear, yearOf(lane.firstSeen));
      if (lane.lastSeen !== null) maxYear = Math.max(maxYear, yearOf(lane.lastSeen));
    }
    if (Number.isFinite(minYear) && Number.isFinite(maxYear)) {
      for (let y = minYear; y <= maxYear; y++) years.push(y);
    }

    return { lanes, years };
  }

  // A year has to carry real volume before it gets to name a main, and the
  // winner has to actually lead. Without both gates a year in which the whole
  // account earned four achievements would crown a "main" off a single point
  // of difference, and the Main-Switcher archetype would win every account
  // with a quiet stretch.
  const ERA_MIN_ACHIEVEMENTS = 10;
  const ERA_MIN_SHARE = 0.4;

  // Which character owned each calendar year. "Owned" = earned the most
  // achievements that year, which is the closest the data gets to "this was
  // my main back then".
  function buildEras(entries) {
    const perYear = new Map();
    for (const { character, timestamp } of entries) {
      const year = yearOf(timestamp);
      if (!perYear.has(year)) perYear.set(year, new Map());
      const counts = perYear.get(year);
      counts.set(character, (counts.get(character) || 0) + 1);
    }

    const eras = [];
    for (const year of Array.from(perYear.keys()).sort((a, b) => a - b)) {
      const counts = perYear.get(year);
      let best = null;
      let bestCount = 0;
      let total = 0;
      for (const [character, count] of counts) {
        total += count;
        if (count > bestCount) {
          best = character;
          bestCount = count;
        }
      }
      if (best && total >= ERA_MIN_ACHIEVEMENTS && bestCount / total >= ERA_MIN_SHARE) {
        eras.push({ year, character: best, count: bestCount, share: bestCount / total });
      }
    }

    let switches = 0;
    for (let i = 1; i < eras.length; i++) {
      if (eras[i].character.key !== eras[i - 1].character.key) switches++;
    }

    return { eras, switches };
  }

  // The longest stretch with no achievement anywhere on the account, and
  // whether play resumed after it — the "you came back" signal.
  function buildGap(entries) {
    if (entries.length === 0) return null;

    const months = Array.from(new Set(entries.map((e) => monthIndex(e.timestamp)))).sort((a, b) => a - b);
    let best = null;
    for (let i = 1; i < months.length; i++) {
      const span = months[i] - months[i - 1];
      if (!best || span > best.months) {
        best = {
          months: span,
          // Rebuild timestamps from the month indices on either side of the gap.
          from: Date.UTC(Math.floor(months[i - 1] / 12), months[i - 1] % 12, 1),
          to: Date.UTC(Math.floor(months[i] / 12), months[i] % 12, 1),
        };
      }
    }
    return best;
  }

  // --- the verdict ----------------------------------------------------------

  // Each archetype scores itself 0..1 from the facts; the highest wins and the
  // next-best become "also true of you". Scoring rather than a first-match
  // cascade means a wide account doesn't get pinned to whichever rule happens
  // to sit at the top of the list.
  //
  // `tier` sits above the score and is the tie-break that actually matters:
  // an archetype backed by something the data *proves* (tier 1) always beats
  // one inferred from proportions (tier 0), however confident the inference
  // got. Expressing that as a field rather than as a carefully-capped weight
  // means a later tweak to any scoring formula can't quietly invert it.
  const PROVEN = 1;
  const INFERRED = 0;

  function scoreArchetypes(f) {
    const out = [];

    if (f.factions.changers.length > 0) {
      const c = f.factions.changers;
      const first = c[0];
      out.push({
        key: "faction-hopper",
        title: "The Faction Hopper",
        tagline: "You've switched sides. We can prove it.",
        tier: PROVEN,
        score: 0.98,
        evidence: [
          `${first.name} is a ${first.race}, flying ${first.faction} colours. That race cannot start there.`,
          c.length === 1
            ? "One character carrying a passport."
            : `${listNames(c)} — ${plural(c.length, "character", "characters")} carrying a passport.`,
        ],
      });
    } else if (f.factions.minorityShare >= 0.3) {
      out.push({
        key: "double-agent",
        title: "The Double Agent",
        tagline: "You stopped pretending to pick a side.",
        tier: INFERRED,
        score: clamp(0.3 + f.factions.minorityShare),
        evidence: [
          `${f.factions.alliance} Alliance, ${f.factions.horde} Horde — a ${Math.round(f.factions.dominantShare * 100)}/${Math.round(f.factions.minorityShare * 100)} split.`,
          "Neither side would call you theirs.",
        ],
      });
    }

    // Loyalty is to a faction *and* a playstyle. Monofaction alone describes
    // most of the playerbase, so class repetition is a gate here rather than
    // a bonus — otherwise every one-faction account scores as a Loyalist.
    const classLoyal = f.distinctClasses <= 3 || f.classDiversity <= 0.6;
    if (f.characterCount >= 3 && f.factions.dominantShare >= 0.85 && classLoyal) {
      const yearsFactor = Math.min(f.activeYears / 5, 1);
      out.push({
        key: "loyalist",
        title: "The Loyalist",
        tagline: `${f.factions.dominant} then, ${f.factions.dominant} now.`,
        tier: INFERRED,
        score: clamp(f.factions.dominantShare * 0.35 + (1 - f.classDiversity) * 0.35 + yearsFactor * 0.3),
        evidence: [
          `${Math.round(f.factions.dominantShare * 100)}% of your characters fly ${f.factions.dominant} colours.`,
          f.activeYears >= 2
            ? `Across ${plural(f.activeYears, "year", "years")} of play, you never seriously defected.`
            : "One side, no wavering.",
        ],
      });
    }

    if (f.characterCount >= 8 && f.distinctClasses >= 6) {
      out.push({
        key: "completionist",
        title: "The Completionist",
        tagline: "One of everything, please.",
        tier: INFERRED,
        score: clamp(
          Math.min(f.characterCount / 15, 1) * 0.4 +
            Math.min(f.distinctClasses / CLASS_ROSTER, 1) * 0.35 +
            Math.min(f.distinctRaces / 10, 1) * 0.25
        ),
        evidence: [
          `${plural(f.characterCount, "character", "characters")} spanning ${f.distinctClasses} of ${CLASS_ROSTER} classes and ${plural(f.distinctRaces, "race", "races")}.`,
          f.distinctRealms > 1 ? `Spread over ${plural(f.distinctRealms, "realm", "realms")}.` : "All on one realm, all filled in.",
        ],
      });
    }

    if (f.characterCount >= 4 && f.distinctClasses >= 4) {
      out.push({
        key: "class-nomad",
        title: "The Class Nomad",
        tagline: "You never met a class you'd commit to.",
        // Breadth carries as much weight as the ratio: four characters with
        // four classes is a small sample, not a wandering soul.
        tier: INFERRED,
        score: clamp(f.classDiversity * 0.45 + Math.min(f.distinctClasses / 8, 1) * 0.45),
        evidence: [
          `${plural(f.distinctClasses, "class", "classes")} across ${plural(f.characterCount, "character", "characters")} — barely a repeat.`,
          f.topClass ? `Even your favourite, ${f.topClass.label}, is only ${f.topClass.count} of them.` : null,
        ].filter(Boolean),
      });
    }

    if (f.eras.length >= 4 && f.eraSwitches >= 2) {
      const switchRate = f.eraSwitches / (f.eras.length - 1);
      out.push({
        key: "main-switcher",
        title: "The Main-Switcher",
        tagline: "Every era had a different favourite.",
        // Deliberately capped below the composition archetypes: "who led each
        // year" is the noisiest signal here, since it rests on achievement
        // counts rather than anything the API states outright.
        tier: INFERRED,
        score: clamp(switchRate * 0.55 + Math.min(f.eras.length / 8, 1) * 0.3),
        evidence: [
          `${plural(f.eraSwitches, "handover", "handovers")} across ${plural(f.eras.length, "year", "years")} of play.`,
          `${f.eras[f.eras.length - 1].year} belonged to ${f.eras[f.eras.length - 1].character.name}.`,
        ],
      });
    }

    // Two years, not one: skipping a single expansion is the norm, not a
    // story. The volume floor stops a handful of stray timestamps from
    // reading as a comeback arc.
    if (f.gap && f.gap.months >= 24 && f.entryCount >= 30) {
      out.push({
        key: "returner",
        title: "The Returner",
        tagline: "Azeroth was always going to call you back.",
        tier: INFERRED,
        score: clamp(0.45 + Math.min(f.gap.months / 60, 1) * 0.45),
        evidence: [
          `You went quiet for about ${plural(Math.round(f.gap.months / 12), "year", "years")} after ${formatMonthYear(f.gap.from)}.`,
          `Then you logged back in, and ${formatMonthYear(f.gap.to)} started all over again.`,
        ],
      });
    }

    // Always-present floor, so there is a verdict even for a brand-new or
    // barely-populated account.
    out.push({
      key: "adventurer",
      title: "The Adventurer",
      tagline: "Still writing the story.",
      tier: INFERRED,
      score: 0.2,
      evidence: [
        `${plural(f.characterCount, "character", "characters")}, ${plural(f.distinctClasses, "class", "classes")}, ${plural(f.distinctRaces, "race", "races")}.`,
        f.firstSeen ? `First traces of you in ${formatMonthYear(f.firstSeen)}.` : "The record starts here.",
      ],
    });

    return out.sort((a, b) => b.tier - a.tier || b.score - a.score);
  }

  // --- entry point ----------------------------------------------------------

  // `activity` and `lastLogins` are optional: the achievement history is a
  // slow, failure-prone read, and the composition chapters (faction / race /
  // class) plus a reduced verdict still work without it.
  function build({ characters, activity, lastLogins }) {
    const entries = (activity && activity.entries) || [];
    const accountWide = (activity && activity.accountWide) || [];
    const logins = lastLogins || new Map();

    const factions = buildFactions(characters);
    const races = window.BnetProfile.countBy(characters, "race");
    const classes = window.BnetProfile.countBy(characters, "class");
    const realms = new Set(characters.map((c) => c.realm).filter(Boolean));

    const { lanes, years } = buildLanes(characters, entries, logins);
    const { eras, switches } = buildEras(entries);
    const gap = buildGap(entries);

    const firstSeen = lanes.length && lanes[0].firstSeen !== null ? lanes[0].firstSeen : null;
    const lastSeen = lanes.reduce((max, l) => (l.lastSeen && l.lastSeen > max ? l.lastSeen : max), 0) || null;
    const firstCharacter = lanes.find((l) => l.firstSeen !== null) || null;

    const activeYears = new Set(entries.map((e) => yearOf(e.timestamp))).size;
    const levels = characters.map((c) => c.level).filter((l) => typeof l === "number");

    const facts = {
      characterCount: characters.length,
      distinctClasses: classes.length,
      distinctRaces: races.length,
      distinctRealms: realms.size,
      classDiversity: characters.length ? classes.length / characters.length : 0,
      topClass: classes[0] || null,
      topRace: races[0] || null,
      factions,
      activeYears,
      eras,
      eraSwitches: switches,
      gap,
      firstSeen,
      entryCount: entries.length,
    };

    const ranked = scoreArchetypes(facts);

    return {
      characters,
      hasHistory: entries.length > 0,
      totals: {
        characters: characters.length,
        classes: classes.length,
        races: races.length,
        realms: realms.size,
        maxLevel: levels.length ? Math.max(...levels) : null,
        achievements: entries.length + accountWide.length,
        firstSeen,
        lastSeen,
        // Only ever a lower bound: it measures the oldest surviving
        // achievement timestamp, not when the account was opened.
        daysTracked: firstSeen ? Math.floor((Date.now() - firstSeen) / MS_PER_DAY) : null,
        activeYears,
      },
      factions,
      races: { counts: races, top: races[0] || null, topIsUnique: isUniqueTop(races), firstCharacter },
      classes: {
        counts: classes,
        top: classes[0] || null,
        topIsUnique: isUniqueTop(classes),
        least: uniqueLeast(classes),
      },
      timeline: { lanes, years, eras },
      milestones: accountWide,
      gap,
      verdict: ranked[0],
      alsoTrue: ranked.slice(1).filter((a) => a.score >= 0.4 && a.key !== "adventurer").slice(0, 2),
    };
  }

  window.BnetJourney = { build, RACE_FACTION };
})();
