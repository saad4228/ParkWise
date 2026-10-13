// Parking History - search and review past and current sessions.
//
// Filtering and paging happen on the server, so a long history never has to
// be shipped to the browser in full, and the CSV export downloads exactly
// the rows the current filter describes.

import { api } from '../api.js';
import {
  escapeHtml, money, duration, dateTime, timeOnly, vehicleTypeLabel,
  dateInputToStartTimestamp, dateInputToEndTimestamp,
} from '../format.js';
import {
  icon, badge, emptyState, errorState, loadingState, dataTable, toast,
} from '../ui.js';
import { ticketPanel, printTicket } from '../ticket.js';

const PAGE_SIZE = 25;

export async function render(container, ctx) {
  const state = {
    search: ctx.params.search || '',
    status: ctx.params.status || '',
    fromDate: ctx.params.fromDate || '',
    toDate: ctx.params.toDate || '',
    offset: 0,
  };

  container.innerHTML = `
    <div class="page-head">
      <div class="page-head__text">
        <h1>Parking History</h1>
        <p>View all past parking records</p>
      </div>
      <div class="page-head__actions">
        <button class="btn btn--ghost" id="exportCsv">${icon('#i-download')}Export CSV</button>
      </div>
    </div>

    <section class="card">
      <div class="card__body" style="border-bottom:1px solid var(--border)">
        <div class="search-row">
          <span class="search-box">
            ${icon('#i-search')}
            <input class="input" id="histSearch" placeholder="Search by vehicle number or ticket ID"
                   autocomplete="off">
          </span>
          <select class="select" id="histStatus" style="width:auto;min-width:150px"
                  aria-label="Filter by status">
            <option value="">All sessions</option>
            <option value="ACTIVE">Active</option>
            <option value="COMPLETED">Completed</option>
          </select>
          <label class="sr-only" for="histFrom">From date</label>
          <input class="input" id="histFrom" type="date" style="width:auto" aria-label="From date">
          <span class="cell-muted">to</span>
          <label class="sr-only" for="histTo">To date</label>
          <input class="input" id="histTo" type="date" style="width:auto" aria-label="To date">
          <button class="btn btn--subtle btn--sm" id="clearHist">Clear</button>
        </div>
      </div>
      <div id="histBody">${loadingState(6)}</div>
    </section>

    <div id="ticketDetail" style="margin-top:16px"></div>`;

  const body = container.querySelector('#histBody');
  const detail = container.querySelector('#ticketDetail');
  const searchInput = container.querySelector('#histSearch');
  const statusSelect = container.querySelector('#histStatus');
  const fromInput = container.querySelector('#histFrom');
  const toInput = container.querySelector('#histTo');

  searchInput.value = state.search;
  statusSelect.value = state.status;
  fromInput.value = state.fromDate;
  toInput.value = state.toDate;

  function queryParams() {
    const params = {};
    if (state.search) params.search = state.search;
    if (state.status) params.status = state.status;

    const from = dateInputToStartTimestamp(state.fromDate);
    const to = dateInputToEndTimestamp(state.toDate);
    if (from) params.from = from;
    if (to) params.to = to;
    return params;
  }

  async function load() {
    body.innerHTML = loadingState(6);
    try {
      const data = await api.history({
        ...queryParams(), limit: PAGE_SIZE, offset: state.offset,
      });
      draw(data);
    } catch (problem) {
      body.innerHTML = errorState(problem.message);
      body.querySelector('[data-retry]')?.addEventListener('click', load);
    }
  }

  function draw(data) {
    if (!data.tickets.length) {
      const filtered = state.search || state.status || state.fromDate || state.toDate;
      body.innerHTML = emptyState({
        title: filtered ? 'No records match' : 'No parking records yet',
        text: filtered
          ? 'Try a different search term, status or date range.'
          : 'Records appear here as soon as the first vehicle is checked in.',
        iconId: '#i-history',
        actionHtml: filtered
          ? '<button class="btn btn--ghost btn--sm" data-clear>Clear filters</button>'
          : '<button class="btn btn--primary btn--sm" data-navigate="entry">Check in a vehicle</button>',
      });
      body.querySelector('[data-clear]')?.addEventListener('click', clearFilters);
      return;
    }

    const rows = data.tickets.map((ticket, index) => {
      const active = ticket.status === 'ACTIVE';
      return [
        `<td class="cell-muted mono">${state.offset + index + 1}</td>`,
        `<td class="cell-strong">${escapeHtml(ticket.registrationNumber)}</td>`,
        `<td>${escapeHtml(vehicleTypeLabel(ticket.vehicleType))}</td>`,
        `<td class="cell-strong">${escapeHtml(ticket.slotId)}</td>`,
        `<td class="cell-muted">${escapeHtml(timeOnly(ticket.entryTime))}
           <div style="font-size:11.5px">${escapeHtml(dateTime(ticket.entryTime).split(',')[0])}</div></td>`,
        `<td class="cell-muted">${active ? '—' : escapeHtml(timeOnly(ticket.exitTime))}</td>`,
        `<td class="cell-muted">${active
            ? `${escapeHtml(duration(ticket.elapsedMinutes))} so far`
            : escapeHtml(duration(ticket.elapsedMinutes))}</td>`,
        `<td class="num cell-strong">${active ? '—' : escapeHtml(money(ticket.finalFeePaise))}</td>`,
        `<td>${badge(ticket.status)}</td>`,
        `<td><button class="btn btn--subtle btn--sm"
              data-view="${escapeHtml(ticket.ticketId)}">View</button></td>`,
      ];
    });

    const shownTo = Math.min(state.offset + data.tickets.length, data.total);
    const canPrev = state.offset > 0;
    const canNext = shownTo < data.total;

    body.innerHTML = `
      ${dataTable(
        [
          { label: '#' }, { label: 'Vehicle No.' }, { label: 'Type' }, { label: 'Slot' },
          { label: 'Entry Time' }, { label: 'Exit Time' }, { label: 'Duration' },
          { label: 'Fee', className: 'num' }, { label: 'Status' }, { label: '' },
        ],
        rows,
      )}
      <div class="pager">
        <span>Showing ${state.offset + 1}–${shownTo} of ${data.total}</span>
        <span class="pager__spacer">
          <button class="btn btn--ghost btn--sm" id="prevPage" ${canPrev ? '' : 'disabled'}>Previous</button>
          <button class="btn btn--ghost btn--sm" id="nextPage" ${canNext ? '' : 'disabled'}>Next</button>
        </span>
      </div>`;

    body.querySelector('#prevPage')?.addEventListener('click', () => {
      state.offset = Math.max(0, state.offset - PAGE_SIZE);
      load();
    });
    body.querySelector('#nextPage')?.addEventListener('click', () => {
      state.offset += PAGE_SIZE;
      load();
    });

    body.querySelectorAll('[data-view]').forEach((button) => {
      button.addEventListener('click', () => {
        const ticket = data.tickets.find((item) => item.ticketId === button.dataset.view);
        showTicket(ticket);
      });
    });
  }

  function showTicket(ticket) {
    detail.innerHTML = `
      <section class="card">
        <div class="card__head">
          <div><h2>Ticket Details</h2></div>
          <div class="card__head-actions">
            ${ticket.status === 'ACTIVE'
              ? `<button class="btn btn--primary btn--sm"
                   data-navigate="exit?query=${encodeURIComponent(ticket.ticketId)}">
                   ${icon('#i-exit')}Process exit</button>`
              : ''}
            <button class="btn btn--subtle btn--sm" id="closeTicket">${icon('#i-close')}Close</button>
          </div>
        </div>
        <div class="card__body">${ticketPanel(ticket)}</div>
      </section>`;

    detail.querySelector('[data-print-ticket]')?.addEventListener('click', () => printTicket(ticket));
    detail.querySelector('#closeTicket').addEventListener('click', () => { detail.innerHTML = ''; });
    detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function clearFilters() {
    state.search = '';
    state.status = '';
    state.fromDate = '';
    state.toDate = '';
    state.offset = 0;
    searchInput.value = '';
    statusSelect.value = '';
    fromInput.value = '';
    toInput.value = '';
    load();
  }

  // Typing filters as you go, without a request on every keystroke.
  let typingTimer = null;
  searchInput.addEventListener('input', () => {
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
      state.search = searchInput.value.trim();
      state.offset = 0;
      load();
    }, 280);
  });

  statusSelect.addEventListener('change', () => {
    state.status = statusSelect.value;
    state.offset = 0;
    load();
  });

  [fromInput, toInput].forEach((input) => {
    input.addEventListener('change', () => {
      state.fromDate = fromInput.value;
      state.toDate = toInput.value;
      if (state.fromDate && state.toDate && state.toDate < state.fromDate) {
        toast('Check the date range', 'The "to" date is before the "from" date.', 'warn');
        return;
      }
      state.offset = 0;
      load();
    });
  });

  container.querySelector('#clearHist').addEventListener('click', clearFilters);

  container.querySelector('#exportCsv').addEventListener('click', () => {
    // The browser downloads straight from the server, so the file always
    // matches the filter the server itself applies.
    const url = api.historyCsvUrl(queryParams());
    const link = document.createElement('a');
    link.href = url;
    link.download = 'parkwise-history.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    toast('Export started', 'The CSV contains every row matching the current filter.', 'ok');
  });

  await load();

  return () => clearTimeout(typingTimer);
}
