#include "ApiServer.h"
#include "BillingService.h"
#include "ReportService.h"
#include "TimeUtil.h"

#include <algorithm>
#include <filesystem>
#include <set>
#include <vector>

namespace parkwise {

namespace {

const char* kAppVersion = "1.0";

// Pulls a whole number out of the query string, for example ?from=1791522000.
long long numberParam(const httplib::Request& request, const char* name, long long fallback) {
    if (!request.has_param(name)) {
        return fallback;
    }
    try {
        return std::stoll(request.get_param_value(name));
    } catch (const std::exception&) {
        return fallback;
    }
}

std::string textParam(const httplib::Request& request, const char* name) {
    return request.has_param(name) ? request.get_param_value(name) : std::string();
}

// Reads a required text field out of a JSON request body.
bool readBodyString(const JsonCodec::Json& body, const char* key, std::string& out) {
    if (!body.is_object() || !body.contains(key) || !body.at(key).is_string()) {
        return false;
    }
    out = body.at(key).get<std::string>();
    return true;
}

std::string optionalBodyString(const JsonCodec::Json& body, const char* key) {
    std::string value;
    readBodyString(body, key, value);
    return value;
}

bool readBodyNumber(const JsonCodec::Json& body, const char* key, long long& out) {
    if (!body.is_object() || !body.contains(key) || !body.at(key).is_number_integer()) {
        return false;
    }
    out = body.at(key).get<long long>();
    return true;
}

} // namespace

ApiServer::ApiServer(ParkingLot& parkingLot, FileManager& fileManager,
                     const std::string& frontendDirectory)
    : parkingLot_(parkingLot),
      fileManager_(fileManager),
      frontendDirectory_(frontendDirectory) {
    registerRoutes();
}

// ---------------------------------------------------------------------------
// Replies
// ---------------------------------------------------------------------------

void ApiServer::sendJson(httplib::Response& response, int status, const Json& body) {
    response.status = status;
    response.set_content(body.dump(), "application/json");
}

int ApiServer::httpStatusFor(const std::string& errorCode) {
    static const std::set<std::string> badRequest = {
        "INVALID_JSON", "MISSING_FIELD", "INVALID_REGISTRATION", "INVALID_CONTACT",
        "INVALID_OWNER_NAME", "INVALID_VEHICLE_TYPE", "INVALID_INTERVAL", "INVALID_SETTINGS",
        "INVALID_QUERY"};
    static const std::set<std::string> notFound = {
        "TICKET_NOT_FOUND", "RESERVATION_NOT_FOUND", "QUEUE_REQUEST_NOT_FOUND", "SLOT_NOT_FOUND"};
    static const std::set<std::string> serverError = {"PERSISTENCE_FAILED", "DATA_INCONSISTENT"};

    if (badRequest.count(errorCode) > 0) return 400;
    if (notFound.count(errorCode) > 0) return 404;
    if (serverError.count(errorCode) > 0) return 500;
    // Everything else is a clash with the current state of the car park.
    return 409;
}

void ApiServer::sendError(httplib::Response& response, const std::string& code,
                          const std::string& message) {
    Json body;
    body["error"]["code"] = code;
    body["error"]["message"] = message;
    sendJson(response, httpStatusFor(code), body);
}

void ApiServer::sendResultError(httplib::Response& response, const Result& result) {
    sendError(response, result.errorCode, result.message);
}

bool ApiServer::readJsonBody(const httplib::Request& request, httplib::Response& response,
                             Json& outBody) {
    outBody = Json::parse(request.body, nullptr, false);
    if (outBody.is_discarded() || !outBody.is_object()) {
        sendError(response, "INVALID_JSON", "The request body is not a valid JSON object.");
        return false;
    }
    return true;
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

ApiServer::Json ApiServer::ticketView(const ParkingTicket& ticket, Timestamp now) const {
    Json view = JsonCodec::toJson(ticket);
    const bool active = ticket.isActive();

    // Worked out fresh on every request, never stored.
    view["elapsedMinutes"] = ticket.elapsedMinutes(now);
    view["estimatedFeePaise"] = ticket.estimatedFeePaise(now);
    view["isActive"] = active;

    const ParkingSlot* slot = parkingLot_.findSlot(ticket.slotId());
    view["slotVehicleType"] =
        slot != nullptr ? vehicleTypeToString(slot->supportedType()) : std::string();
    return view;
}

ApiServer::Json ApiServer::slotView(const ParkingSlot& slot, Timestamp now) const {
    Json view;
    view["slotId"] = slot.id();
    view["supportedVehicleType"] = vehicleTypeToString(slot.supportedType());
    view["occupied"] = slot.isOccupied();
    view["displayState"] = slotDisplayStateToString(parkingLot_.displayStateOf(slot));

    view["ticket"] = nullptr;
    if (slot.isOccupied()) {
        const ParkingTicket* ticket = parkingLot_.findTicket(slot.activeTicketId());
        if (ticket != nullptr) {
            Json inner;
            inner["ticketId"] = ticket->id();
            inner["registrationNumber"] = ticket->registrationNumber();
            inner["vehicleType"] = vehicleTypeToString(ticket->vehicleType());
            inner["ownerName"] = ticket->ownerName();
            inner["entryTime"] = ticket->entryTime();
            inner["elapsedMinutes"] = ticket->elapsedMinutes(now);
            inner["estimatedFeePaise"] = ticket->estimatedFeePaise(now);
            inner["hourlyRatePaise"] = ticket->hourlyRatePaise();
            view["ticket"] = inner;
        }
    }

    view["reservation"] = nullptr;
    const Reservation* hold = parkingLot_.holdFor(slot.id());
    if (hold != nullptr) {
        Json inner;
        inner["reservationId"] = hold->id();
        inner["registrationNumber"] = hold->registrationNumber();
        inner["vehicleType"] = vehicleTypeToString(hold->vehicleType());
        inner["startTime"] = hold->startTime();
        inner["endTime"] = hold->endTime();
        inner["status"] = reservationStatusToString(hold->status());
        view["reservation"] = inner;
    }
    return view;
}

ApiServer::Json ApiServer::reservationView(const Reservation& reservation, Timestamp now) const {
    Json view = JsonCodec::toJson(reservation);
    const long long grace = parkingLot_.settings().reservationGraceSeconds();

    view["graceDeadline"] = std::min<Timestamp>(reservation.startTime() + grace,
                                                reservation.endTime());
    view["canCheckIn"] = reservation.isCheckInAllowed(now, grace);
    view["canCancel"] = reservation.status() == ReservationStatus::UPCOMING;
    return view;
}

ApiServer::Json ApiServer::queueRequestView(const QueueRequest& request) const {
    Json view = JsonCodec::toJson(request);
    view["position"] = parkingLot_.queue().positionOf(request.id());
    return view;
}

ApiServer::Json ApiServer::admittedView(const std::vector<QueueAssignment>& admitted) {
    Json list = Json::array();
    for (const QueueAssignment& entry : admitted) {
        Json row;
        row["requestId"] = entry.requestId;
        row["registrationNumber"] = entry.registrationNumber;
        row["vehicleType"] = entry.vehicleType;
        row["slotId"] = entry.slotId;
        row["ticketId"] = entry.ticketId;
        list.push_back(row);
    }
    return list;
}

ApiServer::Json ApiServer::summaryView(Timestamp now) const {
    Json summary;
    summary["totalSlots"] = parkingLot_.totalSlotCount();
    summary["availableSlots"] = parkingLot_.availableSlotCount();
    summary["occupiedSlots"] = parkingLot_.occupiedSlotCount();
    summary["reservedSlots"] = parkingLot_.reservedSlotCount();
    summary["waitingCount"] = parkingLot_.queue().waitingCount();

    const Timestamp dayStart = TimeUtil::startOfLocalDay(now);
    const Timestamp dayEnd = TimeUtil::startOfNextLocalDay(now);
    summary["todayRevenuePaise"] = parkingLot_.revenueCollectedBetween(dayStart, dayEnd);
    return summary;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

void ApiServer::registerRoutes() {
    server_.set_mount_point("/", frontendDirectory_);

    // Nothing here is cached, so the browser always shows live records.
    server_.set_post_routing_handler([](const httplib::Request&, httplib::Response& response) {
        response.set_header("Cache-Control", "no-store");
    });

    server_.Get("/api/dashboard", [this](const httplib::Request& request, httplib::Response& response) {
        handleDashboard(request, response);
    });
    server_.Get("/api/slots", [this](const httplib::Request& request, httplib::Response& response) {
        handleListSlots(request, response);
    });
    server_.Get(R"(/api/slots/([A-Za-z0-9]+))",
                [this](const httplib::Request& request, httplib::Response& response) {
                    handleGetSlot(request, response);
                });

    server_.Post("/api/vehicles/entry",
                 [this](const httplib::Request& request, httplib::Response& response) {
                     handleVehicleEntry(request, response);
                 });
    server_.Post("/api/vehicles/exit",
                 [this](const httplib::Request& request, httplib::Response& response) {
                     handleVehicleExit(request, response);
                 });

    // The lookup route is registered first so that "lookup" is not read as
    // a ticket id by the pattern below it.
    server_.Get("/api/tickets/lookup",
                [this](const httplib::Request& request, httplib::Response& response) {
                    handleTicketLookup(request, response);
                });
    server_.Get(R"(/api/tickets/([A-Za-z0-9\-]+))",
                [this](const httplib::Request& request, httplib::Response& response) {
                    handleGetTicket(request, response);
                });

    server_.Get("/api/reservations",
                [this](const httplib::Request& request, httplib::Response& response) {
                    handleListReservations(request, response);
                });
    server_.Post("/api/reservations",
                 [this](const httplib::Request& request, httplib::Response& response) {
                     handleCreateReservation(request, response);
                 });
    server_.Post(R"(/api/reservations/([A-Za-z0-9\-]+)/cancel)",
                 [this](const httplib::Request& request, httplib::Response& response) {
                     handleCancelReservation(request, response);
                 });
    server_.Post(R"(/api/reservations/([A-Za-z0-9\-]+)/check-in)",
                 [this](const httplib::Request& request, httplib::Response& response) {
                     handleCheckInReservation(request, response);
                 });

    server_.Get("/api/queue", [this](const httplib::Request& request, httplib::Response& response) {
        handleListQueue(request, response);
    });
    server_.Post("/api/queue", [this](const httplib::Request& request, httplib::Response& response) {
        handleAddToQueue(request, response);
    });
    server_.Delete(R"(/api/queue/([A-Za-z0-9\-]+))",
                   [this](const httplib::Request& request, httplib::Response& response) {
                       handleCancelQueueRequest(request, response);
                   });

    server_.Get("/api/history", [this](const httplib::Request& request, httplib::Response& response) {
        handleHistory(request, response);
    });
    server_.Get("/api/reports", [this](const httplib::Request& request, httplib::Response& response) {
        handleReports(request, response);
    });
    server_.Get("/api/exports/history.csv",
                [this](const httplib::Request& request, httplib::Response& response) {
                    handleExportHistoryCsv(request, response);
                });

    server_.Get("/api/settings", [this](const httplib::Request& request, httplib::Response& response) {
        handleGetSettings(request, response);
    });
    server_.Put("/api/settings", [this](const httplib::Request& request, httplib::Response& response) {
        handleUpdateSettings(request, response);
    });
    server_.Post("/api/settings/backup",
                 [this](const httplib::Request& request, httplib::Response& response) {
                     handleBackupNow(request, response);
                 });

    // A request to an unknown /api path should read as JSON, not as the
    // single-page app's HTML.
    server_.set_error_handler([](const httplib::Request& request, httplib::Response& response) {
        if (request.path.rfind("/api/", 0) == 0 && response.body.empty()) {
            Json body;
            body["error"]["code"] = "NOT_FOUND";
            body["error"]["message"] = "Unknown API endpoint.";
            response.set_content(body.dump(), "application/json");
        }
    });

    // A bug in one handler must not take the whole server down, and the
    // browser must never be shown an internal message.
    server_.set_exception_handler(
        [](const httplib::Request&, httplib::Response& response, std::exception_ptr) {
            Json body;
            body["error"]["code"] = "INTERNAL_ERROR";
            body["error"]["message"] = "The server could not complete that request.";
            response.status = 500;
            response.set_content(body.dump(), "application/json");
        });
}

bool ApiServer::listen(const std::string& host, int port) {
    return server_.listen(host.c_str(), port);
}

void ApiServer::stop() {
    server_.stop();
}

// ---------------------------------------------------------------------------
// Dashboard and slots
// ---------------------------------------------------------------------------

void ApiServer::handleDashboard(const httplib::Request&, httplib::Response& response) {
    std::lock_guard<std::mutex> guard(stateLock_);
    const Timestamp now = TimeUtil::now();

    Result swept = parkingLot_.expireLapsedReservations(now);
    if (!swept.ok) {
        sendResultError(response, swept);
        return;
    }

    Json body;
    body["serverTime"] = now;
    body["currency"] = parkingLot_.settings().currency;
    body["summary"] = summaryView(now);

    body["slots"] = Json::array();
    for (const ParkingSlot& slot : parkingLot_.slots()) {
        body["slots"].push_back(slotView(slot, now));
    }

    // Recent activity is built from the tickets themselves: an entry event
    // for every session and an exit event for every finished one.
    struct Activity {
        Timestamp when;
        Json entry;
    };
    std::vector<Activity> activities;
    for (const ParkingTicket& ticket : parkingLot_.tickets()) {
        Json arrival;
        arrival["kind"] = "ENTRY";
        arrival["ticketId"] = ticket.id();
        arrival["registrationNumber"] = ticket.registrationNumber();
        arrival["vehicleType"] = vehicleTypeToString(ticket.vehicleType());
        arrival["slotId"] = ticket.slotId();
        arrival["time"] = ticket.entryTime();
        arrival["source"] = ticketSourceToString(ticket.source());
        arrival["feePaise"] = nullptr;
        activities.push_back({ticket.entryTime(), arrival});

        if (ticket.status() == TicketStatus::COMPLETED) {
            Json departure = arrival;
            departure["kind"] = "EXIT";
            departure["time"] = ticket.exitTime();
            departure["feePaise"] = ticket.finalFeePaise();
            activities.push_back({ticket.exitTime(), departure});
        }
    }
    std::sort(activities.begin(), activities.end(),
              [](const Activity& left, const Activity& right) { return left.when > right.when; });

    body["recentActivity"] = Json::array();
    for (std::size_t index = 0; index < activities.size() && index < 8; index++) {
        body["recentActivity"].push_back(activities[index].entry);
    }

    // Bookings that still expect a vehicle, soonest first.
    std::vector<const Reservation*> upcoming;
    for (const Reservation& reservation : parkingLot_.reservations()) {
        if (reservation.status() == ReservationStatus::UPCOMING) {
            upcoming.push_back(&reservation);
        }
    }
    std::sort(upcoming.begin(), upcoming.end(),
              [](const Reservation* left, const Reservation* right) {
                  return left->startTime() < right->startTime();
              });

    body["upcomingReservations"] = Json::array();
    for (std::size_t index = 0; index < upcoming.size() && index < 5; index++) {
        body["upcomingReservations"].push_back(reservationView(*upcoming[index], now));
    }

    body["queue"] = Json::array();
    for (const QueueRequest& request : parkingLot_.queue().all()) {
        if (request.isWaiting()) {
            body["queue"].push_back(queueRequestView(request));
        }
    }

    // Arrivals and departures per hour of today, counted here rather than in
    // the browser so the chart cannot drift from the records it describes.
    const Timestamp dayStart = TimeUtil::startOfLocalDay(now);
    const Timestamp dayEnd = TimeUtil::startOfNextLocalDay(now);
    const std::vector<HourlyTraffic> traffic =
        ReportService::buildHourlyTraffic(parkingLot_, dayStart, dayEnd);
    body["hourlyTraffic"] = Json::array();
    for (const HourlyTraffic& hour : traffic) {
        Json row;
        row["hour"] = hour.hour;
        row["entries"] = hour.entries;
        row["exits"] = hour.exits;
        body["hourlyTraffic"].push_back(row);
    }

    sendJson(response, 200, body);
}

void ApiServer::handleListSlots(const httplib::Request&, httplib::Response& response) {
    std::lock_guard<std::mutex> guard(stateLock_);
    const Timestamp now = TimeUtil::now();

    Result swept = parkingLot_.expireLapsedReservations(now);
    if (!swept.ok) {
        sendResultError(response, swept);
        return;
    }

    Json body;
    body["serverTime"] = now;
    body["summary"] = summaryView(now);
    body["slots"] = Json::array();
    for (const ParkingSlot& slot : parkingLot_.slots()) {
        body["slots"].push_back(slotView(slot, now));
    }
    sendJson(response, 200, body);
}

void ApiServer::handleGetSlot(const httplib::Request& request, httplib::Response& response) {
    std::lock_guard<std::mutex> guard(stateLock_);
    const Timestamp now = TimeUtil::now();

    Result swept = parkingLot_.expireLapsedReservations(now);
    if (!swept.ok) {
        sendResultError(response, swept);
        return;
    }

    const std::string slotId = request.matches[1];
    const ParkingSlot* slot = parkingLot_.findSlot(slotId);
    if (slot == nullptr) {
        sendError(response, "SLOT_NOT_FOUND", "There is no slot called " + slotId + ".");
        return;
    }

    Json body;
    body["serverTime"] = now;
    body["slot"] = slotView(*slot, now);
    sendJson(response, 200, body);
}

// ---------------------------------------------------------------------------
// Entry and exit
// ---------------------------------------------------------------------------

void ApiServer::handleVehicleEntry(const httplib::Request& request, httplib::Response& response) {
    Json body;
    if (!readJsonBody(request, response, body)) {
        return;
    }

    std::string registrationText;
    std::string vehicleTypeText;
    if (!readBodyString(body, "registrationNumber", registrationText) ||
        !readBodyString(body, "vehicleType", vehicleTypeText)) {
        sendError(response, "MISSING_FIELD",
                  "registrationNumber and vehicleType are both required.");
        return;
    }

    VehicleType vehicleType = VehicleType::CAR;
    if (!vehicleTypeFromString(vehicleTypeText, vehicleType)) {
        sendError(response, "INVALID_VEHICLE_TYPE", "Vehicle type must be BIKE, CAR or SUV.");
        return;
    }

    const Vehicle vehicle(Vehicle::normalizeRegistration(registrationText), vehicleType,
                          optionalBodyString(body, "ownerName"),
                          optionalBodyString(body, "contactNumber"));

    std::lock_guard<std::mutex> guard(stateLock_);
    const Timestamp now = TimeUtil::now();

    EntryOutcome outcome;
    Result result = parkingLot_.checkInWalkIn(vehicle, now, outcome);
    if (!result.ok) {
        sendResultError(response, result);
        return;
    }

    const ParkingTicket* ticket = parkingLot_.findTicket(outcome.ticketId);
    Json created;
    created["ticket"] = ticketView(*ticket, now);
    created["ticketId"] = outcome.ticketId;
    created["registrationNumber"] = ticket->registrationNumber();
    created["slotId"] = outcome.slotId;
    created["entryTime"] = outcome.entryTime;
    created["status"] = "ACTIVE";
    created["summary"] = summaryView(now);
    sendJson(response, 201, created);
}

void ApiServer::handleVehicleExit(const httplib::Request& request, httplib::Response& response) {
    Json body;
    if (!readJsonBody(request, response, body)) {
        return;
    }

    std::string ticketId;
    if (!readBodyString(body, "ticketId", ticketId) || ticketId.empty()) {
        sendError(response, "MISSING_FIELD", "ticketId is required.");
        return;
    }

    std::lock_guard<std::mutex> guard(stateLock_);
    const Timestamp now = TimeUtil::now();

    ExitOutcome outcome;
    Result result = parkingLot_.checkOut(ticketId, now, outcome);
    if (!result.ok) {
        sendResultError(response, result);
        return;
    }

    Json completed;
    completed["ticketId"] = outcome.ticketId;
    completed["slotId"] = outcome.slotId;
    completed["exitTime"] = outcome.exitTime;
    completed["durationMinutes"] = outcome.durationMinutes;
    completed["billableHours"] = outcome.billableHours;
    completed["hourlyRatePaise"] = outcome.hourlyRatePaise;
    completed["finalFeePaise"] = outcome.finalFeePaise;
    completed["status"] = "COMPLETED";

    // When a waiting vehicle took the freed slot, the browser is told so it
    // can colour that slot correctly instead of showing it as available.
    if (outcome.queueAssignment.happened) {
        Json assignment;
        assignment["requestId"] = outcome.queueAssignment.requestId;
        assignment["registrationNumber"] = outcome.queueAssignment.registrationNumber;
        assignment["vehicleType"] = outcome.queueAssignment.vehicleType;
        assignment["slotId"] = outcome.queueAssignment.slotId;
        assignment["ticketId"] = outcome.queueAssignment.ticketId;
        completed["queueAssignment"] = assignment;
    } else {
        completed["queueAssignment"] = nullptr;
    }

    const ParkingTicket* ticket = parkingLot_.findTicket(outcome.ticketId);
    completed["ticket"] = ticketView(*ticket, now);
    completed["summary"] = summaryView(now);
    sendJson(response, 200, completed);
}

void ApiServer::handleTicketLookup(const httplib::Request& request, httplib::Response& response) {
    const std::string query = textParam(request, "query");
    if (query.empty()) {
        sendError(response, "MISSING_FIELD", "Enter a ticket id or a registration number.");
        return;
    }

    std::lock_guard<std::mutex> guard(stateLock_);
    const Timestamp now = TimeUtil::now();

    // An exact ticket id wins; otherwise the vehicle that is parked now;
    // otherwise its most recent finished session, so the operator is told
    // "already checked out" instead of "not found".
    const ParkingTicket* found = parkingLot_.findTicket(query);
    if (found == nullptr) {
        const std::string plate = Vehicle::normalizeRegistration(query);
        found = parkingLot_.findActiveTicketByRegistration(plate);
        if (found == nullptr) {
            for (const ParkingTicket& ticket : parkingLot_.tickets()) {
                if (ticket.registrationNumber() != plate) {
                    continue;
                }
                if (found == nullptr || ticket.entryTime() > found->entryTime()) {
                    found = &ticket;
                }
            }
        }
    }

    if (found == nullptr) {
        sendError(response, "TICKET_NOT_FOUND",
                  "No ticket or vehicle found for \"" + query + "\".");
        return;
    }

    Json body;
    body["serverTime"] = now;
    body["ticket"] = ticketView(*found, now);
    sendJson(response, 200, body);
}

void ApiServer::handleGetTicket(const httplib::Request& request, httplib::Response& response) {
    std::lock_guard<std::mutex> guard(stateLock_);
    const Timestamp now = TimeUtil::now();

    const std::string ticketId = request.matches[1];
    const ParkingTicket* ticket = parkingLot_.findTicket(ticketId);
    if (ticket == nullptr) {
        sendError(response, "TICKET_NOT_FOUND", "No ticket found with id " + ticketId + ".");
        return;
    }

    Json body;
    body["serverTime"] = now;
    body["ticket"] = ticketView(*ticket, now);
    sendJson(response, 200, body);
}

// ---------------------------------------------------------------------------
// Reservations
// ---------------------------------------------------------------------------

void ApiServer::handleListReservations(const httplib::Request& request,
                                       httplib::Response& response) {
    std::lock_guard<std::mutex> guard(stateLock_);
    const Timestamp now = TimeUtil::now();

    Result swept = parkingLot_.expireLapsedReservations(now);
    if (!swept.ok) {
        sendResultError(response, swept);
        return;
    }

    const std::string statusFilter = textParam(request, "status");

    std::vector<const Reservation*> selected;
    for (const Reservation& reservation : parkingLot_.reservations()) {
        if (!statusFilter.empty() &&
            reservationStatusToString(reservation.status()) != statusFilter) {
            continue;
        }
        selected.push_back(&reservation);
    }
    std::sort(selected.begin(), selected.end(),
              [](const Reservation* left, const Reservation* right) {
                  return left->startTime() > right->startTime();
              });

    Json body;
    body["serverTime"] = now;
    body["reservations"] = Json::array();
    for (const Reservation* reservation : selected) {
        body["reservations"].push_back(reservationView(*reservation, now));
    }
    body["summary"] = summaryView(now);
    sendJson(response, 200, body);
}

void ApiServer::handleCreateReservation(const httplib::Request& request,
                                        httplib::Response& response) {
    Json body;
    if (!readJsonBody(request, response, body)) {
        return;
    }

    std::string registrationText;
    std::string vehicleTypeText;
    long long startTime = 0;
    long long endTime = 0;

    if (!readBodyString(body, "registrationNumber", registrationText) ||
        !readBodyString(body, "vehicleType", vehicleTypeText) ||
        !readBodyNumber(body, "startTime", startTime) ||
        !readBodyNumber(body, "endTime", endTime)) {
        sendError(response, "MISSING_FIELD",
                  "registrationNumber, vehicleType, startTime and endTime are all required.");
        return;
    }

    VehicleType vehicleType = VehicleType::CAR;
    if (!vehicleTypeFromString(vehicleTypeText, vehicleType)) {
        sendError(response, "INVALID_VEHICLE_TYPE", "Vehicle type must be BIKE, CAR or SUV.");
        return;
    }

    std::lock_guard<std::mutex> guard(stateLock_);
    const Timestamp now = TimeUtil::now();

    ReservationOutcome outcome;
    Result result = parkingLot_.createReservation(
        Vehicle::normalizeRegistration(registrationText), vehicleType, startTime, endTime,
        optionalBodyString(body, "preferredSlotId"), now, outcome);
    if (!result.ok) {
        sendResultError(response, result);
        return;
    }

    const Reservation* reservation = parkingLot_.findReservation(outcome.reservationId);
    Json created;
    created["reservationId"] = outcome.reservationId;
    created["slotId"] = outcome.slotId;
    created["startTime"] = outcome.startTime;
    created["endTime"] = outcome.endTime;
    created["status"] = "UPCOMING";
    created["reservation"] = reservationView(*reservation, now);
    created["summary"] = summaryView(now);
    sendJson(response, 201, created);
}

void ApiServer::handleCancelReservation(const httplib::Request& request,
                                        httplib::Response& response) {
    std::lock_guard<std::mutex> guard(stateLock_);
    const Timestamp now = TimeUtil::now();

    const std::string reservationId = request.matches[1];
    std::vector<QueueAssignment> admitted;
    Result result = parkingLot_.cancelReservation(reservationId, now, &admitted);
    if (!result.ok) {
        sendResultError(response, result);
        return;
    }

    const Reservation* reservation = parkingLot_.findReservation(reservationId);
    Json body;
    body["reservationId"] = reservationId;
    body["status"] = "CANCELLED";
    body["reservation"] = reservationView(*reservation, now);
    // The released slot may have gone straight to a waiting vehicle, which
    // the operator needs to know before they look at the grid.
    body["admittedFromQueue"] = admittedView(admitted);
    body["summary"] = summaryView(now);
    sendJson(response, 200, body);
}

void ApiServer::handleCheckInReservation(const httplib::Request& request,
                                         httplib::Response& response) {
    Json body = Json::object();
    if (!request.body.empty()) {
        body = Json::parse(request.body, nullptr, false);
        if (body.is_discarded() || !body.is_object()) {
            sendError(response, "INVALID_JSON", "The request body is not a valid JSON object.");
            return;
        }
    }

    const std::string plateText = optionalBodyString(body, "registrationNumber");
    const std::string plate =
        plateText.empty() ? std::string() : Vehicle::normalizeRegistration(plateText);

    std::lock_guard<std::mutex> guard(stateLock_);
    const Timestamp now = TimeUtil::now();

    const std::string reservationId = request.matches[1];
    EntryOutcome outcome;
    Result result = parkingLot_.checkInReservation(reservationId, plate, now, outcome);
    if (!result.ok) {
        sendResultError(response, result);
        return;
    }

    const ParkingTicket* ticket = parkingLot_.findTicket(outcome.ticketId);
    Json created;
    created["reservationId"] = reservationId;
    created["ticketId"] = outcome.ticketId;
    created["slotId"] = outcome.slotId;
    created["entryTime"] = outcome.entryTime;
    created["status"] = "CHECKED_IN";
    created["ticket"] = ticketView(*ticket, now);
    created["summary"] = summaryView(now);
    sendJson(response, 201, created);
}

// ---------------------------------------------------------------------------
// Waiting queue
// ---------------------------------------------------------------------------

void ApiServer::handleListQueue(const httplib::Request&, httplib::Response& response) {
    std::lock_guard<std::mutex> guard(stateLock_);
    const Timestamp now = TimeUtil::now();

    Json body;
    body["serverTime"] = now;
    body["requests"] = Json::array();
    for (const QueueRequest& request : parkingLot_.queue().all()) {
        body["requests"].push_back(queueRequestView(request));
    }
    body["waitingCount"] = parkingLot_.queue().waitingCount();
    body["summary"] = summaryView(now);
    sendJson(response, 200, body);
}

void ApiServer::handleAddToQueue(const httplib::Request& request, httplib::Response& response) {
    Json body;
    if (!readJsonBody(request, response, body)) {
        return;
    }

    std::string registrationText;
    std::string vehicleTypeText;
    if (!readBodyString(body, "registrationNumber", registrationText) ||
        !readBodyString(body, "vehicleType", vehicleTypeText)) {
        sendError(response, "MISSING_FIELD",
                  "registrationNumber and vehicleType are both required.");
        return;
    }

    VehicleType vehicleType = VehicleType::CAR;
    if (!vehicleTypeFromString(vehicleTypeText, vehicleType)) {
        sendError(response, "INVALID_VEHICLE_TYPE", "Vehicle type must be BIKE, CAR or SUV.");
        return;
    }

    const Vehicle vehicle(Vehicle::normalizeRegistration(registrationText), vehicleType,
                          optionalBodyString(body, "ownerName"),
                          optionalBodyString(body, "contactNumber"));

    std::lock_guard<std::mutex> guard(stateLock_);
    const Timestamp now = TimeUtil::now();

    QueueOutcome outcome;
    Result result = parkingLot_.addToQueue(vehicle, now, outcome);
    if (!result.ok) {
        sendResultError(response, result);
        return;
    }

    const QueueRequest* created = parkingLot_.queue().findById(outcome.requestId);
    Json queued;
    queued["requestId"] = outcome.requestId;
    queued["position"] = outcome.position;
    queued["request"] = queueRequestView(*created);
    queued["summary"] = summaryView(now);
    sendJson(response, 201, queued);
}

void ApiServer::handleCancelQueueRequest(const httplib::Request& request,
                                         httplib::Response& response) {
    std::lock_guard<std::mutex> guard(stateLock_);
    const Timestamp now = TimeUtil::now();

    const std::string requestId = request.matches[1];
    Result result = parkingLot_.cancelQueueRequest(requestId);
    if (!result.ok) {
        sendResultError(response, result);
        return;
    }

    Json body;
    body["requestId"] = requestId;
    body["status"] = "CANCELLED";
    body["summary"] = summaryView(now);
    sendJson(response, 200, body);
}

// ---------------------------------------------------------------------------
// History, reports and export
// ---------------------------------------------------------------------------

namespace {

HistoryFilter filterFromQuery(const httplib::Request& request) {
    HistoryFilter filter;
    filter.searchText = textParam(request, "search");
    filter.statusFilter = textParam(request, "status");
    filter.fromTime = numberParam(request, "from", 0);
    filter.toTime = numberParam(request, "to", 0);
    return filter;
}

} // namespace

void ApiServer::handleHistory(const httplib::Request& request, httplib::Response& response) {
    std::lock_guard<std::mutex> guard(stateLock_);
    const Timestamp now = TimeUtil::now();

    const HistoryFilter filter = filterFromQuery(request);
    if (!filter.statusFilter.empty() && filter.statusFilter != "ACTIVE" &&
        filter.statusFilter != "COMPLETED") {
        sendError(response, "INVALID_QUERY", "status must be ACTIVE or COMPLETED.");
        return;
    }

    const std::vector<const ParkingTicket*> matches =
        ReportService::filterHistory(parkingLot_, filter);

    // The table is paged so that a long history cannot stall the browser.
    const long long limit = std::min<long long>(std::max<long long>(numberParam(request, "limit", 50), 1), 500);
    const long long offset = std::max<long long>(numberParam(request, "offset", 0), 0);

    Json body;
    body["serverTime"] = now;
    body["total"] = static_cast<long long>(matches.size());
    body["limit"] = limit;
    body["offset"] = offset;
    body["tickets"] = Json::array();
    for (long long index = offset;
         index < static_cast<long long>(matches.size()) && index < offset + limit; index++) {
        body["tickets"].push_back(ticketView(*matches[static_cast<std::size_t>(index)], now));
    }
    sendJson(response, 200, body);
}

void ApiServer::handleReports(const httplib::Request& request, httplib::Response& response) {
    std::lock_guard<std::mutex> guard(stateLock_);
    const Timestamp now = TimeUtil::now();

    const Timestamp fromTime = numberParam(request, "from", 0);
    const Timestamp toTime = numberParam(request, "to", 0);
    if (fromTime != 0 && toTime != 0 && toTime <= fromTime) {
        sendError(response, "INVALID_QUERY", "The end of the range must be after its start.");
        return;
    }

    const ReportSummary summary = ReportService::buildSummary(parkingLot_, fromTime, toTime);

    Json body;
    body["serverTime"] = now;
    body["from"] = summary.fromTime;
    body["to"] = summary.toTime;
    body["totalVehiclesServed"] = summary.totalVehiclesServed;
    body["totalRevenuePaise"] = summary.totalRevenuePaise;
    body["completedSessions"] = summary.completedSessions;
    body["activeSessions"] = summary.activeSessions;
    body["averageDurationMinutes"] = summary.averageDurationMinutes;
    body["peakEntryHour"] = summary.peakEntryHour;
    body["peakEntryHourCount"] = summary.peakEntryHourCount;

    body["revenueByDay"] = Json::array();
    for (const DailyRevenue& day : summary.revenueByDay) {
        Json row;
        row["date"] = day.date;
        row["revenuePaise"] = day.revenuePaise;
        row["completedSessions"] = day.completedSessions;
        body["revenueByDay"].push_back(row);
    }

    body["vehicleTypeDistribution"] = Json::array();
    for (const VehicleTypeCount& type : summary.vehicleTypeDistribution) {
        Json row;
        row["vehicleType"] = type.vehicleType;
        row["count"] = type.count;
        body["vehicleTypeDistribution"].push_back(row);
    }

    sendJson(response, 200, body);
}

void ApiServer::handleExportHistoryCsv(const httplib::Request& request,
                                       httplib::Response& response) {
    std::lock_guard<std::mutex> guard(stateLock_);

    const HistoryFilter filter = filterFromQuery(request);
    const std::vector<const ParkingTicket*> matches =
        ReportService::filterHistory(parkingLot_, filter);

    response.status = 200;
    response.set_header("Content-Disposition", "attachment; filename=\"parkwise-history.csv\"");
    response.set_content(ReportService::toCsv(matches), "text/csv; charset=utf-8");
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

void ApiServer::handleGetSettings(const httplib::Request&, httplib::Response& response) {
    std::lock_guard<std::mutex> guard(stateLock_);
    const Timestamp now = TimeUtil::now();

    Json body;
    body["serverTime"] = now;
    body["settings"] = JsonCodec::toJson(parkingLot_.settings());

    body["slots"] = Json::array();
    for (const ParkingSlot& slot : parkingLot_.slots()) {
        Json row;
        row["slotId"] = slot.id();
        row["supportedVehicleType"] = vehicleTypeToString(slot.supportedType());
        row["occupied"] = slot.isOccupied();
        row["reserved"] = parkingLot_.holdFor(slot.id()) != nullptr;
        // Removing or re-typing either of those would disturb a real vehicle
        // or a real booking, so the screen locks the row.
        row["locked"] = slot.isOccupied() || parkingLot_.holdFor(slot.id()) != nullptr;
        body["slots"].push_back(row);
    }

    Json storage;
    storage["totalRecords"] = static_cast<long long>(parkingLot_.tickets().size() +
                                                     parkingLot_.reservations().size() +
                                                     parkingLot_.queue().all().size());
    storage["ticketCount"] = static_cast<long long>(parkingLot_.tickets().size());
    storage["reservationCount"] = static_cast<long long>(parkingLot_.reservations().size());
    storage["queueCount"] = static_cast<long long>(parkingLot_.queue().all().size());
    storage["lastBackupTime"] = fileManager_.lastBackupTime();
    storage["storedBytes"] = fileManager_.totalStoredBytes();
    body["storage"] = storage;
    body["version"] = kAppVersion;

    sendJson(response, 200, body);
}

void ApiServer::handleUpdateSettings(const httplib::Request& request, httplib::Response& response) {
    Json body;
    if (!readJsonBody(request, response, body)) {
        return;
    }
    if (!body.contains("settings") || !body.contains("slots") || !body.at("slots").is_array()) {
        sendError(response, "MISSING_FIELD", "Both settings and a slots list are required.");
        return;
    }

    ParkingSettings newSettings;
    std::string settingsError;
    if (!JsonCodec::settingsFromJson(body.at("settings"), newSettings, settingsError)) {
        sendError(response, "INVALID_SETTINGS", settingsError);
        return;
    }

    std::vector<SlotDefinition> newSlots;
    for (const Json& row : body.at("slots")) {
        SlotDefinition definition;
        std::string vehicleTypeText;
        if (!readBodyString(row, "slotId", definition.id) ||
            !readBodyString(row, "supportedVehicleType", vehicleTypeText)) {
            sendError(response, "INVALID_SETTINGS",
                      "Every slot needs a slotId and a supportedVehicleType.");
            return;
        }
        if (!vehicleTypeFromString(vehicleTypeText, definition.type)) {
            sendError(response, "INVALID_VEHICLE_TYPE",
                      "Slot " + definition.id + " has an unknown vehicle type.");
            return;
        }
        newSlots.push_back(definition);
    }

    std::lock_guard<std::mutex> guard(stateLock_);
    const Timestamp now = TimeUtil::now();

    std::vector<QueueAssignment> admitted;
    Result result = parkingLot_.updateSettings(newSettings, newSlots, now, &admitted);
    if (!result.ok) {
        sendResultError(response, result);
        return;
    }

    Json saved;
    saved["settings"] = JsonCodec::toJson(parkingLot_.settings());
    saved["admittedFromQueue"] = admittedView(admitted);
    saved["summary"] = summaryView(now);
    sendJson(response, 200, saved);
}

void ApiServer::handleBackupNow(const httplib::Request&, httplib::Response& response) {
    std::lock_guard<std::mutex> guard(stateLock_);

    std::string error;
    std::string folder;
    if (!fileManager_.backupNow(error, folder)) {
        sendError(response, "PERSISTENCE_FAILED", "The backup could not be written. " + error);
        return;
    }

    Json body;
    body["backedUpAt"] = fileManager_.lastBackupTime();
    // Only the folder name is returned; the full path stays on the server.
    body["folderName"] = std::filesystem::path(folder).filename().string();
    sendJson(response, 200, body);
}

} // namespace parkwise
