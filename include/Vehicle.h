#ifndef PARKWISE_VEHICLE_H
#define PARKWISE_VEHICLE_H

#include "Types.h"
#include <string>

namespace parkwise {

// A vehicle as the operator typed it in. The owner details are optional
// because a busy operator should not be forced to collect them.
//
// The two static helpers live here so that registration numbers are
// cleaned and checked exactly the same way everywhere in the program.
class Vehicle {
public:
    Vehicle() = default;
    Vehicle(const std::string& registrationNumber,
            VehicleType type,
            const std::string& ownerName = "",
            const std::string& contactNumber = "");

    const std::string& registrationNumber() const { return registrationNumber_; }
    VehicleType type() const { return type_; }
    const std::string& ownerName() const { return ownerName_; }
    const std::string& contactNumber() const { return contactNumber_; }

    // Uppercases the text and removes spaces, hyphens and dots so that
    // "mh 12-ab 1234" and "MH12AB1234" are treated as the same vehicle.
    static std::string normalizeRegistration(const std::string& raw);

    // Expects 4 to 15 characters, letters and digits only, and at least
    // one of each. Call this on an already normalized value.
    static bool isValidRegistration(const std::string& normalized);

    // Optional contact numbers may contain digits, spaces, + and -.
    static bool isValidContactNumber(const std::string& contact);

    // Owner names are free text, so the only rules are a sensible length and
    // no control characters - a name arrives from a web request and ends up
    // in a JSON file and a CSV export, and neither wants a stray newline.
    static bool isValidOwnerName(const std::string& ownerName);

private:
    std::string registrationNumber_;
    VehicleType type_ = VehicleType::CAR;
    std::string ownerName_;
    std::string contactNumber_;
};

} // namespace parkwise

#endif
