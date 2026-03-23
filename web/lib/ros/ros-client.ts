"use client";

import * as ROSLIB from "roslib";

/**
 * Resolve a rosbridge URL. Supports:
 * - Full URLs: "ws://host:port" or "wss://host:port"
 * - Path-only: "/rosbridge" — resolved against the current page host
 */
function resolveUrl(url: string): string {
  if (url.startsWith("ws://") || url.startsWith("wss://")) {
    return url;
  }

  if (typeof window !== "undefined") {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}${url}`;
  }

  return `ws://localhost:3000${url}`;
}

const ROSBRIDGE_URL = resolveUrl(
  process.env.NEXT_PUBLIC_ROSBRIDGE_URL || "/rosbridge"
);

const MAX_RECONNECT_DELAY = 5000;
const INITIAL_RECONNECT_DELAY = 500;

type ConnectionCallback = (connected: boolean) => void;
type ErrorCallback = (error: string) => void;

interface KeyedCallback<T> {
  key: string | null;
  fn: T;
}

// ALL mutable state lives on window so it survives HMR module reloads.
// This includes the ROSLIB instance, connection state, AND listener arrays.
// The ROSLIB event handlers close over getState()/notifyConnection()/notifyError()
// which always read from window — so even after HMR, old event handlers
// still reach the current listeners.
interface PersistedRosState {
  rosInstance: ROSLIB.Ros | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  reconnectDelay: number;
  isConnecting: boolean;
  currentUrl: string;
  connectionId: number;
  connectionListeners: KeyedCallback<ConnectionCallback>[];
  errorListeners: KeyedCallback<ErrorCallback>[];
  beforeUnloadRegistered: boolean;
}

function getState(): PersistedRosState {
  if (typeof window === "undefined") {
    return {
      rosInstance: null,
      reconnectTimer: null,
      reconnectDelay: INITIAL_RECONNECT_DELAY,
      isConnecting: false,
      currentUrl: ROSBRIDGE_URL,
      connectionId: 0,
      connectionListeners: [],
      errorListeners: [],
      beforeUnloadRegistered: false,
    };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  if (!w.__mower_ros_state) {
    w.__mower_ros_state = {
      rosInstance: null,
      reconnectTimer: null,
      reconnectDelay: INITIAL_RECONNECT_DELAY,
      isConnecting: false,
      currentUrl: ROSBRIDGE_URL,
      connectionId: 0,
      connectionListeners: [],
      errorListeners: [],
      beforeUnloadRegistered: false,
    } satisfies PersistedRosState;
  }
  return w.__mower_ros_state as PersistedRosState;
}

function notifyConnection(connected: boolean) {
  // Always read from persisted state — survives HMR
  getState().connectionListeners.forEach((entry) => entry.fn(connected));
}

function notifyError(error: string) {
  getState().errorListeners.forEach((entry) => entry.fn(error));
}

export function onConnection(cb: ConnectionCallback, key?: string) {
  const s = getState();
  if (key) {
    const idx = s.connectionListeners.findIndex((e) => e.key === key);
    if (idx > -1) {
      s.connectionListeners[idx].fn = cb;
      return () => {
        const i = s.connectionListeners.findIndex((e) => e.key === key);
        if (i > -1) s.connectionListeners.splice(i, 1);
      };
    }
  }
  s.connectionListeners.push({ key: key ?? null, fn: cb });
  return () => {
    const idx = s.connectionListeners.findIndex((e) => e.fn === cb || (key && e.key === key));
    if (idx > -1) s.connectionListeners.splice(idx, 1);
  };
}

export function onError(cb: ErrorCallback, key?: string) {
  const s = getState();
  if (key) {
    const idx = s.errorListeners.findIndex((e) => e.key === key);
    if (idx > -1) {
      s.errorListeners[idx].fn = cb;
      return () => {
        const i = s.errorListeners.findIndex((e) => e.key === key);
        if (i > -1) s.errorListeners.splice(i, 1);
      };
    }
  }
  s.errorListeners.push({ key: key ?? null, fn: cb });
  return () => {
    const idx = s.errorListeners.findIndex((e) => e.fn === cb || (key && e.key === key));
    if (idx > -1) s.errorListeners.splice(idx, 1);
  };
}

function createRosInstance(myId: number): ROSLIB.Ros {
  const ros = new ROSLIB.Ros({});

  ros.on("connection", () => {
    const s = getState();
    if (myId !== s.connectionId) return;
    s.isConnecting = false;
    s.reconnectDelay = INITIAL_RECONNECT_DELAY;
    notifyConnection(true);
  });

  ros.on("error", (error: unknown) => {
    const s = getState();
    if (myId !== s.connectionId) return;
    s.isConnecting = false;
    const msg = error instanceof Error ? error.message : String(error);
    notifyError(msg || "Connection error");
  });

  ros.on("close", () => {
    const s = getState();
    if (myId !== s.connectionId) return;
    s.isConnecting = false;
    notifyConnection(false);
    scheduleReconnect();
  });

  return ros;
}

export function getRos(): ROSLIB.Ros {
  const s = getState();
  if (!s.rosInstance) {
    s.connectionId++;
    s.rosInstance = createRosInstance(s.connectionId);
  }
  return s.rosInstance;
}

function closeStaleInstance() {
  const s = getState();
  if (!s.rosInstance) return;
  if (s.rosInstance.isConnected) return;
  s.connectionId++;
  try {
    s.rosInstance.close();
  } catch {
    // ignore
  }
  s.rosInstance = null;
}

function forceCloseInstance() {
  const s = getState();
  if (!s.rosInstance) return;
  s.connectionId++;
  try {
    s.rosInstance.close();
  } catch {
    // ignore
  }
  s.rosInstance = null;
}

function doConnect() {
  const s = getState();
  if (s.rosInstance?.isConnected) return;
  if (s.isConnecting) return;

  closeStaleInstance();

  s.connectionId++;
  const myId = s.connectionId;
  s.rosInstance = createRosInstance(myId);
  s.isConnecting = true;

  try {
    s.rosInstance.connect(s.currentUrl);
  } catch {
    s.isConnecting = false;
    if (myId === s.connectionId) {
      scheduleReconnect();
    }
  }
}

export function connect(url?: string) {
  const s = getState();
  if (url) {
    s.currentUrl = resolveUrl(url);
  }

  if (s.reconnectTimer) {
    clearTimeout(s.reconnectTimer);
    s.reconnectTimer = null;
  }

  doConnect();
}

function scheduleReconnect() {
  const s = getState();
  if (s.reconnectTimer) return;
  if (s.rosInstance?.isConnected) return;
  if (s.isConnecting) return;

  s.reconnectTimer = setTimeout(() => {
    const s2 = getState();
    s2.reconnectTimer = null;
    doConnect();
    s2.reconnectDelay = Math.min(s2.reconnectDelay * 2, MAX_RECONNECT_DELAY);
  }, s.reconnectDelay);
}

export function retryNow() {
  const s = getState();
  if (s.reconnectTimer) {
    clearTimeout(s.reconnectTimer);
    s.reconnectTimer = null;
  }
  s.reconnectDelay = INITIAL_RECONNECT_DELAY;
  s.isConnecting = false;

  if (s.rosInstance?.isConnected) return;

  forceCloseInstance();
  doConnect();
}

export function disconnect() {
  const s = getState();
  if (s.reconnectTimer) {
    clearTimeout(s.reconnectTimer);
    s.reconnectTimer = null;
  }
  s.isConnecting = false;
  forceCloseInstance();
}

export function isConnected(): boolean {
  return getState().rosInstance?.isConnected ?? false;
}

// Safari beforeunload cleanup — registered once via persisted flag
if (typeof window !== "undefined") {
  const s = getState();
  if (!s.beforeUnloadRegistered) {
    s.beforeUnloadRegistered = true;
    window.addEventListener("beforeunload", () => {
      const st = getState();
      st.connectionId++;
      st.isConnecting = false;
      if (st.reconnectTimer) {
        clearTimeout(st.reconnectTimer);
        st.reconnectTimer = null;
      }
      if (st.rosInstance) {
        try {
          st.rosInstance.close();
        } catch {
          // ignore
        }
        st.rosInstance = null;
      }
    });
  }
}

export default getRos;
