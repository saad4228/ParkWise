"""Writes a believable day at a 50-bay car park into a data folder.

Usage: python tools/seed_demo.py <data-folder>

Running it against the live "data" folder replaces whatever is there, so
take a copy first if those records matter.

Every record is one the real server could have produced: fees follow the
started-hour rule, occupancy is implied by active tickets (the server rebuilds
it from them on start-up), and a bike is queueing only because every bike bay
is full.
"""
import json
import os
import random
import sys
import time
from datetime import datetime

random.seed(7)

if len(sys.argv) < 2:
    print(__doc__.strip())
    print("")
    print("Example:  python tools/seed_demo.py data")
    raise SystemExit(1)

folder = sys.argv[1]
os.makedirs(folder, exist_ok=True)

RATES = {"CAR": 3000, "BIKE": 1000, "SUV": 5000}
ROWS = [("A", "CAR"), ("B", "CAR"), ("C", "CAR"), ("D", "SUV"), ("E", "BIKE")]
slots = [{"slotId": f"{letter}{n:02d}", "supportedVehicleType": kind,
          "occupied": False, "activeTicketId": ""}
         for letter, kind in ROWS for n in range(1, 11)]

now = int(time.time())
today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
day0 = int(today.timestamp())
STATES = ["MH", "KA", "DL", "GJ", "TN", "UP"]
counter = [0]


def plate():
    return (f"{random.choice(STATES)}{random.randint(1, 48):02d}"
            f"{random.choice('ABCDEFGHJKLMNPRSTUVWXYZ')}{random.choice('ABCDEFGHJKLMNPRSTUVWXYZ')}"
            f"{random.randint(1000, 9999)}")


def ticket_id():
    counter[0] += 1
    return f"PW-DEMO{counter[0]:03d}-{random.randint(1000, 9999)}"


def fee(entry, exit_, rate):
    minutes = max(0, (exit_ - entry) // 60)
    hours = 0 if minutes == 0 else (minutes + 59) // 60
    return hours, hours * rate


def busy_hour():
    # Arrivals cluster around the morning and the late afternoon.
    return random.choice([8, 8, 9, 9, 9, 10, 11, 12, 13, 14, 16, 17, 17, 18])


tickets = []

# Finished sessions over the previous six days, for Reports.
for days_ago in range(6, 0, -1):
    for _ in range(random.randint(14, 24)):
        kind = random.choice(["CAR", "CAR", "CAR", "SUV", "BIKE"])
        start = day0 - days_ago * 86400 + busy_hour() * 3600 + random.randint(0, 3599)
        stay = random.randint(25, 300) * 60
        hours, paid = fee(start, start + stay, RATES[kind])
        bay = random.choice([s for s in slots if s["supportedVehicleType"] == kind])
        tickets.append({"ticketId": ticket_id(), "registrationNumber": plate(), "vehicleType": kind,
                        "ownerName": "", "contactNumber": "", "slotId": bay["slotId"],
                        "entryTime": start, "exitTime": start + stay, "hourlyRatePaise": RATES[kind],
                        "billableHours": hours, "finalFeePaise": paid,
                        "status": "COMPLETED", "source": "WALK_IN"})

# Finished sessions earlier today: arrivals and departures already behind us.
hour_now = datetime.now().hour
for _ in range(22):
    kind = random.choice(["CAR", "CAR", "SUV", "BIKE"])
    start_hour = random.randint(7, max(7, hour_now - 1))
    start = day0 + start_hour * 3600 + random.randint(0, 3599)
    stay = random.randint(20, 180) * 60
    end = min(start + stay, now - 300)
    if end <= start:
        continue
    hours, paid = fee(start, end, RATES[kind])
    bay = random.choice([s for s in slots if s["supportedVehicleType"] == kind])
    tickets.append({"ticketId": ticket_id(), "registrationNumber": plate(), "vehicleType": kind,
                    "ownerName": "", "contactNumber": "", "slotId": bay["slotId"],
                    "entryTime": start, "exitTime": end, "hourlyRatePaise": RATES[kind],
                    "billableHours": hours, "finalFeePaise": paid,
                    "status": "COMPLETED", "source": "WALK_IN"})

# Vehicles parked right now. Every bike bay is full, so a bike can queue.
owners = ["Rahul Sharma", "Priya Nair", "", "", "Arjun Mehta", "", "Sana Khan", ""]
parked_ids = set()
for bay in slots:
    kind = bay["supportedVehicleType"]
    take = {"CAR": 0.62, "SUV": 0.5, "BIKE": 1.0}[kind]
    if random.random() > take:
        continue
    start = now - random.randint(15, 420) * 60
    tid = ticket_id()
    tickets.append({"ticketId": tid, "registrationNumber": plate(), "vehicleType": kind,
                    "ownerName": random.choice(owners), "contactNumber": "", "slotId": bay["slotId"],
                    "entryTime": start, "exitTime": 0, "hourlyRatePaise": RATES[kind],
                    "billableHours": 0, "finalFeePaise": 0, "status": "ACTIVE", "source": "WALK_IN"})
    parked_ids.add(bay["slotId"])

# Upcoming bookings on bays that are empty now.
free_cars = [s["slotId"] for s in slots
             if s["supportedVehicleType"] in ("CAR", "SUV") and s["slotId"] not in parked_ids]
reservations = []
for index, bay in enumerate(free_cars[:3]):
    start = now + (index + 1) * 3600 + 900
    kind = "SUV" if bay.startswith("D") else "CAR"
    reservations.append({"reservationId": f"RS-DEMO{index:02d}-{random.randint(1000, 9999)}",
                         "registrationNumber": plate(), "vehicleType": kind, "slotId": bay,
                         "startTime": start, "endTime": start + 2 * 3600, "createdAt": now - 7200,
                         "status": "UPCOMING", "ticketId": ""})

queue = [{"requestId": f"QR-DEMO01-{random.randint(1000, 9999)}", "registrationNumber": plate(),
          "vehicleType": "BIKE", "ownerName": "", "contactNumber": "", "arrivalTime": now - 600,
          "status": "WAITING", "assignedSlotId": "", "assignedTicketId": ""}]

settings = {"bikeHourlyRatePaise": 1000, "carHourlyRatePaise": 3000, "suvHourlyRatePaise": 5000,
            "reservationGraceMinutes": 30, "currency": "INR"}


def write(name, payload):
    with open(os.path.join(folder, name), "w", encoding="utf-8", newline="") as handle:
        json.dump(payload, handle, indent=2)


write("config.json", {"settings": settings, "slots": slots})
write("tickets.json", {"tickets": tickets})
write("reservations.json", {"reservations": reservations})
write("queue.json", {"requests": queue})

active = sum(1 for t in tickets if t["status"] == "ACTIVE")
print(f"{len(slots)} bays, {active} parked, {len(tickets) - active} finished sessions, "
      f"{len(reservations)} bookings, {len(queue)} waiting")
