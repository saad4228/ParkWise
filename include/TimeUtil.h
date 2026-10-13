#ifndef PARKWISE_TIME_UTIL_H
#define PARKWISE_TIME_UTIL_H

#include "Types.h"
#include <string>

namespace parkwise {

// Timestamps travel as plain epoch seconds. These helpers are only needed
// where a calendar question is asked - "which day is this?", "which hour
// of the day?" - and they answer it in the computer's local time, which is
// the time the operator sees on screen.
namespace TimeUtil {

Timestamp now();

// Midnight at the start of the local day that contains the timestamp.
Timestamp startOfLocalDay(Timestamp moment);

// Midnight at the start of the next local day.
Timestamp startOfNextLocalDay(Timestamp moment);

// Hour of the local day, 0 to 23.
int localHourOf(Timestamp moment);

// "2026-10-09" in local time, used to group report rows by day.
std::string localDateText(Timestamp moment);

// "2026-10-09 14:30" in local time, used in CSV exports.
std::string localDateTimeText(Timestamp moment);

} // namespace TimeUtil

} // namespace parkwise

#endif
