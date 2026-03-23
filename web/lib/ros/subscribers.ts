"use client";

import * as ROSLIB from "roslib";
import { getRos } from "./ros-client";
import { TOPICS } from "./topics";

type MessageHandler<T = unknown> = (message: T) => void;

interface ThrottledSubscriber {
  topic: ROSLIB.Topic;
  unsubscribe: () => void;
}

/**
 * Create a throttled subscriber for a ROS topic.
 * Throttle limits how often the callback is invoked.
 */
export function subscribe<T = unknown>(
  topicKey: keyof typeof TOPICS,
  callback: MessageHandler<T>
): ThrottledSubscriber {
  const topicDef = TOPICS[topicKey];
  const ros = getRos();

  const topic = new ROSLIB.Topic({
    ros,
    name: topicDef.name,
    messageType: topicDef.messageType,
  });

  let lastCall = 0;
  const throttleMs = "throttleMs" in topicDef ? topicDef.throttleMs : 0;

  const handler = (message: unknown) => {
    if (throttleMs > 0) {
      const now = Date.now();
      if (now - lastCall < throttleMs) return;
      lastCall = now;
    }
    callback(message as unknown as T);
  };

  topic.subscribe(handler);

  return {
    topic,
    unsubscribe: () => {
      topic.unsubscribe(handler);
    },
  };
}
