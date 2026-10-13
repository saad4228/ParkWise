#ifndef PARKWISE_PARKING_SLOT_H
#define PARKWISE_PARKING_SLOT_H

#include "Types.h"
#include <string>

namespace parkwise {

// One physical parking space, for example "A01".
//
// A slot only knows whether a vehicle is physically standing in it.
// It deliberately knows nothing about reservations: whether a slot looks
// "Reserved" on screen is worked out by ParkingLot, which can see the
// reservation list and the current time.
class ParkingSlot {
public:
    ParkingSlot() = default;
    ParkingSlot(const std::string& id, VehicleType supportedType);

    const std::string& id() const { return id_; }
    VehicleType supportedType() const { return supportedType_; }
    bool isOccupied() const { return occupied_; }
    const std::string& activeTicketId() const { return activeTicketId_; }

    // A slot accepts exactly one kind of vehicle. Keeping the rule this
    // strict makes allocation easy to predict and easy to explain.
    bool accepts(VehicleType type) const { return supportedType_ == type; }

    void occupy(const std::string& ticketId);
    void release();

    // Used by the settings screen when an operator re-labels a free slot.
    void setSupportedType(VehicleType type) { supportedType_ = type; }

private:
    std::string id_;
    VehicleType supportedType_ = VehicleType::CAR;
    bool occupied_ = false;
    std::string activeTicketId_;
};

} // namespace parkwise

#endif
