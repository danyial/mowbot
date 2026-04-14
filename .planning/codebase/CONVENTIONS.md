# Coding Conventions

**Analysis Date:** 2026-04-14

## Naming Patterns

**Files:**
- C++ firmware: `main.cpp` (single entry point)
- TypeScript/React components: PascalCase (e.g., `GpsStatus.tsx`, `VirtualJoystick.tsx`)
- TypeScript utilities/stores: camelCase (e.g., `gps-store.ts`, `ros-client.ts`)
- API routes: kebab-case in path structure (e.g., `/api/missions/route.ts`, `/api/config/route.ts`)
- Constants/enums: UPPER_CASE (e.g., `CMD_TIMEOUT_MS`, `WHEEL_SEPARATION`)

**Functions:**
- Firmware (C++): snake_case (e.g., `stop_motors()`, `set_motor_left()`, `encoder_left_isr()`)
- TypeScript: camelCase for functions and methods (e.g., `quickDistance()`, `extractDockPath()`, `updateFix()`)
- React components: PascalCase for component exports (e.g., `export function GpsStatus()`)

**Variables:**
- Global firmware variables: descriptive camelCase (e.g., `encoder_left_count`, `last_cmd_time`)
- TypeScript/React: camelCase (e.g., `fixStatus`, `dockExitDistance`, `newBoundaryPoints`)
- Boolean flags: semantic prefixes `is*` or `has*` (e.g., `isRecording`, `isStale`, `isRecordingBoundary`)

**Types:**
- TypeScript interfaces: PascalCase (e.g., `GpsState`, `Mission`, `ZoneCollection`)
- Type aliases for unions: PascalCase (e.g., `FixStatus`, `MapLayerType`)
- Zustand store hooks: `use{Name}Store` pattern (e.g., `useGpsStore`, `useBatteryStore`, `useRosStore`)

## Code Style

**Formatting:**
- TypeScript: Next.js default formatter (Prettier-compatible)
- Firmware: Arduino style with ISO-C++ conventions
- Line endings: CRLF not enforced (Unix-style LF acceptable)

**Linting:**
- TypeScript/React: ESLint with Next.js core-web-vitals config
- Config: `web/eslint.config.mjs`
- Rules: `@typescript-eslint/no-explicit-any` set to warn (not error)
- No explicit linting for C++ firmware (PlatformIO-based, Arduino framework)

**Comments and Documentation:**
- Firmware: German comments for hardware-specific logic (`// Motor Links`, `// Encoder Pins`)
- Firmware: Decorative dividers using `// ═══...` for section separation
- TypeScript: JSDoc blocks for exported functions (e.g., `/** Extract dock path from zones... */`)
- TypeScript: Inline comments sparingly, prefer self-documenting code

## Import Organization

**Order:**
1. Built-in modules (e.g., `import path from "path"`)
2. External packages (e.g., `import { create } from "zustand"`)
3. Type imports (e.g., `import type { Mission } from "@/lib/types/mission"`)
4. Internal absolute imports with `@/` prefix (e.g., `import { useGpsStore } from "@/lib/store/gps-store"`)
5. Internal relative imports (rare; use `@/` instead)

**Path Aliases:**
- `@/` → base of web application (resolves to `web/`)
- Used throughout all TypeScript/React code for clarity and refactoring safety

**Firmware:**
- Standard Arduino includes (e.g., `#include <Arduino.h>`, `#include <micro_ros_platformio.h>`)
- Preprocessor directives for version-conditional compilation (`#if ESP_ARDUINO_VERSION_MAJOR >= 3`)

## Error Handling

**Patterns:**
- TypeScript API routes: Try-catch wrapping with console.error logging (e.g., in `/app/api/missions/route.ts` line 179)
- Silent fallback approach: Empty objects/arrays returned on error (e.g., `return []` in `readMissions()`)
- HTTP response pattern: Return `NextResponse.json({ error: "..." }, { status: 4xx })` for errors
- No explicit error types or custom error classes in current codebase; relying on try-catch with generic catch blocks

**Firmware:**
- Boolean return codes for initialization (e.g., `create_microros_entities()` returns `true`/`false`)
- No exception throwing; rely on return values and state machine transitions
- Watchdog approach: `last_cmd_time` tracking with command timeout (`CMD_TIMEOUT_MS = 500`)

## Logging

**Framework:** Console-based (console.error, console.log in TypeScript)

**Patterns:**
- TypeScript: `console.error("[route_name] ACTION error:", err)` with context prefix
- Example: `console.error("[missions] POST error:", err)` in `/app/api/missions/route.ts`
- Firmware: No explicit logging library; use LED state machine for status indication (see LED COLORS defines in `main.cpp`)

## Module Design

**Exports:**
- React components: Named export of component function (e.g., `export function GpsStatus()`)
- Utilities: Named exports for specific functions (e.g., `export function quickDistance()`)
- Type definitions: Centralized in `lib/types/` directory with explicit exports

**Zustand Stores:**
- Pattern: `create<StateInterface>((set, get) => ({ ...state, ...actions }))`
- Single store per domain (GPS, Battery, ROS connection)
- Actions modify state via `set()` and read state via `get()`
- Example: `web/lib/store/gps-store.ts` (149 lines)

**Firmware Structure:**
- Single monolithic `main.cpp` entry point
- Helper functions grouped by responsibility: LED control, encoder ISRs, motor control, micro-ROS management
- Preprocessor conditionals for version compatibility

## Data and Type Safety

**TypeScript:**
- Strict type annotations on function parameters and return types
- Optional chaining and nullish coalescing used for null safety (e.g., `accuracy ?? -1`)
- Record types for lookup objects (e.g., `const fixBadgeVariant: Record<string, "success" | "warning" | ...>`)

**Firmware:**
- Strong typing: `float`, `int`, `volatile` modifiers for ISR-accessed variables
- Constrain values to safe ranges: `speed = constrain(speed, -1.0f, 1.0f)`

## Constants and Configuration

**Firmware (main.cpp):**
- All GPIO pins defined as `#define` constants at top of file (lines 26-52)
- PWM parameters as `#define`: `PWM_FREQ`, `PWM_RESOLUTION`
- Robot parameters grouped: `WHEEL_SEPARATION`, `WHEEL_DIAMETER`, `MAX_SPEED`, `ENCODER_TICKS_REV`
- Timeouts and control limits: `CMD_TIMEOUT_MS`, LED colors as hex values

**TypeScript:**
- Inline constants with descriptive names (e.g., `BOUNDARY_MIN_DISTANCE_M` in gps-store.ts)
- Configuration loaded from JSON files (`data/config.json`, `data/zones.json`, `data/missions.json`)

## KiCad Schematic/PCB Conventions

**Net Naming:**
- Power nets: `+12V`, `+5V`, `GND` (uppercase, clear polarity)
- Signal nets: UPPERCASE with descriptive labels (e.g., `ML_R_IS` = Motor Left Right current sense, `MR_L_IS` = Motor Right Left current sense)
- UART signals: Standard names (e.g., `TXD`, `RXD`, but implemented as GPIO20/21 pins)
- Control signals: Function-based names (e.g., `RPWM` = reverse PWM, `LPWM` = forward PWM, `EN` = enable)

**Schematic Organization:**
- Power distribution section at top
- Control signal connections grouped by function
- Comments in German where hardware-specific (Uebersicht, Blockdiagramm, Stromversorgung)
- ERC warnings for isolated pins (current sense pins) are expected and documented

**PCB Layer Usage:**
- 2-layer board (F.Cu + B.Cu)
- B.Cu dedicated as GND plane (ground pour on bottom layer)
- Traces on F.Cu (top layer) for signal routing and 12V distribution
- Wide traces (>=3mm) for 12V rail to handle current from motors and converter

**Courtyard and Clearance:**
- Some courtyard overlaps documented (2 errors in `MowerBot-MotorController_drc_violations.json`)
- HAT format with 6x M2.5 mounting holes (4 Pi-standard + 2 chassis support)
- Board size: 65mm x 100mm (extended Raspberry Pi HAT)

**Component Footprints:**
- All components assigned footprints in schematic
- Standard connectors: XT60, Schraubklemme (screw terminal), Header pins
- Surface mount preferred where possible for compact layout

---

*Convention analysis: 2026-04-14*
