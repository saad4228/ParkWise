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

/**
 * A thin "share of the whole" bar. `percent` is 0-100.
 *
 * It carries an aria-label because the bar itself is decoration: the same
 * figure is always written out beside it.
 */
export function meter(percent, label) {
  const clamped = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
  const tone = clamped >= 100 ? ' meter__fill--full' : clamped >= 80 ? ' meter__fill--busy' : '';
  return `
    <div class="meter" role="img" aria-label="${escapeHtml(label || `${clamped}%`)}">
      <div class="meter__fill${tone}" style="width:${clamped}%"></div>
    </div>`;
}

export function statCard({ label, value, hint, iconId, tone = 'info', href, extraHtml = '' }) {
  const inner = `
    <span class="stat__icon stat__icon--${tone}">${icon(iconId)}</span>
    <span style="min-width:0;flex:1 1 auto">
      <span class="stat__label">${escapeHtml(label)}</span>
      <div class="stat__value">${escapeHtml(value)}</div>
      ${hint ? `<span class="stat__hint">${escapeHtml(hint)}</span>` : ''}
      ${extraHtml}
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

    // Tab must not walk out of a modal and leave the operator typing into a
    // page they cannot see. The two buttons are the whole tab ring, so the
    // trap is simply "wrap at each end".
    const onKey = (event) => {
      if (event.key === 'Escape') {
        close(false);
        return;
      }
      if (event.key !== 'Tab') return;

      const stops = Array.from(host.querySelectorAll('button:not(:disabled)'));
      if (stops.length === 0) return;

      const first = stops[0];
      const last = stops[stops.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!host.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    };

    host.querySelector('[data-dialog="ok"]').addEventListener('click', () => close(true));
    host.querySelector('[data-dialog="cancel"]').addEventListener('click', () => close(false));
    host.addEventListener('click', (event) => {
      if (event.target === host) close(false);
    });
    document.addEventListener('keydown', onKey);

    // A destructive dialog opens with the cancel button focused, so a stray
    // Enter from the keystroke that opened it does not confirm the deletion.
    // Harmless confirmations still open ready to accept.
    const opensOn = tone === 'danger' ? 'cancel' : 'ok';
    host.querySelector(`[data-dialog="${opensOn}"]`).focus();
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

/**
 * Makes a slot grid behave like one control instead of fifty.
 *
 * A fifty-slot car park put fifty stops in the tab order, so reaching
 * anything after the grid meant fifty presses. The grid is now a single stop
 * and the arrow keys move within it, which is how a grid of choices is
 * expected to work. Home and End jump to the ends.
 *
 * Call this after the grid markup is written, and again after any redraw.
 */
export function wireSlotGridKeys(grid, { onActivate } = {}) {
  if (!grid) return;
  const tiles = Array.from(grid.querySelectorAll('[data-slot]'));
  if (tiles.length === 0) return;

  // Only one tile is reachable by Tab; the rest are reached with the arrows.
  const chosen = grid.querySelector('[data-slot].is-selected') || tiles[0];
  tiles.forEach((tile) => { tile.tabIndex = tile === chosen ? 0 : -1; });

  // How many tiles fit on a row, so Up and Down move a visual row at a time.
  const columnsOf = () => {
    const style = window.getComputedStyle(grid);
    const columns = style.gridTemplateColumns.split(' ').filter(Boolean).length;
    return Math.max(1, columns);
  };

  const moveTo = (index) => {
    const target = tiles[Math.max(0, Math.min(tiles.length - 1, index))];
    if (!target) return;
    tiles.forEach((tile) => { tile.tabIndex = -1; });
    target.tabIndex = 0;
    target.focus();
  };

  grid.addEventListener('keydown', (event) => {
    const current = tiles.indexOf(document.activeElement);
    if (current === -1) return;

    const columns = columnsOf();
    const jumps = {
      ArrowRight: current + 1,
      ArrowLeft: current - 1,
      ArrowDown: current + columns,
      ArrowUp: current - columns,
      Home: 0,
      End: tiles.length - 1,
    };

    if (event.key in jumps) {
      event.preventDefault();
      moveTo(jumps[event.key]);
      return;
    }
    // Space would otherwise scroll the page instead of choosing the slot.
    if (event.key === ' ' && typeof onActivate === 'function') {
      event.preventDefault();
      onActivate(document.activeElement.dataset.slot);
    }
  });
}

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
// Freshness
// ---------------------------------------------------------------------------

/**
 * The "updated a moment ago" line, for the screens that reload on a timer.
 * `id` lets the screen find the text again to update it in place.
 */
export function freshnessBar(id = 'freshness') {
  return `
    <div class="freshness" id="${id}">
      <span class="freshness__dot" aria-hidden="true"></span>
      <span data-freshness-text>Loading…</span>
      <button class="btn btn--subtle btn--sm" data-refresh-now type="button">Refresh</button>
    </div>`;
}

/**
 * Starts a freshness line ticking. Returns a stop function, which the screen's
 * cleanup must call - otherwise the interval outlives the screen.
 */
export function startFreshness(root, id, onRefresh) {
  const host = root.querySelector(`#${id}`);
  if (!host) return () => {};

  const text = host.querySelector('[data-freshness-text]');
  let updatedAt = null;

  const describe = () => {
    if (updatedAt === null) return 'Loading…';
    const seconds = Math.round((Date.now() - updatedAt) / 1000);
    if (seconds < 10) return 'Updated just now';
    if (seconds < 60) return `Updated ${seconds}s ago`;
    const minutes = Math.round(seconds / 60);
    return `Updated ${minutes} min${minutes === 1 ? '' : 's'} ago`;
  };

  const paint = () => { if (text) text.textContent = describe(); };

  host.querySelector('[data-refresh-now]')?.addEventListener('click', () => {
    if (typeof onRefresh === 'function') onRefresh();
  });

  const ticker = setInterval(paint, 10000);

  return {
    markLoading() { host.classList.add('is-loading'); },
    markUpdated() {
      host.classList.remove('is-loading');
      updatedAt = Date.now();
      paint();
    },
    stop() { clearInterval(ticker); },
  };
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
