// ParkWise - Smart Parking Management System
//
// Starts the local web server, loads the saved records and hands control
// to ApiServer. Nothing about parking is decided in this file.

#include "ApiServer.h"
#include "DemoMode.h"
#include "FileManager.h"
#include "ParkingLot.h"
#include "TimeUtil.h"

#include <filesystem>
#include <iostream>
#include <string>

namespace fs = std::filesystem;

namespace {

struct Options {
    std::string host = "127.0.0.1"; // local only: this is not a public server
    int port = 8080;
    std::string dataDirectory;
    std::string frontendDirectory;
    bool demo = false;        // a public copy of the site: see DemoMode
    int resetMinutes = 30;
};

// Looks for a folder beside the executable, then one and two levels up,
// so the program works whether it is run from build/ or from the project
// root. Returns an empty string when it is nowhere to be found.
std::string locateDirectory(const fs::path& startFrom, const std::string& name) {
    fs::path candidate = startFrom;
    for (int level = 0; level < 4; level++) {
        std::error_code code;
        const fs::path attempt = candidate / name;
        if (fs::is_directory(attempt, code) && !code) {
            return fs::absolute(attempt).lexically_normal().string();
        }
        candidate = candidate.parent_path();
        if (candidate.empty()) {
            break;
        }
    }
    return std::string();
}

bool parseArguments(int argc, char** argv, Options& options) {
    for (int index = 1; index < argc; index++) {
        const std::string argument = argv[index];
        const bool hasValue = (index + 1) < argc;

        if (argument == "--port" && hasValue) {
            try {
                options.port = std::stoi(argv[++index]);
            } catch (const std::exception&) {
                std::cerr << "The --port value must be a number.\n";
                return false;
            }
        } else if (argument == "--host" && hasValue) {
            options.host = argv[++index];
        } else if (argument == "--data" && hasValue) {
            options.dataDirectory = argv[++index];
        } else if (argument == "--frontend" && hasValue) {
            options.frontendDirectory = argv[++index];
        } else if (argument == "--demo") {
            options.demo = true;
        } else if (argument == "--reset-minutes" && hasValue) {
            try {
                options.resetMinutes = std::stoi(argv[++index]);
            } catch (const std::exception&) {
                std::cerr << "The --reset-minutes value must be a number.\n";
                return false;
            }
        } else if (argument == "--help" || argument == "-h") {
            std::cout << "ParkWise server\n"
                      << "  --host <address>    default 127.0.0.1\n"
                      << "  --port <number>     default 8080\n"
                      << "  --data <folder>     where records are stored\n"
                      << "  --frontend <folder> where the web pages are\n"
                      << "  --demo              public copy: refuse settings changes and\n"
                      << "                      put the records back now and then\n"
                      << "  --reset-minutes <n> how often --demo resets, 0 to never (default 30)\n";
            return false;
        } else {
            std::cerr << "Unknown option: " << argument << "\n";
            return false;
        }
    }
    return true;
}

} // namespace

int main(int argc, char** argv) {
    Options options;
    if (!parseArguments(argc, argv, options)) {
        return 1;
    }

    const fs::path executableFolder = fs::absolute(fs::path(argv[0])).parent_path();

    if (options.frontendDirectory.empty()) {
        options.frontendDirectory = locateDirectory(executableFolder, "frontend");
    }
    if (options.frontendDirectory.empty()) {
        std::cerr << "Could not find the frontend folder. Pass --frontend <folder>.\n";
        return 1;
    }

    if (options.dataDirectory.empty()) {
        // Prefer an existing data folder; otherwise put one beside the
        // frontend, which is the project root in a normal checkout.
        options.dataDirectory = locateDirectory(executableFolder, "data");
        if (options.dataDirectory.empty()) {
            options.dataDirectory =
                (fs::path(options.frontendDirectory).parent_path() / "data").string();
        }
    }

    parkwise::FileManager fileManager(options.dataDirectory);
    parkwise::ParkingLot parkingLot(fileManager);

    parkwise::Result loaded = parkingLot.initialise(parkwise::TimeUtil::now());
    if (!loaded.ok) {
        std::cerr << "\nParkWise could not start.\n"
                  << "  " << loaded.errorCode << ": " << loaded.message << "\n\n"
                  << "No files were changed. Fix or restore the file named above,\n"
                  << "then start ParkWise again.\n";
        return 1;
    }

    parkwise::DemoMode demoMode(options.demo, options.resetMinutes, options.dataDirectory);

    // Taken before the first request is served, so the snapshot is the car
    // park as it was seeded rather than as the first visitor left it.
    std::string snapshotProblem;
    if (!demoMode.takeSnapshot(snapshotProblem)) {
        std::cerr << "\nParkWise could not start in demo mode.\n"
                  << "  " << snapshotProblem << "\n\n"
                  << "Demo mode snapshots the records so it can put them back later.\n";
        return 1;
    }

    parkwise::ApiServer server(parkingLot, fileManager, options.frontendDirectory, demoMode);

    std::cout << "ParkWise 1.0\n"
              << "  Slots configured : " << parkingLot.totalSlotCount() << "\n"
              << "  Vehicles parked  : " << parkingLot.occupiedSlotCount() << "\n"
              << "  Data folder      : " << options.dataDirectory << "\n";
    if (options.demo) {
        std::cout << "  Mode             : public demo - settings and backups refused\n"
                  << "  Records reset    : "
                  << (options.resetMinutes > 0
                          ? "every " + std::to_string(options.resetMinutes) + " minutes"
                          : std::string("never"))
                  << "\n";
    }
    std::cout << "  Open your browser at http://" << options.host << ":" << options.port << "\n"
              << "  Press Ctrl+C to stop.\n"
              << std::endl;

    if (!server.listen(options.host, options.port)) {
        std::cerr << "Could not listen on " << options.host << ":" << options.port
                  << ". Is another program already using that port?\n";
        return 1;
    }
    return 0;
}
