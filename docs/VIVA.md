# ParkWise — viva preparation

Questions an examiner is likely to ask, with answers you can give in your own
words. Each one points at the file to open if you are asked to show the code.

---

## The big picture

**Q. Explain your project in one minute.**

ParkWise manages a single parking facility. The interface runs in a browser —
plain HTML, CSS and JavaScript — but every parking decision is made by a C++17
backend that also serves the pages. The browser asks the server what to do and
displays the answer; it never allocates a slot or calculates a fee itself.
The main features are vehicle entry and exit with hourly billing, advance
reservations, a waiting queue, searchable history with CSV export, reports, and
JSON file storage that survives a restart.

**Q. Why a web interface for a C++ project?**

Because the brief asked for a professional interface, and HTML and CSS are a
far better tool for that than a console or a desktop GUI toolkit. It also forces
a clean separation: the C++ has to expose a proper API, which means the business
logic cannot get tangled up with printing to a screen. The same `ParkingLot`
class is driven by the HTTP server and by the test program, unchanged.

**Q. Walk me through what happens when a vehicle is checked out.**

The browser sends only the ticket ID — never a fee. `ApiServer` takes a lock
and calls `ParkingLot::checkOut`. That copies the current state for rollback,
expires any lapsed reservations, refuses an unknown or already-completed ticket,
calls `ticket->complete(now)` which bills using `BillingService` and the rate
stored on that ticket, frees the slot, offers the slot to the waiting queue
unless a booking is holding it, and then saves. If the save fails, the copied
state is restored and the operation reports failure. Only after a successful
save does the browser get a success reply.

---

## OOP

**Q. Which OOP concepts does this demonstrate?**

- **Abstraction** — `Vehicle` is an abstract base class: `type()` and
  `hourlyRate()` are pure virtual, so it cannot be instantiated.
- **Inheritance** — `Car`, `Bike` and `Suv` each derive from `Vehicle` and
  `override` both.
- **Polymorphism** — `ParkingLot::startSession` calls
  `vehicle.hourlyRate(settings)` without knowing which kind it holds.
- **Encapsulation** — every entity keeps its data private and exposes
  behaviour. `ParkingTicket::complete()` is the only way to close a ticket and
  it returns `false` on a second attempt, so a repeated checkout is impossible
  by construction.
- **Composition** — `ParkingLot` *has* slots, tickets, reservations, a
  `QueueManager` and a `ParkingSettings`.
- **Constructors** — entities are built valid. `ParkingTicket` has a second,
  named constructor, `fromStoredValues(...)`, for rebuilding from a saved
  record, which is a genuinely different job from creating a new session.
- **STL** — `std::vector` for the collections, `std::map` for grouping report
  rows by day, `std::set` for catching duplicate slot IDs, `std::mt19937_64`
  for ID generation.
- **File handling** — `std::ifstream` / `std::ofstream` in `FileManager`, with
  `std::filesystem` for the temp-file-then-rename save.

**Q. Show me the inheritance in this project.**

`Vehicle` in `include/Vehicle.h` is an abstract base class. It holds what every
vehicle shares — the registration number, the optional owner name and contact,
and the rules for validating them — and declares what differs as pure virtual:

```cpp
virtual VehicleType type() const = 0;
virtual Paise hourlyRate(const ParkingSettings& settings) const = 0;
```

`Car`, `Bike` and `Suv` each derive from it and `override` both. Because those
two functions are `= 0`, `Vehicle` cannot be created on its own — the compiler
refuses. Every vehicle in the car park is one of the three concrete kinds.

**Q. Where does the polymorphism actually happen?**

In `ParkingLot::startSession`, which is the one place a ticket is created:

```cpp
const Paise rate = vehicle.hourlyRate(state_.settings);
```

That line does not know whether it is holding a car, a bike or an SUV, and it
does not need to. The object answers for itself. `testVehicleKinds` in
`tests/test_main.cpp` proves it: it puts one of each into a
`std::vector<std::unique_ptr<Vehicle>>`, calls the same method on each, and
asserts three different rates come back.

**Q. Why is the destructor virtual?**

Because vehicles are owned through `std::unique_ptr<Vehicle>`. When that
pointer goes out of scope it deletes through a base-class pointer, and without
`virtual ~Vehicle()` only the base part would be destroyed. It is `= default`
because there is nothing extra to clean up — the declaration exists for
correctness, not for work.

**Q. It didn't start this way, did it?**

No, and that is worth saying plainly. The first version had `Vehicle` as a
single concrete class with an `enum class` for the type, and the hourly rate
came from a `switch` inside `ParkingSettings::rateFor`. It worked.

What was wrong with it was *where the question lived*. Asking the settings
object what a vehicle costs means the settings have to know about every kind of
vehicle, and every new kind means editing a function that has nothing to do
with it. The vehicle knows what it is, so the vehicle should answer. I removed
`rateFor` entirely and replaced it with the virtual call above.

**Q. So does adding a fourth vehicle type now only mean adding one class?**

No — and I would rather say so than overclaim. Adding, say, a van means a new
`Van : public Vehicle`, a new case in `Vehicle::create`, a new entry in the
JSON codec's type strings, a new rate in `ParkingSettings`, and a new option in
the UI dropdown. The hierarchy removed one `switch`, not all of them.

The ones that remain are at the edges where the program meets stored text and a
human being, and a type system cannot cross those for you. What the hierarchy
did buy is that the *billing* question — the one that recurs in business logic —
is answered by the object itself. `Vehicle::create` is deliberately the only
`switch` on vehicle type left in the vehicle code.

**Q. Why is `BillingService` all static methods?**

Because billing has no state to keep. It is a pure calculation over the
arguments it is given: a duration and a rate in, a fee out. Making it an object
with no members would be ceremony without benefit. Being static also makes it
trivially testable — the billing tests call it directly with no setup.

**Q. Why does `ParkingSlot` not know whether it is reserved?**

Because it cannot answer that question honestly. Whether a slot is reserved
depends on the booking list and on the current time, neither of which a slot can
see. If I stored a `reserved` flag on the slot, it would be a second copy of
information that lives in the reservations, and the two would eventually
disagree. Instead `ParkingSlot` records only physical occupancy, and
`ParkingLot::displayStateOf` derives the colour by combining the slot with the
bookings. One fact, one home.

---

## Billing

**Q. How is the fee calculated?**

Hourly ceiling: any started hour is charged as a full hour.

```cpp
billableHours = (durationMinutes + 59) / 60;   // integer ceiling division
fee           = billableHours * hourlyRatePaise;
```

So 61 minutes costs the same as 120. A stay under one whole minute is free.

**Q. Why integer division instead of `std::ceil`?**

To keep floating point away from money entirely. `(x + 59) / 60` on integers is
exact; `std::ceil(x / 60.0)` introduces a `double` into a calculation whose
result has to be exactly right.

**Q. Why is money stored in paise?**

Because `0.1 + 0.2 != 0.3` in binary floating point, and a parking system adds
up fees all day. ₹40.00 is stored as the integer `4000`. Rupees appear only in
the browser and in the CSV export. Totals cannot drift.

**Q. If I raise the car rate, what happens to a car that is already parked?**

Nothing. The hourly rate is copied onto the ticket when the session starts, and
`complete()` bills using the ticket's own stored rate, not the current setting.
Bills already issued are untouched too, because they are stored as finished
records. There is a test for exactly this —
`testTariffChangeDoesNotRewriteOldBills` — which parks a car at ₹30, raises the
rate to ₹90, checks the car out and asserts the fee is ₹30.

---

## Reservations and the queue

**Q. What stops two reservations clashing?**

Intervals are half-open, `[start, end)`, and the overlap test is:

```cpp
return startTime_ < otherEnd && otherStart < endTime_;
```

Two bookings clash only if each starts before the other ends. A booking ending
at 3pm and one starting at 3pm therefore do not clash, which is what anyone
would expect — and it falls out of the comparison rather than needing a special
case. There are tests for both the overlapping and the exactly-touching case.

**Q. How is a reserved slot protected from a walk-in vehicle?**

While a booking is `UPCOMING` it holds its slot. `isSlotAllocatable` refuses
any slot that a booking is holding, so the walk-in allocator never picks it, and
`offerSlotToQueue` checks the same thing before handing a freed slot to the
queue. A test parks a car, reserves the only other slot, and asserts that a
second walk-in is refused with `LOT_FULL` even though a space is physically
empty.

**Q. What if the reserved vehicle never turns up?**

It gets a grace period — 30 minutes by default, configurable in Settings.
Check-in is allowed from the start time until `min(start + grace, end)`. Past
that the booking is marked `EXPIRED` and releases its hold, so the slot becomes
available again. The sweep runs at the start of every request, so the state is
never stale when anyone looks at it.

**Q. The dashboard draws a map of the car park. Where do the positions come from?**

From the slot ids, and nowhere else. A slot in the data is only an id, the
vehicle type it takes, and whether something is parked in it - there are no
coordinates, floors or zones stored anywhere. So `facility.js` derives the
layout: the leading letters of an id name its row (`A07` is in row A), the
number orders it within the row, rows are paired to face each other across a
driving aisle, and a row longer than sixteen wraps onto another strip. Any
valid id works, including ones with no letters or no number. I deliberately did
not add floors to the map, because that would mean drawing something the data
does not contain; it would need a real `floor` field on the slot first.

**Q. Why is free shown in teal rather than green?**

Because I checked. The usual green-for-free and red-for-taken pair measured a
colour difference of 2.7 for someone with deuteranopia - effectively the same
colour - and that is the most common form of colour blindness. Teal keeps the
go/stop reading and separates by 13.1. Each bay also says its state another
way: a parked vehicle is drawn in an occupied bay, a reserved one has a dashed
outline and a clock, and every bay has a spoken label.

**Q. Why is the waiting queue a `std::vector` and not a `std::queue`?**

Because a strict FIFO cannot do the two things this queue needs. First, if a
car space opens up and the oldest waiter is a bike, I have to scan past the bike
rather than leave a usable space empty — `findNextCompatible` walks the list in
arrival order and returns the first vehicle that fits. Second, the operator must
be able to cancel any waiting vehicle, not just the front one. A vector in
arrival order gives me FIFO ordering for free and supports both.

**Q. Someone checks out and a vehicle is waiting. What happens?**

`checkOut` frees the slot and then calls `offerSlotToQueue`. If a booking is
holding that slot, nothing happens. Otherwise the oldest compatible waiting
vehicle is admitted: a real ticket is created, the request is marked `ASSIGNED`,
and the checkout response includes a `queueAssignment` object so the browser
knows the slot is not actually free and colours the grid correctly. All of it is
one atomic save.

**Q. A checkout is not the only way a slot frees up. What about the others?**

Right — and this was a real bug I had to fix. There are four ways a slot
becomes usable: a checkout, a **cancelled** booking, an **expired** booking,
and **capacity added** in Settings. Originally only the checkout served the
queue, so a vehicle could sit waiting while a slot it could use stood empty.

The fix was `offerFreeSlotsToQueue`, called from all of those paths. It walks
the slots and hands each usable one to the oldest compatible waiter. The expiry
sweep calls it on every request, so it doubles as a safety net: whatever freed
the slot, the next screen refresh admits whoever was waiting. The invariant
being protected is *a vehicle is never left waiting while a slot it could use
is free*, and the point is that an invariant has to be enforced at every place
that can break it, not just the obvious one.

---

## Data and reliability

**Q. Where is the data kept, and what happens if the program crashes?**

Four JSON files in `data/`: config, tickets, reservations and queue. On startup
the files are loaded and validated, and slot occupancy is **rebuilt from the
active tickets** rather than trusted from the saved flags — so a crash cannot
leave a slot disagreeing with its ticket.

**Q. What if a data file gets corrupted?**

The program refuses to start, names the file, and changes nothing. That is a
deliberate choice: starting blank and then saving would overwrite the very
records worth recovering. An empty file is treated as damaged too, because a
crash during a write looks exactly like an empty file. Each file also has a
`.bak` sibling holding the previous good version. There is a test that corrupts
`tickets.json`, confirms the refusal, and then confirms the damaged file is
still byte-for-byte intact and the `.bak` is valid JSON.

**Q. What if saving fails halfway through?**

Saving runs in two passes. All four files are written to `.tmp` names first;
only when every one has succeeded are they moved into place. So a disk problem
is almost always caught while the previous records are still untouched. On top
of that, every operation copies the in-memory state before it starts and
restores it if the save fails, returning `PERSISTENCE_FAILED`. A success reply
always means the records are on disk. There is a test that blocks the write and
asserts the vehicle has no session afterwards.

*Honest limitation:* the four final renames are not one transaction. A crash in
the middle of those could leave a mixed set, which is what the `.bak` copies are
for. A single file would close the gap.

**Q. How are ticket IDs generated? Why not a counter?**

A counter restarts from zero when the program restarts, so it could hand out an
ID an older record already uses. IDs are instead a prefix, the current time in
base 36, and four random characters — `PW-TMMYWK-CDWS` — and the generator
checks the candidate against the existing records before returning it. Roughly
ordered, unique across restarts, and still readable.

---

## Frontend and safety

**Q. How do you stop a double click creating two tickets?**

`withBusyButton` disables the button and shows a spinner for the whole request,
and restores it in a `finally` block so a failure still gives the button back.
Behind that, the server holds a mutex for every request, so even if two did
arrive together they would be serialised and the second would be refused as a
duplicate registration.

**Q. How do you prevent XSS, given that you build HTML from strings?**

Everything that goes into `innerHTML` passes through `escapeHtml` in
`format.js`. Registration numbers and owner names are operator input, so they
are escaped at every insertion point.

**Q. Why does the server bind to 127.0.0.1?**

So it is reachable only from this computer. It is a local tool with no
authentication, and exposing it on the network would be exposing full control of
the facility to anyone on it. There is a `--host` flag, but the default is the
safe one.

**Q. The fee is shown before you confirm. Is that the amount charged?**

It is an estimate for the current moment, calculated by the server. The amount
actually charged is calculated again by the server at the instant of checkout,
so it can rise by one hour if the vehicle crosses into a new hour while the
dialog is open. The dialog says so explicitly. The browser's number is never
trusted — the exit request sends only the ticket ID.

---

## Testing

**Q. How did you test it?**

293 checks in `tests/test_main.cpp`, run with `test.bat`. They drive
`ParkingLot` directly — no browser, no HTTP — covering billing boundaries,
entry and exit, duplicate detection, a full facility, reservation conflicts and
expiry, queue ordering and compatibility scanning, settings validation, reports,
CSV escaping, backup pruning, and persistence across a simulated restart. On top of that there
is a browser test that walks every screen and performs a real entry, a duplicate
attempt, a checkout and a reservation, checking for console errors and layout
overflow.

**Q. Did the tests actually find anything?**

Four real bugs, which is the honest answer and a good one:

1. **Registration numbers were only normalised in the HTTP layer**, so
   `ParkingLot` treated `mh12ab1234` and `MH12AB1234` as different vehicles and
   let the same car in twice. Fixed by normalising inside `ParkingLot`.
2. **`startSession()` cancelled the very queue request it was about to mark
   `ASSIGNED`**, so a vehicle admitted from the queue was recorded as cancelled.
   Fixed by giving that cleanup its own method, called only where it belongs.
3. **An invisible dialog overlay swallowed every click on the page**, because a
   CSS `display: grid` rule beat the `hidden` attribute. Found by a browser test
   that could not click a button. Fixed with `[hidden] { display: none !important; }`.
4. **Only a checkout served the waiting queue.** A cancelled booking, an
   expired booking and newly added capacity all freed a slot without offering
   it to anyone waiting, so a vehicle could queue indefinitely next to an empty
   space. Fixed with `offerFreeSlotsToQueue`, called from every path that can
   free a slot, and covered by three new tests.

**Q. Why no test framework?**

A counter, a `check()` function and `main()` are enough for this, and they keep
the project free of another dependency to install and explain. The output lists
every check by name, so a failure says exactly what broke.

---

## Things to be ready to show on screen

| If asked about… | Open |
|---|---|
| The billing formula | `src/BillingService.cpp` |
| Repeated checkout being impossible | `ParkingTicket::complete` in `src/ParkingTicket.cpp` |
| Reservation overlap | `Reservation::overlaps` in `src/Reservation.cpp` |
| Reserved vs occupied | `ParkingLot::displayStateOf` in `src/ParkingLot.cpp` |
| Save-or-undo | `ParkingLot::commitOrRollback` in `src/ParkingLot.cpp` |
| Queue skipping an incompatible vehicle | `QueueManager::findNextCompatible` |
| Every way a slot reaches the queue | `ParkingLot::offerFreeSlotsToQueue` |
| Corrupt file handling | `FileManager::readJsonFile` in `src/FileManager.cpp` |
| Two-pass saving | `FileManager::save` in `src/FileManager.cpp` |
| The API routes | `ApiServer::registerRoutes` in `src/ApiServer.cpp` |
| Any test | `tests/test_main.cpp` |
