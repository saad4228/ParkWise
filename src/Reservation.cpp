#include "Reservation.h"

#include <algorithm>

namespace parkwise {

Reservation::Reservation(const std::string& id,
                         const std::string& registrationNumber,
                         VehicleType vehicleType,
                         const std::string& slotId,
                         Timestamp startTime,
                         Timestamp endTime,
                         Timestamp createdAt)
    : id_(id),
      registrationNumber_(registrationNumber),
      vehicleType_(vehicleType),
      slotId_(slotId),
      startTime_(startTime),
      endTime_(endTime),
      createdAt_(createdAt),
      status_(ReservationStatus::UPCOMING) {}

bool Reservation::overlaps(Timestamp otherStart, Timestamp otherEnd) const {
    // Half-open intervals: they clash only if each one starts before the
    // other ends. Touching at a single instant is allowed.
    return startTime_ < otherEnd && otherStart < endTime_;
}

bool Reservation::cancel() {
    if (status_ != ReservationStatus::UPCOMING) {
        return false;
    }
    status_ = ReservationStatus::CANCELLED;
    return true;
}

bool Reservation::expire() {
    if (status_ != ReservationStatus::UPCOMING) {
        return false;
    }
    status_ = ReservationStatus::EXPIRED;
    return true;
}

bool Reservation::checkIn(const std::string& ticketId) {
    if (status_ != ReservationStatus::UPCOMING) {
        return false;
    }
    status_ = ReservationStatus::CHECKED_IN;
    ticketId_ = ticketId;
    return true;
}

bool Reservation::complete() {
    if (status_ != ReservationStatus::CHECKED_IN) {
        return false;
    }
    status_ = ReservationStatus::COMPLETED;
    return true;
}

bool Reservation::isCheckInAllowed(Timestamp now, long long graceSeconds) const {
    if (status_ != ReservationStatus::UPCOMING) {
        return false;
    }
    if (now < startTime_) {
        return false; // arriving before the booked period has begun
    }
    // The window closes at the grace deadline, or at the end of the
    // booking itself if that comes first.
    Timestamp deadline = std::min<Timestamp>(startTime_ + graceSeconds, endTime_);
    return now <= deadline;
}

bool Reservation::hasLapsed(Timestamp now, long long graceSeconds) const {
    if (status_ != ReservationStatus::UPCOMING) {
        return false;
    }
    Timestamp deadline = std::min<Timestamp>(startTime_ + graceSeconds, endTime_);
    return now > deadline;
}

Reservation Reservation::fromStoredValues(const std::string& id,
                                          const std::string& registrationNumber,
                                          VehicleType vehicleType,
                                          const std::string& slotId,
                                          Timestamp startTime,
                                          Timestamp endTime,
                                          Timestamp createdAt,
                                          ReservationStatus status,
                                          const std::string& ticketId) {
    Reservation reservation;
    reservation.id_ = id;
    reservation.registrationNumber_ = registrationNumber;
    reservation.vehicleType_ = vehicleType;
    reservation.slotId_ = slotId;
    reservation.startTime_ = startTime;
    reservation.endTime_ = endTime;
    reservation.createdAt_ = createdAt;
    reservation.status_ = status;
    reservation.ticketId_ = ticketId;
    return reservation;
}

} // namespace parkwise
