// Reusable pieces of interface.
//
// These are small functions that return HTML strings or create elements -
// not a framework. Keeping them here means every screen gets the same
// buttons, badges, tables, empty states and dialogs without copying markup.

import { escapeHtml, vehicleIconId, vehicleTypeLabel } from './format.js';

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

export function icon(id, className = '') {
  return `<svg class="${className}" aria-hidden="true"><use href="${id}"/></svg>`;
}

export function statCard({ label, value, hint, iconId, tone = 'info', href }) {
  const inner = `
    <span class="stat__icon stat__icon--${tone}">${icon(iconId)}</span>
    <span>
      <span class="stat__label">${escapeHtml(label)}</span>
      <div class="stat__value">${escapeHtml(value)}</div>
      ${hint ? `<span class="stat__hint">${escapeHtml(hint)}</span>` : ''}
    </span>`;
  if (href) {
    return `<button class="stat" type="button" data-navigate="${escapeHtml(href)}">${inner}</button>`;
  }
  return `<div class="stat">${inner}</div>`;
}

const BADGE_TONES = {
  ACTIVE: 'info', COMPLETED: 'ok',
  AVAILABLE: 'ok', OCCUPIED: 'danger', RESERVED: 'info',
  UPCOMING: 'info', CHECKED_IN: 'ok', CANCELLED: 'muted', EXPIRED: 'warn',
  WAITING: 'warn', ASSIGNED: 'ok',
  WALK_IN: 'muted', RESERVATION: 'info', QUEUE: 'warn',
};

const BADGE_LABELS = {
  ACTIVE: 'Active', COMPLETED: 'Completed',
  AVAILABLE: 'Available', OCCUPIED: 'Occupied', RESERVED: 'Reserved',
  UPCOMING: 'Upcoming', CHECKED_IN: 'Checked in', CANCELLED: 'Cancelled', EXPIRED: 'Expired',
  WAITING: 'Waiting', ASSIGNED: 'Assigned',
  WALK_IN: 'Walk-in', RESERVATION: 'Reservation', QUEUE: 'From queue',
};

/** A status pill. The state is always spelled out, never colour alone. */
export function badge(state, overrideLabel) {
  const tone = BADGE_TONES[state] || 'muted';
  const label = overrideLabel || BADGE_LABELS[state] || state || '';
  return `<span class="badge badge--${tone}">${escapeHtml(label)}</span>`;
}

export function vehicleChip(type) {
  return `<span class="badge badge--muted">${icon(vehicleIconId(type))}${escapeHtml(vehicleTypeLabel(type))}</span>`;
}

export function emptyState({ title, text, iconId = '#i-grid', actionHtml = '' }) {
  return `
    <div class="state">
      <span class="state__icon">${icon(iconId)}</span>
      <h3>${escapeHtml(title)}</h3>
      ${text ? `<p>${escapeHtml(text)}</p>` : ''}
      ${actionHtml}
    </div>`;
}

export function errorState(message, retryLabel = 'Try again') {
  return `
    <div class="state state--error">
      <span class="state__icon">${icon('#i-alert')}</span>
      <h3>Something went wrong</h3>
      <p>${escapeHtml(message)}</p>
      <button class="btn btn--ghost btn--sm" data-retry>${escapeHtml(retryLabel)}</button>
    </div>`;
}

export function loadingState(rows = 4) {
  const lines = Array.from({ length: rows },
    () => '<div class="skeleton skeleton-row"></div>').join('');
  return `<div style="padding:18px">${lines}</div>`;
}

export function fieldError(message) {
  return `<span class="field__error">${icon('#i-alert')}${escapeHtml(message)}</span>`;
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

const TOAST_ICONS = { ok: '#i-check', error: '#i-alert', warn: '#i-alert' };

export function toast(title, text = '', tone = 'ok', timeoutMs = 4200) {
  const host = document.getElementById('toastHost');
  if (!host) return;

  const element = document.createElement('div');
  element.className = `toast toast--${tone}`;
  element.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  element.innerHTML = `
    ${icon(TOAST_ICONS[tone] || '#i-check', 'toast__icon')}
    <div>
      <div class="toast__title">${escapeHtml(title)}</div>
      ${text ? `<div class="toast__text">${escapeHtml(text)}</div>` : ''}
    </div>
    <button class="icon-btn btn--sm toast__close" aria-label="Dismiss">${icon('#i-close')}</button>`;

  const remove = () => {
    element.remove();
  };
  element.querySelector('.toast__close').addEventListener('click', remove);
  host.appendChild(element);
  if (timeoutMs > 0) setTimeout(remove, timeoutMs);
}

export const toastError = (error) =>
  toast('That did not work', error && error.message ? error.message : String(error), 'error', 6500);

// ---------------------------------------------------------------------------
// Confirmation dialog
// ---------------------------------------------------------------------------

/**
 * Shows a modal and resolves true when the operator confirms.
 * `bodyHtml` is inserted as markup, so callers must escape any text they
 * put in it.
 */
export function confirmDialog({
  title,
  bodyHtml = '',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'warn',
}) {
  return new Promise((resolve) => {
    const host = document.getElementById('dialogHost');
    const lastFocused = document.activeElement;

    host.innerHTML = `
      <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialogTitle">
        <div class="dialog__head">
          <span class="dialog__mark dialog__mark--${tone}">${icon(tone === 'ok' ? '#i-check' : '#i-alert')}</span>
          <h2 id="dialogTitle">${escapeHtml(title)}</h2>
        </div>
        <div class="dialog__body">${bodyHtml}</div>
        <div class="dialog__foot">
          <button class="btn btn--ghost" data-dialog="cancel">${escapeHtml(cancelLabel)}</button>
          <button class="btn btn--${tone === 'danger' ? 'danger' : 'primary'}" data-dialog="ok">${escapeHtml(confirmLabel)}</button>
        </div>
      </div>`;
    host.hidden = false;

    const close = (result) => {
      host.hidden = true;
      host.innerHTML = '';
      document.removeEventListener('keydown', onKey);
      if (lastFocused && lastFocused.focus) lastFocused.focus();
      resolve(result);
    };

    const onKey = (event) => {
      if (event.key === 'Escape') close(false);
    };

    host.querySelector('[data-dialog="ok"]').addEventListener('click', () => close(true));
    host.querySelector('[data-dialog="cancel"]').addEventListener('click', () => close(false));
    host.addEventListener('click', (event) => {
      if (event.target === host) close(false);
    });
    document.addEventListener('keydown', onKey);

    host.querySelector('[data-dialog="ok"]').focus();
  });
}

/** The money summary shown inside the checkout confirmation. */
export function feeSummaryHtml(rows, totalLabel, totalValue) {
  const body = rows
    .map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`)
    .join('');
  return `<dl class="summary-list">${body}
    <div class="is-total"><dt>${escapeHtml(totalLabel)}</dt><dd>${escapeHtml(totalValue)}</dd></div>
  </dl>`;
}

// ---------------------------------------------------------------------------
// Busy buttons - the guard against double submission
// ---------------------------------------------------------------------------

/**
 * Runs `work` while the button shows a spinner and refuses further clicks.
 * The button is always restored, including when the call fails, so the
 * operator can correct the form and try again.
 */
export async function withBusyButton(button, work) {
  if (!button || button.disabled) return undefined;
  button.classList.add('is-busy');
  button.disabled = true;
  try {
    return await work();
  } finally {
    button.classList.remove('is-busy');
    button.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Slot grid
// ---------------------------------------------------------------------------

const SLOT_CLASS = {
  AVAILABLE: 'slot--available',
  OCCUPIED: 'slot--occupied',
  RESERVED: 'slot--reserved',
};

// Each state gets its own glyph, so the three colours are never the only
// thing telling them apart.
const SLOT_ICON = {
  AVAILABLE: '#i-free',
  OCCUPIED: null, // uses the parked vehicle's own icon instead
  RESERVED: '#i-clock',
};

export function slotButton(slot, selectedId) {
  const state = slot.displayState;
  const label = BADGE_LABELS[state] || state;
  const iconId = state === 'OCCUPIED'
    ? vehicleIconId(slot.ticket ? slot.ticket.vehicleType : slot.supportedVehicleType)
    : SLOT_ICON[state];

  const description = state === 'OCCUPIED' && slot.ticket
    ? `${slot.slotId}, occupied by ${slot.ticket.registrationNumber}`
    : `${slot.slotId}, ${label.toLowerCase()}, for ${vehicleTypeLabel(slot.supportedVehicleType)}`;

  return `
    <button type="button"
            class="slot ${SLOT_CLASS[state] || ''} ${selectedId === slot.slotId ? 'is-selected' : ''}"
            data-slot="${escapeHtml(slot.slotId)}"
            title="${escapeHtml(description)}"
            aria-label="${escapeHtml(description)}">
      <span>${escapeHtml(slot.slotId)}</span>
      ${icon(iconId || '#i-free', 'slot__icon')}
    </button>`;
}

export function slotLegend() {
  return `
    <div class="legend">
      <span><span class="dot dot--busy"></span>Occupied</span>
      <span><span class="dot dot--ok"></span>Available</span>
      <span><span class="dot dot--held"></span>Reserved</span>
    </div>`;
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

/**
 * Builds a table. `columns` is a list of { label, className } and `rows` is
 * a list of rows, each row being a list of ready-made <td> strings.
 */
export function dataTable(columns, rows) {
  const head = columns
    .map((column) => `<th class="${column.className || ''}">${escapeHtml(column.label)}</th>`)
    .join('');
  const body = rows
    .map((cells, index) => `<tr data-row-index="${index}">${cells.join('')}</tr>`)
    .join('');
  return `
    <div class="table-wrap">
      <table class="data">
        <thead><tr>${head}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}
