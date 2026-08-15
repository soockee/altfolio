// Boot: finish the OAuth callback if we're returning from Battle.net, then
// walk the four reads the journey needs, staging the wait as it goes.
//
// The reads degrade independently. Character detail and achievement history
// are both slow, per-character, and failure-prone; either can drop out and
// still leave a journey worth reading, so neither is allowed to abort the run.
//
// This file owns the pacing of the loading stage as well as the reads, because
// it is the only thing that holds the data as it arrives. stage.js renders;
// everything it is told here is a fact that just became true.
(function () {
  const fmt = new Intl.NumberFormat();
  const stage = window.BnetStage;
  // Optional by design, so a stand-in keeps an absent or failed audio.js from
  // taking the recap down with it — unlike the stage, nothing here is load-bearing.
  const audio = window.BnetAudio || {
    mount() {}, cue() {}, intensity() {}, stop() {}, rewind() {}, enabled: () => false,
  };

  const els = {
    landing: document.getElementById("landing"),
    loading: document.getElementById("loading"),
    journey: document.getElementById("journey"),
    error: document.getElementById("error"),
    login: document.getElementById("login-btn"),
    logout: document.getElementById("logout-btn"),
    sound: document.getElementById("sound-btn"),
    soundHint: document.getElementById("sound-hint"),
  };

  // Share of the total wait each phase is worth. Achievement history is by far
  // the longest — a full read per character, of the largest payload — so it
  // owns most of the bar. The rest are weighted to match observed timings
  // rather than split evenly, since an evenly-split bar spends most of the
  // wait apparently frozen inside one segment.
  const SPAN = {
    connect: [0, 0.04],
    characters: [0.04, 0.1],
    detail: [0.1, 0.42],
    history: [0.42, 0.95],
    verdict: [0.95, 1],
  };

  // Screen and score are told the same thing at the same time, from here.
  // Neither module knows about the other; this file is the only place that
  // knows a phase changed, so it is the only place either of them hears it.
  function at(id, fraction = 1) {
    const [from, to] = SPAN[id];
    const overall = from + (to - from) * Math.max(0, Math.min(1, fraction));
    stage.progress(overall);
    audio.intensity(overall);
  }

  function phase(id) {
    stage.phase(id);
    audio.cue("phase", id);
  }

  function spot(character) {
    stage.spot(character);
    audio.cue("spot");
  }

  const monthYear = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });

  // The one place the visible view changes. Swapping `hidden` is synchronous
  // and unconditional on purpose: the incoming view is fading in via CSS on
  // top of a swap that has already happened, rather than the swap itself being
  // deferred to an animation callback.
  //
  // The earlier attempt here used the View Transitions API, which is a nicer
  // cross-fade and the obviously modern choice — but its DOM-update callback
  // is driven by the compositor, and when that doesn't run promptly the swap
  // doesn't happen at all, leaving the landing page up while the reads run
  // behind it. That is the exact failure this screen exists to prevent, so
  // correctness wins over the nicer fade.
  function show(view) {
    // Set by the inline boot script in index.html to keep the landing page off
    // screen when we already know we're going straight to work. Once we're
    // driving the view from here, it has done its job.
    document.documentElement.classList.remove("is-booting");

    els.landing.hidden = view !== "landing";
    els.loading.hidden = view !== "loading";
    els.journey.hidden = view !== "journey";
    els.logout.hidden = view === "landing";
    if (view !== "loading") stage.stop();

    // Purely decorative. The keyframes only override the entry, so a browser
    // that never runs the animation still lands on the right final state.
    const shown = { landing: els.landing, loading: els.loading, journey: els.journey }[view];
    if (!shown) return;
    shown.classList.remove("view-enter");
    void shown.offsetWidth;
    shown.classList.add("view-enter");
  }

  function showError(message) {
    els.error.textContent = message;
    els.error.hidden = false;
    show("landing");
  }

  function clearError() {
    els.error.hidden = true;
    els.error.textContent = "";
  }

  // --- facts ---------------------------------------------------------------
  // Everything the stage says is derived from data already in hand. Nothing
  // here is a placeholder waiting for a promise; a fact appears at the moment
  // it becomes true, which is why they arrive staggered through the wait.

  function rosterFacts(characters) {
    const out = [];
    const realms = new Set(characters.map((c) => c.realm).filter(Boolean));
    const classes = window.BnetProfile.countBy(characters, "class");
    const races = window.BnetProfile.countBy(characters, "race");
    const factions = window.BnetProfile.countBy(characters, "faction");
    const capped = characters.filter((c) => c.level >= 80).length;

    if (realms.size > 1) out.push(`Scattered across ${realms.size} realms.`);
    if (classes.length && classes[0].count > 1) {
      out.push(`${classes[0].count} of them are ${classes[0].label}s. You have a type.`);
    }
    if (races.length > 1) out.push(`${races.length} different races answered the call.`);
    if (factions.length === 1) out.push(`Every last one of them ${factions[0].label}.`);
    else if (factions.length > 1) {
      out.push(`${factions[0].count} ${factions[0].label} against ${factions[1].count} ${factions[1].label}.`);
    }
    if (capped > 0) out.push(`${capped} of them made it to the level cap.`);
    return out;
  }

  async function loadJourney(token) {
    // Built before it is shown, so the stage never appears as an empty section
    // for a frame.
    stage.mount(els.loading);
    show("loading");

    // --- roster ---
    phase("characters");
    at("characters", 0);

    let characters;
    try {
      characters = await window.BnetProfile.fetchCharacters(token);
    } catch (err) {
      showError(err.message);
      return;
    }

    if (characters.length === 0) {
      showError("No World of Warcraft characters found on this Battle.net account.");
      return;
    }

    at("characters");
    stage.counter("characters", characters.length);
    for (const fact of rosterFacts(characters)) stage.fact(fact);

    const datable = characters.filter((c) => c.realmSlug).length;

    // --- last-played dates ---
    phase("detail");
    at("detail", 0);

    let lastLogins = new Map();
    let newestLogin = 0;
    try {
      lastLogins = await window.BnetProfile.fetchLastLogins(token, characters, (done, total, settled) => {
        at("detail", done / total);
        stage.note(`${fmt.format(done)} of ${fmt.format(total)} characters dated`);
        if (settled && settled.item) spot(settled.item);
        if (settled && settled.value && typeof settled.value.last_login_timestamp === "number") {
          newestLogin = Math.max(newestLogin, settled.value.last_login_timestamp);
        }
      });
      if (newestLogin) stage.fact(`You were last in Azeroth in ${monthYear.format(new Date(newestLogin))}.`);
    } catch (err) {
      stage.fail("detail", "Couldn't read last-played dates — the recap will lean on achievements instead.");
      console.warn("Character detail unavailable:", err.message);
    }

    // --- achievement history ---
    phase("history");
    at("history", 0);

    let activity = null;
    let read = 0;
    let earliest = Infinity;
    let latest = 0;
    try {
      activity = await window.BnetActivity.fetchActivity(token, characters, (done, total, settled) => {
        at("history", done / total);
        stage.note(`${fmt.format(done)} of ${fmt.format(total)} character histories read`);
        if (settled && settled.item) spot(settled.item);
        if (!settled || !settled.value) return;

        read += settled.value.length;
        stage.counter("achievements", read);
        for (const entry of settled.value) {
          if (entry.timestamp < earliest) earliest = entry.timestamp;
          if (entry.timestamp > latest) latest = entry.timestamp;
        }

        // Derived exactly as the recap's own headline figure is, so the
        // number the stage lands on is the number the first chapter opens
        // with rather than a near-miss.
        const years = Math.floor((latest - earliest) / 86400000 / 365);
        if (years >= 1) stage.counter("years", years);
      });
      if (isFinite(earliest)) {
        stage.fact(`Your trail starts in ${monthYear.format(new Date(earliest))}.`);
      }
    } catch (err) {
      stage.fail("history", "Couldn't read achievement history — the recap will skip the timeline.");
      console.warn("Achievement history unavailable:", err.message);
    }

    // --- verdict ---
    phase("verdict");
    at("verdict", 0);

    const journey = window.BnetJourney.build({ characters, activity, lastLogins });

    at("verdict");
    stage.note(journey.verdict.title);
    audio.cue("arrive");

    window.BnetJourneyUI.render(els.journey, journey, activity, token);

    // A beat on 100% before the swap. Without it the bar completing and the
    // recap appearing are the same frame, and the run reads as if it ended
    // early rather than finished.
    await new Promise((resolve) => setTimeout(resolve, 450));

    show("journey");
    window.scrollTo({ top: 0 });

    // Not fatal, but worth saying somewhere: characters whose reads failed are
    // silently missing from the recap otherwise.
    if (activity && activity.failures.length) {
      console.warn(`${activity.failures.length} of ${datable} characters could not be read.`);
    }
  }

  els.login.addEventListener("click", () => {
    // Show the stage before handing off to Battle.net. The redirect can take a
    // second on a cold connection, and a button that does nothing visible for
    // a second is a button people press twice.
    clearError();
    stage.mount(els.loading);
    // Undoes the fade-out a previous run's arrival left behind, so signing
    // out and starting again isn't silent.
    audio.rewind();
    audio.cue("begin");
    phase("connect");
    at("connect", 0.5);
    show("loading");

    // Two frames, so the stage is actually painted before the navigation tears
    // the page down.
    requestAnimationFrame(() => requestAnimationFrame(() => window.BnetAuth.login()));
  });

  els.logout.addEventListener("click", () => {
    window.BnetAuth.logout();
    els.journey.replaceChildren();
    clearError();
    audio.stop();
    show("landing");
  });

  audio.mount(els.sound, els.soundHint);
  document.getElementById("redirect-uri").textContent = window.OAUTH_CONFIG.redirectUri;

  (async () => {
    const result = window.BnetAuth.parseCallback();
    if (result && result.error) {
      showError(result.error);
      return;
    }

    if (result && result.code) {
      show("loading");
      stage.mount(els.loading);
      phase("connect");
      at("connect", 0.5);
      try {
        await window.BnetAuth.exchangeCode(result.code);
      } catch (err) {
        showError(err.message);
        return;
      }
    }

    const token = window.BnetAuth.getAccessToken();
    if (!token) {
      show("landing");
      return;
    }
    await loadJourney(token);
  })();
})();
