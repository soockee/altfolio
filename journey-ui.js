// Renders the journey as a sequence of full-height chapters, each one a
// headline written from the data plus the chart that backs it up.
//
// Every headline here is generated, not templated onto a fixed sentence: the
// faction chapter reads differently for someone who has never defected than
// for someone with a Blood Elf flying Alliance colours, and that difference is
// the whole point of the recap.
(function () {
  const fmt = new Intl.NumberFormat();

  function monthYear(ts) {
    return new Date(ts).toLocaleDateString(undefined, { year: "numeric", month: "long", timeZone: "UTC" });
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  // Builds the shell every chapter shares and hands back the slot the chapter
  // body goes into.
  function chapter(id, eyebrow, headline, lede) {
    const section = el("section", "chapter");
    section.id = id;

    const inner = el("div", "chapter-inner");
    inner.appendChild(el("p", "chapter-eyebrow", eyebrow));
    inner.appendChild(el("h2", "chapter-headline", headline));
    if (lede) inner.appendChild(el("p", "chapter-lede", lede));

    const body = el("div", "chapter-body");
    inner.appendChild(body);
    section.appendChild(inner);

    return { section, body };
  }

  function callout(text) {
    return el("p", "chapter-callout", text);
  }

  // A callout paired with a character's portrait — for the one or two
  // moments the recap names a specific character rather than a statistic.
  // The portrait is best-effort: `character-media` can 404 for a very old or
  // very low-level character, and the frame just stays empty when it does,
  // same fade-in-or-nothing treatment as every other icon in the journey.
  function spotlight(character, text, token) {
    const wrap = el("div", "spotlight");
    const portrait = el("span", "wow-icon spotlight-portrait");
    wrap.append(portrait, el("p", "spotlight-text", text));

    if (token) {
      window.BnetMedia.characterMedia(token, character).then((media) => {
        const src = media && (media.avatar || media.main);
        if (!src) return;
        const img = document.createElement("img");
        img.src = src;
        img.alt = `${character.name}, a ${character.race} ${character.class}`;
        img.loading = "lazy";
        img.decoding = "async";
        img.onerror = () => img.remove();
        portrait.appendChild(img);
      });
    }

    return wrap;
  }

  // --- chapters -------------------------------------------------------------

  function coldOpen(journey) {
    const t = journey.totals;
    const years = t.daysTracked ? Math.floor(t.daysTracked / 365) : null;

    const { section, body } = chapter(
      "chapter-open",
      "Altfolio",
      "Let's look back at your time in Azeroth.",
      "Reconstructed from what World of Warcraft still remembers about you."
    );

    const hero = el("div", "hero");
    if (years && years >= 1) {
      hero.appendChild(el("span", "hero-value", String(years)));
      hero.appendChild(el("span", "hero-unit", years === 1 ? "year on the record" : "years on the record"));
    } else {
      hero.appendChild(el("span", "hero-value", String(t.characters)));
      hero.appendChild(el("span", "hero-unit", t.characters === 1 ? "character" : "characters"));
    }
    body.appendChild(hero);

    const tiles = [
      { label: "Characters", value: fmt.format(t.characters) },
      { label: "Classes played", value: String(t.classes) },
      { label: "Races played", value: String(t.races) },
      { label: "Realms", value: String(t.realms) },
    ];
    if (t.maxLevel !== null) tiles.push({ label: "Highest level", value: String(t.maxLevel) });
    if (t.achievements) tiles.push({ label: "Achievements dated", value: fmt.format(t.achievements) });

    const kpis = el("div", "kpi-row");
    body.appendChild(kpis);
    window.BnetCharts.renderKpiRow(kpis, tiles);

    const oldestMilestone = journey.milestones[0];
    if (t.firstSeen) {
      body.appendChild(
        callout(
          oldestMilestone && oldestMilestone.name
            ? `The oldest thing still on your record is “${oldestMilestone.name}”, from ${monthYear(oldestMilestone.timestamp)}.`
            : `The oldest surviving timestamp on your account is from ${monthYear(t.firstSeen)}.`
        )
      );
    }

    return section;
  }

  function factionsChapter(journey) {
    const f = journey.factions;
    const changers = f.changers;

    let headline;
    let lede = null;

    if (changers.length > 0) {
      headline = "You have changed sides.";
      const names = changers.slice(0, 3).map((c) => `${c.name} the ${c.race}`).join(", ");
      lede = `${names} ${changers.length === 1 ? "is" : "are"} flying ${changers[0].faction} colours — and that race cannot start there. Someone paid for a faction change.`;
    } else if (f.total === 0) {
      headline = "No faction on file.";
    } else if (f.minorityShare === 0) {
      headline = `You have always been ${f.dominant}.`;
      lede = `All ${f.total} of your characters, no exceptions.`;
    } else if (f.dominantShare >= 0.8) {
      headline = `${f.dominant}, with the occasional lapse.`;
      lede = `${Math.round(f.dominantShare * 100)}% of your roster picked one side and stayed there.`;
    } else {
      headline = "You can't decide.";
      lede = `${f.alliance} Alliance, ${f.horde} Horde. The war effort is not helped by this.`;
    }

    const { section, body } = chapter("chapter-factions", "Chapter one · Factions", headline, lede);

    const viz = el("div");
    body.appendChild(viz);
    window.BnetCharts.renderTugOfWar(
      viz,
      { label: "Alliance", count: f.alliance },
      { label: "Horde", count: f.horde }
    );

    if (changers.length > 0) {
      body.appendChild(
        callout(
          `Faction changes aren't reported by the API. We spot them by catching a race somewhere it can't have started.`
        )
      );
    }

    return section;
  }

  function racesChapter(journey, token) {
    const r = journey.races;
    const total = journey.totals.characters;

    let headline;
    let lede = null;

    if (!r.top) {
      headline = "No races on file.";
    } else if (r.counts.length === 1) {
      headline = `Every single one of you is ${r.top.label}.`;
    } else if (r.topIsUnique && r.top.count / total >= 0.4) {
      headline = `You are, mostly, ${r.top.label}.`;
      lede = `${r.top.count} of ${total} characters — and ${r.counts.length - 1} other ${r.counts.length === 2 ? "race" : "races"} you tried once.`;
    } else {
      headline = `${r.counts.length} races, no favourites.`;
      lede = `Your most-played, ${r.top.label}, accounts for only ${r.top.count} of ${total}.`;
    }

    const { section, body } = chapter("chapter-races", "Chapter two · Races", headline, lede);

    const viz = el("div");
    body.appendChild(viz);
    window.BnetCharts.renderBarChart(viz, "Race", r.counts);

    if (r.firstCharacter) {
      const c = r.firstCharacter.character;
      body.appendChild(
        spotlight(
          c,
          `The first traces of you in Azeroth are ${c.name}, a ${c.race} ${c.class} on ${c.realm}, back in ${monthYear(r.firstCharacter.firstSeen)}.`,
          token
        )
      );
    }

    return section;
  }

  function classesChapter(journey) {
    const c = journey.classes;
    const total = journey.totals.characters;

    let headline;
    let lede = null;

    if (!c.top) {
      headline = "No classes on file.";
    } else if (c.counts.length === 1) {
      headline = "You have played exactly one class. Ever.";
      lede = `${c.top.label}, ${c.top.count} time${c.top.count === 1 ? "" : "s"} over.`;
    } else if (c.topIsUnique && c.top.count >= 3 && c.top.count / total >= 0.35) {
      headline = `You keep coming back to ${c.top.label}.`;
      lede = `${c.top.count} of ${total} characters, across ${c.counts.length} classes tried.`;
    } else {
      headline = `${c.counts.length} classes, barely a repeat.`;
      lede = `Even ${c.top.label}, your most-played, is only ${c.top.count} of ${total}.`;
    }

    const { section, body } = chapter("chapter-classes", "Chapter three · Classes", headline, lede);

    // Class name -> id, so the bar chart can resolve each row's icon. One
    // exemplar per name is enough; every character of a given class shares
    // the same icon.
    const classIdByName = new Map();
    for (const ch of journey.characters) {
      if (ch.class && ch.classId && !classIdByName.has(ch.class)) classIdByName.set(ch.class, ch.classId);
    }

    const viz = el("div");
    body.appendChild(viz);
    // When there is a clear favourite the story is "this one is the point"
    // rather than "tell these apart", so it takes the accent and the rest
    // recede. A tie at the top gets a flat chart instead — highlighting one of
    // three equal bars would assert a favourite the data doesn't show.
    window.BnetCharts.renderBarChart(viz, "Class", c.counts, {
      emphasis: c.topIsUnique ? c.top.label : null,
      icon: (label) => window.BnetMedia.classIcon(classIdByName.get(label)),
    });

    if (c.least && c.counts.length > 2) {
      body.appendChild(
        callout(`You gave ${c.least.label} exactly ${c.least.count} attempt${c.least.count === 1 ? "" : "s"}. It shows.`)
      );
    }

    return section;
  }

  function reignRange(reign) {
    return reign.from === reign.to ? String(reign.from) : `${reign.from}–${reign.to}`;
  }

  function timelineChapter(journey, token) {
    const { lanes, years, eras, reigns } = journey.timeline;

    // The character who held the account for the most years, ties broken by
    // how much they actually earned while holding it.
    const longestReign = reigns.reduce((best, reign) => {
      if (!best) return reign;
      if (reign.years.length !== best.years.length) return reign.years.length > best.years.length ? reign : best;
      return reign.count > best.count ? reign : best;
    }, null);

    let headline;
    let lede = null;

    if (years.length === 0) {
      headline = "No dated history survived.";
      lede = "The API only remembers when achievements were earned, and none of yours carry a usable date.";
    } else if (years.length === 1) {
      headline = `All of it happened in ${years[0]}.`;
    } else {
      headline = `${years[0]} to ${years[years.length - 1]}, at a glance.`;
      // Eras only exist for years busy enough to have a clear leader, so an
      // account that never had a heavy year gets no "main" claim at all.
      const mainNames = [];
      for (const reign of reigns) {
        if (!mainNames.includes(reign.character.name)) mainNames.push(reign.character.name);
      }
      if (mainNames.length > 1) {
        // Named in the order they held the account — the handovers are the
        // story, and a count alone doesn't tell you who they were.
        const shown = mainNames.slice(0, 4);
        lede = `${shown.join(", then ")}${mainNames.length > shown.length ? ", and others" : ""} — your main has changed hands ${mainNames.length - 1} time${mainNames.length === 2 ? "" : "s"}.`;
      } else if (mainNames.length === 1) {
        lede = `${mainNames[0]} carried every year busy enough to count.`;
      } else {
        lede = `${lanes.length} characters, none of them ever quite the main.`;
      }
    }

    const { section, body } = chapter("chapter-timeline", "Chapter four · The timeline", headline, lede);

    const viz = el("div");
    body.appendChild(viz);
    window.BnetCharts.renderTimeline(viz, lanes, years, { eras, reigns });

    if (longestReign) {
      const c = longestReign.character;
      const span = longestReign.years.length;
      body.appendChild(
        spotlight(
          c,
          `Nobody held it longer than ${c.name}, your ${c.race} ${c.class} on ${c.realm} — main for ${span} year${span === 1 ? "" : "s"} (${reignRange(longestReign)}), ${fmt.format(longestReign.count)} achievements while it lasted.`,
          token
        )
      );
    }

    if (journey.gap && journey.gap.months >= 12) {
      body.appendChild(
        callout(
          `Your longest silence ran about ${Math.round(journey.gap.months / 12)} year${journey.gap.months >= 24 ? "s" : ""}, from ${monthYear(journey.gap.from)} to ${monthYear(journey.gap.to)}.`
        )
      );
    } else if (eras.length) {
      const last = eras[eras.length - 1];
      body.appendChild(callout(`${last.year} belonged to ${last.character.name}, with ${last.count} achievements.`));
    }

    return section;
  }

  function verdictChapter(journey) {
    const v = journey.verdict;

    const section = el("section", "chapter chapter-verdict");
    section.id = "chapter-verdict";

    const inner = el("div", "chapter-inner");
    inner.appendChild(el("p", "chapter-eyebrow", "The verdict"));

    const card = el("div", "verdict-card");
    card.appendChild(el("p", "verdict-kicker", "Your WoW journey says you are"));
    card.appendChild(el("h2", "verdict-title", v.title));
    card.appendChild(el("p", "verdict-tagline", v.tagline));

    const evidence = el("ul", "verdict-evidence");
    for (const line of v.evidence) evidence.appendChild(el("li", null, line));
    card.appendChild(evidence);

    const stats = el("div", "verdict-stats");
    const t = journey.totals;
    const statPairs = [
      [String(t.characters), t.characters === 1 ? "character" : "characters"],
      [String(t.classes), t.classes === 1 ? "class" : "classes"],
      [String(t.races), t.races === 1 ? "race" : "races"],
    ];
    if (t.activeYears) statPairs.push([String(t.activeYears), t.activeYears === 1 ? "active year" : "active years"]);
    for (const [value, label] of statPairs) {
      const stat = el("div", "verdict-stat");
      stat.appendChild(el("span", "verdict-stat-value", value));
      stat.appendChild(el("span", "verdict-stat-label", label));
      stats.appendChild(stat);
    }
    card.appendChild(stats);
    inner.appendChild(card);

    if (journey.alsoTrue.length) {
      const also = el("div", "verdict-also");
      also.appendChild(el("p", "verdict-also-label", "Also true of you"));
      const list = el("ul", "verdict-also-list");
      for (const a of journey.alsoTrue) {
        const li = el("li");
        li.appendChild(el("strong", null, a.title));
        li.appendChild(el("span", null, ` — ${a.tagline}`));
        list.appendChild(li);
      }
      also.appendChild(list);
      inner.appendChild(also);
    }

    const actions = el("div", "verdict-actions");

    const download = el("button", "btn btn-primary", "Download your card");
    download.type = "button";
    download.addEventListener("click", () => window.BnetShareCard.download(journey));
    actions.appendChild(download);

    const copy = el("button", "btn", "Copy as text");
    copy.type = "button";
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(window.BnetShareCard.toText(journey));
        copy.textContent = "Copied";
      } catch {
        copy.textContent = "Couldn't copy";
      }
      setTimeout(() => (copy.textContent = "Copy as text"), 2000);
    });
    actions.appendChild(copy);

    inner.appendChild(actions);
    section.appendChild(inner);
    return section;
  }

  // The dashboard the journey is built on, kept at the end for anyone who
  // wants the numbers rather than the story.
  function numbersChapter(journey, activity) {
    const { section, body } = chapter(
      "chapter-numbers",
      "Appendix",
      "All the numbers.",
      "The same data, without the narration."
    );

    if (activity && activity.entries.length) {
      const viz = el("div");
      body.appendChild(viz);
      window.BnetCharts.renderTimeSeries(
        viz,
        "Activity over time",
        window.BnetActivity.monthlyTotals(activity.entries),
        { unit: "achievements" }
      );
    }

    const roster = el("div", "viz-root chart-card");
    const table = el("table", "chart-table roster-table");
    const thead = el("thead");
    const headRow = el("tr");
    for (const label of ["Character", "Realm", "Level", "Race", "Class", "Faction"]) {
      const th = el("th", null, label);
      th.scope = "col";
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = el("tbody");
    const sorted = journey.characters.slice().sort((a, b) => (b.level || 0) - (a.level || 0));
    for (const c of sorted) {
      const tr = el("tr");
      const th = el("th", null, c.name);
      th.scope = "row";
      tr.appendChild(th);
      for (const value of [c.realm, c.level, c.race]) {
        tr.appendChild(el("td", null, value === undefined || value === null ? "—" : String(value)));
      }

      const classTd = el("td");
      if (c.class) {
        const inline = el("span", "roster-class-inline");
        const iconSlot = el("span", "wow-icon roster-class-icon");
        inline.append(iconSlot, document.createTextNode(c.class));
        classTd.appendChild(inline);
        window.BnetCharts.fillIcon(iconSlot, () => window.BnetMedia.classIcon(c.classId));
      } else {
        classTd.textContent = "—";
      }
      tr.appendChild(classTd);

      tr.appendChild(el("td", null, c.faction === undefined || c.faction === null ? "—" : String(c.faction)));
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    roster.appendChild(el("h3", "chart-title", "Every character"));
    roster.appendChild(table);
    body.appendChild(roster);

    // Per-character reads fail routinely (low level, recent rename or
    // transfer). Say so rather than quietly presenting a partial recap as
    // complete.
    if (activity && activity.failures.length) {
      const n = activity.failures.length;
      body.appendChild(
        callout(
          `${n} character${n === 1 ? "'s" : "s'"} history couldn't be read — ${activity.failures
            .slice(0, 3)
            .map((f) => f.character.name)
            .join(", ")}${n > 3 ? ", and others" : ""}. They're missing from the timeline above.`
        )
      );
    }

    body.appendChild(
      callout(
        "Dates are reconstructed from achievement timestamps and last-login. The API has no character-creation date, so “first seen” is a lower bound, not a birthday."
      )
    );

    return section;
  }

  // --- assembly -------------------------------------------------------------

  function revealOnScroll(root) {
    const chapters = root.querySelectorAll(".chapter");
    // Optional and silent unless the sound toggle is on — see audio.js.
    const audio = window.BnetAudio;

    // Reduced motion suppresses the reveal animation, not the sound cue — the
    // two are separate preferences and someone who turned the score on still
    // wants the chapters to land. So the chapters are shown immediately, but
    // the observer is still built, and still only fires as each one actually
    // scrolls into view.
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (still) for (const c of chapters) c.classList.add("is-visible");
    if (!("IntersectionObserver" in window)) {
      for (const c of chapters) c.classList.add("is-visible");
      return;
    }

    const order = new Map();
    chapters.forEach((c, i) => order.set(c, i));

    // Nothing is ever unobserved, so chapters keep ringing when you scroll back
    // up — the page stays responsive in both directions rather than going quiet
    // the moment you have seen everything once. `inside` is what makes that
    // safe: the cue fires on the transition into view, not on every callback,
    // so a chapter sitting on the threshold can't stutter.
    //
    // The reveal itself stays one-way. Re-animating text you have already read
    // on the way back up is motion for its own sake, and re-hiding it would be
    // worse.
    const inside = new Set();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const chapter = entry.target;
          if (!entry.isIntersecting) {
            inside.delete(chapter);
            continue;
          }
          if (!still) chapter.classList.add("is-visible");
          if (inside.has(chapter)) continue;
          inside.add(chapter);
          // Keyed to the chapter's position rather than to arrival order, so
          // the line rises as you read down, descends as you go back, and
          // doesn't reshuffle if two cross the threshold in the same frame.
          if (audio) audio.cue("section", order.get(chapter));
        }
      },
      { threshold: 0.15 }
    );
    for (const c of chapters) observer.observe(c);
  }

  function render(container, journey, activity, token) {
    container.replaceChildren();
    container.appendChild(coldOpen(journey));
    container.appendChild(factionsChapter(journey));
    container.appendChild(racesChapter(journey, token));
    container.appendChild(classesChapter(journey));
    if (journey.hasHistory) container.appendChild(timelineChapter(journey, token));
    container.appendChild(verdictChapter(journey));
    container.appendChild(numbersChapter(journey, activity));
    revealOnScroll(container);
  }

  window.BnetJourneyUI = { render };
})();
