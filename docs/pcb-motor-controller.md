# MowerBot Motor Controller PCB — Raspberry Pi HAT v2.5

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
12V Akku --[XT60]--> [J6] --> 12V Rail
                         |
                         +--> [C1: 100uF/50V] --> GND
                         +--> [U3: MINI560] --> 5V Rail --> Pi 5V + ESP32 5V
                         +--> [J8 Pin 2 B+] --> BTS7960 #1 B+
                         +--> [J9 Pin 2 B+] --> BTS7960 #2 B+

GND --> [J8 Pin 1 B-] --> BTS7960 #1 B-
GND --> [J9 Pin 1 B-] --> BTS7960 #2 B-

Pi GPIO14/15 (UART) <--PCB Traces--> ESP32-C3 GPIO20/21 (UART)
Pi GPIO2/3 (I2C) <--PCB Traces--> MPU6050 SDA/SCL (Neigungssensor)

ESP32-C3 GPIO0-5 --> BTS7960 #1 + #2 (PWM + Enable, via J2/J3 Signal Header)
BTS7960 #1 M+/M- --> [J8 Pin 3+4] --PCB Traces--> [J4 Pin 1+6] --> JGB37-520 L
BTS7960 #2 M+/M- --> [J9 Pin 3+4] --PCB Traces--> [J5 Pin 1+6] --> JGB37-520 R
ESP32-C3 GPIO6,7,9,10 <-- [J4/J5 Pin 3+4] <-- Encoder #1 + #2
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
                                [J6: 2-Pin Schraubklemme, RM 5.08mm]
                                      | Pin 1: +12V
                                      | Pin 2: GND
                                      |
                                 12V Rail (PCB Traces >= 3mm breit)
                                      |
                                      +--> [C1: 100uF/50V Elko] --> GND  [TODO]
                                      |
                                      +--> [U3: MINI560 Step-Down, 30x18mm]
                                      |       VIN+    <- 12V Rail
                                      |       VIN-    <- GND
                                      |       VOUT+   -> 5V Rail
                                      |       VOUT-   -> GND
                                      |       EN      -> nicht verbunden (Default: ON)
                                      |           |
                                      |           +--> [C2: 100uF/50V Elko] --> GND  [TODO]
                                      |           +--> [C3: 100nF Keramik] --> GND  [TODO]
                                      |           +--> Pi 5V (J1 Pin 2 + Pin 4)
                                      |           +--> ESP32-C3 5V (U1 Pin 13 + Pin 14)
                                      |
                                      +--> [J8 Pin 2: B+] (-> BTS7960 #1 B+)
                                      |    [J8 Pin 1: B-] (-> BTS7960 #1 B-)
                                      |
                                      +--> [J9 Pin 2: B+] (-> BTS7960 #2 B+)
                                           [J9 Pin 1: B-] (-> BTS7960 #2 B-)
```

Kein Verpolschutz (Diode) noetig — der XT60-Stecker ist mechanisch
verpolungssicher und kann nicht falsch herum eingesteckt werden.

**Hinweis:** Alle Bauteile sind jetzt im Schaltplan platziert.
Der Schaltplan ist ERC-clean (0 Errors, 4 erwartete Warnings fuer die
Current-Sense Pins ML_R_IS, ML_L_IS, MR_R_IS, MR_L_IS — diese sind
absichtlich noch nicht verbunden).

**PWR_FLAG:** Ein PWR_FLAG Symbol (#FLG0201) ist am +12V Netz
platziert, damit ERC weiss dass der Akku das Netz treibt (sonst wuerde
"power_pin_not_driven" fuer den MINI560 VIN+ Pin gemeldet).

**ERC Konfiguration:** Die Regel `pin_to_pin` wurde in der Project-Datei
auf `ignore` gesetzt, weil Pi und MINI560 beide Power-Outputs am gleichen
Netz haben (der Pi bekommt seine 5V vom MINI560). Das ist ein akzeptables
Design-Pattern das KiCad sonst als Konflikt meldet.

### Raspberry Pi 40-Pin Stacking Header (J1)

Nur die genutzten Pins — alle anderen werden durchgefuehrt (Pass-Through)
und sind fuer zukuenftige Erweiterungen verfuegbar.

| Pi Pin | Name | Funktion | Verbindung |
|--------|------|----------|------------|
| 2 | 5V | Stromversorgung | <- 5V Rail (MINI560 U3) |
| 4 | 5V | Stromversorgung | <- 5V Rail (MINI560 U3) |
| 6 | GND | Masse | GND Rail |
| 3 | GPIO2 (SDA) | I2C SDA | <-> MPU6050 SDA (U2 Pin 4) |
| 5 | GPIO3 (SCL) | I2C SCL | <-> MPU6050 SCL (U2 Pin 3) |
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
| 4 | IO2 | GPIO2 | -> Motor L Enable (J2 Pin 3+4) + R1 (10k -> GND) |
| 5 | IO3 | GPIO3 | -> Motor R RPWM (J3 Pin 1) |
| 6 | GND | Masse | GND Rail |
| 7 | RST | Reset | Nicht verbunden |
| 8 | GND | Masse | GND Rail |
| 9 | IO0 | GPIO0 | -> Motor L RPWM (J2 Pin 1) |
| 10 | IO1 | GPIO1 | -> Motor L LPWM (J2 Pin 2) |
| 11 | IO10 | GPIO10 | <- Encoder R A (J5 Pin 3) |
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
| 5 | IO9 | GPIO9 | <- Encoder R B (J5 Pin 4) |
| 6 | IO8 | GPIO8 | RGB LED — nicht verwenden |
| 7 | GND | Masse | GND Rail |
| 8 | IO7 | GPIO7 | <- Encoder L B (J4 Pin 4) |
| 9 | IO6 | GPIO6 | <- Encoder L A (J4 Pin 3) |
| 10 | IO5 | GPIO5 | -> Motor R Enable (J3 Pin 3+4) + R2 (10k -> GND) |
| 11 | IO4 | GPIO4 | -> Motor R LPWM (J3 Pin 2) |
| 12 | GND | Masse | GND Rail |
| 13 | IO18 | GPIO18 | USB D- — nicht verwenden |
| 14 | IO19 | GPIO19 | USB D+ — nicht verwenden |
| 15 | GND | Masse | GND Rail |

### BTS7960 Links — Signal (J2, 2x4 Pin Header, RM 2.54mm)

Pin-Anordnung entspricht dem BTS7960 Modul-Header (IBT-2):

| Pin | Name | Verbindung |
|-----|------|------------|
| 1 | RPWM | <- ESP32-C3 GPIO0 |
| 2 | LPWM | <- ESP32-C3 GPIO1 |
| 3 | R_EN | <- ESP32-C3 GPIO2 + R1 (10k -> GND) |
| 4 | L_EN | <- ESP32-C3 GPIO2 (zusammen mit R_EN) |
| 5 | R_IS | -> Current Sense Right (fuer spaetere Nutzung) |
| 6 | L_IS | -> Current Sense Left (fuer spaetere Nutzung) |
| 7 | VCC | <- 3V3 Rail |
| 8 | GND | GND Rail |

### BTS7960 Rechts — Signal (J3, 2x4 Pin Header, RM 2.54mm)

| Pin | Name | Verbindung |
|-----|------|------------|
| 1 | RPWM | <- ESP32-C3 GPIO3 |
| 2 | LPWM | <- ESP32-C3 GPIO4 |
| 3 | R_EN | <- ESP32-C3 GPIO5 + R2 (10k -> GND) |
| 4 | L_EN | <- ESP32-C3 GPIO5 (zusammen mit R_EN) |
| 5 | R_IS | -> Current Sense Right (fuer spaetere Nutzung) |
| 6 | L_IS | -> Current Sense Left (fuer spaetere Nutzung) |
| 7 | VCC | <- 3V3 Rail |
| 8 | GND | GND Rail |

### BTS7960 Links — Power + Motor (J8, 4-Pin Schraubklemme, RM 5.08mm)

Kombinierte Schraubklemme fuer 12V-Versorgung UND Motor-Ausgang des BTS7960 L.
Vier Kabel gehen vom BTS7960 Modul zur Klemme: B-, B+, M+, M-.
Die M+/M- Leitungen werden auf dem PCB weiter zum Motor-Connector J4 geroutet.

Footprint: `TerminalBlock_Phoenix:TerminalBlock_Phoenix_MKDS-1,5-4-5.08_1x04_P5.08mm_Horizontal`

| Pin | Name | Netzlabel | Verbindung |
|-----|------|-----------|------------|
| 1 | B- | GND | GND Rail <-> BTS7960 #1 B- |
| 2 | B+ | +12V | +12V Rail <-> BTS7960 #1 B+ |
| 3 | M+ | ML_M+ | BTS7960 #1 M+ -> J4 Pin 1 (via PCB Trace >=2mm) |
| 4 | M- | ML_M- | BTS7960 #1 M- -> J4 Pin 6 (via PCB Trace >=2mm) |

### BTS7960 Rechts — Power + Motor (J9, 4-Pin Schraubklemme, RM 5.08mm)

Kombinierte Schraubklemme fuer 12V-Versorgung UND Motor-Ausgang des BTS7960 R.

Footprint: `TerminalBlock_Phoenix:TerminalBlock_Phoenix_MKDS-1,5-4-5.08_1x04_P5.08mm_Horizontal`

| Pin | Name | Netzlabel | Verbindung |
|-----|------|-----------|------------|
| 1 | B- | GND | GND Rail <-> BTS7960 #2 B- |
| 2 | B+ | +12V | +12V Rail <-> BTS7960 #2 B+ |
| 3 | M+ | MR_M+ | BTS7960 #2 M+ -> J5 Pin 1 (via PCB Trace >=2mm) |
| 4 | M- | MR_M- | BTS7960 #2 M- -> J5 Pin 6 (via PCB Trace >=2mm) |

### Motor Links (J4, 6-Pin Header, RM 2.54mm) — JGB37-520

Pin-Reihenfolge entspricht der Kabel-Kodierung des JGB37-520 Motors.
Alle 6 Kabel gehen in einen einzigen Stecker pro Motor.

| Pin | Farbe | Name | Netzlabel | Verbindung |
|-----|-------|------|-----------|------------|
| 1 | Rot | M+ | ML_M+ | <- J8 Pin 3 (via PCB Trace) |
| 2 | Schwarz | ENC_GND | GND | GND Rail |
| 3 | Gelb | ENC_A | ENC_L_A | -> ESP32-C3 GPIO6 |
| 4 | Gruen | ENC_B | ENC_L_B | -> ESP32-C3 GPIO7 |
| 5 | Blau | ENC_VCC | +3V3 | <- 3V3 Rail |
| 6 | Weiss | M- | ML_M- | <- J8 Pin 4 (via PCB Trace) |

### Motor Rechts (J5, 6-Pin Header, RM 2.54mm) — JGB37-520

| Pin | Farbe | Name | Netzlabel | Verbindung |
|-----|-------|------|-----------|------------|
| 1 | Rot | M+ | MR_M+ | <- J9 Pin 3 (via PCB Trace) |
| 2 | Schwarz | ENC_GND | GND | GND Rail |
| 3 | Gelb | ENC_A | ENC_R_A | -> ESP32-C3 GPIO10 |
| 4 | Gruen | ENC_B | ENC_R_B | -> ESP32-C3 GPIO9 |
| 5 | Blau | ENC_VCC | +3V3 | <- 3V3 Rail |
| 6 | Weiss | M- | MR_M- | <- J9 Pin 4 (via PCB Trace) |

### Pull-down Widerstaende (Sicherheit)

```
ESP32-C3 GPIO2 --+---> J2 Pin 3 (R_EN)
                  +---> J2 Pin 4 (L_EN)
                  |
                 [R1: 10kOhm]
                  |
                 GND

ESP32-C3 GPIO5 --+---> J3 Pin 3 (R_EN)
                  +---> J3 Pin 4 (L_EN)
                  |
                 [R2: 10kOhm]
                  |
                 GND
```

Beim ESP32-Reset oder Boot sind die GPIOs kurzzeitig undefiniert.
Die Pull-down Widerstaende stellen sicher, dass die BTS7960
Enable-Pins auf LOW (Motor AUS) bleiben.

### MPU6050 Neigungssensor (U2, GY-521 Breakout Board)

Das GY-521 Board (21x16mm) wird ueber Buchsenleisten auf das PCB gesteckt.
Kommunikation ueber I2C direkt mit dem Raspberry Pi.

| Pin | Name | Verbindung |
|-----|------|------------|
| 1 | VCC | <- 3V3 Rail (ESP32-C3 3V3) |
| 2 | GND | GND Rail |
| 3 | SCL | <-> Pi GPIO3 (SCL, Pin 5) |
| 4 | SDA | <-> Pi GPIO2 (SDA, Pin 3) |
| 5 | XDA | Nicht verbunden (Aux I2C) |
| 6 | XCL | Nicht verbunden (Aux I2C) |
| 7 | AD0 | GND (I2C Adresse 0x68) |
| 8 | INT | Nicht verbunden |

Zweck: Neigungserkennung (Roll/Pitch) fuer Sicherheitsabschaltung
bei zu steilem Gelaende (Schwellenwert konfigurierbar in Web-App).

## GPIO-Zuordnung ESP32-C3

| GPIO | Funktion | Richtung | Anschluss |
|------|----------|----------|-----------|
| 0 | Motor L RPWM | Output (PWM) | J2 Pin 1 |
| 1 | Motor L LPWM | Output (PWM) | J2 Pin 2 |
| 2 | Motor L Enable | Output | J2 Pin 3+4 |
| 3 | Motor R RPWM | Output (PWM) | J3 Pin 1 |
| 4 | Motor R LPWM | Output (PWM) | J3 Pin 2 |
| 5 | Motor R Enable | Output | J3 Pin 3+4 |
| 6 | Encoder L A | Input | J4 Pin 3 |
| 7 | Encoder L B | Input | J4 Pin 4 |
| 9 | Encoder R B | Input | J5 Pin 4 |
| 10 | Encoder R A | Input | J5 Pin 3 |
| 20 | UART RX (<- Pi TX) | Input | Pi GPIO14 (TXD) |
| 21 | UART TX (-> Pi RX) | Output | Pi GPIO15 (RXD) |

Nicht verwendete GPIOs: GPIO8 (RGB LED), GPIO18/19 (USB)

## Netzlabel-Liste (26 Netze)

Alle Verbindungen im Schaltplan werden ueber Netzlabels hergestellt (keine Drahtverbindungen).

### Power Netze (Power Symbols)

| Label | Beschreibung |
|-------|-------------|
| +12V | 12V Batterie (J6 Pin 1, J8 Pin 2, J9 Pin 2) |
| +5V | 5V vom MINI560 U3 (J1 Pin 2+4, U1 Pin 13+14) |
| +3V3 | 3.3V vom ESP32 U1 (U2 Pin 1, J4/J5 Pin 5, J2/J3 Pin 7) |
| GND | Gemeinsame Masse (J6 Pin 2, J8/J9 Pin 1, alle GND-Pins) |

### UART (J1 <-> U1)

| Label | Beschreibung |
|-------|-------------|
| UART_TX_PI | Pi GPIO14 (J1 Pin 8) -> ESP32 RX (U1 Pin 28) |
| UART_RX_PI | Pi GPIO15 (J1 Pin 10) <- ESP32 TX (U1 Pin 29) |

### I2C (J1 <-> U2)

| Label | Beschreibung |
|-------|-------------|
| I2C_SDA | Pi GPIO2 (J1 Pin 3) <-> MPU6050 SDA (U2 Pin 4) |
| I2C_SCL | Pi GPIO3 (J1 Pin 5) <-> MPU6050 SCL (U2 Pin 3) |

### Motor Links — Signale (U1 -> J2)

| Label | Beschreibung |
|-------|-------------|
| ML_RPWM | ESP32 GPIO0 (U1 Pin 9) -> J2 Pin 1 |
| ML_LPWM | ESP32 GPIO1 (U1 Pin 10) -> J2 Pin 2 |
| ML_EN | ESP32 GPIO2 (U1 Pin 4) -> J2 Pin 3+4 (R1 Pull-down) |
| ML_R_IS | J2 Pin 5 (Current Sense R, fuer Zukunft) |
| ML_L_IS | J2 Pin 6 (Current Sense L, fuer Zukunft) |

### Motor Rechts — Signale (U1 -> J3)

| Label | Beschreibung |
|-------|-------------|
| MR_RPWM | ESP32 GPIO3 (U1 Pin 5) -> J3 Pin 1 |
| MR_LPWM | ESP32 GPIO4 (U1 Pin 20) -> J3 Pin 2 |
| MR_EN | ESP32 GPIO5 (U1 Pin 21) -> J3 Pin 3+4 (R2 Pull-down) |
| MR_R_IS | J3 Pin 5 (Current Sense R, fuer Zukunft) |
| MR_L_IS | J3 Pin 6 (Current Sense L, fuer Zukunft) |

### Motor Links — Ausgang (J8 -> J4, via PCB)

| Label | Beschreibung |
|-------|-------------|
| ML_M+ | J8 Pin 3 -> J4 Pin 1 (Rot, via PCB Trace >=2mm) |
| ML_M- | J8 Pin 4 -> J4 Pin 6 (Weiss, via PCB Trace >=2mm) |

### Motor Rechts — Ausgang (J9 -> J5, via PCB)

| Label | Beschreibung |
|-------|-------------|
| MR_M+ | J9 Pin 3 -> J5 Pin 1 (Rot, via PCB Trace >=2mm) |
| MR_M- | J9 Pin 4 -> J5 Pin 6 (Weiss, via PCB Trace >=2mm) |

### Encoder Links (J4 -> U1)

| Label | Beschreibung |
|-------|-------------|
| ENC_L_A | J4 Pin 3 (Gelb) -> ESP32 GPIO6 (U1 Pin 22) |
| ENC_L_B | J4 Pin 4 (Gruen) -> ESP32 GPIO7 (U1 Pin 23) |

### Encoder Rechts (J5 -> U1)

| Label | Beschreibung |
|-------|-------------|
| ENC_R_A | J5 Pin 3 (Gelb) -> ESP32 GPIO10 (U1 Pin 11) |
| ENC_R_B | J5 Pin 4 (Gruen) -> ESP32 GPIO9 (U1 Pin 26) |

## Stueckliste (BOM)

### PCB-Komponenten

| Ref | Bauteil | Wert/Typ | Package | Menge | Status |
|-----|---------|----------|---------|-------|--------|
| U1 | ESP32-C3-DevKitM-1 | 30-Pin | 2x 15-Pin Buchsenleiste | 1 | ✓ Im Schaltplan |
| U2 | GY-521 (MPU6050) | Neigungssensor (I2C) | 21x16mm, 1x8 Buchsenleiste | 1 | ✓ Im Schaltplan |
| U3 | MINI560 | 5V/5A Step-Down | 30x18mm, Pin Headers (THT) | 1 | ✓ Im Schaltplan |
| J1 | Stacking Header | 2x20, RM 2.54mm, Extra Tall | 40-Pin Pass-Through | 1 | ✓ Im Schaltplan |
| J2 | Pin Header | 2x4, RM 2.54mm | BTS7960 L Signal | 1 | ✓ Im Schaltplan |
| J3 | Pin Header | 2x4, RM 2.54mm | BTS7960 R Signal | 1 | ✓ Im Schaltplan |
| J4 | Pin Header | 1x6, RM 2.54mm | JGB37-520 L Motor | 1 | ✓ Im Schaltplan |
| J5 | Pin Header | 1x6, RM 2.54mm | JGB37-520 R Motor | 1 | ✓ Im Schaltplan |
| J6 | Schraubklemme | 1x2, RM 5.08mm | 12V Eingang (Akku) | 1 | ✓ Im Schaltplan |
| J8 | Schraubklemme | 1x4, RM 5.08mm | BTS7960 L Power+Motor | 1 | ✓ Im Schaltplan |
| J9 | Schraubklemme | 1x4, RM 5.08mm | BTS7960 R Power+Motor | 1 | ✓ Im Schaltplan |
| R1 | Widerstand | 10kOhm | 0805 SMD | 1 | ✓ Im Schaltplan |
| R2 | Widerstand | 10kOhm | 0805 SMD | 1 | ✓ Im Schaltplan |
| C1 | Elko | 100uF/50V | Radial D8.0mm x H12mm, P3.5mm | 1 | ✓ Im Schaltplan |
| C2 | Elko | 100uF/50V | Radial D8.0mm x H12mm, P3.5mm | 1 | ✓ Im Schaltplan |
| C3 | Keramik MLCC | 100nF | 0805 SMD | 1 | ✓ Im Schaltplan |
| #FLG0201 | PWR_FLAG | power:PWR_FLAG | - | 1 | ✓ Im Schaltplan (+12V Net) |

### Current Sense (Vorbereitet, Library verfuegbar)

Fuer die Messung des Motorstroms ueber die BTS7960 R_IS/L_IS Current-Sense
Ausgaenge ist ein ADS1115 16-bit 4-Kanal I2C ADC vorgesehen. Das Modul ist
als Symbol und Footprint in der MowerBot-Library verfuegbar und kann bei
Bedarf in den Schaltplan eingefuegt werden.

| Ref | Bauteil | Wert/Typ | Package | Menge | Status |
|-----|---------|----------|---------|-------|--------|
| U4 | ADS1115 Breakout | 16-bit 4-Kanal I2C ADC | 27.94x17.27mm, 1x10 THT | 1 | ⚪ Library, TODO Schaltplan |
| R_sense | Widerstand | 1.2kOhm 1% | 0805 SMD | 4 | ⚪ TODO (fuer IS Signale) |
| C_filter | Keramik MLCC | 10nF X7R | 0805 SMD | 4 | ⚪ TODO (Anti-Alias-Filter) |

**Anschluss:** ADS1115 I2C-Bus shared mit MPU6050 (Pi I2C-Bus, Adresse 0x48).
Pi liest Stromwerte und publiziert sie als ROS2 Topic `/motor_currents`.
Bei Ueberlast kann der Pi einen Notstopp-Befehl an den ESP32 senden.

**Schaltung pro IS-Kanal:**
```
BTS7960 R_IS/L_IS ---[R_sense 1.2k]---+--- ADS1115 AINx
                                      |
                                     [C_filter 10nF]
                                      |
                                     GND
```

Bei BTS7960 k_ILIS = 8500 und R_sense = 1.2kOhm:
- 1A Motorstrom -> V_AIN = 0.141V
- 5A Motorstrom -> V_AIN = 0.706V
- 10A Motorstrom -> V_AIN = 1.412V
- 20A Motorstrom -> V_AIN = 2.824V (passt gerade unter ADS1115 VDD=3.3V)

Mit ADS1115 PGA auf ±2.048V oder ±4.096V gut messbar.

### Befestigungsmaterial (nicht auf PCB)

| Teil | Spezifikation | Menge |
|------|---------------|-------|
| XT60 Buchse mit Kabel | An J6 Schraubklemme (Akku-Eingang) | 1 |
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
       |  +--- J1: 40-Pin Stacking Header (Pass-Through) ----+       |
       |  | Pin2(5V) Pin4(5V) ... Pin8(TXD) Pin10(RXD) ...    |      |
       |  | Pin1(3V3) ... Pin6(GND) Pin9(GND) ...              |      |
       |  +----------------------------------------------------+      |
       |                                                               |
       |  [J6]    [C1]    [U3: MINI560]    [C2]   [C3]               |
       |  2-Pin   100uF    30x18mm         100uF  100nF              |
       |  5.08mm  50V      12V->5V         50V    MLCC               |
       |                                                               |
       |  +--J2--+                            +--J3--+                |
       |  |1 RPWM|2|                          |1 RPWM|2|              |
       |  |3 R_EN|4|  +----+                  |3 R_EN|4|              |
       |  |5 R_IS|6|  |U1  |                  |5 R_IS|6|              |
       |  |7 VCC |8|  |ESP32                  |7 VCC |8|              |
       |  +------+   |C3  |    [R1]  [R2]    +------+                |
       |             |    |    10k   10k                             |
       |             +----+                                          |
       |                                                               |
       |  o MH3 (3.5, 52.5)                      o MH4 (61.5, 52.5)  |
       |  - - - - - - - Pi Bereich Ende - - - - - - - - - - - - - -   |
       |                                                               |
       |  [J8: 4P Schraubklemme]              [J9: 4P Schraubklemme] |
       |  B-  B+  M+  M-                      B-  B+  M+  M-         |
       |  (zum BTS7960 Modul)                 (zum BTS7960 Modul)    |
       |                                                               |
       |  [J4: 6P Header]                      [J5: 6P Header]       |
       |  M+ GND EncA EncB VCC M-              M+ GND EncA EncB VCC M- |
       |  (zum JGB37-520)                      (zum JGB37-520)       |
       |                                                               |
       |              MowerBot Motor Controller v2.3                   |
       |                                                               |
       |  o MH5 (3.5, 96.5)                      o MH6 (61.5, 96.5)  |
y=100  +--------------------------------------------------------------+
```

### Trace-Breiten

| Netz | Strom | Trace-Breite (1oz Kupfer) |
|------|-------|---------------------------|
| 12V Rail (J6 -> U3 + J8/J9 Pin 2) | bis 10A peak | >= 3mm |
| GND (Leistung, J6 -> J8/J9 Pin 1) | bis 10A peak | >= 3mm (oder GND-Plane) |
| 5V Rail (U3 -> J1 + U1) | bis 4A | >= 2mm |
| Motor M+/M- (J8/J9 Pin 3+4 -> J4/J5 Pin 1+6) | bis 5A | >= 2mm |
| 3V3 Rail | < 0.5A | 0.5mm |
| Signal (GPIO, UART) | < 0.01A | 0.3mm |

### Layout-Regeln

1. GND-Plane auf B.Cu (Unterseite) — reduziert EMI
2. 12V und 5V Leiterbahnen >= 2mm breit, 12V Rail >= 3mm
3. UART-Signale (TX/RX) kurz und direkt zwischen J1 und U1
4. C3 (100nF) direkt neben ESP32 5V Pin
5. Pull-down Widerstaende R1/R2 nah an den Enable-Pins (J2/J3 Pin 3+4)
6. J8/J9 (4P Schraubklemmen) und J4/J5 (6P Motor Header) an den Board-Kanten
7. ESP32 (U1) mit Buchsenleisten aufsteckbar
8. 40-Pin Stacking Header (J1) an exakter Pi HAT-Position
9. MINI560 (U3) auf Pin Headers aufgesteckt (THT, 30x18mm)
10. Mindestens 2mm Abstand zwischen 12V und 3.3V Signalen
11. M+/M- Traces von J8/J9 zu J4/J5 moeglichst kurz und direkt
12. Bauhoehe beachten: Elkos C1/C2 sind 12mm hoch — moeglicher Konflikt
    mit Pi 4 Unterseite (typ. 11-13mm Abstand ueber HAT). Empfehlung:
    Elkos unterhalb des Pi-Bereichs platzieren (nahe J6 oder zwischen
    U3 und unterem Board-Rand) oder Extra-Tall Stacking Header verwenden.

## Kabelquerschnitte

| Verbindung | Max. Strom | Kabelquerschnitt |
|-----------|------------|-------------------|
| Akku -> J6 (XT60) | ~10A | 1.5-2.5mm2 (AWG 16-14) |
| J8/J9 Pin 1+2 (B-/B+) <-> BTS7960 | ~5A | 1.0-1.5mm2 (AWG 18-16) |
| J8/J9 Pin 3+4 (M+/M-) <-> BTS7960 | ~5A | 1.0-1.5mm2 (AWG 18-16) |
| J4/J5 -> JGB37-520 (alle 6 Kabel) | bis 5A (Motor), <0.01A (Encoder) | Motor: AWG 18-16, Encoder: AWG 24 |
| J2/J3 -> BTS7960 Signal | < 0.1A | 0.25mm2 (AWG 24) |

## Externe Verkabelung

### BTS7960 Modul (pro Modul)

Signal-Kabel (duennes Kabel, AWG 24, 2x4 Flachbandkabel oder Einzellitzen):
```
J2/J3 Pin 1 (RPWM) --> BTS7960 Pin 1 (RPWM)
J2/J3 Pin 2 (LPWM) --> BTS7960 Pin 2 (LPWM)
J2/J3 Pin 3 (R_EN) --> BTS7960 Pin 3 (R_EN)
J2/J3 Pin 4 (L_EN) --> BTS7960 Pin 4 (L_EN)
J2/J3 Pin 5 (R_IS) <-- BTS7960 Pin 5 (R_IS)
J2/J3 Pin 6 (L_IS) <-- BTS7960 Pin 6 (L_IS)
J2/J3 Pin 7 (VCC)  --> BTS7960 Pin 7 (VCC)
J2/J3 Pin 8 (GND)  --> BTS7960 Pin 8 (GND)
```

Power + Motor Kabel (dickes Kabel, AWG 16-18) — 4 Leitungen zur 4P Schraubklemme:
```
J8/J9 Pin 1 (B-) <-- BTS7960 B-
J8/J9 Pin 2 (B+) --> BTS7960 B+
J8/J9 Pin 3 (M+) <-- BTS7960 M+
J8/J9 Pin 4 (M-) <-- BTS7960 M-
```
Die M+/M- Leitungen gehen auf dem PCB weiter als Traces zum Motor-Connector J4/J5.

### JGB37-520 Motor (pro Motor)

Alle 6 Kabel des JGB37-520 gehen in den 6-Pin Motor-Connector (J4/J5).
Ein einziges Kabel pro Motor vom PCB zum JGB37-520:
```
J4/J5 Pin 1 (M+)      <-- Rot:     Motor power +     (via PCB von J8/J9 Pin 3)
J4/J5 Pin 2 (ENC_GND) --> Schwarz:  Encoder GND       (GND Rail)
J4/J5 Pin 3 (ENC_A)   <-- Gelb:    Encoder Kanal A   (-> ESP32)
J4/J5 Pin 4 (ENC_B)   <-- Gruen:   Encoder Kanal B   (-> ESP32)
J4/J5 Pin 5 (ENC_VCC) --> Blau:    Encoder VCC       (3V3 Rail)
J4/J5 Pin 6 (M-)      <-- Weiss:   Motor power -     (via PCB von J8/J9 Pin 4)
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

## Custom KiCad Bibliotheken

Die Custom-Symbole und -Footprints fuer dieses Projekt sind in der
`MowerBot`-Library abgelegt:

### Symbol-Library (`hardware/MowerBot.kicad_sym`)

| Symbol | Beschreibung |
|--------|-------------|
| MINI560 | 5V/5A Step-Down Modul (5-Pin THT) |
| GY521_MPU6050 | MPU6050 Neigungssensor Breakout (8-Pin THT) |
| BTS7960 | BTS7960 H-Bruecken-Modul 2x4 Signal Header |
| JGB37_520 | JGB37-520 Motor Connector (6-Pin THT) |
| ADS1115 | 16-bit 4-Kanal I2C ADC Breakout (10-Pin THT, fuer Current Sense) |

### Footprint-Library (`hardware/MowerBot.pretty/`)

| Footprint | Beschreibung | 3D-Modell |
|-----------|-------------|-----------|
| MINI560 | 30x18mm, 9 THT Pads | MINI560.step |
| GY521_MPU6050 | 21x16mm, 8 THT Pads + 2 Mounting Holes | GY521_MPU6050.step |
| BTS7960 | 2x4 THT Pin Header, RM 2.54mm | BTS7960.step |
| JGB37_520 | 1x6 THT Pin Header, RM 2.54mm | (kein 3D-Modell) |
| ADS1115 | 27.94x17.27mm, 1x10 THT, 1x Reihe | ADS1115.step |

### Library registrieren

Die Libraries sind bereits im Projekt-File registriert:

- `hardware/sym-lib-table`: `(lib (name "MowerBot") (uri "${KIPRJMOD}/MowerBot.kicad_sym"))`
- `hardware/fp-lib-table`: `(lib (name "MowerBot") (uri "${KIPRJMOD}/MowerBot.pretty"))`

Zum Verwenden im Schaltplan: Symbol `MowerBot:ADS1115` auswaehlen.
Zum Verwenden im PCB: Footprint `MowerBot:ADS1115` auswaehlen.
