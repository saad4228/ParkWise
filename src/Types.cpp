#include "Types.h"

namespace parkwise {

// Each enum gets a matching pair of conversion helpers. The string form is
// what travels over the API and what we write into the JSON files, so these
// two functions are the only place the spelling of a state is decided.

std::string vehicleTypeToString(VehicleType type) {
    switch (type) {
        case VehicleType::BIKE: return "BIKE";
        case VehicleType::CAR:  return "CAR";
        case VehicleType::SUV:  return "SUV";
    }
    return "CAR";
}

bool vehicleTypeFromString(const std::string& text, VehicleType& outType) {
    if (text == "BIKE") { outType = VehicleType::BIKE; return true; }
    if (text == "CAR")  { outType = VehicleType::CAR;  return true; }
    if (text == "SUV")  { outType = VehicleType::SUV;  return true; }
    return false;
}

std::string ticketStatusToString(TicketStatus status) {
    return status == TicketStatus::ACTIVE ? "ACTIVE" : "COMPLETED";
}

bool ticketStatusFromString(const std::string& text, TicketStatus& outStatus) {
    if (text == "ACTIVE")    { outStatus = TicketStatus::ACTIVE;    return true; }
    if (text == "COMPLETED") { outStatus = TicketStatus::COMPLETED; return true; }
    return false;
}

std::string ticketSourceToString(TicketSource source) {
    switch (source) {
        case TicketSource::WALK_IN:     return "WALK_IN";
        case TicketSource::RESERVATION: return "RESERVATION";
        case TicketSource::QUEUE:       return "QUEUE";
    }
    return "WALK_IN";
}

bool ticketSourceFromString(const std::string& text, TicketSource& outSource) {
    if (text == "WALK_IN")     { outSource = TicketSource::WALK_IN;     return true; }
    if (text == "RESERVATION") { outSource = TicketSource::RESERVATION; return true; }
    if (text == "QUEUE")       { outSource = TicketSource::QUEUE;       return true; }
    return false;
}

std::string reservationStatusToString(ReservationStatus status) {
    switch (status) {
        case ReservationStatus::UPCOMING:   return "UPCOMING";
        case ReservationStatus::CHECKED_IN: return "CHECKED_IN";
        case ReservationStatus::COMPLETED:  return "COMPLETED";
        case ReservationStatus::CANCELLED:  return "CANCELLED";
        case ReservationStatus::EXPIRED:    return "EXPIRED";
    }
    return "UPCOMING";
}

bool reservationStatusFromString(const std::string& text, ReservationStatus& outStatus) {
    if (text == "UPCOMING")   { outStatus = ReservationStatus::UPCOMING;   return true; }
    if (text == "CHECKED_IN") { outStatus = ReservationStatus::CHECKED_IN; return true; }
    if (text == "COMPLETED")  { outStatus = ReservationStatus::COMPLETED;  return true; }
    if (text == "CANCELLED")  { outStatus = ReservationStatus::CANCELLED;  return true; }
    if (text == "EXPIRED")    { outStatus = ReservationStatus::EXPIRED;    return true; }
    return false;
}

std::string queueStatusToString(QueueStatus status) {
    switch (status) {
        case QueueStatus::WAITING:   return "WAITING";
        case QueueStatus::ASSIGNED:  return "ASSIGNED";
        case QueueStatus::CANCELLED: return "CANCELLED";
    }
    return "WAITING";
}

bool queueStatusFromString(const std::string& text, QueueStatus& outStatus) {
    if (text == "WAITING")   { outStatus = QueueStatus::WAITING;   return true; }
    if (text == "ASSIGNED")  { outStatus = QueueStatus::ASSIGNED;  return true; }
    if (text == "CANCELLED") { outStatus = QueueStatus::CANCELLED; return true; }
    return false;
}

} // namespace parkwise
