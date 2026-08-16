// Renders the verdict as a shareable image.
//
// The card is drawn on a canvas rather than screenshotted from the DOM so the
// output is a fixed 1080×1350 regardless of the viewer's window, and so it can
// commit to one dark look instead of inheriting the page's light/dark theme —
// a shared image has no theme to follow.
(function () {
  const W = 1080;
  const H = 1350;
  const PAD = 90;

  // The vault steps from the same palette the verdict chapter pins itself to,
  // since the card is always dark.
  const INK = "#f1e9d8";
  const INK_SECONDARY = "#b4a788";
  const INK_MUTED = "#8a7d63";
  const SURFACE = "#1e1912";
  const PLANE = "#14110d";
  const ALLIANCE = "#3987e5";
  const HORDE = "#e66767";
  // Same "this was your main" gold the timeline chapter marks eras with, and
  // the same gold the Reliquary Frame is drawn in.
  const GOLD = "#e3b54f";
  const FRAME_INNER = "#6b5122";

  const SANS = 'system-ui, -apple-system, "Segoe UI", sans-serif';
  // The card's own type split, matching the page: Cinzel declares, the system
  // sans reports. Georgia is in the stack because canvas silently falls back to
  // a default face for a family it cannot resolve, and a serif fallback keeps
  // the card's voice if the webfont request has not landed by the time someone
  // hits share.
  const DISPLAY = '"Cinzel", Georgia, serif';
  const BODY = '"Spectral", Georgia, serif';
  const font = (weight, size) => `${weight} ${size}px ${SANS}`;
  const displayFont = (weight, size) => `${weight} ${size}px ${DISPLAY}`;
  const bodyFont = (weight, size) => `${weight} ${size}px ${BODY}`;

  // The Reliquary Frame, drawn rather than styled: gold hairline, dark oak
  // inset line, four rivets. Same construction as the DOM frame, so the shared
  // image and the page it came from read as the same artifact.
  function drawFrame(ctx, x, y, w, h) {
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);

    ctx.strokeStyle = FRAME_INNER;
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 5, y + 5, w - 10, h - 10);

    ctx.fillStyle = GOLD;
    for (const [rx, ry] of [[x + 24, y + 24], [x + w - 24, y + 24], [x + 24, y + h - 24], [x + w - 24, y + h - 24]]) {
      ctx.beginPath();
      ctx.arc(rx, ry, 7, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Where the fixed lower third begins: stat strip, faction bar and footer are
  // pinned so the card's bottom half is identical whatever the verdict runs
  // to, which leaves everything above it a known amount of room to fill.
  const STATS_Y = 1000;

  const CROWN = "M2.7 6.4 7.7 10.2 12 3.4l4.3 6.8 5-3.8-1.8 13.2H4.5L2.7 6.4Z";

  function drawCrown(ctx, x, y, size, color) {
    if (typeof Path2D === "undefined") return;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(size / 24, size / 24);
    ctx.fillStyle = color;
    ctx.fill(new Path2D(CROWN));
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, radii) {
    if (typeof ctx.roundRect === "function") {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, radii);
      ctx.fill();
    } else {
      ctx.fillRect(x, y, w, h);
    }
  }

  // Greedy wrap at `maxWidth`, capped at `maxLines` with an ellipsis on the
  // last line. Returns the lines; the caller decides where to put them.
  function wrap(ctx, text, maxWidth, maxLines) {
    const words = String(text).split(/\s+/);
    const lines = [];
    let line = "";

    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth || !line) {
        line = candidate;
      } else {
        lines.push(line);
        line = word;
        if (lines.length === maxLines) break;
      }
    }
    if (lines.length < maxLines && line) lines.push(line);

    if (lines.length === maxLines) {
      let last = lines[maxLines - 1];
      if (ctx.measureText(last).width > maxWidth) {
        while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
        lines[maxLines - 1] = `${last}…`;
      }
    }
    return lines;
  }

  function drawLines(ctx, lines, x, y, lineHeight) {
    let cursor = y;
    for (const line of lines) {
      ctx.fillText(line, x, cursor);
      cursor += lineHeight;
    }
    return cursor;
  }

  // One line, truncated with an ellipsis rather than wrapped — names and
  // subtitles in the roster block each own exactly one line.
  function fit(ctx, text, maxWidth) {
    return wrap(ctx, text, maxWidth, 1)[0] || "";
  }

  function reignRange(reign) {
    return reign.from === reign.to ? String(reign.from) : `${reign.from}–${reign.to}`;
  }

  // Section eyebrow with the crown, used for the block that names characters.
  function drawSectionLabel(ctx, text, x, y) {
    drawCrown(ctx, x, y - 2, 28, GOLD);
    ctx.fillStyle = INK_MUTED;
    ctx.font = font(600, 24);
    ctx.letterSpacing = "3px";
    ctx.fillText(text, x + 40, y);
    ctx.letterSpacing = "0px";
  }

  // A named row: a gold key on the left (the years held, or the level), the
  // character's name in the card's second-largest type, and who they are under
  // it. This is the part a player recognises themselves in, so the name gets
  // the weight and the statistics stay subordinate.
  const ROW_H = 88;
  // 216, not 200: a full four-digit range ("2007–2011") measures 182px at this
  // weight and size, which overran the old 180px budget by two pixels and
  // ellipsised the end year off every multi-year reign on the card.
  const KEY_W = 216;

  function drawNamedRow(ctx, row, x, y, inner) {
    ctx.fillStyle = GOLD;
    ctx.font = font(600, 30);
    ctx.fillText(fit(ctx, row.key, KEY_W - 20), x, y + 10);

    const nameX = x + KEY_W;
    const nameW = inner - KEY_W;

    ctx.fillStyle = INK;
    ctx.font = font(700, 46);
    ctx.fillText(fit(ctx, row.name, nameW), nameX, y);

    ctx.fillStyle = INK_MUTED;
    ctx.font = font(400, 26);
    ctx.fillText(fit(ctx, row.detail, nameW), nameX, y + 54);
  }

  // The rows the card names. Mains first — "who held the account, and when" is
  // the thing worth showing off — and the roster by level when the account has
  // no dated history to build eras from.
  function namedRows(journey, limit) {
    const reigns = (journey.timeline && journey.timeline.reigns) || [];

    if (reigns.length) {
      // Ranked by how long they held it so the longest reigns survive the cap,
      // then put back in the order they happened: the card reads as a
      // chronology, not a leaderboard.
      const kept = reigns
        .slice()
        .sort((a, b) => b.years.length - a.years.length || b.count - a.count)
        .slice(0, limit)
        .sort((a, b) => a.from - b.from);

      return {
        label: "WHO CARRIED THE ACCOUNT",
        rows: kept.map((reign) => ({
          key: reignRange(reign),
          name: reign.character.name,
          detail: `${reign.character.race} ${reign.character.class} · ${reign.character.realm}`,
        })),
        more: reigns.length - kept.length,
      };
    }

    const roster = journey.characters
      .slice()
      .sort((a, b) => (b.level || 0) - (a.level || 0))
      .slice(0, limit);

    if (!roster.length) return null;

    return {
      label: "THE ROSTER",
      rows: roster.map((c) => ({
        key: c.level ? `Level ${c.level}` : "—",
        name: c.name,
        detail: `${c.race} ${c.class} · ${c.realm}`,
      })),
      more: journey.characters.length - roster.length,
    };
  }

  function draw(journey) {
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    ctx.textBaseline = "top";

    ctx.fillStyle = PLANE;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = SURFACE;
    // Near-square: carved stone does not have a 40px radius.
    roundRect(ctx, 32, 32, W - 64, H - 64, 4);
    drawFrame(ctx, 32, 32, W - 64, H - 64);

    const inner = W - PAD * 2;
    let y = PAD + 10;

    // Masthead, with the span of the account on the right — the years are the
    // frame everything under them is measured against.
    ctx.fillStyle = GOLD;
    ctx.font = displayFont(600, 26);
    ctx.letterSpacing = "4px";
    ctx.fillText("ALTFOLIO · YOUR WOW JOURNEY", PAD, y);
    ctx.letterSpacing = "0px";
    // The span of the account, on the right — the years are the frame
    // everything under them is measured against, so they stay in the data face
    // with every other number on the card.
    const years = (journey.timeline && journey.timeline.years) || [];
    if (years.length) {
      const span = years.length === 1 ? String(years[0]) : `${years[0]}–${years[years.length - 1]}`;
      ctx.fillStyle = INK_MUTED;
      ctx.font = font(600, 26);
      ctx.fillText(span, PAD + inner - ctx.measureText(span).width, y);
    }
    y += 74;

    // Verdict. The card's prose follows the page's split — Spectral for the
    // sentences, the data face for every number below.
    ctx.fillStyle = INK_SECONDARY;
    ctx.font = bodyFont(400, 34);
    ctx.fillText("You are", PAD, y);
    y += 58;

    ctx.fillStyle = INK;
    ctx.font = displayFont(700, 82);
    ctx.letterSpacing = "2px";
    y = drawLines(ctx, wrap(ctx, String(journey.verdict.title).toUpperCase(), inner, 2), PAD, y, 96) + 12;
    ctx.letterSpacing = "0px";

    ctx.fillStyle = INK_SECONDARY;
    ctx.font = bodyFont(400, 36);
    y = drawLines(ctx, wrap(ctx, journey.verdict.tagline, inner, 2), PAD, y, 48) + 46;

    // Named characters — the reason anyone shares this. How many rows fit
    // depends on how far the verdict text ran, so the block is sized against
    // the room actually left above the pinned stat strip rather than assumed.
    const room = Math.max(0, Math.floor((STATS_Y - 60 - (y + 52)) / ROW_H));
    const named = room > 0 ? namedRows(journey, Math.min(4, room)) : null;

    if (named) {
      drawSectionLabel(ctx, named.label, PAD, y);
      y += 52;

      for (const row of named.rows) {
        drawNamedRow(ctx, row, PAD, y, inner);
        y += ROW_H;
      }

      if (named.more > 0) {
        ctx.fillStyle = INK_MUTED;
        ctx.font = font(400, 26);
        ctx.fillText(`+ ${named.more} more`, PAD + KEY_W, y - 14);
        y += 22;
      }
      y += 12;
    }

    // Evidence, filling whatever is left — the verdict's supporting lines are
    // worth having but they yield to the names above them.
    ctx.font = bodyFont(400, 30);
    for (const line of journey.verdict.evidence) {
      if (y + 52 > STATS_Y - 60) break;
      ctx.fillStyle = GOLD;
      ctx.fillText("•", PAD, y);
      ctx.fillStyle = INK_SECONDARY;
      y = drawLines(ctx, wrap(ctx, line, inner - 34, 1), PAD + 34, y, 40) + 12;
    }

    // Stat strip, pinned low so the card's lower third is stable whatever the
    // verdict text runs to. The hairline above it turns the slack left by a
    // short verdict into deliberate separation rather than a hole.
    y = Math.max(y + 40, STATS_Y);
    ctx.fillStyle = "rgba(227, 181, 79, 0.35)";
    ctx.fillRect(PAD, y - 36, inner, 1);

    const t = journey.totals;
    const stats = [
      [String(t.characters), t.characters === 1 ? "character" : "characters"],
      [String(t.classes), "classes"],
      [String(t.races), "races"],
      [t.activeYears ? String(t.activeYears) : String(t.realms), t.activeYears ? "active years" : "realms"],
    ];
    const colWidth = inner / stats.length;
    for (let i = 0; i < stats.length; i++) {
      const x = PAD + colWidth * i;
      ctx.fillStyle = INK;
      ctx.font = font(600, 60);
      ctx.fillText(stats[i][0], x, y);
      ctx.fillStyle = INK_MUTED;
      ctx.font = font(400, 26);
      ctx.fillText(stats[i][1], x, y + 70);
    }
    y += 132;

    // Faction split — the one chart that survives the shrink to a card.
    const f = journey.factions;
    if (f.total > 0) {
      ctx.fillStyle = INK_MUTED;
      ctx.font = font(400, 26);
      ctx.fillText(`${f.alliance} Alliance`, PAD, y);
      const hordeLabel = `${f.horde} Horde`;
      ctx.fillText(hordeLabel, PAD + inner - ctx.measureText(hordeLabel).width, y);
      y += 40;

      const barH = 26;
      const gap = 6;
      const allianceW = Math.max(0, (f.alliance / f.total) * (inner - gap));
      const hordeW = Math.max(0, inner - gap - allianceW);

      ctx.fillStyle = ALLIANCE;
      roundRect(ctx, PAD, y, allianceW, barH, [barH / 2, 0, 0, barH / 2]);
      ctx.fillStyle = HORDE;
      roundRect(ctx, PAD + allianceW + gap, y, hordeW, barH, [0, barH / 2, barH / 2, 0]);
    }

    // Footer — the Blizzard Developer API terms require identifying Blizzard
    // as the source of the data, and this card is the part that travels.
    ctx.fillStyle = INK_MUTED;
    ctx.font = font(400, 24);
    ctx.fillText("Data via Blizzard Entertainment · not affiliated with Blizzard", PAD, H - PAD - 4);

    return canvas;
  }

  function download(journey) {
    const canvas = draw(journey);
    const reigns = (journey.timeline && journey.timeline.reigns) || [];
    // The file is named after the character it is mostly about, since a saved
    // card called "altfolio-altoholic.png" tells its owner nothing.
    const main = reigns.length ? reigns[reigns.length - 1].character.name : null;
    const slug = main ? `${main.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-` : "";

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `altfolio-${slug}${journey.verdict.key}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }, "image/png");
  }

  function toText(journey) {
    const t = journey.totals;
    const reigns = (journey.timeline && journey.timeline.reigns) || [];

    const lines = [
      `My WoW journey says I'm ${journey.verdict.title}.`,
      journey.verdict.tagline,
      "",
    ];

    if (reigns.length) {
      lines.push("Who carried the account:");
      for (const reign of reigns) {
        lines.push(
          `· ${reignRange(reign)} — ${reign.character.name}, ${reign.character.race} ${reign.character.class} (${reign.character.realm})`
        );
      }
      lines.push("");
    }

    lines.push(
      ...journey.verdict.evidence.map((e) => `· ${e}`),
      "",
      `${t.characters} characters · ${t.classes} classes · ${t.races} races` +
        (t.activeYears ? ` · ${t.activeYears} active years` : ""),
      `${journey.factions.alliance} Alliance / ${journey.factions.horde} Horde`,
      "",
      "via altfolio — data from Blizzard Entertainment"
    );

    return lines.join("\n");
  }

  window.BnetShareCard = { draw, download, toText };
})();
