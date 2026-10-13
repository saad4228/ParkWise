#include "ParkingSettings.h"

namespace parkwise {

bool ParkingSettings::isValid(std::string& errorMessage) const {
    // A rate of zero would make parking free, which is almost certainly a
    // typing mistake rather than an intention, so it is refused too.
    if (bikeHourlyRatePaise <= 0 || carHourlyRatePaise <= 0 || suvHourlyRatePaise <= 0) {
        errorMessage = "Hourly rates must be greater than zero.";
        return false;
    }
    if (bikeHourlyRatePaise > 10000000 || carHourlyRatePaise > 10000000 ||
        suvHourlyRatePaise > 10000000) {
        errorMessage = "Hourly rates look unrealistically large.";
        return false;
    }
    if (reservationGraceMinutes < 0 || reservationGraceMinutes > 24 * 60) {
        errorMessage = "Reservation grace period must be between 0 minutes and 24 hours.";
        return false;
    }
    if (currency != "INR") {
        errorMessage = "Only INR is supported in this version.";
        return false;
    }
    return true;
}

} // namespace parkwise
