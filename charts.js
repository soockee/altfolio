// Minimal horizontal bar charts for the character breakdowns (faction /
// race / class). Each chart is a single magnitude series (character count
// per category), so it takes one sequential hue rather than a categorical
// palette — see the data-viz skill's color formula: "nominal categorical ...
// each bar takes the same slot-1 hue" when color isn't encoding identity
// beyond what the label already shows.
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

  // data: [{ label, count }, ...] — renders into `container`, replacing its contents.
  function renderBarChart(container, title, data) {
    container.classList.add("viz-root");
    container.replaceChildren();

    const heading = document.createElement("h3");
    heading.className = "chart-title";
    heading.textContent = title;
    container.appendChild(heading);

    if (data.length === 0) {
      const empty = document.createElement("p");
      empty.className = "chart-empty";
      empty.textContent = "No data.";
      container.appendChild(empty);
      return;
    }

    const total = data.reduce((sum, d) => sum + d.count, 0);
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
  }

  window.BnetCharts = { renderBarChart };
})();
