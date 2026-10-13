// Application shell: routing, navigation state and the bits of chrome that
// sit around every screen.
//
// Routing is hash based (#/dashboard, #/history?search=MH12), so the C++
// server only ever has to serve one HTML file and never needs URL rewriting.

import { api, onConnectionChange } from './api.js';
import { errorState, toast } from './ui.js';

const ROUTES = {
  dashboard:    () => import('./pages/dashboard.js'),
  entry:        () => import('./pages/entry.js'),
  exit:         () => import('./pages/exit.js'),
  slots:        () => import('./pages/slots.js'),
  reservations: () => import('./pages/reservations.js'),
  queue:        () => import('./pages/queue.js'),
  history:      () => import('./pages/history.js'),
  reports:      () => import('./pages/reports.js'),
  settings:     () => import('./pages/settings.js'),
};

const DEFAULT_ROUTE = 'dashboard';

const pageElement = document.getElementById('page');
const sidebar = document.getElementById('sidebar');
const sidebarScrim = document.getElementById('sidebarScrim');

let activeCleanup = null;
let renderToken = 0;

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

function parseHash() {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [name, queryText] = raw.split('?');
  const params = {};
  new URLSearchParams(queryText || '').forEach((value, key) => {
    params[key] = value;
  });
  return { name: ROUTES[name] ? name : DEFAULT_ROUTE, params };
}

export function navigate(path) {
  const target = path.startsWith('#') ? path : `#/${path}`;
  if (window.location.hash === target) {
    renderCurrentRoute(); // same address, but the caller wants fresh data
  } else {
    window.location.hash = target;
  }
}

function markActiveNav(name) {
  document.querySelectorAll('.nav-item').forEach((item) => {
    const isActive = item.dataset.route === name;
    item.classList.toggle('is-active', isActive);
    if (isActive) {
      item.setAttribute('aria-current', 'page');
    } else {
      item.removeAttribute('aria-current');
    }
  });
}

async function renderCurrentRoute() {
  const { name, params } = parseHash();
  const token = ++renderToken;

  markActiveNav(name);
  closeSidebar();

  // Let a screen tidy up (timers, listeners) before it is replaced.
  if (typeof activeCleanup === 'function') {
    try { activeCleanup(); } catch (problem) { /* a broken cleanup must not block navigation */ }
    activeCleanup = null;
  }

  try {
    const module = await ROUTES[name]();
    if (token !== renderToken) return; // the operator navigated again meanwhile

    activeCleanup = await module.render(pageElement, {
      params,
      navigate,
      refreshShell: refreshShellBadges,
    });
  } catch (problem) {
    if (token !== renderToken) return;
    pageElement.innerHTML = errorState(
      problem && problem.message ? problem.message : 'This screen could not be opened.',
    );
    pageElement.querySelector('[data-retry]')?.addEventListener('click', renderCurrentRoute);
  }

  pageElement.scrollTo?.(0, 0);
  window.scrollTo(0, 0);

  // Move the keyboard into the new screen. Without this, someone navigating
  // by keyboard stays parked on the sidebar link and has to tab back through
  // the whole nav to reach the content they just asked for. The `tabindex`
  // on <main> exists so it can receive this focus without becoming a tab stop
  // of its own. Screens that want a specific field focus it themselves, so
  // this only applies when nothing inside has claimed focus.
  if (!pageElement.contains(document.activeElement)) {
    pageElement.focus({ preventScroll: true });
  }
}

// Any element with data-navigate becomes a link, which keeps the stat cards
// and table rows clickable without each screen wiring its own handler.
document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-navigate]');
  if (target) {
    event.preventDefault();
    navigate(target.dataset.navigate);
  }
});

window.addEventListener('hashchange', renderCurrentRoute);

// ---------------------------------------------------------------------------
// Shell chrome
// ---------------------------------------------------------------------------

const menuToggle = document.getElementById('menuToggle');

function openSidebar() {
  sidebar.classList.add('is-open');
  sidebarScrim.hidden = false;
  menuToggle.setAttribute('aria-expanded', 'true');
  // Put the keyboard on the first link, so the menu is usable without a mouse.
  sidebar.querySelector('.nav-item')?.focus();
}

function closeSidebar({ returnFocus = false } = {}) {
  const wasOpen = sidebar.classList.contains('is-open');
  sidebar.classList.remove('is-open');
  sidebarScrim.hidden = true;
  menuToggle.setAttribute('aria-expanded', 'false');
  // Only grab focus back if the menu was actually open and asked us to -
  // otherwise every route change would steal focus from the page.
  if (wasOpen && returnFocus) menuToggle.focus();
}

menuToggle.setAttribute('aria-expanded', 'false');
menuToggle.addEventListener('click', openSidebar);
sidebarScrim.addEventListener('click', () => closeSidebar({ returnFocus: true }));

// Escape closes the slide-over menu, which is what the key is for. The
// confirmation dialog sits above this and handles its own Escape first.
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && sidebar.classList.contains('is-open')) {
    closeSidebar({ returnFocus: true });
  }
});

// --- theme ---------------------------------------------------------------

const THEME_KEY = 'parkwise.theme';

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const button = document.getElementById('themeToggle');
  button.setAttribute('aria-label',
    theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
}

// ParkWise always opens in its own look - the dark sidebar against a light
// working area. The operator's own choice is remembered once they use the
// toggle, but the computer's dark-mode setting does not decide it for them,
// because that would quietly change how the application is meant to appear.
function loadTheme() {
  let stored = null;
  try { stored = localStorage.getItem(THEME_KEY); } catch (blocked) { stored = null; }
  if (stored === 'dark' || stored === 'light') return stored;
  return 'light';
}

applyTheme(loadTheme());

document.getElementById('themeToggle').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try { localStorage.setItem(THEME_KEY, next); } catch (blocked) { /* private mode */ }
});

// --- global search -------------------------------------------------------

document.getElementById('globalSearchForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const input = document.getElementById('globalSearch');
  const query = input.value.trim();
  if (!query) return;

  // A short "letter then digits" value reads as a slot id; anything else is
  // treated as a plate or a ticket id and sent to History.
  if (/^[A-Za-z]\d{1,3}$/.test(query)) {
    navigate(`slots?focus=${encodeURIComponent(query.toUpperCase())}`);
  } else {
    navigate(`history?search=${encodeURIComponent(query)}`);
  }
  input.blur();
});

// A barrier operator works with one hand on the keyboard, so "/" jumps to the
// search box from anywhere. It is ignored while a field already has focus, so
// it can still be typed into a registration number or an owner's name.
document.addEventListener('keydown', (event) => {
  if (event.key !== '/' || event.ctrlKey || event.altKey || event.metaKey) return;

  const active = document.activeElement;
  const isTyping = active && (active.tagName === 'INPUT' ||
                              active.tagName === 'SELECT' ||
                              active.tagName === 'TEXTAREA' ||
                              active.isContentEditable);
  if (isTyping) return;

  event.preventDefault();
  const search = document.getElementById('globalSearch');
  search.focus();
  search.select();
});

// --- connection indicator -------------------------------------------------

const statusText = document.getElementById('sidebarStatusText');
const statusDot = document.querySelector('#sidebarStatus .dot');

onConnectionChange((connected) => {
  statusText.textContent = connected ? 'Connected' : 'Server unreachable';
  statusDot.className = `dot ${connected ? 'dot--ok' : 'dot--busy'}`;
});

// --- waiting-queue badge --------------------------------------------------

export async function refreshShellBadges() {
  try {
    const data = await api.queue();
    const badge = document.getElementById('queueBadge');
    const alertsDot = document.getElementById('alertsDot');
    const waiting = Number(data.waitingCount || 0);

    badge.hidden = waiting === 0;
    badge.textContent = String(waiting);
    alertsDot.hidden = waiting === 0;
    document.getElementById('alertsButton').setAttribute(
      'aria-label',
      waiting === 0 ? 'Alerts' : `Alerts: ${waiting} vehicle(s) waiting`,
    );
  } catch (problem) {
    // The badge is a convenience. A failure here must not interrupt work.
  }
}

document.getElementById('alertsButton').addEventListener('click', async () => {
  try {
    const data = await api.queue();
    const waiting = Number(data.waitingCount || 0);
    if (waiting === 0) {
      toast('Nothing needs attention', 'No vehicles are waiting for a slot.', 'ok');
    } else {
      toast(`${waiting} vehicle${waiting === 1 ? '' : 's'} waiting`,
            'Open the Waiting Queue to see them.', 'warn');
      navigate('queue');
    }
  } catch (problem) {
    toast('Could not check alerts', problem.message, 'error');
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

if (!window.location.hash) {
  window.location.hash = `#/${DEFAULT_ROUTE}`;
} else {
  renderCurrentRoute();
}
refreshShellBadges();

// Keep the badge roughly current without hammering the server.
setInterval(refreshShellBadges, 30000);
