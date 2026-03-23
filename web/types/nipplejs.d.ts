declare module "nipplejs" {
  interface JoystickManagerOptions {
    zone: HTMLElement;
    mode?: "static" | "semi" | "dynamic";
    position?: { left?: string; top?: string; right?: string; bottom?: string };
    color?: string;
    size?: number;
    threshold?: number;
    fadeTime?: number;
    multitouch?: boolean;
    maxNumberOfNipples?: number;
    dataOnly?: boolean;
    restJoystick?: boolean | { size?: number; stroke?: string; fill?: string };
    restOpacity?: number;
    lockX?: boolean;
    lockY?: boolean;
    catchDistance?: number;
    shape?: "circle" | "square";
    dynamicPage?: boolean;
    follow?: boolean;
  }

  interface JoystickOutputData {
    identifier: number;
    position: { x: number; y: number };
    force: number;
    pressure: number;
    distance: number;
    angle: {
      radian: number;
      degree: number;
    };
    direction?: {
      x: "left" | "right";
      y: "up" | "down";
      angle: "up" | "down" | "left" | "right";
    };
    vector: { x: number; y: number };
    raw: { distance: number; position: { x: number; y: number } };
    instance: JoystickInstance;
  }

  interface JoystickInstance {
    el: HTMLElement;
    id: number;
    identifier: number;
    position: { x: number; y: number };
    frontPosition: { x: number; y: number };
    ui: {
      el: HTMLElement;
      front: HTMLElement;
      back: HTMLElement;
    };
    options: JoystickManagerOptions;
    destroy: () => void;
    on: (event: string, handler: (evt: Event, data: JoystickOutputData) => void) => void;
    off: (event: string, handler?: (evt: Event, data: JoystickOutputData) => void) => void;
  }

  interface JoystickManager {
    on: (
      event: "start" | "end" | "move" | "dir:up" | "dir:down" | "dir:left" | "dir:right" | "plain:up" | "plain:down" | "plain:left" | "plain:right" | "shown" | "hidden" | "pressure",
      handler: (evt: Event, data: JoystickOutputData) => void
    ) => void;
    off: (event: string, handler?: Function) => void;
    destroy: () => void;
    get: (id: number) => JoystickInstance;
    ids: number[];
    id: number;
    options: JoystickManagerOptions;
  }

  function create(options: JoystickManagerOptions): JoystickManager;
  export default { create };
  export { create, JoystickManager, JoystickManagerOptions, JoystickOutputData, JoystickInstance };
}
