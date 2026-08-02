"use client";

/** Keyboard state singleton (client-only). */
const keys = new Set<string>();
let interactTapQueued = false;
let jumpQueued = false;
let abilityQueued: number | null = null;
let emoteQueued: string | null = null;
let pingQueued = false;
let listenersAttached = false;

export function attachInput(): () => void {
  if (listenersAttached) return () => undefined;
  listenersAttached = true;
  const down = (e: KeyboardEvent) => {
    if (e.repeat) return;
    keys.add(e.code);
    if (e.code === "KeyE") interactTapQueued = true;
    if (e.code === "Space") {
      jumpQueued = true;
      e.preventDefault();
    }
    if (e.code === "Digit1") abilityQueued = 0;
    if (e.code === "Digit2") abilityQueued = 1;
    if (e.code === "Digit3") abilityQueued = 2;
    if (e.code === "KeyT") emoteQueued = "taunt";
    if (e.code === "KeyG") emoteQueued = "point";
    if (e.code === "KeyV") pingQueued = true;
  };
  const up = (e: KeyboardEvent) => keys.delete(e.code);
  const blur = () => keys.clear();
  window.addEventListener("keydown", down);
  window.addEventListener("keyup", up);
  window.addEventListener("blur", blur);
  return () => {
    listenersAttached = false;
    window.removeEventListener("keydown", down);
    window.removeEventListener("keyup", up);
    window.removeEventListener("blur", blur);
  };
}

export interface FrameInput {
  mx: number;
  mz: number;
  jump: boolean;
  hold: boolean;
  interactTap: boolean;
  ability: number | null;
  emote: string | null;
  ping: boolean;
}

/** Sample input for this frame. Move vector is camera-relative world space. */
export function sampleInput(yaw: number): FrameInput {
  let fwd = 0;
  let strafe = 0;
  if (keys.has("KeyW") || keys.has("ArrowUp")) fwd += 1;
  if (keys.has("KeyS") || keys.has("ArrowDown")) fwd -= 1;
  if (keys.has("KeyD") || keys.has("ArrowRight")) strafe += 1;
  if (keys.has("KeyA") || keys.has("ArrowLeft")) strafe -= 1;
  // forward = (sin yaw, cos yaw); screen-right = (-cos yaw, sin yaw)
  // (three.js camera looking along +forward puts world -x on screen right at yaw 0)
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  let mx = sin * fwd - cos * strafe;
  let mz = cos * fwd + sin * strafe;
  const mag = Math.hypot(mx, mz);
  if (mag > 1) {
    mx /= mag;
    mz /= mag;
  }
  const out: FrameInput = {
    mx,
    mz,
    jump: jumpQueued,
    hold: keys.has("KeyE"),
    interactTap: interactTapQueued,
    ability: abilityQueued,
    emote: emoteQueued,
    ping: pingQueued,
  };
  jumpQueued = false;
  interactTapQueued = false;
  abilityQueued = null;
  emoteQueued = null;
  pingQueued = false;
  return out;
}
