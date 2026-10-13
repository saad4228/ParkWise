// Vehicle Exit - find an active session and close it.
//
// The fee shown before confirming is an estimate calculated by the server
// for the current moment. The amount actually charged is calculated again
// by the server at the instant of checkout, and that is the figure stored.

import { api, ApiError } from '../api.js';
import { escapeHtml, money, duration, dateTime, vehicleTypeLabel } from '../format.js';
import {
  icon, emptyState, errorState, withBusyButton, toast, toastError,
  confirmDialog, feeSummaryHtml, badge,
} from '../ui.js';
import { ticketPanel, printTicket } from '../ticket.js';

export async function render(container, ctx) {
  container.innerHTML = `
    <div class="page-head">
      <div class="page-head__text">
        <h1>Vehicle Exit</h1>
        <p>Search a vehicle and process its checkout</p>
      </div>
    </div>

    <section class="card">
      <div class="card__head"><div><h2>Find Vehicle</h2></div></div>
      <div class="card__body">
        <form id="lookupForm" class="search-row" novalidate>
          <label class="sr-only" for="exitQuery">Ticket ID or registration number</label>
          <span class="search-box">
            ${icon('#i-search')}
            <input class="input input--plate" id="exitQuery" placeholder="Ticket ID or registration number"
                   autocomplete="off" autocapitalize="characters">
          </span>
          <button class="btn btn--primary" type="submit" id="searchButton">
            ${icon('#i-search')}Search
          </button>
        </form>
      </div>
    </section>

    <div id="exitResult" style="margin-top:16px"></div>`;

  const form = container.querySelector('#lookupForm');
  const input = container.querySelector('#exitQuery');
  const searchButton = container.querySelector('#searchButton');
  const result = container.querySelector('#exitResult');

  async function lookup(query) {
    await withBusyButton(searchButton, async () => {
      try {
        const data = await api.lookupTicket(query);
        showTicket(data.ticket);
      } catch (problem) {
        if (problem instanceof ApiError && problem.code === 'TICKET_NOT_FOUND') {
          result.innerHTML = `<section class="card"><div class="card__body">${emptyState({
            title: 'No match found',
            text: problem.message,
            iconId: '#i-search',
          })}</div></section>`;
        } else {
          result.innerHTML = `<section class="card"><div class="card__body">${errorState(problem.message)}</div></section>`;
          result.querySelector('[data-retry]')?.addEventListener('click', () => lookup(query));
        }
      }
    });
  }

  function showTicket(ticket) {
    const active = ticket.status === 'ACTIVE';

    result.innerHTML = `
      <section class="card">
        <div class="card__head">
          <div><h2>Vehicle Information</h2></div>
          <div class="card__head-actions">${badge(ticket.status)}</div>
        </div>
        <div class="card__body">
          <div class="info-grid">
            <div class="info-grid__cell">
              <div class="info-grid__label">Registration No.</div>
              <div class="info-grid__value">${escapeHtml(ticket.registrationNumber)}</div>
            </div>
            <div class="info-grid__cell">
              <div class="info-grid__label">Vehicle Type</div>
              <div class="info-grid__value">${escapeHtml(vehicleTypeLabel(ticket.vehicleType))}</div>
            </div>
            <div class="info-grid__cell">
              <div class="info-grid__label">Slot Number</div>
              <div class="info-grid__value">${escapeHtml(ticket.slotId)}</div>
            </div>
            <div class="info-grid__cell">
              <div class="info-grid__label">Entry Time</div>
              <div class="info-grid__value">${escapeHtml(dateTime(ticket.entryTime))}</div>
            </div>
            <div class="info-grid__cell">
              <div class="info-grid__label">Duration</div>
              <div class="info-grid__value">${escapeHtml(duration(ticket.elapsedMinutes))}</div>
            </div>
            <div class="info-grid__cell">
              <div class="info-grid__label">${active ? 'Estimated Fee' : 'Final Fee'}</div>
              <div class="info-grid__value">
                ${escapeHtml(money(active ? ticket.estimatedFeePaise : ticket.finalFeePaise))}
              </div>
            </div>
          </div>

          ${active ? '' : `
            <p style="margin-top:16px;color:var(--text-muted)">
              This session was already checked out on ${escapeHtml(dateTime(ticket.exitTime))}.
              It cannot be checked out again.
            </p>`}

          <div class="form-actions" style="margin-top:18px">
            ${active
              ? `<button class="btn btn--primary" id="processExit">${icon('#i-exit')}Process Exit</button>`
              : ''}
            <button class="btn btn--ghost" data-print-ticket="${escapeHtml(ticket.ticketId)}">
              ${icon('#i-print')}Print ticket
            </button>
            <button class="btn btn--subtle" id="cancelExit">Cancel</button>
          </div>
        </div>
      </section>`;

    result.querySelector('[data-print-ticket]')?.addEventListener('click', () => printTicket(ticket));
    result.querySelector('#cancelExit').addEventListener('click', () => {
      result.innerHTML = '';
      input.value = '';
      input.focus();
    });

    result.querySelector('#processExit')?.addEventListener('click', async (event) => {
      await withBusyButton(event.currentTarget, () => confirmAndCheckOut(ticket));
    });
  }

  async function confirmAndCheckOut(ticket) {
    const confirmed = await confirmDialog({
      title: 'Confirm checkout',
      bodyHtml: `
        <p>Closing the session for
          <strong>${escapeHtml(ticket.registrationNumber)}</strong>
          in slot <strong>${escapeHtml(ticket.slotId)}</strong>.</p>
        ${feeSummaryHtml(
          [
            ['Entry time', dateTime(ticket.entryTime)],
            ['Duration so far', duration(ticket.elapsedMinutes)],
            ['Hourly rate', `${money(ticket.hourlyRatePaise)} per started hour`],
          ],
          'Amount to collect',
          money(ticket.estimatedFeePaise),
        )}
        <p style="margin-top:12px;font-size:12px">
          The final amount is recalculated by the server at the moment of checkout,
          so it may rise by one hour if the vehicle crosses into a new hour.
        </p>`,
      confirmLabel: 'Process exit',
      cancelLabel: 'Go back',
      tone: 'warn',
    });

    if (!confirmed) return;

    try {
      const outcome = await api.vehicleExit(ticket.ticketId);
      showCompleted(outcome);

      toast('Checkout complete',
            `${ticket.registrationNumber} left slot ${outcome.slotId}. Collected ${money(outcome.finalFeePaise)}.`,
            'ok');

      if (outcome.queueAssignment) {
        const assignment = outcome.queueAssignment;
        toast('Waiting vehicle admitted',
              `${assignment.registrationNumber} was given slot ${assignment.slotId} from the queue.`,
              'warn', 7000);
      }
      ctx.refreshShell();
    } catch (problem) {
      toastError(problem);
      // Re-read the session so the screen shows the true current state
      // rather than a stale copy of it.
      try {
        const refreshed = await api.ticket(ticket.ticketId);
        showTicket(refreshed.ticket);
      } catch (ignored) { /* the original error is already on screen */ }
    }
  }

  function showCompleted(outcome) {
    const assignment = outcome.queueAssignment;

    result.innerHTML = `
      <section class="card">
        <div class="card__head">
          <div><h2>Checkout Complete</h2><p>The session is closed and saved.</p></div>
          <div class="card__head-actions">${badge('COMPLETED')}</div>
        </div>
        <div class="card__body">
          ${ticketPanel(outcome.ticket)}

          ${assignment ? `
            <div class="card" style="margin-top:16px;background:var(--warn-soft);border-color:var(--warn)">
              <div class="card__body" style="display:flex;gap:11px;align-items:flex-start">
                <span class="feed__mark feed__mark--out">${icon('#i-queue')}</span>
                <div>
                  <div class="feed__title">Slot ${escapeHtml(assignment.slotId)} went to the waiting queue</div>
                  <div class="feed__sub">
                    ${escapeHtml(assignment.registrationNumber)}
                    (${escapeHtml(vehicleTypeLabel(assignment.vehicleType))})
                    was admitted automatically and now has ticket
                    ${escapeHtml(assignment.ticketId)}.
                  </div>
                </div>
              </div>
            </div>` : ''}

          <div class="form-actions" style="margin-top:18px">
            <button class="btn btn--primary" id="nextVehicle">Check out another vehicle</button>
            <button class="btn btn--ghost" data-navigate="dashboard">Back to dashboard</button>
          </div>
        </div>
      </section>`;

    result.querySelector('[data-print-ticket]')
      ?.addEventListener('click', () => printTicket(outcome.ticket));

    result.querySelector('#nextVehicle').addEventListener('click', () => {
      result.innerHTML = '';
      input.value = '';
      input.focus();
    });
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const query = input.value.trim();
    if (!query) {
      toast('Enter something to search', 'Type a ticket ID or a registration number.', 'warn');
      input.focus();
      return;
    }
    lookup(query);
  });

  // Arriving from a slot or a history row pre-fills and runs the search.
  if (ctx.params.query) {
    input.value = ctx.params.query;
    await lookup(ctx.params.query);
  } else {
    input.focus();
  }
}
