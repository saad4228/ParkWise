cmake_minimum_required(VERSION 3.20)

project(ParkWise VERSION 1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
    set(CMAKE_BUILD_TYPE Release CACHE STRING "Build type" FORCE)
endif()

# With MinGW the finished programs are linked statically. That way
# parkwise.exe runs on any Windows machine by itself, instead of asking for
# libstdc++-6.dll and friends to be on the PATH.
if(MINGW)
    add_link_options(-static -static-libgcc -static-libstdc++)
endif()

# The parking rules live in their own library so that both the server and
# the test program can use exactly the same code.
add_library(parkwise_core STATIC
    src/Types.cpp
    src/TimeUtil.cpp
    src/Vehicle.cpp
    src/ParkingSlot.cpp
    src/ParkingTicket.cpp
    src/Reservation.cpp
    src/QueueManager.cpp
    src/BillingService.cpp
    src/ParkingSettings.cpp
    src/JsonCodec.cpp
    src/FileManager.cpp
    src/ParkingLot.cpp
    src/ReportService.cpp
)

target_include_directories(parkwise_core PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/include
    ${CMAKE_CURRENT_SOURCE_DIR}/third_party
)

if(MSVC)
    target_compile_options(parkwise_core PRIVATE /W4 /utf-8)
else()
    target_compile_options(parkwise_core PRIVATE -Wall -Wextra)
endif()

# ---- the web server ----
add_executable(parkwise
    src/main.cpp
    src/ApiServer.cpp
)
target_link_libraries(parkwise PRIVATE parkwise_core)

find_package(Threads REQUIRED)
target_link_libraries(parkwise PRIVATE Threads::Threads)

if(WIN32)
    # cpp-httplib needs the Windows sockets library.
    target_link_libraries(parkwise PRIVATE ws2_32)
endif()

if(MSVC)
    target_compile_options(parkwise PRIVATE /W4 /utf-8)
else()
    target_compile_options(parkwise PRIVATE -Wall -Wextra)
endif()

# ---- the business logic tests ----
add_executable(parkwise_tests tests/test_main.cpp)
target_link_libraries(parkwise_tests PRIVATE parkwise_core)

if(MSVC)
    target_compile_options(parkwise_tests PRIVATE /W4 /utf-8)
else()
    target_compile_options(parkwise_tests PRIVATE -Wall -Wextra)
endif()

enable_testing()
add_test(NAME parkwise_business_rules COMMAND parkwise_tests)

# Put both programs in the same folder so the run scripts are simple.
set_target_properties(parkwise parkwise_tests PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/bin
)
