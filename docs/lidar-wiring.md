# LD19 LiDAR Wiring — HAT v2.0 Pigtail (Phase 1)

The LD19 is wired directly to the Pi 4's 40-pin header via a short pigtail,
bypassing the HAT v2.0 PCB entirely. No HAT rework. A dedicated LD19
connector is tracked as a v2 hardware deliverable (HAT v2.1 respin).

## Boot config (Pi 4 `/boot/firmware/config.txt`)

Single added line on top of the existing `disable-bt` baseline:

```diff
 [all]
 ...
 enable_uart=1
 dtoverlay=disable-bt
+dtoverlay=uart3
 ...
```

`enable_uart=1` was already present on this Pi; it is required for `ttyAMA0`
(ESP32) but does NOT affect secondary PL011 UARTs. `dtoverlay=uart3` is the
only line this phase adds.

After reboot, `dtoverlay=uart3` enumerates as (captured 2026-04-14 on
Ubuntu 22.04 LTS, kernel `5.15.0-1098-raspi`, with `disable-bt` active):

```
crw-rw---- 1 root dialout 204, 64 /dev/ttyAMA0   # ESP32 HAT link (unchanged)
crw-rw---- 1 root dialout 204, 65 /dev/ttyAMA1   # LD19 — this is uart3
lrwxrwxrwx /dev/serial0 -> ttyAMA0
lrwxrwxrwx /dev/serial1 -> ttyS0                 # miniUART (unused)
```

Note: research originally predicted `/dev/ttyAMA3` for uart3 based on the
Bookworm 6.1.28+ `serial3` device-tree alias, but this kernel enumerates it
as `/dev/ttyAMA1`. The udev rule below binds by device-tree path, NOT by
number, so this drift is harmless.

## Pigtail pin table (verified against LD19 Development Manual V2.3 §2 + datasheet §5.3)

LD19 connector: ZH1.5T-4P. Pin numbering 1→4 = Tx, PWM, GND, P5V.

| LD19 JST pin | LD19 signal    | Pi 40-pin physical pin | Pi function              |
|--------------|----------------|------------------------|--------------------------|
| 1            | Tx (3.3V)      | **29**                 | GPIO5 / uart3_rx         |
| 2            | **PWM**        | **30**                 | **GND — grounded per datasheet** |
| 3            | GND            | **9**                  | GND                      |
| 4            | P5V            | **2**                  | +5V (shared MINI560)     |
| —            | (Pi TX unused) | 7 (floating)           | GPIO4 / uart3_tx unused  |

**CRITICAL:** LD19 pin 2 (PWM) is tied to GND. The LD19 Development Manual V2.3
§2 states: *"When not using external speed control, the PWM pin must be
grounded."* A floating PWM pin leaves the motor stopped and no data is emitted.

LD19 Tx is 3.3V logic — directly compatible with the Pi's 3.3V PL011 input.
No level shifter is used. LD19 is one-way (sensor → host); Pi GPIO4
(uart3_tx, physical pin 7) is left unconnected.

## udev symlink

Rule in `udev/99-mower.rules`:

```udev
SUBSYSTEM=="tty", KERNELS=="fe201600.serial", SYMLINK+="ttyLIDAR", GROUP="dialout", MODE="0660"
```

`fe201600.serial` is the BCM2711 device-tree path for UART3 (reboot-stable,
invariant across kernel enumeration shifts). Confirmed on this hardware via
`udevadm info -a -n /dev/ttyAMA1` showing `KERNELS=="fe201600.serial"` in the
parent chain. See `.planning/phases/01-hardware-uart-routing/01-RESEARCH.md`
Finding 3.

Reload procedure:

```bash
sudo cp udev/99-mower.rules /etc/udev/rules.d/99-mower.rules
sudo udevadm control --reload-rules
sudo udevadm trigger --subsystem-match=tty
ls -l /dev/ttyLIDAR
```

## Verification (HW-01, HW-02, HW-03)

Byte-level, no driver. **Important:** `cat` on its own does NOT set the baud
rate; `stty` must be called first, otherwise the stream is read at the
termios default (9600) and appears as random bytes.

```bash
sudo stty -F /dev/ttyLIDAR 230400 raw -echo -echoe -echok -echoctl -echoke
sudo timeout 2 cat /dev/ttyLIDAR | xxd | head -5
```

Expected: the byte pair `54 2c` (= `0x54` packet header + `0x2C` VerLen)
appears within the first ~50 bytes and repeats every ~46 bytes thereafter
(full packet = 47 bytes, per LD19 Development Manual V2.3 §3).

Alternative interactive tool:

```bash
sudo picocom -b 230400 -d 8 -p n -f n /dev/ttyLIDAR
```

Three consecutive reboots on 2026-04-14: `/dev/ttyLIDAR` resolves to
`ttyAMA1` each time, and the `54 2c` header appears in the byte dump on each
reboot. ROADMAP §"Phase 1" success criterion #2 satisfied.

## 5V rail

Shared MINI560 rail (HAT v2.0 existing regulator) — **measurement deferred**
until motors are electrically connected. Combined LD19 + motor-transient
headroom cannot be validated on this bench without motor load. See
`docs/5v-rail-measurement-ld19.md` and
`.planning/todos/pending/5v-rail-transient-measurement.md`.

LD19 steady current draw per datasheet: 290 mA @ 5V (see
`docs/datasheets/lidar/README.md`). Steady operation with LD19 alone is
within MINI560 headroom by a wide margin; only transient behavior under
motor startup is the open question.

## Deferred to v2

- HAT v2.1 PCB respin with dedicated LD19 JST connector footprint.
- Physical weather shroud / IP-rated enclosure (LD19 is IP5X only —
  see `docs/operating-envelope.md`).
