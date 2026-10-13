#ifndef PARKWISE_REPORT_SERVICE_H
#define PARKWISE_REPORT_SERVICE_H

#include "ParkingLot.h"
#include "Types.h"

#include <string>
#include <vector>

namespace parkwise {

// Which past sessions the operator wants to look at.
// An empty text or a zero timestamp means "do not filter on this".
struct HistoryFilter {
    std::string searchText;    // matches a ticket id or a registration number
    std::string statusFilter;  // "", "ACTIVE" or "COMPLETED"
    Timestamp fromTime = 0;    // compared against the entry time, inclusive
    Timestamp toTime = 0;      // compared against the entry time, exclusive
};

struct DailyRevenue {
    std::string date;          // "2026-10-09" in local time
    Paise revenuePaise = 0;
    int completedSessions = 0;
};

struct VehicleTypeCount {
    std::string vehicleType;
    int count = 0;
};

struct ReportSummary {
    Timestamp fromTime = 0;
    Timestamp toTime = 0;

    int totalVehiclesServed = 0;       // sessions that started inside the window
    Paise totalRevenuePaise = 0;       // fees taken inside the window
    int completedSessions = 0;
    int activeSessions = 0;
    long long averageDurationMinutes = 0;

    int peakEntryHour = -1;            // 0 to 23, or -1 when there is no data
    int peakEntryHourCount = 0;

    std::vector<DailyRevenue> revenueByDay;
    std::vector<VehicleTypeCount> vehicleTypeDistribution;
};

// Read-only questions about past sessions: the Reports screen, the History
// table and the CSV export.
//
// It is kept apart from ParkingLot because it never changes anything - it
// only counts and groups what ParkingLot already holds.
//
// Two different moments are used on purpose, and the Reports screen says so:
//   - a session is COUNTED on the day it entered,
//   - its money is COUNTED on the day it paid, which is at checkout.
// Each number is therefore tied to the event it is actually about.
namespace ReportService {

ReportSummary buildSummary(const ParkingLot& lot, Timestamp fromTime, Timestamp toTime);

// Newest first, so the History table shows recent activity at the top.
std::vector<const ParkingTicket*> filterHistory(const ParkingLot& lot,
                                                const HistoryFilter& filter);

// A spreadsheet-friendly export of exactly the rows handed in. Commas,
// quotes and line breaks inside a field are escaped the standard way.
std::string toCsv(const std::vector<const ParkingTicket*>& tickets);

// Exposed for the tests, and used by toCsv for every field it writes.
std::string escapeCsvField(const std::string& value);

// Escaping for a field that came from a person typing into a form.
//
// On top of the usual CSV quoting, a value that begins with =, +, - or @ is
// prefixed with an apostrophe. A spreadsheet reads those characters as the
// start of a formula, so without this an owner name like "=1+1" would be
// evaluated by Excel rather than shown. The apostrophe is the conventional
// way to say "this is text".
std::string escapeCsvTextField(const std::string& value);

} // namespace ReportService

} // namespace parkwise

#endif
