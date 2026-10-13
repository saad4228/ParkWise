#ifndef PARKWISE_QUEUE_MANAGER_H
#define PARKWISE_QUEUE_MANAGER_H

#include "Types.h"
#include <string>
#include <vector>

namespace parkwise {

// One vehicle waiting for a space to free up.
class QueueRequest {
public:
    QueueRequest() = default;
    QueueRequest(const std::string& id,
                 const std::string& registrationNumber,
                 VehicleType vehicleType,
                 const std::string& ownerName,
                 const std::string& contactNumber,
                 Timestamp arrivalTime);

    const std::string& id() const { return id_; }
    const std::string& registrationNumber() const { return registrationNumber_; }
    VehicleType vehicleType() const { return vehicleType_; }
    const std::string& ownerName() const { return ownerName_; }
    const std::string& contactNumber() const { return contactNumber_; }
    Timestamp arrivalTime() const { return arrivalTime_; }
    QueueStatus status() const { return status_; }
    const std::string& assignedSlotId() const { return assignedSlotId_; }
    const std::string& assignedTicketId() const { return assignedTicketId_; }

    bool isWaiting() const { return status_ == QueueStatus::WAITING; }

    bool assign(const std::string& slotId, const std::string& ticketId);
    bool cancel();

    static QueueRequest fromStoredValues(const std::string& id,
                                         const std::string& registrationNumber,
                                         VehicleType vehicleType,
                                         const std::string& ownerName,
                                         const std::string& contactNumber,
                                         Timestamp arrivalTime,
                                         QueueStatus status,
                                         const std::string& assignedSlotId,
                                         const std::string& assignedTicketId);

private:
    std::string id_;
    std::string registrationNumber_;
    VehicleType vehicleType_ = VehicleType::CAR;
    std::string ownerName_;
    std::string contactNumber_;
    Timestamp arrivalTime_ = 0;
    QueueStatus status_ = QueueStatus::WAITING;
    std::string assignedSlotId_;
    std::string assignedTicketId_;
};

// Keeps the waiting list in arrival order.
//
// A plain std::queue was not used on purpose. When a car space opens up
// the oldest waiter might be a bike, and leaving a usable space empty
// would be worse than skipping that one request - so the list has to be
// scanned, and entries in the middle have to be cancellable.
class QueueManager {
public:
    // Appends a new request. Callers check for duplicates beforehand.
    void add(const QueueRequest& request);

    // Oldest waiting request that matches the vehicle type, or nullptr.
    const QueueRequest* findNextCompatible(VehicleType slotType) const;

    bool markAssigned(const std::string& requestId,
                      const std::string& slotId,
                      const std::string& ticketId);

    bool cancel(const std::string& requestId);

    const QueueRequest* findById(const std::string& requestId) const;

    // Used to refuse a second request for a vehicle already in the line.
    bool hasWaitingRegistration(const std::string& registrationNumber) const;

    // 1-based place in the line among waiting requests, or 0 if it is not
    // waiting any more.
    int positionOf(const std::string& requestId) const;

    int waitingCount() const;

    const std::vector<QueueRequest>& all() const { return requests_; }

    void replaceAll(const std::vector<QueueRequest>& requests) { requests_ = requests; }

private:
    QueueRequest* findMutable(const std::string& requestId);

    // Arrival order is simply the order of this vector.
    std::vector<QueueRequest> requests_;
};

} // namespace parkwise

#endif
