# Sound

An optional score for the loading stage, off unless you ask for it.
Implemented 2026-08-15 in [audio.js](../audio.js).

## Why there is no audio file

There isn't one, and there won't be. Three constraints all point the same way:

- **WoW's own music is Blizzard's.** The
  [Developer API terms](wow-art-resources.md#legal-constraints-blizzard-developer-api-terms-of-use)
  cover game *data*, not the soundtrack, and nothing in them licenses the
  soundtrack for redistribution. There is also no media endpoint that serves
  music, so unlike class icons there isn't even a legitimate live-fetch route.
- **A CC-licensed orchestral bed is megabytes.** This is a zero-build static
  site on GitHub Pages. Committing several MB of audio to cover a wait is a
  large cost for decoration, and it is a cost paid by everyone including the
  people who never turn sound on.
- **A recording has a fixed length; the wait doesn't.** The stage covers
  anywhere from about eight seconds to well over a minute depending on how many
  alts are on the account. Anything pre-rendered has to loop, and a loop seam
  is exactly the "this is stuck" signal the stage exists to avoid.

So it is synthesised in the browser with Web Audio. That solves the length
problem by not having one, and buys something better: the score is driven by
the same data as the screen. The harmony moves when the phase moves, the filter
opens as the progress ring fills, and a note sounds when one of your characters
is read. It is not backing music playing while the app works — it is the app
working, audible. Same rule as the rest of the stage: nothing is filler.

## What it plays

A battle cue: 132bpm, a four-bar loop in D over a pedal drone, war drums and a
short low-string ostinato under brass. The progression is Dm, Dm, B♭, then the
turn onto E♭ — the ♭II, which over a D pedal is a flat ninth. It is the chord
that does most of the work in this genre, and the fact that it never resolves is
the point: it hands the loop back to bar one still leaning forward.

**It builds by adding players, not by getting louder.** That is the only way a
loop survives a wait that might have another forty seconds left in it, and it
maps exactly onto the phases, which is the whole reason the score is worth
synthesising rather than playing back:

| Phase | Who joins |
| --- | --- |
| Sign in | Drone and distant voices only. Nothing has started yet. |
| Roster | War drums on the downbeats; the low ostinato on eighths. |
| Dates | Off-beat drums, rattle on the upbeats, first brass. |
| History | Full brass, the sixteenth-note drive, and a fill in bar four. |
| Verdict | Everything, with a crash on the downbeat. |

Two things move continuously underneath that. The progress ring (0–1) opens the
ostinato's filter and pushes the drum bus, so the same figure that is distant at
10% is snarling at 90% without anyone touching a fader; past about 62% the
pattern itself hardens to sixteenths. And each character read rings a **blade** —
struck metal with deliberately inharmonic partials, so it reads as a weapon being
tested rather than a chime — walking up a D minor pentatonic, because a rising
line under a filling ring reads as progress where random pitches read as noise.
Rate-limited to one every 140ms, or a 40-alt roster machine-guns.

Entries land **on a bar line, never mid-bar**, so a phase change can't drop a new
section onto an offbeat. Since the phase can be requested anywhere in the bar, a
noise riser covers the gap between the request and the entry.

The arrival is a full stop rather than another swell — the whole point of a
battle cue is that it ends. The loop cuts, one last chord lands with a crash, the
mix is held up for 1.8 seconds so the biggest moment in the piece isn't also the
first thing to start getting quieter, and then it rings out over twelve seconds.
That fade is the tail of the cadence, not a bed: the recap is a reading
experience and a drone under it outstays its welcome fast.

## Timing, and why there's a scheduler

`setInterval` is nowhere near steady enough to place a sixteenth note on — it
drifts and stalls under load, and at this tempo a few milliseconds is audible as
sloppiness. So the standard Web Audio split applies: a 25ms timer decides only
*what* to queue, looking 150ms ahead, and every note is stamped with an explicit
time on the audio clock, which is sample-accurate. The timer being late doesn't
move a note; it only risks queueing one late, and the lookahead is what absorbs
that.

The audio clock also stops while a context is suspended, which the wall clock
does not — so anything that suspends (a hidden tab, the toggle) has to re-sync
the queue pointer on the way back, or the scheduler tries to make up the whole
gap in one burst.

## Opt-in, and the autoplay problem

Default off, remembered in `localStorage` under `bnet_sound`. There are two
ways in: the toggle in the top bar, and a one-line invitation under the landing
CTA that retires once accepted — an opt-in nobody knows about is the same as no
feature, and the toggle alone is easy to miss up in a corner.

The awkward case is worth naming. Opting in on the landing page is the *right*
moment to opt in, but the very next thing that happens is a redirect to
Battle.net and back, and the page that returns has had no user gesture — so the
browser may refuse to start audio on the one screen the sound exists for.
Handled three ways at once: the context is built anyway, the toggle turns red
and reads "Enable sound" so the state is never a silent lie, and the next
interaction anywhere on the page resumes it.

Also: audio stops when the tab is hidden, and releases the hardware on sign-out
while keeping the preference — opting in once should not have to be done twice.

## Accessibility and failure

- Off by default, which is the real accessibility answer here. There is no
  `prefers-reduced-sound` to honour.
- The toggle's state is carried by which glyph is drawn — speaker with waves
  versus speaker with a slash — not by colour alone.
- No Web Audio, no toggle: it ships `hidden` and audio.js unhides it, so a
  browser without support shows no control rather than a dead one.
- main.js holds a no-op stand-in for `window.BnetAudio`, so a failed or absent
  audio.js cannot take the recap down with it. Nothing here is load-bearing.

## Verifying it

Headless Chromium can't be listened to, and its virtual clock doesn't advance
the audio clock, so a real-time capture reads a flat line no matter what the
graph is doing. Rendering it offline works instead, and needs two fakes:

1. **Shadow `currentTime`** with a value the harness controls
   (`Object.defineProperty` on the context instance shadows the prototype
   getter). Everything schedules at an absolute time derived from it, so
   advancing that clock by hand lays the whole piece into the timeline.
2. **Capture the sequencer's interval callback** by patching `setInterval`
   before audio.js loads, then tick it in lockstep with that clock. Otherwise
   the rendered rhythm is whatever the event loop happened to do, which is
   exactly what the lookahead scheduler exists to stop mattering.

Then `startRendering()` and measure: per-slice RMS and peak for the arc, a
sixteenth-grid peak trace to read the pattern back, and a clipped-sample count.

Four defects came out of this that inspection would not have caught: the arrival
arpeggio throwing a `RangeError` instead of playing; the final fade cutting to
instant silence because `AudioParam.value` reports the last value *set*, not the
value a running ramp has reached (`cancelAndHoldAtTime` is the primitive that
means what we want); a compressor at 8:1 flattening the build so completely that
every layer which entered was paid for by everything already playing getting
quieter; and, after fixing that, the arrival clipping — which is why there is a
brickwall limiter on the output rather than a set of hand-tuned gains that
happened to pass one test.

Worth knowing if you re-run it: `OfflineAudioContext.suspend()` needs times on a
128-sample boundary, and headless virtual time starves a render that has to
ping-pong across suspend points, so the shadowed-clock approach is the one that
works.
