// Parking Slots - the whole facility on the map, with a details panel that
// stays put beside it.
//
// It uses the same top-down view as the dashboard, so an operator learns one
// map. The difference is the panel: here it is always present, and it is
// where a bay's full story lives - who is in it, what they owe so far, what it
// is booked for, and the next thing that can be done with it.

import { api } from '../api.js';
import {
  escapeHtml, money, duration, dateTime, vehicleTypeLabel,
} from '../format.js';
import {
  icon, badge, emptyState, errorState, toast, freshnessBar, startFreshness,
} from '../ui.js';
import { createFacility, parseSlotId } from '../facility.js';

export async function render(container, ctx) {
  container.innerHTML = `
    <div class="console slots-console">
      <div class="page-head">
        <div class="page-head__text">
          <h1>Parking Slots</h1>
          <p>Every bay in the car park. Select one to see what is in it.</p>
        </div>
        <div class="page-head__actions">
          ${freshnessBar('slotsFreshness')}
          <button class="btn btn--ghost" data-navigate="settings">${icon('#i-settings')}Configure bays</button>
        </div>
      </div>

      <div class="ops">
        <section class="workspace" id="slotsMap" aria-label="Car park map"></section>
        <aside class="details-panel" aria-label="Bay details">
          <section class="rail-card" id="slotDetail" aria-live="polite">${placeholder()}</section>
        </aside>
      </div>
    </div>`;

  const detail = container.querySelector('#slotDetail');
  const freshness = startFreshness(container, 'slotsFreshness', () => load());
  const focusId = ctx.params.focus ? String(ctx.params.focus).toUpperCase() : null;
  let loadedOnce = false;

  const facility = createFacility(container.querySelector('#slotsMap'), {
    persistKey: 'slots',
    selectedId: focusId,
    onSelect: (slot) => {
      detail.innerHTML = slot ? detailHtml(slot) : placeholder();
      detail.querySelector('[data-clear-bay]')?.addEventListener('click', () => facility.select(null));
    },
  });

  async function load() {
    freshness.markLoading();
    try {
      const data = await api.slots();
      facility.update(data);
      freshness.markUpdated();

      if (!loadedOnce) {
        loadedOnce = true;
        if (focusId && !data.slots.some((slot) => slot.slotId === focusId)) {
          toast('Bay not found', `There is no bay called ${focusId}.`, 'warn');
        }
      }
    } catch (problem) {
      if (!loadedOnce) {
        detail.innerHTML = errorState(problem.message);
        detail.querySelector('[data-retry]')?.addEventListener('click', load);
      }
      freshness.markUpdated();
    }
  }

  await load();

  const timer = setInterval(load, 60000);
  return () => {
    clearInterval(timer);
    freshness.stop();
    facility.destroy();
  };
}

function placeholder() {
  return `<div class="rail-card__body">${emptyState({
    title: 'Select a bay',
    text: 'Click a bay on the map, or use the arrow keys, to see who is parked there and what it is booked for.',
    iconId: '#i-grid',
  })}</div>`;
}

function detailHtml(slot) {
  const state = slot.displayState;
  const { prefix } = parseSlotId(slot.slotId);

  const rows = [
    ['Row', prefix ? `Row ${prefix}` : 'Numbered bays'],
    ['Takes', vehicleTypeLabel(slot.supportedVehicleType)],
  ];

  if (slot.ticket) {
    rows.push(
      ['Vehicle', slot.ticket.registrationNumber],
      ...(slot.ticket.ownerName ? [['Owner', slot.ticket.ownerName]] : []),
      ['Ticket', slot.ticket.ticketId],
      ['Entered', dateTime(slot.ticket.entryTime)],
      ['Parked for', duration(slot.ticket.elapsedMinutes)],
      ['Rate', `${money(slot.ticket.hourlyRatePaise)} per started hour`],
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

  const list = rows
    .map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`)
    .join('');

  // The distinction the brief asks for, said in words as well as colour.
  let note = '';
  if (state === 'RESERVED') {
    note = 'Physically empty, but held for the booking above, so walk-in vehicles are not sent here.';
  } else if (state === 'OCCUPIED' && slot.reservation) {
    note = 'A vehicle is parked here and another booking is waiting for this bay.';
  } else if (state === 'AVAILABLE') {
    note = `Free now. The next ${vehicleTypeLabel(slot.supportedVehicleType).toLowerCase()} to check in may be sent here.`;
  }

  const actions = [];
  if (slot.ticket) {
    actions.push(`<button class="btn btn--primary btn--sm"
      data-navigate="exit?query=${encodeURIComponent(slot.ticket.ticketId)}">${icon('#i-exit')}Process exit</button>`);
    actions.push(`<button class="btn btn--ghost btn--sm"
      data-navigate="history?search=${encodeURIComponent(slot.ticket.ticketId)}">${icon('#i-history')}View ticket</button>`);
  }
  if (state === 'AVAILABLE') {
    actions.push(`<button class="btn btn--primary btn--sm" data-navigate="entry">${icon('#i-entry')}Check in a vehicle</button>`);
    actions.push(`<button class="btn btn--ghost btn--sm"
      data-navigate="reservations?slot=${encodeURIComponent(slot.slotId)}&type=${encodeURIComponent(slot.supportedVehicleType)}">${icon('#i-calendar')}Reserve this bay</button>`);
  }
  if (slot.reservation) {
    actions.push(`<button class="btn btn--ghost btn--sm" data-navigate="reservations">${icon('#i-calendar')}Open reservations</button>`);
  }

  return `
    <div class="bay-card bay-card--${state.toLowerCase()}" style="border-radius:inherit">
      <div class="rail-card__head">
        <div class="bay-card__title">
          <strong>${escapeHtml(slot.slotId)}</strong>
          ${badge(state)}
        </div>
        <button class="icon-btn btn--sm" data-clear-bay aria-label="Clear selection">${icon('#i-close')}</button>
      </div>
      <div class="rail-card__body">
        <dl class="detail-list">${list}</dl>
        ${note ? `<p class="shortcut__hint" style="margin-top:12px;font-size:12px">${escapeHtml(note)}</p>` : ''}
        ${actions.length ? `<div class="form-actions" style="margin-top:14px">${actions.join('')}</div>` : ''}
      </div>
    </div>`;
}
