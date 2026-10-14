#ifndef PARKWISE_DEMO_MODE_H
#define PARKWISE_DEMO_MODE_H

#include "Types.h"

#include <string>
#include <vector>

namespace parkwise {

// The rules that apply when ParkWise is put on a public address.
//
// A deployed copy has a problem a local copy does not: there is no operator,
// only strangers, and nothing stops one of them emptying the car park or
// setting every rate to zero. Rather than bolt a login onto a project that
// has no notion of users, demo mode draws a smaller boundary:
//
//   * the day-to-day screens stay usable, because being able to park a car
//     and watch the map change is the whole reason for publishing it;
//   * settings and backups are refused, because those are the two ways a
//     visitor could leave the car park looking broken for everyone after;
//   * the records are put back to how they started every so often, so any
//     mess a visitor leaves behind is temporary.
//
// Off by default. A copy running on someone's own machine behaves exactly as
// it always did, and none of this applies.
class DemoMode {
public:
    // minutesBetweenResets of 0 turns resetting off while leaving the write
    // rules in place.
    DemoMode(bool enabled, int minutesBetweenResets, const std::string& dataDirectory);

    bool enabled() const { return enabled_; }
    int minutesBetweenResets() const { return minutesBetweenResets_; }

    // Copies the records as they are now into a hidden folder, to be restored
    // from later. Called once, before the first request is served, so the
    // snapshot is whatever the car park was seeded with.
    bool takeSnapshot(std::string& errorMessage);

    // True when enough time has passed that the records should be put back.
    bool dueForReset(Timestamp now) const;

    // Puts the snapshot back over the live files. The caller must reload the
    // car park from disk afterwards, since what it holds in memory is now out
    // of date.
    bool restoreSnapshot(Timestamp now, std::string& errorMessage);

    // Seconds until the next reset, for telling the visitor what to expect.
    long long secondsUntilReset(Timestamp now) const;

    // Whether this request is one demo mode turns away. Settings and backups
    // are refused; everything else is allowed through.
    bool refuses(const std::string& method, const std::string& path) const;

private:
    bool enabled_;
    int minutesBetweenResets_;
    std::string dataDirectory_;
    Timestamp lastReset_ = 0;
};

} // namespace parkwise

#endif
