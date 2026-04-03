#include <Arduino.h>
#include <micro_ros_platformio.h>
#include <rcl/rcl.h>
#include <rclc/rclc.h>
#include <rclc/executor.h>
#include <geometry_msgs/msg/twist.h>

// ═══════════════════════════════════════════════════════════════════════════
// PIN CONFIGURATION — BTS7960 H-Bridge + JGB37-520 Encoder Motors
// ═══════════════════════════════════════════════════════════════════════════

// Motor Links — BTS7960 #1
#define MOTOR_L_RPWM  16   // Vorwärts PWM
#define MOTOR_L_LPWM  17   // Rückwärts PWM
#define MOTOR_L_EN    18   // Enable (R_EN + L_EN zusammen)

// Motor Rechts — BTS7960 #2
#define MOTOR_R_RPWM  19   // Vorwärts PWM
#define MOTOR_R_LPWM  21   // Rückwärts PWM
#define MOTOR_R_EN    22   // Enable (R_EN + L_EN zusammen)

// Encoder Links — JGB37-520
#define ENCODER_L_A   34   // Kanal A (Input-only Pin)
#define ENCODER_L_B   35   // Kanal B (Input-only Pin)

// Encoder Rechts — JGB37-520
#define ENCODER_R_A   32   // Kanal A
#define ENCODER_R_B   33   // Kanal B

// Debug-LED
#define LED_PIN       2

// ═══════════════════════════════════════════════════════════════════════════
// PWM CONFIGURATION — 1 kHz, 8-bit (0-255) ideal für DC-Motoren
// ═══════════════════════════════════════════════════════════════════════════

#define PWM_FREQ       1000
#define PWM_RESOLUTION 8

// PWM-Kanäle (ESP32 Arduino Core < 3.x verwendet Kanäle statt Pins)
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  // Core 3.x: ledcAttach(pin, freq, resolution) — kein separater Kanal
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
#define MAX_SPEED           0.28f   // Max m/s (76 RPM × π × 0.07m / 60s)
#define ENCODER_TICKS_REV   11      // Encoder-Ticks pro Motor-Umdrehung
#define CMD_TIMEOUT_MS      500     // Motoren stoppen nach X ms ohne cmd_vel

// ═══════════════════════════════════════════════════════════════════════════
// GLOBALS
// ═══════════════════════════════════════════════════════════════════════════

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

// LED
unsigned long last_led_toggle = 0;
bool led_on = false;

// Diagnose
volatile unsigned long cmd_vel_count = 0;

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
//
// BTS7960 Logik:
//   Vorwärts:  RPWM = PWM-Wert, LPWM = 0
//   Rückwärts: RPWM = 0,        LPWM = PWM-Wert
//   Stopp:     RPWM = 0,        LPWM = 0
//   Enable muss HIGH sein (im setup() gesetzt)
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
// LED HELPER
// ═══════════════════════════════════════════════════════════════════════════

void blink_led(unsigned long interval_ms) {
  if (millis() - last_led_toggle >= interval_ms) {
    led_on = !led_on;
    digitalWrite(LED_PIN, led_on ? HIGH : LOW);
    last_led_toggle = millis();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SETUP
// ═══════════════════════════════════════════════════════════════════════════

void setup() {
  // LED
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, HIGH);

  Serial.begin(115200);

  // BTS7960 Enable-Pins → HIGH (aktiviert beide H-Brücken)
  pinMode(MOTOR_L_EN, OUTPUT);
  pinMode(MOTOR_R_EN, OUTPUT);
  digitalWrite(MOTOR_L_EN, HIGH);
  digitalWrite(MOTOR_R_EN, HIGH);

  // PWM-Kanäle für die 4 Motor-Pins konfigurieren
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

  // Motoren stoppen
  stop_motors();

  // Encoder-Pins
  pinMode(ENCODER_L_A, INPUT_PULLUP);
  pinMode(ENCODER_L_B, INPUT_PULLUP);
  pinMode(ENCODER_R_A, INPUT_PULLUP);
  pinMode(ENCODER_R_B, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(ENCODER_L_A), encoder_left_isr, RISING);
  attachInterrupt(digitalPinToInterrupt(ENCODER_R_A), encoder_right_isr, RISING);

  // ============================================================
  // DIAGNOSE: Motor-Test-Impuls
  // ENTFERNEN wenn Motoren bestätigt funktionieren!
  // ============================================================

  // 5 Sekunden warten — Zeit zum Einschalten der 12V Versorgung
  delay(5000);

  // LED aus → Vorwärts-Impuls
  digitalWrite(LED_PIN, LOW);
  delay(200);
  set_motor_left(0.3f);
  set_motor_right(0.3f);
  digitalWrite(LED_PIN, HIGH);
  delay(1000);

  // Stopp
  stop_motors();
  digitalWrite(LED_PIN, LOW);
  delay(500);

  // Rückwärts-Impuls
  set_motor_left(-0.3f);
  set_motor_right(-0.3f);
  digitalWrite(LED_PIN, HIGH);
  delay(1000);

  // Stopp
  stop_motors();
  digitalWrite(LED_PIN, LOW);
  delay(500);

  // 3x LED blinken = Setup fertig
  for (int i = 0; i < 3; i++) {
    digitalWrite(LED_PIN, HIGH); delay(100);
    digitalWrite(LED_PIN, LOW);  delay(100);
  }
  // ============================================================

  // micro-ROS Transport
  set_microros_serial_transports(Serial);
  agent_state = WAITING_AGENT;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN LOOP — State Machine
// ═══════════════════════════════════════════════════════════════════════════

void loop() {
  switch (agent_state) {
    case WAITING_AGENT:
      blink_led(1000);
      if (rmw_uros_ping_agent(100, 1) == RMW_RET_OK) {
        agent_state = AGENT_AVAILABLE;
      }
      break;

    case AGENT_AVAILABLE:
      if (create_microros_entities()) {
        last_cmd_time = millis();
        cmd_vel_count = 0;
        agent_state = AGENT_CONNECTED;
        digitalWrite(LED_PIN, LOW);
      } else {
        agent_state = WAITING_AGENT;
      }
      break;

    case AGENT_CONNECTED: {
      if (millis() - last_cmd_time <= CMD_TIMEOUT_MS) {
        blink_led(100);   // Schnell = empfängt cmd_vel
      } else {
        blink_led(500);   // Mittel = verbunden, idle
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
      stop_motors();
      destroy_microros_entities();
      agent_state = WAITING_AGENT;
      digitalWrite(LED_PIN, LOW);
      break;
  }
}
