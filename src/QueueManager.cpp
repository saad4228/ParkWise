#include "QueueManager.h"

namespace parkwise {

QueueRequest::QueueRequest(const std::string& id,
                           const std::string& registrationNumber,
                           VehicleType vehicleType,
                           const std::string& ownerName,
                           const std::string& contactNumber,
                           Timestamp arrivalTime)
    : id_(id),
      registrationNumber_(registrationNumber),
      vehicleType_(vehicleType),
      ownerName_(ownerName),
      contactNumber_(contactNumber),
      arrivalTime_(arrivalTime),
      status_(QueueStatus::WAITING) {}

bool QueueRequest::assign(const std::string& slotId, const std::string& ticketId) {
    if (status_ != QueueStatus::WAITING) {
        return false;
    }
    status_ = QueueStatus::ASSIGNED;
    assignedSlotId_ = slotId;
    assignedTicketId_ = ticketId;
    return true;
}

bool QueueRequest::cancel() {
    if (status_ != QueueStatus::WAITING) {
        return false;
    }
    status_ = QueueStatus::CANCELLED;
    return true;
}

QueueRequest QueueRequest::fromStoredValues(const std::string& id,
                                            const std::string& registrationNumber,
                                            VehicleType vehicleType,
                                            const std::string& ownerName,
                                            const std::string& contactNumber,
                                            Timestamp arrivalTime,
                                            QueueStatus status,
                                            const std::string& assignedSlotId,
                                            const std::string& assignedTicketId) {
    QueueRequest request;
    request.id_ = id;
    request.registrationNumber_ = registrationNumber;
    request.vehicleType_ = vehicleType;
    request.ownerName_ = ownerName;
    request.contactNumber_ = contactNumber;
    request.arrivalTime_ = arrivalTime;
    request.status_ = status;
    request.assignedSlotId_ = assignedSlotId;
    request.assignedTicketId_ = assignedTicketId;
    return request;
}

void QueueManager::add(const QueueRequest& request) {
    requests_.push_back(request);
}

const QueueRequest* QueueManager::findNextCompatible(VehicleType slotType) const {
    for (const QueueRequest& request : requests_) {
        if (request.isWaiting() && request.vehicleType() == slotType) {
            return &request; // the vector is in arrival order, so this is the oldest
        }
    }
    return nullptr;
}

QueueRequest* QueueManager::findMutable(const std::string& requestId) {
    for (QueueRequest& request : requests_) {
        if (request.id() == requestId) {
            return &request;
        }
    }
    return nullptr;
}

bool QueueManager::markAssigned(const std::string& requestId,
                                const std::string& slotId,
                                const std::string& ticketId) {
    QueueRequest* request = findMutable(requestId);
    return request != nullptr && request->assign(slotId, ticketId);
}

bool QueueManager::cancel(const std::string& requestId) {
    QueueRequest* request = findMutable(requestId);
    return request != nullptr && request->cancel();
}

const QueueRequest* QueueManager::findById(const std::string& requestId) const {
    for (const QueueRequest& request : requests_) {
        if (request.id() == requestId) {
            return &request;
        }
    }
    return nullptr;
}

bool QueueManager::hasWaitingRegistration(const std::string& registrationNumber) const {
    for (const QueueRequest& request : requests_) {
        if (request.isWaiting() && request.registrationNumber() == registrationNumber) {
            return true;
        }
    }
    return false;
}

int QueueManager::positionOf(const std::string& requestId) const {
    int position = 0;
    for (const QueueRequest& request : requests_) {
        if (request.isWaiting()) {
            position++;
            if (request.id() == requestId) {
                return position;
            }
        }
    }
    return 0;
}

int QueueManager::waitingCount() const {
    int count = 0;
    for (const QueueRequest& request : requests_) {
        if (request.isWaiting()) {
            count++;
        }
    }
    return count;
}

} // namespace parkwise
