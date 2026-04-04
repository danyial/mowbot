/**
 * MowerBot Motor Controller Firmware
 *
 * Target: ESP32-C3-DevKitM-1 (RISC-V Single-Core, 160 MHz)
 * Motor Driver: 2x BTS7960 H-Bridge
 * Motors: 2x JGB37-520 (12V, 76 RPM, 11-tick encoder)
 * Communication: UART to Raspberry Pi (micro-ROS)
 * Status LED: WS2812 RGB on GPIO8
 *
 * Pi HAT design — ESP32 communicates with Pi via UART (GPIO20/21)
 * instead of USB. No USB cable needed between Pi and ESP32.
 */

#include <Arduino.h>
#include <Adafruit_NeoPixel.h>
#include <micro_ros_platformio.h>
#include <rcl/rcl.h>
#include <rclc/rclc.h>
#include <rclc/executor.h>
#include <geometry_msgs/msg/twist.h>

// ═══════════════════════════════════════════════════════════════════════════
// PIN CONFIGURATION — ESP32-C3-DevKitM-1 + BTS7960 + JGB37-520
// ═══════════════════════════════════════════════════════════════════════════

// Motor Links — BTS7960 #1
#define MOTOR_L_RPWM  0    // GPIO0  -> J_SIG_L Pin 1 (Vorwaerts PWM)
#define MOTOR_L_LPWM  1    // GPIO1  -> J_SIG_L Pin 2 (Rueckwaerts PWM)
#define MOTOR_L_EN    2    // GPIO2  -> J_SIG_L Pin 3+4 (Enable, mit Pull-down)

// Motor Rechts — BTS7960 #2
#define MOTOR_R_RPWM  3    // GPIO3  -> J_SIG_R Pin 1 (Vorwaerts PWM)
#define MOTOR_R_LPWM  4    // GPIO4  -> J_SIG_R Pin 2 (Rueckwaerts PWM)
#define MOTOR_R_EN    5    // GPIO5  -> J_SIG_R Pin 3+4 (Enable, mit Pull-down)

// Encoder Links — JGB37-520
#define ENCODER_L_A   6    // GPIO6  -> J_ENC_L Pin 1
#define ENCODER_L_B   7    // GPIO7  -> J_ENC_L Pin 2

// Encoder Rechts — JGB37-520
#define ENCODER_R_A   10   // GPIO10 -> J_ENC_R Pin 1
#define ENCODER_R_B   9    // GPIO9  -> J_ENC_R Pin 2 (Strapping Pin, OK als Input)

// WS2812 RGB LED (onboard ESP32-C3-DevKitM-1)
#define LED_PIN       8    // GPIO8 — WS2812 addressable RGB LED
#define LED_COUNT     1    // Single LED on the DevKit

// UART to Raspberry Pi (via Pi HAT PCB traces)
// ESP32-C3 TX (GPIO21) -> Pi GPIO15 (RXD)
// ESP32-C3 RX (GPIO20) <- Pi GPIO14 (TXD)
#define UART_RX_PIN   20
#define UART_TX_PIN   21

// ═══════════════════════════════════════════════════════════════════════════
// PWM CONFIGURATION — 1 kHz, 8-bit (0-255) ideal fuer DC-Motoren
// ═══════════════════════════════════════════════════════════════════════════

#define PWM_FREQ       1000
#define PWM_RESOLUTION 8

// PWM-Kanaele (ESP32-C3 Arduino Core < 3.x verwendet Kanaele statt Pins)
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  // Core 3.x: ledcAttach(pin, freq, resolution)
#else
  #define PWM_CH_L_RPWM  0
  #define PWM_CH_L_LPWM  1
  #define PWM_CH_R_RPWM  2
  #define PWM_CH_R_LPWM  3
#endif

// ═══════════════════════════════════════════════════════════════════════════
// ROBOT PARAMETERS
// ═══════════════════════════════════════════════════════════════════════════

#define WHEEL_SEPARATION    0.20f   // Radabstand in Metern (20 cm)
#define WHEEL_DIAMETER      0.07f   // Raddurchmesser in Metern (70 mm)
#define MAX_SPEED           0.28f   // Max m/s (76 RPM x pi x 0.07m / 60s)
#define ENCODER_TICKS_REV   11      // Encoder-Ticks pro Motor-Umdrehung
#define CMD_TIMEOUT_MS      500     // Motoren stoppen nach X ms ohne cmd_vel

// ═══════════════════════════════════════════════════════════════════════════
// LED COLORS — WS2812 RGB
// ═══════════════════════════════════════════════════════════════════════════

#define COLOR_OFF        0x000000
#define COLOR_RED        0x200000  // Warte auf Agent
#define COLOR_YELLOW     0x201000  // Agent gefunden / Motor-Test
#define COLOR_GREEN      0x002000  // Verbunden, idle
#define COLOR_BLUE       0x000020  // cmd_vel empfangen, Motoren aktiv
#define COLOR_PURPLE     0x100010  // Disconnected

// ═══════════════════════════════════════════════════════════════════════════
// GLOBALS
// ═══════════════════════════════════════════════════════════════════════════

// WS2812 LED
Adafruit_NeoPixel led(LED_COUNT, LED_PIN, NEO_GRB + NEO_KHZ800);

// micro-ROS
rcl_subscription_t cmd_vel_sub;
geometry_msgs__msg__Twist cmd_vel_msg;
rclc_executor_t executor;
rclc_support_t support;
rcl_allocator_t allocator;
rcl_node_t node;

// Timing
unsigned long last_cmd_time = 0;

// Encoder (volatile — ISR-Zugriff)
volatile long encoder_left_count = 0;
volatile long encoder_right_count = 0;

// State Machine
enum AgentState { WAITING_AGENT, AGENT_AVAILABLE, AGENT_CONNECTED, AGENT_DISCONNECTED };
AgentState agent_state = WAITING_AGENT;

// LED blink state
unsigned long last_led_toggle = 0;
bool led_blink_on = false;

// Diagnose
volatile unsigned long cmd_vel_count = 0;

// ═══════════════════════════════════════════════════════════════════════════
// LED HELPER — WS2812 RGB LED
// ═══════════════════════════════════════════════════════════════════════════

void set_led(uint32_t color) {
  led.setPixelColor(0, color);
  led.show();
}

void blink_led(uint32_t color, unsigned long interval_ms) {
  if (millis() - last_led_toggle >= interval_ms) {
    led_blink_on = !led_blink_on;
    set_led(led_blink_on ? color : COLOR_OFF);
    last_led_toggle = millis();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ENCODER ISRs
// ═══════════════════════════════════════════════════════════════════════════

void IRAM_ATTR encoder_left_isr() {
  if (digitalRead(ENCODER_L_B)) encoder_left_count++;
  else encoder_left_count--;
}

void IRAM_ATTR encoder_right_isr() {
  if (digitalRead(ENCODER_R_B)) encoder_right_count++;
  else encoder_right_count--;
}

// ═══════════════════════════════════════════════════════════════════════════
// MOTOR CONTROL — BTS7960
// ═══════════════════════════════════════════════════════════════════════════

#if ESP_ARDUINO_VERSION_MAJOR >= 3

void set_motor(int rpwm_pin, int lpwm_pin, float speed) {
  speed = constrain(speed, -1.0f, 1.0f);
  if (speed > 0.05f) {
    ledcWrite(rpwm_pin, (int)(speed * 255.0f));
    ledcWrite(lpwm_pin, 0);
  } else if (speed < -0.05f) {
    ledcWrite(rpwm_pin, 0);
    ledcWrite(lpwm_pin, (int)((-speed) * 255.0f));
  } else {
    ledcWrite(rpwm_pin, 0);
    ledcWrite(lpwm_pin, 0);
  }
}

#else

void set_motor(int rpwm_ch, int lpwm_ch, float speed) {
  speed = constrain(speed, -1.0f, 1.0f);
  if (speed > 0.05f) {
    ledcWrite(rpwm_ch, (int)(speed * 255.0f));
    ledcWrite(lpwm_ch, 0);
  } else if (speed < -0.05f) {
    ledcWrite(rpwm_ch, 0);
    ledcWrite(lpwm_ch, (int)((-speed) * 255.0f));
  } else {
    ledcWrite(rpwm_ch, 0);
    ledcWrite(lpwm_ch, 0);
  }
}

#endif

void stop_motors() {
  #if ESP_ARDUINO_VERSION_MAJOR >= 3
    set_motor(MOTOR_L_RPWM, MOTOR_L_LPWM, 0.0f);
    set_motor(MOTOR_R_RPWM, MOTOR_R_LPWM, 0.0f);
  #else
    set_motor(PWM_CH_L_RPWM, PWM_CH_L_LPWM, 0.0f);
    set_motor(PWM_CH_R_RPWM, PWM_CH_R_LPWM, 0.0f);
  #endif
}

void set_motor_left(float speed) {
  #if ESP_ARDUINO_VERSION_MAJOR >= 3
    set_motor(MOTOR_L_RPWM, MOTOR_L_LPWM, speed);
  #else
    set_motor(PWM_CH_L_RPWM, PWM_CH_L_LPWM, speed);
  #endif
}

void set_motor_right(float speed) {
  #if ESP_ARDUINO_VERSION_MAJOR >= 3
    set_motor(MOTOR_R_RPWM, MOTOR_R_LPWM, speed);
  #else
    set_motor(PWM_CH_R_RPWM, PWM_CH_R_LPWM, speed);
  #endif
}

// ═══════════════════════════════════════════════════════════════════════════
// cmd_vel CALLBACK — Differential Drive Kinematik
// ═══════════════════════════════════════════════════════════════════════════

void cmd_vel_callback(const void* msgin) {
  const geometry_msgs__msg__Twist* msg =
    (const geometry_msgs__msg__Twist*)msgin;

  float linear  = msg->linear.x;
  float angular = msg->angular.z;

  // Differential Drive
  float v_left  = linear - angular * (WHEEL_SEPARATION / 2.0f);
  float v_right = linear + angular * (WHEEL_SEPARATION / 2.0f);

  // Normalisieren auf -1.0 .. +1.0
  set_motor_left(constrain(v_left / MAX_SPEED, -1.0f, 1.0f));
  set_motor_right(constrain(v_right / MAX_SPEED, -1.0f, 1.0f));

  last_cmd_time = millis();
  cmd_vel_count++;
}

// ═══════════════════════════════════════════════════════════════════════════
// micro-ROS ENTITY MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

bool create_microros_entities() {
  allocator = rcl_get_default_allocator();
  if (rclc_support_init(&support, 0, NULL, &allocator) != RCL_RET_OK) return false;
  if (rclc_node_init_default(&node, "mower_motor_controller", "", &support) != RCL_RET_OK) return false;
  if (rclc_subscription_init_default(&cmd_vel_sub, &node,
      ROSIDL_GET_MSG_TYPE_SUPPORT(geometry_msgs, msg, Twist), "cmd_vel") != RCL_RET_OK) return false;
  if (rclc_executor_init(&executor, &support.context, 1, &allocator) != RCL_RET_OK) return false;
  if (rclc_executor_add_subscription(&executor, &cmd_vel_sub,
      &cmd_vel_msg, &cmd_vel_callback, ON_NEW_DATA) != RCL_RET_OK) return false;
  return true;
}

void destroy_microros_entities() {
  rclc_executor_fini(&executor);
  rcl_ret_t rc;
  rc = rcl_subscription_fini(&cmd_vel_sub, &node); (void)rc;
  rc = rcl_node_fini(&node); (void)rc;
  rclc_support_fini(&support);
}

// ═══════════════════════════════════════════════════════════════════════════
// SETUP
// ═══════════════════════════════════════════════════════════════════════════

void setup() {
  // --- WS2812 LED ---
  led.begin();
  led.setBrightness(50);  // Nicht zu hell (0-255)
  set_led(COLOR_RED);     // Rot = Startup

  // --- BTS7960 Enable-Pins -> HIGH ---
  pinMode(MOTOR_L_EN, OUTPUT);
  pinMode(MOTOR_R_EN, OUTPUT);
  digitalWrite(MOTOR_L_EN, HIGH);
  digitalWrite(MOTOR_R_EN, HIGH);

  // --- PWM-Kanaele fuer Motor-Pins ---
  #if ESP_ARDUINO_VERSION_MAJOR >= 3
    ledcAttach(MOTOR_L_RPWM, PWM_FREQ, PWM_RESOLUTION);
    ledcAttach(MOTOR_L_LPWM, PWM_FREQ, PWM_RESOLUTION);
    ledcAttach(MOTOR_R_RPWM, PWM_FREQ, PWM_RESOLUTION);
    ledcAttach(MOTOR_R_LPWM, PWM_FREQ, PWM_RESOLUTION);
  #else
    ledcSetup(PWM_CH_L_RPWM, PWM_FREQ, PWM_RESOLUTION);
    ledcSetup(PWM_CH_L_LPWM, PWM_FREQ, PWM_RESOLUTION);
    ledcSetup(PWM_CH_R_RPWM, PWM_FREQ, PWM_RESOLUTION);
    ledcSetup(PWM_CH_R_LPWM, PWM_FREQ, PWM_RESOLUTION);
    ledcAttachPin(MOTOR_L_RPWM, PWM_CH_L_RPWM);
    ledcAttachPin(MOTOR_L_LPWM, PWM_CH_L_LPWM);
    ledcAttachPin(MOTOR_R_RPWM, PWM_CH_R_RPWM);
    ledcAttachPin(MOTOR_R_LPWM, PWM_CH_R_LPWM);
  #endif

  // --- Motoren stoppen ---
  stop_motors();

  // --- Encoder-Pins ---
  pinMode(ENCODER_L_A, INPUT_PULLUP);
  pinMode(ENCODER_L_B, INPUT_PULLUP);
  pinMode(ENCODER_R_A, INPUT_PULLUP);
  pinMode(ENCODER_R_B, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(ENCODER_L_A), encoder_left_isr, RISING);
  attachInterrupt(digitalPinToInterrupt(ENCODER_R_A), encoder_right_isr, RISING);

  // ============================================================
  // DIAGNOSE: Motor-Test-Impuls
  // ENTFERNEN wenn Motoren bestaetigt funktionieren!
  // ============================================================
  delay(5000);  // 5s warten — Zeit zum Einschalten der 12V

  set_led(COLOR_YELLOW);       // Gelb = Motor-Test
  set_motor_left(0.3f);        // 30% vorwaerts
  set_motor_right(0.3f);
  delay(1000);

  stop_motors();
  set_led(COLOR_OFF);
  delay(500);

  set_led(COLOR_YELLOW);
  set_motor_left(-0.3f);       // 30% rueckwaerts
  set_motor_right(-0.3f);
  delay(1000);

  stop_motors();
  set_led(COLOR_OFF);
  delay(500);

  // 3x Gruen blinken = Setup fertig
  for (int i = 0; i < 3; i++) {
    set_led(COLOR_GREEN);  delay(100);
    set_led(COLOR_OFF);    delay(100);
  }
  // ============================================================

  // --- micro-ROS UART Transport ---
  // ESP32-C3 kommuniziert mit dem Pi ueber UART (nicht USB)
  // GPIO20 = RX (<- Pi TXD), GPIO21 = TX (-> Pi RXD)
  Serial1.begin(115200, SERIAL_8N1, UART_RX_PIN, UART_TX_PIN);
  set_microros_serial_transports(Serial1);

  agent_state = WAITING_AGENT;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN LOOP — State Machine
// ═══════════════════════════════════════════════════════════════════════════

void loop() {
  switch (agent_state) {
    case WAITING_AGENT:
      blink_led(COLOR_RED, 1000);  // Rot blinken = Warte auf Agent
      if (rmw_uros_ping_agent(100, 1) == RMW_RET_OK) {
        agent_state = AGENT_AVAILABLE;
      }
      break;

    case AGENT_AVAILABLE:
      set_led(COLOR_YELLOW);       // Gelb = Entities erstellen
      if (create_microros_entities()) {
        last_cmd_time = millis();
        cmd_vel_count = 0;
        agent_state = AGENT_CONNECTED;
      } else {
        agent_state = WAITING_AGENT;
      }
      break;

    case AGENT_CONNECTED: {
      if (millis() - last_cmd_time <= CMD_TIMEOUT_MS) {
        set_led(COLOR_BLUE);             // Blau = Motoren aktiv
      } else {
        blink_led(COLOR_GREEN, 500);     // Gruen blinken = idle
      }

      // Executor — KEIN Ping im Connected-State
      rclc_executor_spin_some(&executor, RCL_MS_TO_NS(10));

      // Watchdog
      if (millis() - last_cmd_time > CMD_TIMEOUT_MS) {
        stop_motors();
      }
      break;
    }

    case AGENT_DISCONNECTED:
      set_led(COLOR_PURPLE);             // Lila = Disconnected
      stop_motors();
      destroy_microros_entities();
      agent_state = WAITING_AGENT;
      break;
  }
}
