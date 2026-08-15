# WoW art resources

altfolio is a free, open-source, non-profit fan project. This is where to
source World of Warcraft art/icons for it, and the Blizzard terms that
constrain how it can be used. Researched 2026-08-15.

## Official route (recommended) — Battle.net Game Data API media endpoints

altfolio already does OAuth against Battle.net, so the safest art source is
Blizzard's own media endpoints, fetched live rather than bundled into the repo:

- `GET /data/wow/media/playable-class/{id}` → class icon
- `GET /data/wow/media/playable-specialization/{id}` → spec icon
- Character renders: see the [Character Renders guide](https://community.developer.battle.net/documentation/world-of-warcraft/guides/character-renders)

Unconfirmed at research time: whether a dedicated playable-race or faction
icon media endpoint exists — the community dev portal is a JS SPA that
resists scraping. Verify directly against the
[Game Data APIs reference](https://community.developer.battle.net/documentation/world-of-warcraft/game-data-apis)
or via a live API call before relying on it.

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

## How to apply

When implementing character-art decoration (class/spec icons etc.), wire
them through the existing Worker's OAuth flow and Battle.net media endpoints
rather than downloading and committing image files. Add a small "data via
Blizzard" attribution line near the stats section.
