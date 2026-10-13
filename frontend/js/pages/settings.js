// Settings - rates, the reservation grace period and the slot layout.
//
// Rates are typed in rupees here but travel as paise, because the backend
// stores money as whole paise. A slot that is occupied or reserved is shown
// locked: the server would refuse to change it anyway, and saying so up
// front is kinder than a rejected save.

import { api } from '../api.js';
import { escapeHtml, dateTime } from '../format.js';
import {
  icon, errorState, loadingState, withBusyButton, toast, toastError,
  confirmDialog, fieldError,
} from '../ui.js';

export async function render(container, ctx) {
  container.innerHTML = `
    <div class="page-head">
      <div class="page-head__text">
        <h1>Settings</h1>
        <p>Manage parking configuration</p>
      </div>
    </div>
    <div id="settingsBody">${loadingState(6)}</div>`;

  const body = container.querySelector('#settingsBody');
  let loaded = null;

  async function load() {
    body.innerHTML = loadingState(6);
    try {
      loaded = await api.settings();
      draw(loaded);
    } catch (problem) {
      body.innerHTML = errorState(problem.message);
      body.querySelector('[data-retry]')?.addEventListener('click', load);
    }
  }

  function draw(data) {
    const s = data.settings;
    const rupees = (paise) => (Number(paise) / 100).toString();

    body.innerHTML = `
      <div class="layout-split">
        <div class="stack">
          <section class="card">
            <div class="card__head">
              <div><h2>Parking Configuration</h2><p>Rates apply to new sessions only</p></div>
            </div>
            <div class="card__body">
              <form id="settingsForm" novalidate>
                <div class="form-row">
                  <div class="field" data-field="bike">
                    <label class="field__label" for="rateBike">Hourly Rate — Bike (₹)</label>
                    <input class="input" id="rateBike" type="number" min="1" step="1"
                           value="${escapeHtml(rupees(s.bikeHourlyRatePaise))}">
                  </div>
                  <div class="field" data-field="car">
                    <label class="field__label" for="rateCar">Hourly Rate — Car (₹)</label>
                    <input class="input" id="rateCar" type="number" min="1" step="1"
                           value="${escapeHtml(rupees(s.carHourlyRatePaise))}">
                  </div>
                  <div class="field" data-field="suv">
                    <label class="field__label" for="rateSuv">Hourly Rate — SUV (₹)</label>
                    <input class="input" id="rateSuv" type="number" min="1" step="1"
                           value="${escapeHtml(rupees(s.suvHourlyRatePaise))}">
                  </div>
                </div>

                <div class="form-row">
                  <div class="field" data-field="grace">
                    <label class="field__label" for="graceMinutes">Reservation Grace Period (minutes)</label>
                    <input class="input" id="graceMinutes" type="number" min="0" max="1440" step="5"
                           value="${escapeHtml(String(s.reservationGraceMinutes))}">
                    <span class="field__hint">
                      How long after the booked start time a vehicle may still arrive.
                    </span>
                  </div>
                  <div class="field">
                    <label class="field__label" for="currency">Currency</label>
                    <input class="input" id="currency" value="INR (₹)" disabled>
                    <span class="field__hint">Only INR is supported in this version.</span>
                  </div>
                </div>

                <p class="field__hint" style="margin-bottom:14px">
                  Charging is per started hour: 61 minutes costs the same as 2 full hours.
                  Changing a rate never alters a bill that has already been issued, and a
                  vehicle that is already parked keeps the rate it entered on.
                </p>

                <div class="form-actions">
                  <button class="btn btn--primary" type="submit" id="saveSettings">
                    ${icon('#i-check')}Save Changes
                  </button>
                  <button class="btn btn--ghost" type="button" id="revertSettings">Revert</button>
                </div>
              </form>
            </div>
          </section>

          <section class="card">
            <div class="card__head">
              <div>
                <h2>Slots</h2>
                <p id="slotCountLabel">${data.slots.length} slots configured</p>
              </div>
              <div class="card__head-actions">
                <button class="btn btn--ghost btn--sm" id="addSlot">Add slot</button>
              </div>
            </div>
            <div class="card__body">
              <div class="slot-editor" id="slotEditor"></div>
              <p class="field__hint" style="margin-top:12px">
                A slot holding a vehicle or an upcoming reservation is locked. Check the
                vehicle out, or cancel the reservation, before changing it.
              </p>
            </div>
          </section>
        </div>

        <div class="stack">
          <section class="card">
            <div class="card__head"><div><h2>System Information</h2></div></div>
            <div class="card__body">
              <dl class="detail-list">
                <div><dt>Application</dt><dd>ParkWise v${escapeHtml(data.version)}</dd></div>
                <div><dt>Total records</dt><dd>${data.storage.totalRecords}</dd></div>
                <div><dt>Tickets</dt><dd>${data.storage.ticketCount}</dd></div>
                <div><dt>Reservations</dt><dd>${data.storage.reservationCount}</dd></div>
                <div><dt>Queue requests</dt><dd>${data.storage.queueCount}</dd></div>
                <div><dt>Data on disk</dt><dd>${formatBytes(data.storage.storedBytes)}</dd></div>
                <div><dt>Last backup</dt>
                  <dd>${data.storage.lastBackupTime
                        ? escapeHtml(dateTime(data.storage.lastBackupTime))
                        : 'Never'}</dd></div>
              </dl>

              <div class="form-actions" style="margin-top:16px">
                <button class="btn btn--ghost btn--block" id="backupNow">
                  ${icon('#i-download')}Back Up Now
                </button>
              </div>
              <p class="field__hint" style="margin-top:10px">
                A backup copies the current records into a dated folder inside the data
                directory on this computer.
              </p>
            </div>
          </section>

          <section class="card">
            <div class="card__head"><div><h2>Export</h2></div></div>
            <div class="card__body">
              <p style="color:var(--text-muted);margin-bottom:14px">
                Download every parking record as a spreadsheet-friendly CSV file.
              </p>
              <button class="btn btn--ghost btn--block" id="exportAll">
                ${icon('#i-download')}Export all history (CSV)
              </button>
            </div>
          </section>
        </div>
      </div>`;

    drawSlotEditor(data.slots);
    wire(data);
  }

  // The slot list is kept in this array and redrawn, rather than read back
  // out of the DOM, so an added row cannot be lost by a re-render.
  let slotRows = [];

  function drawSlotEditor(slots) {
    slotRows = slots.map((slot) => ({ ...slot }));
    renderSlotRows();
  }

  function renderSlotRows() {
    const editor = body.querySelector('#slotEditor');
    editor.innerHTML = slotRows.map((slot, index) => `
      <div class="slot-editor__row ${slot.locked ? 'is-locked' : ''}" data-index="${index}">
        <input class="input" value="${escapeHtml(slot.slotId)}" data-slot-id="${index}"
               ${slot.locked ? 'disabled' : ''} aria-label="Slot ID">
        <select class="select" data-slot-type="${index}" ${slot.locked ? 'disabled' : ''}
                aria-label="Vehicle type for this slot">
          <option value="CAR" ${slot.supportedVehicleType === 'CAR' ? 'selected' : ''}>Car</option>
          <option value="BIKE" ${slot.supportedVehicleType === 'BIKE' ? 'selected' : ''}>Bike</option>
          <option value="SUV" ${slot.supportedVehicleType === 'SUV' ? 'selected' : ''}>SUV</option>
        </select>
        ${slot.locked
          ? `<span class="slot-editor__lock">${icon('#i-alert')}${slot.occupied ? 'In use' : 'Reserved'}</span>`
          : `<button class="btn btn--subtle btn--sm" data-remove-slot="${index}"
                     aria-label="Remove slot ${escapeHtml(slot.slotId)}">${icon('#i-close')}</button>`}
      </div>`).join('');

    body.querySelector('#slotCountLabel').textContent =
      `${slotRows.length} slot${slotRows.length === 1 ? '' : 's'} configured`;

    editor.querySelectorAll('[data-slot-id]').forEach((input) => {
      input.addEventListener('input', () => {
        slotRows[Number(input.dataset.slotId)].slotId = input.value.toUpperCase();
      });
    });
    editor.querySelectorAll('[data-slot-type]').forEach((select) => {
      select.addEventListener('change', () => {
        slotRows[Number(select.dataset.slotType)].supportedVehicleType = select.value;
      });
    });
    editor.querySelectorAll('[data-remove-slot]').forEach((button) => {
      button.addEventListener('click', () => {
        slotRows.splice(Number(button.dataset.removeSlot), 1);
        renderSlotRows();
      });
    });
  }

  function wire(data) {
    const form = body.querySelector('#settingsForm');

    body.querySelector('#addSlot').addEventListener('click', () => {
      slotRows.push({ slotId: '', supportedVehicleType: 'CAR', occupied: false, locked: false });
      renderSlotRows();
      const inputs = body.querySelectorAll('[data-slot-id]');
      inputs[inputs.length - 1]?.focus();
    });

    body.querySelector('#revertSettings').addEventListener('click', load);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearFieldErrors(form);

      const bike = Number(body.querySelector('#rateBike').value);
      const car = Number(body.querySelector('#rateCar').value);
      const suv = Number(body.querySelector('#rateSuv').value);
      const grace = Number(body.querySelector('#graceMinutes').value);

      let bad = false;
      if (!(bike > 0)) { showFieldError(form, 'bike', 'Enter a rate above zero.'); bad = true; }
      if (!(car > 0))  { showFieldError(form, 'car', 'Enter a rate above zero.'); bad = true; }
      if (!(suv > 0))  { showFieldError(form, 'suv', 'Enter a rate above zero.'); bad = true; }
      if (!(grace >= 0 && grace <= 1440)) {
        showFieldError(form, 'grace', 'Use a value between 0 and 1440 minutes.');
        bad = true;
      }
      if (slotRows.some((slot) => !slot.slotId.trim())) {
        toast('A slot has no ID', 'Give every slot an ID, or remove the empty row.', 'warn');
        bad = true;
      }
      if (slotRows.length === 0) {
        toast('No slots left', 'The car park needs at least one slot.', 'warn');
        bad = true;
      }
      if (bad) return;

      const removedCount = data.slots.length - slotRows.length;
      if (removedCount > 0) {
        const confirmed = await confirmDialog({
          title: `Remove ${removedCount} slot${removedCount === 1 ? '' : 's'}?`,
          bodyHtml: `<p>Reducing capacity cannot remove a slot that holds a vehicle or an
                     upcoming reservation — the server will refuse those and nothing will be saved.</p>`,
          confirmLabel: 'Save changes',
          cancelLabel: 'Go back',
          tone: 'danger',
        });
        if (!confirmed) return;
      }

      await withBusyButton(body.querySelector('#saveSettings'), async () => {
        try {
          const result = await api.saveSettings({
            settings: {
              // Rupees back to paise: money is stored as whole paise.
              bikeHourlyRatePaise: Math.round(bike * 100),
              carHourlyRatePaise: Math.round(car * 100),
              suvHourlyRatePaise: Math.round(suv * 100),
              reservationGraceMinutes: grace,
              currency: 'INR',
            },
            slots: slotRows.map((slot) => ({
              slotId: slot.slotId.trim(),
              supportedVehicleType: slot.supportedVehicleType,
            })),
          });
          toast('Settings saved', 'New rates apply to vehicles entering from now on.', 'ok');

          // Added capacity may have admitted vehicles off the waiting list.
          ((result && result.admittedFromQueue) || []).forEach((entry) => {
            toast('Waiting vehicle admitted',
                  `${entry.registrationNumber} was given the new slot ${entry.slotId}.`,
                  'warn', 7000);
          });

          await load();
          ctx.refreshShell();
        } catch (problem) {
          toastError(problem);
          // Show the real saved state again so the screen never implies a
          // change that the server refused.
          await load();
        }
      });
    });

    body.querySelector('#backupNow').addEventListener('click', async (event) => {
      await withBusyButton(event.currentTarget, async () => {
        try {
          const result = await api.backupNow();
          toast('Backup created', `Saved as ${result.folderName} in the data folder.`, 'ok');
          await load();
        } catch (problem) {
          toastError(problem);
        }
      });
    });

    body.querySelector('#exportAll').addEventListener('click', () => {
      const link = document.createElement('a');
      link.href = api.historyCsvUrl({});
      link.download = 'parkwise-history.csv';
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast('Export started', 'Every parking record is included.', 'ok');
    });
  }

  await load();
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
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
