# MowerBot Motor Controller PCB — Raspberry Pi HAT v2.0

## Uebersicht

Ein Raspberry Pi HAT (Hardware Attached on Top) das direkt auf den Raspberry Pi 4
gesteckt wird. Es verbindet einen ESP32-C3-DevKitM-1 Mikrocontroller mit zwei
BTS7960 H-Bruecken-Modulen und zwei JGB37-520 Encoder-Motoren.

Eine einzige 12V Stromquelle (Akku mit XT60-Stecker) versorgt ueber ein MINI560
Step-Down Modul (5V/5A) sowohl den Pi als auch den ESP32. Die Kommunikation
zwischen ESP32 und Pi erfolgt ueber UART (keine USB-Kabel noetig).

Der 40-Pin Pi GPIO Header wird als Stacking Header (Pass-Through) ausgefuehrt,
sodass alle nicht genutzten Pi-Pins fuer zukuenftige Erweiterungen zugaenglich
bleiben (z.B. I2C-Sensoren, SPI-Geraete, weitere HATs).

## Blockdiagramm

```
12V Akku --[XT60]--> [J7] --> [MINI560] --> 5V Rail
                         |                      |
                         |                 +---------+
                         |                 |         |
                         |            [Pi 5V]   [ESP32 5V]
                         |
                         +--> BTS7960 #1 B+ (ueber J_PWR_L)
                         +--> BTS7960 #2 B+ (ueber J_PWR_R)

Pi GPIO14/15 (UART) <--PCB Traces--> ESP32-C3 GPIO20/21 (UART)

ESP32-C3 GPIO0-5 --> BTS7960 #1 + #2 (PWM + Enable)
ESP32-C3 GPIO6,7,9,10 <-- Encoder #1 + #2
```

## Board-Spezifikation

| Eigenschaft | Wert |
|-------------|------|
| Format | Raspberry Pi HAT (verlaengert) |
| Masse | 65mm x 100mm |
| Mounting Holes | 6x M2.5 (4 Pi-Standard + 2 Chassis-Stuetze) |
| Lagen | 2 (F.Cu + B.Cu) |
| GND-Plane | B.Cu (Unterseite) |
| Pi-Anbindung | 40-Pin Stacking Header (Pass-Through) |

## Schaltplan

### Stromversorgung

```
12V Akku --[XT60 Stecker]--> [XT60 Buchse + Kabel]
                                      |
                                [J7: 2-Pin Schraubklemme, RM 5.08mm]
                                      | Pin 1: +12V
                                      | Pin 2: GND
                                      |
                                 12V Rail (PCB Traces >= 2mm breit)
                                      |
                                      +--> [C1: 100uF/25V Elko] --> GND
                                      |
                                      +--> [U2: MINI560 Step-Down]
                                      |       Input+  <- 12V Rail
                                      |       Input-  <- GND
                                      |       Output+ -> 5V Rail
                                      |       Output- -> GND
                                      |       EN      -> nicht verbunden (Default: ON)
                                      |           |
                                      |           +--> [C2: 100uF/16V Elko] --> GND
                                      |           +--> [C3: 100nF Keramik] --> GND
                                      |           +--> Pi 5V (J_PI Pin 2 + Pin 4)
                                      |           +--> ESP32-C3 5V (U1 J1.13 + J1.14)
                                      |
                                      +--> [J_PWR_L Pin 1: B+] (-> BTS7960 #1)
                                      |    [J_PWR_L Pin 2: B-] (-> BTS7960 #1 GND)
                                      |
                                      +--> [J_PWR_R Pin 1: B+] (-> BTS7960 #2)
                                           [J_PWR_R Pin 2: B-] (-> BTS7960 #2 GND)
```

Kein Verpolschutz (Diode) noetig — der XT60-Stecker ist mechanisch
verpolungssicher und kann nicht falsch herum eingesteckt werden.

### Raspberry Pi 40-Pin Stacking Header (J_PI)

Nur die genutzten Pins — alle anderen werden durchgefuehrt (Pass-Through)
und sind fuer zukuenftige Erweiterungen verfuegbar.

| Pi Pin | Name | Funktion | Verbindung |
|--------|------|----------|------------|
| 2 | 5V | Stromversorgung | <- 5V Rail (MINI560) |
| 4 | 5V | Stromversorgung | <- 5V Rail (MINI560) |
| 6 | GND | Masse | GND Rail |
| 8 | GPIO14 (TXD) | UART TX | -> ESP32-C3 RX (GPIO20) |
| 9 | GND | Masse | GND Rail |
| 10 | GPIO15 (RXD) | UART RX | <- ESP32-C3 TX (GPIO21) |
| 14 | GND | Masse | GND Rail |
| 20 | GND | Masse | GND Rail |
| 25 | GND | Masse | GND Rail |
| 30 | GND | Masse | GND Rail |
| 34 | GND | Masse | GND Rail |
| 39 | GND | Masse | GND Rail |

Freie Pins (ueber Stacking Header zugaenglich):
- I2C: Pin 3 (SDA), Pin 5 (SCL)
- SPI: Pin 19 (MOSI), Pin 21 (MISO), Pin 23 (SCLK), Pin 24 (CE0), Pin 26 (CE1)
- 16 weitere GPIOs

### ESP32-C3-DevKitM-1 (U1)

Das Board hat zwei Header (J1 und J3), jeweils 15 Pins.

**J1 (linke Seite):**

| Pin | Name | Funktion | Verbindung |
|-----|------|----------|------------|
| 1 | GND | Masse | GND Rail |
| 2 | 3V3 | 3.3V | 3V3 Rail |
| 3 | 3V3 | 3.3V | 3V3 Rail |
| 4 | IO2 | GPIO2 | -> Motor L Enable (J_SIG_L Pin 3+4) + R1 |
| 5 | IO3 | GPIO3 | -> Motor R RPWM (J_SIG_R Pin 1) |
| 6 | GND | Masse | GND Rail |
| 7 | RST | Reset | Nicht verbunden |
| 8 | GND | Masse | GND Rail |
| 9 | IO0 | GPIO0 | -> Motor L RPWM (J_SIG_L Pin 1) |
| 10 | IO1 | GPIO1 | -> Motor L LPWM (J_SIG_L Pin 2) |
| 11 | IO10 | GPIO10 | <- Encoder R A (J_ENC_R Pin 1) |
| 12 | GND | Masse | GND Rail |
| 13 | 5V | 5V | <- 5V Rail |
| 14 | 5V | 5V | <- 5V Rail |
| 15 | GND | Masse | GND Rail |

**J3 (rechte Seite):**

| Pin | Name | Funktion | Verbindung |
|-----|------|----------|------------|
| 1 | GND | Masse | GND Rail |
| 2 | TX | GPIO21 (UART TX) | -> Pi GPIO15 (RXD) via PCB Trace |
| 3 | RX | GPIO20 (UART RX) | <- Pi GPIO14 (TXD) via PCB Trace |
| 4 | GND | Masse | GND Rail |
| 5 | IO9 | GPIO9 | <- Encoder R B (J_ENC_R Pin 2) |
| 6 | IO8 | GPIO8 | RGB LED — nicht verwenden |
| 7 | GND | Masse | GND Rail |
| 8 | IO7 | GPIO7 | <- Encoder L B (J_ENC_L Pin 2) |
| 9 | IO6 | GPIO6 | <- Encoder L A (J_ENC_L Pin 1) |
| 10 | IO5 | GPIO5 | -> Motor R Enable (J_SIG_R Pin 3+4) + R2 |
| 11 | IO4 | GPIO4 | -> Motor R LPWM (J_SIG_R Pin 2) |
| 12 | GND | Masse | GND Rail |
| 13 | IO18 | GPIO18 | USB D- — nicht verwenden |
| 14 | IO19 | GPIO19 | USB D+ — nicht verwenden |
| 15 | GND | Masse | GND Rail |

### BTS7960 Links — Signal (J_SIG_L, 6-Pin Header, RM 2.54mm)

| Pin | Name | Verbindung |
|-----|------|------------|
| 1 | RPWM | <- ESP32-C3 GPIO0 |
| 2 | LPWM | <- ESP32-C3 GPIO1 |
| 3 | R_EN | <- ESP32-C3 GPIO2 + R1 (10k -> GND) |
| 4 | L_EN | <- ESP32-C3 GPIO2 (zusammen mit R_EN) |
| 5 | VCC | <- 3V3 Rail |
| 6 | GND | GND Rail |

### BTS7960 Rechts — Signal (J_SIG_R, 6-Pin Header, RM 2.54mm)

| Pin | Name | Verbindung |
|-----|------|------------|
| 1 | RPWM | <- ESP32-C3 GPIO3 |
| 2 | LPWM | <- ESP32-C3 GPIO4 |
| 3 | R_EN | <- ESP32-C3 GPIO5 + R2 (10k -> GND) |
| 4 | L_EN | <- ESP32-C3 GPIO5 (zusammen mit R_EN) |
| 5 | VCC | <- 3V3 Rail |
| 6 | GND | GND Rail |

### BTS7960 Links — Leistung (J_PWR_L, 2-Pin Schraubklemme, RM 5.08mm)

| Pin | Name | Verbindung |
|-----|------|------------|
| 1 | B+ | <- 12V Rail |
| 2 | B- | GND Rail |

### BTS7960 Rechts — Leistung (J_PWR_R, 2-Pin Schraubklemme, RM 5.08mm)

| Pin | Name | Verbindung |
|-----|------|------------|
| 1 | B+ | <- 12V Rail |
| 2 | B- | GND Rail |

### Encoder Links (J_ENC_L, 4-Pin Header, RM 2.54mm)

| Pin | Name | Verbindung |
|-----|------|------------|
| 1 | A | -> ESP32-C3 GPIO6 |
| 2 | B | -> ESP32-C3 GPIO7 |
| 3 | VCC | <- 3V3 Rail |
| 4 | GND | GND Rail |

### Encoder Rechts (J_ENC_R, 4-Pin Header, RM 2.54mm)

| Pin | Name | Verbindung |
|-----|------|------------|
| 1 | A | -> ESP32-C3 GPIO10 |
| 2 | B | -> ESP32-C3 GPIO9 |
| 3 | VCC | <- 3V3 Rail |
| 4 | GND | GND Rail |

### Pull-down Widerstaende (Sicherheit)

```
ESP32-C3 GPIO2 --+---> J_SIG_L Pin 3 (R_EN)
                  +---> J_SIG_L Pin 4 (L_EN)
                  |
                 [R1: 10kOhm]
                  |
                 GND

ESP32-C3 GPIO5 --+---> J_SIG_R Pin 3 (R_EN)
                  +---> J_SIG_R Pin 4 (L_EN)
                  |
                 [R2: 10kOhm]
                  |
                 GND
```

Beim ESP32-Reset oder Boot sind die GPIOs kurzzeitig undefiniert.
Die Pull-down Widerstaende stellen sicher, dass die BTS7960
Enable-Pins auf LOW (Motor AUS) bleiben.

## GPIO-Zuordnung ESP32-C3

| GPIO | Funktion | Richtung | Anschluss |
|------|----------|----------|-----------|
| 0 | Motor L RPWM | Output (PWM) | J_SIG_L Pin 1 |
| 1 | Motor L LPWM | Output (PWM) | J_SIG_L Pin 2 |
| 2 | Motor L Enable | Output | J_SIG_L Pin 3+4 |
| 3 | Motor R RPWM | Output (PWM) | J_SIG_R Pin 1 |
| 4 | Motor R LPWM | Output (PWM) | J_SIG_R Pin 2 |
| 5 | Motor R Enable | Output | J_SIG_R Pin 3+4 |
| 6 | Encoder L A | Input | J_ENC_L Pin 1 |
| 7 | Encoder L B | Input | J_ENC_L Pin 2 |
| 9 | Encoder R B | Input | J_ENC_R Pin 2 |
| 10 | Encoder R A | Input | J_ENC_R Pin 1 |
| 20 | UART RX (<- Pi TX) | Input | Pi GPIO14 (TXD) |
| 21 | UART TX (-> Pi RX) | Output | Pi GPIO15 (RXD) |

Nicht verwendete GPIOs: GPIO8 (RGB LED), GPIO18/19 (USB)

## Stueckliste (BOM)

### PCB-Komponenten

| Ref | Bauteil | Wert/Typ | Package | Menge |
|-----|---------|----------|---------|-------|
| U1 | ESP32-C3-DevKitM-1 | 30-Pin | 2x 15-Pin Buchsenleiste | 1 |
| U2 | MINI560 | 5V/5A Step-Down | 22x17mm, auf PCB loeten | 1 |
| J_PI | Stacking Header | 2x20, RM 2.54mm, Extra Tall | 40-Pin Pass-Through | 1 |
| J7 | Schraubklemme | 1x2, RM 5.08mm | KF301 | 1 |
| J_SIG_L | Pin Header | 1x6, RM 2.54mm | Vertikal | 1 |
| J_SIG_R | Pin Header | 1x6, RM 2.54mm | Vertikal | 1 |
| J_PWR_L | Schraubklemme | 1x2, RM 5.08mm | KF301 | 1 |
| J_PWR_R | Schraubklemme | 1x2, RM 5.08mm | KF301 | 1 |
| J_ENC_L | Pin Header | 1x4, RM 2.54mm | Vertikal | 1 |
| J_ENC_R | Pin Header | 1x4, RM 2.54mm | Vertikal | 1 |
| C1 | Elko | 100uF/25V | Radial D6.3mm | 1 |
| C2 | Elko | 100uF/16V | Radial D6.3mm | 1 |
| C3 | Keramik | 100nF | 0805 oder THT | 1 |
| R1 | Widerstand | 10kOhm | 0805 oder THT | 1 |
| R2 | Widerstand | 10kOhm | 0805 oder THT | 1 |

### Befestigungsmaterial (nicht auf PCB)

| Teil | Spezifikation | Menge |
|------|---------------|-------|
| XT60 Buchse mit Kabel | An J7 Schraubklemme | 1 |
| M2.5 Schraube | M2.5 x 5mm | 6 |
| M2.5 Abstandshalter | M2.5 x 11mm, Innengewinde | 4 (MH1-MH4) |
| M2.5 Abstandshalter | M2.5 x variabel | 2 (MH5-MH6) |
| M2.5 Mutter | M2.5 | 6 |

## Mounting Holes

| Hole | X (mm) | Y (mm) | Durchmesser | Funktion |
|------|--------|--------|-------------|----------|
| MH1 | 3.5 | 3.5 | 2.75mm (M2.5) | Pi HAT Standard |
| MH2 | 61.5 | 3.5 | 2.75mm (M2.5) | Pi HAT Standard |
| MH3 | 3.5 | 52.5 | 2.75mm (M2.5) | Pi HAT Standard |
| MH4 | 61.5 | 52.5 | 2.75mm (M2.5) | Pi HAT Standard |
| MH5 | 3.5 | 96.5 | 2.75mm (M2.5) | Chassis-Stuetze |
| MH6 | 61.5 | 96.5 | 2.75mm (M2.5) | Chassis-Stuetze |

## PCB Layout

```
y=0    +--------------------------------------------------------------+
       |  o MH1 (3.5, 3.5)                        o MH2 (61.5, 3.5)  |
       |                                                               |
       |  +--- J_PI: 40-Pin Stacking Header (Pass-Through) ---+      |
       |  | Pin2(5V) Pin4(5V) ... Pin8(TXD) Pin10(RXD) ...    |      |
       |  | Pin1(3V3) ... Pin6(GND) Pin9(GND) ...              |      |
       |  +----------------------------------------------------+      |
       |                                                               |
       |  [J7]    [C1]    [U2: MINI560]    [C2]   [C3]                |
       |  2-Pin   100uF    22x17mm         100uF  100nF               |
       |  5.08mm  25V      12V->5V         16V                        |
       |                                                               |
       |  +J_SIG_L+ +J_PWR_L+        +J_SIG_R+ +J_PWR_R+             |
       |  | RPWM  | | B+    | +----+ | RPWM  | | B+    |             |
       |  | LPWM  | | B-    | |ESP | | LPWM  | | B-    |             |
       |  | R_EN  | +-------+ |32  | | R_EN  | +-------+             |
       |  | L_EN  |  [R1]     |C3  |   [R2]  |                        |
       |  | VCC   |  10k      |    |  10k    |                        |
       |  | GND   |           |U1  |         |                        |
       |  +-------+           +----+  +-------+                       |
       |                                                               |
       |  o MH3 (3.5, 52.5)                      o MH4 (61.5, 52.5)  |
       |  - - - - - - - Pi Bereich Ende - - - - - - - - - - - - - -   |
       |                                                               |
       |  [J_ENC_L]                                    [J_ENC_R]      |
       |  A  B  VCC  GND                              A  B  VCC GND  |
       |                                                               |
       |                                                               |
       |              MowerBot Motor Controller v2.0                   |
       |                                                               |
       |  o MH5 (3.5, 96.5)                      o MH6 (61.5, 96.5)  |
y=100  +--------------------------------------------------------------+
```

### Trace-Breiten

| Netz | Strom | Trace-Breite (1oz Kupfer) |
|------|-------|---------------------------|
| 12V Rail | bis 10A peak | >= 3mm |
| GND (Leistung) | bis 10A peak | >= 3mm (oder GND-Plane) |
| 5V Rail | bis 4A | >= 2mm |
| 3V3 Rail | < 0.5A | 0.5mm |
| Signal (GPIO, UART) | < 0.01A | 0.3mm |

### Layout-Regeln

1. GND-Plane auf B.Cu (Unterseite) — reduziert EMI
2. 12V und 5V Leiterbahnen >= 2mm breit
3. UART-Signale (TX/RX) kurz und direkt zwischen Pi Header und ESP32
4. C3 (100nF) direkt neben ESP32 5V Pin
5. Pull-down Widerstaende R1/R2 nah an den Enable-Pins
6. BTS7960 Connectors an den Board-Kanten
7. ESP32 mit Buchsenleisten aufsteckbar
8. 40-Pin Stacking Header an exakter Pi HAT-Position
9. MINI560 direkt auf PCB geloetet
10. Mindestens 2mm Abstand zwischen 12V und 3.3V Signalen

## Kabelquerschnitte

| Verbindung | Max. Strom | Kabelquerschnitt |
|-----------|------------|-------------------|
| Akku -> J7 (XT60) | ~10A | 1.5-2.5mm2 (AWG 16-14) |
| J_PWR_L/R -> BTS7960 B+/B- | ~5A | 1.0-1.5mm2 (AWG 18-16) |
| Motor -> BTS7960 M+/M- | ~5A | 1.0-1.5mm2 (AWG 18-16) |
| J_SIG_L/R -> BTS7960 Signal | < 0.1A | 0.25mm2 (AWG 24) |
| J_ENC_L/R -> Encoder | < 0.01A | 0.25mm2 (AWG 24) |

## Externe Verkabelung

### BTS7960 Modul (pro Modul)

Signal-Kabel (duennes Kabel, AWG 24):
```
J_SIG_x Pin 1 (RPWM) --> BTS7960 RPWM
J_SIG_x Pin 2 (LPWM) --> BTS7960 LPWM
J_SIG_x Pin 3 (R_EN) --> BTS7960 R_EN
J_SIG_x Pin 4 (L_EN) --> BTS7960 L_EN
J_SIG_x Pin 5 (VCC)  --> BTS7960 VCC
J_SIG_x Pin 6 (GND)  --> BTS7960 GND
```

Leistungs-Kabel (dickes Kabel, AWG 16-18):
```
J_PWR_x Pin 1 (B+)   --> BTS7960 B+
J_PWR_x Pin 2 (B-)   --> BTS7960 B-
```

Motor-Kabel (dickes Kabel, AWG 16-18, direkt BTS7960 -> Motor):
```
BTS7960 M+ --> JGB37-520 Motor+
BTS7960 M- --> JGB37-520 Motor-
```

### JGB37-520 Encoder (pro Motor)

Encoder-Kabel (duennes Kabel, AWG 24):
```
J_ENC_x Pin 1 <-- Encoder Kanal A
J_ENC_x Pin 2 <-- Encoder Kanal B
J_ENC_x Pin 3 --> Encoder VCC (rot)
J_ENC_x Pin 4 --> Encoder GND (schwarz)
```

### Raspberry Pi 4

Das Motor Controller Board wird direkt auf die Pi GPIO-Leiste gesteckt
(40-Pin Stacking Header). Keine externen Kabel noetig.

Alle nicht genutzten Pi-Pins sind ueber den Stacking Header von oben
zugaenglich fuer weitere Sensoren, HATs oder Peripherie.

## Software-Aenderungen

### Firmware (firmware/src/main.cpp)

- Board: ESP32-C3-DevKitM-1 (RISC-V Single-Core, 160 MHz)
- UART fuer micro-ROS: Serial1 auf GPIO20 (RX) / GPIO21 (TX)
- Pin-Defines: GPIO0-5 fuer BTS7960, GPIO6/7/9/10 fuer Encoder
- PWM: ESP32-C3 hat 6 LEDC-Kanaele (4 genutzt fuer Motor-PWM)
- Status-LED: Separate LED noetig (GPIO8 ist WS2812 RGB)

### PlatformIO (firmware/platformio.ini)

```ini
[env:esp32-c3-devkitm-1]
platform = espressif32
board = esp32-c3-devkitm-1
framework = arduino
monitor_speed = 115200
lib_deps =
    https://github.com/micro-ROS/micro_ros_platformio
board_microros_distro = humble
board_microros_transport = serial
```

### Docker (docker-compose.yml)

```yaml
micro-ros:
  image: microros/micro-ros-agent:humble
  command: serial --dev /dev/ttyAMA0 -b 115200
  devices:
    - /dev/ttyAMA0:/dev/ttyAMA0
```

### Raspberry Pi Konfiguration

Die Serial-Konsole muss deaktiviert werden damit der UART fuer
micro-ROS frei ist:

```bash
sudo raspi-config
# -> Interface Options -> Serial Port
# -> Login Shell: No
# -> Hardware: Yes
sudo reboot
```

## Pull-down Widerstaende erklaert

Ein Pull-down Widerstand zieht einen Pin auf GND (LOW / 0V) wenn
nichts anderes ihn aktiv ansteuert.

### Problem ohne Pull-down

Wenn der ESP32 neu startet, resettet oder die Firmware crasht, sind
die GPIO-Pins kurzzeitig in einem undefinierten Zustand. Der BTS7960
Enable-Pin koennte dann kurz HIGH sehen und die Motoren unkontrolliert
anspringen lassen.

### Loesung mit Pull-down

```
ESP32-C3 GPIO2 --+---> BTS7960 R_EN + L_EN
                  |
                 [10kOhm]
                  |
                 GND

ESP32 resettet -> GPIO2 floatet -> 10kOhm zieht auf GND -> Enable = LOW -> Motor AUS
ESP32 laeuft   -> GPIO2 = HIGH  -> uebersteuert 10kOhm -> Enable = HIGH -> Motor bereit
```

### Warum 10kOhm?

- Zu klein (100 Ohm): Zieht zu viel Strom (3.3V / 100Ohm = 33mA)
- Zu gross (1MOhm): Zieht nicht stark genug gegen Stoerungen
- 10kOhm: 3.3V / 10kOhm = 0.33mA — vernachlaessigbar, aber zuverlaessig
