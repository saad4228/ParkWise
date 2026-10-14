#include "ReportService.h"
#include "BillingService.h"
#include "TimeUtil.h"

#include <algorithm>
#include <cctype>
#include <map>
#include <sstream>

namespace parkwise {
namespace ReportService {

namespace {

bool isWithin(Timestamp moment, Timestamp fromInclusive, Timestamp toExclusive) {
    if (fromInclusive != 0 && moment < fromInclusive) {
        return false;
    }
    if (toExclusive != 0 && moment >= toExclusive) {
        return false;
    }
    return true;
}

std::string toUpperCase(const std::string& text) {
    std::string result;
    result.reserve(text.size());
    for (char character : text) {
        result += static_cast<char>(std::toupper(static_cast<unsigned char>(character)));
    }
    return result;
}

// Rupees with two decimals, written so a spreadsheet reads it as a number.
std::string rupeesText(Paise amount) {
    std::ostringstream stream;
    stream << (amount / 100) << "." << (amount % 100 < 10 ? "0" : "") << (amount % 100);
    return stream.str();
}

} // namespace

ReportSummary buildSummary(const ParkingLot& lot, Timestamp fromTime, Timestamp toTime) {
    ReportSummary summary;
    summary.fromTime = fromTime;
    summary.toTime = toTime;

    int hourCounts[24] = {0};
    std::map<std::string, int> typeCounts;
    std::map<std::string, DailyRevenue> dailyRows;
    long long totalCompletedMinutes = 0;

    for (const ParkingTicket& ticket : lot.tickets()) {
        // Sessions that began inside the window: "vehicles served".
        if (isWithin(ticket.entryTime(), fromTime, toTime)) {
            summary.totalVehiclesServed++;
            hourCounts[TimeUtil::localHourOf(ticket.entryTime())]++;
            typeCounts[vehicleTypeToString(ticket.vehicleType())]++;
            if (ticket.isActive()) {
                summary.activeSessions++;
            }
        }

        // Money is counted where it was taken, which is at checkout.
        if (ticket.status() == TicketStatus::COMPLETED &&
            isWithin(ticket.exitTime(), fromTime, toTime)) {
            summary.completedSessions++;
            summary.totalRevenuePaise += ticket.finalFeePaise();
            totalCompletedMinutes +=
                BillingService::durationMinutes(ticket.entryTime(), ticket.exitTime());

            const std::string day = TimeUtil::localDateText(ticket.exitTime());
            DailyRevenue& row = dailyRows[day];
            row.date = day;
            row.revenuePaise += ticket.finalFeePaise();
            row.completedSessions++;
        }
    }

    if (summary.completedSessions > 0) {
        summary.averageDurationMinutes = totalCompletedMinutes / summary.completedSessions;
    }

    for (int hour = 0; hour < 24; hour++) {
        if (hourCounts[hour] > summary.peakEntryHourCount) {
            summary.peakEntryHourCount = hourCounts[hour];
            summary.peakEntryHour = hour;
        }
    }

    // std::map already keeps these sorted by date text, which is also
    // chronological because the dates are written year-month-day.
    for (const auto& entry : dailyRows) {
        summary.revenueByDay.push_back(entry.second);
    }
    for (const auto& entry : typeCounts) {
        VehicleTypeCount count;
        count.vehicleType = entry.first;
        count.count = entry.second;
        summary.vehicleTypeDistribution.push_back(count);
    }

    return summary;
}

std::vector<HourlyTraffic> buildHourlyTraffic(const ParkingLot& lot,
                                              Timestamp fromInclusive,
                                              Timestamp toExclusive) {
    std::vector<HourlyTraffic> hours(24);
    for (int hour = 0; hour < 24; hour++) {
        hours[static_cast<std::size_t>(hour)].hour = hour;
    }

    for (const ParkingTicket& ticket : lot.tickets()) {
        if (isWithin(ticket.entryTime(), fromInclusive, toExclusive)) {
            const int hour = TimeUtil::localHourOf(ticket.entryTime());
            hours[static_cast<std::size_t>(hour)].entries++;
        }
        // A vehicle that is still parked has not left, so it is not a
        // departure in any hour yet.
        if (ticket.status() == TicketStatus::COMPLETED &&
            isWithin(ticket.exitTime(), fromInclusive, toExclusive)) {
            const int hour = TimeUtil::localHourOf(ticket.exitTime());
            hours[static_cast<std::size_t>(hour)].exits++;
        }
    }
    return hours;
}

std::vector<const ParkingTicket*> filterHistory(const ParkingLot& lot,
                                                const HistoryFilter& filter) {
    const std::string search = toUpperCase(filter.searchText);

    std::vector<const ParkingTicket*> matches;
    for (const ParkingTicket& ticket : lot.tickets()) {
        if (!isWithin(ticket.entryTime(), filter.fromTime, filter.toTime)) {
            continue;
        }
        if (!filter.statusFilter.empty() &&
            ticketStatusToString(ticket.status()) != filter.statusFilter) {
            continue;
        }
        if (!search.empty()) {
            const bool matchesId = toUpperCase(ticket.id()).find(search) != std::string::npos;
            const bool matchesPlate =
                ticket.registrationNumber().find(search) != std::string::npos;
            if (!matchesId && !matchesPlate) {
                continue;
            }
        }
        matches.push_back(&ticket);
    }

    std::sort(matches.begin(), matches.end(),
              [](const ParkingTicket* left, const ParkingTicket* right) {
                  if (left->entryTime() != right->entryTime()) {
                      return left->entryTime() > right->entryTime();
                  }
                  return left->id() > right->id();
              });
    return matches;
}

std::string escapeCsvField(const std::string& value) {
    const bool needsQuotes = value.find_first_of(",\"\r\n") != std::string::npos;
    if (!needsQuotes) {
        return value;
    }

    std::string quoted = "\"";
    for (char character : value) {
        if (character == '"') {
            quoted += "\"\""; // a quote inside a quoted field is doubled
        } else {
            quoted += character;
        }
    }
    quoted += "\"";
    return quoted;
}

std::string escapeCsvTextField(const std::string& value) {
    if (!value.empty() && (value[0] == '=' || value[0] == '+' || value[0] == '-' ||
                           value[0] == '@')) {
        return escapeCsvField("'" + value);
    }
    return escapeCsvField(value);
}

std::string toCsv(const std::vector<const ParkingTicket*>& tickets) {
    std::ostringstream output;

    // A byte-order mark. Owner names may be written in a local script -
    // isValidOwnerName deliberately allows it - and Excel assumes the system
    // code page for a plain .csv, which turns those names into mojibake. These
    // three bytes tell it the file is UTF-8.
    output << static_cast<char>(0xEF)
           << static_cast<char>(0xBB)
           << static_cast<char>(0xBF);

    output << "Ticket ID,Registration Number,Vehicle Type,Slot ID,Entry Time,Exit Time,"
              "Duration (minutes),Billable Hours,Hourly Rate (INR),Final Fee (INR),Status,Source,"
              "Owner Name\r\n";

    for (const ParkingTicket* ticket : tickets) {
        const bool completed = ticket->status() == TicketStatus::COMPLETED;
        const long long minutes =
            completed ? BillingService::durationMinutes(ticket->entryTime(), ticket->exitTime())
                      : 0;

        // The two fields a person types freely - the plate and the owner name -
        // go through the spreadsheet-safe escape.
        output << escapeCsvField(ticket->id()) << ','
               << escapeCsvTextField(ticket->registrationNumber()) << ','
               << escapeCsvField(vehicleTypeToString(ticket->vehicleType())) << ','
               << escapeCsvField(ticket->slotId()) << ','
               << escapeCsvField(TimeUtil::localDateTimeText(ticket->entryTime())) << ','
               << escapeCsvField(completed ? TimeUtil::localDateTimeText(ticket->exitTime()) : "")
               << ','
               << (completed ? std::to_string(minutes) : "") << ','
               << (completed ? std::to_string(ticket->billableHours()) : "") << ','
               << rupeesText(ticket->hourlyRatePaise()) << ','
               << (completed ? rupeesText(ticket->finalFeePaise()) : "") << ','
               << escapeCsvField(ticketStatusToString(ticket->status())) << ','
               << escapeCsvField(ticketSourceToString(ticket->source())) << ','
               << escapeCsvTextField(ticket->ownerName()) << "\r\n";
    }
    return output.str();
}

} // namespace ReportService
} // namespace parkwise
