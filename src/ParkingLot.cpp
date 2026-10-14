#include "ParkingLot.h"
#include "BillingService.h"
#include "TimeUtil.h"

#include <algorithm>
#include <cctype>
#include <set>

namespace parkwise {

namespace {

// A booking may not stretch further than this. It stops a typing slip
// from locking a slot away for years.
const long long kMaxReservationSeconds = 7LL * 24 * 60 * 60;

const int kMaxSlots = 500;

std::string toBase36(unsigned long long value) {
    static const char* kAlphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    if (value == 0) {
        return "0";
    }
    std::string text;
    while (value > 0) {
        text += kAlphabet[value % 36];
        value /= 36;
    }
    std::reverse(text.begin(), text.end());
    return text;
}

std::string normalizeSlotId(const std::string& raw) {
    std::string cleaned;
    for (char character : raw) {
        if (character == ' ' || character == '-') {
            continue;
        }
        cleaned += static_cast<char>(std::toupper(static_cast<unsigned char>(character)));
    }
    return cleaned;
}

bool isValidSlotId(const std::string& id) {
    if (id.empty() || id.size() > 10) {
        return false;
    }
    for (char character : id) {
        if (!std::isalnum(static_cast<unsigned char>(character))) {
            return false;
        }
    }
    return true;
}

} // namespace

std::string slotDisplayStateToString(SlotDisplayState state) {
    switch (state) {
        case SlotDisplayState::AVAILABLE: return "AVAILABLE";
        case SlotDisplayState::OCCUPIED:  return "OCCUPIED";
        case SlotDisplayState::RESERVED:  return "RESERVED";
    }
    return "AVAILABLE";
}

ParkingLot::ParkingLot(FileManager& fileManager)
    : fileManager_(fileManager) {
    std::random_device seedSource;
    randomEngine_.seed((static_cast<unsigned long long>(seedSource()) << 32) ^ seedSource());
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

Result ParkingLot::initialise(Timestamp now) {
    StoredData data;
    std::string error;
    if (!fileManager_.load(data, error)) {
        return Result::failure("PERSISTENCE_FAILED", error);
    }

    state_ = LotState();
    state_.settings = data.settings;
    state_.slots = data.slots;
    state_.tickets = data.tickets;
    state_.reservations = data.reservations;
    state_.queue.replaceAll(data.queueRequests);

    if (!data.hadExistingFiles || state_.slots.empty()) {
        seedDefaultLayout();
    }

    // Rebuild slot occupancy from the active tickets rather than trusting
    // the flag saved in the file. The tickets are the real record of who
    // is parked, so this repairs any disagreement left by a crash.
    for (ParkingSlot& slot : state_.slots) {
        slot.release();
    }
    for (const ParkingTicket& ticket : state_.tickets) {
        if (!ticket.isActive()) {
            continue;
        }
        ParkingSlot* slot = findSlotMutable(ticket.slotId());
        if (slot == nullptr) {
            return Result::failure("DATA_INCONSISTENT",
                                   "Ticket " + ticket.id() + " is parked in slot " +
                                   ticket.slotId() + ", which no longer exists in config.json.");
        }
        if (slot->isOccupied()) {
            return Result::failure("DATA_INCONSISTENT",
                                   "Slot " + slot->id() + " is claimed by two active tickets (" +
                                   slot->activeTicketId() + " and " + ticket.id() + ").");
        }
        slot->occupy(ticket.id());
    }

    applyExpiries(now);

    // A first run must leave a valid set of files behind, and the expiry
    // sweep above may have changed something, so write once at startup.
    std::string saveError;
    if (!fileManager_.save(toStoredData(), saveError)) {
        return Result::failure("PERSISTENCE_FAILED", saveError);
    }
    return Result::success();
}

void ParkingLot::seedDefaultLayout() {
    // A plain 50-space car park: three rows for cars, one for SUVs and one
    // for bikes. Only the layout and the prices are seeded - no tickets,
    // no bookings, so nothing here can be mistaken for real activity.
    state_.slots.clear();

    struct Row {
        char letter;
        VehicleType type;
    };
    const Row rows[] = {
        {'A', VehicleType::CAR},
        {'B', VehicleType::CAR},
        {'C', VehicleType::CAR},
        {'D', VehicleType::SUV},
        {'E', VehicleType::BIKE},
    };

    for (const Row& row : rows) {
        for (int number = 1; number <= 10; number++) {
            std::string id;
            id += row.letter;
            id += (number < 10 ? "0" : "");
            id += std::to_string(number);
            state_.slots.push_back(ParkingSlot(id, row.type));
        }
    }
}

// ---------------------------------------------------------------------------
// Lookups and derived views
// ---------------------------------------------------------------------------

const ParkingSlot* ParkingLot::findSlot(const std::string& slotId) const {
    for (const ParkingSlot& slot : state_.slots) {
        if (slot.id() == slotId) {
            return &slot;
        }
    }
    return nullptr;
}

ParkingSlot* ParkingLot::findSlotMutable(const std::string& slotId) {
    for (ParkingSlot& slot : state_.slots) {
        if (slot.id() == slotId) {
            return &slot;
        }
    }
    return nullptr;
}

const ParkingTicket* ParkingLot::findTicket(const std::string& ticketId) const {
    for (const ParkingTicket& ticket : state_.tickets) {
        if (ticket.id() == ticketId) {
            return &ticket;
        }
    }
    return nullptr;
}

ParkingTicket* ParkingLot::findTicketMutable(const std::string& ticketId) {
    for (ParkingTicket& ticket : state_.tickets) {
        if (ticket.id() == ticketId) {
            return &ticket;
        }
    }
    return nullptr;
}

const ParkingTicket* ParkingLot::findActiveTicketByRegistration(
    const std::string& registrationNumber) const {
    for (const ParkingTicket& ticket : state_.tickets) {
        if (ticket.isActive() && ticket.registrationNumber() == registrationNumber) {
            return &ticket;
        }
    }
    return nullptr;
}

const Reservation* ParkingLot::findReservation(const std::string& reservationId) const {
    for (const Reservation& reservation : state_.reservations) {
        if (reservation.id() == reservationId) {
            return &reservation;
        }
    }
    return nullptr;
}

Reservation* ParkingLot::findReservationMutable(const std::string& reservationId) {
    for (Reservation& reservation : state_.reservations) {
        if (reservation.id() == reservationId) {
            return &reservation;
        }
    }
    return nullptr;
}

const Reservation* ParkingLot::holdFor(const std::string& slotId) const {
    const Reservation* earliest = nullptr;
    for (const Reservation& reservation : state_.reservations) {
        if (reservation.slotId() != slotId || !reservation.holdsSlot()) {
            continue;
        }
        if (earliest == nullptr || reservation.startTime() < earliest->startTime()) {
            earliest = &reservation;
        }
    }
    return earliest;
}

SlotDisplayState ParkingLot::displayStateOf(const ParkingSlot& slot) const {
    if (slot.isOccupied()) {
        return SlotDisplayState::OCCUPIED;
    }
    if (holdFor(slot.id()) != nullptr) {
        return SlotDisplayState::RESERVED;
    }
    return SlotDisplayState::AVAILABLE;
}

int ParkingLot::totalSlotCount() const {
    return static_cast<int>(state_.slots.size());
}

int ParkingLot::occupiedSlotCount() const {
    int count = 0;
    for (const ParkingSlot& slot : state_.slots) {
        if (slot.isOccupied()) {
            count++;
        }
    }
    return count;
}

int ParkingLot::availableSlotCount() const {
    int count = 0;
    for (const ParkingSlot& slot : state_.slots) {
        if (displayStateOf(slot) == SlotDisplayState::AVAILABLE) {
            count++;
        }
    }
    return count;
}

int ParkingLot::reservedSlotCount() const {
    int count = 0;
    for (const ParkingSlot& slot : state_.slots) {
        if (displayStateOf(slot) == SlotDisplayState::RESERVED) {
            count++;
        }
    }
    return count;
}

Paise ParkingLot::revenueCollectedBetween(Timestamp fromInclusive, Timestamp toExclusive) const {
    Paise total = 0;
    for (const ParkingTicket& ticket : state_.tickets) {
        if (ticket.status() != TicketStatus::COMPLETED) {
            continue; // a vehicle still parked has not paid yet
        }
        if (ticket.exitTime() >= fromInclusive && ticket.exitTime() < toExclusive) {
            total += ticket.finalFeePaise();
        }
    }
    return total;
}

bool ParkingLot::hasActiveSession(const std::string& registrationNumber) const {
    return findActiveTicketByRegistration(registrationNumber) != nullptr;
}

bool ParkingLot::isHeldByReservation(const std::string& slotId,
                                     const std::string& ignoreReservationId) const {
    for (const Reservation& reservation : state_.reservations) {
        if (reservation.slotId() != slotId || !reservation.holdsSlot()) {
            continue;
        }
        if (!ignoreReservationId.empty() && reservation.id() == ignoreReservationId) {
            continue;
        }
        return true;
    }
    return false;
}

bool ParkingLot::hasReservationClash(const std::string& slotId,
                                     Timestamp startTime,
                                     Timestamp endTime) const {
    for (const Reservation& reservation : state_.reservations) {
        if (reservation.slotId() != slotId) {
            continue;
        }
        // Only bookings that are still going to use the slot can clash.
        const bool stillCounts = reservation.status() == ReservationStatus::UPCOMING ||
                                 reservation.status() == ReservationStatus::CHECKED_IN;
        if (stillCounts && reservation.overlaps(startTime, endTime)) {
            return true;
        }
    }
    return false;
}

bool ParkingLot::isSlotAllocatable(const ParkingSlot& slot, VehicleType type) const {
    return !slot.isOccupied() && slot.accepts(type) && !isHeldByReservation(slot.id());
}

const ParkingSlot* ParkingLot::findAllocatableSlot(VehicleType type) const {
    for (const ParkingSlot& slot : state_.slots) {
        if (isSlotAllocatable(slot, type)) {
            return &slot;
        }
    }
    return nullptr;
}

// ---------------------------------------------------------------------------
// Identifiers and saving
// ---------------------------------------------------------------------------

bool ParkingLot::idAlreadyUsed(const std::string& candidate) const {
    for (const ParkingTicket& ticket : state_.tickets) {
        if (ticket.id() == candidate) return true;
    }
    for (const Reservation& reservation : state_.reservations) {
        if (reservation.id() == candidate) return true;
    }
    for (const QueueRequest& request : state_.queue.all()) {
        if (request.id() == candidate) return true;
    }
    return false;
}

std::string ParkingLot::makeId(const std::string& prefix) {
    // The time part keeps ids roughly in order and makes them unique across
    // restarts; the random part separates two ids made in the same second.
    // A plain counter was avoided on purpose: it would restart from zero
    // and could hand out an id that an older record already uses.
    std::uniform_int_distribution<int> digit(0, 35);
    static const char* kAlphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

    for (int attempt = 0; attempt < 100; attempt++) {
        std::string candidate = prefix + "-" +
                                toBase36(static_cast<unsigned long long>(TimeUtil::now())) + "-";
        for (int index = 0; index < 4; index++) {
            candidate += kAlphabet[digit(randomEngine_)];
        }
        if (!idAlreadyUsed(candidate)) {
            return candidate;
        }
    }
    // Practically unreachable; falls back to a longer random tail.
    std::string candidate = prefix + "-";
    for (int index = 0; index < 12; index++) {
        candidate += kAlphabet[digit(randomEngine_)];
    }
    return candidate;
}

StoredData ParkingLot::toStoredData() const {
    StoredData data;
    data.settings = state_.settings;
    data.slots = state_.slots;
    data.tickets = state_.tickets;
    data.reservations = state_.reservations;
    data.queueRequests = state_.queue.all();
    data.hadExistingFiles = true;
    return data;
}

Result ParkingLot::commitOrRollback(const LotState& previousState) {
    std::string error;
    if (!fileManager_.save(toStoredData(), error)) {
        state_ = previousState; // nothing is reported as done unless it was saved
        return Result::failure("PERSISTENCE_FAILED",
                               "The change could not be saved and has been undone. " + error);
    }
    return Result::success();
}

// ---------------------------------------------------------------------------
// Reservations expiring
// ---------------------------------------------------------------------------

bool ParkingLot::applyExpiries(Timestamp now) {
    bool changed = false;
    const long long grace = state_.settings.reservationGraceSeconds();
    for (Reservation& reservation : state_.reservations) {
        if (reservation.hasLapsed(now, grace) && reservation.expire()) {
            changed = true;
        }
    }
    return changed;
}

Result ParkingLot::expireLapsedReservations(Timestamp now) {
    LotState previousState = state_;
    const bool expired = applyExpiries(now);

    // The sweep runs even when nothing expired just now. A slot can have been
    // freed by an earlier operation that had no reason to look at the queue,
    // and this is the one call every screen makes before reading, so it is
    // where a stranded vehicle gets picked up.
    std::vector<QueueAssignment> admitted;
    offerFreeSlotsToQueue(now, admitted);

    if (!expired && admitted.empty()) {
        return Result::success(); // nothing changed, so nothing to write
    }
    return commitOrRollback(previousState);
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

ParkingTicket ParkingLot::startSession(const Vehicle& vehicle,
                                       const std::string& slotId,
                                       Timestamp now,
                                       TicketSource source) {
    // The vehicle answers for its own kind - see the subclasses in Vehicle.h.
    const Paise rate = vehicle.hourlyRate(state_.settings);
    ParkingTicket ticket(makeId("PW"), vehicle, slotId, now, rate, source);

    ParkingSlot* slot = findSlotMutable(slotId);
    if (slot != nullptr) {
        slot->occupy(ticket.id());
    }
    state_.tickets.push_back(ticket);
    return ticket;
}

void ParkingLot::cancelWaitingRequestFor(const std::string& registrationNumber) {
    // The vehicle got in another way, so its place in the line must not
    // stay open - otherwise the next free slot would be held for a vehicle
    // that is already parked.
    for (const QueueRequest& request : state_.queue.all()) {
        if (request.isWaiting() && request.registrationNumber() == registrationNumber) {
            state_.queue.cancel(request.id());
            break;
        }
    }
}

// Walk-in entry and joining the queue both start the same way: clean up the
// plate the operator typed, build the right kind of vehicle for it, and check
// the three text fields. Keeping that in one place is what stops the two
// paths from drifting apart.
//
// Returns nullptr and fills `error` when something is wrong with the details.
std::unique_ptr<Vehicle> ParkingLot::acceptVehicle(const Vehicle& requested, Result& error) const {
    // Cleaning the plate here, rather than relying on the caller, is what
    // makes "mh 12-ab 1234" and "MH12AB1234" the same vehicle no matter
    // which screen or test the request came from.
    auto vehicle = Vehicle::create(requested.type(),
                                   Vehicle::normalizeRegistration(requested.registrationNumber()),
                                   requested.ownerName(), requested.contactNumber());

    if (!Vehicle::isValidRegistration(vehicle->registrationNumber())) {
        error = Result::failure("INVALID_REGISTRATION",
                                "Enter a registration number of 4 to 15 letters and digits.");
        return nullptr;
    }
    if (!Vehicle::isValidContactNumber(vehicle->contactNumber())) {
        error = Result::failure("INVALID_CONTACT",
                                "The contact number may only contain digits, spaces, + and -.");
        return nullptr;
    }
    if (!Vehicle::isValidOwnerName(vehicle->ownerName())) {
        error = Result::failure("INVALID_OWNER_NAME",
                                "The owner name may be up to 60 characters and cannot contain "
                                "line breaks.");
        return nullptr;
    }
    return vehicle;
}

Result ParkingLot::checkInWalkIn(const Vehicle& requested, Timestamp now, EntryOutcome& outcome) {
    Result rejected;
    const auto vehicle = acceptVehicle(requested, rejected);
    if (!vehicle) {
        return rejected;
    }


    LotState previousState = state_;
    applyExpiries(now);

    if (hasActiveSession(vehicle->registrationNumber())) {
        state_ = previousState;
        return Result::failure("DUPLICATE_ACTIVE_REGISTRATION",
                               vehicle->registrationNumber() +
                               " is already parked here. Check it out before entering it again.");
    }

    const ParkingSlot* slot = findAllocatableSlot(vehicle->type());
    if (slot == nullptr) {
        state_ = previousState;
        // Tell the operator which of the two problems it is, because the
        // screen offers the waiting list only when the lot is genuinely full.
        bool anySlotOfType = false;
        for (const ParkingSlot& candidate : state_.slots) {
            if (candidate.accepts(vehicle->type())) {
                anySlotOfType = true;
                break;
            }
        }
        if (!anySlotOfType) {
            return Result::failure("NO_COMPATIBLE_SLOT",
                                   "This car park has no slots for a " +
                                   vehicleTypeToString(vehicle->type()) + ".");
        }
        return Result::failure("LOT_FULL",
                               "No free slot for a " + vehicleTypeToString(vehicle->type()) +
                               " right now. You can add this vehicle to the waiting queue.");
    }

    ParkingTicket ticket = startSession(*vehicle, slot->id(), now, TicketSource::WALK_IN);
    cancelWaitingRequestFor(vehicle->registrationNumber());

    Result saved = commitOrRollback(previousState);
    if (!saved.ok) {
        return saved;
    }

    outcome.ticketId = ticket.id();
    outcome.slotId = ticket.slotId();
    outcome.entryTime = ticket.entryTime();
    return Result::success();
}

void ParkingLot::offerSlotToQueue(const std::string& slotId, Timestamp now,
                                  QueueAssignment& assignment) {
    ParkingSlot* slot = findSlotMutable(slotId);
    if (slot == nullptr || slot->isOccupied()) {
        return;
    }
    // A slot being kept for a booking must never be handed to the queue.
    if (isHeldByReservation(slotId)) {
        return;
    }

    const QueueRequest* waiting = state_.queue.findNextCompatible(slot->supportedType());
    if (waiting == nullptr) {
        return;
    }
    if (hasActiveSession(waiting->registrationNumber())) {
        return; // already inside by some other route
    }

    // Copy the details out before the queue vector is touched again.
    const std::string requestId = waiting->id();
    const auto vehicle = Vehicle::create(waiting->vehicleType(), waiting->registrationNumber(),
                                         waiting->ownerName(), waiting->contactNumber());

    ParkingTicket ticket = startSession(*vehicle, slotId, now, TicketSource::QUEUE);
    state_.queue.markAssigned(requestId, slotId, ticket.id());

    assignment.happened = true;
    assignment.requestId = requestId;
    assignment.registrationNumber = vehicle->registrationNumber();
    assignment.vehicleType = vehicleTypeToString(vehicle->type());
    assignment.slotId = slotId;
    assignment.ticketId = ticket.id();
}

void ParkingLot::offerFreeSlotsToQueue(Timestamp now,
                                       std::vector<QueueAssignment>& assignments) {
    if (state_.queue.waitingCount() == 0) {
        return; // the usual case: nobody is waiting, so there is nothing to do
    }

    // The ids are copied out first so that parking a vehicle cannot disturb
    // the loop that is walking the slots.
    std::vector<std::string> slotIds;
    slotIds.reserve(state_.slots.size());
    for (const ParkingSlot& slot : state_.slots) {
        slotIds.push_back(slot.id());
    }

    for (const std::string& slotId : slotIds) {
        if (state_.queue.waitingCount() == 0) {
            break; // everyone who was waiting has been let in
        }
        QueueAssignment assignment;
        offerSlotToQueue(slotId, now, assignment);
        if (assignment.happened) {
            assignments.push_back(assignment);
        }
    }
}

Result ParkingLot::checkOut(const std::string& ticketId, Timestamp now, ExitOutcome& outcome) {
    const ParkingTicket* existing = findTicket(ticketId);
    if (existing == nullptr) {
        return Result::failure("TICKET_NOT_FOUND", "No ticket found with id " + ticketId + ".");
    }
    if (!existing->isActive()) {
        return Result::failure("TICKET_ALREADY_COMPLETED",
                               "Ticket " + ticketId + " was already checked out.");
    }

    LotState previousState = state_;
    applyExpiries(now);

    ParkingTicket* ticket = findTicketMutable(ticketId);
    const std::string slotId = ticket->slotId();

    if (!ticket->complete(now)) {
        state_ = previousState;
        return Result::failure("TICKET_ALREADY_COMPLETED",
                               "Ticket " + ticketId + " was already checked out.");
    }

    ParkingSlot* slot = findSlotMutable(slotId);
    if (slot != nullptr) {
        slot->release();
    }

    // A booking that this session came from is finished once the car leaves.
    for (Reservation& reservation : state_.reservations) {
        if (reservation.ticketId() == ticketId) {
            reservation.complete();
            break;
        }
    }

    // The slot this vehicle just left is the one the operator is watching, so
    // it is offered first and is the assignment reported back in the reply.
    QueueAssignment assignment;
    offerSlotToQueue(slotId, now, assignment);

    // The expiry sweep above may have let go of other slots as well. Those
    // vehicles are admitted too; the screen shows them on its next read.
    std::vector<QueueAssignment> alsoAdmitted;
    offerFreeSlotsToQueue(now, alsoAdmitted);

    Result saved = commitOrRollback(previousState);
    if (!saved.ok) {
        return saved;
    }

    const ParkingTicket* completed = findTicket(ticketId);
    outcome.ticketId = completed->id();
    outcome.slotId = slotId;
    outcome.exitTime = completed->exitTime();
    outcome.durationMinutes = BillingService::durationMinutes(completed->entryTime(),
                                                              completed->exitTime());
    outcome.billableHours = completed->billableHours();
    outcome.hourlyRatePaise = completed->hourlyRatePaise();
    outcome.finalFeePaise = completed->finalFeePaise();
    outcome.queueAssignment = assignment;
    return Result::success();
}

// ---------------------------------------------------------------------------
// Reservations
// ---------------------------------------------------------------------------

Result ParkingLot::createReservation(const std::string& requestedRegistration,
                                     VehicleType vehicleType,
                                     Timestamp startTime,
                                     Timestamp endTime,
                                     const std::string& preferredSlotId,
                                     Timestamp now,
                                     ReservationOutcome& outcome) {
    const std::string registrationNumber = Vehicle::normalizeRegistration(requestedRegistration);

    if (!Vehicle::isValidRegistration(registrationNumber)) {
        return Result::failure("INVALID_REGISTRATION",
                               "Enter a registration number of 4 to 15 letters and digits.");
    }
    if (endTime <= startTime) {
        return Result::failure("INVALID_INTERVAL", "The end time must be after the start time.");
    }
    if (startTime < now) {
        return Result::failure("INVALID_INTERVAL", "A reservation cannot start in the past.");
    }
    if (endTime - startTime > kMaxReservationSeconds) {
        return Result::failure("INVALID_INTERVAL", "A reservation may not be longer than 7 days.");
    }

    LotState previousState = state_;
    applyExpiries(now);

    // One vehicle may hold several bookings, but not two that overlap.
    for (const Reservation& reservation : state_.reservations) {
        const bool stillCounts = reservation.status() == ReservationStatus::UPCOMING ||
                                 reservation.status() == ReservationStatus::CHECKED_IN;
        if (stillCounts && reservation.registrationNumber() == registrationNumber &&
            reservation.overlaps(startTime, endTime)) {
            state_ = previousState;
            return Result::failure("DUPLICATE_RESERVATION",
                                   registrationNumber +
                                   " already has a reservation covering that time.");
        }
    }

    const ParkingSlot* chosen = nullptr;

    if (!preferredSlotId.empty()) {
        const ParkingSlot* preferred = findSlot(normalizeSlotId(preferredSlotId));
        if (preferred == nullptr) {
            state_ = previousState;
            return Result::failure("SLOT_NOT_FOUND", "There is no slot called " + preferredSlotId + ".");
        }
        if (!preferred->accepts(vehicleType)) {
            state_ = previousState;
            return Result::failure("SLOT_TYPE_MISMATCH",
                                   "Slot " + preferred->id() + " takes " +
                                   vehicleTypeToString(preferred->supportedType()) +
                                   " vehicles, not " + vehicleTypeToString(vehicleType) + ".");
        }
        if (preferred->isOccupied()) {
            state_ = previousState;
            return Result::failure("SLOT_OCCUPIED",
                                   "Slot " + preferred->id() +
                                   " has a vehicle in it, so it cannot be reserved yet.");
        }
        if (hasReservationClash(preferred->id(), startTime, endTime)) {
            state_ = previousState;
            return Result::failure("RESERVATION_CONFLICT",
                                   "Slot " + preferred->id() +
                                   " is already reserved during part of that time.");
        }
        chosen = preferred;
    } else {
        for (const ParkingSlot& slot : state_.slots) {
            if (slot.accepts(vehicleType) && !slot.isOccupied() &&
                !hasReservationClash(slot.id(), startTime, endTime)) {
                chosen = &slot;
                break;
            }
        }
        if (chosen == nullptr) {
            state_ = previousState;
            return Result::failure("NO_SLOT_AVAILABLE",
                                   "No free " + vehicleTypeToString(vehicleType) +
                                   " slot is available for that time.");
        }
    }

    Reservation reservation(makeId("RS"), registrationNumber, vehicleType,
                            chosen->id(), startTime, endTime, now);
    state_.reservations.push_back(reservation);

    Result saved = commitOrRollback(previousState);
    if (!saved.ok) {
        return saved;
    }

    outcome.reservationId = reservation.id();
    outcome.slotId = reservation.slotId();
    outcome.startTime = reservation.startTime();
    outcome.endTime = reservation.endTime();
    return Result::success();
}

Result ParkingLot::cancelReservation(const std::string& reservationId, Timestamp now,
                                     std::vector<QueueAssignment>* admitted) {
    const Reservation* existing = findReservation(reservationId);
    if (existing == nullptr) {
        return Result::failure("RESERVATION_NOT_FOUND",
                               "No reservation found with id " + reservationId + ".");
    }
    if (existing->status() != ReservationStatus::UPCOMING) {
        return Result::failure("INVALID_RESERVATION_STATE",
                               "Only an upcoming reservation can be cancelled. This one is " +
                               reservationStatusToString(existing->status()) + ".");
    }

    LotState previousState = state_;
    findReservationMutable(reservationId)->cancel();

    // The booking has let go of its slot, so a vehicle that has been waiting
    // for one of that type can be admitted right now.
    std::vector<QueueAssignment> letIn;
    offerFreeSlotsToQueue(now, letIn);

    Result saved = commitOrRollback(previousState);
    if (saved.ok && admitted != nullptr) {
        *admitted = letIn; // only reported once the change is safely on disk
    }
    return saved;
}

Result ParkingLot::checkInReservation(const std::string& reservationId,
                                      const std::string& requestedRegistration,
                                      Timestamp now,
                                      EntryOutcome& outcome) {
    const std::string registrationNumber =
        requestedRegistration.empty() ? std::string()
                                      : Vehicle::normalizeRegistration(requestedRegistration);

    LotState previousState = state_;
    applyExpiries(now);

    const Reservation* existing = findReservation(reservationId);
    if (existing == nullptr) {
        state_ = previousState;
        return Result::failure("RESERVATION_NOT_FOUND",
                               "No reservation found with id " + reservationId + ".");
    }

    // The operator may be asked to confirm the plate at the barrier.
    if (!registrationNumber.empty() && registrationNumber != existing->registrationNumber()) {
        state_ = previousState;
        return Result::failure("REGISTRATION_MISMATCH",
                               "This reservation is for " + existing->registrationNumber() + ".");
    }

    if (existing->status() != ReservationStatus::UPCOMING) {
        state_ = previousState;
        return Result::failure("INVALID_RESERVATION_STATE",
                               "This reservation is " +
                               reservationStatusToString(existing->status()) +
                               " and cannot be checked in.");
    }

    const long long grace = state_.settings.reservationGraceSeconds();
    if (!existing->isCheckInAllowed(now, grace)) {
        state_ = previousState;
        if (now < existing->startTime()) {
            return Result::failure("RESERVATION_NOT_STARTED",
                                   "This reservation has not started yet.");
        }
        return Result::failure("RESERVATION_WINDOW_PASSED",
                               "The grace period for this reservation has passed.");
    }

    if (hasActiveSession(existing->registrationNumber())) {
        state_ = previousState;
        return Result::failure("DUPLICATE_ACTIVE_REGISTRATION",
                               existing->registrationNumber() + " is already parked here.");
    }

    const ParkingSlot* slot = findSlot(existing->slotId());
    if (slot == nullptr) {
        state_ = previousState;
        return Result::failure("SLOT_NOT_FOUND",
                               "The reserved slot " + existing->slotId() + " no longer exists.");
    }
    if (slot->isOccupied()) {
        state_ = previousState;
        return Result::failure("SLOT_OCCUPIED",
                               "Slot " + slot->id() + " is unexpectedly occupied.");
    }

    const auto vehicle = Vehicle::create(existing->vehicleType(), existing->registrationNumber());
    ParkingTicket ticket = startSession(*vehicle, slot->id(), now, TicketSource::RESERVATION);
    cancelWaitingRequestFor(vehicle->registrationNumber());
    findReservationMutable(reservationId)->checkIn(ticket.id());

    Result saved = commitOrRollback(previousState);
    if (!saved.ok) {
        return saved;
    }

    outcome.ticketId = ticket.id();
    outcome.slotId = ticket.slotId();
    outcome.entryTime = ticket.entryTime();
    return Result::success();
}

// ---------------------------------------------------------------------------
// Waiting queue
// ---------------------------------------------------------------------------

Result ParkingLot::addToQueue(const Vehicle& requested, Timestamp now, QueueOutcome& outcome) {
    Result rejected;
    const auto vehicle = acceptVehicle(requested, rejected);
    if (!vehicle) {
        return rejected;
    }


    LotState previousState = state_;
    applyExpiries(now);

    if (hasActiveSession(vehicle->registrationNumber())) {
        state_ = previousState;
        return Result::failure("DUPLICATE_ACTIVE_REGISTRATION",
                               vehicle->registrationNumber() + " is already parked here.");
    }
    if (state_.queue.hasWaitingRegistration(vehicle->registrationNumber())) {
        state_ = previousState;
        return Result::failure("DUPLICATE_QUEUE_REQUEST",
                               vehicle->registrationNumber() + " is already in the waiting queue.");
    }
    if (findAllocatableSlot(vehicle->type()) != nullptr) {
        state_ = previousState;
        return Result::failure("SLOT_AVAILABLE",
                               "A slot is free for this vehicle, so park it instead of queueing.");
    }

    QueueRequest request(makeId("QR"), vehicle->registrationNumber(), vehicle->type(),
                         vehicle->ownerName(), vehicle->contactNumber(), now);
    state_.queue.add(request);

    Result saved = commitOrRollback(previousState);
    if (!saved.ok) {
        return saved;
    }

    outcome.requestId = request.id();
    outcome.position = state_.queue.positionOf(request.id());
    return Result::success();
}

Result ParkingLot::cancelQueueRequest(const std::string& requestId) {
    const QueueRequest* existing = state_.queue.findById(requestId);
    if (existing == nullptr) {
        return Result::failure("QUEUE_REQUEST_NOT_FOUND",
                               "No waiting request found with id " + requestId + ".");
    }
    if (!existing->isWaiting()) {
        return Result::failure("INVALID_QUEUE_STATE",
                               "This request is " + queueStatusToString(existing->status()) +
                               " and can no longer be cancelled.");
    }

    LotState previousState = state_;
    state_.queue.cancel(requestId);
    return commitOrRollback(previousState);
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

Result ParkingLot::updateSettings(const ParkingSettings& newSettings,
                                  const std::vector<SlotDefinition>& newSlots,
                                  Timestamp now,
                                  std::vector<QueueAssignment>* admitted) {
    std::string settingsError;
    if (!newSettings.isValid(settingsError)) {
        return Result::failure("INVALID_SETTINGS", settingsError);
    }
    if (newSlots.empty()) {
        return Result::failure("INVALID_SETTINGS", "The car park needs at least one slot.");
    }
    if (static_cast<int>(newSlots.size()) > kMaxSlots) {
        return Result::failure("INVALID_SETTINGS",
                               "A maximum of " + std::to_string(kMaxSlots) + " slots is supported.");
    }

    std::set<std::string> seenIds;
    std::vector<SlotDefinition> cleaned;
    cleaned.reserve(newSlots.size());
    for (const SlotDefinition& definition : newSlots) {
        SlotDefinition tidy;
        tidy.id = normalizeSlotId(definition.id);
        tidy.type = definition.type;
        if (!isValidSlotId(tidy.id)) {
            return Result::failure("INVALID_SETTINGS",
                                   "Slot ids must be 1 to 10 letters or digits. Check: " +
                                   definition.id);
        }
        if (!seenIds.insert(tidy.id).second) {
            return Result::failure("DUPLICATE_SLOT_ID", "Slot " + tidy.id + " is listed twice.");
        }
        cleaned.push_back(tidy);
    }

    // Refuse any change that would disturb a vehicle that is parked, or a
    // slot that a booking is relying on.
    for (const ParkingSlot& existing : state_.slots) {
        const bool stillListed = seenIds.count(existing.id()) > 0;
        if (!stillListed) {
            if (existing.isOccupied()) {
                return Result::failure("SLOT_IN_USE",
                                       "Slot " + existing.id() +
                                       " is occupied and cannot be removed.");
            }
            if (isHeldByReservation(existing.id())) {
                return Result::failure("SLOT_RESERVED",
                                       "Slot " + existing.id() +
                                       " has an upcoming reservation and cannot be removed.");
            }
        }
    }
    for (const SlotDefinition& definition : cleaned) {
        const ParkingSlot* existing = findSlot(definition.id);
        if (existing == nullptr || existing->supportedType() == definition.type) {
            continue;
        }
        if (existing->isOccupied()) {
            return Result::failure("SLOT_IN_USE",
                                   "Slot " + existing->id() +
                                   " is occupied, so its vehicle type cannot be changed.");
        }
        if (isHeldByReservation(existing->id())) {
            return Result::failure("SLOT_RESERVED",
                                   "Slot " + existing->id() +
                                   " has an upcoming reservation, so its vehicle type cannot "
                                   "be changed.");
        }
    }

    LotState previousState = state_;

    std::vector<ParkingSlot> rebuilt;
    rebuilt.reserve(cleaned.size());
    for (const SlotDefinition& definition : cleaned) {
        ParkingSlot slot(definition.id, definition.type);
        const ParkingSlot* existing = findSlot(definition.id);
        if (existing != nullptr && existing->isOccupied()) {
            slot.occupy(existing->activeTicketId()); // keep the parked vehicle where it is
        }
        rebuilt.push_back(slot);
    }

    state_.settings = newSettings;
    state_.slots = rebuilt;

    // Added capacity is the third way a slot becomes usable, so the waiting
    // queue is offered the new layout before the change is saved.
    std::vector<QueueAssignment> letIn;
    offerFreeSlotsToQueue(now, letIn);

    Result saved = commitOrRollback(previousState);
    if (saved.ok && admitted != nullptr) {
        *admitted = letIn; // only reported once the change is safely on disk
    }
    return saved;
}

} // namespace parkwise
