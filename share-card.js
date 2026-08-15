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

  // Dark-mode steps from the same palette the charts use, since the card is
  // always dark.
  const INK = "#ffffff";
  const INK_SECONDARY = "#c3c2b7";
  const INK_MUTED = "#898781";
  const SURFACE = "#1a1a19";
  const PLANE = "#0d0d0d";
  const ALLIANCE = "#3987e5";
  const HORDE = "#e66767";

  const SANS = 'system-ui, -apple-system, "Segoe UI", sans-serif';
  const font = (weight, size) => `${weight} ${size}px ${SANS}`;

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

  function draw(journey) {
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    ctx.textBaseline = "top";

    ctx.fillStyle = PLANE;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = SURFACE;
    roundRect(ctx, 32, 32, W - 64, H - 64, 40);

    const inner = W - PAD * 2;
    let y = PAD + 10;

    // Masthead
    ctx.fillStyle = INK_MUTED;
    ctx.font = font(600, 26);
    ctx.letterSpacing = "4px";
    ctx.fillText("ALTFOLIO · YOUR WOW JOURNEY", PAD, y);
    ctx.letterSpacing = "0px";
    y += 74;

    // Verdict
    ctx.fillStyle = INK_SECONDARY;
    ctx.font = font(400, 34);
    ctx.fillText("You are", PAD, y);
    y += 58;

    ctx.fillStyle = INK;
    ctx.font = font(700, 96);
    y = drawLines(ctx, wrap(ctx, journey.verdict.title, inner, 2), PAD, y, 104) + 14;

    ctx.fillStyle = INK_SECONDARY;
    ctx.font = font(400, 38);
    y = drawLines(ctx, wrap(ctx, journey.verdict.tagline, inner, 2), PAD, y, 50) + 44;

    // Evidence
    ctx.font = font(400, 30);
    for (const line of journey.verdict.evidence.slice(0, 3)) {
      ctx.fillStyle = ALLIANCE;
      ctx.fillText("•", PAD, y);
      ctx.fillStyle = INK_SECONDARY;
      y = drawLines(ctx, wrap(ctx, line, inner - 34, 2), PAD + 34, y, 40) + 12;
    }

    // Stat strip, pinned low so the card's lower third is stable whatever the
    // verdict text runs to. The hairline above it turns the slack left by a
    // short verdict into deliberate separation rather than a hole.
    y = Math.max(y + 40, 880);
    ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
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
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `altfolio-${journey.verdict.key}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }, "image/png");
  }

  function toText(journey) {
    const t = journey.totals;
    const lines = [
      `My WoW journey says I'm ${journey.verdict.title}.`,
      journey.verdict.tagline,
      "",
      ...journey.verdict.evidence.map((e) => `· ${e}`),
      "",
      `${t.characters} characters · ${t.classes} classes · ${t.races} races` +
        (t.activeYears ? ` · ${t.activeYears} active years` : ""),
      `${journey.factions.alliance} Alliance / ${journey.factions.horde} Horde`,
      "",
      "via altfolio — data from Blizzard Entertainment",
    ];
    return lines.join("\n");
  }

  window.BnetShareCard = { draw, download, toText };
})();
