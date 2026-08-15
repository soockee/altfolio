// Dashboard pieces for the character breakdowns: a KPI row of stat tiles and
// horizontal bar-chart cards (faction / race / class). Each bar chart is a
// single magnitude series (character count per category), so it takes one
// sequential hue rather than a categorical palette — see the data-viz skill's
// color formula: "nominal categorical ... each bar takes the same slot-1 hue"
// when color isn't encoding identity beyond what the label already shows.
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

  function showTooltip(row, label, count, total) {
    const tip = getTooltip();
    const pct = total ? Math.round((count / total) * 100) : 0;

    const value = document.createElement("strong");
    value.textContent = `${count} (${pct}%)`;
    const name = document.createElement("span");
    name.textContent = label;

    tip.replaceChildren(value, document.createElement("br"), name);
    tip.hidden = false;

    const rect = row.getBoundingClientRect();
    tip.style.left = `${rect.left + window.scrollX}px`;
    tip.style.top = `${rect.top + window.scrollY - tip.offsetHeight - 6}px`;
  }

  function hideTooltip() {
    if (tooltipEl) tooltipEl.hidden = true;
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

  // data: [{ label, count }, ...] — renders into `container`, replacing its contents.
  // unit names what each count measures (defaults to "characters" for the
  // faction/race/class breakdowns); pass e.g. "achievements" for other data.
  function renderBarChart(container, title, data, unit = "characters") {
    container.classList.add("viz-root", "chart-card");
    container.replaceChildren();

    const total = data.reduce((sum, d) => sum + d.count, 0);
    const singularUnit = unit.endsWith("s") ? unit.slice(0, -1) : unit;

    const header = document.createElement("div");
    header.className = "chart-header";

    const heading = document.createElement("div");
    const titleEl = document.createElement("h3");
    titleEl.className = "chart-title";
    titleEl.textContent = title;
    const subEl = document.createElement("p");
    subEl.className = "chart-subtitle";
    subEl.textContent = total === 1 ? `1 ${singularUnit}` : `${total} ${unit}`;
    heading.append(titleEl, subEl);
    header.appendChild(heading);

    if (data.length > 0) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "chart-toggle";
      toggle.textContent = "View as table";
      header.appendChild(toggle);
      toggle.addEventListener("click", () => {
        const showTable = table.hidden;
        table.hidden = !showTable;
        rows.hidden = showTable;
        toggle.textContent = showTable ? "View as chart" : "View as table";
      });
    }

    container.appendChild(header);

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
      row.tabIndex = 0;

      const labelEl = document.createElement("span");
      labelEl.className = "bar-label";
      labelEl.textContent = label;

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
      row.addEventListener("pointerenter", () => showTooltip(row, label, count, total));
      row.addEventListener("focus", () => showTooltip(row, label, count, total));
      row.addEventListener("pointerleave", hideTooltip);
      row.addEventListener("blur", hideTooltip);

      rows.appendChild(row);
    }

    container.appendChild(rows);

    // Table view: the accessibility twin of the chart, kept in sync with the same data.
    const table = document.createElement("table");
    table.className = "chart-table";
    table.hidden = true;

    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const text of [title, "Count", "Share"]) {
      const th = document.createElement("th");
      th.scope = "col";
      th.textContent = text;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (const { label, count } of data) {
      const tr = document.createElement("tr");

      const th = document.createElement("th");
      th.scope = "row";
      th.textContent = label;

      const countTd = document.createElement("td");
      countTd.textContent = String(count);

      const pctTd = document.createElement("td");
      pctTd.textContent = total ? `${Math.round((count / total) * 100)}%` : "0%";

      tr.append(th, countTd, pctTd);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    container.appendChild(table);
  }

  window.BnetCharts = { renderKpiRow, renderBarChart };
})();
