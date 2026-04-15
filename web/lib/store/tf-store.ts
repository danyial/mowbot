"use client";

import { create } from "zustand";
import type { Quaternion, Vector3 } from "@/lib/types/ros-messages";

// ─────────────────────────────────────────────────────────────────────────────
// TF store — Quick 260415-tf-align
//
// Purpose: cache TransformStamped messages from /tf and /tf_static, and
// expose a composed `map → base_link` yaw (radians) so the /lidar scan
// overlay can rotate its polar points into the slam_toolbox map frame.
//
// Without this, the standalone scan is rendered using raw beam angles (yaw=0
// assumption in map frame), which disagrees with slam_toolbox's scan-matched
// pose estimate AND the EKF-driven odom→base_link yaw. Three different yaws
// → scan visibly offset (~85 px centroid error on a ~600 px canvas).
//
// Composition: we compose map→odom (published by slam_toolbox) with
// odom→base_link (published by robot_localization EKF) to get map→base_link.
// 2D yaw-only math: extract yaw from each quaternion, sum modulo 2π. Pitch
// and roll are ignored (the mower doesn't pitch/roll meaningfully).
//
// Staleness: each entry is timestamped on receipt. `mapToBaseLinkYaw` returns
// null if either leg is missing OR older than TF_STALE_MS. Consumers fall
// back to IMU yaw in that case (see scan-canvas.tsx).
// ─────────────────────────────────────────────────────────────────────────────

// tf2_msgs/TFMessage carries an array of these.
export interface TransformStamped {
  header: { stamp: { sec: number; nanosec: number }; frame_id: string };
  child_frame_id: string;
  transform: {
    translation: Vector3;
    rotation: Quaternion;
  };
}

export interface TFMessage {
  transforms: TransformStamped[];
}

// Entries older than this are treated as missing. 1500 ms matches the scan
// stale threshold — if TF hasn't ticked in that long, something upstream is
// broken and falling back to IMU yaw is the safer default.
const TF_STALE_MS = 1500;

interface CachedTransform {
  yaw: number; // radians, CCW-positive around Z
  receivedAt: number; // Date.now()
}

interface TfState {
  // Key: "parent/child". e.g. "map/odom", "odom/base_link".
  cache: Map<string, CachedTransform>;
  // Monotonically bumped whenever the cache is mutated, so selectors that
  // derive composed values can re-run. Map identity alone doesn't trigger
  // re-renders in Zustand when we mutate in place.
  tick: number;

  applyTf: (msg: TFMessage) => void;
  /**
   * Composed map→base_link yaw (radians). Returns null if either
   * map→odom or odom→base_link is missing or stale. Consumers should
   * fall back to a different yaw source (e.g. IMU) when null.
   */
  mapToBaseLinkYaw: () => number | null;
}

/** Extract 2D yaw (rad, CCW) from a quaternion. Pitch/roll ignored. */
function yawFromQuaternion(q: Quaternion): number {
  return Math.atan2(
    2 * (q.w * q.z + q.x * q.y),
    1 - 2 * (q.y * q.y + q.z * q.z)
  );
}

export const useTfStore = create<TfState>((set, get) => ({
  cache: new Map(),
  tick: 0,

  applyTf: (msg: TFMessage) => {
    if (!msg || !Array.isArray(msg.transforms) || msg.transforms.length === 0) {
      return;
    }
    const cache = get().cache;
    const now = Date.now();
    let changed = false;
    for (const t of msg.transforms) {
      // Normalize frame names — slam_toolbox/EKF may publish with a leading
      // "/" on some configurations. Strip it so lookups stay consistent.
      const parent = (t.header?.frame_id || "").replace(/^\//, "");
      const child = (t.child_frame_id || "").replace(/^\//, "");
      if (!parent || !child) continue;
      const key = `${parent}/${child}`;
      const yaw = yawFromQuaternion(t.transform.rotation);
      if (!Number.isFinite(yaw)) continue;
      cache.set(key, { yaw, receivedAt: now });
      changed = true;
    }
    if (changed) {
      set({ tick: get().tick + 1 });
    }
  },

  mapToBaseLinkYaw: () => {
    const cache = get().cache;
    const now = Date.now();
    const mapOdom = cache.get("map/odom");
    const odomBase = cache.get("odom/base_link");
    if (!mapOdom || !odomBase) return null;
    if (now - mapOdom.receivedAt > TF_STALE_MS) return null;
    if (now - odomBase.receivedAt > TF_STALE_MS) return null;
    // Sum yaws, wrap to [-π, π].
    let sum = mapOdom.yaw + odomBase.yaw;
    sum = ((sum + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    return sum;
  },
}));
