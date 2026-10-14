# Two stages: the first compiles, the second carries only what is needed to
# run. The build tools never reach the published image.

FROM debian:bookworm-slim AS build

RUN apt-get update \
    && apt-get install -y --no-install-recommends g++ cmake ninja-build python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY CMakeLists.txt ./
COPY include/ include/
COPY src/ src/
COPY tests/ tests/
COPY third_party/ third_party/

RUN cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release \
    && cmake --build build

# A deployment that fails its own tests should not reach anyone.
RUN ./build/bin/parkwise_tests

# Fills the car park so a visitor arrives at a working day rather than fifty
# empty bays. This is also the snapshot --demo restores to.
COPY tools/ tools/
RUN mkdir -p /seed && python3 tools/seed_demo.py /seed


FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends libstdc++6 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --shell /usr/sbin/nologin parkwise

WORKDIR /app
COPY --from=build /src/build/bin/parkwise /app/parkwise
COPY --from=build /seed /app/data
COPY frontend/ /app/frontend/

RUN chown -R parkwise:parkwise /app
USER parkwise

EXPOSE 8080

# 0.0.0.0 because the host reaches the container from outside it. --demo is
# what makes that safe: settings and backups are refused, and the records go
# back to the seeded day every half hour. Drop --demo only for a copy nobody
# else can reach.
CMD ["/app/parkwise", "--host", "0.0.0.0", "--port", "8080", \
     "--data", "/app/data", "--frontend", "/app/frontend", \
     "--demo", "--reset-minutes", "30"]
