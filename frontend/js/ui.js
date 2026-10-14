// Reusable pieces of interface.
//
// These are small functions that return HTML strings or create elements -
// not a framework. Keeping them here means every screen gets the same
// buttons, badges, tables, empty states and dialogs without copying markup.

import { escapeHtml } from './format.js';

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

export function icon(id, className = '') {
  return `<svg class="${className}" aria-hidden="true"><use href="${id}"/></svg>`;
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
  // The three bay states take the chart ramp's hues, so a badge, the summary
  // donut and the map legend all say the same thing the same way.
  AVAILABLE: 'bay-free', OCCUPIED: 'bay-busy', RESERVED: 'bay-held',
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
// Slot legend
// ---------------------------------------------------------------------------

/**
 * The map's key. It shows the bay treatments themselves rather than colour
 * dots, because that is how the map actually reads: a taken bay has a car in
 * it, a held one has a dashed edge. Dots would have promised a colour code
 * the map does not use.
 */
export function slotLegend() {
  return `
    <div class="legend legend--bays">
      <span><span class="legend-bay legend-bay--free"></span>Available</span>
      <span><span class="legend-bay legend-bay--busy"><i></i></span>Occupied</span>
      <span><span class="legend-bay legend-bay--held"></span>Reserved</span>
    </div>`;
}

// ---------------------------------------------------------------------------
// Counting figures
// ---------------------------------------------------------------------------

/**
 * Runs the headline figures inside `root` up to their value.
 *
 * It animates the number and leaves everything around it alone, so a rupee
 * sign, a thousands separator or a trailing "hrs" survives. The final frame
 * always writes the original text back verbatim, which means the figure on
 * screen is exactly what the server sent, never something reconstructed from
 * a rounded number.
 *
 * Skipped entirely when the operator has asked for reduced motion.
 */
export function countUp(root, selector = '.stat__value, .rail-stats__value, .occupancy__total') {
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (still) return;

  root.querySelectorAll(selector).forEach((element) => {
    const finalText = element.textContent;
    const match = finalText.match(/-?[\d,]*\.?\d+/);
    if (!match) return;                       // nothing numeric, e.g. an em dash

    const target = Number(match[0].replace(/,/g, ''));
    if (!Number.isFinite(target) || target === 0) return;

    const decimals = (match[0].split('.')[1] || '').length;
    const before = finalText.slice(0, match.index);
    const after = finalText.slice(match.index + match[0].length);
    const grouped = match[0].includes(',');
    const started = performance.now();
    const duration = 520;

    element.setAttribute('data-count', '');

    const frame = (now) => {
      const t = Math.min(1, (now - started) / duration);
      // Ease out, so it decelerates into the number rather than stopping dead.
      const eased = 1 - Math.pow(1 - t, 3);
      if (t < 1) {
        const value = target * eased;
        const shown = grouped
          ? value.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
          : value.toFixed(decimals);
        element.textContent = before + shown + after;
        requestAnimationFrame(frame);
      } else {
        element.textContent = finalText;      // exactly what the server sent
        element.removeAttribute('data-count');
      }
    };
    element.textContent = before + (0).toFixed(decimals) + after;
    requestAnimationFrame(frame);
  });
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
