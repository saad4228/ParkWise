// Dashboard - what is happening in the car park right now.
//
// Every number on this screen comes from GET /api/dashboard. Nothing is
// counted in the browser, so the cards cannot drift away from the records.

import { api } from '../api.js';
import {
  escapeHtml, money, moneyShort, relativeTime, dateTime, timeOnly,
  vehicleTypeLabel,
} from '../format.js';
import {
  statCard, emptyState, errorState, loadingState, icon, badge,
  slotButton, slotLegend,
} from '../ui.js';

export async function render(container, ctx) {
  container.innerHTML = `
    <div class="page-head">
      <div class="page-head__text">
        <h1>Dashboard</h1>
        <p>Real-time overview of your parking facility</p>
      </div>
      <div class="page-head__actions">
        <button class="btn btn--ghost" data-navigate="exit">${icon('#i-exit')}Vehicle Exit</button>
        <button class="btn btn--primary" data-navigate="entry">${icon('#i-entry')}Vehicle Entry</button>
      </div>
    </div>
    <div id="dashBody">${loadingState(6)}</div>`;

  const body = container.querySelector('#dashBody');

  async function load() {
    body.innerHTML = loadingState(6);
    try {
      const data = await api.dashboard();
      body.innerHTML = view(data);
      wire(body, data, ctx);
      ctx.refreshShell();
    } catch (problem) {
      body.innerHTML = errorState(problem.message);
      body.querySelector('[data-retry]')?.addEventListener('click', load);
    }
  }

  await load();

  // The elapsed-time column on an active session keeps moving, so the
  // dashboard refreshes itself gently while it is on screen.
  const timer = setInterval(load, 60000);
  return () => clearInterval(timer);
}

function view(data) {
  const s = data.summary;
  const occupancy = s.totalSlots > 0 ? Math.round((s.occupiedSlots / s.totalSlots) * 100) : 0;

  return `
    <div class="stack">
      <div class="grid grid--stats">
        ${statCard({
          label: 'Total Slots', value: String(s.totalSlots),
          hint: `${occupancy}% occupied`, iconId: '#i-grid', tone: 'info', href: 'slots',
        })}
        ${statCard({
          label: 'Occupied', value: String(s.occupiedSlots),
          hint: 'Vehicles parked now', iconId: '#i-car', tone: 'danger',
          href: 'history?status=ACTIVE',
        })}
        ${statCard({
          label: 'Available', value: String(s.availableSlots),
          hint: s.reservedSlots > 0 ? `${s.reservedSlots} held for reservations` : 'Ready to allocate',
          iconId: '#i-check', tone: 'ok', href: 'slots',
        })}
        ${statCard({
          label: "Today's Revenue", value: moneyShort(s.todayRevenuePaise),
          hint: 'Collected at checkout', iconId: '#i-rupee', tone: 'warn', href: 'reports',
        })}
      </div>

      <div class="layout-split">
        <div class="stack">
          <section class="card">
            <div class="card__head">
              <div>
                <h2>Parking Lot Overview</h2>
                <p>${s.totalSlots} slots &middot; click any slot for details</p>
              </div>
              <div class="card__head-actions">${slotLegend()}</div>
            </div>
            <div class="card__body">
              ${data.slots.length === 0
                ? emptyState({
                    title: 'No slots configured',
                    text: 'Add parking slots on the Settings screen to get started.',
                    iconId: '#i-grid',
                    actionHtml: '<button class="btn btn--primary btn--sm" data-navigate="settings">Open Settings</button>',
                  })
                : `<div class="slot-grid">${data.slots.map((slot) => slotButton(slot)).join('')}</div>`}
            </div>
          </section>

          <section class="card">
            <div class="card__head">
              <div><h2>Recent Activity</h2><p>Latest entries and exits</p></div>
              <div class="card__head-actions">
                <button class="btn btn--subtle btn--sm" data-navigate="history">View all</button>
              </div>
            </div>
            <div class="card__body">${activityFeed(data)}</div>
          </section>
        </div>

        <div class="stack">
          <section class="card">
            <div class="card__head">
              <div><h2>Upcoming Reservations</h2></div>
              <div class="card__head-actions">
                <button class="btn btn--subtle btn--sm" data-navigate="reservations">Manage</button>
              </div>
            </div>
            <div class="card__body">${reservationList(data)}</div>
          </section>

          <section class="card">
            <div class="card__head">
              <div><h2>Waiting Queue</h2></div>
              <div class="card__head-actions">
                <button class="btn btn--subtle btn--sm" data-navigate="queue">Manage</button>
              </div>
            </div>
            <div class="card__body">${queueList(data)}</div>
          </section>
        </div>
      </div>
    </div>`;
}

function activityFeed(data) {
  if (!data.recentActivity.length) {
    return emptyState({
      title: 'No activity yet',
      text: 'Once vehicles start entering and leaving, the latest movements appear here.',
      iconId: '#i-history',
    });
  }

  const rows = data.recentActivity.map((item) => {
    const isEntry = item.kind === 'ENTRY';
    return `
      <div class="feed__row">
        <span class="feed__mark feed__mark--${isEntry ? 'in' : 'out'}">
          ${icon(isEntry ? '#i-entry' : '#i-exit')}
        </span>
        <div class="feed__main">
          <div class="feed__title">${escapeHtml(item.registrationNumber)}</div>
          <div class="feed__sub">
            ${isEntry ? 'Entered' : 'Left'} slot ${escapeHtml(item.slotId)}
            &middot; ${escapeHtml(vehicleTypeLabel(item.vehicleType))}
            ${isEntry && item.source !== 'WALK_IN' ? `&middot; ${escapeHtml(item.source === 'QUEUE' ? 'from queue' : 'reserved')}` : ''}
          </div>
        </div>
        <div class="feed__side">
          ${item.feePaise !== null && item.feePaise !== undefined
            ? `<div class="feed__amount">${escapeHtml(money(item.feePaise))}</div>` : ''}
          <div>${escapeHtml(relativeTime(item.time, data.serverTime))}</div>
        </div>
      </div>`;
  });

  return `<div class="feed">${rows.join('')}</div>`;
}

function reservationList(data) {
  if (!data.upcomingReservations.length) {
    return emptyState({
      title: 'No upcoming reservations',
      text: 'Reserve a slot in advance from the Reservations screen.',
      iconId: '#i-calendar',
      actionHtml: '<button class="btn btn--ghost btn--sm" data-navigate="reservations">New reservation</button>',
    });
  }

  return `<div class="feed">${data.upcomingReservations.map((reservation) => `
    <div class="feed__row">
      <span class="feed__mark feed__mark--out">${icon('#i-calendar')}</span>
      <div class="feed__main">
        <div class="feed__title">${escapeHtml(reservation.registrationNumber)}</div>
        <div class="feed__sub">
          Slot ${escapeHtml(reservation.slotId)} &middot;
          ${escapeHtml(timeOnly(reservation.startTime))} – ${escapeHtml(timeOnly(reservation.endTime))}
        </div>
      </div>
      <div class="feed__side">
        ${reservation.canCheckIn
          ? badge('UPCOMING', 'Arriving now')
          : escapeHtml(dateTime(reservation.startTime).split(',')[0])}
      </div>
    </div>`).join('')}</div>`;
}

function queueList(data) {
  if (!data.queue.length) {
    return emptyState({
      title: 'Nobody waiting',
      text: 'Vehicles join the queue only when no suitable slot is free.',
      iconId: '#i-queue',
    });
  }

  return `<div class="feed">${data.queue.map((request) => `
    <div class="feed__row">
      <span class="feed__mark feed__mark--out">${icon('#i-queue')}</span>
      <div class="feed__main">
        <div class="feed__title">${escapeHtml(request.registrationNumber)}</div>
        <div class="feed__sub">
          ${escapeHtml(vehicleTypeLabel(request.vehicleType))} &middot;
          waiting since ${escapeHtml(timeOnly(request.arrivalTime))}
        </div>
      </div>
      <div class="feed__side">${badge('WAITING', `#${request.position}`)}</div>
    </div>`).join('')}</div>`;
}

function wire(body, data, ctx) {
  body.querySelectorAll('[data-slot]').forEach((button) => {
    button.addEventListener('click', () => {
      ctx.navigate(`slots?focus=${encodeURIComponent(button.dataset.slot)}`);
    });
  });
}
