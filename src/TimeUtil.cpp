#include "TimeUtil.h"

#include <ctime>

namespace parkwise {
namespace TimeUtil {

namespace {

std::tm toLocalParts(Timestamp moment) {
    std::time_t raw = static_cast<std::time_t>(moment);
    std::tm parts{};
#ifdef _WIN32
    localtime_s(&parts, &raw);
#else
    localtime_r(&raw, &parts);
#endif
    return parts;
}

} // namespace

Timestamp now() {
    return static_cast<Timestamp>(std::time(nullptr));
}

Timestamp startOfLocalDay(Timestamp moment) {
    std::tm parts = toLocalParts(moment);
    parts.tm_hour = 0;
    parts.tm_min = 0;
    parts.tm_sec = 0;
    parts.tm_isdst = -1; // let the library work out daylight saving itself
    return static_cast<Timestamp>(std::mktime(&parts));
}

Timestamp startOfNextLocalDay(Timestamp moment) {
    std::tm parts = toLocalParts(moment);
    parts.tm_mday += 1; // mktime normalises an overflowing day for us
    parts.tm_hour = 0;
    parts.tm_min = 0;
    parts.tm_sec = 0;
    parts.tm_isdst = -1;
    return static_cast<Timestamp>(std::mktime(&parts));
}

int localHourOf(Timestamp moment) {
    return toLocalParts(moment).tm_hour;
}

std::string localDateText(Timestamp moment) {
    std::tm parts = toLocalParts(moment);
    char buffer[16];
    std::strftime(buffer, sizeof(buffer), "%Y-%m-%d", &parts);
    return std::string(buffer);
}

std::string localDateTimeText(Timestamp moment) {
    std::tm parts = toLocalParts(moment);
    char buffer[32];
    std::strftime(buffer, sizeof(buffer), "%Y-%m-%d %H:%M", &parts);
    return std::string(buffer);
}

} // namespace TimeUtil
} // namespace parkwise
