# MowerBot Motor Controller PCB

## Übersicht

Ein PCB das den ESP32 DevKit V1 mit zwei BTS7960 H-Brücken-Modulen und zwei JGB37-520 Encoder-Motoren verbindet. Das Board übernimmt die Stromversorgung (12V → 5V Step-Down), Signalverteilung und Sicherheits-Pull-downs.

## Blockdiagramm

```
                    ┌──────────────────────────────┐
                    │     MowerBot Motor PCB        │
                    │                              │
  12V Akku ──→ [J7] ──→ D1 ──→ LM2596 ──→ 5V ──→ ESP32 VIN
                    │              │               │
                    │             GND              │
                    │                              │
                    │    ┌─────────┴─────────┐     │
                    │    │    ESP32 DevKit    │     │
                    │    │                   │     │
              [J1] ←──── │ GP16,17,18 (L)    │     │
              [J2] ←──── │ GP19,21,22 (R)    │     │
              [J3] ────→ │ GP34,35 (Enc L)   │     │
              [J4] ────→ │ GP32,33 (Enc R)   │     │
                    │    │                   │     │
                    │    │ USB ──→ [J5: Pi]  │     │
                    │    └───────────────────┘     │
                    └──────────────────────────────┘
```

## Schaltplan

### Stromversorgung

```
        D1 (SS34)           LM2596 Module
J7.+12V ──→──|>|──→──┬──→── VIN ──→── VOUT ──→── 5V Rail
                      │                              │
                     C1 (100µF/25V)                 C2 (100µF/16V)
                      │                              │
J7.GND ──────────────┴──────────────────────────────┴──→── GND Rail
```

Die Schottky-Diode D1 (SS34) schützt vor Verpolung. C1 puffert die 12V Eingangsspannung, C2 puffert die 5V Ausgangsspannung des Step-Down Reglers.

### ESP32 Stromversorgung

```
5V Rail ──→── ESP32 VIN
                  │
                 C3 (100nF Keramik)
                  │
GND Rail ──→── ESP32 GND
```

Der 100nF Keramik-Kondensator C3 direkt am VIN-Pin des ESP32 filtert hochfrequente Störungen.

### BTS7960 Links (J1)

```
ESP32 GPIO 16 ────────────→── J1 Pin 1 (RPWM)
ESP32 GPIO 17 ────────────→── J1 Pin 2 (LPWM)
ESP32 GPIO 18 ──┬─────────→── J1 Pin 3 (R_EN)
                 │
                 ├─────────→── J1 Pin 4 (L_EN)
                 │
                R1 (10kΩ)
                 │
                GND           ← Pull-down: Motor aus bei ESP32-Reset
ESP32 3.3V ───────────────→── J1 Pin 5 (VCC)
GND Rail ─────────────────→── J1 Pin 6 (GND)
```

R_EN und L_EN werden zusammengebrückt auf GPIO 18. Der Pull-down Widerstand R1 zieht den Enable-Pin auf LOW wenn der ESP32 resettet oder startet, damit die Motoren nicht unkontrolliert anspringen.

### BTS7960 Rechts (J2)

```
ESP32 GPIO 19 ────────────→── J2 Pin 1 (RPWM)
ESP32 GPIO 21 ────────────→── J2 Pin 2 (LPWM)
ESP32 GPIO 22 ──┬─────────→── J2 Pin 3 (R_EN)
                 │
                 ├─────────→── J2 Pin 4 (L_EN)
                 │
                R2 (10kΩ)
                 │
                GND           ← Pull-down: Motor aus bei ESP32-Reset
ESP32 3.3V ───────────────→── J2 Pin 5 (VCC)
GND Rail ─────────────────→── J2 Pin 6 (GND)
```

Identischer Aufbau wie J1, nur mit GPIO 19, 21, 22.

### Encoder Links (J3)

```
J3 Pin 1 (A)   ──→── ESP32 GPIO 34
J3 Pin 2 (B)   ──→── ESP32 GPIO 35
J3 Pin 3 (VCC) ──→── 3.3V Rail
J3 Pin 4 (GND) ──→── GND Rail
```

GPIO 34 und 35 sind Input-only Pins auf dem ESP32 — ideal für Encoder-Signale. Die Firmware aktiviert interne Pull-ups.

### Encoder Rechts (J4)

```
J4 Pin 1 (A)   ──→── ESP32 GPIO 32
J4 Pin 2 (B)   ──→── ESP32 GPIO 33
J4 Pin 3 (VCC) ──→── 3.3V Rail
J4 Pin 4 (GND) ──→── GND Rail
```

### USB-Verbindung zum Raspberry Pi (J5)

```
ESP32 Micro-USB ──→── USB-Kabel ──→── Raspberry Pi USB-Port
```

Dient als micro-ROS Serial Transport (115200 Baud). Kein Platz auf dem PCB nötig — das USB-Kabel des ESP32 DevKit wird direkt zum Pi geführt.

### Optional: I2C Expansion (J6)

```
J6 Pin 1 (SDA) ──→── ESP32 GPIO 23
J6 Pin 2 (SCL) ──→── ESP32 GPIO 25
J6 Pin 3 (VCC) ──→── 3.3V Rail
J6 Pin 4 (GND) ──→── GND Rail
```

Für zukünftige Erweiterungen (z.B. IMU-Sensor direkt am ESP32).

## Pin-Belegung ESP32

| GPIO | Funktion | Richtung | Anschluss |
|------|----------|----------|-----------|
| 16 | Motor Links RPWM | Output (PWM) | J1 Pin 1 |
| 17 | Motor Links LPWM | Output (PWM) | J1 Pin 2 |
| 18 | Motor Links Enable | Output | J1 Pin 3+4 (R_EN+L_EN) |
| 19 | Motor Rechts RPWM | Output (PWM) | J2 Pin 1 |
| 21 | Motor Rechts LPWM | Output (PWM) | J2 Pin 2 |
| 22 | Motor Rechts Enable | Output | J2 Pin 3+4 (R_EN+L_EN) |
| 34 | Encoder Links A | Input | J3 Pin 1 |
| 35 | Encoder Links B | Input | J3 Pin 2 |
| 32 | Encoder Rechts A | Input | J4 Pin 1 |
| 33 | Encoder Rechts B | Input | J4 Pin 2 |
| 2 | Status LED | Output | Onboard LED |
| VIN | 5V Stromversorgung | Power In | LM2596 VOUT |
| 3.3V | 3.3V Rail | Power Out | J1-J4 VCC, J6 VCC |
| GND | Masse | Power | Alle GND |
| 23 | I2C SDA (optional) | I/O | J6 Pin 1 |
| 25 | I2C SCL (optional) | I/O | J6 Pin 2 |
| 1 (TX) | Serial TX | Output | USB (micro-ROS) |
| 3 (RX) | Serial RX | Input | USB (micro-ROS) |

### Pins die NICHT verwendet werden dürfen

| GPIO | Grund |
|------|-------|
| 0 | Boot-Pin (Pull-up beim Start nötig) |
| 2 | Bereits als Status-LED verwendet |
| 5 | Boot-Pin (muss HIGH beim Start sein) |
| 6-11 | Intern für SPI-Flash belegt |
| 12 | Boot-Pin (muss LOW beim Start sein) |
| 15 | Boot-Pin (Debug-Output beim Start) |
| 1, 3 | Serial TX/RX (micro-ROS Transport) |

## Stückliste (BOM)

| Ref | Bauteil | Wert/Typ | Package | Menge | Bemerkung |
|-----|---------|----------|---------|-------|-----------|
| U1 | ESP32 DevKit V1 | 30-Pin | 2x 15-Pin Buchsenleiste | 1 | Aufsteckbar |
| U2 | LM2596 Step-Down | 12V→5V | Fertigmodul | 1 | Alt.: Mini-360 Buck |
| D1 | Schottky-Diode | SS34 (3A/40V) | DO-214AB / SMA | 1 | Verpolschutz |
| C1 | Elko | 100uF / 25V | Radial, D6.3mm | 1 | 12V Puffer |
| C2 | Elko | 100uF / 16V | Radial, D6.3mm | 1 | 5V Puffer |
| C3 | Keramik-Kondensator | 100nF | 0805 oder THT | 1 | ESP32 Entstörung |
| R1 | Widerstand | 10kOhm | 0805 oder THT | 1 | Pull-down Enable L |
| R2 | Widerstand | 10kOhm | 0805 oder THT | 1 | Pull-down Enable R |
| J1 | Schraubklemme | 6-Pin, RM 2.54mm | KF128 | 1 | BTS7960 Links |
| J2 | Schraubklemme | 6-Pin, RM 2.54mm | KF128 | 1 | BTS7960 Rechts |
| J3 | Schraubklemme | 4-Pin, RM 2.54mm | KF128 | 1 | Encoder Links |
| J4 | Schraubklemme | 4-Pin, RM 2.54mm | KF128 | 1 | Encoder Rechts |
| J6 | Pin-Header | 4-Pin, RM 2.54mm | Gerade | 1 | I2C Expansion (optional) |
| J7 | Schraubklemme | 2-Pin, RM 5.08mm | KF301 | 1 | 12V Power Eingang |

## PCB Layout

### Empfohlene Masse

80mm x 60mm — passt auf Standard-Lochraster und in kompakte Roboter-Gehäuse.

### Platzierung

```
┌─────────────────────────────────────────┐
│ [J7: 12V IN]   [D1]  [C1]   [LM2596]  │  ← Stromversorgung oben
│                               [C2]      │
│─────────────────────────────────────────│
│                                         │
│ [J1: BTS L]      ┌─────────┐  [J2: BTS R] │  ← Motor-Anschlüsse links/rechts
│ RPWM LPWM EN     │  ESP32  │  RPWM LPWM   │
│ VCC  GND         │  DevKit │  EN VCC GND   │
│                   │  (U1)   │              │
│ [J3: Enc L]      │         │  [J4: Enc R]  │  ← Encoder-Anschlüsse
│ A B VCC GND      │         │  A B VCC GND  │
│                   └────┬────┘              │
│                        │USB               │
│ [R1] [R2] [C3]     [J5: zum Pi]          │  ← USB unten mittig
│                   [J6: I2C opt.]          │
└─────────────────────────────────────────┘
```

### Layout-Regeln

1. **GND-Plane auf der Unterseite** — reduziert EMI von den PWM-Signalen
2. **12V und 5V Leiterbahnen mindestens 1mm breit**, besser 2mm
3. **Signalleitungen (PWM, Encoder) so kurz wie möglich**
4. **C3 (100nF) direkt neben ESP32 VIN-Pin** platzieren
5. **Pull-down Widerstände R1/R2 nah an GPIO 18/22** platzieren
6. **Schraubklemmen an den PCB-Kanten** für einfaches Verkabeln
7. **ESP32 mit Buchsenleisten aufsteckbar** zum einfachen Austauschen
8. **Mindestens 2mm Abstand** zwischen 12V-Leitungen und 3.3V-Signalleitungen

## Verkabelung extern (Kabel vom PCB zu den Modulen)

### BTS7960 Modul (pro Modul)

```
PCB J1/J2          BTS7960 Modul
─────────          ─────────────
Pin 1 (RPWM) ──→  RPWM
Pin 2 (LPWM) ──→  LPWM
Pin 3 (R_EN) ──→  R_EN
Pin 4 (L_EN) ──→  L_EN
Pin 5 (VCC)  ──→  VCC
Pin 6 (GND)  ──→  GND

Separat (nicht über PCB):
12V Akku (+) ──→  B+    ← Leistungsstrom direkt zum BTS7960
12V Akku (-) ──→  B-
Motor        ──→  M+ / M-
```

**Wichtig:** Die 12V Motorstrom-Leitungen (B+/B-) gehen direkt vom Akku/Netzteil zum BTS7960 Modul — NICHT über das PCB. Das PCB führt nur die Steuersignale.

### JGB37-520 Encoder-Motor (pro Motor)

```
Motor-Kabel (2 Drähte) ──→ BTS7960 M+ / M-

Encoder-Kabel (4 Drähte):
PCB J3/J4            Encoder
─────────            ───────
Pin 1 (A)   ←──      Kanal A (meist gelb)
Pin 2 (B)   ←──      Kanal B (meist grün)
Pin 3 (VCC) ──→      VCC (meist rot)
Pin 4 (GND) ──→      GND (meist schwarz)
```

### Raspberry Pi

```
ESP32 USB (Micro-USB) ──→ USB-Kabel ──→ Raspberry Pi USB-Port
```

## Pull-down Widerstände erklärt

Ein Pull-down Widerstand zieht einen Pin auf GND (LOW / 0V) wenn nichts anderes ihn aktiv ansteuert.

### Problem ohne Pull-down

Wenn der ESP32 neu startet, resettet oder die Firmware crasht, sind die GPIO-Pins kurzzeitig in einem undefinierten Zustand — sie "floaten" zwischen HIGH und LOW. Der BTS7960 Enable-Pin könnte dann kurz HIGH sehen und die Motoren unkontrolliert anspringen lassen.

### Lösung mit Pull-down

```
ESP32 GPIO 18 ──────┬──────→ BTS7960 R_EN + L_EN
                    │
                   [10kΩ]   ← Pull-down Widerstand
                    │
                   GND

ESP32 resettet → GPIO 18 floatet → 10kΩ zieht auf GND → Enable = LOW → Motor AUS
ESP32 läuft    → GPIO 18 = HIGH  → übersteuert 10kΩ   → Enable = HIGH → Motor bereit
```

### Warum 10kOhm?

- Zu klein (z.B. 100 Ohm): Zieht zu viel Strom wenn der ESP32 HIGH ausgibt (3.3V / 100 Ohm = 33mA)
- Zu gross (z.B. 1M Ohm): Zieht nicht stark genug, Störungen könnten den Pin trotzdem auf HIGH bringen
- 10kOhm ist der Standard: 3.3V / 10kOhm = 0.33mA — vernachlässigbar wenig Strom, aber stark genug um den Pin zuverlässig auf LOW zu halten
