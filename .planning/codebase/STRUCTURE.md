# Codebase Structure

**Analysis Date:** 2026-04-14

## Directory Layout

```
MowerBot/
├── README.md                           # High-level overview (quickstart, architecture diagram)
├── specifications.md                   # Docker service specs and full architecture (German)
├── setup.sh                            # Initial setup script (install Docker, udev rules, I2C)
├── LICENSE                             # MIT license
│
├── .env.example                        # Template for .env (device paths, baud rates, ROS_DOMAIN_ID)
├── docker-compose.yml                  # Production: pre-built images from ghcr.io
├── docker-compose.build.yml            # Development: build overrides for local Dockerfile changes
│
├── hardware/                           # KiCad PCB project for Raspberry Pi HAT motor controller
│   ├── MowerBot-MotorController.kicad_sch    # Schematic (ESP32-C3, BTS7960, encoder, LED connections)
│   ├── MowerBot-MotorController.kicad_pcb    # PCB layout (65x100mm Raspberry Pi HAT form factor)
│   ├── MowerBot-MotorController.kicad_pro    # KiCad project file
│   ├── MowerBot-MotorController-schematic.pdf # PDF schematic for reference
│   ├── MowerBot.kicad_sym              # Custom symbol library (BTS7960, UM980, etc.)
│   ├── MowerBot.pretty/                # Custom footprint library
│   ├── production/                     # Generated production files (Gerber, NC drill, etc.)
│   ├── backups/                        # Version history backups
│   ├── *.step files                    # 3D STEP models for component visualization
│   └── fabrication-toolkit-options.json # PCB fab settings
│
├── firmware/                           # ESP32-C3 motor controller firmware (PlatformIO)
│   ├── src/
│   │   └── main.cpp                    # Firmware entry point (~400 lines)
│   ├── include/                        # Custom header files (if any)
│   ├── lib/                            # Local libraries
│   ├── test/                           # Unit tests (if any)
│   ├── platformio.ini                  # PlatformIO config (esp32-c3-devkitm-1 board, micro_ros_platformio lib)
│   ├── flash_esp32.sh                  # Flash script (stops Docker, uploads firmware, restarts)
│   ├── .gitignore                      # Build artifacts ignored
│   └── .pio/                           # PlatformIO build cache (ignored)
│
├── web/                                # Next.js 16 control dashboard (TypeScript)
│   ├── app/                            # App Router pages and API routes
│   │   ├── layout.tsx                  # Root layout (initializes ROS connection)
│   │   ├── page.tsx                    # Dashboard page (status cards + mini map)
│   │   ├── map/
│   │   │   └── page.tsx                # Full map page
│   │   ├── missions/
│   │   │   └── page.tsx                # Mission planning and history
│   │   ├── teleop/
│   │   │   └── page.tsx                # Remote joystick control
│   │   ├── settings/
│   │   │   └── page.tsx                # Robot/system configuration
│   │   └── api/                        # Optional backend routes (empty for now)
│   │
│   ├── components/                     # Reusable React components
│   │   ├── ui/                         # Base UI components (button, card, dialog, slider, etc. from shadcn)
│   │   ├── dashboard/                  # Dashboard-specific (GPS status, battery gauge, IMU display, etc.)
│   │   ├── map/                        # Leaflet-based map components (robot-map, mini-map)
│   │   ├── missions/                   # Mission planning UI (mission-list, mission-card, zone-editor)
│   │   ├── teleop/                     # Joystick and motor control UI
│   │   └── ...                         # Other domain components
│   │
│   ├── lib/                            # Business logic and utilities
│   │   ├── ros/                        # ROS2 integration
│   │   │   ├── ros-client.ts           # WebSocket connection manager, reconnection logic
│   │   │   ├── subscribers.ts          # ROS topic subscriptions registry
│   │   │   ├── publishers.ts           # ROS topic publishers (cmd_vel, etc.)
│   │   │   └── topics.ts               # Topic name constants and type mappings
│   │   │
│   │   ├── store/                      # Zustand state management
│   │   │   ├── ros-store.ts            # Connection state, initialization
│   │   │   ├── gps-store.ts            # NavSatFix topic cache
│   │   │   ├── imu-store.ts            # IMU sensor data cache
│   │   │   ├── battery-store.ts        # Battery level cache
│   │   │   ├── odometry-store.ts       # Odometry (position/velocity) cache
│   │   │   ├── mission-store.ts        # Mission list and progress tracking
│   │   │   ├── teleop-store.ts         # Joystick command state
│   │   │   └── zone-store.ts           # Mowing zone definitions
│   │   │
│   │   ├── types/                      # TypeScript interfaces and types
│   │   │   ├── ros-messages.ts         # ROS message type definitions (NavSatFix, Imu, etc.)
│   │   │   ├── mission.ts              # Mission and waypoint types
│   │   │   ├── garden.ts               # Garden/zone boundary types
│   │   │   └── zones.ts                # Zone exclusion and work area types
│   │   │
│   │   ├── utils/                      # Utility functions
│   │   │   ├── coordinates.ts          # Lat/lon ↔ local frame transformations
│   │   │   ├── formatting.ts           # Number formatting, unit conversions
│   │   │   ├── quaternion.ts           # Quaternion math for IMU orientation
│   │   │   └── ...
│   │   │
│   │   ├── hooks/                      # React hooks
│   │   │   └── use-map-center.ts       # Hook for map centering logic
│   │   │
│   │   ├── mow-planner.ts              # Mission planning algorithm
│   │   ├── utils.ts                    # General utilities (cn, etc.)
│   │   └── ...
│   │
│   ├── public/                         # Static assets (icons, fonts)
│   ├── data/                           # Static data files (if any)
│   ├── types/                          # Global type definitions
│   │   └── nipplejs.d.ts               # Type definitions for nipplejs joystick library
│   │
│   ├── server.mjs                      # Custom Node.js server (WebSocket proxy, NaN sanitization)
│   ├── package.json                    # Dependencies (Next.js, React, roslib, zustand, leaflet, recharts, etc.)
│   ├── package-lock.json               # Dependency lock file
│   ├── tsconfig.json                   # TypeScript config
│   ├── next.config.mjs                 # Next.js config
│   ├── tailwind.config.ts              # Tailwind CSS config
│   ├── postcss.config.mjs              # PostCSS config
│   ├── eslint.config.mjs               # ESLint config
│   ├── .env.example                    # Template for .env.local (NEXT_PUBLIC_ROSBRIDGE_URL, ROSBRIDGE_URL)
│   ├── .next/                          # Next.js build cache (ignored)
│   ├── node_modules/                   # Dependencies (ignored)
│   └── .dockerignore                   # Files excluded from Docker build context
│
├── docker/                             # Dockerfiles for all ROS2 services
│   ├── ros2-base/
│   │   └── Dockerfile                  # ROS2 Humble base image (arm64)
│   ├── micro-ros-agent/
│   │   └── Dockerfile                  # micro-ROS agent (serial bridge to ESP32)
│   ├── gnss/
│   │   └── Dockerfile                  # NMEA NavSat driver (UM980)
│   ├── imu/
│   │   └── Dockerfile                  # MPU6050 IMU driver
│   ├── ntrip/
│   │   ├── Dockerfile                  # str2str RTK correction client
│   │   └── entrypoint.sh               # Script to read ntrip.env and start str2str
│   ├── nav/
│   │   └── Dockerfile                  # Nav2 + EKF sensor fusion
│   ├── rosbridge/
│   │   └── Dockerfile                  # rosbridge WebSocket server
│   └── web/
│       └── Dockerfile                  # Next.js web app (Node.js multi-stage build)
│
├── config/                             # ROS2 and service configuration files
│   ├── mower_nav_launch.py             # ROS2 launch file (starts EKF + NavSat Transform nodes)
│   ├── ekf.yaml                        # EKF sensor fusion parameters (IMU/GNSS covariances)
│   ├── nav2_params.yaml                # Nav2 behavior tree and planner parameters
│   ├── robot.yaml                      # Robot physical parameters (wheel separation, diameter, max speed)
│   ├── nmea.yaml                       # NMEA driver config (port, baud, frame_id)
│   ├── cyclonedds.xml                  # CycloneDDS middleware config (DDS discovery, QoS)
│   └── ntrip.env                       # NTRIP base station credentials (secrets, not committed)
│
├── scripts/                            # Utility scripts
│   └── (various build/test scripts, if any)
│
├── udev/                               # Linux device symlink rules
│   └── 99-mower.rules                  # udev rules to create persistent /dev/ttyGNSS and /dev/ttyLIDAR symlinks
│
├── docs/                               # Documentation
│   ├── README.md                       # High-level project overview
│   ├── pcb-motor-controller.md         # PCB design details (schematic explanation, component placement)
│   ├── hardware.md                     # Hardware requirements and assembly guide
│   ├── setup-guide.md                  # Detailed setup instructions
│   ├── troubleshooting.md              # Common issues and fixes
│   └── images/                         # Diagrams, photos
│
└── .planning/                          # GSD planning documents (created by /gsd-map-codebase)
    └── codebase/
        └── (ARCHITECTURE.md, STRUCTURE.md, etc.)
```

## Directory Purposes

**`hardware/`:**
- Purpose: KiCad PCB project for Raspberry Pi HAT motor controller (ESP32-C3 + BTS7960 + encoders + LED)
- Contains: Schematics, PCB layout, symbol/footprint libraries, 3D models, production files
- Key files: `MowerBot-MotorController.kicad_sch` (schematic), `MowerBot-MotorController.kicad_pcb` (layout)
- Generated: Production folder contains Gerber files, drill files, BOM for manufacturing
- Committed: Yes (all .kicad_* files tracked in git)

**`firmware/`:**
- Purpose: Embedded firmware for ESP32-C3 motor controller (real-time motor control, encoder feedback, micro-ROS)
- Contains: Arduino C++ code, PlatformIO configuration, flash scripts
- Key files: `src/main.cpp` (~400 lines), `platformio.ini`, `flash_esp32.sh`
- Generated: `.pio/` build directory, `.pio/build/` artifacts (ignored)
- Committed: Source code tracked, build artifacts ignored

**`web/`:**
- Purpose: Next.js 16 React dashboard for monitoring and controlling the mower (browser app)
- Contains: React components, ROS client library, Zustand state stores, utilities, Next.js pages
- Key directories: `app/` (pages), `components/` (React components), `lib/` (business logic), `server.mjs` (Node.js proxy)
- Generated: `.next/` build output, `node_modules/` (ignored)
- Committed: Source code tracked, build artifacts and dependencies ignored

**`docker/`:**
- Purpose: Dockerfiles for all ROS2 services (non-web services)
- Contains: One subdirectory per service (micro-ros-agent, gnss, imu, nav, ntrip, rosbridge, ros2-base)
- Key pattern: Each service inherits from `ros2-base/Dockerfile`, installs service-specific ROS packages, sets up entrypoint
- Committed: Yes, all Dockerfiles tracked

**`config/`:**
- Purpose: Configuration files for ROS2 services and the mower system
- Contains: YAML files (EKF, Nav2, robot parameters), Python launch files, DDS config, NTRIP credentials
- Key files: `mower_nav_launch.py` (ROS2 launch), `ekf.yaml` (sensor fusion), `robot.yaml` (mower dimensions)
- Note: `ntrip.env` contains secrets (NTRIP credentials); not committed to git
- Committed: Yes (except `ntrip.env`), mounted read-only in Docker containers

**`udev/`:**
- Purpose: Linux device symlink rules to create persistent device names
- Contains: `99-mower.rules` mapping USB device IDs to `/dev/ttyGNSS` (CH341 USB-UART) and `/dev/ttyLIDAR` (Pi UART3 kernel node); ESP32 uses Pi GPIO14/15 UART as `/dev/ttyAMA0` directly, no symlink needed
- Purpose: Without these rules, device paths change on reboot (e.g., `/dev/ttyUSB0` ↔ `/dev/ttyUSB1`), breaking Docker device mappings
- Committed: Yes
- Installation: `setup.sh` copies to `/etc/udev/rules.d/`

**`docs/`:**
- Purpose: User-facing and developer documentation
- Contains: Setup guide, hardware overview, PCB design details, troubleshooting, images/diagrams
- Key files: `pcb-motor-controller.md` (schematic explanation), `setup-guide.md` (first-time setup)
- Committed: Yes

**`.planning/`:**
- Purpose: GSD (Guidance, Structure, Decisions) analysis documents (generated by `/gsd-map-codebase`)
- Contains: ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md, CONCERNS.md (as needed)
- Committed: Yes (documentation for future phases)

## Key File Locations

**Entry Points:**
- `firmware/src/main.cpp`: ESP32 firmware entry; calls `setup()` and `loop()`
- `web/app/layout.tsx`: Next.js root layout; initializes ROS connection via `useRosStore.init()`
- `web/server.mjs`: Node.js server entry; listens on `:3000`, proxies `/rosbridge`
- `config/mower_nav_launch.py`: ROS2 launch file; starts EKF and NavSat Transform nodes
- `docker-compose.yml`: Docker Compose entry; defines all services and their interdependencies

**Configuration:**
- `.env` or `.env.local`: Host-specific settings (device paths, domain ID, API endpoints)
- `.env.example`: Template for `.env`
- `config/robot.yaml`: Robot physical parameters (wheel diameter, separation, max speed)
- `config/ekf.yaml`: EKF covariance matrices and sensor fusion weights
- `config/cyclonedds.xml`: CycloneDDS middleware settings

**Core Logic:**
- `firmware/src/main.cpp`: Motor control (PWM, encoder ISRs), micro-ROS subscription to `/cmd_vel`
- `web/lib/ros/ros-client.ts`: ROS2 WebSocket client, reconnection logic
- `web/lib/store/ros-store.ts`: Central connection state and subscription management
- `web/app/page.tsx`: Main dashboard; uses all sensor stores and displays status
- `web/server.mjs`: WebSocket proxy between browser and rosbridge; NaN sanitization

**Testing:**
- `firmware/test/`: Unit tests for firmware (if any)
- No test files found for web app currently

## Naming Conventions

**Files:**
- `*.cpp`, `*.h`: Firmware (Arduino/PlatformIO)
- `*.tsx`, `*.ts`: Web app (TypeScript React)
- `*.py`: ROS2 launch and utility scripts
- `*.yaml`: ROS2 configuration (parameters)
- `*.yml`: Docker Compose services
- `Dockerfile`: Container build definitions
- `*.kicad_sch`, `*.kicad_pcb`, `*.kicad_pro`: KiCad PCB project files

**Directories:**
- `src/`: Source code
- `lib/`: Libraries or business logic
- `components/`: React components
- `config/`: Configuration files
- `docker/`: Container definitions
- `firmware/`: Embedded code
- `web/`: Web application
- `hardware/`: PCB design
- `docs/`: Documentation
- `__pycache__/`, `.pio/`, `.next/`, `node_modules/`: Generated/build artifacts (ignored)

**React Components:**
- Kebab-case file names: `gps-status.tsx`, `mission-list.tsx`
- Export as named function matching file name: `export function GpsStatus()`
- Stored in directory matching domain: `components/dashboard/`, `components/map/`, `components/missions/`

**TypeScript Types:**
- Interfaces in `lib/types/` directory: `ros-messages.ts`, `mission.ts`, `garden.ts`
- Export type names starting with capital letter: `export interface NavSatFix`, `export type Mission`

**Zustand Stores:**
- File names: `{domain}-store.ts` (e.g., `gps-store.ts`, `mission-store.ts`)
- Export hook: `export const use{Domain}Store = create<{Domain}State>()`
- State interface: `interface {Domain}State { ... }`

**ROS Topics:**
- Named in `lib/ros/topics.ts` as constants: `const FIX_TOPIC = "/fix"`, `const CMD_VEL_TOPIC = "/cmd_vel"`
- Subscribers in `lib/ros/subscribers.ts`: `subscribe<NavSatFix>("FIX", callback)`
- Publishers in `lib/ros/publishers.ts`: `publish("CMD_VEL", twist)`

## Where to Add New Code

**New Feature (e.g., battery-powered halt):**
- Primary code: `firmware/src/main.cpp` (add battery ADC read, logic in `loop()`)
- ROS interface: `config/mower_nav_launch.py` (if needs new node)
- Web UI: `web/app/page.tsx` or new page in `web/app/` (add status badge)
- State: `web/lib/store/battery-store.ts` (new store if needed)
- Tests: `firmware/test/test_battery.cpp` (if testing)

**New Web Page:**
- File: `web/app/new-feature/page.tsx`
- Layout: Follow existing page structure (use layout from parent, wrap in container)
- Components: Create reusable components in `web/components/new-feature/`
- State: Use existing Zustand stores or create new one in `web/lib/store/`
- Styling: Use Tailwind classes + `cn()` utility from `web/lib/utils.ts`

**New ROS Topic Subscription:**
- Register topic: `web/lib/ros/topics.ts` (add constant)
- Subscribe: `web/lib/ros/subscribers.ts` (add `subscribe<Type>()` call)
- Store: Create `web/lib/store/{domain}-store.ts` (Zustand hook with `updateXxx()` method)
- Connect: Call `subscribe()` in `web/lib/store/ros-store.ts` `setupSubscriptions()` function
- Use: Import store hook in component, call `useXxxStore().xxx` to bind to state

**New Component:**
- Location: `web/components/{domain}/{name}.tsx`
- Pattern: `export function ComponentName() { return <div>...</div> }`
- Imports: Use path aliases (`@/components`, `@/lib`)
- Styling: Tailwind + shadcn UI components
- Example: `web/components/dashboard/gps-status.tsx`

**Firmware Hardware Support (new sensor/motor):**
- GPIO/Pin definitions: Top of `firmware/src/main.cpp` (lines 23-52)
- Initialization: `setup()` function
- ISR (if needed): New interrupt handler
- Loop logic: `loop()` or callback function
- Configuration: `config/robot.yaml` (if ROS parameter)

**New Docker Service:**
- Dockerfile: `docker/new-service/Dockerfile`
- Compose config: Add section to `docker-compose.yml`
- Configuration: Create YAML in `config/` if service needs parameters
- Entrypoint: Set in Dockerfile or docker-compose.yml

## Special Directories

**`hardware/production/`:**
- Purpose: Generated manufacturing files (Gerber, drill, BOM, PDF)
- Generated: Yes (via KiCad export)
- Committed: Yes (for version control and documentation)
- Manual steps: Right-click → Fabrication Outputs in KiCad

**`firmware/.pio/`:**
- Purpose: PlatformIO build cache and dependencies
- Generated: Yes (during `pio run`)
- Committed: No (in `.gitignore`)
- Cleanup: `pio run --target clean` or delete folder

**`web/.next/`:**
- Purpose: Next.js build output and cache
- Generated: Yes (during `npm run build`)
- Committed: No (in `.gitignore`)
- Cleanup: `rm -rf .next/` before full rebuild

**`web/node_modules/`:**
- Purpose: npm package dependencies
- Generated: Yes (during `npm install`)
- Committed: No (in `.gitignore`); use `package-lock.json` for reproducibility
- Install: `npm ci` (for CI) or `npm install` (for development)

**`config/ntrip.env`:**
- Purpose: RTK base station credentials
- Generated: Manual (copy from `.env.example` template)
- Committed: No (contains secrets; added to `.gitignore`)
- Contents: NTRIP host, port, username, password, mount point
- Usage: Mounted in ntrip container as `env_file`

---

*Structure analysis: 2026-04-14*
