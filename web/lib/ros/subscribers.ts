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
 * Recursively replace IEEE-754 NaN numbers with null in a decoded ROS message.
 *
 * Why this exists:
 *   - Under CBOR (binary) frames, `server.mjs`'s text-frame NaN→null sanitizer is
 *     bypassed. IEEE-754 NaN floats flow through CBOR decode unchanged and land in
 *     roslib as JS `NaN`, which breaks downstream consumers (Leaflet, covariance
 *     math, etc.). See 03-01 regression: `/fix` with status=-1 yields NaN lat/lon,
 *     crashing Leaflet with "Invalid LatLng object: (NaN, NaN)".
 *   - Applying the scrubber here — once, generically — makes CBOR behave identically
 *     to the legacy JSON-via-`server.mjs` path for every topic.
 *
 * Typed-array exception:
 *   - `sensor_msgs/LaserScan.ranges` arrives as Float32Array under CBOR. LaserScan
 *     semantics define NaN as "no return at this angle" — it must be preserved.
 *   - More broadly, scanning hundreds of floats per message for NaN is wasteful.
 *   - We short-circuit on `ArrayBuffer.isView(v)` and raw ArrayBuffers, returning
 *     them unchanged.
 *
 * Perf: O(n) over the already-decoded JS object graph. Negligible next to CBOR
 * decode itself for typical sensor messages (NavSatFix, Imu, Odometry are small).
 */
function scrubNaN<T>(value: T): T {
  if (value === null || value === undefined) return value;

  if (typeof value === "number") {
    return (Number.isNaN(value) ? null : value) as T;
  }

  if (typeof value !== "object") return value;

  // Preserve typed arrays (Float32Array, Float64Array, etc.) and raw buffers.
  // These are used by topics like /scan where NaN carries semantic meaning,
  // and scrubbing them would also be a significant perf cost.
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    return value;
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const v = value[i];
      if (typeof v === "number") {
        if (Number.isNaN(v)) value[i] = null;
      } else if (v !== null && typeof v === "object") {
        scrubNaN(v);
      }
    }
    return value;
  }

  // Plain object: mutate in place to avoid allocating a new object per message.
  const obj = value as Record<string, unknown>;
  for (const key in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
    const v = obj[key];
    if (typeof v === "number") {
      if (Number.isNaN(v)) obj[key] = null;
    } else if (v !== null && typeof v === "object") {
      scrubNaN(v);
    }
  }
  return value;
}

/**
 * Create a throttled subscriber for a ROS topic.
 *
 * Two layers of rate limiting (per RESEARCH P3):
 *   - `throttle_rate` (ms, server-side): passed into ROSLIB.Topic — rosbridge decimates before send.
 *   - `throttleMs` (client-side): limits how often the user callback is invoked.
 *
 * Compression: per-topic `compression: "cbor"` on TOPICS entry flips rosbridge to binary CBOR frames.
 *
 * NaN hardening: every decoded message is run through `scrubNaN` before the
 * callback. This guards consumers against CBOR-path NaN that `server.mjs` cannot
 * sanitize (binary frames bypass the text regex). Typed arrays are skipped so
 * LaserScan "no return" semantics are preserved.
 */
export function subscribe<T = unknown>(
  topicKey: keyof typeof TOPICS,
  callback: MessageHandler<T>
): ThrottledSubscriber {
  const topicDef = TOPICS[topicKey] as Record<string, unknown> & {
    name: string;
    messageType: string;
  };
  const ros = getRos();

  // Source: http://robotwebtools.org/jsdoc/roslibjs/current/Topic.html
  const topic = new ROSLIB.Topic({
    ros,
    name: topicDef.name,
    messageType: topicDef.messageType,
    ...("compression" in topicDef
      ? { compression: topicDef.compression as string }
      : {}),
    ...("throttle_rate" in topicDef
      ? { throttle_rate: topicDef.throttle_rate as number }
      : {}),
    ...("queue_length" in topicDef
      ? { queue_length: topicDef.queue_length as number }
      : {}),
  });

  let lastCall = 0;
  const throttleMs =
    typeof topicDef.throttleMs === "number" ? topicDef.throttleMs : 0;

  const handler = (message: unknown) => {
    if (throttleMs > 0) {
      const now = Date.now();
      if (now - lastCall < throttleMs) return;
      lastCall = now;
    }
    const scrubbed = scrubNaN(message);
    callback(scrubbed as T);
  };

  topic.subscribe(handler);

  return {
    topic,
    unsubscribe: () => {
      topic.unsubscribe(handler);
    },
  };
}
