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

  // Icon URL for a playable class id, or null if unavailable. Memoized per
  // class id — every character sharing a class (the common case) resolves it
  // once, however many times it's requested across the page.
  function classIcon(classId) {
    if (!classId) return Promise.resolve(null);
    if (!classIconCache.has(classId)) {
      const cfg = window.OAUTH_CONFIG;
      classIconCache.set(
        classId,
        getJsonOrNull(`${cfg.classMediaEndpoint}?id=${classId}`).then((body) => assetUrl(body && body.assets, "icon"))
      );
    }
    return classIconCache.get(classId);
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
