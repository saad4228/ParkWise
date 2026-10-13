// Reports - summaries worked out by the backend from the stored records.
//
// The two charts are plain SVG drawn by hand. A charting library would be
// another dependency to install and explain, and these two shapes - a bar
// chart and a donut - are a few lines of geometry each.

import { api } from '../api.js';
import {
  escapeHtml, money, moneyShort, duration, hourRange, vehicleTypeLabel,
  dateInputToStartTimestamp, dateInputToEndTimestamp, timestampToDateInput,
} from '../format.js';
import { statCard, emptyState, errorState, loadingState, toast, countUp } from '../ui.js';

// The three series colours live in the stylesheet as --chart-* tokens, which
// were checked for contrast against the card and for separation from each
// other under the common forms of colour blindness. The dark theme defines its
// own three rather than reusing these. Order is fixed: a type always gets the
// same colour, whether or not the other two appear.
const TYPE_COLOURS = {
  CAR: 'var(--chart-car)',
  BIKE: 'var(--chart-bike)',
  SUV: 'var(--chart-suv)',
};

// Revenue is one series, so it takes a single hue of its own rather than
// borrowing one that means a vehicle type in the donut beside it.


export async function render(container) {
  // Default window: the last 14 days up to and including today.
  const today = new Date();
  const twoWeeksAgo = new Date(today.getTime() - 13 * 86400000);

  const state = {
    fromDate: timestampToDateInput(Math.floor(twoWeeksAgo.getTime() / 1000)),
    toDate: timestampToDateInput(Math.floor(today.getTime() / 1000)),
  };

  container.innerHTML = `
    <div class="page-head">
      <div class="page-head__text">
        <h1>Reports</h1>
        <p>Analyse parking statistics and revenue</p>
      </div>
      <div class="page-head__actions">
        <div class="chip-row" role="group" aria-label="Quick date ranges">
          <button class="chip" type="button" data-range="today">Today</button>
          <button class="chip" type="button" data-range="7">Last 7 days</button>
          <button class="chip" type="button" data-range="14">Last 14 days</button>
          <button class="chip" type="button" data-range="30">Last 30 days</button>
          <button class="chip" type="button" data-range="all">All time</button>
        </div>
        <label class="sr-only" for="repFrom">From date</label>
        <input class="input" id="repFrom" type="date" style="width:auto" value="${state.fromDate}">
        <span class="cell-muted" style="align-self:center">to</span>
        <label class="sr-only" for="repTo">To date</label>
        <input class="input" id="repTo" type="date" style="width:auto" value="${state.toDate}">
      </div>
    </div>
    <div id="reportBody">${loadingState(6)}</div>`;

  const body = container.querySelector('#reportBody');
  const fromInput = container.querySelector('#repFrom');
  const toInput = container.querySelector('#repTo');

  async function load() {
    body.innerHTML = loadingState(6);
    try {
      const params = {};
      const from = dateInputToStartTimestamp(state.fromDate);
      const to = dateInputToEndTimestamp(state.toDate);
      if (from) params.from = from;
      if (to) params.to = to;

      const data = await api.reports(params);
      draw(data);
      countUp(body);
    } catch (problem) {
      body.innerHTML = errorState(problem.message);
      body.querySelector('[data-retry]')?.addEventListener('click', load);
    }
  }

  function draw(data) {
    const hasData = data.totalVehiclesServed > 0 || data.completedSessions > 0;

    body.innerHTML = `
      <div class="stack">
        <div class="grid grid--stats">
          ${statCard({
            label: 'Total Vehicles', value: String(data.totalVehiclesServed),
            hint: 'Sessions started in range', iconId: '#i-car', tone: 'info',
          })}
          ${statCard({
            label: 'Total Revenue', value: moneyShort(data.totalRevenuePaise),
            hint: `${data.completedSessions} checkout${data.completedSessions === 1 ? '' : 's'}`,
            iconId: '#i-rupee', tone: 'ok',
          })}
          ${statCard({
            label: 'Average Duration',
            value: data.completedSessions ? duration(data.averageDurationMinutes) : '—',
            hint: 'Across completed sessions', iconId: '#i-clock', tone: 'violet',
          })}
          ${statCard({
            label: 'Peak Hour', value: hourRange(data.peakEntryHour),
            hint: data.peakEntryHourCount
              ? `${data.peakEntryHourCount} entries` : 'No entries yet',
            iconId: '#i-reports', tone: 'warn',
          })}
        </div>

        ${hasData ? `
          <div class="grid grid--2">
            <section class="card">
              <div class="card__head">
                <div><h2>Revenue by Day</h2><p>Counted on the day each vehicle paid</p></div>
              </div>
              <div class="card__body">${barChart(data.revenueByDay)}</div>
            </section>

            <section class="card">
              <div class="card__head">
                <div><h2>Vehicle Type Distribution</h2><p>Counted on the day each vehicle arrived</p></div>
              </div>
              <div class="card__body">${donutChart(data.vehicleTypeDistribution)}</div>
            </section>
          </div>

          <section class="card">
            <div class="card__head">
              <div>
                <h2>How these numbers are worked out</h2>
                <p>A session is counted on the day it arrived; its money is counted on the day it paid.</p>
              </div>
            </div>
            <div class="card__body">
              <div class="note-grid">
                <div><h4>Total Vehicles</h4>
                  <p>Every session that <em>started</em> inside the date range, whether or not it has ended.</p></div>
                <div><h4>Total Revenue</h4>
                  <p>Fees from sessions that were <em>checked out</em> inside the range. A vehicle
                     still parked has not paid, so it adds nothing yet.</p></div>
                <div><h4>Average Duration</h4>
                  <p>The mean stay across the completed sessions counted above.</p></div>
                <div><h4>Peak Hour</h4>
                  <p>The hour of the day that saw the most arrivals inside the range.</p></div>
              </div>
            </div>
          </section>
        ` : `
          <section class="card"><div class="card__body">${emptyState({
            title: 'No activity in this period',
            text: 'Pick a wider date range, or check in a vehicle to start building a history.',
            iconId: '#i-reports',
            actionHtml: '<button class="btn btn--ghost btn--sm" id="emptyAllTime">Show all time</button>',
          })}</div></section>`}
      </div>`;

    body.querySelector('#emptyAllTime')?.addEventListener('click', showAllTime);
  }

  function showAllTime() {
    applyRange('all');
  }

  // "Last 7 days" was previously two date pickers and some counting on the
  // operator's part. The ranges people actually ask for are now one click,
  // and the chosen one stays marked so the numbers on screen always say which
  // period they describe. The date boxes remain for anything else.
  function applyRange(range) {
    if (range === 'all') {
      state.fromDate = '';
      state.toDate = '';
    } else {
      const today = new Date();
      const days = range === 'today' ? 1 : Number(range);
      const start = new Date(today.getTime() - (days - 1) * 86400000);
      state.fromDate = timestampToDateInput(Math.floor(start.getTime() / 1000));
      state.toDate = timestampToDateInput(Math.floor(today.getTime() / 1000));
    }
    fromInput.value = state.fromDate;
    toInput.value = state.toDate;
    markChosenRange(range);
    load();
  }

  function markChosenRange(range) {
    container.querySelectorAll('[data-range]').forEach((chip) => {
      const isChosen = chip.dataset.range === range;
      chip.classList.toggle('is-chosen', isChosen);
      chip.setAttribute('aria-pressed', isChosen ? 'true' : 'false');
    });
  }

  container.querySelectorAll('[data-range]').forEach((chip) => {
    chip.addEventListener('click', () => applyRange(chip.dataset.range));
  });

  [fromInput, toInput].forEach((input) => {
    input.addEventListener('change', () => {
      if (fromInput.value && toInput.value && toInput.value < fromInput.value) {
        toast('Check the date range', 'The "to" date is before the "from" date.', 'warn');
        return;
      }
      state.fromDate = fromInput.value;
      state.toDate = toInput.value;
      markChosenRange(''); // a hand-picked range matches none of the presets
      load();
    });
  });

  // The default window is the last 14 days, so that preset starts out marked.
  markChosenRange('14');
  await load();
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

/** A simple vertical bar chart of revenue per day. */
function barChart(days) {
  const total = days.reduce((sum, day) => sum + Number(day.revenuePaise || 0), 0);

  // Days with no money in them are not a chart. Drawing one anyway gives a
  // scale with nothing on it - the axis ends up reading "0.01" twice, because
  // the top of the range falls back to a single paise - and a row of bars at
  // the minimum height, which looks like data where there is none.
  if (!days.length || total === 0) {
    return emptyState({
      title: 'No revenue in this period',
      text: days.length
        ? 'Sessions were checked out, but none of them came to a charge.'
        : 'Revenue appears here once vehicles are checked out.',
      iconId: '#i-rupee',
    });
  }

  const width = 520;
  const height = 220;
  const padLeft = 46;
  const padBottom = 30;
  const padTop = 10;

  const maxValue = Math.max(...days.map((day) => day.revenuePaise), 1);
  const plotWidth = width - padLeft - 10;
  const plotHeight = height - padBottom - padTop;
  const step = plotWidth / days.length;
  const barWidth = Math.max(6, Math.min(30, step * 0.6));

  // Only label every nth day when there are many, so the axis stays legible.
  const labelEvery = Math.ceil(days.length / 8);

  const bars = days.map((day, index) => {
    const barHeight = Math.max(2, (day.revenuePaise / maxValue) * plotHeight);
    const x = padLeft + index * step + (step - barWidth) / 2;
    const y = padTop + plotHeight - barHeight;
    const label = day.date.slice(5).replace('-', '/'); // 2026-10-09 -> 10/09

    return `
      <rect class="bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}"
            width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" rx="3">
        <title>${escapeHtml(day.date)}: ${escapeHtml(money(day.revenuePaise))} from ${day.completedSessions} checkout(s)</title>
      </rect>
      ${index % labelEvery === 0
        ? `<text x="${(padLeft + index * step + step / 2).toFixed(1)}" y="${height - 10}"
                 text-anchor="middle">${escapeHtml(label)}</text>`
        : ''}`;
  }).join('');

  // Three horizontal guides: zero, half and the maximum.
  const guides = [0, 0.5, 1].map((fraction) => {
    const y = padTop + plotHeight - fraction * plotHeight;
    return `
      <line class="axis-line" x1="${padLeft}" y1="${y.toFixed(1)}" x2="${width - 10}" y2="${y.toFixed(1)}"/>
      <text x="${padLeft - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end">
        ${escapeHtml(moneyShort(Math.round(maxValue * fraction)))}
      </text>`;
  }).join('');

  return `
    <svg class="chart" viewBox="0 0 ${width} ${height}" role="img"
         aria-label="Revenue by day bar chart">
      ${guides}${bars}
    </svg>`;
}

/** A donut showing how the vehicle types split. */
function donutChart(distribution) {
  const total = distribution.reduce((sum, row) => sum + row.count, 0);
  if (total === 0) {
    return emptyState({
      title: 'No vehicles yet',
      text: 'The split by vehicle type appears once vehicles are checked in.',
      iconId: '#i-car',
    });
  }

  const size = 170;
  const centre = size / 2;
  const radius = 62;
  const thickness = 26;
  const circumference = 2 * Math.PI * radius;

  // A hairline of the card colour between neighbouring arcs. Two segments of
  // similar lightness touching directly read as one band, and the gap is what
  // separates them without relying on the colours alone. A single segment gets
  // no gap, because there is nothing to separate it from.
  const gap = distribution.length > 1 ? 2 : 0;

  let offset = 0;
  const arcs = distribution.map((row) => {
    const fraction = row.count / total;
    const dash = Math.max(1, fraction * circumference - gap);
    const segment = `
      <circle cx="${centre}" cy="${centre}" r="${radius}"
              fill="none" stroke="${TYPE_COLOURS[row.vehicleType] || 'var(--text-faint)'}"
              stroke-width="${thickness}"
              stroke-dasharray="${dash.toFixed(2)} ${(circumference - dash).toFixed(2)}"
              stroke-dashoffset="${(-offset).toFixed(2)}"
              transform="rotate(-90 ${centre} ${centre})">
        <title>${escapeHtml(vehicleTypeLabel(row.vehicleType))}: ${row.count} of ${total}</title>
      </circle>`;
    offset += fraction * circumference;
    return segment;
  }).join('');

  // The legend carries the name and the numbers, so the chart never depends on
  // somebody being able to tell the three colours apart.
  const legend = distribution.map((row) => {
    const percent = Math.round((row.count / total) * 100);
    return `
      <div>
        <span class="swatch" style="background:${TYPE_COLOURS[row.vehicleType] || 'var(--text-faint)'}"></span>
        <span>${escapeHtml(vehicleTypeLabel(row.vehicleType))}</span>
        <span class="count">${row.count} &middot; ${percent}%</span>
      </div>`;
  }).join('');

  const spoken = distribution
    .map((row) => `${vehicleTypeLabel(row.vehicleType)} ${row.count}`)
    .join(', ');

  return `
    <div class="donut-wrap">
      <svg class="chart" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"
           style="flex:0 0 ${size}px" role="img"
           aria-label="Vehicle type distribution: ${escapeHtml(spoken)}">
        ${arcs}
        <text class="donut-centre" x="${centre}" y="${centre - 2}" text-anchor="middle"
              style="font-size:22px">${total}</text>
        <text x="${centre}" y="${centre + 15}" text-anchor="middle">vehicles</text>
      </svg>
      <div class="donut-legend">${legend}</div>
    </div>`;
}
