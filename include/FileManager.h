#ifndef PARKWISE_FILE_MANAGER_H
#define PARKWISE_FILE_MANAGER_H

#include "JsonCodec.h"
#include "ParkingSettings.h"
#include "ParkingSlot.h"
#include "ParkingTicket.h"
#include "QueueManager.h"
#include "Reservation.h"

#include <string>
#include <vector>

namespace parkwise {

// Everything the program keeps on disk, in one plain bundle.
// FileManager fills it when loading and writes it back when saving.
struct StoredData {
    ParkingSettings settings;
    std::vector<ParkingSlot> slots;
    std::vector<ParkingTicket> tickets;       // active and completed together
    std::vector<Reservation> reservations;
    std::vector<QueueRequest> queueRequests;

    // False on a genuinely first run, when no data files exist yet.
    // It is NOT set false by an empty or damaged file.
    bool hadExistingFiles = false;
};

// Reads and writes the JSON files under the data folder.
//
// It makes no decisions about parking: it only moves records between disk
// and memory, checks that what it read is well formed, and reports any
// problem instead of guessing.
//
// Two rules protect the operator's records:
//   1. A missing file means "nothing saved yet" and is fine.
//   2. A file that exists but cannot be read is a hard failure. The program
//      refuses to continue rather than starting blank and overwriting it.
class FileManager {
public:
    explicit FileManager(const std::string& dataDirectory);

    // Creates the data folder if it is not there yet.
    bool ensureDataDirectory(std::string& errorMessage);

    bool load(StoredData& outData, std::string& errorMessage);

    // Writes all four files in two passes: first every file is written out
    // under a .tmp name, and only when all four have succeeded are they
    // moved into place. A disk problem is therefore almost always caught
    // while the previous records are still untouched.
    bool save(const StoredData& data, std::string& errorMessage);

    // Copies the current files into data/backups/backup-<date>-<time>/.
    bool backupNow(std::string& errorMessage, std::string& outBackupFolder);

    // 0 when no backup has been taken yet.
    Timestamp lastBackupTime() const;

    // Rough size of the stored records, shown on the Settings screen.
    long long totalStoredBytes() const;

private:
    using Json = JsonCodec::Json;

    std::string pathFor(const std::string& fileName) const;

    // existed is false when the file is simply not there yet.
    bool readJsonFile(const std::string& fileName, Json& outValue,
                      bool& existed, std::string& errorMessage) const;

    // Pass one: write the new contents beside the real file, as name.tmp
    bool writeTempFile(const std::string& fileName, const Json& value,
                       std::string& errorMessage) const;

    // Pass two: keep a .bak of the old file and move name.tmp into place.
    bool commitTempFile(const std::string& fileName, std::string& errorMessage) const;

    void discardTempFile(const std::string& fileName) const;

    // Used for the small last-backup marker, where the two-pass dance is
    // not worth it.
    bool writeJsonFileSafely(const std::string& fileName, const Json& value,
                             std::string& errorMessage) const;

    bool loadConfig(StoredData& outData, bool& existed, std::string& errorMessage) const;
    bool loadTickets(StoredData& outData, bool& existed, std::string& errorMessage) const;
    bool loadReservations(StoredData& outData, bool& existed, std::string& errorMessage) const;
    bool loadQueue(StoredData& outData, bool& existed, std::string& errorMessage) const;

    std::string dataDirectory_;
};

} // namespace parkwise

#endif
