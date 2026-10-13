#ifndef PARKWISE_PARKING_TICKET_H
#define PARKWISE_PARKING_TICKET_H

#include "Types.h"
#include "Vehicle.h"
#include <string>

namespace parkwise {

// One parking session, from the moment a vehicle enters until it leaves.
//
// The hourly rate is copied into the ticket when the session starts. That
// single decision is what makes a later tariff change in Settings leave
// older bills untouched.
class ParkingTicket {
public:
    ParkingTicket() = default;
    ParkingTicket(const std::string& id,
                  const Vehicle& vehicle,
                  const std::string& slotId,
                  Timestamp entryTime,
                  Paise hourlyRatePaise,
                  TicketSource source);

    const std::string& id() const { return id_; }
    const std::string& registrationNumber() const { return registrationNumber_; }
    VehicleType vehicleType() const { return vehicleType_; }
    const std::string& ownerName() const { return ownerName_; }
    const std::string& contactNumber() const { return contactNumber_; }
    const std::string& slotId() const { return slotId_; }
    Timestamp entryTime() const { return entryTime_; }
    Timestamp exitTime() const { return exitTime_; }
    Paise hourlyRatePaise() const { return hourlyRatePaise_; }
    long long billableHours() const { return billableHours_; }
    Paise finalFeePaise() const { return finalFeePaise_; }
    TicketStatus status() const { return status_; }
    TicketSource source() const { return source_; }

    bool isActive() const { return status_ == TicketStatus::ACTIVE; }

    // Closes the session: stores the exit time and the final bill, using
    // the rate captured at entry. Returns false if the ticket was already
    // completed, which is how a repeated checkout is refused.
    bool complete(Timestamp exitTime);

    // Live duration and fee for a session that is still running. These are
    // estimates shown before the operator confirms, never stored.
    long long elapsedMinutes(Timestamp now) const;
    Paise estimatedFeePaise(Timestamp now) const;

    // Used by FileManager when rebuilding a ticket that was saved earlier.
    static ParkingTicket fromStoredValues(const std::string& id,
                                          const std::string& registrationNumber,
                                          VehicleType vehicleType,
                                          const std::string& ownerName,
                                          const std::string& contactNumber,
                                          const std::string& slotId,
                                          Timestamp entryTime,
                                          Timestamp exitTime,
                                          Paise hourlyRatePaise,
                                          long long billableHours,
                                          Paise finalFeePaise,
                                          TicketStatus status,
                                          TicketSource source);

private:
    std::string id_;
    std::string registrationNumber_;
    VehicleType vehicleType_ = VehicleType::CAR;
    std::string ownerName_;
    std::string contactNumber_;
    std::string slotId_;
    Timestamp entryTime_ = 0;
    Timestamp exitTime_ = 0;        // 0 means "still parked"
    Paise hourlyRatePaise_ = 0;
    long long billableHours_ = 0;
    Paise finalFeePaise_ = 0;
    TicketStatus status_ = TicketStatus::ACTIVE;
    TicketSource source_ = TicketSource::WALK_IN;
};

} // namespace parkwise

#endif
