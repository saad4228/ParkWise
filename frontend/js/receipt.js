// The receipt printer shown after a vehicle is checked out.
//
// This is presentation only. It is handed a ticket that the server has
// already closed and saved, and it never starts, completes or alters a
// transaction - if the animation fails or is skipped, the checkout has still
// happened and the receipt is still reachable.
//
// The illusion: .paper-track is a clipping box whose top edge sits exactly on
// the printer's slot. The paper inside it starts translated fully above that
// edge, so it is clipped out of sight "inside" the printer, and slides down
// to its resting place. Because the track keeps the paper's full height all
// along, nothing below it moves while the paper feeds.

import { escapeHtml, money, duration, dateTime, vehicleTypeLabel } from './format.js';
import { icon } from './ui.js';
import { printTicket } from './ticket.js';

// Only one printer at a time. Without this, a double-click on Check out, or a
// second click on View receipt, would stack two overlays on top of each other.
let openPrinter = null;

const reducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------------------------------------------------------------------
// Code 39 barcode
// ---------------------------------------------------------------------------

// Each character is nine elements - five bars and four spaces, alternating,
// three of them wide. This is the real encoding, so the barcode on the paper
// scans to the ticket ID rather than being a drawing of stripes.
const CODE39 = {
  '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn',
  '4': 'nnnwwnnnw', '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw',
  '8': 'wnnwnnwnn', '9': 'nnwwnnwnn', 'A': 'wnnnnwnnw', 'B': 'nnwnnwnnw',
  'C': 'wnwnnwnnn', 'D': 'nnnnwwnnw', 'E': 'wnnnwwnnn', 'F': 'nnwnwwnnn',
  'G': 'nnnnnwwnw', 'H': 'wnnnnwwnn', 'I': 'nnwnnwwnn', 'J': 'nnnnwwwnn',
  'K': 'wnnnnnnww', 'L': 'nnwnnnnww', 'M': 'wnwnnnnwn', 'N': 'nnnnwnnww',
  'O': 'wnnnwnnwn', 'P': 'nnwnwnnwn', 'Q': 'nnnnnnwww', 'R': 'wnnnnnwwn',
  'S': 'nnwnnnwwn', 'T': 'nnnnwnwwn', 'U': 'wwnnnnnnw', 'V': 'nwwnnnnnw',
  'W': 'wwwnnnnnn', 'X': 'nwnnwnnnw', 'Y': 'wwnnwnnnn', 'Z': 'nwwnwnnnn',
  '-': 'nwnnnnwnw', '.': 'wwnnnnwnn', ' ': 'nwwnnnwnn', '$': 'nwnwnwnnn',
  '/': 'nwnwnnnwn', '+': 'nwnnnwnwn', '%': 'nnnwnwnwn', '*': 'nwnnwnwnn',
};

const NARROW = 1;
const WIDE = 2;
const BAR_HEIGHT = 34;

/**
 * A scannable Code 39 barcode of `text`, as an inline SVG.
 *
 * Returns an empty string when the text holds a character Code 39 cannot
 * encode, because a barcode that scans to the wrong thing is worse than none.
 */
function barcodeSvg(text) {
  const payload = String(text).toUpperCase();
  if (!payload || [...payload].some((character) => !(character in CODE39))) {
    return '';
  }

  const bars = [];
  let x = 0;
  for (const character of `*${payload}*`) {
    const pattern = CODE39[character];
    for (let index = 0; index < pattern.length; index++) {
      const width = pattern[index] === 'w' ? WIDE : NARROW;
      if (index % 2 === 0) {
        bars.push(`<rect x="${x}" y="0" width="${width}" height="${BAR_HEIGHT}"/>`);
      }
      x += width;
    }
    x += NARROW; // the gap between characters
  }

  return `<svg class="paper__barcode" viewBox="0 0 ${x} ${BAR_HEIGHT}"
               preserveAspectRatio="none" role="img"
               aria-label="Barcode of ticket ${escapeHtml(payload)}">
            ${bars.join('')}
          </svg>`;
}

/** The torn bottom edge, as a zigzag path across a 100-unit wide viewBox. */
function tearSvg() {
  const teeth = 28;
  const step = 100 / teeth;
  let path = 'M0 0';
  for (let tooth = 0; tooth < teeth; tooth++) {
    path += ` L${((tooth + 0.5) * step).toFixed(2)} 5 L${((tooth + 1) * step).toFixed(2)} 0`;
  }
  return `<svg class="paper__tear" viewBox="0 0 100 5" preserveAspectRatio="none"
               aria-hidden="true"><path d="${path} L100 0 Z"/></svg>`;
}

// ---------------------------------------------------------------------------
// The paper
// ---------------------------------------------------------------------------

function row(label, value) {
  return `<div class="paper__row">
            <span>${escapeHtml(label)}</span>
            <span>${escapeHtml(value)}</span>
          </div>`;
}

/**
 * The printed side of the receipt.
 *
 * Every figure comes from the ticket the server returned. A session that is
 * still running says so and shows no total, because its exit time and fee do
 * not exist yet.
 */
function paperHtml(ticket, stamped) {
  const isFinal = ticket.status === 'COMPLETED';

  const vehicle = [
    row('Registration', ticket.registrationNumber),
    row('Vehicle type', vehicleTypeLabel(ticket.vehicleType)),
    ticket.ownerName ? row('Owner', ticket.ownerName) : '',
    ticket.contactNumber ? row('Contact', ticket.contactNumber) : '',
    row('Slot', ticket.slotId),
  ].join('');

  const parking = [
    row('Entry time', dateTime(ticket.entryTime)),
    row('Exit time', isFinal ? dateTime(ticket.exitTime) : 'Pending'),
    row('Duration', isFinal
      ? duration(ticket.elapsedMinutes)
      : `${duration(ticket.elapsedMinutes)} so far`),
    row('Billable hours', isFinal ? String(ticket.billableHours) : 'Pending'),
    row('Hourly rate', `${money(ticket.hourlyRatePaise)} / started hour`),
  ].join('');

  const total = !isFinal
    ? `<div class="paper__total paper__total--pending">
         <span>Amount due</span><span>Pending</span>
       </div>
       <p class="paper__note">This vehicle is still parked. The exit time and the
          final fee are decided at checkout.</p>`
    : `<div class="paper__total">
         <span>Amount paid</span><span>${escapeHtml(money(ticket.finalFeePaise))}</span>
       </div>
       <p class="paper__note">Charged per started hour. Thank you for parking
          with ParkWise.</p>`;

  return `
    <div class="paper__sheet${stamped ? ' has-stamp' : ''}">
      <div class="paper__head">
        <svg class="paper__mark" aria-hidden="true"><use href="#pw-mark"/></svg>
        <div class="paper__brand">ParkWise</div>
        <div class="paper__title">${isFinal ? 'Parking Exit Receipt' : 'Parking Ticket'}</div>
        <div class="paper__id">${escapeHtml(ticket.ticketId)}</div>
      </div>

      <div class="paper__rule"></div>
      <div class="paper__label">Vehicle</div>
      ${vehicle}

      <div class="paper__rule"></div>
      <div class="paper__label">Parking</div>
      ${parking}

      <div class="paper__rule"></div>
      ${total}

      <div class="paper__rule"></div>
      ${barcodeSvg(ticket.ticketId)}
      <div class="paper__id paper__id--foot">${escapeHtml(ticket.ticketId)}</div>
    </div>
    ${tearSvg()}`;
}

/**
 * What the stamp should say, worked out from the ticket alone.
 *
 * ParkWise has no payment system: there is no gateway, no transaction and no
 * separate paid flag anywhere in the backend. What it does have is a checkout,
 * at which the operator takes the money - which is why the ticket already
 * reads "Amount paid" and the checkout toast already says "Collected". The
 * stamp says no more than those do, and a session still running gets none.
 */
function stampFor(ticket) {
  if (ticket.status !== 'COMPLETED') return null;
  return Number(ticket.finalFeePaise) > 0
    ? { text: 'Paid', tone: 'paid' }
    : { text: 'No charge', tone: 'free' };
}

// ---------------------------------------------------------------------------
// The printer
// ---------------------------------------------------------------------------

/**
 * Opens the printer over the current screen and feeds out `ticket`.
 *
 * Resolves when the overlay closes. Safe to call twice: the second call is
 * ignored while a printer is already open.
 */
export function showReceiptPrinter(ticket) {
  if (openPrinter) return openPrinter;

  const host = document.getElementById('receiptHost');
  const lastFocused = document.activeElement;
  const stamp = stampFor(ticket);
  const skipAnimation = reducedMotion();

  host.innerHTML = `
    <div class="printer-stage" role="dialog" aria-modal="true"
         aria-labelledby="receiptHeading">
      <h2 class="sr-only" id="receiptHeading">
        ${stamp ? 'Parking exit receipt' : 'Parking ticket'} ${escapeHtml(ticket.ticketId)}
      </h2>

      <div class="printer" aria-hidden="true">
        <div class="printer__top">
          <span class="printer__brand">
            <svg class="printer__mark"><use href="#pw-mark"/></svg>
            <span>ParkWise</span>
          </span>
          <span class="printer__lamp"><i></i>Ready</span>
        </div>
        <div class="printer__slot"></div>
      </div>

      <div class="paper-track">
        <div class="paper">${paperHtml(ticket, Boolean(stamp))}</div>
        ${stamp ? `<div class="stamp stamp--${stamp.tone}">
                     <span>${escapeHtml(stamp.text)}</span>
                   </div>` : ''}
      </div>

      <div class="receipt-actions">
        <button class="btn btn--primary" data-receipt="print">
          ${icon('#i-print')}Print or save as PDF
        </button>
        <button class="btn btn--ghost" data-receipt="close">Done</button>
      </div>

      <button class="receipt-skip" data-receipt="skip">Skip animation</button>
    </div>`;

  host.hidden = false;
  document.body.classList.add('is-printing');

  const stage = host.querySelector('.printer-stage');
  const timers = [];
  const at = (ms, run) => timers.push(window.setTimeout(run, ms));
  let finished = false;

  /** Jumps to the finished state, whether by reaching it or by skipping. */
  const finish = () => {
    if (finished) return;
    finished = true;
    timers.forEach(window.clearTimeout);
    timers.length = 0;
    stage.classList.remove('is-feeding');
    stage.classList.add('is-ready', 'is-fed', 'is-done');
    if (stamp) stage.classList.add('is-stamped');
    stage.querySelector('[data-receipt="print"]')?.focus();
  };

  if (skipAnimation) {
    // The printing is decoration; the receipt is the point. Someone who has
    // asked for less motion gets it straight away.
    finish();
  } else {
    at(320, () => stage.classList.add('is-ready'));
    at(520, () => { stage.classList.add('is-feeding'); });
    at(1620, () => { stage.classList.remove('is-feeding'); stage.classList.add('is-fed'); });
    if (stamp) at(1880, () => stage.classList.add('is-stamped'));
    at(stamp ? 2260 : 1900, finish);
  }

  const close = () => {
    timers.forEach(window.clearTimeout);
    document.removeEventListener('keydown', onKey);
    host.hidden = true;
    host.innerHTML = '';
    document.body.classList.remove('is-printing');
    openPrinter = null;
    if (lastFocused && lastFocused.focus) lastFocused.focus();
  };

  // Escape finishes the animation on the first press and closes on the second,
  // so it never snatches the receipt away from someone who only wanted it to
  // stop moving.
  const onKey = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!finished) finish();
      else close();
      return;
    }
    if (event.key !== 'Tab') return;

    const stops = Array.from(stage.querySelectorAll('button:not([hidden]):not(:disabled)'));
    if (stops.length === 0) return;
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    } else if (!stage.contains(document.activeElement)) {
      event.preventDefault();
      first.focus();
    }
  };

  stage.addEventListener('click', (event) => {
    const action = event.target.closest('[data-receipt]')?.dataset.receipt;
    if (action === 'print') {
      // The existing print path, untouched: the overlay is hidden by the
      // print stylesheet, so the sheet carries only the ticket.
      printTicket(ticket);
    } else if (action === 'close') {
      close();
    } else if (action === 'skip') {
      finish();
    }
  });

  // Clicking the backdrop finishes a running animation rather than closing,
  // which is what an impatient click almost always means.
  host.addEventListener('click', (event) => {
    if (event.target !== host) return;
    if (!finished) finish();
    else close();
  });

  document.addEventListener('keydown', onKey);
  stage.querySelector('[data-receipt="skip"]')?.focus();

  openPrinter = { close, finish };
  return openPrinter;
}

/** Closes any open printer. Used when a screen is torn down under it. */
export function closeReceiptPrinter() {
  openPrinter?.close();
}
