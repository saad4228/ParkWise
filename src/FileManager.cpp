#include "FileManager.h"

#include <algorithm>
#include <cstdio>
#include <ctime>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <utility>

namespace parkwise {

namespace {

const char* kConfigFile = "config.json";
const char* kTicketsFile = "tickets.json";
const char* kReservationsFile = "reservations.json";
const char* kQueueFile = "queue.json";
const char* kBackupsFolder = "backups";
const char* kLastBackupFile = "backups/last-backup.json";

namespace fs = std::filesystem;

// Reads an array of records out of a wrapper object, converting each one
// with the supplied function. Any single bad record fails the whole load,
// because quietly dropping a parked vehicle would be worse than stopping.
template <typename T, typename Converter>
bool readRecordArray(const JsonCodec::Json& root,
                     const char* arrayKey,
                     std::vector<T>& outItems,
                     Converter convert,
                     const char* fileName,
                     std::string& errorMessage) {
    if (!root.contains(arrayKey)) {
        return true; // an absent list simply means there are none
    }
    if (!root.at(arrayKey).is_array()) {
        errorMessage = std::string(fileName) + ": " + arrayKey + " is not a list.";
        return false;
    }

    for (const JsonCodec::Json& entry : root.at(arrayKey)) {
        T item;
        std::string recordError;
        if (!convert(entry, item, recordError)) {
            errorMessage = std::string(fileName) + ": " + recordError;
            return false;
        }
        outItems.push_back(item);
    }
    return true;
}

std::string formatBackupFolderName(Timestamp when) {
    std::time_t raw = static_cast<std::time_t>(when);
    std::tm parts{};
#ifdef _WIN32
    localtime_s(&parts, &raw);
#else
    localtime_r(&raw, &parts);
#endif
    char buffer[64];
    std::strftime(buffer, sizeof(buffer), "backup-%Y%m%d-%H%M%S", &parts);
    return std::string(buffer);
}

} // namespace

FileManager::FileManager(const std::string& dataDirectory)
    : dataDirectory_(dataDirectory) {}

std::string FileManager::pathFor(const std::string& fileName) const {
    return (fs::path(dataDirectory_) / fileName).string();
}

bool FileManager::ensureDataDirectory(std::string& errorMessage) {
    std::error_code code;
    fs::create_directories(dataDirectory_, code);
    if (code) {
        errorMessage = "Could not create the data folder: " + code.message();
        return false;
    }
    fs::create_directories(fs::path(dataDirectory_) / kBackupsFolder, code);
    if (code) {
        errorMessage = "Could not create the backups folder: " + code.message();
        return false;
    }
    return true;
}

bool FileManager::readJsonFile(const std::string& fileName, Json& outValue,
                               bool& existed, std::string& errorMessage) const {
    existed = false;
    const std::string path = pathFor(fileName);

    std::error_code code;
    if (!fs::exists(path, code) || code) {
        return true; // nothing saved yet - a normal first run
    }

    std::ifstream input(path, std::ios::binary);
    if (!input) {
        errorMessage = fileName + " exists but could not be opened for reading.";
        return false;
    }

    std::stringstream buffer;
    buffer << input.rdbuf();
    const std::string text = buffer.str();

    // A zero-length file is treated as damaged rather than as "no records",
    // so a crash during a write can never look like an empty car park.
    if (text.find_first_not_of(" \t\r\n") == std::string::npos) {
        errorMessage = fileName + " is empty. A previous save may have been interrupted. "
                                  "Check the .bak file next to it before continuing.";
        return false;
    }

    outValue = Json::parse(text, nullptr, false);
    if (outValue.is_discarded()) {
        errorMessage = fileName + " is not valid JSON and was not loaded. "
                                  "The previous copy is kept as " + fileName + ".bak";
        return false;
    }

    existed = true;
    return true;
}

bool FileManager::writeTempFile(const std::string& fileName, const Json& value,
                                std::string& errorMessage) const {
    const std::string tempPath = pathFor(fileName) + ".tmp";

    std::ofstream output(tempPath, std::ios::binary | std::ios::trunc);
    if (!output) {
        errorMessage = "Could not open " + fileName + ".tmp for writing.";
        return false;
    }
    output << value.dump(2);
    output.flush();
    if (!output) {
        errorMessage = "Failed while writing " + fileName + ".tmp";
        return false;
    }
    output.close(); // closing here makes sure the bytes reach the disk
    if (output.fail()) {
        errorMessage = "Failed while closing " + fileName + ".tmp";
        return false;
    }
    return true;
}

bool FileManager::commitTempFile(const std::string& fileName, std::string& errorMessage) const {
    const std::string finalPath = pathFor(fileName);
    const std::string tempPath = finalPath + ".tmp";
    const std::string backupPath = finalPath + ".bak";

    std::error_code code;

    // Keep the previous good copy before replacing it.
    if (fs::exists(finalPath, code) && !code) {
        fs::copy_file(finalPath, backupPath, fs::copy_options::overwrite_existing, code);
        if (code) {
            errorMessage = "Could not back up " + fileName + ": " + code.message();
            return false;
        }
    }

    code.clear();
    fs::rename(tempPath, finalPath, code);
    if (code) {
        // Some Windows setups refuse to rename onto an existing file.
        std::error_code removeCode;
        fs::remove(finalPath, removeCode);
        code.clear();
        fs::rename(tempPath, finalPath, code);
    }
    if (code) {
        errorMessage = "Could not put the new " + fileName + " in place: " + code.message();
        return false;
    }
    return true;
}

void FileManager::discardTempFile(const std::string& fileName) const {
    std::error_code ignored;
    fs::remove(pathFor(fileName) + ".tmp", ignored);
}

bool FileManager::writeJsonFileSafely(const std::string& fileName, const Json& value,
                                      std::string& errorMessage) const {
    if (!writeTempFile(fileName, value, errorMessage)) {
        discardTempFile(fileName);
        return false;
    }
    return commitTempFile(fileName, errorMessage);
}

bool FileManager::loadConfig(StoredData& outData, bool& existed, std::string& errorMessage) const {
    Json root;
    if (!readJsonFile(kConfigFile, root, existed, errorMessage)) {
        return false;
    }
    if (!existed) {
        return true;
    }
    if (!root.is_object()) {
        errorMessage = std::string(kConfigFile) + ": the file does not contain a JSON object.";
        return false;
    }

    if (root.contains("settings")) {
        std::string settingsError;
        if (!JsonCodec::settingsFromJson(root.at("settings"), outData.settings, settingsError)) {
            errorMessage = std::string(kConfigFile) + ": " + settingsError;
            return false;
        }
    }

    return readRecordArray(root, "slots", outData.slots, JsonCodec::slotFromJson,
                           kConfigFile, errorMessage);
}

bool FileManager::loadTickets(StoredData& outData, bool& existed, std::string& errorMessage) const {
    Json root;
    if (!readJsonFile(kTicketsFile, root, existed, errorMessage)) {
        return false;
    }
    if (!existed) {
        return true;
    }
    if (!root.is_object()) {
        errorMessage = std::string(kTicketsFile) + ": the file does not contain a JSON object.";
        return false;
    }
    return readRecordArray(root, "tickets", outData.tickets, JsonCodec::ticketFromJson,
                           kTicketsFile, errorMessage);
}

bool FileManager::loadReservations(StoredData& outData, bool& existed, std::string& errorMessage) const {
    Json root;
    if (!readJsonFile(kReservationsFile, root, existed, errorMessage)) {
        return false;
    }
    if (!existed) {
        return true;
    }
    if (!root.is_object()) {
        errorMessage = std::string(kReservationsFile) + ": the file does not contain a JSON object.";
        return false;
    }
    return readRecordArray(root, "reservations", outData.reservations,
                           JsonCodec::reservationFromJson, kReservationsFile, errorMessage);
}

bool FileManager::loadQueue(StoredData& outData, bool& existed, std::string& errorMessage) const {
    Json root;
    if (!readJsonFile(kQueueFile, root, existed, errorMessage)) {
        return false;
    }
    if (!existed) {
        return true;
    }
    if (!root.is_object()) {
        errorMessage = std::string(kQueueFile) + ": the file does not contain a JSON object.";
        return false;
    }
    return readRecordArray(root, "requests", outData.queueRequests,
                           JsonCodec::queueRequestFromJson, kQueueFile, errorMessage);
}

bool FileManager::load(StoredData& outData, std::string& errorMessage) {
    if (!ensureDataDirectory(errorMessage)) {
        return false;
    }

    StoredData loaded;
    bool configExisted = false;
    bool ticketsExisted = false;
    bool reservationsExisted = false;
    bool queueExisted = false;

    if (!loadConfig(loaded, configExisted, errorMessage)) return false;
    if (!loadTickets(loaded, ticketsExisted, errorMessage)) return false;
    if (!loadReservations(loaded, reservationsExisted, errorMessage)) return false;
    if (!loadQueue(loaded, queueExisted, errorMessage)) return false;

    loaded.hadExistingFiles =
        configExisted || ticketsExisted || reservationsExisted || queueExisted;

    outData = loaded;
    return true;
}

bool FileManager::save(const StoredData& data, std::string& errorMessage) {
    if (!ensureDataDirectory(errorMessage)) {
        return false;
    }

    Json config;
    config["settings"] = JsonCodec::toJson(data.settings);
    config["slots"] = Json::array();
    for (const ParkingSlot& slot : data.slots) {
        config["slots"].push_back(JsonCodec::toJson(slot));
    }

    Json tickets;
    tickets["tickets"] = Json::array();
    for (const ParkingTicket& ticket : data.tickets) {
        tickets["tickets"].push_back(JsonCodec::toJson(ticket));
    }

    Json reservations;
    reservations["reservations"] = Json::array();
    for (const Reservation& reservation : data.reservations) {
        reservations["reservations"].push_back(JsonCodec::toJson(reservation));
    }

    Json queue;
    queue["requests"] = Json::array();
    for (const QueueRequest& request : data.queueRequests) {
        queue["requests"].push_back(JsonCodec::toJson(request));
    }

    const std::pair<const char*, const Json*> files[] = {
        {kConfigFile, &config},
        {kTicketsFile, &tickets},
        {kReservationsFile, &reservations},
        {kQueueFile, &queue},
    };

    // Pass one: nothing already on disk is touched yet, so a failure here
    // leaves the previous records exactly as they were.
    for (const auto& file : files) {
        if (!writeTempFile(file.first, *file.second, errorMessage)) {
            for (const auto& cleanup : files) {
                discardTempFile(cleanup.first);
            }
            return false;
        }
    }

    // Pass two: move the finished files into place.
    for (const auto& file : files) {
        if (!commitTempFile(file.first, errorMessage)) {
            for (const auto& cleanup : files) {
                discardTempFile(cleanup.first);
            }
            return false;
        }
    }
    return true;
}

bool FileManager::backupNow(std::string& errorMessage, std::string& outBackupFolder) {
    if (!ensureDataDirectory(errorMessage)) {
        return false;
    }

    const Timestamp now = static_cast<Timestamp>(std::time(nullptr));
    const fs::path folder =
        fs::path(dataDirectory_) / kBackupsFolder / formatBackupFolderName(now);

    std::error_code code;
    fs::create_directories(folder, code);
    if (code) {
        errorMessage = "Could not create the backup folder: " + code.message();
        return false;
    }

    const char* files[] = {kConfigFile, kTicketsFile, kReservationsFile, kQueueFile};
    for (const char* fileName : files) {
        const std::string source = pathFor(fileName);
        if (!fs::exists(source, code) || code) {
            continue; // nothing written for this file yet
        }
        fs::copy_file(source, folder / fileName, fs::copy_options::overwrite_existing, code);
        if (code) {
            errorMessage = std::string("Could not copy ") + fileName + " into the backup: " +
                           code.message();
            return false;
        }
    }

    Json marker;
    marker["timestamp"] = now;
    marker["folder"] = folder.filename().string();
    if (!writeJsonFileSafely(kLastBackupFile, marker, errorMessage)) {
        return false;
    }

    outBackupFolder = folder.string();
    return true;
}

Timestamp FileManager::lastBackupTime() const {
    Json marker;
    bool existed = false;
    std::string ignoredError;
    if (!readJsonFile(kLastBackupFile, marker, existed, ignoredError) || !existed) {
        return 0;
    }
    if (marker.is_object() && marker.contains("timestamp") &&
        marker.at("timestamp").is_number_integer()) {
        return marker.at("timestamp").get<Timestamp>();
    }
    return 0;
}

long long FileManager::totalStoredBytes() const {
    const char* files[] = {kConfigFile, kTicketsFile, kReservationsFile, kQueueFile};
    long long total = 0;
    for (const char* fileName : files) {
        std::error_code code;
        const auto size = fs::file_size(pathFor(fileName), code);
        if (!code) {
            total += static_cast<long long>(size);
        }
    }
    return total;
}

} // namespace parkwise
