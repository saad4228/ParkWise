// The only place the browser talks to the C++ server.
//
// Every call returns the parsed JSON on success, and throws an ApiError that
// carries the server's own error code and message on failure. Screens catch
// that error and show the message - they never invent one of their own, and
// they never treat a failed call as if it had worked.

const BASE = '/api';

export class ApiError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

/** Fired whenever a call succeeds or fails, so the sidebar can show status. */
const connectionListeners = new Set();

export function onConnectionChange(listener) {
  connectionListeners.add(listener);
  return () => connectionListeners.delete(listener);
}

function announce(connected) {
  connectionListeners.forEach((listener) => listener(connected));
}

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(BASE + path, {
      headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
      ...options,
    });
  } catch (networkProblem) {
    announce(false);
    throw new ApiError(
      'NETWORK_ERROR',
      'Could not reach the ParkWise server. Check that it is still running.',
      0,
    );
  }

  announce(true);

  // 204 and empty bodies are valid answers to some calls.
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (parseProblem) {
      throw new ApiError('BAD_RESPONSE', 'The server sent a reply the app could not read.',
                         response.status);
    }
  }

  if (!response.ok) {
    const error = payload && payload.error ? payload.error : {};
    throw new ApiError(
      error.code || 'UNKNOWN_ERROR',
      error.message || `The request failed (HTTP ${response.status}).`,
      response.status,
    );
  }

  return payload;
}

function withQuery(path, params) {
  const query = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== '') {
      query.set(key, value);
    }
  });
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}

const getJson = (path, params) => request(withQuery(path, params));
const postJson = (path, body) =>
  request(path, { method: 'POST', body: JSON.stringify(body || {}) });

export const api = {
  // What kind of copy of ParkWise this is. Asked once, when the shell loads.
  meta:         () => getJson('/meta'),

  dashboard:    () => getJson('/dashboard'),

  slots:        () => getJson('/slots'),
  slot:         (slotId) => getJson(`/slots/${encodeURIComponent(slotId)}`),

  vehicleEntry: (payload) => postJson('/vehicles/entry', payload),
  vehicleExit:  (ticketId) => postJson('/vehicles/exit', { ticketId }),

  lookupTicket: (query) => getJson('/tickets/lookup', { query }),
  ticket:       (ticketId) => getJson(`/tickets/${encodeURIComponent(ticketId)}`),

  reservations:       (params) => getJson('/reservations', params),
  createReservation:  (payload) => postJson('/reservations', payload),
  cancelReservation:  (id) => postJson(`/reservations/${encodeURIComponent(id)}/cancel`, {}),
  checkInReservation: (id, registrationNumber) =>
    postJson(`/reservations/${encodeURIComponent(id)}/check-in`, { registrationNumber }),

  queue:        () => getJson('/queue'),
  addToQueue:   (payload) => postJson('/queue', payload),
  cancelQueued: (id) => request(`/queue/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  history:      (params) => getJson('/history', params),
  reports:      (params) => getJson('/reports', params),

  /** Not fetched: the browser downloads this URL directly. */
  historyCsvUrl: (params) => BASE + withQuery('/exports/history.csv', params),

  settings:       () => getJson('/settings'),
  saveSettings:   (payload) => request('/settings', { method: 'PUT', body: JSON.stringify(payload) }),
  backupNow:      () => postJson('/settings/backup', {}),
};
