// The parking ticket, shared by Vehicle Entry, Vehicle Exit and History.
//
// A ticket for a session that is still running shows the exit time and the
// fee as "Pending", and labels the amount as an estimate. Those are not
// final figures and the screen never presents them as if they were.

import { escapeHtml, money, duration, dateTime, vehicleTypeLabel } from './format.js';
import { badge, icon } from './ui.js';

/** The on-screen ticket card. */
export function ticketPanel(ticket, { showActions = true } = {}) {
  const isActive = ticket.status === 'ACTIVE';

  const rows = [
    ['Registration', ticket.registrationNumber],
    ['Vehicle type', vehicleTypeLabel(ticket.vehicleType)],
    ['Slot', ticket.slotId],
    ['Entry time', dateTime(ticket.entryTime)],
    ['Exit time', isActive ? 'Pending' : dateTime(ticket.exitTime)],
    ['Duration', isActive
      ? `${duration(ticket.elapsedMinutes)} so far`
      : duration(ticket.elapsedMinutes)],
    ['Hourly rate', `${money(ticket.hourlyRatePaise)} per started hour`],
    ['Billable hours', isActive ? 'Pending' : String(ticket.billableHours)],
  ];

  if (ticket.ownerName) rows.splice(2, 0, ['Owner', ticket.ownerName]);
  if (ticket.contactNumber) rows.splice(ticket.ownerName ? 3 : 2, 0, ['Contact', ticket.contactNumber]);

  const detail = rows
    .map(([label, value]) =>
      `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`)
    .join('');

  const total = isActive
    ? `<div class="ticket__total">
         <div class="ticket__total-label">Estimated so far</div>
         <div class="ticket__pending">${escapeHtml(money(ticket.estimatedFeePaise))} &middot; not final</div>
       </div>`
    : `<div class="ticket__total">
         <div class="ticket__total-label">Amount paid</div>
         <div class="ticket__total-value">${escapeHtml(money(ticket.finalFeePaise))}</div>
       </div>`;

  return `
    <div class="ticket" data-ticket-id="${escapeHtml(ticket.ticketId)}">
      <div class="ticket__head">
        <span class="ticket__brand">
          <svg class="brand-mark" aria-hidden="true"><use href="#pw-mark"/></svg>
          <span class="brand-name">Park<span class="brand-name__accent">Wise</span></span>
        </span>
        <span class="ticket__id">${escapeHtml(ticket.ticketId)}</span>
      </div>
      <div class="ticket__body">
        <dl class="detail-list">${detail}</dl>
      </div>
      <div class="ticket__foot">
        ${badge(ticket.status)}
        ${ticket.source ? badge(ticket.source) : ''}
        ${showActions
          ? `<button class="btn btn--ghost btn--sm" data-print-ticket="${escapeHtml(ticket.ticketId)}">
               ${icon('#i-print')}Print ticket
             </button>`
          : ''}
        ${total}
      </div>
    </div>`;
}

/**
 * Prints one ticket on a plain white page.
 *
 * The ticket is written into a hidden container that the print stylesheet
 * reveals while hiding the sidebar, top bar and page background, so the
 * printed sheet carries only the ticket.
 */
export function printTicket(ticket) {
  const host = document.getElementById('printHost');
  const isActive = ticket.status === 'ACTIVE';

  const rows = [
    ['Ticket ID', ticket.ticketId],
    ['Registration', ticket.registrationNumber],
    ['Vehicle type', vehicleTypeLabel(ticket.vehicleType)],
    ...(ticket.ownerName ? [['Owner', ticket.ownerName]] : []),
    ['Slot', ticket.slotId],
    ['Entry time', dateTime(ticket.entryTime)],
    ['Exit time', isActive ? 'Pending' : dateTime(ticket.exitTime)],
    ['Duration', isActive ? `${duration(ticket.elapsedMinutes)} so far` : duration(ticket.elapsedMinutes)],
    ['Hourly rate', money(ticket.hourlyRatePaise)],
    ['Billable hours', isActive ? 'Pending' : String(ticket.billableHours)],
    ['Status', isActive ? 'Active' : 'Completed'],
  ];

  const detail = rows
    .map(([label, value]) =>
      `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`)
    .join('');

  const amount = isActive
    ? `<dt>Amount due</dt><dd class="print-total">Pending</dd>`
    : `<dt>Amount paid</dt><dd class="print-total">${escapeHtml(money(ticket.finalFeePaise))}</dd>`;

  host.innerHTML = `
    <div class="print-ticket">
      <div class="print-brand">
        <svg class="print-mark" aria-hidden="true"><use href="#pw-mark"/></svg>
        <h1>ParkWise</h1>
      </div>
      <div class="print-sub">Park smarter today &middot; Parking Ticket</div>
      <div class="print-rule"></div>
      <dl>${detail}</dl>
      <div class="print-rule"></div>
      <dl>${amount}</dl>
      <p class="print-note">
        ${isActive
          ? 'This vehicle is still parked. The exit time and the final fee are decided at checkout.'
          : 'Fees are charged per started hour. Thank you for parking with ParkWise.'}
      </p>
    </div>`;

  const clear = () => {
    host.innerHTML = '';
    window.removeEventListener('afterprint', clear);
  };
  window.addEventListener('afterprint', clear);
  window.print();
}
