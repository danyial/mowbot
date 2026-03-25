#include <Arduino.h>
#include <micro_ros_platformio.h>
#include <rcl/rcl.h>
#include <rclc/rclc.h>
#include <rclc/executor.h>
#include <geometry_msgs/msg/twist.h>

// === KONFIGURATION ===
// ESC PWM Pins
#define ESC_LEFT_PIN   25
#define ESC_RIGHT_PIN  26

#if ESP_ARDUINO_VERSION_MAJOR >= 3
  #define ESC_LEFT  ESC_LEFT_PIN
  #define ESC_RIGHT ESC_RIGHT_PIN
#else
  #define ESC_LEFT  0   // Channel 0
  #define ESC_RIGHT 1   // Channel 1
#endif

// Debug-LED (eingebaute LED auf den meisten ESP32 DevKits)
#define LED_PIN 2

// PWM Konfiguration für RC-ESCs
// ESCs erwarten 50 Hz (20ms Periode)
// 1000µs = volle Rückwärts, 1500µs = Stop, 2000µs = volle Vorwärts
#define PWM_FREQ       50
#define PWM_RESOLUTION 16   // 16-bit = 0-65535

// Roboter-Parameter
#define WHEEL_SEPARATION 0.20  // Kettenabstand in Metern (ca. 20cm)
#define MAX_SPEED        0.5   // max m/s

// micro-ROS Objekte
rcl_subscription_t cmd_vel_sub;
geometry_msgs__msg__Twist cmd_vel_msg;
rclc_executor_t executor;
rclc_support_t support;
rcl_allocator_t allocator;
rcl_node_t node;

// Watchdog: stoppe wenn keine Befehle kommen
unsigned long last_cmd_time = 0;
#define CMD_TIMEOUT_MS 500

// micro-ROS Verbindungsstatus
enum AgentState { WAITING_AGENT, AGENT_AVAILABLE, AGENT_CONNECTED, AGENT_DISCONNECTED };
AgentState agent_state = WAITING_AGENT;

// LED-Blink Status
unsigned long last_led_toggle = 0;
bool led_on = false;

// Zähler für empfangene cmd_vel Nachrichten (Diagnose)
volatile unsigned long cmd_vel_count = 0;

// µs → PWM Duty Cycle (16-bit bei 50 Hz)
uint32_t us_to_duty(int microseconds) {
  // Bei 50 Hz = 20000µs Periode, 16-bit = 65535
  return (uint32_t)((float)microseconds / 20000.0f * 65535.0f);
}

// ESC-Totzone überspringen: RC-Auto ESCs ignorieren kleine Werte um Neutral.
// Mappe den Eingangsbereich (5%-100%) auf den ESC-Bereich (15%-100%),
// sodass selbst kleine Joystick-Bewegungen den Motor aktivieren.
float apply_deadzone(float value) {
  if (fabs(value) < 0.05f) return 0.0f;  // Unter 5% → stopp
  float sign = (value > 0.0f) ? 1.0f : -1.0f;
  return sign * (0.15f + fabs(value) * 0.85f);
}

// Geschwindigkeit (-1.0 bis +1.0) → ESC PWM (1000-2000µs)
void set_esc(int pin_or_channel, float speed) {
  speed = constrain(speed, -1.0f, 1.0f);
  speed = apply_deadzone(speed);
  int pulse_us = 1500 + (int)(speed * 500.0f);
  ledcWrite(pin_or_channel, us_to_duty(pulse_us));
}

// cmd_vel Callback: Differential Drive Kinematik
void cmd_vel_callback(const void* msgin) {
  const geometry_msgs__msg__Twist* msg =
    (const geometry_msgs__msg__Twist*)msgin;

  float linear  = msg->linear.x;   // m/s vorwärts/rückwärts
  float angular = msg->angular.z;   // rad/s Drehung

  // Differential Drive: v_left = linear - angular * (track/2)
  //                     v_right = linear + angular * (track/2)
  float v_left  = linear - angular * (WHEEL_SEPARATION / 2.0f);
  float v_right = linear + angular * (WHEEL_SEPARATION / 2.0f);

  // Normalisieren auf -1.0 .. +1.0
  float scale_left  = v_left  / MAX_SPEED;
  float scale_right = v_right / MAX_SPEED;

  set_esc(ESC_LEFT, scale_left);
  set_esc(ESC_RIGHT, scale_right);

  last_cmd_time = millis();
  cmd_vel_count++;
}

bool create_microros_entities() {
  allocator = rcl_get_default_allocator();

  if (rclc_support_init(&support, 0, NULL, &allocator) != RCL_RET_OK)
    return false;
  if (rclc_node_init_default(&node, "mower_motor_controller", "", &support) != RCL_RET_OK)
    return false;
  if (rclc_subscription_init_default(&cmd_vel_sub, &node,
      ROSIDL_GET_MSG_TYPE_SUPPORT(geometry_msgs, msg, Twist), "cmd_vel") != RCL_RET_OK)
    return false;
  if (rclc_executor_init(&executor, &support.context, 1, &allocator) != RCL_RET_OK)
    return false;
  if (rclc_executor_add_subscription(&executor, &cmd_vel_sub,
      &cmd_vel_msg, &cmd_vel_callback, ON_NEW_DATA) != RCL_RET_OK)
    return false;

  return true;
}

void destroy_microros_entities() {
  rclc_executor_fini(&executor);
  rcl_ret_t rc;
  rc = rcl_subscription_fini(&cmd_vel_sub, &node);
  (void)rc;
  rc = rcl_node_fini(&node);
  (void)rc;
  rclc_support_fini(&support);
}

// LED blinken lassen mit variabler Geschwindigkeit
void blink_led(unsigned long interval_ms) {
  if (millis() - last_led_toggle >= interval_ms) {
    led_on = !led_on;
    digitalWrite(LED_PIN, led_on ? HIGH : LOW);
    last_led_toggle = millis();
  }
}

void setup() {
  // Debug-LED
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, HIGH);  // LED an beim Start

  Serial.begin(115200);

  // PWM für ESCs konfigurieren
  #if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcAttach(ESC_LEFT, PWM_FREQ, PWM_RESOLUTION);
  ledcAttach(ESC_RIGHT, PWM_FREQ, PWM_RESOLUTION);
  #else
  ledcSetup(0, PWM_FREQ, PWM_RESOLUTION);
  ledcSetup(1, PWM_FREQ, PWM_RESOLUTION);
  ledcAttachPin(ESC_LEFT_PIN, 0);
  ledcAttachPin(ESC_RIGHT_PIN, 1);
  #endif

  // ESCs auf Neutral (1500µs) — 3 Sekunden warten für ESC-Initialisierung
  set_esc(ESC_LEFT, 0.0f);
  set_esc(ESC_RIGHT, 0.0f);
  delay(3000);

  // ============================================================
  // DIAGNOSE: Kurzer Motor-Impuls um ESC+PWM Funktion zu testen
  // ENTFERNEN wenn Motoren funktionieren!
  // ============================================================
  // LED aus → Impuls startet
  digitalWrite(LED_PIN, LOW);
  delay(200);

  // 30% vorwärts für 500ms (muss über der ESC-Totzone von ~10-15% liegen)
  set_esc(ESC_LEFT, 0.3f);
  set_esc(ESC_RIGHT, 0.3f);
  digitalWrite(LED_PIN, HIGH);  // LED an während Impuls
  delay(500);

  // Stop
  set_esc(ESC_LEFT, 0.0f);
  set_esc(ESC_RIGHT, 0.0f);
  digitalWrite(LED_PIN, LOW);
  delay(500);

  // 3x schnelles LED-Blinken = Setup fertig
  for (int i = 0; i < 3; i++) {
    digitalWrite(LED_PIN, HIGH);
    delay(100);
    digitalWrite(LED_PIN, LOW);
    delay(100);
  }
  // ============================================================

  // micro-ROS Transport (Serial)
  set_microros_serial_transports(Serial);

  agent_state = WAITING_AGENT;
}

void loop() {
  switch (agent_state) {
    case WAITING_AGENT:
      // Langsames Blinken = Warte auf Agent
      blink_led(1000);

      // Warte bis micro-ROS Agent erreichbar ist
      if (rmw_uros_ping_agent(100, 1) == RMW_RET_OK) {
        agent_state = AGENT_AVAILABLE;
      }
      break;

    case AGENT_AVAILABLE:
      // Agent gefunden, Entities erstellen
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
      // LED blinkt IMMER im Connected-State (Beweis dass Loop läuft)
      // Geschwindigkeit zeigt Status an:
      //   500ms = verbunden, kein cmd_vel
      //   100ms = cmd_vel wird empfangen
      if (millis() - last_cmd_time <= CMD_TIMEOUT_MS) {
        blink_led(100);   // Schnell = empfängt cmd_vel
      } else {
        blink_led(500);   // Mittel = verbunden, idle
      }

      // Executor verarbeitet eingehende Nachrichten
      // 10ms Spin-Time damit der Loop schnell durchläuft
      rclc_executor_spin_some(&executor, RCL_MS_TO_NS(10));

      // Safety: Stoppe Motoren wenn kein cmd_vel seit CMD_TIMEOUT_MS
      if (millis() - last_cmd_time > CMD_TIMEOUT_MS) {
        set_esc(ESC_LEFT, 0.0f);
        set_esc(ESC_RIGHT, 0.0f);
      }
      break;
    }

    case AGENT_DISCONNECTED:
      // Motoren stoppen und aufräumen
      set_esc(ESC_LEFT, 0.0f);
      set_esc(ESC_RIGHT, 0.0f);
      destroy_microros_entities();
      agent_state = WAITING_AGENT;
      digitalWrite(LED_PIN, LOW);
      break;
  }
}
