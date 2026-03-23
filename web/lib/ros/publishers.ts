"use client";

import * as ROSLIB from "roslib";
import { getRos } from "./ros-client";
import { TOPICS } from "./topics";
import type { MowerCommand } from "@/lib/types/ros-messages";

let cmdVelTopic: ROSLIB.Topic | null = null;
let cmdVelInterval: ReturnType<typeof setInterval> | null = null;
let currentLinear = 0;
let currentAngular = 0;

function getCmdVelTopic(): ROSLIB.Topic {
  if (!cmdVelTopic) {
    cmdVelTopic = new ROSLIB.Topic({
      ros: getRos(),
      name: TOPICS.CMD_VEL.name,
      messageType: TOPICS.CMD_VEL.messageType,
    });
  }
  return cmdVelTopic;
}

/**
 * Publish a single cmd_vel message
 */
export function publishCmdVel(linearX: number, angularZ: number) {
  const topic = getCmdVelTopic();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  topic.publish({
    linear: { x: linearX, y: 0, z: 0 },
    angular: { x: 0, y: 0, z: angularZ },
  } as any);
}

/**
 * Start continuous cmd_vel publishing at 10 Hz
 */
export function startCmdVelPublishing() {
  if (cmdVelInterval) return;
  cmdVelInterval = setInterval(() => {
    publishCmdVel(currentLinear, currentAngular);
  }, 100); // 10 Hz
}

/**
 * Stop continuous cmd_vel publishing
 */
export function stopCmdVelPublishing() {
  if (cmdVelInterval) {
    clearInterval(cmdVelInterval);
    cmdVelInterval = null;
  }
  // Send stop command
  publishCmdVel(0, 0);
  currentLinear = 0;
  currentAngular = 0;
}

/**
 * Update the velocity values (will be published at next 10Hz tick)
 */
export function updateVelocity(linearX: number, angularZ: number) {
  currentLinear = linearX;
  currentAngular = angularZ;
}

/**
 * Emergency stop - immediately publish zero velocity
 */
export function emergencyStop() {
  currentLinear = 0;
  currentAngular = 0;
  stopCmdVelPublishing();
  // Send multiple stop commands to ensure delivery
  publishCmdVel(0, 0);
  publishCmdVel(0, 0);

  // Also send emergency stop command
  publishMowerCommand({ action: "emergency_stop" });
}

/**
 * Publish a mower command
 */
export function publishMowerCommand(command: MowerCommand) {
  const topic = new ROSLIB.Topic({
    ros: getRos(),
    name: TOPICS.MOWER_COMMAND.name,
    messageType: TOPICS.MOWER_COMMAND.messageType,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  topic.publish({
    data: JSON.stringify(command),
  } as any);
}
