// Chart pieces the journey chapters render into.
//
// Colour follows the data-viz skill's four jobs, decided per chapter:
//   * race / class / activity counts are one magnitude series, so every bar
//     takes the same slot-1 hue — a value-ramp across nominal categories would
//     just double-encode bar length as colour.
//   * the class chapter is really "one of these is the point", so it uses
//     emphasis: the top class in slot 1, the rest in de-emphasis gray.
//   * faction is a polarity, not a set of categories, so it uses the
//     documented diverging pair (blue ↔ red — which happens to land exactly on
//     Alliance ↔ Horde). Validated in both modes: worst CVD ΔE 21.6 light /
//     19.2 dark, normal-vision 32.3 / 29.0.
//   * the timeline is continuous magnitude on a grid, so it uses the single
//     blue ramp with a scale legend, floored at ordinal step 250 (light) /
//     600 (dark) so "a little" never fades into "nothing".
(function () {
  let tooltipEl = null;

  function getTooltip() {
    if (tooltipEl) return tooltipEl;
    tooltipEl = document.createElement("div");
    tooltipEl.className = "bar-tooltip";
    tooltipEl.hidden = true;
    document.body.appendChild(tooltipEl);
    return tooltipEl;
  }

  // `lead` is the emphasised first line (the value); `detail` the line under it.
  function showTooltip(anchor, lead, detail) {
    const tip = getTooltip();

    const leadEl = document.createElement("strong");
    leadEl.textContent = lead;
    const detailEl = document.createElement("span");
    detailEl.textContent = detail;

    tip.replaceChildren(leadEl, document.createElement("br"), detailEl);
    tip.hidden = false;

    const rect = anchor.getBoundingClientRect();
    const left = rect.left + window.scrollX + rect.width / 2 - tip.offsetWidth / 2;
    tip.style.left = `${Math.max(8, Math.min(left, window.innerWidth - tip.offsetWidth - 8))}px`;
    tip.style.top = `${rect.top + window.scrollY - tip.offsetHeight - 6}px`;
  }

  function hideTooltip() {
    if (tooltipEl) tooltipEl.hidden = true;
  }

  // Wires hover + keyboard focus to the same tooltip, so nothing is
  // pointer-only.
  function attachTooltip(el, lead, detail) {
    el.tabIndex = 0;
    el.addEventListener("pointerenter", () => showTooltip(el, lead, detail));
    el.addEventListener("focus", () => showTooltip(el, lead, detail));
    el.addEventListener("pointerleave", hideTooltip);
    el.addEventListener("blur", hideTooltip);
  }

  function pct(count, total) {
    return total ? Math.round((count / total) * 100) : 0;
  }

  // Card shell shared by every chart: title, subtitle, and an optional
  // chart/table toggle wired to the two elements the caller builds.
  function buildCard(container, title, subtitle) {
    container.classList.add("viz-root", "chart-card");
    container.replaceChildren();

    const header = document.createElement("div");
    header.className = "chart-header";

    const heading = document.createElement("div");
    const titleEl = document.createElement("h3");
    titleEl.className = "chart-title";
    titleEl.textContent = title;
    heading.appendChild(titleEl);

    if (subtitle) {
      const subEl = document.createElement("p");
      subEl.className = "chart-subtitle";
      subEl.textContent = subtitle;
      heading.appendChild(subEl);
    }

    header.appendChild(heading);
    container.appendChild(header);
    return header;
  }

  function addTableToggle(header, chartEl, tableEl) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "chart-toggle";
    toggle.textContent = "View as table";
    header.appendChild(toggle);

    toggle.addEventListener("click", () => {
      const showTable = tableEl.hidden;
      tableEl.hidden = !showTable;
      chartEl.hidden = showTable;
      toggle.textContent = showTable ? "View as chart" : "View as table";
    });
  }

  function buildTable(columns, rows) {
    const table = document.createElement("table");
    table.className = "chart-table";
    table.hidden = true;

    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const text of columns) {
      const th = document.createElement("th");
      th.scope = "col";
      th.textContent = text;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (const cells of rows) {
      const tr = document.createElement("tr");
      const th = document.createElement("th");
      th.scope = "row";
      th.textContent = cells[0];
      tr.appendChild(th);
      for (const cell of cells.slice(1)) {
        const td = document.createElement("td");
        td.textContent = cell;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    return table;
  }

  // tiles: [{ label, value, sub }, ...] — renders into `container`, replacing its contents.
  function renderKpiRow(container, tiles) {
    container.classList.add("viz-root");
    container.replaceChildren();

    for (const { label, value, sub } of tiles) {
      const tile = document.createElement("div");
      tile.className = "kpi-tile";

      const labelEl = document.createElement("span");
      labelEl.className = "kpi-label";
      labelEl.textContent = label;

      const valueEl = document.createElement("span");
      valueEl.className = "kpi-value";
      valueEl.textContent = value;

      tile.append(labelEl, valueEl);

      if (sub) {
        const subEl = document.createElement("span");
        subEl.className = "kpi-sub";
        subEl.textContent = sub;
        tile.appendChild(subEl);
      }

      container.appendChild(tile);
    }
  }

  // Resolves `iconFn(label)` (if given) and drops the result into `slot` once
  // it lands. Used for the optional leading icon on a bar row — resolution is
  // async and best-effort, so the row already looks complete without it; the
  // icon just fades in on top when (and if) it arrives.
  function fillIcon(slot, iconFn, label) {
    Promise.resolve(iconFn(label)).then((url) => {
      if (!url) return;
      const img = document.createElement("img");
      img.src = url;
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      img.onerror = () => img.remove();
      slot.appendChild(img);
    });
  }

  // data: [{ label, count }, ...] — renders into `container`, replacing its contents.
  // options.unit names what each count measures (default "characters").
  // options.emphasis is a label to highlight; every other bar goes gray.
  // options.icon, if given, is (label) => url | Promise<url|null> — a small
  // decorative icon rendered before the label; resolved best-effort, see
  // fillIcon above.
  function renderBarChart(container, title, data, options = {}) {
    const unit = options.unit || "characters";
    const total = data.reduce((sum, d) => sum + d.count, 0);
    const singular = unit.endsWith("s") ? unit.slice(0, -1) : unit;

    const header = buildCard(container, title, total === 1 ? `1 ${singular}` : `${total} ${unit}`);

    if (data.length === 0) {
      const empty = document.createElement("p");
      empty.className = "chart-empty";
      empty.textContent = "No data.";
      container.appendChild(empty);
      return;
    }

    const max = Math.max(...data.map((d) => d.count));

    const rows = document.createElement("div");
    rows.className = "chart-rows";

    for (const { label, count } of data) {
      const row = document.createElement("div");
      row.className = "bar-row";
      if (options.emphasis && label !== options.emphasis) row.classList.add("is-muted");

      const labelEl = document.createElement("span");
      labelEl.className = "bar-label";

      if (options.icon) {
        labelEl.classList.add("bar-label-iconed");
        const iconSlot = document.createElement("span");
        iconSlot.className = "wow-icon bar-icon";
        const text = document.createElement("span");
        text.className = "bar-label-text";
        text.textContent = label;
        labelEl.append(iconSlot, text);
        fillIcon(iconSlot, options.icon, label);
      } else {
        labelEl.textContent = label;
      }

      const track = document.createElement("div");
      track.className = "bar-track";
      const fill = document.createElement("div");
      fill.className = "bar-fill";
      fill.style.width = `${(count / max) * 100}%`;
      track.appendChild(fill);

      const valueEl = document.createElement("span");
      valueEl.className = "bar-value";
      valueEl.textContent = String(count);

      row.append(labelEl, track, valueEl);
      attachTooltip(row, `${count} (${pct(count, total)}%)`, label);
      rows.appendChild(row);
    }

    container.appendChild(rows);

    const table = buildTable(
      [title, "Count", "Share"],
      data.map(({ label, count }) => [label, String(count), `${pct(count, total)}%`])
    );
    container.appendChild(table);
    addTableToggle(header, rows, table);
  }

  // A single split bar for a two-sided polarity. `left` and `right` are
  // { label, count }; both values are always directly labelled, so nothing is
  // carried by colour alone.
  function renderTugOfWar(container, left, right) {
    const total = left.count + right.count;
    buildCard(container, "Faction", `${total} character${total === 1 ? "" : "s"} picking a side`);

    if (total === 0) {
      const empty = document.createElement("p");
      empty.className = "chart-empty";
      empty.textContent = "No faction data.";
      container.appendChild(empty);
      return;
    }

    // Derive the second share from the first rather than rounding both: 14/16
    // and 2/16 independently rounded read as "88% / 13%", which sums to 101%.
    const leftPct = pct(left.count, total);
    const shares = { left: leftPct, right: 100 - leftPct };

    const legend = document.createElement("div");
    legend.className = "chart-legend";
    for (const [side, entry] of [["left", left], ["right", right]]) {
      const item = document.createElement("span");
      item.className = "legend-item";
      const swatch = document.createElement("span");
      swatch.className = `legend-swatch is-${side}`;
      const text = document.createElement("span");
      text.textContent = `${entry.label} — ${entry.count}`;
      item.append(swatch, text);
      legend.appendChild(item);
    }
    container.appendChild(legend);

    const bar = document.createElement("div");
    bar.className = "tug-bar";

    for (const [side, entry] of [["left", left], ["right", right]]) {
      const seg = document.createElement("div");
      seg.className = `tug-seg is-${side}`;
      seg.style.flexGrow = String(entry.count);
      // A zero-count side keeps a hairline sliver so the bar still reads as
      // two-sided rather than as a solid block of the winning colour.
      if (entry.count === 0) seg.classList.add("is-empty");
      attachTooltip(seg, `${entry.count} (${shares[side]}%)`, entry.label);
      bar.appendChild(seg);
    }

    // The 50% reference: without it a 55/45 split looks like a rout.
    const midpoint = document.createElement("div");
    midpoint.className = "tug-midpoint";
    bar.appendChild(midpoint);

    container.appendChild(bar);

    const labels = document.createElement("div");
    labels.className = "tug-labels";
    const leftLabel = document.createElement("span");
    leftLabel.textContent = `${shares.left}% ${left.label}`;
    const rightLabel = document.createElement("span");
    rightLabel.textContent = `${shares.right}% ${right.label}`;
    labels.append(leftLabel, rightLabel);
    container.appendChild(labels);
  }

  const SVG_NS = "http://www.w3.org/2000/svg";

  function svgEl(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const key in attrs) node.setAttribute(key, attrs[key]);
    return node;
  }

  // Rounds an axis maximum up to a 1/2/5 × 10ⁿ step, so ticks land on numbers
  // a reader can do arithmetic with.
  function niceCeil(value) {
    if (value <= 0) return 1;
    const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
    const normalized = value / magnitude;
    const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
    return step * magnitude;
  }

  // Trend over time, as a line with an area wash — not a bar per month. A
  // decade of monthly totals is ~200 points; drawn as bars that is a wall
  // nobody reads, and it throws away the one thing the reader wants from a
  // time series, which is its shape.
  function renderTimeSeries(container, title, data, options = {}) {
    const unit = options.unit || "achievements";
    const total = data.reduce((sum, d) => sum + d.count, 0);
    const header = buildCard(
      container,
      title,
      `${total.toLocaleString()} ${unit} across ${data.length} month${data.length === 1 ? "" : "s"}`
    );

    if (data.length === 0) {
      const empty = document.createElement("p");
      empty.className = "chart-empty";
      empty.textContent = "No data.";
      container.appendChild(empty);
      return;
    }

    const W = 720;
    const H = 210;
    const L = 46;
    const R = 12;
    const T = 12;
    const B = 26;
    const plotW = W - L - R;
    const plotH = H - T - B;

    const max = niceCeil(Math.max(...data.map((d) => d.count)));
    const xAt = (i) => (data.length === 1 ? L + plotW / 2 : L + (i / (data.length - 1)) * plotW);
    const yAt = (v) => T + plotH - (v / max) * plotH;

    const chartWrap = document.createElement("div");
    const svg = svgEl("svg", {
      viewBox: `0 0 ${W} ${H}`,
      class: "ts-svg",
      role: "img",
      tabindex: "0",
      "aria-label": `${title}: ${total.toLocaleString()} ${unit} from ${data[0].label} to ${data[data.length - 1].label}.`,
    });

    // Gridlines: hairline, solid, one step off the surface.
    for (const frac of [0, 0.5, 1]) {
      const value = max * frac;
      const y = yAt(value);
      svg.appendChild(svgEl("line", { class: "ts-grid", x1: L, x2: W - R, y1: y, y2: y }));
      const label = svgEl("text", { class: "ts-axis", x: L - 8, y: y + 4, "text-anchor": "end" });
      label.textContent = value.toLocaleString();
      svg.appendChild(label);
    }

    // Year ticks, thinned so labels never collide.
    const januaries = data.map((d, i) => ({ i, d })).filter(({ d }) => d.label.endsWith("-01"));
    const stride = Math.max(1, Math.ceil(januaries.length / 8));
    januaries.forEach(({ i, d }, n) => {
      if (n % stride !== 0) return;
      const tick = svgEl("text", { class: "ts-axis", x: xAt(i), y: H - 8, "text-anchor": "middle" });
      tick.textContent = d.label.slice(0, 4);
      svg.appendChild(tick);
    });

    const line = data.map((d, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(1)},${yAt(d.count).toFixed(1)}`).join(" ");
    svg.appendChild(
      svgEl("path", { class: "ts-area", d: `${line} L${xAt(data.length - 1).toFixed(1)},${yAt(0)} L${xAt(0).toFixed(1)},${yAt(0)} Z` })
    );
    svg.appendChild(svgEl("path", { class: "ts-line", d: line }));

    // Hover layer: a crosshair and marker snapped to the nearest month, driven
    // by pointer position or by arrow keys, so the two agree.
    const crosshair = svgEl("line", { class: "ts-crosshair", y1: T, y2: T + plotH, x1: 0, x2: 0 });
    const marker = svgEl("circle", { class: "ts-marker", r: 4, cx: 0, cy: 0 });
    crosshair.style.display = "none";
    marker.style.display = "none";
    svg.append(crosshair, marker);

    let active = -1;

    function focusIndex(i) {
      if (i < 0 || i >= data.length) return;
      active = i;
      const x = xAt(i);
      const y = yAt(data[i].count);
      crosshair.setAttribute("x1", x);
      crosshair.setAttribute("x2", x);
      marker.setAttribute("cx", x);
      marker.setAttribute("cy", y);
      crosshair.style.display = "";
      marker.style.display = "";

      // Anchor the tooltip to the marker rather than the whole chart.
      const box = svg.getBoundingClientRect();
      const anchor = {
        getBoundingClientRect: () => ({
          left: box.left + (x / W) * box.width,
          top: box.top + (y / H) * box.height,
          width: 0,
          height: 0,
        }),
      };
      showTooltip(anchor, `${data[i].count.toLocaleString()} ${unit}`, data[i].label);
    }

    function clearFocus() {
      active = -1;
      crosshair.style.display = "none";
      marker.style.display = "none";
      hideTooltip();
    }

    svg.addEventListener("pointermove", (event) => {
      const box = svg.getBoundingClientRect();
      const x = ((event.clientX - box.left) / box.width) * W;
      const ratio = (x - L) / plotW;
      focusIndex(Math.max(0, Math.min(data.length - 1, Math.round(ratio * (data.length - 1)))));
    });
    svg.addEventListener("pointerleave", clearFocus);
    svg.addEventListener("blur", clearFocus);
    svg.addEventListener("focus", () => focusIndex(active < 0 ? data.length - 1 : active));
    svg.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      focusIndex(Math.max(0, Math.min(data.length - 1, active + (event.key === "ArrowRight" ? 1 : -1))));
    });

    chartWrap.appendChild(svg);
    container.appendChild(chartWrap);

    const table = buildTable(
      ["Month", unit.charAt(0).toUpperCase() + unit.slice(1)],
      data.map((d) => [d.label, d.count.toLocaleString()])
    );
    container.appendChild(table);
    addTableToggle(header, chartWrap, table);
  }

  // Bins non-zero values by rank rather than by value. Achievement counts per
  // year are heavily skewed — one launch year can dwarf a decade — and linear
  // bins would flatten everything but the peak into a single shade.
  function quantileBinner(values, binCount) {
    const sorted = values.slice().sort((a, b) => a - b);
    return (v) => {
      if (v <= 0) return -1;
      let lo = 0;
      let hi = sorted.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (sorted[mid] < v) lo = mid + 1;
        else hi = mid;
      }
      return Math.min(binCount - 1, Math.floor((lo / sorted.length) * binCount));
    };
  }

  const HEAT_BINS = 5;

  // The counts that actually landed in each bin, so the scale can be labelled
  // with numbers rather than with "quieter → busier". Quantile bins have no
  // fixed edges a reader could guess at, and the ramp deliberately runs
  // light→dark in light mode and dark→light in dark mode, so the words alone
  // leave you working out which end of the blue means more.
  function binRanges(values, binOf) {
    const ranges = new Array(HEAT_BINS).fill(null);
    for (const value of new Set(values)) {
      const bin = binOf(value);
      if (bin < 0) continue;
      const range = ranges[bin];
      if (!range) ranges[bin] = { min: value, max: value };
      else {
        range.min = Math.min(range.min, value);
        range.max = Math.max(range.max, value);
      }
    }
    return ranges;
  }

  function crownIcon() {
    const svg = svgEl("svg", { viewBox: "0 0 24 24", class: "crown-glyph", "aria-hidden": "true" });
    svg.appendChild(svgEl("path", { d: "M2.7 6.4 7.7 10.2 12 3.4l4.3 6.8 5-3.8-1.8 13.2H4.5L2.7 6.4Z" }));
    return svg;
  }

  function heatSwatch(bin, label) {
    const swatch = document.createElement("span");
    swatch.className = "heat-swatch";

    const chip = document.createElement("span");
    chip.className = "heat-step";
    if (bin !== null) chip.dataset.heat = String(bin);

    const text = document.createElement("span");
    text.className = "heat-swatch-label";
    text.textContent = label;

    swatch.append(chip, text);
    return swatch;
  }

  function reignRange(reign) {
    return reign.from === reign.to ? String(reign.from) : `${reign.from}–${reign.to}`;
  }

  // Character × year grid: one row per character, one cell per calendar year,
  // shaded by how much that character did that year — with the character who
  // owned each year marked on top of the shading, since "who was my main, and
  // when" is the question this chapter is really answering. The mark is a
  // crown plus a ring, not a shade: it has to survive both themes and sit on
  // any step of the ramp.
  function renderTimeline(container, lanes, years, options = {}) {
    const maxRows = options.maxRows || 18;
    const eras = options.eras || [];
    const reigns = options.reigns || [];

    const header = buildCard(
      container,
      "Your WoW years",
      years.length ? `${years[0]}–${years[years.length - 1]}, by achievements earned` : null
    );

    if (lanes.length === 0 || years.length === 0) {
      const empty = document.createElement("p");
      empty.className = "chart-empty";
      empty.textContent = "Not enough dated history to draw a timeline.";
      container.appendChild(empty);
      return;
    }

    const allCounts = [];
    for (const lane of lanes) for (const count of lane.byYear.values()) allCounts.push(count);
    const binOf = quantileBinner(allCounts, HEAT_BINS);
    const ranges = binRanges(allCounts, binOf);

    const eraByYear = new Map(eras.map((era) => [era.year, era]));
    const yearsHeld = new Map();
    for (const era of eras) yearsHeld.set(era.character.key, (yearsHeld.get(era.character.key) || 0) + 1);

    const reignsByKey = new Map();
    for (const reign of reigns) {
      const list = reignsByKey.get(reign.character.key) || [];
      list.push(reignRange(reign));
      reignsByKey.set(reign.character.key, list);
    }

    // A main who never earned enough overall to make the row cap is exactly
    // the row a reader goes looking for, so mains are always kept.
    const capped = new Set(lanes.slice(0, maxRows).map((lane) => lane.character.key));
    const shown = lanes.filter((lane) => capped.has(lane.character.key) || yearsHeld.has(lane.character.key));

    // Grid, scale legend and row-cap note toggle together as one unit against
    // the table view.
    const chartWrap = document.createElement("div");

    const scroller = document.createElement("div");
    scroller.className = "timeline-scroll";

    const grid = document.createElement("div");
    grid.className = "timeline-grid";
    grid.style.setProperty("--year-count", String(years.length));

    // Header row: a blank corner, then the year ticks.
    const corner = document.createElement("div");
    corner.className = "timeline-corner";
    grid.appendChild(corner);
    for (const year of years) {
      const tick = document.createElement("div");
      tick.className = "timeline-year";
      // Only every other tick is labelled once the range gets long, so the
      // labels never collide.
      tick.textContent = years.length > 12 && year % 2 !== years[0] % 2 ? "" : String(year);
      grid.appendChild(tick);
    }

    // Reign ribbon: one named bar per stretch of years under the same
    // character, sitting directly above the rows it describes. The cell marks
    // below say which row owned a year; this says who, by name, without
    // hovering anything.
    if (reigns.length) {
      const ribbonLabel = document.createElement("div");
      ribbonLabel.className = "timeline-label timeline-ribbon-label";
      ribbonLabel.textContent = "Main";
      ribbonLabel.title = "The character who earned the most that year";
      grid.appendChild(ribbonLabel);

      let i = 0;
      while (i < years.length) {
        const era = eraByYear.get(years[i]);
        let span = 1;
        while (i + span < years.length) {
          const next = eraByYear.get(years[i + span]);
          const continues = era && next ? next.character.key === era.character.key : !era && !next;
          if (!continues) break;
          span++;
        }

        const segment = document.createElement("div");
        segment.className = era ? "timeline-reign" : "timeline-reign is-empty";
        segment.style.gridColumn = `span ${span}`;

        if (era) {
          const from = years[i];
          const to = years[i + span - 1];
          const name = document.createElement("span");
          name.className = "timeline-reign-name";
          name.textContent = era.character.name;
          segment.append(crownIcon(), name);
          attachTooltip(
            segment,
            era.character.name,
            from === to ? `Your main in ${from}` : `Your main, ${from}–${to}`
          );
        }

        grid.appendChild(segment);
        i += span;
      }
    }

    for (const lane of shown) {
      const held = yearsHeld.get(lane.character.key) || 0;

      const label = document.createElement("div");
      label.className = held ? "timeline-label is-main" : "timeline-label";
      if (held) label.appendChild(crownIcon());
      const labelName = document.createElement("span");
      labelName.className = "timeline-label-name";
      labelName.textContent = lane.character.name;
      label.appendChild(labelName);
      label.title =
        `${lane.character.name} — ${lane.character.race} ${lane.character.class}, ${lane.character.realm}` +
        (held ? ` · your main in ${(reignsByKey.get(lane.character.key) || []).join(", ")}` : "");
      grid.appendChild(label);

      for (const year of years) {
        const count = lane.byYear.get(year) || 0;
        const cell = document.createElement("div");
        cell.className = "timeline-cell";
        const bin = binOf(count);
        if (bin >= 0) cell.dataset.heat = String(bin);

        const era = eraByYear.get(year);
        const isMain = Boolean(era) && era.character.key === lane.character.key;
        if (isMain) {
          cell.classList.add("is-main");
          cell.appendChild(crownIcon());
        }

        attachTooltip(
          cell,
          count === 0 ? "Nothing recorded" : `${count} achievement${count === 1 ? "" : "s"}`,
          `${lane.character.name} · ${year}${isMain ? " · your main" : ""}`
        );
        grid.appendChild(cell);
      }
    }

    scroller.appendChild(grid);
    chartWrap.appendChild(scroller);

    // Sequential scales need a scale legend — the shades mean nothing without
    // one, and here each step carries the count range it stands for so neither
    // the direction of the ramp nor "how busy is busy" has to be inferred.
    const scale = document.createElement("div");
    scale.className = "heat-legend";

    const scaleTitle = document.createElement("span");
    scaleTitle.className = "heat-legend-title";
    scaleTitle.textContent = "Achievements earned";

    const ramp = document.createElement("span");
    ramp.className = "heat-ramp";
    ramp.appendChild(heatSwatch(null, "0"));
    for (let i = 0; i < HEAT_BINS; i++) {
      const range = ranges[i];
      // An account with fewer distinct counts than bins leaves gaps; an
      // unlabelled empty step would just be a shade with no meaning.
      if (!range) continue;
      ramp.appendChild(heatSwatch(i, range.min === range.max ? String(range.min) : `${range.min}–${range.max}`));
    }
    scale.append(scaleTitle, ramp);

    if (eras.length) {
      const mainKey = document.createElement("span");
      mainKey.className = "heat-legend-main";
      const chip = document.createElement("span");
      chip.className = "heat-step is-main";
      chip.appendChild(crownIcon());
      mainKey.append(chip, document.createTextNode("Your main that year"));
      scale.appendChild(mainKey);
    }

    chartWrap.appendChild(scale);

    if (lanes.length > shown.length) {
      const note = document.createElement("p");
      note.className = "chart-note";
      note.textContent = `Showing ${shown.length} of ${lanes.length} characters — every year's main is included. All of them are in the table view.`;
      chartWrap.appendChild(note);
    }

    container.appendChild(chartWrap);

    // Table twin — the timeline is colour-encoded magnitude, so the numbers
    // have to be reachable without reading shades. Every lane appears here,
    // including the ones trimmed from the grid.
    const table = buildTable(
      ["Character", "First seen", "Last seen", "Achievements", "Main in"],
      lanes.map((lane) => [
        `${lane.character.name} (${lane.character.realm})`,
        lane.firstSeen ? new Date(lane.firstSeen).toISOString().slice(0, 7) : "—",
        lane.lastSeen ? new Date(lane.lastSeen).toISOString().slice(0, 7) : "—",
        String(lane.total),
        (reignsByKey.get(lane.character.key) || []).join(", ") || "—",
      ])
    );
    container.appendChild(table);
    addTableToggle(header, chartWrap, table);
  }

  // One row per expansion, in the order they were played, naming the character
  // who cleared the most of it — the expansion-scale answer to "who was my
  // main", where the timeline grid above gives the year-scale one.
  //
  // The bar carries that character's *share* of the account's boss kills in
  // that expansion, not the raw count, because the interesting thing is how
  // decisively they held it: a 90% share is a main, a 40% share is a roster
  // that was being played evenly.
  function renderReigns(container, eras, options = {}) {
    const header = buildCard(
      container,
      "Who held each expansion",
      eras.length ? "By raid bosses killed, oldest expansion first" : null
    );

    if (eras.length === 0) {
      const empty = document.createElement("p");
      empty.className = "chart-empty";
      empty.textContent = "No raid history to attribute.";
      container.appendChild(empty);
      return;
    }

    const rows = document.createElement("div");
    rows.className = "chart-rows";

    for (const era of eras) {
      const row = document.createElement("div");
      row.className = "bar-row reign-row";

      const labelEl = document.createElement("span");
      labelEl.className = "bar-label";
      labelEl.textContent = era.expansion;

      const track = document.createElement("div");
      track.className = "bar-track";
      const fill = document.createElement("div");
      fill.className = "bar-fill";
      fill.style.width = `${Math.round(era.share * 100)}%`;
      track.appendChild(fill);

      const holder = document.createElement("span");
      holder.className = "bar-value reign-holder";
      holder.append(crownIcon(), document.createTextNode(era.character.name));

      row.append(labelEl, track, holder);
      attachTooltip(
        row,
        `${era.character.name} — ${era.bosses} boss${era.bosses === 1 ? "" : "es"}, ${Math.round(era.share * 100)}% of the account's kills`,
        era.expansion
      );
      rows.appendChild(row);
    }

    // Rows and the caveat under them toggle as one unit against the table, the
    // same way the timeline's grid and its row-cap note do.
    const chartWrap = document.createElement("div");
    chartWrap.appendChild(rows);
    if (options.note) {
      const note = document.createElement("p");
      note.className = "chart-note";
      note.textContent = options.note;
      chartWrap.appendChild(note);
    }
    container.appendChild(chartWrap);

    const table = buildTable(
      ["Expansion", "Main", "Bosses", "Share", "Last kill"],
      eras.map((era) => [
        era.expansion,
        `${era.character.name} (${era.character.realm})`,
        String(era.bosses),
        `${Math.round(era.share * 100)}%`,
        era.to ? new Date(era.to).toISOString().slice(0, 7) : "—",
      ])
    );
    container.appendChild(table);
    addTableToggle(header, chartWrap, table);
  }

  window.BnetCharts = {
    renderKpiRow,
    renderBarChart,
    renderTugOfWar,
    renderTimeSeries,
    renderTimeline,
    renderReigns,
    fillIcon,
  };
})();
