// Vehicle Entry - register a vehicle and let the backend allocate a slot.
//
// The browser never picks the slot. It sends what the operator typed and
// shows whatever the server decides, including a refusal.
//
// Two things here are about speed at the barrier. The vehicle type is three
// tiles rather than a dropdown, one click or one arrow key away, and each
// tile says how many bays of that type are free, so "the bike bays are full"
// is visible before a plate is typed. And after a check-in the allocated bay
// is shown on its row of the map, the same picture as the dashboard.

import { api, ApiError } from '../api.js';
import { escapeHtml, vehicleTypeLabel } from '../format.js';
import {
  icon, withBusyButton, toast, toastError, emptyState, confirmDialog,
  showFieldError, clearFieldErrors,
} from '../ui.js';
import { ticketPanel, printTicket } from '../ticket.js';
import { rowPreviewHtml } from '../facility.js';

const TYPES = [
  { value: 'CAR', label: 'Car', art: 'assets/vehicles/car-dark.webp' },
  { value: 'BIKE', label: 'Bike', art: 'assets/vehicles/bike-dark.webp' },
  { value: 'SUV', label: 'SUV', art: 'assets/vehicles/suv-dark.webp' },
];

export async function render(container, ctx) {
  container.innerHTML = `
    <div class="page-head">
      <div class="page-head__text">
        <h1>Vehicle Entry</h1>
        <p>Register a new vehicle and allocate a parking slot</p>
      </div>
    </div>

    <div class="layout-split">
      <section class="card">
        <div class="card__head"><div><h2>Vehicle Details</h2></div></div>
        <div class="card__body">
          <form id="entryForm" novalidate>
            <div class="field" data-field="registrationNumber">
              <label class="field__label" for="registrationNumber">
                Registration Number <span class="req" aria-hidden="true">*</span>
              </label>
              <input class="input input--plate" id="registrationNumber" name="registrationNumber"
                     placeholder="e.g. MH12AB1234" autocomplete="off" autocapitalize="characters"
                     required aria-required="true">
              <span class="field__hint">Spaces and dashes are tidied up automatically.</span>
            </div>

            <fieldset class="field type-picker" data-field="vehicleType">
              <legend class="field__label">
                Vehicle Type <span class="req" aria-hidden="true">*</span>
              </legend>
              <div class="type-picker__options">
                ${TYPES.map((type, index) => `
                  <label class="type-option">
                    <input type="radio" name="vehicleType" value="${type.value}" ${index === 0 ? 'checked' : ''}>
                    <span class="type-option__box">
                      <img class="type-option__vehicle" src="${type.art}" alt="" aria-hidden="true"
                           draggable="false" decoding="async">
                      <span class="type-option__text">
                        <span class="type-option__name">${type.label}</span>
                        <span class="type-option__free" data-free="${type.value}">&nbsp;</span>
                      </span>
                    </span>
                  </label>`).join('')}
              </div>
            </fieldset>

            <div class="form-row">
              <div class="field" data-field="ownerName">
                <label class="field__label" for="ownerName">Owner Name</label>
                <input class="input" id="ownerName" name="ownerName"
                       placeholder="Enter owner name" autocomplete="off" maxlength="60">
              </div>
              <div class="field" data-field="contactNumber">
                <label class="field__label" for="contactNumber">Contact Number</label>
                <input class="input" id="contactNumber" name="contactNumber"
                       placeholder="Enter contact number" autocomplete="off" inputmode="tel"
                       maxlength="20">
              </div>
            </div>

            <div class="form-actions">
              <button class="btn btn--primary" type="submit" id="submitEntry">
                ${icon('#i-entry')}Process Entry
              </button>
              <button class="btn btn--ghost" type="reset" id="resetEntry">Clear</button>
            </div>
          </form>
        </div>
      </section>

      <section class="card" id="previewCard">
        <div class="card__head"><div><h2>Entry Preview</h2></div></div>
        <div class="card__body" id="previewBody">
          ${emptyState({
            title: 'No vehicle checked in yet',
            text: 'ParkWise picks the bay. Once it has, you will see it here on its row of the map.',
            iconId: '#i-car',
          })}
        </div>
      </section>
    </div>`;

  const form = container.querySelector('#entryForm');
  const previewBody = container.querySelector('#previewBody');
  const submitButton = container.querySelector('#submitEntry');

  container.querySelector('#resetEntry').addEventListener('click', () => {
    clearFieldErrors(form);
  });

  // How many bays of each type are free right now, from the server's own
  // view of every bay. It is a hint for the operator, not a decision: the
  // server still allocates, and still refuses if the picture has changed.
  async function refreshFreeCounts() {
    try {
      const data = await api.slots();
      TYPES.forEach((type) => {
        const free = data.slots.filter((slot) =>
          slot.supportedVehicleType === type.value && slot.displayState === 'AVAILABLE').length;
        const label = container.querySelector(`[data-free="${type.value}"]`);
        if (!label) return;
        label.textContent = free === 0 ? 'Full' : `${free} free`;
        label.classList.toggle('is-full', free === 0);
      });
      return data;
    } catch (problem) {
      return null; // the tiles still work without the counts
    }
  }
  refreshFreeCounts();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFieldErrors(form);

    const values = {
      registrationNumber: form.registrationNumber.value.trim(),
      vehicleType: form.vehicleType.value,
      ownerName: form.ownerName.value.trim(),
      contactNumber: form.contactNumber.value.trim(),
    };

    // A quick check in the browser for the obvious case. The backend checks
    // everything again, and its answer is the one that counts.
    if (!values.registrationNumber) {
      showFieldError(form, 'registrationNumber', 'Enter the vehicle registration number.');
      form.registrationNumber.focus();
      return;
    }

    await withBusyButton(submitButton, async () => {
      try {
        const result = await api.vehicleEntry(values);

        // Fresh bay data both updates the free counts and draws the row the
        // vehicle was sent to.
        const latest = await refreshFreeCounts();
        previewBody.innerHTML = `
          <p class="entry-allocated">
            Bay <strong>${escapeHtml(result.slotId)}</strong>
            &middot; ${escapeHtml(vehicleTypeLabel(result.ticket.vehicleType))}
            ${escapeHtml(result.registrationNumber)}
          </p>
          ${latest ? rowPreviewHtml(latest.slots, result.slotId) : ''}
          ${ticketPanel(result.ticket)}`;
        previewBody.querySelector('.lot-preview .is-selected')
          ?.scrollIntoView({ block: 'nearest', inline: 'center' });
        wirePrint(previewBody, result.ticket);

        toast('Vehicle checked in',
              `${result.registrationNumber} parked in slot ${result.slotId}.`, 'ok');

        // The form is cleared only after a confirmed success, so a failed
        // attempt never loses what the operator typed.
        form.reset();
        form.registrationNumber.focus();
        ctx.refreshShell();
      } catch (problem) {
        await handleEntryFailure(problem, values, form, previewBody, ctx);
      }
    });
  });

  form.registrationNumber.focus();
}

async function handleEntryFailure(problem, values, form, previewBody, ctx) {
  if (!(problem instanceof ApiError)) {
    toastError(problem);
    return;
  }

  switch (problem.code) {
    case 'INVALID_REGISTRATION':
      showFieldError(form, 'registrationNumber', problem.message);
      form.registrationNumber.focus();
      break;

    case 'INVALID_CONTACT':
      showFieldError(form, 'contactNumber', problem.message);
      form.contactNumber.focus();
      break;

    case 'INVALID_OWNER_NAME':
      showFieldError(form, 'ownerName', problem.message);
      form.ownerName.focus();
      break;

    case 'DUPLICATE_ACTIVE_REGISTRATION':
      showFieldError(form, 'registrationNumber', problem.message);
      toast('Already parked', problem.message, 'warn');
      break;

    case 'LOT_FULL': {
      // The one case where there is something useful to offer instead.
      const joinQueue = await confirmDialog({
        title: 'The car park is full',
        bodyHtml: `
          <p>${escapeHtml(problem.message)}</p>
          <dl class="summary-list">
            <div><dt>Registration</dt><dd>${escapeHtml(values.registrationNumber.toUpperCase())}</dd></div>
            <div><dt>Vehicle type</dt><dd>${escapeHtml(vehicleTypeLabel(values.vehicleType))}</dd></div>
          </dl>`,
        confirmLabel: 'Add to waiting queue',
        cancelLabel: 'Not now',
        tone: 'warn',
      });

      if (joinQueue) {
        try {
          const queued = await api.addToQueue(values);
          toast('Added to the waiting queue',
                `Position ${queued.position}. The next suitable slot will be assigned automatically.`,
                'ok');
          form.reset();
          ctx.refreshShell();
          ctx.navigate('queue');
        } catch (queueProblem) {
          toastError(queueProblem);
        }
      }
      break;
    }

    default:
      toastError(problem);
      break;
  }
}

function wirePrint(root, ticket) {
  root.querySelector('[data-print-ticket]')?.addEventListener('click', () => printTicket(ticket));
}

