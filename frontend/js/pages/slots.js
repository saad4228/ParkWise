// Parking Slots - the whole facility at a glance, with a detail panel.
//
// A slot carries two separate facts: whether a vehicle is standing in it,
// and whether a booking is holding it. The backend combines them into one
// display state, and this screen explains that distinction in words as
// well as colour.

import { api } from '../api.js';
import {
  escapeHtml, money, duration, dateTime, vehicleTypeLabel,
} from '../format.js';
import {
  icon, badge, emptyState, errorState, loadingState,
  slotButton, slotLegend, toast, freshnessBar, startFreshness, wireSlotGridKeys,
} from '../ui.js';

const STATE_TEXT = {
  AVAILABLE: 'Available',
  OCCUPIED: 'Occupied',
  RESERVED: 'Reserved',
};

export async function render(container, ctx) {
  let data = null;
  let selectedId = ctx.params.focus || null;
  let filterState = '';
  let filterType = '';
  let searchText = '';
  let filterTimer = null;

  container.innerHTML = `
    <div class="page-head">
      <div class="page-head__text">
        <h1>Parking Slots</h1>
        <p>View and manage all parking slots</p>
      </div>
      <div class="page-head__actions">
        ${freshnessBar('slotsFreshness')}
        <button class="btn btn--ghost" data-navigate="settings">${icon('#i-settings')}Configure slots</button>
      </div>
    </div>
    <div id="slotsBody">${loadingState(6)}</div>`;

  const body = container.querySelector('#slotsBody');
  const freshness = startFreshness(container, 'slotsFreshness', () => load());

  async function load() {
    freshness.markLoading();
    try {
      data = await api.slots();
      draw();
      freshness.markUpdated();
    } catch (problem) {
      body.innerHTML = errorState(problem.message);
      body.querySelector('[data-retry]')?.addEventListener('click', load);
    }
  }

  function visibleSlots() {
    const needle = searchText.trim().toUpperCase();
    return data.slots.filter((slot) => {
      if (filterState && slot.displayState !== filterState) return false;
      if (filterType && slot.supportedVehicleType !== filterType) return false;
      if (needle) {
        const inId = slot.slotId.toUpperCase().includes(needle);
        const inPlate = slot.ticket
          ? slot.ticket.registrationNumber.toUpperCase().includes(needle)
          : false;
        if (!inId && !inPlate) return false;
      }
      return true;
    });
  }

  // Which field the operator is in, and where their cursor sits. Replacing
  // the markup destroys both, and this screen redraws on a timer as well as
  // on every keystroke, so the position is carried across by hand.
  function captureFocus() {
    const active = document.activeElement;
    if (!active || !active.id || !body.contains(active)) {
      return null;
    }
    let caret = null;
    try {
      caret = active.selectionStart;
    } catch (unsupported) {
      caret = null; // some input types refuse to report a selection
    }
    return { id: active.id, caret };
  }

  function restoreFocus(saved) {
    if (!saved) return;
    const again = body.querySelector(`#${saved.id}`);
    if (!again) return;
    again.focus();
    if (saved.caret === null) return;
    try {
      again.setSelectionRange(saved.caret, saved.caret);
    } catch (unsupported) { /* nothing to restore on this input type */ }
  }

  function draw() {
    const shown = visibleSlots();
    const summary = data.summary;
    const focused = captureFocus();

    body.innerHTML = `
      <div class="layout-split">
        <section class="card">
          <div class="card__head">
            <div>
              <h2>All Slots</h2>
              <p>${summary.availableSlots} available &middot; ${summary.occupiedSlots} occupied
                 &middot; ${summary.reservedSlots} reserved</p>
            </div>
            <div class="card__head-actions">${slotLegend()}</div>
          </div>

          <div class="card__body" style="border-bottom:1px solid var(--border)">
            <div class="search-row">
              <span class="search-box">
                ${icon('#i-search')}
                <input class="input" id="slotSearch" placeholder="Search slot ID or vehicle"
                       value="${escapeHtml(searchText)}" autocomplete="off">
              </span>
              <select class="select" id="stateFilter" style="width:auto;min-width:150px"
                      aria-label="Filter by status">
                <option value="">All statuses</option>
                <option value="AVAILABLE">Available</option>
                <option value="OCCUPIED">Occupied</option>
                <option value="RESERVED">Reserved</option>
              </select>
              <select class="select" id="typeFilter" style="width:auto;min-width:150px"
                      aria-label="Filter by vehicle type">
                <option value="">All vehicle types</option>
                <option value="CAR">Car</option>
                <option value="BIKE">Bike</option>
                <option value="SUV">SUV</option>
              </select>
              ${filterState || filterType || searchText
                ? '<button class="btn btn--subtle btn--sm" id="clearFilters">Clear</button>' : ''}
            </div>
          </div>

          <div class="card__body">
            ${shown.length === 0
              ? emptyState({
                  title: data.slots.length === 0 ? 'No slots configured' : 'No slots match',
                  text: data.slots.length === 0
                    ? 'Add parking slots on the Settings screen.'
                    : 'Try a different search or clear the filters.',
                  iconId: '#i-grid',
                })
              : `<div class="slot-grid">${shown.map((slot) => slotButton(slot, selectedId)).join('')}</div>
                 <p style="margin-top:14px;font-size:12px;color:var(--text-muted)">
                   Showing ${shown.length} of ${data.slots.length} slots.
                 </p>`}
          </div>
        </section>

        <section class="card" id="detailCard">
          <div class="card__head"><div><h2>Slot Details</h2></div></div>
          <div class="card__body" id="detailBody">${detailView()}</div>
        </section>
      </div>`;

    body.querySelector('#stateFilter').value = filterState;
    body.querySelector('#typeFilter').value = filterType;
    wire();
    restoreFocus(focused);
  }

  function detailView() {
    if (!selectedId) {
      return emptyState({
        title: 'Select a slot',
        text: 'Click any slot in the grid to see what is parked there or what is booked for it.',
        iconId: '#i-grid',
      });
    }

    const slot = data.slots.find((candidate) => candidate.slotId === selectedId);
    if (!slot) {
      return emptyState({
        title: `Slot ${selectedId} not found`,
        text: 'It may have been removed on the Settings screen.',
        iconId: '#i-alert',
      });
    }

    const rows = [
      ['Slot ID', slot.slotId],
      ['Accepts', vehicleTypeLabel(slot.supportedVehicleType)],
      ['Status', STATE_TEXT[slot.displayState]],
    ];

    if (slot.ticket) {
      rows.push(
        ['Vehicle No.', slot.ticket.registrationNumber],
        ['Vehicle type', vehicleTypeLabel(slot.ticket.vehicleType)],
        ['Ticket ID', slot.ticket.ticketId],
        ['Entry time', dateTime(slot.ticket.entryTime)],
        ['Duration', duration(slot.ticket.elapsedMinutes)],
        ['Fee so far', `${money(slot.ticket.estimatedFeePaise)} (estimate)`],
      );
      if (slot.ticket.ownerName) rows.splice(4, 0, ['Owner', slot.ticket.ownerName]);
    }

    if (slot.reservation) {
      rows.push(
        ['Reservation ID', slot.reservation.reservationId],
        ['Reserved for', slot.reservation.registrationNumber],
        ['Booked from', dateTime(slot.reservation.startTime)],
        ['Booked until', dateTime(slot.reservation.endTime)],
      );
    }

    const detail = rows
      .map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`)
      .join('');

    // The distinction the brief asks for, said plainly rather than implied.
    let note = '';
    if (slot.displayState === 'RESERVED') {
      note = `<p style="margin-top:14px;font-size:12.5px;color:var(--text-muted)">
                This slot is physically empty but is being kept for an upcoming
                reservation, so walk-in vehicles are not sent here.
              </p>`;
    } else if (slot.displayState === 'OCCUPIED' && slot.reservation) {
      note = `<p style="margin-top:14px;font-size:12.5px;color:var(--text-muted)">
                A vehicle is parked here and another booking is waiting for this slot.
              </p>`;
    }

    const actions = [];
    if (slot.ticket) {
      actions.push(`<button class="btn btn--primary btn--sm"
        data-navigate="exit?query=${encodeURIComponent(slot.ticket.ticketId)}">
        ${icon('#i-exit')}Process exit</button>`);
    }
    if (slot.reservation) {
      actions.push(`<button class="btn btn--ghost btn--sm" data-navigate="reservations">
        ${icon('#i-calendar')}Open reservations</button>`);
    }

    return `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
        <span style="font-size:24px;font-weight:700">${escapeHtml(slot.slotId)}</span>
        ${badge(slot.displayState)}
      </div>
      <dl class="detail-list">${detail}</dl>
      ${note}
      ${actions.length ? `<div class="form-actions" style="margin-top:16px">${actions.join('')}</div>` : ''}`;
  }

  function wire() {
    body.querySelectorAll('[data-slot]').forEach((button) => {
      button.addEventListener('click', () => {
        selectedId = button.dataset.slot;
        draw();
        body.querySelector('#detailCard')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
    });

    // One tab stop for the grid; the arrow keys move within it.
    wireSlotGridKeys(body.querySelector('.slot-grid'), { onActivate: (slotId) => {
      selectedId = slotId;
      draw();
    } });

    const search = body.querySelector('#slotSearch');
    search?.addEventListener('input', () => {
      searchText = search.value;
      // Redrawing on every keystroke rebuilds every tile in the grid, which is
      // 500 of them in the largest supported layout. A short pause means one
      // redraw per burst of typing instead of one per character; draw() then
      // carries the cursor across the redraw itself.
      clearTimeout(filterTimer);
      filterTimer = setTimeout(draw, 120);
    });

    body.querySelector('#stateFilter')?.addEventListener('change', (event) => {
      filterState = event.target.value;
      draw();
    });
    body.querySelector('#typeFilter')?.addEventListener('change', (event) => {
      filterType = event.target.value;
      draw();
    });
    body.querySelector('#clearFilters')?.addEventListener('click', () => {
      filterState = '';
      filterType = '';
      searchText = '';
      draw();
    });
  }

  await load();

  if (selectedId && data && !data.slots.some((slot) => slot.slotId === selectedId)) {
    toast('Slot not found', `There is no slot called ${selectedId}.`, 'warn');
  }

  const timer = setInterval(load, 60000);
  return () => {
    clearInterval(timer);
    clearTimeout(filterTimer);
    freshness.stop();
  };
}
