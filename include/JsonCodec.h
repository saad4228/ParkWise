#ifndef PARKWISE_JSON_CODEC_H
#define PARKWISE_JSON_CODEC_H

#include "ParkingSettings.h"
#include "ParkingSlot.h"
#include "ParkingTicket.h"
#include "QueueManager.h"
#include "Reservation.h"

#include <nlohmann/json.hpp>
#include <string>

namespace parkwise {

// Translates between the program's objects and the JSON used in the saved
// files and in API replies.
//
// It lives in its own file so that there is only one description of what
// a ticket or a reservation looks like as JSON. FileManager uses it to
// save and load; ApiServer uses it to answer the browser.
//
// Every read function returns false and fills errorMessage instead of
// throwing, so one bad record can be reported rather than crashing the
// program.
namespace JsonCodec {

using Json = nlohmann::json;

Json toJson(const ParkingSlot& slot);
Json toJson(const ParkingTicket& ticket);
Json toJson(const Reservation& reservation);
Json toJson(const QueueRequest& request);
Json toJson(const ParkingSettings& settings);

bool slotFromJson(const Json& value, ParkingSlot& outSlot, std::string& errorMessage);
bool ticketFromJson(const Json& value, ParkingTicket& outTicket, std::string& errorMessage);
bool reservationFromJson(const Json& value, Reservation& outReservation, std::string& errorMessage);
bool queueRequestFromJson(const Json& value, QueueRequest& outRequest, std::string& errorMessage);
bool settingsFromJson(const Json& value, ParkingSettings& outSettings, std::string& errorMessage);

} // namespace JsonCodec

} // namespace parkwise

#endif
