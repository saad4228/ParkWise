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
import { statCard, emptyState, errorState, loadingState, toast } from '../ui.js';

const TYPE_COLOURS = {
  CAR: 'var(--info)',
  BIKE: 'var(--primary)',
  SUV: 'var(--violet)',
};

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
        <label class="sr-only" for="repFrom">From date</label>
        <input class="input" id="repFrom" type="date" style="width:auto" value="${state.fromDate}">
        <span class="cell-muted" style="align-self:center">to</span>
        <label class="sr-only" for="repTo">To date</label>
        <input class="input" id="repTo" type="date" style="width:auto" value="${state.toDate}">
        <button class="btn btn--ghost" id="repAll">All time</button>
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
    state.fromDate = '';
    state.toDate = '';
    fromInput.value = '';
    toInput.value = '';
    load();
  }

  [fromInput, toInput].forEach((input) => {
    input.addEventListener('change', () => {
      if (fromInput.value && toInput.value && toInput.value < fromInput.value) {
        toast('Check the date range', 'The "to" date is before the "from" date.', 'warn');
        return;
      }
      state.fromDate = fromInput.value;
      state.toDate = toInput.value;
      load();
    });
  });

  container.querySelector('#repAll').addEventListener('click', showAllTime);

  await load();
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

/** A simple vertical bar chart of revenue per day. */
function barChart(days) {
  if (!days.length) {
    return emptyState({
      title: 'No revenue yet',
      text: 'Revenue appears here once vehicles are checked out.',
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

  let offset = 0;
  const arcs = distribution.map((row) => {
    const fraction = row.count / total;
    const dash = fraction * circumference;
    const segment = `
      <circle cx="${centre}" cy="${centre}" r="${radius}"
              fill="none" stroke="${TYPE_COLOURS[row.vehicleType] || 'var(--text-faint)'}"
              stroke-width="${thickness}"
              stroke-dasharray="${dash.toFixed(2)} ${(circumference - dash).toFixed(2)}"
              stroke-dashoffset="${(-offset).toFixed(2)}"
              transform="rotate(-90 ${centre} ${centre})">
        <title>${escapeHtml(vehicleTypeLabel(row.vehicleType))}: ${row.count} of ${total}</title>
      </circle>`;
    offset += dash;
    return segment;
  }).join('');

  const legend = distribution.map((row) => {
    const percent = Math.round((row.count / total) * 100);
    return `
      <div>
        <span class="swatch" style="background:${TYPE_COLOURS[row.vehicleType] || 'var(--text-faint)'}"></span>
        <span>${escapeHtml(vehicleTypeLabel(row.vehicleType))}</span>
        <span class="count">${percent}%</span>
      </div>`;
  }).join('');

  return `
    <div class="donut-wrap">
      <svg class="chart" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"
           style="flex:0 0 ${size}px" role="img" aria-label="Vehicle type distribution">
        ${arcs}
        <text class="donut-centre" x="${centre}" y="${centre - 2}" text-anchor="middle"
              style="font-size:22px">${total}</text>
        <text x="${centre}" y="${centre + 15}" text-anchor="middle">vehicles</text>
      </svg>
      <div class="donut-legend">${legend}</div>
    </div>`;
}
