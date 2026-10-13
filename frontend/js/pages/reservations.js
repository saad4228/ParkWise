// Advance Reservations - book a slot for a future period, check a booked
// vehicle in, or cancel a booking.
//
// Conflicts, slot choice and the grace period are all decided by the
// backend. This screen only collects the request and reports the answer.

import { api, ApiError } from '../api.js';
import {
  escapeHtml, dateTime, vehicleTypeLabel, datetimeLocalToTimestamp,
  timestampToDatetimeLocal,
} from '../format.js';
import {
  icon, badge, emptyState, errorState, loadingState, dataTable,
  withBusyButton, toast, toastError, confirmDialog, fieldError,
} from '../ui.js';

export async function render(container, ctx) {
  let statusFilter = ctx.params.status || '';

  container.innerHTML = `
    <div class="page-head">
      <div class="page-head__text">
        <h1>Advance Reservations</h1>
        <p>Reserve a compatible slot for a future period</p>
      </div>
    </div>

    <div class="layout-split layout-split--aside-first">
      <section class="card">
        <div class="card__head"><div><h2>New Reservation</h2></div></div>
        <div class="card__body">
          <form id="reservationForm" novalidate>
            <div class="field" data-field="registrationNumber">
              <label class="field__label" for="resPlate">
                Registration Number <span class="req" aria-hidden="true">*</span>
              </label>
              <input class="input input--plate" id="resPlate" name="registrationNumber"
                     placeholder="e.g. MH12AB1234" autocomplete="off" autocapitalize="characters">
            </div>

            <div class="field" data-field="vehicleType">
              <label class="field__label" for="resType">
                Vehicle Type <span class="req" aria-hidden="true">*</span>
              </label>
              <select class="select" id="resType" name="vehicleType">
                <option value="CAR">Car</option>
                <option value="BIKE">Bike</option>
                <option value="SUV">SUV</option>
              </select>
            </div>

            <div class="field" data-field="startTime">
              <label class="field__label" for="resStart">
                Start Date and Time <span class="req" aria-hidden="true">*</span>
              </label>
              <input class="input" id="resStart" name="startTime" type="datetime-local">
            </div>

            <div class="field" data-field="endTime">
              <label class="field__label" for="resEnd">
                End Date and Time <span class="req" aria-hidden="true">*</span>
              </label>
              <input class="input" id="resEnd" name="endTime" type="datetime-local">
            </div>

            <div class="field" data-field="preferredSlotId">
              <label class="field__label" for="resSlot">Preferred Slot</label>
              <select class="select" id="resSlot" name="preferredSlotId">
                <option value="">Let ParkWise choose</option>
              </select>
              <span class="field__hint">
                Only slots that are free right now and match the vehicle type can be booked.
              </span>
            </div>

            <div class="form-actions">
              <button class="btn btn--primary" type="submit" id="createReservation">
                ${icon('#i-calendar')}Create Reservation
              </button>
            </div>
          </form>
        </div>
      </section>

      <section class="card">
        <div class="card__head">
          <div><h2>Reservations</h2><p id="resCount"></p></div>
          <div class="card__head-actions">
            <select class="select" id="resStatusFilter" style="width:auto;min-width:160px"
                    aria-label="Filter reservations by status">
              <option value="">All statuses</option>
              <option value="UPCOMING">Upcoming</option>
              <option value="CHECKED_IN">Checked in</option>
              <option value="COMPLETED">Completed</option>
              <option value="CANCELLED">Cancelled</option>
              <option value="EXPIRED">Expired</option>
            </select>
          </div>
        </div>
        <div class="card__body card__body--flush" id="resList">${loadingState(5)}</div>
      </section>
    </div>`;

  const form = container.querySelector('#reservationForm');
  const list = container.querySelector('#resList');
  const countLabel = container.querySelector('#resCount');
  const statusSelect = container.querySelector('#resStatusFilter');
  statusSelect.value = statusFilter;

  // Sensible defaults: the next whole hour, for one hour.
  function primeTimes() {
    const now = Math.floor(Date.now() / 1000);
    const nextHour = (Math.floor(now / 3600) + 1) * 3600;
    form.startTime.value = timestampToDatetimeLocal(nextHour);
    form.endTime.value = timestampToDatetimeLocal(nextHour + 3600);
  }
  primeTimes();

  async function loadSlotChoices() {
    try {
      const data = await api.slots();
      const select = form.preferredSlotId;
      const chosenType = form.vehicleType.value;

      const options = data.slots
        .filter((slot) => slot.supportedVehicleType === chosenType && !slot.occupied)
        .map((slot) => `<option value="${escapeHtml(slot.slotId)}">
            ${escapeHtml(slot.slotId)}${slot.displayState === 'RESERVED' ? ' (has a booking)' : ''}
          </option>`)
        .join('');

      const keep = select.value;
      select.innerHTML = `<option value="">Let ParkWise choose</option>${options}`;
      if ([...select.options].some((option) => option.value === keep)) select.value = keep;
    } catch (problem) {
      // The dropdown is optional; the backend still picks a slot.
    }
  }

  async function loadList() {
    list.innerHTML = loadingState(5);
    try {
      const data = await api.reservations(statusFilter ? { status: statusFilter } : {});
      renderList(data);
    } catch (problem) {
      list.innerHTML = errorState(problem.message);
      list.querySelector('[data-retry]')?.addEventListener('click', loadList);
    }
  }

  function renderList(data) {
    countLabel.textContent = `${data.reservations.length} reservation${data.reservations.length === 1 ? '' : 's'}`;

    if (!data.reservations.length) {
      list.innerHTML = emptyState({
        title: statusFilter ? 'No reservations with that status' : 'No reservations yet',
        text: statusFilter
          ? 'Change the filter to see other reservations.'
          : 'Create one using the form on the left. The slot is held until the vehicle arrives.',
        iconId: '#i-calendar',
      });
      return;
    }

    const rows = data.reservations.map((reservation) => {
      const actions = [];
      if (reservation.canCheckIn) {
        actions.push(`<button class="btn btn--primary btn--sm"
          data-checkin="${escapeHtml(reservation.reservationId)}">Check in</button>`);
      }
      if (reservation.canCancel) {
        actions.push(`<button class="btn btn--ghost btn--sm"
          data-cancel="${escapeHtml(reservation.reservationId)}">Cancel</button>`);
      }
      if (reservation.status === 'UPCOMING' && !reservation.canCheckIn) {
        actions.push(`<span class="cell-muted" style="font-size:12px">Opens ${escapeHtml(dateTime(reservation.startTime))}</span>`);
      }

      return [
        `<td class="cell-strong">${escapeHtml(reservation.registrationNumber)}</td>`,
        `<td>${escapeHtml(vehicleTypeLabel(reservation.vehicleType))}</td>`,
        `<td class="cell-strong">${escapeHtml(reservation.slotId)}</td>`,
        `<td class="cell-muted">${escapeHtml(dateTime(reservation.startTime))}</td>`,
        `<td class="cell-muted">${escapeHtml(dateTime(reservation.endTime))}</td>`,
        `<td>${badge(reservation.status)}</td>`,
        `<td style="white-space:nowrap">${actions.join(' ') || '<span class="cell-muted">—</span>'}</td>`,
      ];
    });

    list.innerHTML = dataTable(
      [
        { label: 'Vehicle No.' }, { label: 'Type' }, { label: 'Slot' },
        { label: 'From' }, { label: 'Until' }, { label: 'Status' }, { label: 'Actions' },
      ],
      rows,
    );

    list.querySelectorAll('[data-cancel]').forEach((button) => {
      button.addEventListener('click', () => cancelReservation(button, button.dataset.cancel, data));
    });
    list.querySelectorAll('[data-checkin]').forEach((button) => {
      button.addEventListener('click', () => checkIn(button, button.dataset.checkin, data));
    });
  }

  async function cancelReservation(button, id, data) {
    const reservation = data.reservations.find((item) => item.reservationId === id);
    const confirmed = await confirmDialog({
      title: 'Cancel this reservation?',
      bodyHtml: `
        <p>Slot <strong>${escapeHtml(reservation.slotId)}</strong> will be released immediately.
           If a vehicle is waiting in the queue for a slot of that type, it is admitted
           straight away; otherwise the slot becomes available for a walk-in.</p>
        <dl class="summary-list">
          <div><dt>Registration</dt><dd>${escapeHtml(reservation.registrationNumber)}</dd></div>
          <div><dt>Booked from</dt><dd>${escapeHtml(dateTime(reservation.startTime))}</dd></div>
        </dl>`,
      confirmLabel: 'Cancel reservation',
      cancelLabel: 'Keep it',
      tone: 'danger',
    });
    if (!confirmed) return;

    await withBusyButton(button, async () => {
      try {
        const result = await api.cancelReservation(id);
        toast('Reservation cancelled', `Slot ${reservation.slotId} is no longer held.`, 'ok');
        announceAdmitted(result);
        await Promise.all([loadList(), loadSlotChoices()]);
        ctx.refreshShell();
      } catch (problem) {
        toastError(problem);
        loadList();
      }
    });
  }

  async function checkIn(button, id, data) {
    const reservation = data.reservations.find((item) => item.reservationId === id);
    await withBusyButton(button, async () => {
      try {
        const result = await api.checkInReservation(id, reservation.registrationNumber);
        toast('Reserved vehicle checked in',
              `${reservation.registrationNumber} is parked in slot ${result.slotId}.`, 'ok');
        await Promise.all([loadList(), loadSlotChoices()]);
        ctx.refreshShell();
      } catch (problem) {
        toastError(problem);
        loadList();
      }
    });
  }

  form.vehicleType.addEventListener('change', loadSlotChoices);

  statusSelect.addEventListener('change', () => {
    statusFilter = statusSelect.value;
    loadList();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFieldErrors(form);

    const plate = form.registrationNumber.value.trim();
    const start = datetimeLocalToTimestamp(form.startTime.value);
    const end = datetimeLocalToTimestamp(form.endTime.value);

    let firstBad = null;
    if (!plate) {
      showFieldError(form, 'registrationNumber', 'Enter the vehicle registration number.');
      firstBad = firstBad || form.registrationNumber;
    }
    if (!start) {
      showFieldError(form, 'startTime', 'Choose when the reservation starts.');
      firstBad = firstBad || form.startTime;
    }
    if (!end) {
      showFieldError(form, 'endTime', 'Choose when the reservation ends.');
      firstBad = firstBad || form.endTime;
    }
    if (start && end && end <= start) {
      showFieldError(form, 'endTime', 'The end time must be after the start time.');
      firstBad = firstBad || form.endTime;
    }
    if (firstBad) {
      firstBad.focus();
      return;
    }

    await withBusyButton(container.querySelector('#createReservation'), async () => {
      try {
        const result = await api.createReservation({
          registrationNumber: plate,
          vehicleType: form.vehicleType.value,
          startTime: start,
          endTime: end,
          preferredSlotId: form.preferredSlotId.value || '',
        });

        toast('Reservation confirmed',
              `Slot ${result.slotId} is held for ${plate.toUpperCase()} from ${dateTime(result.startTime)}.`,
              'ok', 6000);

        form.registrationNumber.value = '';
        form.preferredSlotId.value = '';
        primeTimes();
        await Promise.all([loadList(), loadSlotChoices()]);
        ctx.refreshShell();
      } catch (problem) {
        if (problem instanceof ApiError) {
          if (problem.code === 'INVALID_REGISTRATION' || problem.code === 'DUPLICATE_RESERVATION') {
            showFieldError(form, 'registrationNumber', problem.message);
          } else if (problem.code === 'INVALID_INTERVAL') {
            showFieldError(form, 'endTime', problem.message);
          } else if (problem.code === 'RESERVATION_CONFLICT' ||
                     problem.code === 'SLOT_TYPE_MISMATCH' ||
                     problem.code === 'SLOT_OCCUPIED' ||
                     problem.code === 'SLOT_NOT_FOUND') {
            showFieldError(form, 'preferredSlotId', problem.message);
          }
        }
        toastError(problem);
      }
    });
  });

  await Promise.all([loadSlotChoices(), loadList()]);
}

// Releasing a held slot can let a waiting vehicle straight in, which changes
// what the operator sees in the grid. Saying so is better than letting them
// wonder why a just-freed slot is already occupied.
function announceAdmitted(result) {
  const admitted = (result && result.admittedFromQueue) || [];
  admitted.forEach((entry) => {
    toast('Waiting vehicle admitted',
          `${entry.registrationNumber} was given slot ${entry.slotId} from the queue.`,
          'warn', 7000);
  });
}

function showFieldError(form, name, message) {
  const field = form.querySelector(`[data-field="${name}"]`);
  if (!field) return;
  field.classList.add('has-error');
  field.querySelector('.field__error')?.remove();
  field.insertAdjacentHTML('beforeend', fieldError(message));
}

function clearFieldErrors(form) {
  form.querySelectorAll('.field.has-error').forEach((field) => {
    field.classList.remove('has-error');
    field.querySelector('.field__error')?.remove();
  });
}
