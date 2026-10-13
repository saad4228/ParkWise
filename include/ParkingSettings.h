#ifndef PARKWISE_PARKING_SETTINGS_H
#define PARKWISE_PARKING_SETTINGS_H

#include "Types.h"
#include <string>

namespace parkwise {

// Operator-configurable values. Rates are per started hour, in paise.
// These are the live rates used for new sessions only - a ticket copies
// the rate at entry, so changing a price here never rewrites old bills.
struct ParkingSettings {
    Paise bikeHourlyRatePaise = 1000;   // Rs 10 per hour
    Paise carHourlyRatePaise  = 3000;   // Rs 30 per hour
    Paise suvHourlyRatePaise  = 5000;   // Rs 50 per hour

    // How long after the booked start time a reserved vehicle may still
    // arrive before the booking is marked Expired.
    long long reservationGraceMinutes = 30;

    std::string currency = "INR";

    Paise rateFor(VehicleType type) const {
        switch (type) {
            case VehicleType::BIKE: return bikeHourlyRatePaise;
            case VehicleType::CAR:  return carHourlyRatePaise;
            case VehicleType::SUV:  return suvHourlyRatePaise;
        }
        return carHourlyRatePaise;
    }

    long long reservationGraceSeconds() const { return reservationGraceMinutes * 60; }

    // Used before saving a settings change from the browser.
    bool isValid(std::string& errorMessage) const;
};

} // namespace parkwise

#endif
