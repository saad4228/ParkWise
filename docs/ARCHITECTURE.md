# ParkWise architecture

This document explains what each class is responsible for and, more usefully,
*why* the design is shaped the way it is. The README has the quick overview;
this is the longer version.

---

## The one rule the design is built around

> The C++ backend is the single source of truth. The browser displays what it
> is told and decides nothing.

Everything else follows from that. The frontend has no copy of the slot list it
can edit, no fee calculation, no idea which slot is free. It asks, it renders,
and after any change it re-reads the authoritative state.

---

## Layers

```
frontend/  ──►  ApiServer  ──►  ParkingLot  ──►  FileManager  ──►  data/*.json
                                    │
                                    ├── ParkingSlot, ParkingTicket,
                                    │   Reservation, QueueManager, Vehicle
                                    ├── BillingService      (pure calculation)
                                    └── ParkingSettings
                              ReportService (reads ParkingLot, changes nothing)
                              JsonCodec     (objects ⇄ JSON, used by both ends)
```

Dependencies only ever point right. `ParkingLot` knows nothing about HTTP;
`FileManager` knows nothing about parking.

---

## Class by class

### `Vehicle`, `Car`, `Bike`, `Suv`

A vehicle as the operator typed it: plate, optional owner name and contact
number — and, from the subclass, what kind of vehicle it is.

`Vehicle` is abstract. Two things differ between kinds, and both are declared
pure virtual so that each subclass must answer:

```cpp
virtual VehicleType type() const = 0;
virtual Paise hourlyRate(const ParkingSettings& settings) const = 0;
```

The subclasses are three lines each, inheriting the base constructor with
`using Vehicle::Vehicle`. The destructor is `virtual` because vehicles are
owned through `std::unique_ptr<Vehicle>`.

**Why this replaced an enum and a switch.** The rate used to come from
`ParkingSettings::rateFor(VehicleType)`. That put the question in the wrong
object: the settings had to know about every kind of vehicle that exists, and
a new kind meant editing a function unrelated to it. `ParkingLot::startSession`
now asks the vehicle itself, and `rateFor` is gone.

What it did not do is remove every `switch` on vehicle type — the JSON codec
still parses the string `"SUV"`, and the UI still lists three options. Those
sit at the edges where the program meets stored text and a person.
`Vehicle::create(...)` is the single factory that turns a stored `VehicleType`
back into an object, and it is deliberately the only such `switch` left in the
vehicle code.

Its static helpers matter as much as the objects themselves:

```cpp
static std::string normalizeRegistration(const std::string& raw);
static bool isValidRegistration(const std::string& normalized);
```

Having exactly one definition of "what counts as a registration number" is what
makes `mh 12-ab 1234` and `MH12AB1234` the same vehicle on every screen, in the
queue, and in a reservation.

**A bug this caught.** Normalisation originally happened only in `ApiServer`.
A test that checked in a vehicle twice — once lowercase — was allowed through
and reported `LOT_FULL` instead of `DUPLICATE_ACTIVE_REGISTRATION`, because
`ParkingLot` was comparing `"mh12ab1234"` against the stored `"MH12AB1234"`.
The fix was to normalise inside `ParkingLot`'s own entry points, so the rule
holds no matter who calls it. A validation rule that lives only in the layer
above the one enforcing it is not really a rule.

### `ParkingSlot`

One physical space: its ID, the vehicle type it takes, whether something is
standing in it, and the ticket of whatever that is.

It deliberately **knows nothing about reservations**. A slot cannot answer "am
I reserved?" because that depends on the booking list and the current time,
neither of which it can see. `ParkingLot` answers it instead. Keeping that out
of `ParkingSlot` is what stops occupancy and booking state from being two
copies of the same idea that can disagree.

### `ParkingTicket`

One session, entry to exit.

Two decisions worth noting:

- **The hourly rate is copied onto the ticket at entry.** This single field is
  the whole mechanism by which a later price change leaves older bills alone.
  Nothing else in the system has to remember to do anything.
- **`complete()` returns `bool`.** It refuses a second call. A repeated
  checkout is therefore impossible by construction, not merely checked for in
  the route handler.

### `Reservation`

A booking over a half-open interval `[start, end)`.

```cpp
bool overlaps(Timestamp otherStart, Timestamp otherEnd) const {
    return startTime_ < otherEnd && otherStart < endTime_;
}
```

Half-open intervals are the reason a booking ending at 3pm and one starting at
3pm do not clash — which is the behaviour anyone would expect, and which falls
out of the comparison rather than needing a special case.

`cancel()`, `expire()`, `checkIn()` and `complete()` each return `false` when
called from a state they may not leave. Invalid transitions are refused by the
object, not policed by its callers.

### `QueueManager`

The waiting list, in arrival order.

**Why not `std::queue`?** Because a strict FIFO cannot do the two things this
queue must do:

1. **Scan past an incompatible vehicle.** If a car space opens and the oldest
   waiter is a bike, leaving the space empty would be worse than serving the
   car behind it. `findNextCompatible(VehicleType)` walks the list in arrival
   order and returns the first match.
2. **Cancel from the middle.** An operator must be able to remove any waiting
   vehicle, not just the one at the front.

A `std::vector` in arrival order gives FIFO ordering for free while supporting
both. The brief explicitly allows this, and the reason is written in the header.

### `BillingService`

All static, because billing has no state:

```cpp
static long long billableHours(long long durationMinutes) {
    if (durationMinutes <= 0) return 0;
    return (durationMinutes + 59) / 60;   // ceiling division
}
```

Integer ceiling division rather than `std::ceil` on a `double`: exact, and no
floating point anywhere near money.

Everything that needs a fee goes through here — `ParkingTicket::complete`, the
live estimate on screen, and the tests. There is exactly one formula.

### `ParkingSettings`

A plain struct with the rates, the grace period and the currency, plus
`isValid()`. Lives in its own header so that `FileManager` and `ParkingLot` can
both use it without including each other.

### `ParkingLot` — the central class

Owns all state and is the only thing allowed to change it.

```cpp
struct LotState {
    ParkingSettings settings;
    std::vector<ParkingSlot> slots;
    std::vector<ParkingTicket> tickets;     // active and completed together
    std::vector<Reservation> reservations;
    QueueManager queue;
};
```

**Why one vector for all tickets?** Active and completed sessions could have
been kept in separate containers, but then a checkout would have to move a
record between them, and two containers would be two places for the truth about
a ticket to live. One vector with a status field cannot disagree with itself,
and history, lookup and reporting all become a single pass.

**Why `LotState` is a struct.** So an operation can copy the whole thing before
it starts and restore it if the save fails:

```cpp
Result ParkingLot::commitOrRollback(const LotState& previousState) {
    std::string error;
    if (!fileManager_.save(toStoredData(), error)) {
        state_ = previousState;
        return Result::failure("PERSISTENCE_FAILED", "...has been undone. " + error);
    }
    return Result::success();
}
```

Copying a few thousand small records is cheap, and it buys a guarantee that is
otherwise fiddly to get right: **a success reply always means the records are
on disk.** There is a test that blocks the write and checks that the vehicle
has no session afterwards, in memory as well as on disk.

**The derived display state** lives here because it needs both the slot and the
booking list:

```cpp
SlotDisplayState ParkingLot::displayStateOf(const ParkingSlot& slot) const {
    if (slot.isOccupied())                return SlotDisplayState::OCCUPIED;
    if (holdFor(slot.id()) != nullptr)    return SlotDisplayState::RESERVED;
    return SlotDisplayState::AVAILABLE;
}
```

**A second bug, found by reading the call sites.** `offerSlotToQueue()` had
exactly one caller: `checkOut()`. But a checkout is not the only way a slot
becomes usable — a booking can be **cancelled**, a booking can **expire**, and
Settings can **add capacity**. In all three cases a vehicle sat in the queue
while a slot it could have used stood empty, and the Waiting Queue screen
cheerfully showed "1 waiting" next to "1 available slot". Worse, a *different*
vehicle asking to queue was told `SLOT_AVAILABLE` — park it instead — while the
one already in line was ignored.

The fix is `offerFreeSlotsToQueue()`, which walks the slots and offers each
usable one to the oldest compatible waiter, plus a call to it from each of the
three paths. `expireLapsedReservations()` runs it unconditionally, which makes
the per-request sweep the safety net for the whole waiting list: however a slot
came to be free, the next screen refresh admits whoever was waiting for it.

The lesson is about where a rule lives. "A waiting vehicle implies no
compatible slot is free" is an invariant of the system, but it was only being
enforced at one of the four places that could break it.

**A bug this structure caught.** `startSession()` used to cancel any waiting
queue request for the same plate — sensible when a vehicle walks in while also
queued. But `offerSlotToQueue()` called `startSession()` and *then* tried to
mark the request `ASSIGNED`, which failed because the request had just been
cancelled. The fix was to give the cleanup its own named method,
`cancelWaitingRequestFor()`, called only from the two paths that need it. A
helper doing a second job quietly is a helper that will surprise someone.

### `ReportService`

Read-only summaries, history filtering and CSV generation.

Separate from `ParkingLot` because it never changes anything — it only counts
and groups what `ParkingLot` already holds. Keeping it apart stops the central
class from growing a second personality.

**The one subtlety:** it uses two different moments on purpose.

- A session is counted on the day it **entered** — that is what "vehicles
  served" means.
- Its money is counted on the day it **checked out** — that is when the money
  was taken.

A vehicle still parked therefore adds to the vehicle count and nothing to
revenue. The Reports screen says this in plain words rather than leaving it to
be guessed.

### `JsonCodec`

Translates objects to and from JSON.

It exists so there is **one** description of what a ticket looks like as JSON,
shared by saving to disk and by answering the browser. Without it, those two
descriptions would drift apart the first time a field was added.

Every read function returns `bool` and fills an error message rather than
throwing, so one bad record can be reported precisely instead of taking the
program down.

### `FileManager`

Reads and writes the four data files. Makes no business decisions.

Two rules protect the operator's records:

1. **A missing file is fine** — a first run.
2. **A file that exists but cannot be read is a hard failure.** The program
   refuses to start rather than beginning blank and then saving over it. An
   empty file counts as damaged, not as "all records deleted", because a crash
   during a write looks exactly like an empty file.

Saving happens in two passes:

```cpp
for (const auto& file : files)  if (!writeTempFile(...))  { cleanup; return false; }
for (const auto& file : files)  if (!commitTempFile(...)) { cleanup; return false; }
```

Nothing already on disk is touched during pass one, so a disk problem is almost
always caught while the previous records are still intact. Pass two keeps a
`.bak` of each file before replacing it.

### `ApiServer`

HTTP routes. Parses requests into plain values, calls `ParkingLot`, formats the
answer, maps `Result::errorCode` onto a status code.

It contains **no parking logic**. The clearest evidence is that it has no
arithmetic in it at all — the fee it reports is whatever `ParkingLot` returned.

**One mutex, every request:**

```cpp
std::lock_guard<std::mutex> guard(stateLock_);
```

`cpp-httplib` answers on several threads. Serialising state-changing work is
the simplest correct answer to "two rapid requests try to claim the same slot",
and for a single-facility tool the throughput cost is irrelevant. The
alternative — fine-grained locking inside `ParkingLot` — would be more code and
more ways to be wrong.

---

## Request lifecycle

Checking a vehicle out, end to end:

1. **Browser** — `exit.js` calls `api.vehicleExit(ticketId)`. It sends no fee.
2. **ApiServer** — takes the lock, reads `ticketId`, calls
   `parkingLot_.checkOut(ticketId, now, outcome)`.
3. **ParkingLot** —
   - copies `state_` for rollback;
   - sweeps lapsed reservations;
   - rejects an unknown or already-completed ticket;
   - `ticket->complete(now)`, which uses `BillingService` and the rate stored on
     the ticket;
   - releases the slot;
   - marks the originating reservation `COMPLETED` if there was one;
   - offers the freed slot to the queue — unless a booking is holding it;
   - offers any other slot freed by the expiry sweep to the queue as well;
   - saves, or restores the copy and fails.
4. **ApiServer** — formats the outcome, including any `queueAssignment`, and the
   refreshed summary counts.
5. **Browser** — shows the completed ticket, toasts the amount, and toasts again
   if a waiting vehicle took the slot.

The fee the operator sees is calculated once, by step 3, after every check has
passed.

---

## Frontend structure

Plain ES modules, no framework and no build step.

| File | Responsibility |
|---|---|
| `app.js` | Hash routing, nav state, collapsible menu, theme, global search, live status, queue badge |
| `api.js` | Every call to the server; throws `ApiError` carrying the server's own code and message |
| `ui.js` | Shared components: stat cards, badges, tables, toasts, the confirm dialog, freshness line |
| `facility.js` | The top-down car park: derives rows from slot ids, draws bays and vehicles, zoom, filters, keyboard movement, hover card |
| `format.js` | Money, dates, durations, HTML escaping, datetime-local conversion |
| `ticket.js` | The ticket panel and the print view |
| `pages/*.js` | One module per screen, each exporting `render(container, ctx)` |

Each page module returns an optional cleanup function, which the router calls
before replacing the screen — that is how the auto-refresh timers on Dashboard,
Slots and Queue are stopped, and how the map removes its hover card.

### The facility map

The dashboard and Parking Slots share one map, built in `facility.js`. It is
real buttons laid out with CSS, not a picture, so every bay can be hovered,
focused, selected and read aloud, and it redraws from whatever the server last
sent.

**The layout is derived, never invented.** The data holds no positions, so
the map reads them from slot ids: leading letters name the row, the number
orders the bay, rows pair up across a driving aisle, and a row longer than
sixteen wraps. `buildLayout()` is a plain function over the slot list, which
keeps those rules in one place where they can be read and explained.

**Zoom re-lays the map out rather than scaling it.** Every dimension is a
multiple of a `--zoom` custom property, so the scrollbars stay accurate and
the bays stay crisp. "Fit" measures the drawn rows and scales to the window.

**Filters dim rather than hide.** On a map, where a bay *is* matters, so
filtering by type, status or plate fades the rest instead of collapsing the
layout. Choosing a row is the exception: that is a request to look at one row.

**Keyboard.** The whole map is a single tab stop. Left and Right move along a
row; Up and Down jump to the nearest bay across the aisle, judged by where the
bays actually sit on screen, since rows can differ in length.

**Colour means state, and nothing else, on this screen.** Vehicles are painted
neutral, the hourly-traffic chart is grey and tells arrivals from departures by
sitting above or below its axis, and the three state colours were validated as
a set against both themes. A bay whose state changed since it was last on
screen pulses once, which is how a check-in made at the barrier is noticed on
the dashboard.

**Keyboard and focus.** The shell does four things that only matter if you are
not using a mouse, and each was something the markup already implied but did
not do:

- A skip link jumps past the nine navigation items to the content.
- Changing screen moves focus into `<main>`, which is what its `tabindex="-1"`
  was there for.
- The confirmation dialog traps Tab, and a **destructive** one opens with
  *Cancel* focused so a stray Enter cannot delete anything.
- The slot grid is one tab stop with arrow-key movement inside it, instead of
  fifty stops between the filters and the rest of the page.

**Three habits that keep the UI honest:**

- `withBusyButton` disables a button and shows a spinner for the duration of a
  request, which is what prevents double submission.
- A failed request **never clears the form**. The operator's typing survives so
  they can correct it. A screen that refreshes on a timer must not clear it
  either: Waiting Queue used to rebuild its whole body every 45 seconds,
  including the "Add to Queue" form, so a plate being typed at the barrier
  vanished. That screen now builds its form once and redraws only the stat
  cards and the tables. Parking Slots has the same shape of problem in a milder
  form — it redraws its grid on a timer — and carries the focused field and
  cursor position across the redraw instead.
- The error shown is always the server's own message. The UI does not invent
  explanations, and it never shows a success it did not receive.

### Styling

Every colour, radius and spacing step is a CSS custom property on `:root`. The
dark theme re-declares the same variables under `[data-theme="dark"]` — no
component rule is written twice.

Slot state is carried by colour **and** by a glyph (a vehicle for occupied, a
clock for reserved, a ring for free) **and** by the `title`/`aria-label`, so
colour is never the only signal.

**The logo is vector art, not a pasted image.** `frontend/assets/` holds the
mark on its own, the full lockup in a light and a dark version, and a favicon.
Redrawing the supplied logo as SVG rather than cropping the artwork means it
stays sharp from a 16px browser tab to a printed ticket, weighs about 2KB, and
can be placed on any background.

Three decisions worth recording:

- **The wordmark is live text, not part of the artwork.** In the sidebar and on
  the ticket, "ParkWise" is real HTML, so it stays selectable and searchable,
  renders crisply at any zoom, and lets "Park" follow the theme while "Wise"
  keeps the brand green. The green is a stop taken from the mark's own
  gradient, chosen so it clears 3:1 against the sidebar behind it — 4.4:1 in
  the light theme, 8.9:1 in the dark one.
- **The favicon is the mark on a brand tile**, with the shape reversed out in
  white. The open mark is the right logo at 34px in the sidebar, but a browser
  tab draws it at 16px, where the thin road and its dashes close up. The tile
  is the same treatment the logo sheet uses for app icons.
- **The sprite is hidden with `position:absolute;width:0`, not `display:none`.**
  A gradient inside a `display:none` subtree is not reliably resolvable from a
  `<use>` elsewhere on the page: the logo drew its solid shapes and silently
  skipped its two gradient-filled ones. The interface icons never showed this,
  because they take `currentColor` and reference no paint server.

**Chart colours are chosen, not picked.** The three vehicle types and the
revenue bars take their colours from `--chart-car`, `--chart-bike`,
`--chart-suv` and `--chart-revenue` rather than reusing the interface palette.
Each set was checked against the card it sits on for lightness, contrast, and
separation from its neighbours under the common forms of colour blindness.

Two things came out of running that check rather than eyeballing it:

- **Car blue and SUV violet were nearly the same colour** to a deuteranope, and
  only just distinguishable for everyone else. They sit next to each other in
  the donut, so SUV was re-stepped to a crimson.
- **The revenue bars were Car's blue**, which made a chart about money look
  like a chart about cars when the two sat side by side. Revenue is a
  magnitude, not one of the vehicle types, so it gets a hue nothing else uses.

The dark theme defines its own three rather than flipping the light ones: the
green that reads well on a white card is out of range on a dark one. The donut
also leaves a two-pixel gap between neighbouring arcs and writes the count and
percentage in the legend, so the chart never depends on telling colours apart.

**Inline styles and media queries.** Three screens set
`grid-template-columns` as an inline `style` attribute to get a narrow-first
split. An inline style outranks any selector, so the
`@media (max-width: 1100px)` rule that collapses `.layout-split` to one column
could not touch them, and those pages stayed two columns wide on a phone and
scrolled sideways. They now use a `.layout-split--aside-first` class, which the
media query can override. The general point: a one-off inline style is a
quiet way to opt out of the responsive rules.

**A bug worth recording.** `.dialog-host` had `display: grid` and relied on the
`hidden` attribute to stay out of the way. An author `display` rule beats the
browser's styling for `[hidden]`, so an invisible full-screen overlay sat on
top of the page and swallowed every click. The fix is one line:

```css
[hidden] { display: none !important; }
```

It was found by a browser test that could not click a button, not by looking at
the page — the overlay was invisible.
