#ifndef PARKWISE_VEHICLE_H
#define PARKWISE_VEHICLE_H

#include "ParkingSettings.h"
#include "Types.h"

#include <memory>
#include <string>

namespace parkwise {

// A vehicle as the operator typed it in. The owner details are optional
// because a busy operator should not be forced to collect them.
//
// Vehicle is a base class and cannot be created on its own: every vehicle in
// the car park is a Car, a Bike or an SUV. What the three share - the plate,
// the owner, the rules for checking them - lives here once. What differs is
// declared here as pure virtual and answered by each subclass.
//
// That difference is really only two things: what the vehicle calls itself,
// and what it costs per hour. Billing used to ask ParkingSettings for a rate
// with a switch on the type; now it asks the vehicle itself, and the vehicle
// answers for its own kind. Adding a fourth type is then a new subclass
// rather than a new case in a switch somewhere else.
class Vehicle {
public:
    Vehicle(const std::string& registrationNumber,
            const std::string& ownerName = "",
            const std::string& contactNumber = "");

    // A base class that is deleted through a base pointer needs this, and
    // ParkingLot does exactly that - it holds vehicles as unique_ptr<Vehicle>.
    virtual ~Vehicle() = default;

    // The two questions only the subclass can answer.
    virtual VehicleType type() const = 0;
    virtual Paise hourlyRate(const ParkingSettings& settings) const = 0;

    const std::string& registrationNumber() const { return registrationNumber_; }
    const std::string& ownerName() const { return ownerName_; }
    const std::string& contactNumber() const { return contactNumber_; }

    // Builds the right subclass for a type that was read from a file or a
    // web request, where the kind is only known at run time.
    static std::unique_ptr<Vehicle> create(VehicleType type,
                                           const std::string& registrationNumber,
                                           const std::string& ownerName = "",
                                           const std::string& contactNumber = "");

    // The checks below are static because they are about the text itself, not
    // about any one vehicle, and they live here so that registration numbers
    // are cleaned and checked the same way everywhere in the program.

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
    std::string ownerName_;
    std::string contactNumber_;
};

// The three kinds of vehicle this car park accepts. Each one inherits the
// plate and owner details from Vehicle and only states what is different
// about itself. "using Vehicle::Vehicle" borrows the base constructors, so
// Car("MH12AB1234") works without writing a constructor here.

class Car : public Vehicle {
public:
    using Vehicle::Vehicle;
    VehicleType type() const override { return VehicleType::CAR; }
    Paise hourlyRate(const ParkingSettings& settings) const override {
        return settings.carHourlyRatePaise;
    }
};

class Bike : public Vehicle {
public:
    using Vehicle::Vehicle;
    VehicleType type() const override { return VehicleType::BIKE; }
    Paise hourlyRate(const ParkingSettings& settings) const override {
        return settings.bikeHourlyRatePaise;
    }
};

class Suv : public Vehicle {
public:
    using Vehicle::Vehicle;
    VehicleType type() const override { return VehicleType::SUV; }
    Paise hourlyRate(const ParkingSettings& settings) const override {
        return settings.suvHourlyRatePaise;
    }
};

} // namespace parkwise

#endif
