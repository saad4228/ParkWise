#include "BillingService.h"

namespace parkwise {

long long BillingService::durationMinutes(Timestamp entryTime, Timestamp exitTime) {
    if (exitTime <= entryTime) {
        return 0;
    }
    // Integer division drops the leftover seconds, so a session is only
    // billed once it has completed a full minute.
    return (exitTime - entryTime) / 60;
}

long long BillingService::billableHours(long long durationMinutes) {
    if (durationMinutes <= 0) {
        return 0;
    }
    // Ceiling division: 1..60 minutes -> 1 hour, 61..120 minutes -> 2 hours.
    return (durationMinutes + 59) / 60;
}

Paise BillingService::feePaise(long long billableHours, Paise hourlyRatePaise) {
    if (billableHours <= 0 || hourlyRatePaise <= 0) {
        return 0;
    }
    return billableHours * hourlyRatePaise;
}

Paise BillingService::feeForSession(Timestamp entryTime, Timestamp exitTime, Paise hourlyRatePaise) {
    long long minutes = durationMinutes(entryTime, exitTime);
    return feePaise(billableHours(minutes), hourlyRatePaise);
}

} // namespace parkwise
