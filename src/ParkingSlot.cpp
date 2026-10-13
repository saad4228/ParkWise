#include "ParkingSlot.h"

namespace parkwise {

ParkingSlot::ParkingSlot(const std::string& id, VehicleType supportedType)
    : id_(id), supportedType_(supportedType) {}

void ParkingSlot::occupy(const std::string& ticketId) {
    occupied_ = true;
    activeTicketId_ = ticketId;
}

void ParkingSlot::release() {
    occupied_ = false;
    activeTicketId_.clear();
}

} // namespace parkwise
