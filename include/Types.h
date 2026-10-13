#ifndef PARKWISE_TYPES_H
#define PARKWISE_TYPES_H

// Small shared vocabulary used across the whole backend:
// the vehicle types we support, the money/time units we store,
// and the Result object that every business operation returns.

#include <string>
#include <ctime>

namespace parkwise {

// Money is always stored as whole paise (1 rupee = 100 paise) so that
// adding up fees can never drift the way floating point values do.
using Paise = long long;

// Timestamps are Unix epoch seconds. The browser converts them to local time.
using Timestamp = long long;

enum class VehicleType { BIKE, CAR, SUV };

std::string vehicleTypeToString(VehicleType type);

// Returns false when the text is not one of BIKE / CAR / SUV.
bool vehicleTypeFromString(const std::string& text, VehicleType& outType);

enum class TicketStatus { ACTIVE, COMPLETED };

std::string ticketStatusToString(TicketStatus status);
bool ticketStatusFromString(const std::string& text, TicketStatus& outStatus);

// How a parking session was started. Useful in history and reports.
enum class TicketSource { WALK_IN, RESERVATION, QUEUE };

std::string ticketSourceToString(TicketSource source);
bool ticketSourceFromString(const std::string& text, TicketSource& outSource);

enum class ReservationStatus { UPCOMING, CHECKED_IN, COMPLETED, CANCELLED, EXPIRED };

std::string reservationStatusToString(ReservationStatus status);
bool reservationStatusFromString(const std::string& text, ReservationStatus& outStatus);

enum class QueueStatus { WAITING, ASSIGNED, CANCELLED };

std::string queueStatusToString(QueueStatus status);
bool queueStatusFromString(const std::string& text, QueueStatus& outStatus);

// Every business operation reports success or failure through this object
// instead of throwing. The error code is also sent to the browser, which
// lets the frontend react to specific problems (for example a full lot).
struct Result {
    bool ok = true;
    std::string errorCode;
    std::string message;

    static Result success() { return Result{true, "", ""}; }

    static Result failure(const std::string& code, const std::string& text) {
        return Result{false, code, text};
    }
};

} // namespace parkwise

#endif
