// Resolves art for the journey — class icons and character portraits — both
// fetched live from Blizzard's own media endpoints through the Worker rather
// than bundled into the repo. See docs/wow-art-resources.md for why: the
// Developer API terms require the art to "remain dynamically available,"
// which reads as "fetch it each time, don't commit the image files."
//
// Every resolver here fails silently (resolves null) rather than throwing.
// Art is decoration on top of a recap that already stands on its own — a
// missing icon should never be the thing that breaks a chapter.
(function () {
  const classIconCache = new Map(); // classId -> Promise<url|null>
  const characterMediaCache = new Map(); // character key -> Promise<{avatar,main}|null>

  // Blizzard's render CDN serves class icons at a stable, unauthenticated
  // path, and it is what the Game Data media endpoint hands back anyway. Going
  // straight there saves a Worker round-trip plus a Blizzard API read per
  // class, and — the reason this map exists at all — keeps icons working when
  // the Worker's /media/class route is unreachable, which is the whole of the
  // art layer's exposure to a backend deploy.
  //
  // This is a URL, not a bundled asset: the image is still fetched live from
  // Blizzard on every load, which is what the Developer API terms ask for (see
  // docs/wow-art-resources.md).
  const CLASS_SLUGS = {
    1: "warrior",
    2: "paladin",
    3: "hunter",
    4: "rogue",
    5: "priest",
    6: "deathknight",
    7: "shaman",
    8: "mage",
    9: "warlock",
    10: "monk",
    11: "druid",
    12: "demonhunter",
    13: "evoker",
  };

  async function getJsonOrNull(url, accessToken) {
    try {
      const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
      const res = await fetch(url, { headers });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  function assetUrl(assets, key) {
    const asset = (assets || []).find((a) => a.key === key);
    return (asset && asset.value) || null;
  }

  // Resolves to `url` if it actually loads as an image, null otherwise. Also
  // warms the browser cache, so the <img> that follows renders immediately
  // rather than fetching a second time.
  function probeImage(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(url);
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  // Icon URL for a playable class id, or null if unavailable. Memoized per
  // class id — every character sharing a class (the common case) resolves it
  // once, however many times it's requested across the page.
  //
  // Tries the known CDN path first and only asks the Game Data API when that
  // doesn't pan out: a class id this map hasn't heard of (Blizzard adds one
  // every few expansions) or a CDN path that has since moved.
  function classIcon(classId) {
    if (!classId) return Promise.resolve(null);
    if (!classIconCache.has(classId)) {
      classIconCache.set(classId, resolveClassIcon(classId));
    }
    return classIconCache.get(classId);
  }

  async function resolveClassIcon(classId) {
    const cfg = window.OAUTH_CONFIG;
    const slug = CLASS_SLUGS[classId];

    if (slug) {
      const direct = await probeImage(`https://render.worldofwarcraft.com/${cfg.region}/icons/56/classicon_${slug}.jpg`);
      if (direct) return direct;
    }

    const body = await getJsonOrNull(`${cfg.classMediaEndpoint}?id=${classId}`);
    return assetUrl(body && body.assets, "icon");
  }

  // { avatar, main } portrait URLs for one character, or null if unavailable
  // (a very old or very low-level character can genuinely have no render).
  // Needs the caller's own wow.profile-scoped token — this is per-character
  // profile data, not public Game Data like the class icon above.
  function characterMedia(accessToken, character) {
    if (!character.realmSlug) return Promise.resolve(null);
    if (!characterMediaCache.has(character.key)) {
      const cfg = window.OAUTH_CONFIG;
      const params = new URLSearchParams({ realm: character.realmSlug, character: character.name });
      characterMediaCache.set(
        character.key,
        getJsonOrNull(`${cfg.characterMediaEndpoint}?${params}`, accessToken).then((body) => {
          if (!body) return null;
          const avatar = assetUrl(body.assets, "avatar");
          const main = assetUrl(body.assets, "main");
          return avatar || main ? { avatar, main } : null;
        })
      );
    }
    return characterMediaCache.get(character.key);
  }

  window.BnetMedia = { classIcon, characterMedia };
})();
