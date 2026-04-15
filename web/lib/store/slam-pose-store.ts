"use client";

import { create } from "zustand";
import type { PoseWithCovarianceStamped } from "@/lib/types/ros-messages";
import { quaternionToEuler } from "@/lib/utils/quaternion";

/**
 * YAW_COV_DEGRADED_THRESHOLD — covariance[35] (yaw-yaw variance, rad²) above which
 * the heading-confidence badge flips to "SLAM stale" yellow even when /pose is
 * still publishing freshly. Per CONTEXT.md D-11 the badge must consider both
 * freshness AND covariance-trace degradation.
 *
 * Calibration (Wave 0/1 handoff — see 07-01-SUMMARY.md + 07-02-SUMMARY.md):
 *   - Wave 0 could not capture native_yaw_cov while stationary because slam_toolbox
 *     only publishes /pose on successful scan-matches (requires motion ≥ 0.1 m /
 *     0.1 rad). The covariance is therefore only observable in motion.
 *   - Wave 1 shipped with yaw_covariance_scale: 1.0 (neutral) in
 *     config/slam_toolbox_params.yaml — EKF sees the native slam_toolbox covariance
 *     unscaled. Target effective yaw variance per D-05 is ~0.05 rad² (≈13° std dev).
 *   - Threshold = 2 × target = 0.10 rad² (≈18° std dev). A healthy scan-match
 *     typically publishes well below 0.05; crossing 0.10 means slam_toolbox is
 *     uncertain enough that the operator should treat the fused yaw with suspicion.
 *   - Re-tune this if Wave 1 FUSE-02 outdoor drift run results in a
 *     yaw_covariance_scale other than 1.0 — keep this value at 2× the effective
 *     target variance.
 */
export const YAW_COV_DEGRADED_THRESHOLD = 0.1;

interface SlamPoseState {
  x: number | null;
  y: number | null;
  yaw: number | null;           // degrees (quaternionToEuler returns degrees)
  yawCovariance: number;        // rad²; -1 sentinel when missing/invalid
  lastUpdate: number;           // 0 initial; Date.now() on every updatePose

  updatePose: (msg: PoseWithCovarianceStamped) => void;
}

export const useSlamPoseStore = create<SlamPoseState>((set) => ({
  x: null,
  y: null,
  yaw: null,
  yawCovariance: -1,
  lastUpdate: 0,

  updatePose: (msg: PoseWithCovarianceStamped) => {
    const pos = msg.pose.pose.position;
    const ori = msg.pose.pose.orientation;
    const euler = quaternionToEuler(ori);

    // covariance[35] is the yaw-yaw variance entry (6x6 row-major, index 5*6+5=35).
    // Defensive check mirrors gps-store.ts accuracy derivation — uninitialized
    // covariance fields appear as 0, NaN, or missing depending on publisher.
    // scrubNaN (subscribers.ts) converts NaN → null before this runs, hence the
    // `cov != null` guard covers the nulled-NaN case.
    const cov = msg.pose.covariance?.[35];
    const yawCovariance =
      cov != null && isFinite(cov) && cov > 0 ? cov : -1;

    set({
      x: pos.x,
      y: pos.y,
      yaw: euler.yaw,
      yawCovariance,
      lastUpdate: Date.now(),
    });
  },
}));
