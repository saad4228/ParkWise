#include "JsonCodec.h"

namespace parkwise {
namespace JsonCodec {

namespace {

// Small guarded readers. A stored file may have been edited by hand or
// truncated by a crash, so nothing is assumed about what is in it.

bool readString(const Json& value, const char* key, std::string& out, std::string& errorMessage) {
    if (!value.contains(key) || !value.at(key).is_string()) {
        errorMessage = std::string("Missing text field: ") + key;
        return false;
    }
    out = value.at(key).get<std::string>();
    return true;
}

std::string readOptionalString(const Json& value, const char* key) {
    if (value.contains(key) && value.at(key).is_string()) {
        return value.at(key).get<std::string>();
    }
    return std::string();
}

bool readNumber(const Json& value, const char* key, long long& out, std::string& errorMessage) {
    if (!value.contains(key) || !value.at(key).is_number_integer()) {
        errorMessage = std::string("Missing whole-number field: ") + key;
        return false;
    }
    out = value.at(key).get<long long>();
    return true;
}

long long readOptionalNumber(const Json& value, const char* key, long long fallback) {
    if (value.contains(key) && value.at(key).is_number_integer()) {
        return value.at(key).get<long long>();
    }
    return fallback;
}

bool readVehicleType(const Json& value, const char* key, VehicleType& out, std::string& errorMessage) {
    std::string text;
    if (!readString(value, key, text, errorMessage)) {
        return false;
    }
    if (!vehicleTypeFromString(text, out)) {
        errorMessage = "Unknown vehicle type: " + text;
        return false;
    }
    return true;
}

} // namespace

Json toJson(const ParkingSlot& slot) {
    Json value;
    value["slotId"] = slot.id();
    value["supportedVehicleType"] = vehicleTypeToString(slot.supportedType());
    value["occupied"] = slot.isOccupied();
    value["activeTicketId"] = slot.activeTicketId();
    return value;
}

Json toJson(const ParkingTicket& ticket) {
    Json value;
    value["ticketId"] = ticket.id();
    value["registrationNumber"] = ticket.registrationNumber();
    value["vehicleType"] = vehicleTypeToString(ticket.vehicleType());
    value["ownerName"] = ticket.ownerName();
    value["contactNumber"] = ticket.contactNumber();
    value["slotId"] = ticket.slotId();
    value["entryTime"] = ticket.entryTime();
    value["exitTime"] = ticket.exitTime();
    value["hourlyRatePaise"] = ticket.hourlyRatePaise();
    value["billableHours"] = ticket.billableHours();
    value["finalFeePaise"] = ticket.finalFeePaise();
    value["status"] = ticketStatusToString(ticket.status());
    value["source"] = ticketSourceToString(ticket.source());
    return value;
}

Json toJson(const Reservation& reservation) {
    Json value;
    value["reservationId"] = reservation.id();
    value["registrationNumber"] = reservation.registrationNumber();
    value["vehicleType"] = vehicleTypeToString(reservation.vehicleType());
    value["slotId"] = reservation.slotId();
    value["startTime"] = reservation.startTime();
    value["endTime"] = reservation.endTime();
    value["createdAt"] = reservation.createdAt();
    value["status"] = reservationStatusToString(reservation.status());
    value["ticketId"] = reservation.ticketId();
    return value;
}

Json toJson(const QueueRequest& request) {
    Json value;
    value["requestId"] = request.id();
    value["registrationNumber"] = request.registrationNumber();
    value["vehicleType"] = vehicleTypeToString(request.vehicleType());
    value["ownerName"] = request.ownerName();
    value["contactNumber"] = request.contactNumber();
    value["arrivalTime"] = request.arrivalTime();
    value["status"] = queueStatusToString(request.status());
    value["assignedSlotId"] = request.assignedSlotId();
    value["assignedTicketId"] = request.assignedTicketId();
    return value;
}

Json toJson(const ParkingSettings& settings) {
    Json value;
    value["bikeHourlyRatePaise"] = settings.bikeHourlyRatePaise;
    value["carHourlyRatePaise"] = settings.carHourlyRatePaise;
    value["suvHourlyRatePaise"] = settings.suvHourlyRatePaise;
    value["reservationGraceMinutes"] = settings.reservationGraceMinutes;
    value["currency"] = settings.currency;
    return value;
}

bool slotFromJson(const Json& value, ParkingSlot& outSlot, std::string& errorMessage) {
    if (!value.is_object()) {
        errorMessage = "A slot record is not a JSON object.";
        return false;
    }

    std::string slotId;
    VehicleType supportedType = VehicleType::CAR;
    if (!readString(value, "slotId", slotId, errorMessage)) return false;
    if (!readVehicleType(value, "supportedVehicleType", supportedType, errorMessage)) return false;
    if (slotId.empty()) {
        errorMessage = "A slot record has an empty slot id.";
        return false;
    }

    outSlot = ParkingSlot(slotId, supportedType);

    // Occupancy is restored so that a restart does not lose parked vehicles.
    // ParkingLot re-checks it against the active tickets after loading.
    bool occupied = value.contains("occupied") && value.at("occupied").is_boolean() &&
                    value.at("occupied").get<bool>();
    if (occupied) {
        outSlot.occupy(readOptionalString(value, "activeTicketId"));
    }
    return true;
}

bool ticketFromJson(const Json& value, ParkingTicket& outTicket, std::string& errorMessage) {
    if (!value.is_object()) {
        errorMessage = "A ticket record is not a JSON object.";
        return false;
    }

    std::string ticketId;
    std::string registrationNumber;
    std::string slotId;
    std::string statusText;
    VehicleType vehicleType = VehicleType::CAR;
    long long entryTime = 0;
    long long hourlyRatePaise = 0;

    if (!readString(value, "ticketId", ticketId, errorMessage)) return false;
    if (!readString(value, "registrationNumber", registrationNumber, errorMessage)) return false;
    if (!readVehicleType(value, "vehicleType", vehicleType, errorMessage)) return false;
    if (!readString(value, "slotId", slotId, errorMessage)) return false;
    if (!readNumber(value, "entryTime", entryTime, errorMessage)) return false;
    if (!readNumber(value, "hourlyRatePaise", hourlyRatePaise, errorMessage)) return false;
    if (!readString(value, "status", statusText, errorMessage)) return false;

    TicketStatus status = TicketStatus::ACTIVE;
    if (!ticketStatusFromString(statusText, status)) {
        errorMessage = "Unknown ticket status: " + statusText;
        return false;
    }

    long long exitTime = readOptionalNumber(value, "exitTime", 0);
    long long billableHours = readOptionalNumber(value, "billableHours", 0);
    long long finalFeePaise = readOptionalNumber(value, "finalFeePaise", 0);

    if (status == TicketStatus::COMPLETED && exitTime < entryTime) {
        errorMessage = "Ticket " + ticketId + " has an exit time before its entry time.";
        return false;
    }

    TicketSource source = TicketSource::WALK_IN;
    ticketSourceFromString(readOptionalString(value, "source"), source);

    outTicket = ParkingTicket::fromStoredValues(
        ticketId, registrationNumber, vehicleType,
        readOptionalString(value, "ownerName"),
        readOptionalString(value, "contactNumber"),
        slotId, entryTime, exitTime, hourlyRatePaise,
        billableHours, finalFeePaise, status, source);
    return true;
}

bool reservationFromJson(const Json& value, Reservation& outReservation, std::string& errorMessage) {
    if (!value.is_object()) {
        errorMessage = "A reservation record is not a JSON object.";
        return false;
    }

    std::string reservationId;
    std::string registrationNumber;
    std::string slotId;
    std::string statusText;
    VehicleType vehicleType = VehicleType::CAR;
    long long startTime = 0;
    long long endTime = 0;

    if (!readString(value, "reservationId", reservationId, errorMessage)) return false;
    if (!readString(value, "registrationNumber", registrationNumber, errorMessage)) return false;
    if (!readVehicleType(value, "vehicleType", vehicleType, errorMessage)) return false;
    if (!readString(value, "slotId", slotId, errorMessage)) return false;
    if (!readNumber(value, "startTime", startTime, errorMessage)) return false;
    if (!readNumber(value, "endTime", endTime, errorMessage)) return false;
    if (!readString(value, "status", statusText, errorMessage)) return false;

    if (endTime <= startTime) {
        errorMessage = "Reservation " + reservationId + " ends at or before it starts.";
        return false;
    }

    ReservationStatus status = ReservationStatus::UPCOMING;
    if (!reservationStatusFromString(statusText, status)) {
        errorMessage = "Unknown reservation status: " + statusText;
        return false;
    }

    outReservation = Reservation::fromStoredValues(
        reservationId, registrationNumber, vehicleType, slotId,
        startTime, endTime, readOptionalNumber(value, "createdAt", startTime),
        status, readOptionalString(value, "ticketId"));
    return true;
}

bool queueRequestFromJson(const Json& value, QueueRequest& outRequest, std::string& errorMessage) {
    if (!value.is_object()) {
        errorMessage = "A queue record is not a JSON object.";
        return false;
    }

    std::string requestId;
    std::string registrationNumber;
    std::string statusText;
    VehicleType vehicleType = VehicleType::CAR;
    long long arrivalTime = 0;

    if (!readString(value, "requestId", requestId, errorMessage)) return false;
    if (!readString(value, "registrationNumber", registrationNumber, errorMessage)) return false;
    if (!readVehicleType(value, "vehicleType", vehicleType, errorMessage)) return false;
    if (!readNumber(value, "arrivalTime", arrivalTime, errorMessage)) return false;
    if (!readString(value, "status", statusText, errorMessage)) return false;

    QueueStatus status = QueueStatus::WAITING;
    if (!queueStatusFromString(statusText, status)) {
        errorMessage = "Unknown queue status: " + statusText;
        return false;
    }

    outRequest = QueueRequest::fromStoredValues(
        requestId, registrationNumber, vehicleType,
        readOptionalString(value, "ownerName"),
        readOptionalString(value, "contactNumber"),
        arrivalTime, status,
        readOptionalString(value, "assignedSlotId"),
        readOptionalString(value, "assignedTicketId"));
    return true;
}

bool settingsFromJson(const Json& value, ParkingSettings& outSettings, std::string& errorMessage) {
    if (!value.is_object()) {
        errorMessage = "The settings record is not a JSON object.";
        return false;
    }

    ParkingSettings settings;
    if (!readNumber(value, "bikeHourlyRatePaise", settings.bikeHourlyRatePaise, errorMessage)) return false;
    if (!readNumber(value, "carHourlyRatePaise", settings.carHourlyRatePaise, errorMessage)) return false;
    if (!readNumber(value, "suvHourlyRatePaise", settings.suvHourlyRatePaise, errorMessage)) return false;

    settings.reservationGraceMinutes = readOptionalNumber(value, "reservationGraceMinutes", 30);
    std::string currency = readOptionalString(value, "currency");
    if (!currency.empty()) {
        settings.currency = currency;
    }

    if (!settings.isValid(errorMessage)) {
        return false;
    }
    outSettings = settings;
    return true;
}

} // namespace JsonCodec
} // namespace parkwise
