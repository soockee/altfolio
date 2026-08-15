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

  const BPM = 84;
  const BEAT = 60 / BPM;
  const STEP = BEAT / 4; // sixteenth
  // 7/8. An odd meter loops without ever quite letting you settle into it,
  // which is what keeps a repeating figure hypnotic instead of naggy over a
  // wait this long — and it is most of why this reads as brooding rather than
  // as a march. Accented 3+2+2, at sixteenth positions 0, 6 and 10.
  const STEPS_PER_BAR = 14;
  const ACCENTS = [0, 6, 10];
  const BARS = 4;

  // Four bars, in semitones from D. Dm twice to settle in, the drop to ♭VI,
  // then the turn onto A — which against the D pedal that never moves is a
  // suspended fourth rather than a clean dominant, so it pulls back to bar one
  // without ever resolving.
  const PROGRESSION = [
    { root: 0, notes: [0, 3, 7] },    // Dm
    { root: 0, notes: [0, 3, 7] },    // Dm
    { root: -4, notes: [-4, 0, 3] },  // B♭
    { root: -5, notes: [-5, -1, 2] }, // A
  ];

  // How many players are on. Raised by phase, never lowered mid-run, and only
  // ever applied on a bar line so an entry never lands off the grid.
  const LAYER = { connect: 0, characters: 1, detail: 2, history: 3, verdict: 4 };

  // D minor pentatonic for the per-character hits.
  const BLADE = [12, 15, 17, 19, 22, 24];
  const SPOT_MIN_GAP = 0.14;

  // Chapters of the recap, as they scroll into view. Walks up D minor and stays
  // there — each one is an answer, not a question, so the line rises but never
  // leaves the mode.
  const SECTION_NOTES = [0, 3, 7, 10, 12, 15, 19, 22];
  const SECTION_MIN_GAP = 0.25;

  // Sixteenth positions the arpeggio speaks on, within the bar of seven.
  const ARPEGGIO = [0, 2, 5, 7, 9, 12];

  let ctx = null;
  let master = null;
  let comp = null;
  let reverb = null;
  let noiseBuf = null;
  let echo = null;
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
  let lastSection = 0;
  let sectionIndex = 0;
  let lastSectionIndex = -1;
  let reading = false; // recap on screen: keep playing, but out of the way

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

    // Drums stay drier than everything else — reverb on a tom at this tempo
    // smears the one thing that has to stay tight.
    bus = {
      drum: makeBus(0.42, 0.22),
      bass: makeBus(0.3, 0.12),
      pluck: makeBus(0.22, 0.5),
      brass: makeBus(0.16, 0.7),
      pad: makeBus(0.09, 0.9),
      drone: makeBus(0.15, 0.3),
      blade: makeBus(0.18, 0.85),
    };

    // Feedback delay on the arpeggio, at three sixteenths. Against a bar of
    // seven that never lines up with itself, so the figure appears to answer
    // itself in a different place each time round — the repeats do most of the
    // work of making six plucked notes sound like a part. It is also the single
    // cheapest way to sound like a room full of reverb-drenched guitar rather
    // than like an oscillator.
    echo = ctx.createDelay(2);
    echo.delayTime.value = STEP * 3;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.36;
    const echoOut = ctx.createGain();
    echoOut.gain.value = 0.55;
    const echoDamp = ctx.createBiquadFilter();
    // Each repeat darker than the last, as a real one would be.
    echoDamp.type = "lowpass";
    echoDamp.frequency.value = 1600;
    echo.connect(echoDamp);
    echoDamp.connect(feedback);
    feedback.connect(echo);
    echo.connect(echoOut);
    echoOut.connect(comp);
    echoOut.connect(reverb);

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

  // Floor tom. Same trick as any struck skin — a sine dropping fast through an
  // octave, with a noise transient for the stick — but tuned lower, decaying
  // longer and with the transient pulled well back. That last part is the whole
  // difference between a war drum announcing itself and a tom you can leave
  // running underneath something you are trying to read.
  function tom(t, freq, gain) {
    const peak = gain * level;
    if (!ctx || peak < 0.0005) return;

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq * 2.4, t);
    osc.frequency.exponentialRampToValueAtTime(freq, t + 0.1);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(peak, t + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    osc.connect(env);
    env.connect(bus.drum);
    osc.start(t);
    osc.stop(t + 0.75);

    const hitEnv = ctx.createGain();
    hitEnv.gain.setValueAtTime(peak * 0.22, t);
    hitEnv.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 1100;
    band.Q.value = 0.9;
    const src = noiseAt(t, 0.05);
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

  // Bass, played with a pick. Two detuned saws an octave apart through a filter
  // that snaps shut — the fast downward sweep is the pluck, and doing it with
  // the filter rather than the amplitude is what keeps the note's body while
  // still sounding struck. `drive` opens the starting point, so the same figure
  // is felt more than heard early on and has teeth by the end.
  function bass(t, freq, duration, gain) {
    const peak = gain * level;
    if (!ctx || peak < 0.0005) return;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(peak, t + 0.008);
    env.gain.setValueAtTime(peak, t + duration * 0.5);
    env.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    env.connect(bus.bass);

    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 7;
    lp.frequency.setValueAtTime(freq * (4 + drive * 7), t);
    lp.frequency.exponentialRampToValueAtTime(freq * 1.6, t + duration * 0.7);
    lp.connect(env);

    for (const [mult, detune] of [[1, -5], [1, 6], [0.5, 0]]) {
      const osc = ctx.createOscillator();
      osc.type = mult < 1 ? "square" : "sawtooth";
      osc.frequency.value = freq * mult;
      osc.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = mult < 1 ? 0.5 : 0.4;
      osc.connect(g);
      g.connect(lp);
      osc.start(t);
      osc.stop(t + duration + 0.05);
    }
  }

  // The arpeggio. Clean, plucked, and deliberately thin on its own — it is
  // written to be heard through the delay, which is where it turns into a part.
  // Triangle rather than saw keeps it dark enough to sit under text.
  function pluck(t, semi, gain) {
    const peak = gain * level;
    if (!ctx || peak < 0.0005) return;
    const freq = semitone(semi);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(peak, t + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    env.connect(bus.pluck);
    env.connect(echo);

    for (const [mult, weight, type] of [[1, 1, "triangle"], [2, 0.16, "sine"], [3, 0.07, "sine"]]) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = freq * mult;
      const g = ctx.createGain();
      g.gain.value = weight;
      osc.connect(g);
      g.connect(env);
      osc.start(t);
      osc.stop(t + 1.2);
    }
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

    const root = semitone(chord.root);
    const hard = drive > 0.62; // the back half of the history read
    const accent = ACCENTS.indexOf(s); // 3+2+2; -1 anywhere else

    // --- drums ---
    // The 3+2+2 skeleton and nothing more until late. What makes seven feel
    // like seven is where the toms *aren't*.
    if (layer >= 1 && s === 0) tom(t, 58, 0.85);
    if (layer >= 2) {
      if (s === 6) tom(t, 82, 0.55);
      if (s === 10) tom(t, 73, 0.5);
      if (s === 4 || s === 12) rattle(t, 0.07);
    }
    if (layer >= 3) {
      if (s === 3 || s === 13) tom(t, 98, 0.28);
      if (hard && s % 2 === 1) rattle(t, 0.05);
      // A turn across the end of the four-bar phrase, so the loop never comes
      // round twice looking identical.
      if (bar === BARS - 1 && s >= 10) tom(t, 92 - (s - 10) * 7, 0.3);
    }
    if (layer >= 4 && s === 0 && bar === 0) crash(t, 0.22);

    // --- bass ---
    if (layer >= 1 && accent >= 0) {
      bass(t, root, STEP * (accent === 0 ? 2.4 : 1.7), accent === 0 ? 0.8 : 0.55);
    }
    if (layer >= 3 && s === 13) bass(t, root * 2, STEP * 1.1, 0.35);

    // --- arpeggio ---
    // Six notes over fourteen steps: sparse on the page, dense once the delay
    // fills the gaps in.
    if (layer >= 1) {
      const at = ARPEGGIO.indexOf(s);
      if (at >= 0) {
        const semi = chord.notes[at % chord.notes.length] + (at >= 4 ? 24 : 12);
        pluck(t, semi, at === 0 ? 0.45 : 0.3);
      }
    }

    // --- brass, sparingly ---
    // One slow swell every other bar. Any more and it stops being a colour and
    // starts being the tune, which is not what background music is for.
    if (layer >= 3 && s === 0 && bar % 2 === 0) {
      brass(t, chord.notes.map((n) => n + 12), 0.28, BEAT * 2.6);
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
      tom(t, 50, 0.9);
      brass(t, [0, 12, 19], 0.34, 1.4);
      pluck(t, 12, 0.4);
    },

    phase(id) {
      // Once the recap is up the arrangement is settled; a late phase call
      // shouldn't build it back up underneath someone who is reading.
      if (reading) return;
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

    // The recap is ready. Not a full stop — the loop carries on underneath the
    // reading, which is the point of writing something hypnotic in seven rather
    // than something that peaks. What changes is the arrangement: one marker
    // lands, the players that were added for the build drop away, and what is
    // left is the pulse, the bass and the arpeggio at about half the level.
    arrive() {
      if (!ctx) return;
      const t = ctx.currentTime;
      tom(t, 52, 0.9);
      crash(t, 0.26);
      brass(t, [0, 12, 19], 0.42, 3.4);
      pluck(t, 24, 0.5);

      reading = true;
      layer = 1;
      pendingLayer = 1;
      // Close the bass filter back down. `intensity` stops being called once
      // loading is over, so without this the reading arrangement would keep
      // whatever bite the end of the history read left it with.
      drive = 0.2;
      rampTo(master.gain, 0.42, 5);
    },

    // A chapter of the recap has scrolled into view. Walks up D minor so the
    // sections feel like they are going somewhere, and goes through the same
    // delay as the arpeggio, so it lands as part of the music rather than as a
    // UI beep on top of it.
    section(n) {
      if (!ctx) return;
      const now = ctx.currentTime;
      if (now - lastSection < SECTION_MIN_GAP) return;
      lastSection = now;

      const index = typeof n === "number" ? n : sectionIndex++;
      // Scrolling back up plays the same scale degree an octave down and
      // softer. The sequence already reverses on its own, since the note is
      // keyed to the chapter's position — this just makes going back sound
      // like going back rather than like arriving somewhere new. Direction is
      // worked out here rather than passed in, so the caller stays a caller.
      const back = index < lastSectionIndex;
      lastSectionIndex = index;

      pluck(now, SECTION_NOTES[index % SECTION_NOTES.length] + (back ? 12 : 24), back ? 0.32 : 0.42);
      tom(now, 96, back ? 0.11 : 0.16);
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
    if (!on || !ctx || reading) return;
    drive = Math.max(0, Math.min(1, fraction));
    const now = ctx.currentTime;
    bus.bass.gain.setTargetAtTime(0.3 + drive * 0.14, now, 0.8);
    bus.drum.gain.setTargetAtTime(0.42 + drive * 0.12, now, 0.8);
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
    sectionIndex = 0;
    lastSectionIndex = -1;
    reading = false;
    layer = 0;
    pendingLayer = 0;
    pendingCrash = false;
    stopSequencer();
    ctx.resume().then(resync, () => {});
    fadeMaster(0.7, 0.8);
  }

  window.BnetAudio = { mount, cue, intensity, stop, rewind, enabled: () => on };
})();
