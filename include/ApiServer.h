#ifndef PARKWISE_API_SERVER_H
#define PARKWISE_API_SERVER_H

#include "DemoMode.h"
#include "JsonCodec.h"
#include "ParkingLot.h"

#include <httplib.h>
#include <mutex>
#include <string>

namespace parkwise {

// The web layer.
//
// It does three things and nothing more: turn an HTTP request into plain
// values, ask ParkingLot to do the work, and turn the answer back into
// JSON. No slot is chosen and no fee is worked out in this file.
//
// Every request is handled while holding one lock. cpp-httplib answers
// requests on several threads, and serialising them is the simplest
// correct way to stop two clicks arriving together from claiming the
// same slot twice.
class ApiServer {
public:
    ApiServer(ParkingLot& parkingLot, FileManager& fileManager,
              const std::string& frontendDirectory, DemoMode& demoMode);

    // Blocks until the server stops. Returns false if the port is taken.
    bool listen(const std::string& host, int port);

    void stop();

private:
    using Json = JsonCodec::Json;

    void registerRoutes();

    // ---- route handlers ----
    void handleDashboard(const httplib::Request& request, httplib::Response& response);
    void handleListSlots(const httplib::Request& request, httplib::Response& response);
    void handleGetSlot(const httplib::Request& request, httplib::Response& response);
    void handleVehicleEntry(const httplib::Request& request, httplib::Response& response);
    void handleVehicleExit(const httplib::Request& request, httplib::Response& response);
    void handleTicketLookup(const httplib::Request& request, httplib::Response& response);
    void handleGetTicket(const httplib::Request& request, httplib::Response& response);
    void handleListReservations(const httplib::Request& request, httplib::Response& response);
    void handleCreateReservation(const httplib::Request& request, httplib::Response& response);
    void handleCancelReservation(const httplib::Request& request, httplib::Response& response);
    void handleCheckInReservation(const httplib::Request& request, httplib::Response& response);
    void handleListQueue(const httplib::Request& request, httplib::Response& response);
    void handleAddToQueue(const httplib::Request& request, httplib::Response& response);
    void handleCancelQueueRequest(const httplib::Request& request, httplib::Response& response);
    void handleHistory(const httplib::Request& request, httplib::Response& response);
    void handleReports(const httplib::Request& request, httplib::Response& response);
    void handleExportHistoryCsv(const httplib::Request& request, httplib::Response& response);
    void handleGetSettings(const httplib::Request& request, httplib::Response& response);
    void handleUpdateSettings(const httplib::Request& request, httplib::Response& response);
    void handleBackupNow(const httplib::Request& request, httplib::Response& response);
    void handleMeta(const httplib::Request& request, httplib::Response& response);

    // Puts the records back to how they started if the demo interval has
    // passed. Called before every request, so a visitor arriving after a
    // quiet spell always finds the car park as it was meant to look.
    void resetDemoIfDue();

    // ---- shared helpers ----
    static void sendJson(httplib::Response& response, int status, const Json& body);
    static void sendError(httplib::Response& response, const std::string& code,
                          const std::string& message);
    static void sendResultError(httplib::Response& response, const Result& result);
    static int httpStatusFor(const std::string& errorCode);

    // Returns false and answers with 400 when the body is not valid JSON.
    static bool readJsonBody(const httplib::Request& request, httplib::Response& response,
                             Json& outBody);

    // Views sent to the browser: the stored record plus the handful of
    // values that are worked out rather than saved.
    Json ticketView(const ParkingTicket& ticket, Timestamp now) const;
    Json slotView(const ParkingSlot& slot, Timestamp now) const;
    Json reservationView(const Reservation& reservation, Timestamp now) const;
    Json queueRequestView(const QueueRequest& request) const;
    Json summaryView(Timestamp now) const;

    // Vehicles that were let in off the waiting list by the operation that
    // has just run, so the screen can say who took which slot.
    static Json admittedView(const std::vector<QueueAssignment>& admitted);

    ParkingLot& parkingLot_;
    FileManager& fileManager_;
    DemoMode& demoMode_;
    std::string frontendDirectory_;
    httplib::Server server_;
    std::mutex stateLock_;
};

} // namespace parkwise

#endif
