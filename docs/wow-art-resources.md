# WoW art resources

altfolio is a free, open-source, non-profit fan project. This is where to
source World of Warcraft art/icons for it, and the Blizzard terms that
constrain how it can be used. Researched 2026-08-15, implemented 2026-08-15.

## Official route (recommended) — Battle.net Game Data API media endpoints

altfolio already does OAuth against Battle.net, so the safest art source is
Blizzard's own media endpoints, fetched live rather than bundled into the repo:

- `GET /data/wow/media/playable-class/{id}` → class icon. **Implemented** —
  proxied through the Worker at `/media/class?id=<id>`, see "How it's used"
  below.
- `GET /data/wow/media/playable-specialization/{id}` → spec icon. Not used —
  the account summary the app already reads doesn't carry a character's
  active spec, only its class, so there was nothing to key a spec icon off
  of without an extra per-character read this app doesn't otherwise need.
- Character renders, via the **Character Profile API's `character-media`
  sub-resource** (`GET /profile/wow/character/{realm}/{name}/character-media`
  — this is what the
  [Character Renders guide](https://community.developer.battle.net/documentation/world-of-warcraft/guides/character-renders)
  turned out to describe once implemented and hit live; the guide page
  itself is JS-rendered and unreadable without a browser, see below).
  **Implemented** — proxied through the Worker at `/media/character`.

Re-attempted verification 2026-08-15 via a plain fetch of both the Game Data
APIs reference and the Character Renders guide: both returned only the
portal's JS-app shell (nav chrome, no documentation body) — confirms the
"resists scraping" note above rather than resolving it. Everything below was
instead confirmed by implementing it and hitting the real API through the
Worker (see the routes in [backend/src/index.js](../backend/src/index.js)).

Resolved, no longer unconfirmed:

- **Playable-race icon media endpoint: does not exist.** There is no
  `/data/wow/media/playable-race/{id}` in the Game Data API — class and
  spec icons are real static assets on Blizzard's render CDN, but race has
  no equivalent. (The Armory doesn't show a standalone race icon anywhere
  either, which tracks.) The Races chapter uses a character **portrait**
  instead — see below — rather than a race icon, since one isn't available.
- **Faction icon media endpoint: does not exist either**, as far as this
  project needed to check. The Factions chapter doesn't use art at all —
  it's a validated colour-coded chart (see the data-viz notes in
  [../README.md](../README.md)), which was already the right call before
  this was investigated.

## Legal constraints (Blizzard Developer API Terms of Use)

See the [full terms](https://www.blizzard.com/en-us/legal/a2989b50-5f16-43b1-abec-2ae17cc09dd6/blizzard-developer-api-terms-of-use).

- **Attribution required** — must clearly identify Blizzard as the source of
  the data, without implying endorsement or affiliation.
- **Fetch dynamically, don't bundle** — the terms say data "must remain
  dynamically available to the public," which reads as: don't download
  Blizzard's icons and commit them into the repo as static assets. Fetch via
  `<img src="...">` pointing at the live API/CDN each time instead.
- **No Blizzard trademark** in the app's title or URL.
- No restriction on the *code* being open source — just keep the API key
  confidential.

## Why not community CDNs (e.g. Wowhead's `wow.zamimg.com`)

Same Blizzard-copyrighted art, but redistributed by a third party with no
license grant to us. Fine for a quick personal script, riskier to lean on for
a public OSS repo. Prefer the official API.

## Safe-to-bundle alternative for generic decoration

[game-icons.net](https://game-icons.net/) — 4,170+ SVG icons, CC BY 3.0
(attribution: "Icons by Lorc/Delapouite, game-icons.net"). Not WoW-specific
art, but fine for borders/flourishes/chrome that doesn't need to look like
actual Blizzard assets — can be committed straight into the repo, no
dynamic-fetch constraint.

## How it's used in altfolio

Two art elements, deliberately not more — see "why not everywhere" below.

- **Class icons**, broadly. A small icon leads every class name: each row of
  the Classes chapter's bar chart ([journey-ui.js](../journey-ui.js)'s
  `classesChapter`), the Class column of the roster table in the Appendix,
  and every character chip streaming past on the loading stage
  ([stage.js](../stage.js)). Cheap to use everywhere it appears — there are
  at most 13 distinct classes, so however large the roster, this is at most
  13 image fetches, memoized in [media.js](../media.js) so repeats are free.
- **One character portrait**, narrowly. The Races chapter's "first traces of
  you" callout — the single most personally-specific fact in the whole
  recap — gets that character's Armory avatar next to the text
  (`racesChapter`'s `spotlight()` in journey-ui.js). Deliberately not
  extended to every roster-table row: that would be one request per
  character (a 40-alt account is 40 extra fetches for a dense data table
  most people are scanning for numbers, not portraits) for a UX payoff that
  doesn't scale the same way class icons do.

Both fetch **live from Blizzard**, never bundled:

- **Class icons** go straight to the render CDN
  (`render.worldofwarcraft.com/<region>/icons/56/classicon_<slug>.jpg`),
  which is exactly the URL the Game Data media endpoint hands back. The class
  id → slug map lives in [media.js](../media.js). Only if that path doesn't
  load — a class id the map hasn't heard of, or a CDN layout that has since
  moved — does it fall back to `GET /media/class?id=<classId>` on the Worker,
  which reads `/data/wow/media/playable-class/{id}` from the `static-<region>`
  namespace. That route authenticates as the *app* (`client_credentials`
  grant, same `CLIENT_ID`/`CLIENT_SECRET` as the OAuth code exchange) rather
  than forwarding the caller's token, since class art isn't tied to any
  player, and caches at Cloudflare's edge for a day.

  It's worth being explicit about why the fallback isn't the primary: an
  API-first order makes every class icon on the page depend on the Worker
  being deployed and reachable, and the first time that wasn't true, every
  icon in the app silently vanished at once. A hardcoded URL is still a live
  fetch from Blizzard on every page load — what the terms ask for is that the
  *art* isn't committed to the repo, and it isn't.

- **Character portraits** need `GET /media/character?realm=<slug>&character=<name>`
  on the Worker and have no equivalent shortcut: the render URL contains a
  per-character hash that only the profile API knows. Being per-character
  profile data, it needs the signed-in user's own `wow.profile`-scoped token,
  same as `/character` and `/achievements`. This one genuinely does go dark
  if the Worker hasn't been redeployed with the route.

Every resolution in [media.js](../media.js) fails to `null` rather than
throwing — a 404 (a very old or very low-level character can genuinely have
no render) just leaves that icon slot empty. Nothing about art loading can
break a chapter or the loading stage; both stood on their own without any of
this.

Attribution: the existing sitewide footer ("Data via Blizzard
Entertainment…") already covers art the same way it covers the underlying
data — one clear line, not repeated per chapter.

## Why not everywhere

More art was considered and skipped for concrete reasons, not just left out:

- **Race icons in the Races chapter** — no such endpoint exists (see above),
  so the chapter uses a character portrait instead of an icon-per-row
  treatment the other two composition chapters get.
- **Faction crests in the Factions chapter** — no official media endpoint,
  and reproducing Blizzard's Alliance/Horde crest artwork independently
  would just be recreating trademarked symbols by hand. The chapter's
  validated blue/red split chart already does the job without needing art.
- **A portrait per roster row** — cost/value: N extra requests for a table
  most visitors are scanning for numbers, versus one request that already
  personalizes the recap's most narratively significant moment.
- **Drawing any of this onto the shareable PNG card** in
  [share-card.js](../share-card.js) — the card is drawn on `<canvas>` and
  exported via `toBlob()`; a cross-origin image without confirmed CORS
  headers taints the canvas and silently breaks that export. Not worth the
  risk for a decorative addition, so the card stays text-and-token-colour
  only, as it already was.
