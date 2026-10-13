#ifndef PARKWISE_PARKING_LOT_H
#define PARKWISE_PARKING_LOT_H

#include "FileManager.h"
#include "ParkingSettings.h"
#include "ParkingSlot.h"
#include "ParkingTicket.h"
#include "QueueManager.h"
#include "Reservation.h"
#include "Types.h"
#include "Vehicle.h"

#include <random>
#include <string>
#include <vector>

namespace parkwise {

// What a slot looks like on screen. Physical occupancy and a reservation
// hold are different things, so the colour shown is worked out from both.
enum class SlotDisplayState { AVAILABLE, OCCUPIED, RESERVED };

std::string slotDisplayStateToString(SlotDisplayState state);

// A vehicle from the waiting list that was given a slot released by a
// checkout. happened stays false when nobody suitable was waiting.
struct QueueAssignment {
    bool happened = false;
    std::string requestId;
    std::string registrationNumber;
    std::string vehicleType;
    std::string slotId;
    std::string ticketId;
};

struct EntryOutcome {
    std::string ticketId;
    std::string slotId;
    Timestamp entryTime = 0;
};

struct ExitOutcome {
    std::string ticketId;
    std::string slotId;
    Timestamp exitTime = 0;
    long long durationMinutes = 0;
    long long billableHours = 0;
    Paise hourlyRatePaise = 0;
    Paise finalFeePaise = 0;
    QueueAssignment queueAssignment;
};

struct ReservationOutcome {
    std::string reservationId;
    std::string slotId;
    Timestamp startTime = 0;
    Timestamp endTime = 0;
};

struct QueueOutcome {
    std::string requestId;
    int position = 0;
};

// One line of the Settings screen's slot list.
struct SlotDefinition {
    std::string id;
    VehicleType type = VehicleType::CAR;
};

// The heart of the application. It owns every slot, ticket, reservation
// and waiting request, and it is the only place allowed to change them.
//
// Each operation follows the same shape:
//   1. check the request against the current state,
//   2. change the state only once every check has passed,
//   3. save to disk,
//   4. if the save failed, put the old state back and report the failure.
//
// Step 4 is what lets the API promise that a success reply always means
// the records really are on disk.
class ParkingLot {
public:
    explicit ParkingLot(FileManager& fileManager);

    // Loads saved records, or lays out a fresh car park on a first run.
    Result initialise(Timestamp now);

    // ---------- read-only views ----------
    const ParkingSettings& settings() const { return state_.settings; }
    const std::vector<ParkingSlot>& slots() const { return state_.slots; }
    const std::vector<ParkingTicket>& tickets() const { return state_.tickets; }
    const std::vector<Reservation>& reservations() const { return state_.reservations; }
    const QueueManager& queue() const { return state_.queue; }

    const ParkingSlot* findSlot(const std::string& slotId) const;
    const ParkingTicket* findTicket(const std::string& ticketId) const;
    const ParkingTicket* findActiveTicketByRegistration(const std::string& registrationNumber) const;
    const Reservation* findReservation(const std::string& reservationId) const;

    SlotDisplayState displayStateOf(const ParkingSlot& slot) const;

    // The booking that is currently keeping a slot back, if any.
    const Reservation* holdFor(const std::string& slotId) const;

    int totalSlotCount() const;
    int occupiedSlotCount() const;
    int availableSlotCount() const;
    int reservedSlotCount() const;

    // Fees from sessions that were completed inside the window. Money is
    // counted when it is taken, which is at checkout.
    Paise revenueCollectedBetween(Timestamp fromInclusive, Timestamp toExclusive) const;

    // Is this slot free, of the right type, and not being kept for a booking?
    bool isSlotAllocatable(const ParkingSlot& slot, VehicleType type) const;

    // ---------- operations ----------

    // Marks bookings whose grace period ran out as Expired and lets go of
    // their slots, then hands any slot that is now usable to the waiting
    // queue. Saves only when something actually changed.
    //
    // Every screen calls this before reading, which makes it the safety net
    // for the whole waiting list: however a slot came to be free, the next
    // request admits whoever has been waiting for it.
    Result expireLapsedReservations(Timestamp now);

    // Registration numbers are cleaned up inside these operations, so a
    // caller may pass whatever the operator typed.
    Result checkInWalkIn(const Vehicle& requested, Timestamp now, EntryOutcome& outcome);

    Result checkOut(const std::string& ticketId, Timestamp now, ExitOutcome& outcome);

    Result createReservation(const std::string& requestedRegistration,
                             VehicleType vehicleType,
                             Timestamp startTime,
                             Timestamp endTime,
                             const std::string& preferredSlotId,
                             Timestamp now,
                             ReservationOutcome& outcome);

    // Cancelling releases the slot the booking was holding, so `now` is
    // needed to admit a waiting vehicle into it straight away. Pass a vector
    // to be told who was let in, so the screen can say so.
    Result cancelReservation(const std::string& reservationId, Timestamp now,
                             std::vector<QueueAssignment>* admitted = nullptr);

    Result checkInReservation(const std::string& reservationId,
                              const std::string& requestedRegistration,
                              Timestamp now,
                              EntryOutcome& outcome);

    Result addToQueue(const Vehicle& requested, Timestamp now, QueueOutcome& outcome);

    Result cancelQueueRequest(const std::string& requestId);

    // Added capacity is offered to the waiting queue, so this takes `now`
    // and reports who was admitted for the same reasons cancelReservation does.
    Result updateSettings(const ParkingSettings& newSettings,
                          const std::vector<SlotDefinition>& newSlots,
                          Timestamp now,
                          std::vector<QueueAssignment>* admitted = nullptr);

private:
    // Every piece of state sits in one struct so that an operation can take
    // a copy before it starts and restore it if the save fails.
    struct LotState {
        ParkingSettings settings;
        std::vector<ParkingSlot> slots;
        std::vector<ParkingTicket> tickets;
        std::vector<Reservation> reservations;
        QueueManager queue;
    };

    ParkingSlot* findSlotMutable(const std::string& slotId);
    ParkingTicket* findTicketMutable(const std::string& ticketId);
    Reservation* findReservationMutable(const std::string& reservationId);

    bool hasActiveSession(const std::string& registrationNumber) const;

    // True when some booking other than the one named is holding the slot.
    bool isHeldByReservation(const std::string& slotId,
                             const std::string& ignoreReservationId = std::string()) const;

    bool hasReservationClash(const std::string& slotId,
                             Timestamp startTime,
                             Timestamp endTime) const;

    const ParkingSlot* findAllocatableSlot(VehicleType type) const;

    // Shared by walk-in entry, reservation check-in and queue assignment:
    // creates the ticket and puts the vehicle in the slot.
    ParkingTicket startSession(const Vehicle& vehicle,
                               const std::string& slotId,
                               Timestamp now,
                               TicketSource source);

    // Drops a vehicle out of the waiting line because it has just been
    // parked by some other route.
    void cancelWaitingRequestFor(const std::string& registrationNumber);

    // After a slot frees up, hand it to the oldest waiting vehicle that
    // can use it. Does nothing if the slot is being kept for a booking.
    void offerSlotToQueue(const std::string& slotId, Timestamp now, QueueAssignment& assignment);

    // Walks every slot and offers each usable one to the queue.
    //
    // A checkout is not the only way a slot becomes free: a booking can be
    // cancelled or expire, and Settings can add capacity. Without this, a
    // vehicle could sit in the queue while a slot it could use stood empty.
    // Returns one entry per vehicle admitted.
    void offerFreeSlotsToQueue(Timestamp now, std::vector<QueueAssignment>& assignments);

    bool applyExpiries(Timestamp now);

    // Creates the default car park on a first run.
    void seedDefaultLayout();

    // Saves, or puts previousState back and explains what went wrong.
    Result commitOrRollback(const LotState& previousState);

    std::string makeId(const std::string& prefix);
    bool idAlreadyUsed(const std::string& candidate) const;

    StoredData toStoredData() const;

    FileManager& fileManager_;
    LotState state_;
    std::mt19937_64 randomEngine_;
};

} // namespace parkwise

#endif
