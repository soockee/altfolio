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

Dark, slow and hypnotic rather than heroic: **84bpm in 7/8**, a four-bar loop in
D over a pedal drone that never moves. Floor toms on a 3+2+2 accent, a picked
bass, and a six-note arpeggio through a feedback delay. The progression is Dm,
Dm, B♭, A — and because the drone stays on D under all of it, that last bar is a
suspended fourth rather than a clean dominant, so it pulls back to bar one
without ever resolving.

The odd meter is doing the work. Seven never lets you settle into it, which is
what keeps a repeating figure hypnotic instead of naggy across a wait that might
have another forty seconds in it — and it's most of why this reads as brooding
rather than as a march. What makes seven feel like seven is where the toms
*aren't*.

The delay is set to three sixteenths, which against a bar of seven never lines up
with itself: the arpeggio appears to answer itself in a different place each time
round, and six plucked notes end up sounding like a part. Each repeat is filtered
darker than the last, as a real one would be.

**It builds by adding players, not by getting louder** — the only way a loop
survives a wait this long, and it maps onto the phases, which is the whole reason
the score is worth synthesising rather than playing back:

| Phase | Who joins |
| --- | --- |
| Sign in | Drone and distant voices only. Nothing has started yet. |
| Roster | Tom on the downbeat, bass on the 3+2+2, the arpeggio. |
| Dates | Toms on the second and third accents; rattle on the upbeats. |
| History | Ghost toms, a slow brass swell every other bar, a turn in bar four. |
| Verdict | Everything, with one crash. |

Two things move continuously underneath. The progress ring (0–1) opens the bass
filter and pushes the drum bus, so the same figure is felt more than heard early
and has teeth by the end; past about 62% the rattle doubles to sixteenths. And
each character read rings a **blade** — struck metal with deliberately inharmonic
partials, so it reads as a weapon being tested rather than a chime — walking up a
D minor pentatonic, because a rising line under a filling ring reads as progress
where random pitches read as noise. Rate-limited to one every 140ms, or a 40-alt
roster machine-guns.

Entries land **on a bar line, never mid-bar**, so a phase change can't drop a new
section onto an offbeat. Since the phase can be requested anywhere in the bar, a
noise riser covers the gap between the request and the entry.

## After the loading: the recap keeps playing

The arrival is not a full stop. That is the point of writing something hypnotic
in seven rather than something that peaks — it can carry on underneath the
reading without demanding anything. One marker lands (tom, brief brass, a pluck),
then the players added for the build drop away, the bass filter closes back down,
and the mix settles to about half level. What's left is the pulse, the bass and
the arpeggio.

The bass filter has to be closed explicitly there: `intensity` stops being called
once loading is over, so otherwise the reading arrangement would keep whatever
bite the end of the history read left it with.

Each chapter of the recap rings a note as it scrolls into view — walking up D
minor and staying in the mode, since each chapter is an answer rather than a
question. They go through the same delay as the arpeggio, so a section landing is
part of the music rather than a UI beep on top of it. The cue is keyed to the
chapter's **position in the page**, not to the order the observer happened to
fire in, so it doesn't reshuffle if two cross the threshold in the same frame —
and, more usefully, the sequence reverses for free when you scroll back up.

**It fires in both directions.** Chapters are never unobserved, so the page stays
responsive however you move through it rather than going quiet once you have seen
everything once. A `Set` of what is currently in view is what makes that safe:
the cue fires on the transition into view, not on every callback, so a chapter
resting on the threshold can't stutter. Going backwards plays the same scale
degree an octave down and softer — the sequence already descends on its own, and
this just makes going back sound like going back rather than like arriving
somewhere new. Direction is worked out inside audio.js by comparing against the
last index played, so the caller stays a caller.

The reveal animation stays one-way. Re-animating text you have already read on
the way back up is motion for its own sake, and re-hiding it would be worse.

One thing worth knowing: `prefers-reduced-motion` suppresses the reveal
*animation*, not the sound. Those are separate preferences, and someone who
turned the score on still wants the chapters to land — so under reduced motion
the chapters are shown immediately but the observer is still built, and still
fires only as each one actually scrolls into view.

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
