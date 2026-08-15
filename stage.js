// The loading stage — what replaces the landing page from the moment "Begin
// Journey" is pressed until the recap is ready to scroll.
//
// This exists because the wait is long and unavoidable: the journey costs two
// Blizzard reads per character, so a large account genuinely takes the better
// part of a minute. A spinner for that long reads as "broken". So the wait is
// staged instead — real progress, the real characters being read as they go
// past, and real facts surfacing the moment they become derivable. Everything
// on screen here is true; none of it is filler animation waiting on a promise.
//
// Purely presentational. It knows nothing about Battle.net — main.js drives
// it, because main.js is what holds the data as it arrives.
(function () {
  const RING_RADIUS = 54;
  const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
  const STREAM_MAX = 4;
  const FACT_INTERVAL = 4200;

  // Rail order. The copy is the honest description of what each read costs —
  // "one read each" is why the wait is what it is.
  const PHASES = [
    ["connect", "Sign in", "Opening Battle.net", "Handing you over to Blizzard to authorise this."],
    ["characters", "Roster", "Finding your characters", "Reading every character on your account."],
    ["detail", "Dates", "Dating your roster", "One read each, for when they were last played."],
    ["history", "History", "Digging up your past", "Every achievement you earned, and the day you earned it."],
    ["verdict", "Verdict", "Working out who you've been", "Scoring your account against every archetype."],
  ];

  const COUNTERS = [
    ["characters", "characters"],
    ["achievements", "achievements read"],
    ["years", "years on record"],
  ];

  let nodes = null;
  const railNodes = new Map();
  const counterNodes = new Map();
  const facts = [];
  let factIndex = 0;
  let factTimer = null;
  let displayedPct = 0;

  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function svgEl(tag, attrs) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const key of Object.keys(attrs)) node.setAttribute(key, attrs[key]);
    return node;
  }

  // Builds the stage into `container`, replacing whatever was there. Safe to
  // call again — a second run resets every counter, so signing out and back in
  // doesn't start from the last account's numbers.
  function mount(container) {
    reset();

    // The same faction wash as the landing hero, so the transition out of it
    // reads as the same page continuing rather than a different screen.
    const orbs = el("div", "hero-orbs");
    orbs.setAttribute("aria-hidden", "true");
    orbs.append(el("span", "hero-orb hero-orb-a"), el("span", "hero-orb hero-orb-h"));

    const inner = el("div", "stage-inner");

    inner.appendChild(el("p", "stage-eyebrow", "Your WoW Journey"));

    // --- progress ring ---
    const ringWrap = el("div", "stage-ring-wrap");
    const ring = svgEl("svg", {
      class: "stage-ring",
      viewBox: "0 0 128 128",
      role: "progressbar",
      "aria-valuemin": "0",
      "aria-valuemax": "100",
      "aria-valuenow": "0",
      "aria-label": "Rebuilding your journey",
    });
    const spinner = svgEl("circle", { class: "stage-ring-spin", cx: "64", cy: "64", r: "61" });
    const track = svgEl("circle", { class: "stage-ring-track", cx: "64", cy: "64", r: String(RING_RADIUS) });
    const fill = svgEl("circle", { class: "stage-ring-fill", cx: "64", cy: "64", r: String(RING_RADIUS) });
    fill.style.strokeDasharray = String(RING_CIRCUMFERENCE);
    fill.style.strokeDashoffset = String(RING_CIRCUMFERENCE);
    ring.append(spinner, track, fill);

    const pct = el("span", "stage-ring-pct");
    const pctValue = el("span", "stage-ring-pct-value", "0");
    pct.append(pctValue, el("span", "stage-ring-pct-sign", "%"));
    ringWrap.append(ring, pct);
    inner.appendChild(ringWrap);

    // --- headline + live note ---
    const headline = el("h2", "stage-headline", PHASES[0][2]);
    const note = el("p", "stage-note", PHASES[0][3]);
    inner.append(headline, note);

    // --- phase rail ---
    // aria-hidden: the status line below announces phase changes once, which
    // is what a screen reader needs. Announcing the rail too would say it all
    // twice.
    const rail = el("ol", "stage-rail");
    rail.setAttribute("aria-hidden", "true");
    for (const [id, short] of PHASES) {
      const li = el("li", "stage-rail-step");
      li.dataset.state = "pending";
      li.appendChild(el("span", "stage-rail-dot"));
      li.appendChild(el("span", "stage-rail-label", short));
      rail.appendChild(li);
      railNodes.set(id, li);
    }
    inner.appendChild(rail);

    // --- character stream ---
    // Decorative: the same characters are all named in the recap itself, and
    // a feed that reorders itself several times a second is noise to a screen
    // reader, not information.
    const stream = el("div", "stage-stream");
    stream.setAttribute("aria-hidden", "true");
    inner.appendChild(stream);

    // --- counters ---
    const counters = el("dl", "stage-counters");
    for (const [id, label] of COUNTERS) {
      // dt before dd, as the markup requires; the tile is column-reverse so
      // the value still reads above its label.
      const tile = el("div", "stage-counter");
      const value = el("dd", "stage-counter-value", "—");
      tile.append(el("dt", "stage-counter-label", label), value);
      counters.appendChild(tile);
      counterNodes.set(id, { node: value, current: 0 });
    }
    inner.appendChild(counters);

    const fact = el("p", "stage-fact");
    fact.setAttribute("aria-hidden", "true");
    inner.appendChild(fact);

    const warn = el("p", "stage-warn");
    warn.hidden = true;
    inner.appendChild(warn);

    const status = el("p", "stage-status sr-only");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    inner.appendChild(status);

    container.replaceChildren(orbs, inner);
    nodes = { ring, fill, pctValue, headline, note, stream, fact, warn, status };
    return nodes;
  }

  function reset() {
    railNodes.clear();
    counterNodes.clear();
    facts.length = 0;
    factIndex = 0;
    displayedPct = 0;
    if (factTimer) clearInterval(factTimer);
    factTimer = null;
    nodes = null;
  }

  // Advances to `id`: marks everything before it done, everything after it
  // pending. Driving it this way rather than per-step means a phase that gets
  // skipped can't leave a stale "active" dot behind.
  function phase(id) {
    if (!nodes) return;
    const index = PHASES.findIndex((p) => p[0] === id);
    if (index === -1) return;

    PHASES.forEach(([stepId], i) => {
      const li = railNodes.get(stepId);
      if (!li) return;
      // A phase that already failed keeps saying so; it is not "done".
      if (li.dataset.state === "failed" && i < index) return;
      li.dataset.state = i < index ? "done" : i === index ? "active" : "pending";
    });

    nodes.headline.textContent = PHASES[index][2];
    nodes.note.textContent = PHASES[index][3];
    nodes.status.textContent = PHASES[index][2];
  }

  // Replaces the line under the headline — used for "12 / 47" style detail
  // while a phase grinds. Deliberately not announced: it changes several times
  // a second on a big roster.
  function note(text) {
    if (nodes) nodes.note.textContent = text;
  }

  // Marks a phase as having failed and says so on screen. Not fatal — every
  // read here degrades independently, and the recap survives losing any one
  // of them.
  function fail(id, message) {
    if (!nodes) return;
    const li = railNodes.get(id);
    if (li) li.dataset.state = "failed";
    nodes.warn.textContent = message;
    nodes.warn.hidden = false;
  }

  // `fraction` is 0..1 across the whole run, not within a phase.
  function progress(fraction) {
    if (!nodes) return;
    const clamped = Math.max(0, Math.min(1, fraction));
    const whole = Math.round(clamped * 100);

    nodes.fill.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - clamped));
    nodes.ring.setAttribute("aria-valuenow", String(whole));

    // Only ever climbs. Phase weights are estimates, and a percentage that
    // ticks backwards looks like a bug even when the estimate was the thing
    // at fault.
    if (whole > displayedPct) {
      displayedPct = whole;
      nodes.pctValue.textContent = String(whole);
    }
  }

  // Pushes one character into the stream: newest first, oldest falling off the
  // end. The icon is best-effort like everywhere else — an unresolved one just
  // leaves the slot empty rather than a broken-image glyph.
  function spot(character) {
    if (!nodes || !character) return;

    const chip = el("span", "stage-chip");
    if (character.faction) chip.dataset.faction = character.faction;

    const icon = el("span", "wow-icon stage-chip-icon");
    chip.append(icon, el("span", "stage-chip-name", character.name));
    if (character.level) chip.appendChild(el("span", "stage-chip-level", String(character.level)));

    nodes.stream.prepend(chip);
    while (nodes.stream.children.length > STREAM_MAX) {
      nodes.stream.lastElementChild.remove();
    }

    window.BnetCharts.fillIcon(icon, () => window.BnetMedia.classIcon(character.classId));
  }

  // Sets a counter tile. Numbers count up to their new value rather than
  // snapping, which is most of what makes an arriving number feel like an
  // arriving number.
  function counter(id, value) {
    const entry = counterNodes.get(id);
    if (!entry) return;

    if (typeof value !== "number" || !isFinite(value)) {
      entry.node.textContent = value == null ? "—" : String(value);
      return;
    }
    if (reduced()) {
      entry.current = value;
      entry.node.textContent = format(value);
      return;
    }

    const from = entry.current;
    const start = performance.now();
    const duration = 650;
    entry.current = value;

    // Tagged so a later update cancels this one mid-flight instead of the two
    // fighting over the same node.
    const run = {};
    entry.run = run;

    function step(now) {
      if (entry.run !== run) return;
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      entry.node.textContent = format(Math.round(from + (value - from) * eased));
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  const numberFormat = new Intl.NumberFormat();
  function format(n) {
    return numberFormat.format(n);
  }

  // Adds a fact to the rotation and shows it immediately — a fact is added at
  // the moment it becomes true, and that moment is the interesting part.
  function fact(text) {
    if (!nodes || !text) return;
    facts.push(text);
    factIndex = facts.length - 1;
    showFact();

    if (!factTimer) {
      factTimer = setInterval(() => {
        if (facts.length < 2) return;
        factIndex = (factIndex + 1) % facts.length;
        showFact();
      }, FACT_INTERVAL);
    }
  }

  function showFact() {
    const node = nodes.fact;
    node.textContent = facts[factIndex];
    if (reduced()) return;
    // Restart the enter animation: removing the class, forcing a reflow and
    // re-adding it is the only reliable way to replay a CSS animation.
    node.classList.remove("is-entering");
    void node.offsetWidth;
    node.classList.add("is-entering");
  }

  // Stops the rotation timer. Called when the stage is leaving — an interval
  // still running behind the rendered recap is a leak, cheap as it is.
  function stop() {
    if (factTimer) clearInterval(factTimer);
    factTimer = null;
  }

  window.BnetStage = { mount, phase, note, fail, progress, spot, counter, fact, stop };
})();
