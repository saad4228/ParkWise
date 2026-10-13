#include "Vehicle.h"

#include <cctype>

namespace parkwise {

Vehicle::Vehicle(const std::string& registrationNumber,
                 VehicleType type,
                 const std::string& ownerName,
                 const std::string& contactNumber)
    : registrationNumber_(registrationNumber),
      type_(type),
      ownerName_(ownerName),
      contactNumber_(contactNumber) {}

std::string Vehicle::normalizeRegistration(const std::string& raw) {
    std::string cleaned;
    for (char character : raw) {
        if (character == ' ' || character == '-' || character == '.') {
            continue;
        }
        cleaned += static_cast<char>(std::toupper(static_cast<unsigned char>(character)));
    }
    return cleaned;
}

bool Vehicle::isValidRegistration(const std::string& normalized) {
    if (normalized.size() < 4 || normalized.size() > 15) {
        return false;
    }

    bool hasLetter = false;
    bool hasDigit = false;
    for (char character : normalized) {
        unsigned char value = static_cast<unsigned char>(character);
        if (std::isalpha(value)) {
            hasLetter = true;
        } else if (std::isdigit(value)) {
            hasDigit = true;
        } else {
            return false;
        }
    }
    return hasLetter && hasDigit;
}

bool Vehicle::isValidContactNumber(const std::string& contact) {
    if (contact.empty()) {
        return true; // the field is optional
    }
    if (contact.size() > 20) {
        return false;
    }

    int digitCount = 0;
    for (char character : contact) {
        unsigned char value = static_cast<unsigned char>(character);
        if (std::isdigit(value)) {
            digitCount++;
        } else if (character != ' ' && character != '+' && character != '-') {
            return false;
        }
    }
    return digitCount >= 6;
}

bool Vehicle::isValidOwnerName(const std::string& ownerName) {
    if (ownerName.empty()) {
        return true; // the field is optional
    }
    if (ownerName.size() > 60) {
        return false;
    }
    for (char character : ownerName) {
        // Bytes above 127 are left alone so that a name written in a local
        // script still works; only the ASCII control codes are refused.
        const unsigned char value = static_cast<unsigned char>(character);
        if (value < 0x20 || value == 0x7F) {
            return false;
        }
    }
    return true;
}

} // namespace parkwise
