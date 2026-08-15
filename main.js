// Boot: finish the OAuth callback if we're returning from Battle.net, then
// walk the four reads the journey needs, showing progress as it goes.
//
// The reads degrade independently. Character detail and achievement history
// are both slow, per-character, and failure-prone; either can drop out and
// still leave a journey worth reading, so neither is allowed to abort the run.
(function () {
  const fmt = new Intl.NumberFormat();

  const els = {
    landing: document.getElementById("landing"),
    loading: document.getElementById("loading"),
    steps: document.getElementById("load-steps"),
    journey: document.getElementById("journey"),
    error: document.getElementById("error"),
    login: document.getElementById("login-btn"),
    logout: document.getElementById("logout-btn"),
  };

  const STEPS = [
    ["characters", "Reading your characters"],
    ["detail", "Checking when each was last played"],
    ["history", "Reconstructing your history from achievements"],
    ["verdict", "Working out who you've been"],
  ];

  const stepNodes = new Map();

  function initSteps() {
    els.steps.replaceChildren();
    stepNodes.clear();

    for (const [id, label] of STEPS) {
      const li = document.createElement("li");
      li.className = "load-step";
      li.dataset.state = "pending";

      const text = document.createElement("span");
      text.className = "load-step-label";
      text.textContent = label;

      const note = document.createElement("span");
      note.className = "load-step-note";

      li.append(text, note);
      els.steps.appendChild(li);
      stepNodes.set(id, { li, note });
    }
  }

  function setStep(id, state, note) {
    const node = stepNodes.get(id);
    if (!node) return;
    node.li.dataset.state = state;
    node.note.textContent = note || "";
  }

  function show(view) {
    els.landing.hidden = view !== "landing";
    els.loading.hidden = view !== "loading";
    els.journey.hidden = view !== "journey";
    els.logout.hidden = view === "landing";
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

  async function loadJourney(token) {
    show("loading");
    initSteps();

    let characters;
    try {
      setStep("characters", "active");
      characters = await window.BnetProfile.fetchCharacters(token);
    } catch (err) {
      showError(err.message);
      return;
    }

    if (characters.length === 0) {
      showError("No World of Warcraft characters found on this Battle.net account.");
      return;
    }
    setStep("characters", "done", `${characters.length} found`);

    setStep("detail", "active");
    let lastLogins = new Map();
    try {
      lastLogins = await window.BnetProfile.fetchLastLogins(token, characters, (done, total) =>
        setStep("detail", "active", `${done} / ${total}`)
      );
      setStep("detail", "done", `${lastLogins.size} dated`);
    } catch (err) {
      setStep("detail", "failed", "unavailable");
      console.warn("Character detail unavailable:", err.message);
    }

    setStep("history", "active");
    let activity = null;
    try {
      activity = await window.BnetActivity.fetchActivity(token, characters, (done, total) =>
        setStep("history", "active", `${done} / ${total}`)
      );
      setStep("history", "done", `${fmt.format(activity.entries.length)} dated achievements`);
    } catch (err) {
      setStep("history", "failed", "unavailable — the recap will skip the timeline");
      console.warn("Achievement history unavailable:", err.message);
    }

    setStep("verdict", "active");
    const journey = window.BnetJourney.build({ characters, activity, lastLogins });
    setStep("verdict", "done", journey.verdict.title);

    window.BnetJourneyUI.render(els.journey, journey, activity, token);
    show("journey");
    window.scrollTo({ top: 0 });
  }

  els.login.addEventListener("click", () => window.BnetAuth.login());
  els.logout.addEventListener("click", () => {
    window.BnetAuth.logout();
    els.journey.replaceChildren();
    clearError();
    show("landing");
  });

  document.getElementById("redirect-uri").textContent = window.OAUTH_CONFIG.redirectUri;

  (async () => {
    const result = window.BnetAuth.parseCallback();
    if (result && result.error) {
      showError(result.error);
      return;
    }
    if (result && result.code) {
      show("loading");
      initSteps();
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
