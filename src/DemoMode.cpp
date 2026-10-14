#include "DemoMode.h"

#include "TimeUtil.h"

#include <filesystem>

namespace parkwise {
namespace {

namespace fs = std::filesystem;

// The four records that make up a car park. Named here rather than shared
// with FileManager because this is the only other place that needs them, and
// a header just to hold four strings would be ceremony.
const char* kDataFiles[] = {"config.json", "tickets.json", "reservations.json", "queue.json"};

// Hidden, and inside the data folder, so a deployment that mounts one volume
// carries the snapshot with the records it belongs to.
const char* kSnapshotFolder = ".demo-snapshot";

} // namespace

DemoMode::DemoMode(bool enabled, int minutesBetweenResets, const std::string& dataDirectory)
    : enabled_(enabled),
      minutesBetweenResets_(minutesBetweenResets),
      dataDirectory_(dataDirectory) {}

bool DemoMode::takeSnapshot(std::string& errorMessage) {
    if (!enabled_) {
        return true;
    }

    std::error_code code;
    const fs::path folder = fs::path(dataDirectory_) / kSnapshotFolder;
    fs::create_directories(folder, code);
    if (code) {
        errorMessage = "Could not create the demo snapshot folder: " + code.message();
        return false;
    }

    for (const char* fileName : kDataFiles) {
        const fs::path source = fs::path(dataDirectory_) / fileName;
        if (!fs::exists(source, code) || code) {
            continue; // a car park with nothing in this file yet
        }
        fs::copy_file(source, folder / fileName, fs::copy_options::overwrite_existing, code);
        if (code) {
            errorMessage = std::string("Could not snapshot ") + fileName + ": " + code.message();
            return false;
        }
    }

    lastReset_ = TimeUtil::now();
    return true;
}

bool DemoMode::dueForReset(Timestamp now) const {
    if (!enabled_ || minutesBetweenResets_ <= 0) {
        return false;
    }
    return now - lastReset_ >= static_cast<Timestamp>(minutesBetweenResets_) * 60;
}

long long DemoMode::secondsUntilReset(Timestamp now) const {
    if (!enabled_ || minutesBetweenResets_ <= 0) {
        return -1; // never
    }
    const long long due = lastReset_ + static_cast<long long>(minutesBetweenResets_) * 60;
    const long long remaining = due - now;
    return remaining > 0 ? remaining : 0;
}

bool DemoMode::restoreSnapshot(Timestamp now, std::string& errorMessage) {
    if (!enabled_) {
        return true;
    }

    std::error_code code;
    const fs::path folder = fs::path(dataDirectory_) / kSnapshotFolder;

    for (const char* fileName : kDataFiles) {
        const fs::path saved = folder / fileName;
        const fs::path live = fs::path(dataDirectory_) / fileName;

        if (!fs::exists(saved, code) || code) {
            // Nothing was snapshotted for this file, so the car park started
            // without it. Remove the live copy to match.
            fs::remove(live, code);
            continue;
        }
        fs::copy_file(saved, live, fs::copy_options::overwrite_existing, code);
        if (code) {
            errorMessage = std::string("Could not restore ") + fileName + ": " + code.message();
            return false;
        }
    }

    // The .bak siblings describe the records being replaced, so they are now
    // misleading. Leaving them would hand the next failed save a stale copy.
    for (const char* fileName : kDataFiles) {
        fs::remove(fs::path(dataDirectory_) / (std::string(fileName) + ".bak"), code);
    }

    lastReset_ = now;
    return true;
}

bool DemoMode::refuses(const std::string& method, const std::string& path) const {
    if (!enabled_) {
        return false;
    }

    // Parking a car, booking a bay or joining the queue are what a visitor
    // came to try, and a reset undoes them soon enough. Settings are refused
    // because they are not undone by a reset quickly enough to matter: a
    // visitor who deletes the slot layout leaves the car park looking broken
    // for everyone who arrives before the next one.
    if (path == "/api/settings" && (method == "PUT" || method == "POST")) {
        return true;
    }
    return path == "/api/settings/backup";
}

} // namespace parkwise
