// Waiting Queue - vehicles that arrived with no suitable slot free.
//
// A waiting vehicle is admitted automatically by the backend as soon as a
// compatible slot becomes usable - at a checkout, when a booking is cancelled
// or expires, or when Settings adds capacity. So this screen mostly shows
// state rather than driving it. Adding and cancelling are the two things the
// operator does here.
//
// The screen is built once and then only its numbers and its tables are
// redrawn. The "Add to Queue" form is never rebuilt, because this page
// refreshes itself on a timer and replacing the form under the operator
// would throw away a plate they were halfway through typing.

import { api, ApiError } from '../api.js';
import {
  escapeHtml, dateTime, timeOnly, relativeTime, vehicleTypeLabel,
} from '../format.js';
import {
  icon, badge, emptyState, errorState, loadingState, dataTable,
  withBusyButton, toast, toastError, confirmDialog, showFieldError, clearFieldErrors, statCard,
  freshnessBar, startFreshness,
} from '../ui.js';

export async function render(container, ctx) {
  container.innerHTML = `
    <div class="page-head">
      <div class="page-head__text">
        <h1>Waiting Queue</h1>
        <p>Vehicles waiting for a suitable slot to free up</p>
      </div>
      <div class="page-head__actions">${freshnessBar('queueFreshness')}</div>
    </div>

    <div class="stack">
      <div class="grid grid--stats" id="queueStats">${loadingState(1)}</div>

      <div class="layout-split layout-split--aside-first">
        <section class="card">
          <div class="card__head"><div><h2>Add to Queue</h2></div></div>
          <div class="card__body">
            <form id="queueForm" novalidate>
              <div class="field" data-field="registrationNumber">
                <label class="field__label" for="qPlate">
                  Registration Number <span class="req" aria-hidden="true">*</span>
                </label>
                <input class="input input--plate" id="qPlate" name="registrationNumber"
                       placeholder="e.g. MH12AB1234" autocomplete="off" autocapitalize="characters">
              </div>
              <div class="field" data-field="vehicleType">
                <label class="field__label" for="qType">
                  Vehicle Type <span class="req" aria-hidden="true">*</span>
                </label>
                <select class="select" id="qType" name="vehicleType">
                  <option value="CAR">Car</option>
                  <option value="BIKE">Bike</option>
                  <option value="SUV">SUV</option>
                </select>
              </div>
              <div class="form-row">
                <div class="field" data-field="ownerName">
                  <label class="field__label" for="qOwner">Owner Name</label>
                  <input class="input" id="qOwner" name="ownerName" placeholder="Optional"
                         autocomplete="off" maxlength="60">
                </div>
                <div class="field" data-field="contactNumber">
                  <label class="field__label" for="qContact">Contact Number</label>
                  <input class="input" id="qContact" name="contactNumber" placeholder="Optional"
                         autocomplete="off" inputmode="tel" maxlength="20">
                </div>
              </div>
              <div class="form-actions">
                <button class="btn btn--primary" type="submit" id="addToQueue">
                  ${icon('#i-queue')}Add to Queue
                </button>
              </div>
              <p class="field__hint" style="margin-top:10px">
                A vehicle can only join the queue when no suitable slot is free.
              </p>
            </form>
          </div>
        </section>

        <div class="stack" id="queueTables">${loadingState(5)}</div>
      </div>
    </div>`;

  const stats = container.querySelector('#queueStats');
  const tables = container.querySelector('#queueTables');
  const form = container.querySelector('#queueForm');

  // The most recent reply, so a Cancel button can look up its own request.
  let latest = { requests: [] };
  const freshness = startFreshness(container, 'queueFreshness', () => load());

  async function load() {
    freshness.markLoading();
    try {
      const data = await api.queue();
      latest = data;
      drawStats(data);
      drawTables(data);
      freshness.markUpdated();
      ctx.refreshShell();
    } catch (problem) {
      tables.innerHTML = errorState(problem.message);
      tables.querySelector('[data-retry]')?.addEventListener('click', load);
    }
  }

  function drawStats(data) {
    stats.innerHTML = `
      ${statCard({
        label: 'Waiting now', value: String(data.waitingCount),
        hint: 'Admitted as soon as a usable slot appears', iconId: '#i-queue', tone: 'warn',
      })}
      ${statCard({
        label: 'Available slots', value: String(data.summary.availableSlots),
        hint: 'Free and not reserved', iconId: '#i-check', tone: 'ok', href: 'slots',
      })}
      ${statCard({
        label: 'Occupied slots', value: String(data.summary.occupiedSlots),
        hint: 'A checkout may admit a waiting vehicle', iconId: '#i-car', tone: 'danger',
      })}`;
  }

  function drawTables(data) {
    const waiting = data.requests.filter((request) => request.status === 'WAITING');
    const served = data.requests.filter((request) => request.status !== 'WAITING');

    tables.innerHTML = `
      <section class="card">
        <div class="card__head">
          <div><h2>Currently Waiting</h2><p>Served in arrival order, oldest compatible first</p></div>
        </div>
        <div class="card__body card__body--flush">${waitingTable(waiting, data)}</div>
      </section>

      ${served.length ? `
        <section class="card">
          <div class="card__head"><div><h2>Earlier Requests</h2></div></div>
          <div class="card__body card__body--flush">${servedTable(served)}</div>
        </section>` : ''}`;

    wireCancelButtons();
  }

  function waitingTable(waiting, data) {
    if (!waiting.length) {
      return emptyState({
        title: 'Nobody is waiting',
        text: 'Vehicles appear here only when the car park has no suitable slot free.',
        iconId: '#i-queue',
      });
    }

    const rows = waiting.map((request) => [
      `<td class="cell-strong mono">#${request.position}</td>`,
      `<td class="cell-strong">${escapeHtml(request.registrationNumber)}</td>`,
      `<td>${escapeHtml(vehicleTypeLabel(request.vehicleType))}</td>`,
      `<td class="cell-muted">${escapeHtml(timeOnly(request.arrivalTime))}
        <div style="font-size:11.5px">${escapeHtml(relativeTime(request.arrivalTime, data.serverTime))}</div></td>`,
      `<td>${badge('WAITING')}</td>`,
      `<td><button class="btn btn--ghost btn--sm"
            data-cancel="${escapeHtml(request.requestId)}">Cancel</button></td>`,
    ]);

    return dataTable(
      [
        { label: 'Position' }, { label: 'Vehicle No.' }, { label: 'Type' },
        { label: 'Arrival Time' }, { label: 'Status' }, { label: 'Actions' },
      ],
      rows,
    );
  }

  function servedTable(served) {
    const rows = served.map((request) => [
      `<td class="cell-strong">${escapeHtml(request.registrationNumber)}</td>`,
      `<td>${escapeHtml(vehicleTypeLabel(request.vehicleType))}</td>`,
      `<td class="cell-muted">${escapeHtml(dateTime(request.arrivalTime))}</td>`,
      `<td>${badge(request.status)}</td>`,
      `<td class="cell-muted">${request.assignedSlotId
          ? `Slot ${escapeHtml(request.assignedSlotId)}`
          : '—'}</td>`,
      `<td>${request.assignedTicketId
          ? `<button class="btn btn--subtle btn--sm"
               data-navigate="history?search=${encodeURIComponent(request.assignedTicketId)}">View ticket</button>`
          : '<span class="cell-muted">—</span>'}</td>`,
    ]);

    return dataTable(
      [
        { label: 'Vehicle No.' }, { label: 'Type' }, { label: 'Arrival Time' },
        { label: 'Status' }, { label: 'Assigned Slot' }, { label: '' },
      ],
      rows,
    );
  }

  // Re-wired after every table redraw, because those buttons are new nodes.
  function wireCancelButtons() {
    tables.querySelectorAll('[data-cancel]').forEach((button) => {
      button.addEventListener('click', async () => {
        const request = latest.requests.find((item) => item.requestId === button.dataset.cancel);
        if (!request) {
          await load(); // the list moved on under us
          return;
        }

        const confirmed = await confirmDialog({
          title: 'Remove from the queue?',
          bodyHtml: `<p><strong>${escapeHtml(request.registrationNumber)}</strong> will no longer be
                     considered when a slot frees up.</p>`,
          confirmLabel: 'Remove',
          cancelLabel: 'Keep waiting',
          tone: 'danger',
        });
        if (!confirmed) return;

        await withBusyButton(button, async () => {
          try {
            await api.cancelQueued(request.requestId);
            toast('Removed from the queue', `${request.registrationNumber} is no longer waiting.`, 'ok');
            await load();
          } catch (problem) {
            toastError(problem);
            await load();
          }
        });
      });
    });
  }

  // Wired once, because the form is never replaced.
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFieldErrors(form);

    const values = {
      registrationNumber: form.registrationNumber.value.trim(),
      vehicleType: form.vehicleType.value,
      ownerName: form.ownerName.value.trim(),
      contactNumber: form.contactNumber.value.trim(),
    };

    if (!values.registrationNumber) {
      showFieldError(form, 'registrationNumber', 'Enter the vehicle registration number.');
      form.registrationNumber.focus();
      return;
    }

    await withBusyButton(container.querySelector('#addToQueue'), async () => {
      try {
        const result = await api.addToQueue(values);
        toast('Added to the waiting queue',
              `${values.registrationNumber.toUpperCase()} is at position ${result.position}.`, 'ok');
        // Cleared only after a confirmed success, so a refusal never loses
        // what the operator typed.
        form.reset();
        form.registrationNumber.focus();
        await load();
      } catch (problem) {
        if (problem instanceof ApiError && problem.code === 'SLOT_AVAILABLE') {
          // Being told "there is room" is good news, not an error.
          const parkNow = await confirmDialog({
            title: 'A slot is already free',
            bodyHtml: `<p>${escapeHtml(problem.message)}</p>`,
            confirmLabel: 'Go to Vehicle Entry',
            cancelLabel: 'Stay here',
            tone: 'ok',
          });
          if (parkNow) ctx.navigate('entry');
          return;
        }
        if (problem instanceof ApiError &&
            (problem.code === 'DUPLICATE_QUEUE_REQUEST' ||
             problem.code === 'DUPLICATE_ACTIVE_REGISTRATION' ||
             problem.code === 'INVALID_REGISTRATION')) {
          showFieldError(form, 'registrationNumber', problem.message);
        }
        if (problem instanceof ApiError && problem.code === 'INVALID_OWNER_NAME') {
          showFieldError(form, 'ownerName', problem.message);
        }
        toastError(problem);
      }
    });
  });

  await load();

  const timer = setInterval(load, 45000);
  return () => {
    clearInterval(timer);
    freshness.stop();
  };
}

