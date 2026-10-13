// The top-down car park.
//
// The backend stores a slot as an id, the vehicle type it takes, and whether
// something is parked in it. There are no coordinates, floors or zones in the
// data, so this file never invents any. The layout is DERIVED from the ids:
//
//   - the leading letters of an id name its row   ("A07"  -> row A)
//   - the number after them orders it in the row  ("A07"  -> 7th)
//   - an id with no letters joins a numbered row  ("12"   -> row #)
//   - anything else sorts by its text             ("VIP"  -> row VIP)
//
// Rows are paired up to face each other across a driving aisle, the way a
// real surface car park is painted. Any valid layout from the Settings screen
// draws correctly, from a single bay to the 500-bay maximum.
//
// The map is real buttons laid out with CSS, not a picture. Every bay can be
// hovered, focused, selected and read by a screen reader, and zooming changes
// the size of the layout rather than scaling an image of it.

import { escapeHtml, money, duration, dateTime, timeOnly, vehicleTypeLabel } from './format.js';
import { badge, icon, slotLegend } from './ui.js';

const STATE_CLASS = { AVAILABLE: 'bay--available', OCCUPIED: 'bay--occupied', RESERVED: 'bay--reserved' };
const STATE_WORD = { AVAILABLE: 'available', OCCUPIED: 'occupied', RESERVED: 'reserved' };
const VEHICLE_SYMBOL = { CAR: '#v-car', SUV: '#v-suv', BIKE: '#v-bike' };

// A painted row longer than this wraps onto another strip, so a 40-bay row
// does not turn into one very long line that has to be scrolled sideways.
const MAX_BAYS_PER_STRIP = 16;

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.1;
// Below this size the bay labels are dropped and only the shapes remain.
const DENSE_BELOW = 0.72;

// What each bay looked like the last time any map was on screen. Modules are
// loaded once per visit, so this survives moving between screens: come back
// to the dashboard after a check-in and that bay pulses once.
const lastSeenState = new Map();

// ---------------------------------------------------------------------------
// Deriving the layout from slot ids
// ---------------------------------------------------------------------------

/** "A07" -> { prefix: "A", rest: "07", number: 7 } */
export function parseSlotId(slotId) {
  const text = String(slotId || '').toUpperCase();
  const match = /^([A-Z]*)(.*)$/.exec(text);
  const prefix = match[1];
  const rest = match[2];
  return { prefix, rest, number: /^\d+$/.test(rest) ? Number(rest) : null };
}

function rowKeyOf(slotId) {
  const { prefix } = parseSlotId(slotId);
  return prefix || '#';
}

function compareRowKeys(left, right) {
  if (left === right) return 0;
  if (left === '#') return 1;   // numbered bays go last
  if (right === '#') return -1;
  // A, B ... Z, then AA, AB - the order a spreadsheet uses.
  return left.length - right.length || left.localeCompare(right);
}

function compareWithinRow(left, right) {
  const a = parseSlotId(left.slotId);
  const b = parseSlotId(right.slotId);
  if (a.number !== null && b.number !== null && a.number !== b.number) return a.number - b.number;
  if (a.number !== null && b.number === null) return -1;
  if (a.number === null && b.number !== null) return 1;
  return a.rest.localeCompare(b.rest) || left.slotId.localeCompare(right.slotId);
}

/**
 * Groups slots into rows, and long rows into strips. The result is plain data
 * so the rules can be explained - and checked - without a browser.
 */
export function buildLayout(slots) {
  const rows = new Map();
  slots.forEach((slot) => {
    const key = rowKeyOf(slot.slotId);
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push(slot);
  });

  const ordered = [...rows.keys()].sort(compareRowKeys).map((key) => ({
    key,
    label: key === '#' ? 'Numbered bays' : `Row ${key}`,
    slots: rows.get(key).sort(compareWithinRow),
  }));

  const strips = [];
  ordered.forEach((row) => {
    for (let start = 0; start < row.slots.length; start += MAX_BAYS_PER_STRIP) {
      strips.push({
        key: row.key,
        label: row.label,
        slots: row.slots.slice(start, start + MAX_BAYS_PER_STRIP),
      });
    }
  });

  return { rows: ordered, strips };
}

// ---------------------------------------------------------------------------
// Describing a bay in words
// ---------------------------------------------------------------------------

function describe(slot) {
  const takes = `takes ${vehicleTypeLabel(slot.supportedVehicleType).toLowerCase()}s`;
  if (slot.displayState === 'OCCUPIED' && slot.ticket) {
    return `Bay ${slot.slotId}, occupied by ${slot.ticket.registrationNumber}, ` +
           `parked ${duration(slot.ticket.elapsedMinutes)}`;
  }
  if (slot.displayState === 'RESERVED' && slot.reservation) {
    return `Bay ${slot.slotId}, reserved for ${slot.reservation.registrationNumber} ` +
           `from ${timeOnly(slot.reservation.startTime)}, ${takes}`;
  }
  return `Bay ${slot.slotId}, ${STATE_WORD[slot.displayState] || 'unknown'}, ${takes}`;
}

function tipHtml(slot) {
  const rows = [['Takes', vehicleTypeLabel(slot.supportedVehicleType)]];

  if (slot.ticket) {
    rows.push(
      ['Vehicle', slot.ticket.registrationNumber],
      ['Entered', timeOnly(slot.ticket.entryTime)],
      ['Parked for', duration(slot.ticket.elapsedMinutes)],
      ['Fee so far', `${money(slot.ticket.estimatedFeePaise)}`],
    );
  }
  if (slot.reservation) {
    rows.push(
      ['Booked by', slot.reservation.registrationNumber],
      ['From', dateTime(slot.reservation.startTime)],
      ['Until', timeOnly(slot.reservation.endTime)],
    );
  }

  const detail = rows
    .map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`)
    .join('');

  return `
    <div class="bay-tip__head">
      <span class="bay-tip__id">${escapeHtml(slot.slotId)}</span>
      ${badge(slot.displayState)}
    </div>
    <dl>${detail}</dl>
    <div class="bay-tip__hint">Click or press Enter for details</div>`;
}

// ---------------------------------------------------------------------------
// Markup
// ---------------------------------------------------------------------------

function bayHtml(slot, selectedId, facing) {
  const state = slot.displayState;
  const type = slot.supportedVehicleType;
  const classes = ['bay', STATE_CLASS[state] || '', `bay--${String(type).toLowerCase()}`];
  if (slot.slotId === selectedId) classes.push('is-selected');

  const id = `<span class="bay__id">${escapeHtml(slot.slotId)}</span>`;
  let inner;
  if (state === 'OCCUPIED') {
    // Draw the vehicle that is actually parked, which is normally the type
    // the bay takes but is read from the ticket rather than assumed.
    const parked = slot.ticket ? slot.ticket.vehicleType : type;
    inner = `<svg class="bay__vehicle" aria-hidden="true"><use href="${VEHICLE_SYMBOL[parked] || '#v-car'}"/></svg>${id}`;
  } else if (state === 'RESERVED') {
    inner = `${id}<svg class="bay__mark" aria-hidden="true"><use href="#i-clock"/></svg>`;
  } else {
    inner = `${id}<span class="bay__type" aria-hidden="true">${escapeHtml(type)}</span>`;
  }

  return `<button type="button" class="${classes.join(' ')}" data-slot="${escapeHtml(slot.slotId)}"
                  data-facing="${facing}" tabindex="-1"
                  aria-label="${escapeHtml(describe(slot))}"
                  aria-pressed="${slot.slotId === selectedId ? 'true' : 'false'}">${inner}</button>`;
}

function stripHtml(strip, facing, selectedId) {
  return `
    <div class="lot-row lot-row--${facing}" data-row="${escapeHtml(strip.key)}">
      <span class="lot-row__label" title="${escapeHtml(strip.label)}" aria-hidden="true">${escapeHtml(strip.key)}</span>
      <div class="lot-row__bays" role="group" aria-label="${escapeHtml(strip.label)}">
        ${strip.slots.map((slot) => bayHtml(slot, selectedId, facing)).join('')}
      </div>
    </div>`;
}

function aisleHtml(strips, pairIndex, isFirst, isLast) {
  const longest = Math.max(...strips.map((strip) => strip.slots.length));
  const arrows = Math.max(2, Math.round(longest / 4));
  const arrow = `<svg class="lot-aisle__arrow" aria-hidden="true"><use href="#i-arrow"/></svg>`;
  return `
    <div class="lot-aisle ${pairIndex % 2 === 1 ? 'lot-aisle--back' : ''}" aria-hidden="true">
      ${isFirst ? `<span class="lot-gate lot-gate--entry"><svg><use href="#i-chevrons"/></svg>ENTRY</span>` : ''}
      ${Array.from({ length: arrows }, () => arrow).join('')}
      ${isLast ? `<span class="lot-gate lot-gate--exit">EXIT<svg><use href="#i-chevrons"/></svg></span>` : ''}
    </div>`;
}

function lotHtml(layout, selectedId) {
  const { strips } = layout;
  const pairs = [];
  for (let index = 0; index < strips.length; index += 2) {
    pairs.push(strips.slice(index, index + 2));
  }

  return pairs.map((pair, pairIndex) => {
    const isFirst = pairIndex === 0;
    const isLast = pairIndex === pairs.length - 1;
    const [upper, lower] = pair;
    return `
      <section class="lot-pair">
        ${stripHtml(upper, 'down', selectedId)}
        ${aisleHtml(pair, pairIndex, isFirst, isLast)}
        ${lower ? stripHtml(lower, 'up', selectedId) : ''}
      </section>
      ${isLast ? '' : '<div class="lot-island" aria-hidden="true"></div>'}`;
  }).join('');
}

/**
 * One row of the car park, drawn small and still, with a single bay picked
 * out. Used after a check-in to show the operator where the vehicle went, in
 * the same picture they know from the dashboard. It is decoration over real
 * data: `inert`, so it takes no clicks and no keyboard focus, and the caption
 * beside it says the same thing in words.
 */
export function rowPreviewHtml(slots, slotId) {
  const { strips } = buildLayout(slots);
  const strip = strips.find((candidate) => candidate.slots.some((slot) => slot.slotId === slotId));
  if (!strip) return '';
  return `
    <div class="lot-preview" inert aria-hidden="true">
      <div class="lot" style="--zoom:.78">
        <div class="lot__inner">
          ${stripHtml(strip, 'down', slotId)}
          <div class="lot-aisle"></div>
        </div>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// The interactive view
// ---------------------------------------------------------------------------

const normalise = (text) => String(text || '').toUpperCase().replace(/[\s.-]/g, '');

function readStoredZoom(key) {
  try {
    const stored = localStorage.getItem(`parkwise.zoom.${key}`);
    if (stored === 'fit') return 'fit';
    const value = Number(stored);
    return Number.isFinite(value) && value >= ZOOM_MIN && value <= ZOOM_MAX ? value : 'fit';
  } catch (blocked) {
    return 'fit';
  }
}

function storeZoom(key, value) {
  try { localStorage.setItem(`parkwise.zoom.${key}`, String(value)); } catch (blocked) { /* ignore */ }
}

/**
 * Builds the toolbar and map inside `host` and returns a small controller.
 *
 *   update(data)   draw the latest { slots } from the server
 *   select(id)     select a bay, or null to clear
 *   destroy()      remove listeners and the hover card
 *
 * `onSelect(slot)` is called with the selected slot object, or null.
 */
export function createFacility(host, { persistKey = 'default', selectedId = null, onSelect } = {}) {
  host.innerHTML = `
    <div class="facility__toolbar">
      <select class="select select--sm" data-filter="zone" aria-label="Show one row only">
        <option value="">All rows</option>
      </select>
      <select class="select select--sm" data-filter="type" aria-label="Filter by vehicle type">
        <option value="">All vehicle types</option>
        <option value="CAR">Car</option>
        <option value="BIKE">Bike</option>
        <option value="SUV">SUV</option>
      </select>
      <select class="select select--sm" data-filter="state" aria-label="Filter by status">
        <option value="">All statuses</option>
        <option value="AVAILABLE">Available</option>
        <option value="OCCUPIED">Occupied</option>
        <option value="RESERVED">Reserved</option>
      </select>
      <span class="facility__search">
        ${icon('#i-search')}
        <input class="input input--sm input--plate" data-filter="search" type="search"
               placeholder="Bay or registration" aria-label="Find a bay or a registration number"
               autocomplete="off">
      </span>
      <span class="facility__spacer"></span>
      <div class="zoom-group" role="group" aria-label="Zoom">
        <button type="button" data-zoom="out" aria-label="Zoom out" title="Zoom out (-)">${icon('#i-minus')}</button>
        <span class="zoom-group__value" data-zoom-value aria-live="polite">100%</span>
        <button type="button" data-zoom="in" aria-label="Zoom in" title="Zoom in (+)">${icon('#i-plus')}</button>
        <button type="button" data-zoom="fit" aria-label="Fit the car park to the window" title="Fit to window (0)">${icon('#i-fit')}</button>
      </div>
    </div>
    <div class="facility__status">
      <span data-summary aria-live="polite"></span>
      ${slotLegend()}
    </div>
    <div class="facility__viewport" data-viewport>
      <div class="lot" data-lot></div>
    </div>`;

  const viewport = host.querySelector('[data-viewport]');
  const lot = host.querySelector('[data-lot]');
  const summary = host.querySelector('[data-summary]');
  const zoomValue = host.querySelector('[data-zoom-value]');
  const zoneSelect = host.querySelector('[data-filter="zone"]');
  const typeSelect = host.querySelector('[data-filter="type"]');
  const stateSelect = host.querySelector('[data-filter="state"]');
  const searchInput = host.querySelector('[data-filter="search"]');

  // The hover card lives on <body> so the map's scrolling cannot clip it.
  const tip = document.createElement('div');
  tip.className = 'bay-tip';
  tip.setAttribute('aria-hidden', 'true');
  document.body.appendChild(tip);

  let slots = [];
  let bySlot = new Map();
  let selected = selectedId;
  let zoom = 1;
  let fitted = false;
  let hasDrawn = false;
  const filters = { zone: '', type: '', state: '', search: '' };
  let flashTimer = null;
  let searchTimer = null;

  // ---- drawing ----------------------------------------------------------

  function matches(slot) {
    if (filters.type && slot.supportedVehicleType !== filters.type) return false;
    if (filters.state && slot.displayState !== filters.state) return false;
    if (filters.search) {
      const needle = normalise(filters.search);
      const plates = [
        slot.slotId,
        slot.ticket && slot.ticket.registrationNumber,
        slot.reservation && slot.reservation.registrationNumber,
      ];
      if (!plates.some((value) => value && normalise(value).includes(needle))) return false;
    }
    return true;
  }

  function filtersActive() {
    return Boolean(filters.type || filters.state || filters.search);
  }

  function refreshZoneOptions() {
    const { rows } = buildLayout(slots);
    const keep = filters.zone;
    zoneSelect.innerHTML = `<option value="">All rows</option>${rows.map((row) =>
      `<option value="${escapeHtml(row.key)}">${escapeHtml(row.label)} (${row.slots.length})</option>`).join('')}`;
    if (rows.some((row) => row.key === keep)) {
      zoneSelect.value = keep;
    } else {
      filters.zone = '';
      zoneSelect.value = '';
    }
  }

  function applyDimming() {
    let matched = 0;
    lot.querySelectorAll('.bay').forEach((bay) => {
      const slot = bySlot.get(bay.dataset.slot);
      const hit = slot ? matches(slot) : false;
      bay.classList.toggle('is-dimmed', filtersActive() && !hit);
      if (hit) matched++;
    });

    const shown = filters.zone ? slots.filter((slot) => rowKeyOf(slot.slotId) === filters.zone).length
                               : slots.length;
    const rowCount = buildLayout(slots).rows.length;
    summary.innerHTML = filtersActive()
      ? `<span class="facility__match">${matched}</span> of ${shown} bays match`
      : `${shown} bays${filters.zone ? '' : ` in ${rowCount} row${rowCount === 1 ? '' : 's'}`}`;
    return matched;
  }

  // Exactly one bay is in the tab order: the selected one if it is on the
  // map, otherwise the first bay that matches the filters.
  function settleTabStop() {
    const bays = [...lot.querySelectorAll('.bay')];
    bays.forEach((bay) => { bay.tabIndex = -1; });
    const stop = bays.find((bay) => bay.dataset.slot === selected) ||
                 bays.find((bay) => !bay.classList.contains('is-dimmed')) ||
                 bays[0];
    if (stop) stop.tabIndex = 0;
  }

  function draw({ changed = new Set() } = {}) {
    const focusedId = lot.contains(document.activeElement) ? document.activeElement.dataset.slot : null;
    const visible = filters.zone ? slots.filter((slot) => rowKeyOf(slot.slotId) === filters.zone) : slots;

    if (visible.length === 0) {
      lot.innerHTML = `<div class="facility__empty">${slots.length === 0
        ? '<div class="state"><h3>No bays configured</h3><p>Add bays on the Settings screen.</p></div>'
        : '<div class="state"><h3>Nothing in this row</h3></div>'}</div>`;
      summary.textContent = '';
      return;
    }

    lot.innerHTML = `<div class="lot__inner">${lotHtml(buildLayout(visible), selected)}</div>`;
    applyDimming();
    settleTabStop();

    if (changed.size > 0) {
      changed.forEach((slotId) => {
        lot.querySelector(`.bay[data-slot="${CSS.escape(slotId)}"]`)?.classList.add('is-changed');
      });
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => {
        lot.querySelectorAll('.bay.is-changed').forEach((bay) => bay.classList.remove('is-changed'));
      }, 1600);
    }

    if (focusedId) {
      const again = lot.querySelector(`.bay[data-slot="${CSS.escape(focusedId)}"]`);
      if (again) {
        lot.querySelectorAll('.bay').forEach((bay) => { bay.tabIndex = -1; });
        again.tabIndex = 0;
        again.focus({ preventScroll: true });
      }
    }
  }

  // ---- zoom -------------------------------------------------------------

  function setZoom(value, { fit = false, remember = true } = {}) {
    zoom = Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value)) * 100) / 100;
    lot.style.setProperty('--zoom', String(zoom));
    lot.toggleAttribute('data-dense', zoom < DENSE_BELOW);
    zoomValue.textContent = `${Math.round(zoom * 100)}%`;
    fitted = fit;
    if (remember) storeZoom(persistKey, fit ? 'fit' : zoom);
  }

  // The size at which the whole car park fits the window, worked out from
  // the drawn rows rather than guessed: measure at the current size, then
  // scale by how much room is left over.
  function fitZoom() {
    const inner = lot.querySelector('.lot__inner');
    if (!inner) return 1;
    const style = window.getComputedStyle(lot);
    const needWidth = inner.getBoundingClientRect().width +
                      parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const needHeight = inner.getBoundingClientRect().height +
                       parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const scale = Math.min(viewport.clientWidth / needWidth, viewport.clientHeight / needHeight);
    // Never blow a small car park up past 140%; it just looks oversized.
    return Math.min(1.4, Math.max(ZOOM_MIN, zoom * scale * 0.98));
  }

  function fit() {
    setZoom(fitZoom(), { fit: true });
  }

  // ---- selection --------------------------------------------------------

  function select(slotId, { notify = true } = {}) {
    selected = slotId || null;
    lot.querySelectorAll('.bay').forEach((bay) => {
      const isIt = bay.dataset.slot === selected;
      bay.classList.toggle('is-selected', isIt);
      bay.setAttribute('aria-pressed', isIt ? 'true' : 'false');
    });
    settleTabStop();
    if (notify && typeof onSelect === 'function') onSelect(selected ? bySlot.get(selected) || null : null);
  }

  // ---- hover card -------------------------------------------------------

  function showTip(bay) {
    const slot = bySlot.get(bay.dataset.slot);
    if (!slot) return;
    tip.innerHTML = tipHtml(slot);
    const box = bay.getBoundingClientRect();
    const card = tip.getBoundingClientRect();
    const gap = 8;
    let top = box.top - card.height - gap;
    if (top < 8) top = box.bottom + gap;              // no room above: go below
    let left = box.left + box.width / 2 - card.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - card.width - 8));
    tip.style.top = `${Math.round(top)}px`;
    tip.style.left = `${Math.round(left)}px`;
    tip.classList.add('is-visible');
  }

  function hideTip() {
    tip.classList.remove('is-visible');
  }

  // ---- keyboard: one tab stop, arrows move across the map ---------------

  function moveFrom(current, key) {
    const bays = [...lot.querySelectorAll('.bay')];
    const index = bays.indexOf(current);
    if (index === -1) return null;

    if (key === 'ArrowRight') return bays[index + 1] || null;
    if (key === 'ArrowLeft') return bays[index - 1] || null;
    if (key === 'Home') return bays[0];
    if (key === 'End') return bays[bays.length - 1];

    // Up and Down go to the nearest bay in the row above or below, judged by
    // where it actually sits on screen, because rows can differ in length.
    const rows = [...lot.querySelectorAll('.lot-row')];
    const rowIndex = rows.indexOf(current.closest('.lot-row'));
    const targetRow = rows[rowIndex + (key === 'ArrowDown' ? 1 : -1)];
    if (!targetRow) return null;
    const box = current.getBoundingClientRect();
    const centre = box.left + box.width / 2;
    let best = null;
    let bestDistance = Infinity;
    targetRow.querySelectorAll('.bay').forEach((bay) => {
      const other = bay.getBoundingClientRect();
      const distance = Math.abs(other.left + other.width / 2 - centre);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = bay;
      }
    });
    return best;
  }

  function focusBay(bay) {
    lot.querySelectorAll('.bay').forEach((other) => { other.tabIndex = -1; });
    bay.tabIndex = 0;
    bay.focus({ preventScroll: true });
    bay.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  // ---- listeners (set once; the map inside is redrawn freely) -----------

  const onClick = (event) => {
    const bay = event.target.closest('.bay');
    if (!bay) return;
    // The details now sit beside the map, so the hover card steps aside
    // rather than covering what the operator is about to read.
    hideTip();
    select(bay.dataset.slot);
  };

  const onKeyDown = (event) => {
    const bay = event.target.closest('.bay');

    // Zoom keys work anywhere on the map.
    if (event.key === '+' || event.key === '=') { event.preventDefault(); setZoom(zoom + ZOOM_STEP); return; }
    if (event.key === '-' || event.key === '_') { event.preventDefault(); setZoom(zoom - ZOOM_STEP); return; }
    if (event.key === '0') { event.preventDefault(); fit(); return; }

    if (!bay) return;
    if (['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const target = moveFrom(bay, event.key);
      if (target) focusBay(target);
      return;
    }
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      hideTip();
      select(bay.dataset.slot);
      return;
    }
    if (event.key === 'Escape' && selected) {
      event.preventDefault();
      select(null);
    }
  };

  const onPointerOver = (event) => {
    const bay = event.target.closest('.bay');
    if (bay) showTip(bay);
  };
  const onPointerOut = (event) => {
    const bay = event.target.closest('.bay');
    if (bay && !bay.contains(event.relatedTarget)) hideTip();
  };
  const onFocusIn = (event) => {
    const bay = event.target.closest('.bay');
    if (bay && bay.matches(':focus-visible')) showTip(bay);
  };
  const onFocusOut = () => hideTip();

  // Ctrl + wheel (or a trackpad pinch, which browsers report the same way)
  // zooms the map instead of the whole page.
  const onWheel = (event) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    setZoom(zoom + (event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
  };

  const onResize = () => {
    if (fitted && hasDrawn) fit();
  };

  viewport.addEventListener('click', onClick);
  viewport.addEventListener('keydown', onKeyDown);
  viewport.addEventListener('pointerover', onPointerOver);
  viewport.addEventListener('pointerout', onPointerOut);
  viewport.addEventListener('focusin', onFocusIn);
  viewport.addEventListener('focusout', onFocusOut);
  viewport.addEventListener('scroll', hideTip, { passive: true });
  viewport.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('resize', onResize);

  host.querySelector('[data-zoom="in"]').addEventListener('click', () => setZoom(zoom + ZOOM_STEP));
  host.querySelector('[data-zoom="out"]').addEventListener('click', () => setZoom(zoom - ZOOM_STEP));
  host.querySelector('[data-zoom="fit"]').addEventListener('click', fit);

  zoneSelect.addEventListener('change', () => {
    filters.zone = zoneSelect.value;
    draw();
    if (fitted) fit();
  });
  typeSelect.addEventListener('change', () => { filters.type = typeSelect.value; applyDimming(); settleTabStop(); });
  stateSelect.addEventListener('change', () => { filters.state = stateSelect.value; applyDimming(); settleTabStop(); });
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      filters.search = searchInput.value.trim();
      const matched = applyDimming();
      settleTabStop();
      // When a search narrows to something, bring the first hit into view.
      if (filters.search && matched > 0) {
        const first = [...lot.querySelectorAll('.bay')].find((bay) => !bay.classList.contains('is-dimmed'));
        first?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
      }
    }, 140);
  });

  // ---- public -----------------------------------------------------------

  return {
    update(data) {
      slots = Array.isArray(data.slots) ? data.slots : [];
      bySlot = new Map(slots.map((slot) => [slot.slotId, slot]));

      // Which bays changed state since this map, or any map, last showed them.
      const changed = new Set();
      slots.forEach((slot) => {
        const before = lastSeenState.get(slot.slotId);
        if (before && before !== slot.displayState) changed.add(slot.slotId);
        lastSeenState.set(slot.slotId, slot.displayState);
      });

      if (selected && !bySlot.has(selected)) selected = null;
      refreshZoneOptions();
      draw({ changed });

      if (!hasDrawn) {
        hasDrawn = true;
        const stored = readStoredZoom(persistKey);
        if (stored === 'fit') {
          // Measure once at 100% so the fit is computed from a known size.
          setZoom(1, { remember: false });
          fit();
        } else {
          setZoom(stored);
        }
        if (selected) {
          lot.querySelector(`.bay[data-slot="${CSS.escape(selected)}"]`)
            ?.scrollIntoView({ block: 'center', inline: 'center' });
        }
      } else if (fitted) {
        fit();
      }

      // Keep the details beside the map in step with the latest data.
      if (selected && typeof onSelect === 'function') onSelect(bySlot.get(selected) || null);
    },

    select(slotId) {
      select(slotId);
      lot.querySelector(`.bay[data-slot="${CSS.escape(slotId || '')}"]`)
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    },

    destroy() {
      clearTimeout(flashTimer);
      clearTimeout(searchTimer);
      window.removeEventListener('resize', onResize);
      tip.remove();
    },
  };
}
