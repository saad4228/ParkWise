#include "ParkingTicket.h"
#include "BillingService.h"

namespace parkwise {

ParkingTicket::ParkingTicket(const std::string& id,
                             const Vehicle& vehicle,
                             const std::string& slotId,
                             Timestamp entryTime,
                             Paise hourlyRatePaise,
                             TicketSource source)
    : id_(id),
      registrationNumber_(vehicle.registrationNumber()),
      vehicleType_(vehicle.type()),
      ownerName_(vehicle.ownerName()),
      contactNumber_(vehicle.contactNumber()),
      slotId_(slotId),
      entryTime_(entryTime),
      hourlyRatePaise_(hourlyRatePaise),
      status_(TicketStatus::ACTIVE),
      source_(source) {}

bool ParkingTicket::complete(Timestamp exitTime) {
    if (status_ == TicketStatus::COMPLETED) {
        return false;
    }
    if (exitTime < entryTime_) {
        exitTime = entryTime_; // a clock change must never create a negative bill
    }

    exitTime_ = exitTime;
    long long minutes = BillingService::durationMinutes(entryTime_, exitTime_);
    billableHours_ = BillingService::billableHours(minutes);
    finalFeePaise_ = BillingService::feePaise(billableHours_, hourlyRatePaise_);
    status_ = TicketStatus::COMPLETED;
    return true;
}

long long ParkingTicket::elapsedMinutes(Timestamp now) const {
    Timestamp until = (status_ == TicketStatus::COMPLETED) ? exitTime_ : now;
    return BillingService::durationMinutes(entryTime_, until);
}

Paise ParkingTicket::estimatedFeePaise(Timestamp now) const {
    if (status_ == TicketStatus::COMPLETED) {
        return finalFeePaise_;
    }
    return BillingService::feeForSession(entryTime_, now, hourlyRatePaise_);
}

ParkingTicket ParkingTicket::fromStoredValues(const std::string& id,
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
                                              TicketSource source) {
    ParkingTicket ticket;
    ticket.id_ = id;
    ticket.registrationNumber_ = registrationNumber;
    ticket.vehicleType_ = vehicleType;
    ticket.ownerName_ = ownerName;
    ticket.contactNumber_ = contactNumber;
    ticket.slotId_ = slotId;
    ticket.entryTime_ = entryTime;
    ticket.exitTime_ = exitTime;
    ticket.hourlyRatePaise_ = hourlyRatePaise;
    ticket.billableHours_ = billableHours;
    ticket.finalFeePaise_ = finalFeePaise;
    ticket.status_ = status;
    ticket.source_ = source;
    return ticket;
}

} // namespace parkwise
