// Dashboard - the car park as it is right now.
//
// Three regions: a slim menu (part of the shell), the top-down map in the
// middle, and a rail of figures on the right. Every number and every mark on
// this screen comes from GET /api/dashboard. Nothing is counted here, so the
// map, the donut and the traffic chart cannot drift away from the records.

import { api } from '../api.js';
import {
  escapeHtml, money, moneyShort, duration, dateTime, timeOnly, relativeTime,
  hourRange, vehicleTypeLabel,
} from '../format.js';
import { badge, icon, errorState, loadingState, freshnessBar, startFreshness, countUp } from '../ui.js';
import { createFacility } from '../facility.js';

export async function render(container, ctx) {
  container.innerHTML = `
    <div class="console">
      <div class="page-head">
        <div class="page-head__text">
          <h1>${escapeHtml(greeting())}, Saad</h1>
          <p>Here is what is happening in your car park right now</p>
        </div>
        <div class="page-head__actions">
          ${freshnessBar('dashFreshness')}
          <button class="btn btn--ghost" data-navigate="exit">${icon('#i-exit')}Vehicle Exit</button>
          <button class="btn btn--primary" data-navigate="entry">${icon('#i-entry')}Vehicle Entry</button>
        </div>
      </div>

      <div class="ops">
        <section class="workspace" id="dashMap" aria-label="Car park map"></section>
        <aside class="rail" aria-label="Car park figures">
          <div id="railSelected"></div>
          <div id="railBody">${loadingState(8)}</div>
        </aside>
      </div>
    </div>`;

  const railSelected = container.querySelector('#railSelected');
  const railBody = container.querySelector('#railBody');
  const freshness = startFreshness(container, 'dashFreshness', () => load());

  let latest = null;
  let counted = false;

  const facility = createFacility(container.querySelector('#dashMap'), {
    persistKey: 'dashboard',
    onSelect: (slot) => {
      railSelected.innerHTML = selectedCardHtml(slot);
      railSelected.querySelector('[data-close-bay]')?.addEventListener('click', () => facility.select(null));
    },
  });

  async function load() {
    freshness.markLoading();
    try {
      const data = await api.dashboard();
      latest = data;
      facility.update(data);
      railBody.innerHTML = railHtml(data);
      wireRail(railBody, data);
      if (!counted) {
        counted = true;
        countUp(railBody);
      }
      freshness.markUpdated();
      ctx.refreshShell();
    } catch (problem) {
      // Keep the last good picture if there was one, and say it is stale.
      if (!latest) {
        railBody.innerHTML = errorState(problem.message);
        railBody.querySelector('[data-retry]')?.addEventListener('click', load);
      }
      freshness.markUpdated();
    }
  }

  await load();

  // Elapsed times and fees keep moving, so the screen refreshes itself while
  // it is open. The map is redrawn in place, keeping zoom, scroll position,
  // filters and the selected bay.
  const timer = setInterval(load, 60000);
  return () => {
    clearInterval(timer);
    freshness.stop();
    facility.destroy();
  };
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

// ---------------------------------------------------------------------------
// The selected bay
// ---------------------------------------------------------------------------

function selectedCardHtml(slot) {
  if (!slot) return '';

  const state = slot.displayState;
  const rows = [['Takes', vehicleTypeLabel(slot.supportedVehicleType)]];
  if (slot.ticket) {
    rows.push(
      ['Vehicle', slot.ticket.registrationNumber],
      ...(slot.ticket.ownerName ? [['Owner', slot.ticket.ownerName]] : []),
      ['Entered', dateTime(slot.ticket.entryTime)],
      ['Parked for', duration(slot.ticket.elapsedMinutes)],
      ['Fee so far', `${money(slot.ticket.estimatedFeePaise)} (estimate)`],
    );
  }
  if (slot.reservation) {
    rows.push(
      ['Booked by', slot.reservation.registrationNumber],
      ['From', dateTime(slot.reservation.startTime)],
      ['Until', dateTime(slot.reservation.endTime)],
    );
  }

  const actions = [];
  if (slot.ticket) {
    actions.push(`<button class="btn btn--primary btn--sm"
      data-navigate="exit?query=${encodeURIComponent(slot.ticket.ticketId)}">${icon('#i-exit')}Process exit</button>`);
  } else if (state === 'AVAILABLE') {
    actions.push(`<button class="btn btn--primary btn--sm" data-navigate="entry">${icon('#i-entry')}Check in a vehicle</button>`);
  }
  if (slot.reservation) {
    actions.push(`<button class="btn btn--ghost btn--sm" data-navigate="reservations">${icon('#i-calendar')}Reservations</button>`);
  }
  actions.push(`<button class="btn btn--ghost btn--sm"
    data-navigate="slots?focus=${encodeURIComponent(slot.slotId)}">Open in Slots</button>`);

  return `
    <section class="rail-card bay-card bay-card--${state.toLowerCase()}" aria-label="Bay ${escapeHtml(slot.slotId)}">
      <div class="rail-card__head">
        <div class="bay-card__title">
          <strong>${escapeHtml(slot.slotId)}</strong>
          ${badge(state)}
        </div>
        <button class="icon-btn btn--sm" data-close-bay aria-label="Close bay details">${icon('#i-close')}</button>
      </div>
      <div class="rail-card__body">
        <dl class="detail-list">${rows.map(([label, value]) =>
          `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>
        <div class="form-actions" style="margin-top:12px">${actions.join('')}</div>
      </div>
    </section>`;
}

// ---------------------------------------------------------------------------
// The rail
// ---------------------------------------------------------------------------

function railHtml(data) {
  return `
    <div class="stack" style="gap:12px">
      ${summaryCard(data)}
      ${trafficCard(data)}
      ${activityCard(data)}
      ${shortcutsCard(data)}
    </div>`;
}

// The donut is a chart, so it uses the categorical ramp rather than the
// interface's single accent. Green reads as free, orange as taken, blue as
// spoken for, and the three were validated together for both themes.
const STATES = [
  { key: 'availableSlots', label: 'Available', colour: 'var(--cat-1)' },
  { key: 'occupiedSlots', label: 'Occupied', colour: 'var(--cat-2)' },
  { key: 'reservedSlots', label: 'Reserved', colour: 'var(--cat-3)' },
];

function summaryCard(data) {
  const s = data.summary;
  const total = s.totalSlots || 0;

  // A donut of the three bay states. Each arc is shortened by two pixels so a
  // thin line of card shows between neighbours, and the legend beside it
  // carries the counts - the chart never relies on the colours alone.
  const size = 112;
  const centre = size / 2;
  const radius = 46;
  const thickness = 14;
  const circumference = 2 * Math.PI * radius;
  const present = STATES.filter((state) => (s[state.key] || 0) > 0);
  const gap = present.length > 1 ? 2 : 0;

  let offset = 0;
  const arcs = total === 0 ? '' : STATES.map((state) => {
    const value = s[state.key] || 0;
    if (value === 0) return '';
    const length = (value / total) * circumference;
    const drawn = Math.max(0.5, length - gap);
    const arc = `<circle class="occupancy__arc" cx="${centre}" cy="${centre}" r="${radius}" fill="none"
      stroke="${state.colour}" stroke-width="${thickness}"
      stroke-dasharray="${drawn.toFixed(2)} ${(circumference - drawn).toFixed(2)}"
      stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 ${centre} ${centre})">
      <title>${state.label}: ${value} of ${total}</title></circle>`;
    offset += length;
    return arc;
  }).join('');

  const track = `<circle cx="${centre}" cy="${centre}" r="${radius}" fill="none"
    stroke="var(--surface-sunk)" stroke-width="${thickness}"/>`;

  const legend = STATES.map((state) => {
    const value = s[state.key] || 0;
    const pct = total ? Math.round((value / total) * 100) : 0;
    return `<div>
        <span class="swatch-dot" style="background:${state.colour}"></span>
        <span>${state.label}</span>
        <span class="count">${value}</span>
        <span class="pct">${pct}%</span>
      </div>`;
  }).join('');

  const spoken = STATES.map((state) => `${s[state.key] || 0} ${state.label.toLowerCase()}`).join(', ');

  return `
    <section class="rail-card" aria-labelledby="sumHead">
      <div class="rail-card__head">
        <h2 id="sumHead">Parking Summary</h2>
        <button class="link-btn" data-navigate="slots">Open map</button>
      </div>
      <div class="rail-card__body">
        <div class="occupancy">
          <svg viewBox="0 0 ${size} ${size}" role="img" aria-label="${total} bays: ${spoken}">
            ${track}${arcs}
            <text class="occupancy__total" x="${centre}" y="${centre + 2}" text-anchor="middle">${total}</text>
            <text class="occupancy__sub" x="${centre}" y="${centre + 17}" text-anchor="middle">total bays</text>
          </svg>
          <div class="occupancy__legend">${legend}</div>
        </div>
        <div class="rail-stats">
          <div>
            <div class="rail-stats__label">Collected today</div>
            <div class="rail-stats__value">${escapeHtml(moneyShort(s.todayRevenuePaise))}</div>
          </div>
          <div>
            <div class="rail-stats__label">Waiting for a bay</div>
            <div class="rail-stats__value">${s.waitingCount || 0}</div>
          </div>
        </div>
      </div>
    </section>`;
}

function trafficCard(data) {
  const hours = Array.isArray(data.hourlyTraffic) ? data.hourlyTraffic : [];
  const totalIn = hours.reduce((sum, hour) => sum + hour.entries, 0);
  const totalOut = hours.reduce((sum, hour) => sum + hour.exits, 0);
  const nowHour = new Date(Number(data.serverTime) * 1000).getHours();

  const width = 300;
  const height = 124;
  const axisY = 58;
  const reach = 46;             // tallest bar, either side of the axis
  const colWidth = width / 24;
  const barWidth = colWidth * 0.62;
  const peak = Math.max(1, ...hours.map((hour) => Math.max(hour.entries, hour.exits)));

  // Arrivals rise above the line and departures hang below it. Position says
  // which is which, so the two can share neutral greys and leave colour to
  // mean bay state everywhere on this screen.
  const columns = hours.map((hour) => {
    const x = hour.hour * colWidth;
    const barX = x + (colWidth - barWidth) / 2;
    const inHeight = hour.entries ? Math.max(2, (hour.entries / peak) * reach) : 0;
    const outHeight = hour.exits ? Math.max(2, (hour.exits / peak) * reach) : 0;
    return `
      <rect class="traffic__col" data-col="${hour.hour}" x="${x.toFixed(1)}" y="2" width="${colWidth.toFixed(1)}" height="${(axisY + reach + 4).toFixed(1)}"/>
      ${hour.hour === nowHour ? `<rect class="traffic__now" x="${x.toFixed(1)}" y="2" width="${colWidth.toFixed(1)}" height="${(axisY + reach + 4).toFixed(1)}" rx="2"/>` : ''}
      ${inHeight ? `<rect class="traffic__bar traffic__in" x="${barX.toFixed(1)}" y="${(axisY - inHeight).toFixed(1)}" width="${barWidth.toFixed(1)}" height="${inHeight.toFixed(1)}" rx="1.5"/>` : ''}
      ${outHeight ? `<rect class="traffic__bar traffic__out" x="${barX.toFixed(1)}" y="${(axisY + 1).toFixed(1)}" width="${barWidth.toFixed(1)}" height="${outHeight.toFixed(1)}" rx="1.5"/>` : ''}
      <rect data-hour="${hour.hour}" x="${x.toFixed(1)}" y="0" width="${colWidth.toFixed(1)}" height="${height}" fill="transparent"/>`;
  }).join('');

  const ticks = [0, 6, 12, 18].map((hour) => {
    const label = hour === 0 ? '12a' : hour === 12 ? '12p' : hour < 12 ? `${hour}a` : `${hour - 12}p`;
    return `<text x="${(hour * colWidth + colWidth / 2).toFixed(1)}" y="${height - 2}" text-anchor="middle">${label}</text>`;
  }).join('');

  const busiest = hours.reduce((best, hour) => (hour.entries > (best ? best.entries : 0) ? hour : best), null);
  const spoken = totalIn + totalOut === 0
    ? 'No arrivals or departures yet today'
    : `Today so far: ${totalIn} arrivals and ${totalOut} departures` +
      (busiest ? `, busiest for arrivals ${hourRange(busiest.hour)}` : '');

  const now = hours[nowHour] || { entries: 0, exits: 0 };

  return `
    <section class="rail-card traffic" aria-labelledby="trafficHead">
      <div class="rail-card__head">
        <h2 id="trafficHead">Hourly Traffic</h2>
        <span class="shortcut__hint">Today &middot; ${totalIn} in &middot; ${totalOut} out</span>
      </div>
      <div class="rail-card__body">
        <div class="traffic__legend">
          <span><span class="swatch-dot" style="background:var(--flow-in)"></span>Arrivals &uarr;</span>
          <span><span class="swatch-dot" style="background:var(--flow-out)"></span>Departures &darr;</span>
        </div>
        <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(spoken)}" data-traffic>
          ${columns}
          <line class="traffic__axis" x1="0" x2="${width}" y1="${axisY + 0.5}" y2="${axisY + 0.5}"/>
          ${ticks}
          ${totalIn + totalOut === 0
            ? `<text x="${width / 2}" y="${axisY - 12}" text-anchor="middle">No movements yet today</text>` : ''}
        </svg>
        <div class="traffic__readout" data-readout data-default="${escapeHtml(readout(nowHour, now, true))}">${readout(nowHour, now, true)}</div>
      </div>
    </section>`;
}

function readout(hour, row, isNow) {
  return `<strong>${escapeHtml(hourRange(hour))}</strong>${isNow ? ' (now)' : ''}: ` +
         `${row.entries} arrival${row.entries === 1 ? '' : 's'}, ` +
         `${row.exits} departure${row.exits === 1 ? '' : 's'}`;
}

function activityCard(data) {
  const items = Array.isArray(data.recentActivity) ? data.recentActivity : [];
  const body = items.length === 0
    ? `<p class="shortcut__hint" style="padding:6px 0">Entries and exits appear here as they happen.</p>`
    : `<div class="log">${items.map((item) => {
        const isEntry = item.kind === 'ENTRY';
        const via = isEntry && item.source === 'QUEUE' ? ' &middot; from queue'
                  : isEntry && item.source === 'RESERVATION' ? ' &middot; reserved' : '';
        return `
          <button type="button" class="log__row" data-navigate="history?search=${encodeURIComponent(item.ticketId)}">
            <span class="log__mark log__mark--${isEntry ? 'in' : 'out'}" aria-hidden="true">${icon(isEntry ? '#i-entry' : '#i-exit')}</span>
            <span class="log__main">
              <span class="log__plate">${escapeHtml(item.registrationNumber)}</span>
              <span class="log__sub">${isEntry ? 'Parked in' : 'Left'} ${escapeHtml(item.slotId)} &middot; ${escapeHtml(vehicleTypeLabel(item.vehicleType))}${via}</span>
            </span>
            <span class="log__side">
              ${item.feePaise !== null && item.feePaise !== undefined
                ? `<span class="log__fee">${escapeHtml(money(item.feePaise))}</span>` : ''}
              ${escapeHtml(relativeTime(item.time, data.serverTime))}
            </span>
          </button>`;
      }).join('')}</div>`;

  return `
    <section class="rail-card" aria-labelledby="logHead">
      <div class="rail-card__head">
        <h2 id="logHead">Recent Activity</h2>
        <button class="link-btn" data-navigate="history">View all</button>
      </div>
      <div class="rail-card__body" style="padding-top:6px">${body}</div>
    </section>`;
}

function shortcutsCard(data) {
  const upcoming = Array.isArray(data.upcomingReservations) ? data.upcomingReservations : [];
  const waiting = Array.isArray(data.queue) ? data.queue : [];
  const next = upcoming[0];

  // The server sends at most five upcoming bookings, so five means "five or
  // more" rather than an exact count.
  const upcomingCount = upcoming.length >= 5 ? '5+' : String(upcoming.length);

  const row = (route, iconId, label, hint, count) => `
    <button type="button" class="shortcut" data-navigate="${route}">
      ${icon(iconId)}
      <span class="shortcut__text">
        <span class="shortcut__label">${escapeHtml(label)}</span>
        <span class="shortcut__hint">${escapeHtml(hint)}</span>
      </span>
      ${count !== null ? `<span class="shortcut__count">${escapeHtml(count)}</span>` : '<span style="margin-left:auto"></span>'}
      ${icon('#i-chevrons', 'shortcut__chev')}
    </button>`;

  return `
    <section class="rail-card" aria-labelledby="goHead">
      <div class="rail-card__head"><h2 id="goHead">Shortcuts</h2></div>
      <div class="rail-card__body" style="padding-top:4px">
        <div class="shortcuts">
          ${row('reservations', '#i-calendar', 'Reservations',
                next ? `Next: ${next.registrationNumber} at ${timeOnly(next.startTime)}` : 'No upcoming bookings',
                upcomingCount)}
          ${row('queue', '#i-queue', 'Waiting Queue',
                waiting.length ? `${waiting[0].registrationNumber} is first in line` : 'Nobody waiting',
                String(waiting.length))}
          ${row('history', '#i-history', 'Parking History', 'Every session and its receipt', null)}
          ${row('reports', '#i-reports', 'Reports', 'Revenue and trends over time', null)}
        </div>
      </div>
    </section>`;
}

function wireRail(root, data) {
  // Hovering a column of the traffic chart reads out that hour; leaving it
  // goes back to the current hour.
  const chart = root.querySelector('[data-traffic]');
  const readoutBox = root.querySelector('[data-readout]');
  if (!chart || !readoutBox) return;

  const hours = data.hourlyTraffic || [];
  const nowHour = new Date(Number(data.serverTime) * 1000).getHours();

  chart.addEventListener('pointerover', (event) => {
    const hit = event.target.closest('[data-hour]');
    if (!hit) return;
    const hour = Number(hit.dataset.hour);
    chart.querySelectorAll('.traffic__col').forEach((col) => {
      col.classList.toggle('is-on', Number(col.dataset.col) === hour);
    });
    readoutBox.innerHTML = readout(hour, hours[hour] || { entries: 0, exits: 0 }, hour === nowHour);
  });
  chart.addEventListener('pointerleave', () => {
    chart.querySelectorAll('.traffic__col.is-on').forEach((col) => col.classList.remove('is-on'));
    readoutBox.innerHTML = readoutBox.dataset.default;
  });
}
