#ifndef PARKWISE_RESERVATION_H
#define PARKWISE_RESERVATION_H

#include "Types.h"
#include <string>

namespace parkwise {

// A booking that holds one slot for one vehicle over a time interval.
//
// Intervals are start-inclusive and end-exclusive, written [start, end).
// Two bookings that merely touch - one ending exactly when the next
// begins - therefore do not clash.
class Reservation {
public:
    Reservation() = default;
    Reservation(const std::string& id,
                const std::string& registrationNumber,
                VehicleType vehicleType,
                const std::string& slotId,
                Timestamp startTime,
                Timestamp endTime,
                Timestamp createdAt);

    const std::string& id() const { return id_; }
    const std::string& registrationNumber() const { return registrationNumber_; }
    VehicleType vehicleType() const { return vehicleType_; }
    const std::string& slotId() const { return slotId_; }
    Timestamp startTime() const { return startTime_; }
    Timestamp endTime() const { return endTime_; }
    Timestamp createdAt() const { return createdAt_; }
    ReservationStatus status() const { return status_; }
    const std::string& ticketId() const { return ticketId_; }

    // True while the booking still has a claim on its slot, which is what
    // stops a walk-in vehicle from being parked there.
    bool holdsSlot() const { return status_ == ReservationStatus::UPCOMING; }

    bool overlaps(Timestamp otherStart, Timestamp otherEnd) const;

    // Allowed only from UPCOMING. Each returns false on an invalid change,
    // which is how a cancelled or expired booking refuses to be reused.
    bool cancel();
    bool expire();
    bool checkIn(const std::string& ticketId);

    // The vehicle left, so the booking is finished for good.
    bool complete();

    // Check-in is permitted from the scheduled start until the grace
    // period runs out, and never past the end of the booked interval.
    bool isCheckInAllowed(Timestamp now, long long graceSeconds) const;

    // The same rule seen from the other side: the booking was missed.
    bool hasLapsed(Timestamp now, long long graceSeconds) const;

    static Reservation fromStoredValues(const std::string& id,
                                        const std::string& registrationNumber,
                                        VehicleType vehicleType,
                                        const std::string& slotId,
                                        Timestamp startTime,
                                        Timestamp endTime,
                                        Timestamp createdAt,
                                        ReservationStatus status,
                                        const std::string& ticketId);

private:
    std::string id_;
    std::string registrationNumber_;
    VehicleType vehicleType_ = VehicleType::CAR;
    std::string slotId_;
    Timestamp startTime_ = 0;
    Timestamp endTime_ = 0;
    Timestamp createdAt_ = 0;
    ReservationStatus status_ = ReservationStatus::UPCOMING;
    std::string ticketId_; // filled in once the vehicle actually arrives
};

} // namespace parkwise

#endif
