# Foxglove Integration — MowerBot

Foxglove Studio is a desktop/web visualizer for ROS2 data. MowerBot ships a
layout file so `/scan`, `/odometry/filtered`, and `/fix` work out-of-the-box
against the existing rosbridge endpoint — no extra containers needed.

## One-time setup

1. Install Foxglove Studio from <https://foxglove.dev/download>. (v2.x or
   later; ROS Humble support has been stable since 2023.)
2. Bring up the MowerBot stack as usual:
   ```sh
   docker compose up -d
   ```
   The `rosbridge` service exposes `ws://<host>:9090`. On the default LAN this
   is `ws://mower.local:9090` or the Pi's IP (e.g. `ws://10.10.40.23:9090`).

## Load the committed layout

1. Open Foxglove Studio.
2. `File → Import layout from file…`
3. Select `web/foxglove/mowerbot.foxglove-layout.json` from this repo.
4. You'll see three panels: a 3D panel for `/scan`, a Raw Messages panel for
   `/fix`, and a Plot panel for `/odometry/filtered` linear/angular velocity.

## Connect to rosbridge

**Important:** MowerBot uses `rosbridge_server`, not Foxglove's native
protocol. Pick the correct connector.

1. Click `Open connection…` (top-left).
2. Select the **"Rosbridge (ROS 1 & 2)"** tab — NOT "Foxglove WebSocket".
3. Enter `ws://mower.local:9090` (or the Pi's IP-port, e.g.
   `ws://10.10.40.23:9090`).
4. Click `Open`.

Within a second or two you should see:

- The 3D panel populates with a scan sweep around the `base_link` origin.
- The Raw Messages panel shows live NavSatFix fields (`latitude`, `longitude`,
  `status`).
- The Plot panel starts filling with velocity traces.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| 3D panel empty, other panels work | TF tree missing `base_link → laser_frame` | Verify `nav` container is up (publishes the static TF); `ros2 run tf2_ros tf2_echo base_link laser_frame` |
| All panels empty | Wrong connector tab | Re-open connection using **Rosbridge (ROS 1 & 2)** — not Foxglove WebSocket |
| Connection refused | Rosbridge not reachable | `docker ps \| grep rosbridge`; confirm `ws://<host>:9090` is reachable from the Foxglove host |
| Scan points look sparse | CBOR `throttle_rate: 100` → 10 Hz | Expected — matches the driver's publish rate; no action needed |

## Relationship to the web overlay

The web dashboard's `/map` page has its own Canvas 2D scan overlay
(per VIZ-01) — Foxglove is a complementary tool for deep inspection, not a
replacement. Both consume the same `/scan` topic via rosbridge.
