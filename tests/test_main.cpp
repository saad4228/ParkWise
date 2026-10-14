// ParkWise business rule tests.
//
// These run without a browser and without the HTTP server: they talk to
// ParkingLot and its helpers directly, which is where every parking rule
// actually lives.
//
// There is no test framework on purpose. A counter, a check() function and
// plain main() are enough here, and they keep the project free of another
// dependency to install.

#include "BillingService.h"
#include "FileManager.h"
#include "ParkingLot.h"
#include "ReportService.h"
#include "TimeUtil.h"
#include "Vehicle.h"

#include <cstdio>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <memory>
#include <string>
#include <vector>

namespace fs = std::filesystem;
using namespace parkwise;

namespace {

int checksRun = 0;
int checksFailed = 0;

void group(const std::string& name) {
    std::cout << "\n" << name << "\n";
}

void check(bool condition, const std::string& label) {
    checksRun++;
    if (condition) {
        std::cout << "  pass  " << label << "\n";
    } else {
        checksFailed++;
        std::cout << "  FAIL  " << label << "\n";
    }
}

void checkEqual(long long actual, long long expected, const std::string& label) {
    checksRun++;
    if (actual == expected) {
        std::cout << "  pass  " << label << "\n";
    } else {
        checksFailed++;
        std::cout << "  FAIL  " << label << "  (expected " << expected << ", got " << actual
                  << ")\n";
    }
}

void checkEqualText(const std::string& actual, const std::string& expected,
                    const std::string& label) {
    checksRun++;
    if (actual == expected) {
        std::cout << "  pass  " << label << "\n";
    } else {
        checksFailed++;
        std::cout << "  FAIL  " << label << "  (expected \"" << expected << "\", got \"" << actual
                  << "\")\n";
    }
}

// ---------------------------------------------------------------------------
// Helpers for building a throwaway car park on disk
// ---------------------------------------------------------------------------

fs::path makeEmptyDirectory(const std::string& name) {
    const fs::path directory = fs::temp_directory_path() / "parkwise-tests" / name;
    std::error_code code;
    fs::remove_all(directory, code);
    fs::create_directories(directory, code);
    return directory;
}

std::vector<SlotDefinition> slotList(const std::vector<std::pair<std::string, VehicleType>>& rows) {
    std::vector<SlotDefinition> definitions;
    for (const auto& row : rows) {
        SlotDefinition definition;
        definition.id = row.first;
        definition.type = row.second;
        definitions.push_back(definition);
    }
    return definitions;
}

const Timestamp kBaseTime = 1791522000; // a fixed moment, so tests never drift
const long long kHour = 3600;

// Replaces the seeded 50-slot layout with a small one, so that a test can
// fill the car park in two or three lines.
void useSmallLayout(ParkingLot& lot,
                    const std::vector<std::pair<std::string, VehicleType>>& rows) {
    Result result = lot.updateSettings(lot.settings(), slotList(rows), kBaseTime);
    if (!result.ok) {
        std::cout << "  FAIL  could not install the test layout: " << result.message << "\n";
        checksFailed++;
    }
}

Car car(const std::string& plate) { return Car(plate); }
Bike bike(const std::string& plate) { return Bike(plate); }

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------

int countBackupFolders(const fs::path& root) {
    int total = 0;
    for (const fs::directory_entry& entry : fs::directory_iterator(root)) {
        if (entry.is_directory()) {
            total++;
        }
    }
    return total;
}

void testBilling() {
    group("Billing - hourly ceiling");

    checkEqual(BillingService::billableHours(0), 0, "0 minutes bills 0 hours");
    checkEqual(BillingService::billableHours(1), 1, "1 minute bills 1 hour");
    checkEqual(BillingService::billableHours(20), 1, "20 minutes bills 1 hour");
    checkEqual(BillingService::billableHours(59), 1, "59 minutes bills 1 hour");
    checkEqual(BillingService::billableHours(60), 1, "60 minutes bills 1 hour");
    checkEqual(BillingService::billableHours(61), 2, "61 minutes bills 2 hours");
    checkEqual(BillingService::billableHours(120), 2, "120 minutes bills 2 hours");
    checkEqual(BillingService::billableHours(121), 3, "121 minutes bills 3 hours");
    checkEqual(BillingService::billableHours(130), 3, "130 minutes bills 3 hours");

    const Paise rate = 4000; // Rs 40 per hour
    checkEqual(BillingService::feePaise(BillingService::billableHours(0), rate), 0,
               "0 minutes at Rs 40 costs Rs 0");
    checkEqual(BillingService::feePaise(BillingService::billableHours(1), rate), 4000,
               "1 minute at Rs 40 costs Rs 40");
    checkEqual(BillingService::feePaise(BillingService::billableHours(130), rate), 12000,
               "130 minutes at Rs 40 costs Rs 120");

    checkEqual(BillingService::durationMinutes(kBaseTime, kBaseTime + 7800), 130,
               "130 minutes measured from timestamps");
    checkEqual(BillingService::durationMinutes(kBaseTime + 100, kBaseTime), 0,
               "a reversed interval measures 0 minutes");
    checkEqual(BillingService::durationMinutes(kBaseTime, kBaseTime + 59), 0,
               "under a minute measures 0 minutes");
}

// ---------------------------------------------------------------------------
// Registration numbers
// ---------------------------------------------------------------------------

void testRegistrationValidation() {
    group("Registration numbers");

    checkEqualText(Vehicle::normalizeRegistration("mh 12-ab 1234"), "MH12AB1234",
                   "spacing and case are cleaned up");
    check(Vehicle::isValidRegistration("MH12AB1234"), "a normal plate is accepted");
    check(!Vehicle::isValidRegistration(""), "an empty plate is rejected");
    check(!Vehicle::isValidRegistration("AB"), "a very short plate is rejected");
    check(!Vehicle::isValidRegistration("ABCDEFGH"), "letters with no digits are rejected");
    check(!Vehicle::isValidRegistration("12345678"), "digits with no letters are rejected");
    check(!Vehicle::isValidRegistration("MH12$$1234"), "punctuation is rejected");
    check(!Vehicle::isValidRegistration("MH12AB1234567890"), "an over-long plate is rejected");

    check(Vehicle::isValidContactNumber(""), "a blank contact number is allowed");
    check(Vehicle::isValidContactNumber("+91 98765-43210"), "a normal contact number is allowed");
    check(!Vehicle::isValidContactNumber("call me"), "letters in a contact number are rejected");
}

// ---------------------------------------------------------------------------
// The vehicle hierarchy
// ---------------------------------------------------------------------------

void testVehicleKinds() {
    group("Vehicles - one base class, three kinds");

    ParkingSettings settings;              // the defaults: 10, 30 and 50 rupees
    settings.bikeHourlyRatePaise = 1000;
    settings.carHourlyRatePaise = 3000;
    settings.suvHourlyRatePaise = 5000;

    // Each kind is held through a pointer to the base class, so the call
    // below is resolved at run time by the object, not at compile time by
    // the type of the pointer. That is the whole point of the hierarchy.
    std::vector<std::unique_ptr<Vehicle>> fleet;
    fleet.push_back(Vehicle::create(VehicleType::CAR, "MH12AB1234"));
    fleet.push_back(Vehicle::create(VehicleType::BIKE, "MH01XY0001"));
    fleet.push_back(Vehicle::create(VehicleType::SUV, "MH20SU0002"));

    checkEqualText(vehicleTypeToString(fleet[0]->type()), "CAR", "the first is a car");
    checkEqualText(vehicleTypeToString(fleet[1]->type()), "BIKE", "the second is a bike");
    checkEqualText(vehicleTypeToString(fleet[2]->type()), "SUV", "the third is an SUV");

    checkEqual(fleet[0]->hourlyRate(settings), 3000, "the car charges the car rate");
    checkEqual(fleet[1]->hourlyRate(settings), 1000, "the bike charges the bike rate");
    checkEqual(fleet[2]->hourlyRate(settings), 5000, "the SUV charges the SUV rate");

    // The shared half of the class works the same for all three.
    checkEqualText(fleet[1]->registrationNumber(), "MH01XY0001",
                   "the plate is kept by the base class");

    Car named("MH99ZZ9999", "Priya Nair", "+91 98765 43210");
    checkEqualText(named.ownerName(), "Priya Nair", "owner details are inherited too");
    checkEqualText(named.contactNumber(), "+91 98765 43210", "and so is the contact number");

    // And the rate a session is billed at comes from this same call, so the
    // hierarchy is doing real work rather than sitting beside the program.
    const fs::path directory = makeEmptyDirectory("vehicle-kinds");
    FileManager files(directory.string());
    ParkingLot lot(files);
    check(lot.initialise(kBaseTime).ok, "the car park starts up");
    useSmallLayout(lot, {{"A01", VehicleType::CAR}, {"E01", VehicleType::BIKE}});

    EntryOutcome carEntry;
    EntryOutcome bikeEntry;
    check(lot.checkInWalkIn(car("MH12AB1234"), kBaseTime, carEntry).ok, "a car checks in");
    check(lot.checkInWalkIn(bike("MH01XY0001"), kBaseTime, bikeEntry).ok, "a bike checks in");

    ExitOutcome carExit;
    ExitOutcome bikeExit;
    check(lot.checkOut(carEntry.ticketId, kBaseTime + 3600, carExit).ok, "the car leaves");
    check(lot.checkOut(bikeEntry.ticketId, kBaseTime + 3600, bikeExit).ok, "the bike leaves");
    checkEqual(carExit.finalFeePaise, 3000, "the car was billed at its own rate");
    checkEqual(bikeExit.finalFeePaise, 1000, "the bike was billed at its own rate");
}

// ---------------------------------------------------------------------------
// Entry and exit
// ---------------------------------------------------------------------------

void testParkingOperations() {
    group("Parking - entry and exit");

    const fs::path directory = makeEmptyDirectory("parking");
    FileManager files(directory.string());
    ParkingLot lot(files);
    check(lot.initialise(kBaseTime).ok, "a fresh car park starts up");
    checkEqual(lot.totalSlotCount(), 50, "the default layout has 50 slots");

    useSmallLayout(lot, {{"A01", VehicleType::CAR}, {"E01", VehicleType::BIKE}});
    checkEqual(lot.totalSlotCount(), 2, "the test layout has 2 slots");
    checkEqual(lot.availableSlotCount(), 2, "both slots start available");

    EntryOutcome first;
    Result entry = lot.checkInWalkIn(car("MH12AB1234"), kBaseTime, first);
    check(entry.ok, "a valid car is checked in");
    checkEqualText(first.slotId, "A01", "the car is given the car slot");
    checkEqual(lot.occupiedSlotCount(), 1, "one slot is now occupied");
    checkEqual(lot.availableSlotCount(), 1, "one slot is still available");

    EntryOutcome duplicate;
    Result again = lot.checkInWalkIn(car("mh12ab1234"), kBaseTime + 60, duplicate);
    check(!again.ok, "the same plate cannot be checked in twice");
    checkEqualText(again.errorCode, "DUPLICATE_ACTIVE_REGISTRATION",
                   "a repeat entry reports DUPLICATE_ACTIVE_REGISTRATION");

    EntryOutcome invalid;
    Result badPlate = lot.checkInWalkIn(car("??"), kBaseTime, invalid);
    check(!badPlate.ok, "an invalid plate is refused");
    checkEqualText(badPlate.errorCode, "INVALID_REGISTRATION",
                   "a bad plate reports INVALID_REGISTRATION");

    EntryOutcome second;
    Result full = lot.checkInWalkIn(car("MH14CD5678"), kBaseTime, second);
    check(!full.ok, "a second car is refused when the only car slot is taken");
    checkEqualText(full.errorCode, "LOT_FULL", "a full car park reports LOT_FULL");

    // A bike still fits, because its own slot is free.
    EntryOutcome bikeEntry;
    check(lot.checkInWalkIn(bike("MH01XY0001"), kBaseTime, bikeEntry).ok,
          "a bike still gets the bike slot");
    checkEqualText(bikeEntry.slotId, "E01", "the bike is given the bike slot");

    ExitOutcome exit;
    Result checkout = lot.checkOut(first.ticketId, kBaseTime + 7800, exit); // 130 minutes
    check(checkout.ok, "the car is checked out");
    checkEqual(exit.durationMinutes, 130, "the stay measures 130 minutes");
    checkEqual(exit.billableHours, 3, "130 minutes bills 3 hours");
    checkEqual(exit.finalFeePaise, 3 * 3000, "the fee uses the Rs 30 car rate");
    check(!exit.queueAssignment.happened, "nobody was waiting for the slot");

    const ParkingSlot* released = lot.findSlot("A01");
    check(released != nullptr && !released->isOccupied(), "the slot is free again after checkout");

    ExitOutcome twice;
    Result repeat = lot.checkOut(first.ticketId, kBaseTime + 9000, twice);
    check(!repeat.ok, "the same ticket cannot be checked out twice");
    checkEqualText(repeat.errorCode, "TICKET_ALREADY_COMPLETED",
                   "a repeat checkout reports TICKET_ALREADY_COMPLETED");

    ExitOutcome missing;
    Result unknown = lot.checkOut("PW-DOES-NOT-EXIST", kBaseTime, missing);
    check(!unknown.ok, "an unknown ticket is refused");
    checkEqualText(unknown.errorCode, "TICKET_NOT_FOUND",
                   "an unknown ticket reports TICKET_NOT_FOUND");

    // No slot of that kind exists at all, which is a different problem
    // from the car park simply being full.
    EntryOutcome suvEntry;
    Result noSuvSlot = lot.checkInWalkIn(Suv("MH20SU0001"), kBaseTime, suvEntry);
    check(!noSuvSlot.ok, "an SUV is refused when the layout has no SUV slots");
    checkEqualText(noSuvSlot.errorCode, "NO_COMPATIBLE_SLOT",
                   "a missing slot type reports NO_COMPATIBLE_SLOT");
}

// ---------------------------------------------------------------------------
// Reservations
// ---------------------------------------------------------------------------

void testReservations() {
    group("Reservations");

    const fs::path directory = makeEmptyDirectory("reservations");
    FileManager files(directory.string());
    ParkingLot lot(files);
    check(lot.initialise(kBaseTime).ok, "the car park starts up");
    useSmallLayout(lot, {{"A01", VehicleType::CAR}, {"A02", VehicleType::CAR}});

    ReservationOutcome first;
    Result created = lot.createReservation("MH12AB1234", VehicleType::CAR, kBaseTime + kHour,
                                           kBaseTime + 2 * kHour, "A01", kBaseTime, first);
    check(created.ok, "a future reservation is created");
    checkEqualText(first.slotId, "A01", "the preferred slot is used");

    const ParkingSlot* held = lot.findSlot("A01");
    check(held != nullptr && lot.displayStateOf(*held) == SlotDisplayState::RESERVED,
          "the reserved slot shows as Reserved, not Occupied");
    check(held != nullptr && !held->isOccupied(), "a reserved slot is not physically occupied");

    ReservationOutcome clashing;
    Result overlap = lot.createReservation("MH99ZZ9999", VehicleType::CAR, kBaseTime + 90 * 60,
                                           kBaseTime + 3 * kHour, "A01", kBaseTime, clashing);
    check(!overlap.ok, "an overlapping reservation on the same slot is refused");
    checkEqualText(overlap.errorCode, "RESERVATION_CONFLICT",
                   "an overlap reports RESERVATION_CONFLICT");

    ReservationOutcome touching;
    Result meeting = lot.createReservation("MH99ZZ9999", VehicleType::CAR, kBaseTime + 2 * kHour,
                                           kBaseTime + 3 * kHour, "A01", kBaseTime, touching);
    check(meeting.ok, "a reservation that starts exactly when another ends is allowed");

    ReservationOutcome reversed;
    Result backwards = lot.createReservation("MH11AA1111", VehicleType::CAR, kBaseTime + 2 * kHour,
                                             kBaseTime + kHour, "", kBaseTime, reversed);
    check(!backwards.ok, "an end time before the start time is refused");
    checkEqualText(backwards.errorCode, "INVALID_INTERVAL",
                   "a reversed interval reports INVALID_INTERVAL");

    ReservationOutcome past;
    Result inThePast = lot.createReservation("MH11AA1111", VehicleType::CAR, kBaseTime - 2 * kHour,
                                             kBaseTime - kHour, "", kBaseTime, past);
    check(!inThePast.ok, "a reservation in the past is refused");

    ReservationOutcome wrongType;
    Result mismatch = lot.createReservation("MH11AA1111", VehicleType::BIKE, kBaseTime + kHour,
                                            kBaseTime + 2 * kHour, "A02", kBaseTime, wrongType);
    check(!mismatch.ok, "a bike cannot reserve a car slot");
    checkEqualText(mismatch.errorCode, "SLOT_TYPE_MISMATCH",
                   "a wrong slot type reports SLOT_TYPE_MISMATCH");

    // A01 is being kept for a booking, so a walk-in must be sent to A02.
    EntryOutcome walkIn;
    check(lot.checkInWalkIn(car("MH33CC3333"), kBaseTime, walkIn).ok, "a walk-in car is parked");
    checkEqualText(walkIn.slotId, "A02", "the walk-in avoids the reserved slot");

    EntryOutcome blocked;
    Result noRoom = lot.checkInWalkIn(car("MH44DD4444"), kBaseTime, blocked);
    check(!noRoom.ok, "a reserved slot is not handed to a second walk-in");
    checkEqualText(noRoom.errorCode, "LOT_FULL", "the protected slot leaves the lot full");

    // Checking in too early, then inside the window.
    EntryOutcome early;
    Result tooEarly = lot.checkInReservation(first.reservationId, "MH12AB1234", kBaseTime, early);
    check(!tooEarly.ok, "a reservation cannot be checked in before it starts");
    checkEqualText(tooEarly.errorCode, "RESERVATION_NOT_STARTED",
                   "an early arrival reports RESERVATION_NOT_STARTED");

    EntryOutcome wrongPlate;
    Result mismatchedPlate = lot.checkInReservation(first.reservationId, "MH00XX0000",
                                                    kBaseTime + kHour, wrongPlate);
    check(!mismatchedPlate.ok, "a different plate cannot use the reservation");
    checkEqualText(mismatchedPlate.errorCode, "REGISTRATION_MISMATCH",
                   "a wrong plate reports REGISTRATION_MISMATCH");

    EntryOutcome arrival;
    Result checkedIn =
        lot.checkInReservation(first.reservationId, "MH12AB1234", kBaseTime + kHour, arrival);
    check(checkedIn.ok, "the reserved vehicle checks in inside its window");
    checkEqualText(arrival.slotId, "A01", "it is parked in the slot that was held for it");

    const Reservation* used = lot.findReservation(first.reservationId);
    check(used != nullptr && used->status() == ReservationStatus::CHECKED_IN,
          "the reservation is marked CHECKED_IN");

    EntryOutcome reused;
    Result secondUse =
        lot.checkInReservation(first.reservationId, "MH12AB1234", kBaseTime + kHour, reused);
    check(!secondUse.ok, "a reservation cannot be checked in twice");

    // Cancelling, and refusing to cancel something already used.
    Result cancelUsed = lot.cancelReservation(first.reservationId, kBaseTime + kHour);
    check(!cancelUsed.ok, "a checked-in reservation cannot be cancelled");
    checkEqualText(cancelUsed.errorCode, "INVALID_RESERVATION_STATE",
                   "cancelling a used booking reports INVALID_RESERVATION_STATE");

    Result cancelUpcoming = lot.cancelReservation(touching.reservationId, kBaseTime + kHour);
    check(cancelUpcoming.ok, "an upcoming reservation can be cancelled");
    const Reservation* cancelled = lot.findReservation(touching.reservationId);
    check(cancelled != nullptr && cancelled->status() == ReservationStatus::CANCELLED,
          "the cancelled reservation is marked CANCELLED");

    Result cancelMissing = lot.cancelReservation("RS-NOT-REAL", kBaseTime + kHour);
    checkEqualText(cancelMissing.errorCode, "RESERVATION_NOT_FOUND",
                   "cancelling an unknown booking reports RESERVATION_NOT_FOUND");
}

void testReservationExpiry() {
    group("Reservations - expiry and grace period");

    const fs::path directory = makeEmptyDirectory("expiry");
    FileManager files(directory.string());
    ParkingLot lot(files);
    check(lot.initialise(kBaseTime).ok, "the car park starts up");
    useSmallLayout(lot, {{"A01", VehicleType::CAR}});

    const long long graceSeconds = lot.settings().reservationGraceSeconds();
    checkEqual(graceSeconds, 30 * 60, "the default grace period is 30 minutes");

    ReservationOutcome booking;
    check(lot.createReservation("MH12AB1234", VehicleType::CAR, kBaseTime + kHour,
                                kBaseTime + 3 * kHour, "A01", kBaseTime, booking)
              .ok,
          "a reservation is created");

    // Still inside the grace period.
    Result sweepEarly = lot.expireLapsedReservations(kBaseTime + kHour + graceSeconds - 60);
    check(sweepEarly.ok, "the expiry sweep runs");
    const Reservation* stillValid = lot.findReservation(booking.reservationId);
    check(stillValid != nullptr && stillValid->status() == ReservationStatus::UPCOMING,
          "a booking inside its grace period is still UPCOMING");

    // One second past the grace deadline.
    check(lot.expireLapsedReservations(kBaseTime + kHour + graceSeconds + 1).ok,
          "the expiry sweep runs again");
    const Reservation* lapsed = lot.findReservation(booking.reservationId);
    check(lapsed != nullptr && lapsed->status() == ReservationStatus::EXPIRED,
          "a missed booking becomes EXPIRED");

    const ParkingSlot* freed = lot.findSlot("A01");
    check(freed != nullptr && lot.displayStateOf(*freed) == SlotDisplayState::AVAILABLE,
          "an expired booking releases its hold on the slot");

    EntryOutcome walkIn;
    check(lot.checkInWalkIn(car("MH55EE5555"), kBaseTime + 2 * kHour, walkIn).ok,
          "the freed slot can now take a walk-in");

    EntryOutcome tooLate;
    Result lateArrival = lot.checkInReservation(booking.reservationId, "MH12AB1234",
                                                kBaseTime + 2 * kHour, tooLate);
    check(!lateArrival.ok, "an expired booking cannot be checked in");
    checkEqualText(lateArrival.errorCode, "INVALID_RESERVATION_STATE",
                   "an expired booking reports INVALID_RESERVATION_STATE");
}

// ---------------------------------------------------------------------------
// Waiting queue
// ---------------------------------------------------------------------------

void testQueue() {
    group("Waiting queue");

    const fs::path directory = makeEmptyDirectory("queue");
    FileManager files(directory.string());
    ParkingLot lot(files);
    check(lot.initialise(kBaseTime).ok, "the car park starts up");
    useSmallLayout(lot, {{"A01", VehicleType::CAR}, {"E01", VehicleType::BIKE}});

    EntryOutcome parkedCar;
    EntryOutcome parkedBike;
    check(lot.checkInWalkIn(car("MH01AA0001"), kBaseTime, parkedCar).ok, "a car fills the car slot");
    check(lot.checkInWalkIn(bike("MH01BB0002"), kBaseTime, parkedBike).ok,
          "a bike fills the bike slot");

    QueueOutcome firstWaiter;
    Result queuedBike = lot.addToQueue(bike("MH02CC0003"), kBaseTime + 60, firstWaiter);
    check(queuedBike.ok, "a bike joins the waiting queue");
    checkEqual(firstWaiter.position, 1, "the first waiter is at position 1");

    QueueOutcome duplicateWaiter;
    Result twice = lot.addToQueue(bike("MH02CC0003"), kBaseTime + 70, duplicateWaiter);
    check(!twice.ok, "the same plate cannot queue twice");
    checkEqualText(twice.errorCode, "DUPLICATE_QUEUE_REQUEST",
                   "a repeat request reports DUPLICATE_QUEUE_REQUEST");

    QueueOutcome parkedAlready;
    Result alreadyInside = lot.addToQueue(car("MH01AA0001"), kBaseTime + 70, parkedAlready);
    check(!alreadyInside.ok, "a vehicle that is already parked cannot queue");
    checkEqualText(alreadyInside.errorCode, "DUPLICATE_ACTIVE_REGISTRATION",
                   "a parked vehicle reports DUPLICATE_ACTIVE_REGISTRATION");

    QueueOutcome secondWaiter;
    Result queuedCar = lot.addToQueue(car("MH03DD0004"), kBaseTime + 120, secondWaiter);
    check(queuedCar.ok, "a car joins the queue behind the bike");
    checkEqual(secondWaiter.position, 2, "the second waiter is at position 2");
    checkEqual(lot.queue().waitingCount(), 2, "two vehicles are waiting");

    // The car slot frees up. The oldest waiter is a bike, which cannot use
    // it, so the queue must skip ahead to the car rather than leave the
    // slot standing empty.
    ExitOutcome exit;
    check(lot.checkOut(parkedCar.ticketId, kBaseTime + 3600, exit).ok, "the parked car leaves");
    check(exit.queueAssignment.happened, "a waiting vehicle takes the freed slot");
    checkEqualText(exit.queueAssignment.registrationNumber, "MH03DD0004",
                   "the compatible car is chosen, not the older bike");
    checkEqualText(exit.queueAssignment.slotId, "A01", "it is given the car slot");

    const QueueRequest* assigned = lot.queue().findById(secondWaiter.requestId);
    check(assigned != nullptr && assigned->status() == QueueStatus::ASSIGNED,
          "the served request is marked ASSIGNED");
    check(lot.findActiveTicketByRegistration("MH03DD0004") != nullptr,
          "the queued car now has an active ticket");
    checkEqual(lot.queue().waitingCount(), 1, "the bike is still waiting");

    Result cancelAssigned = lot.cancelQueueRequest(secondWaiter.requestId);
    check(!cancelAssigned.ok, "an assigned request cannot be cancelled");
    checkEqualText(cancelAssigned.errorCode, "INVALID_QUEUE_STATE",
                   "cancelling an assigned request reports INVALID_QUEUE_STATE");

    Result cancelWaiting = lot.cancelQueueRequest(firstWaiter.requestId);
    check(cancelWaiting.ok, "a waiting request can be cancelled");
    checkEqual(lot.queue().waitingCount(), 0, "the queue is empty again");

    Result cancelMissing = lot.cancelQueueRequest("QR-NOT-REAL");
    checkEqualText(cancelMissing.errorCode, "QUEUE_REQUEST_NOT_FOUND",
                   "cancelling an unknown request reports QUEUE_REQUEST_NOT_FOUND");

    // Queueing is only for when there is genuinely no room.
    ExitOutcome bikeExit;
    check(lot.checkOut(parkedBike.ticketId, kBaseTime + 3600, bikeExit).ok, "the bike leaves");
    QueueOutcome pointless;
    Result roomAvailable = lot.addToQueue(bike("MH04EE0005"), kBaseTime + 3700, pointless);
    check(!roomAvailable.ok, "queueing is refused while a suitable slot is free");
    checkEqualText(roomAvailable.errorCode, "SLOT_AVAILABLE",
                   "an unnecessary request reports SLOT_AVAILABLE");
}

void testQueueRespectsReservations() {
    group("Waiting queue - reservations still win");

    const fs::path directory = makeEmptyDirectory("queue-reservation");
    FileManager files(directory.string());
    ParkingLot lot(files);
    check(lot.initialise(kBaseTime).ok, "the car park starts up");
    useSmallLayout(lot, {{"A01", VehicleType::CAR}});

    // Two bookings on the single slot, one after the other.
    ReservationOutcome nowBooking;
    check(lot.createReservation("MH12AB1234", VehicleType::CAR, kBaseTime, kBaseTime + kHour,
                                "A01", kBaseTime, nowBooking)
              .ok,
          "a booking starting immediately is created");

    ReservationOutcome laterBooking;
    check(lot.createReservation("MH77GG7777", VehicleType::CAR, kBaseTime + kHour,
                                kBaseTime + 2 * kHour, "A01", kBaseTime, laterBooking)
              .ok,
          "a second booking is created for the hour after");

    EntryOutcome arrival;
    check(lot.checkInReservation(nowBooking.reservationId, "MH12AB1234", kBaseTime, arrival).ok,
          "the first booked vehicle arrives");

    QueueOutcome waiter;
    check(lot.addToQueue(car("MH88HH8888"), kBaseTime + 60, waiter).ok,
          "another car joins the queue because the lot is full");

    // The slot frees up, but the second booking is still holding it.
    ExitOutcome exit;
    check(lot.checkOut(arrival.ticketId, kBaseTime + 30 * 60, exit).ok,
          "the first booked vehicle leaves");
    check(!exit.queueAssignment.happened,
          "the waiting car is NOT given a slot that is held for a reservation");
    checkEqual(lot.queue().waitingCount(), 1, "the car is still waiting");

    const ParkingSlot* slot = lot.findSlot("A01");
    check(slot != nullptr && lot.displayStateOf(*slot) == SlotDisplayState::RESERVED,
          "the freed slot shows as Reserved");
}

// A checkout is not the only way a slot becomes usable. These three tests
// cover the other ways, because a vehicle must never sit in the queue while
// a slot it could use stands empty.
void testQueueIsServedWhenAReservationIsCancelled() {
    group("Waiting queue - a cancelled booking admits the waiting vehicle");

    const fs::path directory = makeEmptyDirectory("queue-cancel");
    FileManager files(directory.string());
    ParkingLot lot(files);
    check(lot.initialise(kBaseTime).ok, "the car park starts up");
    useSmallLayout(lot, {{"A01", VehicleType::CAR}});

    ReservationOutcome booking;
    check(lot.createReservation("MH12AB1234", VehicleType::CAR, kBaseTime + kHour,
                                kBaseTime + 2 * kHour, "A01", kBaseTime, booking)
              .ok,
          "the only slot is reserved");

    QueueOutcome waiter;
    check(lot.addToQueue(car("MH88HH8888"), kBaseTime + 60, waiter).ok,
          "a car joins the queue because the reserved slot is unavailable");

    check(lot.cancelReservation(booking.reservationId, kBaseTime + 120).ok,
          "the booking is cancelled");

    check(lot.findActiveTicketByRegistration("MH88HH8888") != nullptr,
          "the waiting car is admitted as soon as the booking lets go of the slot");
    checkEqual(lot.queue().waitingCount(), 0, "nobody is left waiting");

    const QueueRequest* served = lot.queue().findById(waiter.requestId);
    check(served != nullptr && served->status() == QueueStatus::ASSIGNED,
          "its request is marked ASSIGNED");
    checkEqualText(served != nullptr ? served->assignedSlotId() : "", "A01",
                   "it was given the slot the booking released");

    const ParkingSlot* taken = lot.findSlot("A01");
    check(taken != nullptr && taken->isOccupied(),
          "the slot is occupied rather than left standing empty");
}

void testQueueIsServedWhenAReservationExpires() {
    group("Waiting queue - an expired booking admits the waiting vehicle");

    const fs::path directory = makeEmptyDirectory("queue-expiry");
    FileManager files(directory.string());
    ParkingLot lot(files);
    check(lot.initialise(kBaseTime).ok, "the car park starts up");
    useSmallLayout(lot, {{"A01", VehicleType::CAR}});

    ReservationOutcome booking;
    check(lot.createReservation("MH12AB1234", VehicleType::CAR, kBaseTime + kHour,
                                kBaseTime + 3 * kHour, "A01", kBaseTime, booking)
              .ok,
          "the only slot is reserved");

    QueueOutcome waiter;
    check(lot.addToQueue(car("MH88HH8888"), kBaseTime + 60, waiter).ok,
          "a car joins the queue");

    const long long grace = lot.settings().reservationGraceSeconds();

    // Inside the grace period the booking still holds the slot.
    check(lot.expireLapsedReservations(kBaseTime + kHour + grace - 60).ok, "an early sweep runs");
    checkEqual(lot.queue().waitingCount(), 1,
               "the car still waits while the booking may yet be used");

    // Past the deadline the booking lapses and the slot becomes usable.
    check(lot.expireLapsedReservations(kBaseTime + kHour + grace + 1).ok, "the later sweep runs");
    check(lot.findActiveTicketByRegistration("MH88HH8888") != nullptr,
          "the waiting car is admitted when the booking expires");
    checkEqual(lot.queue().waitingCount(), 0, "nobody is left waiting");
}

void testQueueIsServedWhenCapacityIsAdded() {
    group("Waiting queue - added capacity admits the waiting vehicles");

    const fs::path directory = makeEmptyDirectory("queue-capacity");
    FileManager files(directory.string());
    ParkingLot lot(files);
    check(lot.initialise(kBaseTime).ok, "the car park starts up");
    useSmallLayout(lot, {{"A01", VehicleType::CAR}});

    EntryOutcome parked;
    check(lot.checkInWalkIn(car("MH01AA0001"), kBaseTime, parked).ok, "the only slot is filled");

    QueueOutcome firstWaiter;
    QueueOutcome secondWaiter;
    check(lot.addToQueue(car("MH88HH8888"), kBaseTime + 60, firstWaiter).ok,
          "one car joins the queue");
    check(lot.addToQueue(bike("MH77BB7777"), kBaseTime + 90, secondWaiter).ok,
          "a bike joins the queue behind it");

    // Two new slots: one for the waiting car, one for the waiting bike.
    Result grown = lot.updateSettings(lot.settings(),
                                      slotList({{"A01", VehicleType::CAR},
                                                {"A02", VehicleType::CAR},
                                                {"E01", VehicleType::BIKE}}),
                                      kBaseTime + 120);
    check(grown.ok, "the layout grows to three slots");

    check(lot.findActiveTicketByRegistration("MH88HH8888") != nullptr,
          "the waiting car is admitted into the new car slot");
    check(lot.findActiveTicketByRegistration("MH77BB7777") != nullptr,
          "the waiting bike is admitted into the new bike slot");
    checkEqual(lot.queue().waitingCount(), 0, "the queue is empty");
    checkEqual(lot.occupiedSlotCount(), 3, "all three slots are now in use");

    // The parked car was not disturbed by any of it.
    const ParkingSlot* original = lot.findSlot("A01");
    check(original != nullptr && original->activeTicketId() == parked.ticketId,
          "the car that was already parked keeps its slot and its ticket");
}

void testOwnerNameIsChecked() {
    group("Owner names");

    check(Vehicle::isValidOwnerName(""), "a blank owner name is allowed");
    check(Vehicle::isValidOwnerName("Sharma, Rahul \"Raj\""),
          "punctuation in a name is allowed");
    check(!Vehicle::isValidOwnerName(std::string(61, 'a')), "an over-long name is rejected");
    check(Vehicle::isValidOwnerName(std::string(60, 'a')), "a name of exactly 60 is allowed");
    check(!Vehicle::isValidOwnerName("two\nlines"), "a line break in a name is rejected");

    const fs::path directory = makeEmptyDirectory("owner-name");
    FileManager files(directory.string());
    ParkingLot lot(files);
    check(lot.initialise(kBaseTime).ok, "the car park starts up");
    useSmallLayout(lot, {{"A01", VehicleType::CAR}});

    EntryOutcome refused;
    Result tooLong = lot.checkInWalkIn(
        Car("MH12AB1234", std::string(200, 'x')), kBaseTime, refused);
    check(!tooLong.ok, "an entry with an over-long owner name is refused");
    checkEqualText(tooLong.errorCode, "INVALID_OWNER_NAME",
                   "it reports INVALID_OWNER_NAME");
    checkEqual(static_cast<long long>(lot.tickets().size()), 0, "no ticket was created");
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

void testPersistence() {
    group("Persistence - records survive a restart");

    const fs::path directory = makeEmptyDirectory("persistence");

    std::string savedTicketId;
    std::string savedReservationId;

    {
        FileManager files(directory.string());
        ParkingLot lot(files);
        check(lot.initialise(kBaseTime).ok, "a brand new car park starts with no data files");
        check(fs::exists(directory / "config.json"), "config.json is created on the first run");

        useSmallLayout(lot, {{"A01", VehicleType::CAR}, {"A02", VehicleType::CAR}});

        EntryOutcome entry;
        check(lot.checkInWalkIn(car("MH12AB1234"), kBaseTime, entry).ok, "a car is checked in");
        savedTicketId = entry.ticketId;

        ReservationOutcome booking;
        check(lot.createReservation("MH66FF6666", VehicleType::CAR, kBaseTime + kHour,
                                    kBaseTime + 2 * kHour, "A02", kBaseTime, booking)
                  .ok,
              "a reservation is created");
        savedReservationId = booking.reservationId;
    }

    {
        // A completely separate program run, reading the same folder.
        FileManager files(directory.string());
        ParkingLot lot(files);
        check(lot.initialise(kBaseTime + 60).ok, "the saved car park loads again");

        checkEqual(lot.totalSlotCount(), 2, "the slot layout was remembered");
        const ParkingTicket* ticket = lot.findTicket(savedTicketId);
        check(ticket != nullptr, "the active ticket was remembered");
        check(ticket != nullptr && ticket->isActive(), "it is still an active session");
        checkEqualText(ticket != nullptr ? ticket->slotId() : "", "A01",
                       "it is still in the same slot");

        const ParkingSlot* slot = lot.findSlot("A01");
        check(slot != nullptr && slot->isOccupied(), "the slot is occupied again after the restart");

        const Reservation* booking = lot.findReservation(savedReservationId);
        check(booking != nullptr && booking->status() == ReservationStatus::UPCOMING,
              "the reservation was remembered and is still upcoming");

        const ParkingSlot* reserved = lot.findSlot("A02");
        check(reserved != nullptr && lot.displayStateOf(*reserved) == SlotDisplayState::RESERVED,
              "the reserved slot is still protected after the restart");

        // And the session can still be closed normally.
        ExitOutcome exit;
        check(lot.checkOut(savedTicketId, kBaseTime + 3600, exit).ok,
              "the restored session can be checked out");
        checkEqual(exit.finalFeePaise, 3000, "the fee is calculated from the restored entry time");
    }
}

void testCorruptFileIsNotWiped() {
    group("Persistence - a damaged file is never silently wiped");

    const fs::path directory = makeEmptyDirectory("corrupt");

    {
        FileManager files(directory.string());
        ParkingLot lot(files);
        check(lot.initialise(kBaseTime).ok, "the car park starts up");

        EntryOutcome first;
        check(lot.checkInWalkIn(car("MH12AB1234"), kBaseTime, first).ok, "a car is checked in");
        // A second save rotates the first car's file into tickets.json.bak,
        // which is what the .bak copy is for: the last known good version.
        EntryOutcome second;
        check(lot.checkInWalkIn(car("MH99ZZ9999"), kBaseTime + 60, second).ok,
              "a second car is checked in, rotating the previous file into .bak");
    }

    // Something damages the file - a crash during a copy, or a hand edit.
    const fs::path ticketsPath = directory / "tickets.json";
    {
        std::ofstream damage(ticketsPath, std::ios::binary | std::ios::trunc);
        damage << "{ \"tickets\": [ { broken";
    }

    {
        FileManager files(directory.string());
        ParkingLot lot(files);
        Result loaded = lot.initialise(kBaseTime + 60);
        check(!loaded.ok, "the car park refuses to start on a damaged file");
        checkEqualText(loaded.errorCode, "PERSISTENCE_FAILED",
                       "a damaged file reports PERSISTENCE_FAILED");
        check(loaded.message.find("tickets.json") != std::string::npos,
              "the message names the file that needs attention");
    }

    // The important part: the damaged file was not replaced with an empty
    // one, and the previous good copy is still sitting next to it.
    std::ifstream stillThere(ticketsPath, std::ios::binary);
    std::string contents((std::istreambuf_iterator<char>(stillThere)),
                         std::istreambuf_iterator<char>());
    check(contents.find("broken") != std::string::npos,
          "the damaged file is left exactly as it was");
    check(fs::exists(directory / "tickets.json.bak"),
          "the previous good copy is still available as tickets.json.bak");

    std::ifstream backup(directory / "tickets.json.bak", std::ios::binary);
    std::string backupContents((std::istreambuf_iterator<char>(backup)),
                               std::istreambuf_iterator<char>());
    check(backupContents.find("MH12AB1234") != std::string::npos,
          "the backup holds the last good version of the records");
    check(JsonCodec::Json::parse(backupContents, nullptr, false).is_discarded() == false,
          "the backup is readable JSON, so it can be restored by hand");

    // An empty file is treated the same way, not as "all records deleted".
    const fs::path emptyDirectory = makeEmptyDirectory("emptyfile");
    {
        FileManager files(emptyDirectory.string());
        ParkingLot lot(files);
        check(lot.initialise(kBaseTime).ok, "a second car park starts up");
        EntryOutcome entry;
        check(lot.checkInWalkIn(car("MH12AB1234"), kBaseTime, entry).ok, "a car is checked in");
    }
    {
        std::ofstream truncate(emptyDirectory / "tickets.json",
                               std::ios::binary | std::ios::trunc);
    }
    {
        FileManager files(emptyDirectory.string());
        ParkingLot lot(files);
        Result loaded = lot.initialise(kBaseTime + 60);
        check(!loaded.ok, "an empty data file is treated as damage, not as an empty car park");
    }
}

void testFailedSaveIsRolledBack() {
    group("Persistence - a failed save undoes the change");

    const fs::path directory = makeEmptyDirectory("failed-save");
    FileManager files(directory.string());
    ParkingLot lot(files);
    check(lot.initialise(kBaseTime).ok, "the car park starts up");
    useSmallLayout(lot, {{"A01", VehicleType::CAR}});

    // Block the write by putting a folder where the temporary file needs
    // to go. This is the closest a test can get to a disk problem.
    std::error_code code;
    fs::create_directory(directory / "tickets.json.tmp", code);
    check(!code, "a blocker is placed in the way of the next save");

    EntryOutcome entry;
    Result blocked = lot.checkInWalkIn(car("MH12AB1234"), kBaseTime, entry);
    check(!blocked.ok, "the check-in reports failure when it cannot be saved");
    checkEqualText(blocked.errorCode, "PERSISTENCE_FAILED",
                   "a blocked save reports PERSISTENCE_FAILED");

    // The important part: nothing was left half-done in memory either.
    checkEqual(lot.occupiedSlotCount(), 0, "no slot was marked occupied");
    checkEqual(static_cast<long long>(lot.tickets().size()), 0, "no ticket was kept");
    check(lot.findActiveTicketByRegistration("MH12AB1234") == nullptr,
          "the vehicle has no active session");

    fs::remove_all(directory / "tickets.json.tmp", code);

    EntryOutcome retry;
    check(lot.checkInWalkIn(car("MH12AB1234"), kBaseTime, retry).ok,
          "the same check-in succeeds once the problem is cleared");
    checkEqual(lot.occupiedSlotCount(), 1, "the slot is occupied after the successful save");
}

void testTariffChangeDoesNotRewriteOldBills() {
    group("Settings - a price change leaves running and finished bills alone");

    const fs::path directory = makeEmptyDirectory("tariff");
    FileManager files(directory.string());
    ParkingLot lot(files);
    check(lot.initialise(kBaseTime).ok, "the car park starts up");
    useSmallLayout(lot, {{"A01", VehicleType::CAR}, {"A02", VehicleType::CAR}});

    EntryOutcome early;
    check(lot.checkInWalkIn(car("MH12AB1234"), kBaseTime, early).ok,
          "a car enters at the original Rs 30 rate");

    ParkingSettings dearer = lot.settings();
    dearer.carHourlyRatePaise = 9000; // Rs 90
    std::vector<SlotDefinition> sameSlots =
        slotList({{"A01", VehicleType::CAR}, {"A02", VehicleType::CAR}});
    check(lot.updateSettings(dearer, sameSlots, kBaseTime).ok, "the car rate is raised to Rs 90");
    checkEqual(lot.settings().carHourlyRatePaise, 9000, "the new rate is stored");

    // The running session keeps the rate it started on.
    ExitOutcome exit;
    check(lot.checkOut(early.ticketId, kBaseTime + 3600, exit).ok, "the early car leaves");
    checkEqual(exit.hourlyRatePaise, 3000, "it is billed at the rate captured when it entered");
    checkEqual(exit.finalFeePaise, 3000, "one hour at Rs 30 is Rs 30");

    // A new session picks up the new rate.
    EntryOutcome later;
    check(lot.checkInWalkIn(car("MH99ZZ9999"), kBaseTime + 7200, later).ok, "a second car enters");
    ExitOutcome laterExit;
    check(lot.checkOut(later.ticketId, kBaseTime + 10800, laterExit).ok, "the second car leaves");
    checkEqual(laterExit.finalFeePaise, 9000, "the newer session is billed at Rs 90");

    // And the finished bill is not rewritten by a later change.
    ParkingSettings cheaper = lot.settings();
    cheaper.carHourlyRatePaise = 1000;
    check(lot.updateSettings(cheaper, sameSlots, kBaseTime).ok, "the rate is lowered again");
    const ParkingTicket* finished = lot.findTicket(later.ticketId);
    checkEqual(finished != nullptr ? finished->finalFeePaise() : -1, 9000,
               "the completed bill still reads Rs 90");
}

void testSettingsProtectVehiclesAndBookings() {
    group("Settings - capacity changes cannot disturb real vehicles");

    const fs::path directory = makeEmptyDirectory("capacity");
    FileManager files(directory.string());
    ParkingLot lot(files);
    check(lot.initialise(kBaseTime).ok, "the car park starts up");
    useSmallLayout(lot, {{"A01", VehicleType::CAR}, {"A02", VehicleType::CAR},
                         {"A03", VehicleType::CAR}});

    EntryOutcome parked;
    check(lot.checkInWalkIn(car("MH12AB1234"), kBaseTime, parked).ok, "a car parks in A01");

    ReservationOutcome booking;
    check(lot.createReservation("MH66FF6666", VehicleType::CAR, kBaseTime + kHour,
                                kBaseTime + 2 * kHour, "A02", kBaseTime, booking)
              .ok,
          "A02 is reserved");

    // Removing an occupied slot.
    Result removeOccupied = lot.updateSettings(
        lot.settings(), slotList({{"A02", VehicleType::CAR}, {"A03", VehicleType::CAR}}),
        kBaseTime);
    check(!removeOccupied.ok, "an occupied slot cannot be removed");
    checkEqualText(removeOccupied.errorCode, "SLOT_IN_USE",
                   "removing an occupied slot reports SLOT_IN_USE");

    // Removing a reserved slot.
    Result removeReserved = lot.updateSettings(
        lot.settings(), slotList({{"A01", VehicleType::CAR}, {"A03", VehicleType::CAR}}),
        kBaseTime);
    check(!removeReserved.ok, "a reserved slot cannot be removed");
    checkEqualText(removeReserved.errorCode, "SLOT_RESERVED",
                   "removing a reserved slot reports SLOT_RESERVED");

    // Changing the type of an occupied slot.
    Result retypeOccupied = lot.updateSettings(
        lot.settings(), slotList({{"A01", VehicleType::BIKE}, {"A02", VehicleType::CAR},
                                  {"A03", VehicleType::CAR}}),
        kBaseTime);
    check(!retypeOccupied.ok, "an occupied slot cannot change vehicle type");

    // Duplicate ids.
    Result duplicates = lot.updateSettings(
        lot.settings(), slotList({{"A01", VehicleType::CAR}, {"A01", VehicleType::CAR}}),
        kBaseTime);
    check(!duplicates.ok, "two slots cannot share an id");
    checkEqualText(duplicates.errorCode, "DUPLICATE_SLOT_ID",
                   "a repeated id reports DUPLICATE_SLOT_ID");

    // Negative and zero rates.
    ParkingSettings badRates = lot.settings();
    badRates.carHourlyRatePaise = -100;
    Result negative = lot.updateSettings(badRates, slotList({{"A01", VehicleType::CAR},
                                                             {"A02", VehicleType::CAR},
                                                             {"A03", VehicleType::CAR}}),
                                         kBaseTime);
    check(!negative.ok, "a negative hourly rate is refused");
    checkEqualText(negative.errorCode, "INVALID_SETTINGS",
                   "a bad rate reports INVALID_SETTINGS");

    // Removing a slot that is genuinely free is fine, and the parked car
    // stays exactly where it was.
    Result shrink = lot.updateSettings(
        lot.settings(), slotList({{"A01", VehicleType::CAR}, {"A02", VehicleType::CAR}}),
        kBaseTime);
    check(shrink.ok, "a free slot can be removed");
    checkEqual(lot.totalSlotCount(), 2, "the layout now has 2 slots");
    const ParkingSlot* stillParked = lot.findSlot("A01");
    check(stillParked != nullptr && stillParked->isOccupied(),
          "the parked car is undisturbed by the capacity change");
}

// ---------------------------------------------------------------------------
// Reports and CSV
// ---------------------------------------------------------------------------

void testReportsAndCsv() {
    group("Reports and CSV export");

    const fs::path directory = makeEmptyDirectory("reports");
    FileManager files(directory.string());
    ParkingLot lot(files);
    check(lot.initialise(kBaseTime).ok, "the car park starts up");
    useSmallLayout(lot, {{"A01", VehicleType::CAR}, {"E01", VehicleType::BIKE}});

    EntryOutcome carEntry;
    check(lot.checkInWalkIn(car("MH12AB1234"), kBaseTime, carEntry).ok, "a car enters");
    ExitOutcome carExit;
    check(lot.checkOut(carEntry.ticketId, kBaseTime + 3600, carExit).ok, "the car leaves");

    EntryOutcome bikeEntry;
    check(lot.checkInWalkIn(bike("MH01XY0001"), kBaseTime + 1800, bikeEntry).ok, "a bike enters");

    const ReportSummary summary = ReportService::buildSummary(lot, 0, 0);
    checkEqual(summary.totalVehiclesServed, 2, "both sessions are counted as vehicles served");
    checkEqual(summary.completedSessions, 1, "only the finished session is complete");
    checkEqual(summary.activeSessions, 1, "the bike is still parked");
    checkEqual(summary.totalRevenuePaise, 3000, "revenue counts only the finished session");
    checkEqual(static_cast<long long>(summary.vehicleTypeDistribution.size()), 2,
               "both vehicle types appear in the distribution");
    checkEqual(summary.averageDurationMinutes, 60, "the average duration is one hour");

    // A window that excludes everything.
    const ReportSummary empty =
        ReportService::buildSummary(lot, kBaseTime - 10 * kHour, kBaseTime - 5 * kHour);
    checkEqual(empty.totalVehiclesServed, 0, "an empty window reports no vehicles");
    checkEqual(empty.totalRevenuePaise, 0, "an empty window reports no revenue");
    checkEqual(empty.peakEntryHour, -1, "an empty window has no peak hour");

    // History filtering.
    HistoryFilter all;
    checkEqual(static_cast<long long>(ReportService::filterHistory(lot, all).size()), 2,
               "an unfiltered search returns both sessions");

    HistoryFilter activeOnly;
    activeOnly.statusFilter = "ACTIVE";
    const auto activeRows = ReportService::filterHistory(lot, activeOnly);
    checkEqual(static_cast<long long>(activeRows.size()), 1, "the ACTIVE filter returns one row");
    checkEqualText(activeRows.empty() ? "" : activeRows[0]->registrationNumber(), "MH01XY0001",
                   "the ACTIVE filter returns the bike");

    HistoryFilter byPlate;
    byPlate.searchText = "mh12ab";
    checkEqual(static_cast<long long>(ReportService::filterHistory(lot, byPlate).size()), 1,
               "a partial plate search is case insensitive");

    HistoryFilter noMatch;
    noMatch.searchText = "ZZZZZZ";
    checkEqual(static_cast<long long>(ReportService::filterHistory(lot, noMatch).size()), 0,
               "a search with no matches returns nothing");

    // Hourly traffic: 24 fixed rows, a session counted as an arrival in the
    // hour it entered and a departure in the hour it left.
    const std::vector<HourlyTraffic> traffic = ReportService::buildHourlyTraffic(lot, 0, 0);
    checkEqual(static_cast<long long>(traffic.size()), 24, "hourly traffic always has 24 rows");

    long long totalEntries = 0;
    long long totalExits = 0;
    for (const HourlyTraffic& hour : traffic) {
        totalEntries += hour.entries;
        totalExits += hour.exits;
    }
    checkEqual(totalEntries, 2, "both sessions are counted as arrivals");
    checkEqual(totalExits, 1, "only the finished session is counted as a departure");

    const int entryHour = TimeUtil::localHourOf(kBaseTime);
    checkEqual(traffic[static_cast<std::size_t>(entryHour)].entries, 1,
               "the car's arrival lands in the hour it entered");

    const ReportSummary wholeDay = ReportService::buildSummary(lot, 0, 0);
    checkEqual(traffic[static_cast<std::size_t>(wholeDay.peakEntryHour)].entries,
               wholeDay.peakEntryHourCount,
               "the busiest hour agrees with the summary's peak hour");

    const std::vector<HourlyTraffic> noWindow =
        ReportService::buildHourlyTraffic(lot, kBaseTime - 10 * kHour, kBaseTime - 5 * kHour);
    long long outsideEntries = 0;
    for (const HourlyTraffic& hour : noWindow) {
        outsideEntries += hour.entries;
    }
    checkEqual(static_cast<long long>(noWindow.size()), 24,
               "an empty window still reports 24 rows");
    checkEqual(outsideEntries, 0, "a window with nothing in it counts no arrivals");

    // CSV escaping.
    checkEqualText(ReportService::escapeCsvField("plain"), "plain", "a plain field is untouched");
    checkEqualText(ReportService::escapeCsvField("has,comma"), "\"has,comma\"",
                   "a comma forces quoting");
    checkEqualText(ReportService::escapeCsvField("say \"hi\""), "\"say \"\"hi\"\"\"",
                   "an inner quote is doubled");
    checkEqualText(ReportService::escapeCsvField("line1\nline2"), "\"line1\nline2\"",
                   "a line break forces quoting");

    // A spreadsheet treats a leading =, +, - or @ as the start of a formula,
    // so a typed field that begins with one is marked as text.
    checkEqualText(ReportService::escapeCsvTextField("Rahul"), "Rahul",
                   "an ordinary name is untouched");
    checkEqualText(ReportService::escapeCsvTextField("=1+1"), "'=1+1",
                   "a leading equals sign is neutralised");
    checkEqualText(ReportService::escapeCsvTextField("@SUM(A1)"), "'@SUM(A1)",
                   "a leading at sign is neutralised");
    checkEqualText(ReportService::escapeCsvTextField("=cmd,danger"), "\"'=cmd,danger\"",
                   "a formula with a comma is both marked and quoted");

    const std::string csv = ReportService::toCsv(ReportService::filterHistory(lot, all));

    // The file opens with a UTF-8 byte-order mark so that a spreadsheet reads
    // an owner name written in a local script correctly, and the header row
    // follows immediately after it.
    const std::string bom = {static_cast<char>(0xEF),
                             static_cast<char>(0xBB),
                             static_cast<char>(0xBF)};
    check(csv.rfind(bom, 0) == 0, "the CSV starts with a UTF-8 byte-order mark");
    check(csv.find("Ticket ID,Registration Number") == bom.size(),
          "the header row follows the mark");
    check(csv.find("MH12AB1234") != std::string::npos, "the CSV contains the finished session");
    check(csv.find("MH01XY0001") != std::string::npos, "the CSV contains the active session");

    // An owner name containing a comma must not break the column layout.
    const fs::path trickyDirectory = makeEmptyDirectory("csv-escape");
    FileManager trickyFiles(trickyDirectory.string());
    ParkingLot trickyLot(trickyFiles);
    check(trickyLot.initialise(kBaseTime).ok, "a second car park starts up");
    useSmallLayout(trickyLot, {{"A01", VehicleType::CAR}});
    EntryOutcome tricky;
    check(trickyLot
              .checkInWalkIn(Car("MH12AB1234", "Sharma, Rahul \"Raj\""),
                             kBaseTime, tricky)
              .ok,
          "a vehicle with a comma and quotes in the owner name is checked in");
    HistoryFilter everything;
    const std::string trickyCsv =
        ReportService::toCsv(ReportService::filterHistory(trickyLot, everything));
    check(trickyCsv.find("\"Sharma, Rahul \"\"Raj\"\"\"") != std::string::npos,
          "the awkward owner name is escaped correctly in the CSV");
}

} // namespace

void testBackupsArePruned() {
    group("Backups - the folder cannot grow without limit");

    const fs::path directory = makeEmptyDirectory("backups");
    FileManager files(directory.string());
    ParkingLot lot(files);
    check(lot.initialise(kBaseTime).ok, "a car park starts up");

    // Backup folders are named to the second, so taking several in a row would
    // land in the same folder. The names are made directly instead, which is
    // what matters: pruning works off the names, not off the clock.
    const fs::path root = directory / "backups";
    fs::create_directories(root);
    for (int day = 1; day <= 15; day++) {
        char name[32];
        std::snprintf(name, sizeof(name), "backup-202610%02d-120000", day);
        fs::create_directories(root / name);
    }
    check(countBackupFolders(root) == 15, "fifteen old backups are sitting in the folder");

    std::string problem;
    std::string folder;
    check(files.backupNow(problem, folder), "a new backup is taken");

    const int kept = countBackupFolders(root);
    check(kept == FileManager::kBackupsToKeep, "only the newest ten are kept");
    check(fs::exists(root / "backup-20261015-120000"), "the newest of the old ones survived");
    check(!fs::exists(root / "backup-20261001-120000"), "the oldest was removed");
    check(fs::exists(folder), "the backup just taken is one of the survivors");
}

int main() {
    std::cout << "ParkWise business rule tests\n";
    std::cout << "============================\n";

    testBilling();
    testRegistrationValidation();
    testVehicleKinds();
    testParkingOperations();
    testReservations();
    testReservationExpiry();
    testQueue();
    testQueueRespectsReservations();
    testQueueIsServedWhenAReservationIsCancelled();
    testQueueIsServedWhenAReservationExpires();
    testQueueIsServedWhenCapacityIsAdded();
    testOwnerNameIsChecked();
    testPersistence();
    testCorruptFileIsNotWiped();
    testFailedSaveIsRolledBack();
    testTariffChangeDoesNotRewriteOldBills();
    testSettingsProtectVehiclesAndBookings();
    testReportsAndCsv();
    testBackupsArePruned();

    std::cout << "\n============================\n";
    std::cout << checksRun - checksFailed << " of " << checksRun << " checks passed\n";
    if (checksFailed > 0) {
        std::cout << checksFailed << " FAILED\n";
        return 1;
    }
    std::cout << "All checks passed.\n";
    return 0;
}
