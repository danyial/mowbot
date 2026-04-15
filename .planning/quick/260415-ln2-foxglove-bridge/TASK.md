# Quick Task: 260415-ln2-foxglove-bridge

## Problem
rosbridge_server v2 (Humble) JSON serializer throws on every `float[]`-bearing
message (LaserScan, Odometry, TFMessage) when Foxglove Studio's Rosbridge
adapter subscribes. Pi 4 hits ~85% CPU in the exception loop. Foxglove does not
request CBOR, so the web client's workaround doesn't apply.

## Solution
Add `foxglove_bridge` as a separate service: native Foxglove WebSocket protocol
on port 8765, own serializer (no bug). Runs alongside rosbridge (unchanged),
which continues to serve the web UI on :9090.

## Deliverables
1. `docker/foxglove_bridge/Dockerfile` — `ros:humble-ros-base` +
   `ros-humble-foxglove-bridge` apt package.
2. `docker-compose.yml` — new `foxglove_bridge` service inheriting `*ros-common`
   (network_mode:host, ipc:host, pid:host). No `CYCLONEDDS_URI` (Pi rmem ceiling
   incompat, per Plan 04-01 deviation).
3. `docker-compose.build.yml` — build stanza for the new service.

## Deploy
`~/mowbot` on `pi@10.10.40.23`:
1. scp Dockerfile + updated compose files.
2. `docker compose -f docker-compose.yml -f docker-compose.build.yml build foxglove_bridge`
3. `docker compose up -d foxglove_bridge`
4. Verify logs show "Foxglove WebSocket server listening on 0.0.0.0:8765" and
   `ss -tlnp | grep 8765` binds.

## Acceptance
- Container healthy, idle CPU near 0%.
- Port 8765 reachable from Mac (`nc -zv 10.10.40.23 8765`).
- Foxglove Studio connects via "Foxglove WebSocket" at `ws://10.10.40.23:8765`.
- rosbridge untouched; web UI still works on :9090.
