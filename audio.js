// Optional score for the loading stage — off unless you ask for it.
//
// Every note here is synthesised in the browser. There is no audio file in this
// repo and nothing is fetched, for three reasons that all point the same way:
// WoW's own music is Blizzard's and not licensed to us; a CC-licensed
// orchestral bed good enough to be worth hearing is several megabytes committed
// to a zero-build static site; and a fixed recording has a fixed length, while
// the thing it has to cover is a wait that runs anywhere from eight seconds to
// well over a minute depending on how many alts you have. A loop would seam.
//
// Synthesis solves the length problem by not having one, and buys something
// better besides: the score is driven by the same data as the screen. The
// arrangement thickens as the phases advance, the drums drive harder as the
// progress ring fills, and a blade rings every time one of your characters is
// read. It isn't backing music that happens to be playing while the app works —
// it is the app working, audible.
//
// The piece is a battle cue: a four-bar loop in D, war drums and a low string
// ostinato under brass, turning on the ♭II in the fourth bar — the chord that
// does most of the work in this genre. It builds by adding players rather than
// by getting louder, which is the only way a loop survives a wait that might
// last another forty seconds.
//
// Presentational and inert by default: main.js drives this exactly as it drives
// stage.js, and every entry point is a no-op until the toggle is switched on.
(function () {
  const STORAGE_KEY = "bnet_sound";

  // D2. Low, but not so low it disappears on a laptop speaker.
  const D2 = 73.42;
  const semitone = (n) => D2 * Math.pow(2, n / 12);

  const BPM = 132;
  const BEAT = 60 / BPM;
  const STEP = BEAT / 4; // sixteenth
  const STEPS_PER_BAR = 16;
  const BARS = 4;

  // Four bars, in semitones from D. Dm twice to establish it, then the drop to
  // ♭VI and the turn onto ♭II — over the D pedal that last bar is a flat ninth,
  // and the fact that it does not resolve is the point of it.
  const PROGRESSION = [
    { root: 0, notes: [0, 3, 7] },   // Dm
    { root: 0, notes: [0, 3, 7] },   // Dm
    { root: -4, notes: [-4, 0, 3] }, // B♭
    { root: 1, notes: [1, 5, 8] },   // E♭  (♭II)
  ];

  // How many players are on. Raised by phase, never lowered mid-run, and only
  // ever applied on a bar line so an entry never lands off the grid.
  const LAYER = { connect: 0, characters: 1, detail: 2, history: 3, verdict: 4 };

  // D minor pentatonic for the per-character hits.
  const BLADE = [12, 15, 17, 19, 22, 24];
  const SPOT_MIN_GAP = 0.14;

  let ctx = null;
  let master = null;
  let comp = null;
  let reverb = null;
  let noiseBuf = null;
  let bus = {};
  let padVoices = [];
  let droneGain = null;

  let button = null;
  let hint = null;
  let on = false;
  let level = 1; // scales everything; dropped to 0 once the recap arrives

  let timer = null;
  let step = 0;
  let nextStepTime = 0;
  let layer = 0;
  let pendingLayer = 0;
  let pendingCrash = false;
  let drive = 0; // 0..1, the progress ring
  let lastSpot = 0;
  let bladeIndex = 0;

  const supported = typeof (window.AudioContext || window.webkitAudioContext) === "function";

  function stored() {
    try {
      return localStorage.getItem(STORAGE_KEY) === "on";
    } catch (e) {
      return false; // storage blocked — default off is the safe default anyway
    }
  }

  function remember(value) {
    try {
      localStorage.setItem(STORAGE_KEY, value ? "on" : "off");
    } catch (e) {
      // Not worth surfacing: the sound still works for this page view.
    }
  }

  // --- graph ---------------------------------------------------------------

  // A synthetic impulse response — exponentially decaying noise. Not a real
  // hall, but the difference between "a synth" and "a space" is almost entirely
  // reverb, and this is the whole cost of it. Kept fairly short: a long tail
  // turns sixteenth-note drums into mud.
  function impulse(seconds, decay) {
    const rate = ctx.sampleRate;
    const length = Math.floor(rate * seconds);
    const buffer = ctx.createBuffer(2, length, rate);
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
      }
    }
    return buffer;
  }

  function build() {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    ctx = new Ctor();

    master = ctx.createGain();
    master.gain.value = 0;

    // Doing real work here, not just catching accidents: drums, ostinato and
    // brass all landing on the same downbeat is the loudest moment in the loop
    // by a wide margin, and without this the mix has to be quiet enough for
    // that one instant, which makes everything else timid.
    comp = ctx.createDynamicsCompressor();
    // Glue, not limiting. An earlier 8:1 at -16dB held the whole piece at one
    // level: every layer that entered was paid for by everything already
    // playing getting quieter, so a cue whose entire structure is "more players
    // arrive" arrived at a flat line. Gentler settings let the build be a build.
    comp.threshold.value = -13;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.006;
    comp.release.value = 0.25;
    comp.connect(master);

    // Brickwall on the way out. The mix is tuned to sit well under this, but
    // the cue is additive by design — layers enter, one-shots fire on top, and
    // a phase change can land a crash on the same sample as a downbeat — so
    // "loud enough to be a battle cue" and "provably never clips" shouldn't be
    // the same tuning problem. This makes the ceiling structural instead.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -2;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.12;
    master.connect(limiter);
    limiter.connect(ctx.destination);

    reverb = ctx.createConvolver();
    reverb.buffer = impulse(2.2, 2.6);
    const wet = ctx.createGain();
    wet.gain.value = 0.42;
    reverb.connect(wet);
    wet.connect(comp);

    function makeBus(gain, send) {
      const node = ctx.createGain();
      node.gain.value = gain;
      node.connect(comp);
      if (send > 0) {
        const tap = ctx.createGain();
        tap.gain.value = send;
        node.connect(tap);
        tap.connect(reverb);
      }
      return node;
    }

    // Drums stay drier than everything else — reverb on a war drum at this
    // tempo smears the one thing that has to stay tight.
    bus = {
      drum: makeBus(0.5, 0.18),
      ost: makeBus(0.2, 0.25),
      brass: makeBus(0.26, 0.6),
      pad: makeBus(0.1, 0.9),
      drone: makeBus(0.13, 0.3),
      blade: makeBus(0.22, 0.85),
    };

    // One noise buffer, shared. Drums and cymbals read from a random offset
    // rather than each allocating their own.
    const noiseLen = Math.floor(ctx.sampleRate * 2);
    noiseBuf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
    const noise = noiseBuf.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) noise[i] = Math.random() * 2 - 1;

    // --- pedal drone: root and fifth ---
    droneGain = ctx.createGain();
    droneGain.gain.value = 1;
    droneGain.connect(bus.drone);
    for (const [freq, detune] of [[D2, -4], [D2, 5], [D2 * 1.5, 3]]) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = freq;
      osc.detune.value = detune;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 200;
      const gain = ctx.createGain();
      gain.gain.value = freq === D2 ? 0.5 : 0.28;
      osc.connect(lp);
      lp.connect(gain);
      gain.connect(droneGain);
      osc.start();
    }

    // --- sustained upper voices (the "choir") ---
    padVoices = [];
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = semitone(12);
      osc.detune.value = i % 2 ? 7 : -7;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 900;
      osc.connect(lp);
      lp.connect(gain);
      gain.connect(bus.pad);
      osc.start();
      padVoices.push({ osc, gain, lp });
    }
  }

  // --- instruments ---------------------------------------------------------

  function noiseAt(t, duration) {
    const source = ctx.createBufferSource();
    source.buffer = noiseBuf;
    source.loop = true;
    source.start(t, Math.random() * 1.5);
    source.stop(t + duration);
    return source;
  }

  // War drum. A sine dropping fast through an octave and a half is the whole
  // trick; the noise transient on top is what stops it sounding like a synth
  // tom and starts it sounding like a struck skin.
  function taiko(t, freq, gain) {
    const peak = gain * level;
    if (!ctx || peak < 0.0005) return;

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq * 3.2, t);
    osc.frequency.exponentialRampToValueAtTime(freq, t + 0.07);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(peak, t + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    osc.connect(env);
    env.connect(bus.drum);
    osc.start(t);
    osc.stop(t + 0.6);

    const hitEnv = ctx.createGain();
    hitEnv.gain.setValueAtTime(peak * 0.5, t);
    hitEnv.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 1800;
    band.Q.value = 0.8;
    const src = noiseAt(t, 0.06);
    src.connect(band);
    band.connect(hitEnv);
    hitEnv.connect(bus.drum);
  }

  // Rattle on the offbeats — the thing that makes a march feel like it is going
  // somewhere rather than just landing repeatedly.
  function rattle(t, gain) {
    const peak = gain * level;
    if (!ctx || peak < 0.0005) return;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 2600;
    const env = ctx.createGain();
    env.gain.setValueAtTime(peak, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    const src = noiseAt(t, 0.1);
    src.connect(hp);
    hp.connect(env);
    env.connect(bus.drum);
  }

  function crash(t, gain) {
    const peak = gain * level;
    if (!ctx || peak < 0.0005) return;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 3200;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(peak, t + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
    const src = noiseAt(t, 2.3);
    src.connect(hp);
    hp.connect(env);
    env.connect(bus.drum);
  }

  // Low strings, played short. The filter opening with `drive` is what turns a
  // distant figure into a snarling one without touching the fader.
  function ostinato(t, freq, duration, gain) {
    const peak = gain * level;
    if (!ctx || peak < 0.0005) return;

    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = freq;

    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 6;
    lp.frequency.setValueAtTime(freq * (5 + drive * 9), t);
    lp.frequency.exponentialRampToValueAtTime(freq * 2.2, t + duration);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(peak, t + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, t + duration);

    osc.connect(lp);
    lp.connect(env);
    env.connect(bus.ost);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  // Brass. Slower attack than the strings and a filter that falls rather than
  // rises — that shape is most of what separates a horn from a buzzer.
  function brass(t, semis, gain, duration) {
    const peak = gain * level;
    if (!ctx || peak < 0.0005) return;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(peak, t + 0.045);
    env.gain.setValueAtTime(peak, t + duration * 0.55);
    env.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    env.connect(bus.brass);

    for (const semi of semis) {
      const freq = semitone(semi);
      for (const detune of [-8, 8]) {
        const osc = ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.value = freq;
        osc.detune.value = detune;
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.Q.value = 1.2;
        lp.frequency.setValueAtTime(freq * 9, t);
        lp.frequency.exponentialRampToValueAtTime(freq * 3, t + duration * 0.6);
        osc.connect(lp);
        lp.connect(env);
        osc.start(t);
        osc.stop(t + duration + 0.05);
      }
    }
  }

  // Struck metal, for a character being read. Inharmonic partials rather than a
  // bell's tidy ones — this should read as a blade being tested, not a chime.
  function blade(t, semi, gain) {
    const peak = gain * level;
    if (!ctx || peak < 0.0005) return;
    const base = semitone(semi);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(peak, t + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    env.connect(bus.blade);

    for (const [ratio, weight] of [[1, 1], [2.76, 0.5], [5.4, 0.25]]) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = base * ratio;
      const g = ctx.createGain();
      g.gain.value = weight;
      osc.connect(g);
      g.connect(env);
      osc.start(t);
      osc.stop(t + 1);
    }
  }

  // Filtered-noise riser, for the moment a phase is asked for — it covers the
  // gap between the request and the bar line where the new layer actually
  // enters.
  function riser(duration, gain) {
    const peak = gain * level;
    if (!ctx || peak < 0.0005) return;
    const t = ctx.currentTime;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.Q.value = 1.2;
    band.frequency.setValueAtTime(240, t);
    band.frequency.exponentialRampToValueAtTime(4200, t + duration);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(peak, t + duration * 0.9);
    env.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    const src = noiseAt(t, duration);
    src.connect(band);
    band.connect(env);
    env.connect(bus.drum);
  }

  // --- sequencer -----------------------------------------------------------

  function chordAt(bar) {
    return PROGRESSION[bar % PROGRESSION.length];
  }

  function setPad(chord, t) {
    padVoices.forEach((voice, i) => {
      const semi = chord.notes[i % chord.notes.length] + (i === 2 ? 24 : 12);
      voice.osc.frequency.setTargetAtTime(semitone(semi), t, 0.08);
      voice.gain.gain.setTargetAtTime(layer >= 1 ? 0.36 : 0.22, t, 0.2);
    });
  }

  // One sixteenth. Everything is decided from the step index, so the pattern is
  // the same every loop and the arrangement changes only by which layers are
  // allowed to speak.
  function scheduleStep(index, t) {
    const s = index % STEPS_PER_BAR;
    const bar = Math.floor(index / STEPS_PER_BAR) % BARS;
    const chord = chordAt(bar);

    if (s === 0) {
      // Entries land here, never mid-bar.
      if (pendingLayer > layer) {
        layer = pendingLayer;
        if (pendingCrash) crash(t, 0.5);
        pendingCrash = false;
      }
      setPad(chord, t);
    }

    const root = semitone(chord.root + 12);
    const hard = drive > 0.62; // the back half of the history read

    // --- drums ---
    if (layer >= 1) {
      if (s === 0) taiko(t, 55, 1);
      if (s === 8) taiko(t, 55, 0.85);
    }
    if (layer >= 2) {
      if (s === 4 || s === 12) taiko(t, 82, 0.6);
      if (s % 4 === 2) rattle(t, 0.16);
    }
    if (layer >= 3) {
      if (s === 6 || s === 14) taiko(t, 65, 0.5);
      if (hard && s % 2 === 1) rattle(t, 0.1);
      // Fill across the last half-bar of the loop, so four bars never pass
      // without something changing.
      if (bar === BARS - 1 && s >= 12) taiko(t, 70 + (s - 12) * 6, 0.45);
    }
    if (layer >= 4 && s === 0 && bar === 0) crash(t, 0.32);

    // --- low strings ---
    if (layer >= 1) {
      const eighth = s % 2 === 0;
      const sixteenth = layer >= 2 && (hard || layer >= 4);
      if (eighth || sixteenth) {
        const accent = s === 0 ? 1 : s % 4 === 0 ? 0.8 : 0.55;
        ostinato(t, root, STEP * 0.9, accent);
      }
    }

    // --- brass ---
    if (layer >= 3) {
      const voicing = chord.notes.map((n) => n + 24);
      if (s === 0) brass(t, voicing, 0.5, BEAT * 1.6);
      if (s === 10 && (bar === 1 || bar === 3)) brass(t, voicing, 0.32, BEAT * 0.7);
    } else if (layer >= 2 && s === 0 && bar % 2 === 0) {
      brass(t, chord.notes.map((n) => n + 24), 0.3, BEAT * 1.4);
    }
  }

  // Lookahead scheduler. setInterval alone is far too jittery to place a
  // sixteenth on, so the timer only decides *what* to queue and the audio clock
  // decides when it sounds.
  function startSequencer() {
    if (timer) return;
    step = 0;
    nextStepTime = ctx.currentTime + 0.08;
    timer = setInterval(() => {
      if (!ctx || level === 0) return;
      while (nextStepTime < ctx.currentTime + 0.15) {
        scheduleStep(step, nextStepTime);
        nextStepTime += STEP;
        step++;
      }
    }, 25);
  }

  function stopSequencer() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  // After a suspend the audio clock has stood still while the queue pointer has
  // not; without this the scheduler would try to make up the difference all at
  // once.
  function resync() {
    if (ctx) nextStepTime = Math.max(nextStepTime, ctx.currentTime + 0.08);
  }

  // --- public cues ---------------------------------------------------------

  const CUES = {
    // Pressed "Begin Journey". Fires before the redirect tears the page down,
    // so it is deliberately short.
    begin() {
      const t = ctx.currentTime;
      taiko(t, 48, 1);
      crash(t, 0.32);
      brass(t, [12, 19, 24], 0.42, 1.1);
    },

    phase(id) {
      const next = LAYER[id];
      if (next == null) return;
      if (next > pendingLayer) {
        pendingLayer = next;
        pendingCrash = next >= 2;
        // Covers the gap until the bar line where the layer actually enters.
        if (next >= 2) riser(0.7, 0.3);
      }
      if (!timer && next >= 1) startSequencer();
    },

    // One character read. Walks up the pentatonic rather than picking at
    // random: a rising line under a filling progress ring reads as progress,
    // where random pitches read as noise.
    spot() {
      if (!ctx) return;
      const now = ctx.currentTime;
      if (now - lastSpot < SPOT_MIN_GAP) return;
      lastSpot = now;
      blade(now, BLADE[bladeIndex % BLADE.length], 0.5);
      bladeIndex++;
    },

    // The recap is ready. The whole point of a battle cue is that it stops, so
    // this is a full stop rather than another swell: the loop drops out, one
    // last chord lands, and it rings.
    arrive() {
      if (!ctx) return;
      stopSequencer();
      const t = ctx.currentTime;
      taiko(t, 46, 1.05);
      crash(t, 0.55);
      brass(t, [0, 12, 19, 24], 0.62, 4.6);
      padVoices.forEach((voice, i) => {
        voice.osc.frequency.setTargetAtTime(semitone([0, 7, 12][i] + 12), t, 0.05);
        voice.gain.gain.setTargetAtTime(0.5, t, 0.1);
      });

      // Held up for the length of the hit, then a long fade under the ring-out.
      // Fading from the instant it lands would make the biggest moment in the
      // piece also the first thing to start getting quieter — and this is the
      // one chord the whole build exists to arrive at. The recap is a reading
      // experience, so it does have to leave; twelve seconds is the tail of the
      // cadence rather than a bed.
      const now = holdNow(master.gain);
      master.gain.linearRampToValueAtTime(0.82, now + 0.05);
      master.gain.setValueAtTime(0.82, now + 1.8);
      master.gain.linearRampToValueAtTime(0.0001, now + 12);
      level = 0;
    },
  };

  function cue(name, arg) {
    if (!on || !ctx) return;
    const fn = CUES[name];
    if (fn) fn(arg);
  }

  // 0..1 across the whole run. Opens the ostinato filter and hardens the drum
  // pattern; the arrangement itself is the phase's job, not this one's.
  function intensity(fraction) {
    if (!on || !ctx || level === 0) return;
    drive = Math.max(0, Math.min(1, fraction));
    const now = ctx.currentTime;
    bus.ost.gain.setTargetAtTime(0.2 + drive * 0.12, now, 0.8);
    bus.drum.gain.setTargetAtTime(0.5 + drive * 0.14, now, 0.8);
  }

  // --- toggle --------------------------------------------------------------

  // Retargets a param from wherever its automation currently is.
  //
  // The obvious spelling — cancelScheduledValues, then setValueAtTime(p.value)
  // — is wrong, and quietly so: `.value` reports the last value set directly,
  // not the value a running ramp has reached. Interrupting a fade-in that way
  // snaps back to where the fade started rather than holding where it got to,
  // which is how the arrival once cut to silence instead of ringing out.
  // cancelAndHoldAtTime is the primitive that means what we want; Firefox
  // doesn't have it, hence the fallback.
  function holdNow(param) {
    const now = ctx.currentTime;
    if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(now);
    else {
      param.cancelScheduledValues(now);
      param.setValueAtTime(Math.max(param.value, 0.0001), now);
    }
    return now;
  }

  function rampTo(param, target, seconds) {
    const now = holdNow(param);
    param.linearRampToValueAtTime(target, now + seconds);
  }

  function fadeMaster(to, seconds) {
    rampTo(master.gain, to, seconds);
  }

  function enable() {
    if (!ctx) build();
    on = true;
    level = 1;
    ctx.resume().then(resync, () => {});
    fadeMaster(0.7, 1.2);
    remember(true);
    if (pendingLayer >= 1) startSequencer();
    paint();
  }

  function disable() {
    on = false;
    remember(false);
    if (ctx) {
      fadeMaster(0.0001, 0.4);
      stopSequencer();
      // Suspend after the fade, not during it, or the fade is what gets cut off.
      setTimeout(() => {
        if (!on && ctx) ctx.suspend();
      }, 450);
    }
    paint();
  }

  function paint() {
    if (!button) return;
    // Blocked means: the preference is on, but the browser won't start audio
    // without a gesture. See the note in mount().
    const blocked = on && ctx && ctx.state !== "running";
    button.setAttribute("aria-pressed", on ? "true" : "false");
    if (blocked) button.dataset.blocked = "true";
    else delete button.dataset.blocked;
    button.querySelector(".sound-label").textContent = blocked ? "Enable sound" : "Sound";
    button.title = on
      ? blocked
        ? "Your browser needs a click before it will play audio"
        : "Sound on"
      : "Sound off — a battle cue that follows your data as it loads";

    // The landing hint is an invitation, so it retires once accepted — the
    // topbar toggle is the control from then on.
    if (hint) hint.hidden = on;
  }

  function mount(node, hintNode) {
    // No Web Audio, no toggle. A button that does nothing is worse than no
    // button, and this is decoration by definition.
    if (!supported) return;
    button = node;
    button.hidden = false;
    button.addEventListener("click", () => (on ? disable() : enable()));

    hint = hintNode || null;
    if (hint) {
      hint.hidden = false;
      const hintButton = hint.querySelector("button");
      if (hintButton) hintButton.addEventListener("click", enable);
    }

    if (stored()) {
      // Returning from the Battle.net redirect there is no gesture to hang
      // this on — the page has just loaded on its own — so the browser may
      // refuse to start. We set up anyway, mark the toggle so it says what is
      // wrong, and take the very next interaction anywhere on the page as
      // permission. Without this, opting in before signing in would silently
      // buy you nothing on the one screen the sound exists for.
      enable();
      const unlock = () => {
        if (on && ctx && ctx.state !== "running") ctx.resume().then(() => { resync(); paint(); }, paint);
        paint();
      };
      window.addEventListener("pointerdown", unlock, { once: true });
      window.addEventListener("keydown", unlock, { once: true });
      // state may settle asynchronously after resume()
      setTimeout(paint, 400);
    } else {
      paint();
    }

    // Nobody wants a background tab drumming at them.
    document.addEventListener("visibilitychange", () => {
      if (!on || !ctx) return;
      if (document.hidden) ctx.suspend();
      else ctx.resume().then(() => { resync(); paint(); }, paint);
    });
  }

  // Signing out: silence and release the hardware, but keep the preference —
  // opting in once should not have to be done again on the next run.
  function stop() {
    if (!ctx) return;
    stopSequencer();
    fadeMaster(0.0001, 0.3);
    setTimeout(() => {
      if (ctx) ctx.suspend();
    }, 350);
    level = 1;
  }

  // Back to the top of the run after a sign-out/sign-in, undoing arrive()'s
  // fade and emptying the stage so the second journey builds from nothing
  // again rather than starting at full cry.
  function rewind() {
    if (!on || !ctx) return;
    level = 1;
    drive = 0;
    bladeIndex = 0;
    layer = 0;
    pendingLayer = 0;
    pendingCrash = false;
    stopSequencer();
    ctx.resume().then(resync, () => {});
    fadeMaster(0.7, 0.8);
  }

  window.BnetAudio = { mount, cue, intensity, stop, rewind, enabled: () => on };
})();
