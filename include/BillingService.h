#ifndef PARKWISE_BILLING_SERVICE_H
#define PARKWISE_BILLING_SERVICE_H

#include "Types.h"

namespace parkwise {

// The one and only place where a parking fee is worked out.
//
// ParkWise uses hourly-ceiling billing: any started hour is charged as a
// full hour, so 61 minutes costs the same as 120 minutes. A session that
// has not lasted a single minute is free.
//
// All functions are static because billing needs no stored state - it is
// a pure calculation over the numbers it is handed.
class BillingService {
public:
    // Whole elapsed minutes between two timestamps. Never negative.
    static long long durationMinutes(Timestamp entryTime, Timestamp exitTime);

    // Rounds the duration up to the next whole hour. 0 minutes bills 0 hours.
    static long long billableHours(long long durationMinutes);

    static Paise feePaise(long long billableHours, Paise hourlyRatePaise);

    // Convenience wrapper used by tickets and by the live fee estimate.
    static Paise feeForSession(Timestamp entryTime, Timestamp exitTime, Paise hourlyRatePaise);
};

} // namespace parkwise

#endif
