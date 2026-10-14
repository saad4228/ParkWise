# ParkWise HTTP API

Base URL: `http://127.0.0.1:8080/api`

All requests and responses are JSON, except the CSV export. Timestamps are
Unix epoch **seconds**. Money is in **paise** (₹40.00 is `4000`).

## Conventions

| Status | Meaning |
|---|---|
| `200 OK` | The read or operation succeeded |
| `201 Created` | A ticket, reservation or queue request was created |
| `400 Bad Request` | The request itself is malformed or a value is invalid |
| `404 Not Found` | No such ticket, reservation, queue request or slot |
| `409 Conflict` | The request clashes with the current state of the facility |
| `500 Internal Server Error` | An unexpected failure, including a failed save |

Every failure uses the same shape:

```json
{ "error": { "code": "LOT_FULL", "message": "No free slot for a CAR right now. ..." } }
```

### Error codes

| Code | Status | When |
|---|---|---|
| `INVALID_JSON` | 400 | The body is not a JSON object |
| `MISSING_FIELD` | 400 | A required field is absent |
| `INVALID_REGISTRATION` | 400 | Plate is not 4–15 letters and digits with at least one of each |
| `INVALID_CONTACT` | 400 | Contact number contains unexpected characters |
| `INVALID_OWNER_NAME` | 400 | Owner name is over 60 characters or contains a control character |
| `INVALID_VEHICLE_TYPE` | 400 | Not `BIKE`, `CAR` or `SUV` |
| `INVALID_INTERVAL` | 400 | End at or before start, in the past, or longer than 7 days |
| `INVALID_SETTINGS` | 400 | A rate, grace period or slot ID is not acceptable |
| `INVALID_QUERY` | 400 | A query parameter is not usable |
| `TICKET_NOT_FOUND` | 404 | No such ticket |
| `RESERVATION_NOT_FOUND` | 404 | No such reservation |
| `QUEUE_REQUEST_NOT_FOUND` | 404 | No such queue request |
| `SLOT_NOT_FOUND` | 404 | No such slot |
| `DUPLICATE_ACTIVE_REGISTRATION` | 409 | That vehicle is already parked |
| `DUPLICATE_QUEUE_REQUEST` | 409 | That vehicle is already waiting |
| `DUPLICATE_RESERVATION` | 409 | That vehicle already has an overlapping booking |
| `DUPLICATE_SLOT_ID` | 409 | Two slots share an ID |
| `TICKET_ALREADY_COMPLETED` | 409 | That session was already checked out |
| `LOT_FULL` | 409 | No compatible slot is free — the queue can be offered |
| `NO_COMPATIBLE_SLOT` | 409 | The layout has no slots of that type at all |
| `NO_SLOT_AVAILABLE` | 409 | No slot can be booked for that interval |
| `RESERVATION_CONFLICT` | 409 | The slot is already booked over part of that interval |
| `SLOT_TYPE_MISMATCH` | 409 | The slot does not take that vehicle type |
| `SLOT_OCCUPIED` | 409 | A vehicle is in the slot |
| `SLOT_IN_USE` | 409 | The slot cannot be changed while occupied |
| `SLOT_RESERVED` | 409 | The slot cannot be changed while a booking holds it |
| `SLOT_AVAILABLE` | 409 | Queueing refused because a slot is actually free |
| `INVALID_RESERVATION_STATE` | 409 | The booking is not in a state that allows this |
| `RESERVATION_NOT_STARTED` | 409 | Too early to check in |
| `RESERVATION_WINDOW_PASSED` | 409 | The grace period has run out |
| `REGISTRATION_MISMATCH` | 409 | The plate does not match the booking |
| `INVALID_QUEUE_STATE` | 409 | The request is no longer waiting |
| `DEMO_READ_ONLY` | 403 | A public demo refuses settings changes and backups |
| `PERSISTENCE_FAILED` | 500 | The change could not be saved, and was undone |
| `DATA_INCONSISTENT` | 500 | Saved records contradict each other (startup only) |

---

## Dashboard and slots

### `GET /dashboard`

```json
{
  "serverTime": 1791542324,
  "currency": "INR",
  "summary": {
    "totalSlots": 50, "availableSlots": 27, "occupiedSlots": 20,
    "reservedSlots": 3, "waitingCount": 0, "todayRevenuePaise": 43000
  },
  "slots": [ /* slot views, see below */ ],
  "recentActivity": [
    { "kind": "EXIT", "ticketId": "PW-TMMYWK-CDWS", "registrationNumber": "HR06KS3067",
      "vehicleType": "SUV", "slotId": "D04", "time": 1791541124,
      "source": "WALK_IN", "feePaise": 30000 }
  ],
  "upcomingReservations": [ /* reservation views */ ],
  "queue": [ /* waiting queue request views */ ],
  "hourlyTraffic": [
    { "hour": 0, "entries": 0, "exits": 0 },
    { "hour": 9, "entries": 7, "exits": 2 }
    /* ...always 24 rows, hour 0 to 23 */
  ]
}
```

`recentActivity` holds at most 8 entries, newest first. An `ENTRY` has
`feePaise: null`.

`hourlyTraffic` covers today in the server's local time and always has 24
rows, so the chart keeps a fixed shape on a quiet day. A session counts as an
arrival in the hour it entered and as a departure in the hour it left, so one
session can appear in two rows. A vehicle still parked is not a departure.
`upcomingReservations` holds at most 5; five means "five or more".

### `GET /slots`

`{ "serverTime", "summary", "slots": [...] }`

**Slot view:**

```json
{
  "slotId": "A01",
  "supportedVehicleType": "CAR",
  "occupied": true,
  "displayState": "OCCUPIED",
  "ticket": {
    "ticketId": "PW-...", "registrationNumber": "MH12AB1234", "vehicleType": "CAR",
    "ownerName": "Rahul Deshmukh", "entryTime": 1791538724, "elapsedMinutes": 60,
    "estimatedFeePaise": 3000, "hourlyRatePaise": 3000
  },
  "reservation": null
}
```

`displayState` is `AVAILABLE`, `OCCUPIED` or `RESERVED`. `ticket` is `null`
unless a vehicle is parked; `reservation` is `null` unless an upcoming booking
holds the slot. Both can be non-null at once: a parked vehicle with a booking
waiting for the same space.

### `GET /slots/{id}`

`{ "serverTime", "slot": { ... } }` or `404 SLOT_NOT_FOUND`.

---

## Vehicle entry and exit

### `POST /vehicles/entry`

```json
{ "registrationNumber": "MH12AB1234", "vehicleType": "CAR",
  "ownerName": "Sample Owner", "contactNumber": "+91 98765 43210" }
```

`ownerName` and `contactNumber` are optional. The plate is normalised by the
server — `"mh 12-ab 1234"` and `"MH12AB1234"` are the same vehicle.

**`201 Created`:**

```json
{ "ticketId": "PW-TMMYWK-CDWS", "registrationNumber": "MH12AB1234",
  "slotId": "A01", "entryTime": 1791542324, "status": "ACTIVE",
  "ticket": { /* full ticket view */ }, "summary": { /* updated counts */ } }
```

Fails with `INVALID_REGISTRATION`, `INVALID_CONTACT`,
`DUPLICATE_ACTIVE_REGISTRATION`, `LOT_FULL` or `NO_COMPATIBLE_SLOT`.

### `POST /vehicles/exit`

```json
{ "ticketId": "PW-TMMYWK-CDWS" }
```

**`200 OK`:**

```json
{
  "ticketId": "PW-TMMYWK-CDWS", "slotId": "A01",
  "exitTime": 1791550124, "durationMinutes": 130,
  "billableHours": 3, "hourlyRatePaise": 4000, "finalFeePaise": 12000,
  "status": "COMPLETED",
  "queueAssignment": {
    "requestId": "QR-...", "registrationNumber": "MH14CD5678",
    "vehicleType": "CAR", "slotId": "A01", "ticketId": "PW-..."
  },
  "ticket": { /* completed ticket view */ },
  "summary": { /* updated counts */ }
}
```

`queueAssignment` is `null` when nobody suitable was waiting. When it is
present, the released slot went straight to that vehicle and is **not**
available — the browser uses this to colour the grid correctly.

The fee is always calculated by the server at the moment of checkout. A fee
sent by the client is ignored.

Fails with `TICKET_NOT_FOUND` or `TICKET_ALREADY_COMPLETED`.

### `GET /tickets/lookup?query=`

Accepts a ticket ID or a registration number. Returns an exact ticket ID match
first, then the vehicle's active session, then its most recent finished one —
so a vehicle that already left produces "already checked out" rather than
"not found".

### `GET /tickets/{id}`

`{ "serverTime", "ticket": { ... } }`

**Ticket view** — the stored record plus three derived fields:

```json
{
  "ticketId": "PW-...", "registrationNumber": "MH12AB1234", "vehicleType": "CAR",
  "ownerName": "", "contactNumber": "", "slotId": "A01",
  "entryTime": 1791542324, "exitTime": 0,
  "hourlyRatePaise": 3000, "billableHours": 0, "finalFeePaise": 0,
  "status": "ACTIVE", "source": "WALK_IN",
  "elapsedMinutes": 42, "estimatedFeePaise": 3000, "isActive": true,
  "slotVehicleType": "CAR"
}
```

`elapsedMinutes` and `estimatedFeePaise` are recalculated on every request and
never stored. `source` is `WALK_IN`, `RESERVATION` or `QUEUE`.

---

## Reservations

### `GET /reservations?status=`

Optional `status` filter: `UPCOMING`, `CHECKED_IN`, `COMPLETED`, `CANCELLED`,
`EXPIRED`. Newest start time first.

**Reservation view:**

```json
{
  "reservationId": "RS-...", "registrationNumber": "MH12AB1234",
  "vehicleType": "CAR", "slotId": "A01",
  "startTime": 1791606600, "endTime": 1791613800, "createdAt": 1791542324,
  "status": "UPCOMING", "ticketId": "",
  "graceDeadline": 1791608400, "canCheckIn": false, "canCancel": true
}
```

`graceDeadline` is `min(startTime + grace, endTime)`.

### `POST /reservations`

```json
{ "registrationNumber": "MH12AB1234", "vehicleType": "CAR",
  "startTime": 1791606600, "endTime": 1791613800, "preferredSlotId": "A01" }
```

`preferredSlotId` may be omitted or empty, in which case the server picks the
first eligible slot.

**`201 Created`:**

```json
{ "reservationId": "RS-...", "slotId": "A01", "status": "UPCOMING",
  "startTime": 1791606600, "endTime": 1791613800,
  "reservation": { ... }, "summary": { ... } }
```

Fails with `INVALID_REGISTRATION`, `INVALID_INTERVAL`, `DUPLICATE_RESERVATION`,
`SLOT_NOT_FOUND`, `SLOT_TYPE_MISMATCH`, `SLOT_OCCUPIED`,
`RESERVATION_CONFLICT` or `NO_SLOT_AVAILABLE`.

### `POST /reservations/{id}/cancel`

No body. `200 OK` with the updated reservation. Only an `UPCOMING` booking can
be cancelled.

Cancelling releases the slot the booking was holding. If a vehicle is waiting
in the queue for a slot of that type it is admitted immediately, and the reply
says so:

```json
{
  "reservationId": "RS-TMULCT-YL96",
  "status": "CANCELLED",
  "admittedFromQueue": [
    { "requestId": "QR-TMULCT-H08R", "registrationNumber": "MH88HH8888",
      "vehicleType": "CAR", "slotId": "A01", "ticketId": "PW-TMULCZ-1T1Z" }
  ],
  "summary": { "...": "refreshed counts" }
}
```

`admittedFromQueue` is an empty list when nobody was waiting. The slot can
therefore come back as `OCCUPIED` rather than `AVAILABLE`, which is why the
screen reports it instead of assuming the slot is free.

### `POST /reservations/{id}/check-in`

```json
{ "registrationNumber": "MH12AB1234" }
```

The plate is optional; when given it must match the booking. **`201 Created`:**

```json
{ "reservationId": "RS-...", "ticketId": "PW-...", "slotId": "A01",
  "entryTime": 1791606700, "status": "CHECKED_IN",
  "ticket": { ... }, "summary": { ... } }
```

Fails with `RESERVATION_NOT_FOUND`, `REGISTRATION_MISMATCH`,
`INVALID_RESERVATION_STATE`, `RESERVATION_NOT_STARTED`,
`RESERVATION_WINDOW_PASSED` or `DUPLICATE_ACTIVE_REGISTRATION`.

---

## Waiting queue

### `GET /queue`

`{ "serverTime", "requests": [...], "waitingCount", "summary" }`

**Queue request view:**

```json
{ "requestId": "QR-...", "registrationNumber": "MH14CD5678", "vehicleType": "CAR",
  "ownerName": "", "contactNumber": "", "arrivalTime": 1791542324,
  "status": "WAITING", "assignedSlotId": "", "assignedTicketId": "", "position": 1 }
```

`position` is the 1-based place among waiting requests, or `0` once assigned or
cancelled.

### `POST /queue`

Same body as vehicle entry. **`201 Created`** with `requestId`, `position`,
`request` and `summary`.

Refused with `SLOT_AVAILABLE` when a compatible slot is actually free — the
vehicle should simply be parked.

### `DELETE /queue/{id}`

`200 OK`. Only a `WAITING` request can be cancelled; anything else gives
`INVALID_QUEUE_STATE`.

---

## History, reports and export

### `GET /history`

| Parameter | Meaning |
|---|---|
| `search` | Matches part of a ticket ID or registration number, case-insensitive |
| `status` | `ACTIVE` or `COMPLETED` |
| `from`, `to` | Entry time range, `from` inclusive and `to` exclusive |
| `limit` | 1–500, default 50 |
| `offset` | Default 0 |

```json
{ "serverTime": 1791542324, "total": 107, "limit": 25, "offset": 0,
  "tickets": [ /* ticket views, newest entry first */ ] }
```

### `GET /reports`

Takes `from` and `to`.

```json
{
  "serverTime": 1791542324, "from": 1790380800, "to": 1791590400,
  "totalVehiclesServed": 107, "totalRevenuePaise": 510000,
  "completedSessions": 87, "activeSessions": 20,
  "averageDurationMinutes": 123,
  "peakEntryHour": 12, "peakEntryHourCount": 18,
  "revenueByDay": [ { "date": "2026-10-09", "revenuePaise": 43000, "completedSessions": 7 } ],
  "vehicleTypeDistribution": [ { "vehicleType": "CAR", "count": 55 } ]
}
```

Two different moments are used, deliberately:

- a session is **counted** on the day it *entered* — that is what "vehicles
  served" means;
- its money is **counted** on the day it *checked out* — that is when the money
  was actually taken.

A vehicle still parked therefore adds to the vehicle count but nothing to
revenue. `peakEntryHour` is `-1` when the range holds no entries.

### `GET /exports/history.csv`

Takes the same `search`, `status`, `from` and `to` as `/history`, and returns
every matching row — not just the current page. Served as
`text/csv; charset=utf-8` with a `Content-Disposition` attachment header.

The body begins with a UTF-8 byte-order mark (`EF BB BF`). Owner names may be
written in a local script, and without the mark a spreadsheet assumes the
system code page and mangles them.

Columns: Ticket ID, Registration Number, Vehicle Type, Slot ID, Entry Time,
Exit Time, Duration (minutes), Billable Hours, Hourly Rate (INR), Final Fee
(INR), Status, Source, Owner Name.

Fields containing a comma, a quote or a line break are wrapped in quotes with
inner quotes doubled, per the usual CSV convention. Times are local and
readable; money is a plain decimal so a spreadsheet can sum the column.

---

## Settings

### `GET /settings`

```json
{
  "serverTime": 1791542324,
  "settings": { "bikeHourlyRatePaise": 1000, "carHourlyRatePaise": 3000,
                "suvHourlyRatePaise": 5000, "reservationGraceMinutes": 30,
                "currency": "INR" },
  "slots": [ { "slotId": "A01", "supportedVehicleType": "CAR",
               "occupied": true, "reserved": false, "locked": true } ],
  "storage": { "totalRecords": 110, "ticketCount": 107, "reservationCount": 3,
               "queueCount": 0, "lastBackupTime": 0, "storedBytes": 50073 },
  "version": "1.0"
}
```

`locked` means the slot is occupied or held by a booking and cannot be removed
or re-typed. No filesystem path is ever returned.

### `PUT /settings`

```json
{
  "settings": { "bikeHourlyRatePaise": 1000, "carHourlyRatePaise": 9000,
                "suvHourlyRatePaise": 5000, "reservationGraceMinutes": 30,
                "currency": "INR" },
  "slots": [ { "slotId": "A01", "supportedVehicleType": "CAR" } ]
}
```

The `slots` list replaces the layout entirely, so send the full list. Occupancy
is preserved for slots that remain.

Added capacity is offered to the waiting queue, so the reply carries the same
`admittedFromQueue` list as a reservation cancellation — an empty list when
nobody was waiting.

Refused with `SLOT_IN_USE` or `SLOT_RESERVED` if the change would disturb a
parked vehicle or an upcoming booking, `DUPLICATE_SLOT_ID` for a repeated ID,
and `INVALID_SETTINGS` for a bad rate, grace period or slot ID. When a save is
refused, **nothing** changes.

New rates apply only to sessions starting afterwards. Tickets already issued
keep the rate captured when they were created.

### `GET /meta`

`200 OK` with `{ "demoMode": false, "resetMinutes": 30, "secondsUntilReset": -1,
"serverTime": 1792001672 }`.

What kind of copy of ParkWise this is. The browser asks once as it loads, so
the shell can show a **Demo** badge and the Settings screen can render itself
read-only rather than offering a Save the server would refuse.
`secondsUntilReset` is `-1` when the records are never reset.

### `POST /settings/backup`

`200 OK` with `{ "backedUpAt": 1791542324, "folderName": "backup-20261009-163000" }`.
Copies the four data files into `data/backups/<folderName>/`. Only the folder
name is returned; the full path stays on the server.

The ten most recent backup folders are kept; taking a new one removes the
oldest. A folder that cannot be removed does not fail the request — the backup
itself has already succeeded by that point.

## Demo mode

A copy started with `--demo` refuses two endpoints, whatever the browser shows:

| | |
|---|---|
| `PUT /settings` | `403` `DEMO_READ_ONLY` |
| `POST /settings/backup` | `403` `DEMO_READ_ONLY` |

Everything else — entry, exit, reservations, the queue — works normally, and
the records are restored to their start-up state every `--reset-minutes`.

The rule is applied in a pre-routing handler, before the routing table is
consulted, so it covers any route added later without being told about it.
