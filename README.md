# Altfolio

Experience a Journey through your World of Warcraft characters.

# Motivation

I built this, because I had down everything for week 1 of midnight season 2 prepatch.
I had a boost open and could not decide if I should boost an existing character I have history with, or use the opportunity to save some time and boost a new character.

I wanted to understand what kind of player I am, and maybe lean into something I am already used to, or discover an area I did not yet play so much. 

I wanted to understand the history of my characters. 
  - When where they created? 
  - When where they played? 
  - What is the big picuture?

Then I wanted to have eye-candy for the presentation of the data... then I was done.

# What the data can and can't say

One answer up front: **the API has no character-creation date, and no playtime
counter.** "When were they created?" can't be answered directly. Two signals
stand in for it:

- **Achievement `completed_timestamp`** — a lower bound on when a character
  was active. Everywhere the recap says "first seen" it means *the oldest
  surviving timestamp*, not a birthday.
- **`last_login_timestamp`** — the one first-class "when was this played"
  field, read per character.

Two quirks the code works around:

- **Account-wide achievements report an identical timestamp on every
  character.** Left alone they'd fake the same activity spike on every alt.
  [activity.js](activity.js) spots them — the same (achievement, timestamp)
  pair on two or more characters — and splits them out as account milestones
  rather than counting them as per-character activity. There's no separate
  account-achievements endpoint; this *is* where they live.
- **Faction changes are never reported.** But a race locked to one faction
  sitting on the other side is unambiguous proof one happened. It's the only
  claim in the recap backed by something the data proves rather than implies,
  so it outranks every inferred archetype. See `RACE_FACTION` in
  [journey.js](journey.js).

# The journey

Six chapters, each with a headline written from your own data rather than a
fixed template: cold open, factions, races, classes, the timeline, and the
verdict. An appendix keeps the raw numbers.

The verdict picks between `The Faction Hopper`, `The Double Agent`,
`The Loyalist`, `The Completionist`, `The Class Nomad`, `The Main-Switcher`,
`The Returner`, and `The Adventurer` (the floor, so every account gets one).
Each archetype scores itself 0–1 from the account's facts and the highest
wins — not a first-match cascade, so a wide account doesn't get pinned to
whichever rule sits first in the list. Runners-up show as "also true of you".
Scoring is `scoreArchetypes` in [journey.js](journey.js).

# Layout

Static frontend, no build step, deploys to GitHub Pages as-is.

| File | Role |
|---|---|
| [index.html](index.html) · [styles.css](styles.css) | Page shell and styling |
| [oauth.js](oauth.js) · [oauth-config.js](oauth-config.js) | Battle.net authorization-code flow |
| [api.js](api.js) | Authenticated JSON GETs, bounded-concurrency fetching |
| [profile.js](profile.js) · [activity.js](activity.js) | The reads, and the account-wide split |
| [journey.js](journey.js) | Analysis: chapters and the verdict |
| [charts.js](charts.js) · [journey-ui.js](journey-ui.js) | Chart pieces and chapter rendering |
| [share-card.js](share-card.js) | The exported PNG card |
| [main.js](main.js) | Boot and load progress |
| [backend/](backend/) | Cloudflare Worker: token exchange + API proxy |

The Worker exists for two reasons: the token exchange needs `client_secret`,
and `api.blizzard.com` sends no CORS headers. See
[backend/README.md](backend/README.md).

# Disclaimer

Totally junkfood code. took my go-to AI and me 1 hour.

Data via Blizzard Entertainment. altfolio is a non-commercial fan project, not
affiliated with or endorsed by Blizzard.