# 03-01 PROBE — `server.mjs` × CBOR binary frames

**Date:** 2026-04-14
**Phase:** 03 — web-visualization-scan-on-the-map-page
**Plan:** 01 (Commit A — global CBOR retrofit)
**Host probed:** `10.10.40.23` (mower Pi, `~/mowbot`, all services up)

---

## Step 1 — Services live

```
$ sshpass -p password ssh ... pi@10.10.40.23 'docker ps --format "{{.Names}}\t{{.Status}}"'
mower-lidar       Up About an hour
mower-nav         Up About an hour
mower-web         Up About an hour
mower-ntrip       Up About an hour
mower-micro-ros   Up About an hour
mower-rosbridge   Up About an hour
mower-imu         Up About an hour
mower-gnss        Up About an hour
```

Topic list (via `mower-nav` container, sourcing `/opt/ros/humble/setup.bash`):

```
/accel/filtered
/client_count
/connected_clients
/diagnostics
/fix
/gps/filtered
/heading
/imu
/odometry/filtered
/odometry/gps
/parameter_events
/rosout
/scan
/set_pose
/tf
/tf_static
/time_reference
/vel
```

`/scan`, `/fix`, `/imu`, `/diagnostics`, `/odometry/filtered` all publishing live.
Note: `/battery_voltage` and `/mower/status` are subscribed by the web client but NOT currently published on the mower (expected — no battery ADC publisher yet, no mission-state publisher yet). Regression matrix in Task 4 will reflect this (marked N/A, not red).

---

## Step 2 — Direct rosbridge CBOR (bypassing `server.mjs`)

Connected straight to `ws://10.10.40.23:9090`, subscribed `/fix` with `compression: "cbor"`:

```
$ node /tmp/cbor_probe.mjs
# 1 isBinary=true len=256 head=[0xa3 0x62 0x6f 0x70 0x67 0x70]
# 2 isBinary=true len=256 head=[0xa3 0x62 0x6f 0x70 0x67 0x70]
# 3 isBinary=true len=256 head=[0xa3 0x62 0x6f 0x70 0x67 0x70]
```

- `isBinary=true` — rosbridge sends CBOR as proper binary WebSocket frames.
- First byte `0xA3` = CBOR major type 5 (map) with 3 pairs — exactly what RESEARCH P2 predicted for a rosbridge publish envelope.
- Bytes `0x62 0x6f 0x70` = CBOR text(2) "op", confirming the wrapper encodes the standard `{op, topic, msg}` rosbridge envelope as CBOR.

**Verdict for step 2:** native rosbridge emits CBOR binary frames correctly.

---

## Step 3 / 4 — Through `server.mjs` proxy

Connected to `ws://10.10.40.23:3000/rosbridge` (which proxies through `server.mjs`'s NaN sanitizer), same subscribe payload:

```
$ node /tmp/cbor_proxy_probe.mjs
opened /rosbridge proxy; subscribing /fix CBOR
TIMEOUT after 8s; received= 0
```

Zero messages received in 8 seconds, with `/fix` publishing at 5 Hz directly upstream (step 2 proved). The proxy swallows / corrupts binary frames.

**Root cause (analytical, not re-probed):** `web/server.mjs` lines 26-36 + 87-92 — the `rosbridgeWs.on("message", (data) => ...)` handler runs every frame through `sanitizeNaN()` which calls `data.toString("utf-8")` on Buffers. A CBOR Buffer contains non-UTF-8 bytes (`0xA3` is not a valid leading UTF-8 byte for most contexts), so `.toString("utf-8")` replaces them with `U+FFFD` replacement characters. The result is then `clientWs.send(cleaned)` — a STRING send, which emits a TEXT frame instead of the original BINARY frame. `roslibjs` in the browser receives corrupt text and drops it silently (no CBOR parser invoked because the frame type is wrong).

This matches RESEARCH P2's exact prediction. The bypass probe in step 2 isolates the fault to `server.mjs` — it is not a rosbridge or network-level issue.

---

## Verdict

```
SERVER_MJS_CBOR_OK: no
```

**Implication for Task 3:** Apply the `isBinary` guard branch. Binary frames must be forwarded with `clientWs.send(data, { binary: true })` and NOT passed through `sanitizeNaN`. Text frames (JSON) continue through the existing NaN-sanitizer path.

**Implication for Task 2:** Proceed as planned — global `compression: "cbor"` on all 6 subscribed TOPICS entries. The `server.mjs` fix from Task 3 unblocks them.

**Rollback risk:** Low — if the Task 3 guard still fails for some topic (e.g., a type rosbridge can't CBOR-encode cleanly), Task 4 regression matrix will surface it and the plan's documented rollback path (`git restore` + narrow to `/scan` only) applies.
