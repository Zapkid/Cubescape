import {
  PLAYER_RADIUS,
  PLAYER_BASE_SPEED,
  PLAYER_JUMP_VEL,
  GRAVITY,
  ROOM_W,
  ROOM_D,
  GRAPPLE_SPEED_MULT,
} from "../constants.js";
import type { Face } from "../types.js";
import type { TileType } from "../templates/schema.js";

/** Static solid props (block movement). Crates/barrels are dynamic circles now. */
export const SOLID_PROP_TYPES: ReadonlySet<string> = new Set([
  "pillar",
  "key_pedestal",
  "vent_terminal",
  "exit_terminal",
  "beacon",
  "lever",
]);

export interface CircleObstacle {
  id: string;
  x: number;
  z: number;
  radius: number;
}

/**
 * Push a circle (player/prop) out of overlapping circle obstacles.
 * Pure & shared: client prediction and server authority resolve identically.
 * Returns the resolved position plus per-obstacle push vectors (how hard the
 * mover pressed into each) so the server can shove crates around.
 */
export function collideCircleObstacles(
  x: number,
  z: number,
  radius: number,
  obstacles: readonly CircleObstacle[],
): {
  x: number;
  z: number;
  pushes: { id: string; dx: number; dz: number }[];
} {
  let px = x;
  let pz = z;
  const pushes: { id: string; dx: number; dz: number }[] = [];
  for (const o of obstacles) {
    const dx = px - o.x;
    const dz = pz - o.z;
    const dist = Math.hypot(dx, dz);
    const minDist = radius + o.radius;
    if (dist >= minDist) continue;
    if (dist < 0.0001) {
      // dead-center overlap: eject deterministically along +x
      px = o.x + minDist;
      pushes.push({ id: o.id, dx: -minDist, dz: 0 });
      continue;
    }
    const overlap = minDist - dist;
    const nx = dx / dist;
    const nz = dz / dist;
    // mover keeps most of the overlap; the rest is available as push force
    px = o.x + nx * minDist;
    pz = o.z + nz * minDist;
    pushes.push({ id: o.id, dx: -nx * overlap, dz: -nz * overlap });
  }
  return { x: px, z: pz, pushes };
}

export interface MoveContext {
  /** [z][x] tile grid */
  tiles: TileType[][];
  /** "x,z" cells occupied by solid props */
  solidProps: ReadonlySet<string>;
  /** pit/void cells that are currently walkable (extended bridges, breached floors stay pits) */
  walkableOverrides: ReadonlySet<string>;
  /** open NESW doors: face -> wall cell */
  openDoors: Partial<Record<Face, readonly [number, number]>>;
  /** grapple active: pits don't block */
  ignorePits: boolean;
}

export interface SimPlayerState {
  x: number;
  y: number;
  z: number;
  vy: number;
}

export interface InputStep {
  seq: number;
  /** world-space move vector, server clamps |v| <= 1 */
  mx: number;
  mz: number;
  yaw: number;
  jump: boolean;
}

export function cellKey(x: number, z: number): string {
  return `${x},${z}`;
}

export function isSolidCell(ctx: MoveContext, tx: number, tz: number): boolean {
  if (tx < 0 || tx >= ROOM_W || tz < 0 || tz >= ROOM_D) return true; // walls
  if (ctx.solidProps.has(cellKey(tx, tz))) return true;
  const tile = ctx.tiles[tz]![tx]!;
  if (tile === "pit" || tile === "void") {
    if (ctx.walkableOverrides.has(cellKey(tx, tz))) return false;
    return !ctx.ignorePits;
  }
  return false;
}

/**
 * Move a circle through the tile grid, axis-separated with AABB pushout.
 * Returns the resolved position. Pure; used for players AND mobs on both sides.
 */
export function resolveMove(
  x: number,
  z: number,
  dx: number,
  dz: number,
  radius: number,
  solid: (tx: number, tz: number) => boolean,
): { x: number; z: number } {
  let nx = x + dx;
  // clamp to outer walls
  nx = Math.min(Math.max(nx, radius), ROOM_W - radius);
  for (
    let tz = Math.floor(z - radius);
    tz <= Math.floor(z + radius);
    tz++
  ) {
    for (
      let tx = Math.floor(nx - radius);
      tx <= Math.floor(nx + radius);
      tx++
    ) {
      if (!solid(tx, tz)) continue;
      if (!circleIntersectsCell(nx, z, radius, tx, tz)) continue;
      if (dx > 0) nx = Math.min(nx, tx - radius);
      else if (dx < 0) nx = Math.max(nx, tx + 1 + radius);
    }
  }
  let nz = z + dz;
  nz = Math.min(Math.max(nz, radius), ROOM_D - radius);
  for (
    let tz = Math.floor(nz - radius);
    tz <= Math.floor(nz + radius);
    tz++
  ) {
    for (
      let tx = Math.floor(nx - radius);
      tx <= Math.floor(nx + radius);
      tx++
    ) {
      if (!solid(tx, tz)) continue;
      if (!circleIntersectsCell(nx, nz, radius, tx, tz)) continue;
      if (dz > 0) nz = Math.min(nz, tz - radius);
      else if (dz < 0) nz = Math.max(nz, tz + 1 + radius);
    }
  }
  return { x: nx, z: nz };
}

function circleIntersectsCell(
  cx: number,
  cz: number,
  r: number,
  tx: number,
  tz: number,
): boolean {
  const nearX = Math.min(Math.max(cx, tx), tx + 1);
  const nearZ = Math.min(Math.max(cz, tz), tz + 1);
  const dx = cx - nearX;
  const dz = cz - nearZ;
  return dx * dx + dz * dz < r * r;
}

export interface StepResult {
  state: SimPlayerState;
  /** set when the player pushed through an open door on a NESW face */
  exitFace?: Face;
}

/**
 * Advance one simulation step. THE collision truth: identical on client
 * (prediction) and server (authority). Deterministic for identical inputs.
 */
export function stepPlayer(
  prev: SimPlayerState,
  input: InputStep,
  dt: number,
  ctx: MoveContext,
  speedMult: number,
  slowMult = 1,
): StepResult {
  // clamp move vector to unit length — the anti-speed-hack invariant
  let mx = input.mx;
  let mz = input.mz;
  const mag = Math.hypot(mx, mz);
  if (mag > 1) {
    mx /= mag;
    mz /= mag;
  }
  const grappling = ctx.ignorePits;
  const speed =
    PLAYER_BASE_SPEED * speedMult * slowMult * (grappling ? GRAPPLE_SPEED_MULT : 1);
  const dx = mx * speed * dt;
  const dz = mz * speed * dt;

  const solid = (tx: number, tz: number) => isSolidCell(ctx, tx, tz);
  const moved = resolveMove(prev.x, prev.z, dx, dz, PLAYER_RADIUS, solid);

  // vertical: cosmetic hop (ground plane is y=0 everywhere; pits block horizontally)
  let vy = prev.vy;
  let y = prev.y;
  if (input.jump && y === 0) vy = PLAYER_JUMP_VEL;
  vy -= GRAVITY * dt;
  y += vy * dt;
  if (y <= 0) {
    y = 0;
    vy = 0;
  }

  const state: SimPlayerState = { x: moved.x, y, z: moved.z, vy };
  const exitFace = detectDoorExit(state, mx, mz, ctx);
  return exitFace ? { state, exitFace } : { state };
}

const EXIT_PROXIMITY = PLAYER_RADIUS + 0.18;
const EXIT_PUSH = 0.25; // how hard you must push into the door

function detectDoorExit(
  s: SimPlayerState,
  mx: number,
  mz: number,
  ctx: MoveContext,
): Face | undefined {
  const north = ctx.openDoors.N;
  if (north && mz < -EXIT_PUSH && s.z <= EXIT_PROXIMITY) {
    if (s.x >= north[0] && s.x <= north[0] + 1) return "N";
  }
  const south = ctx.openDoors.S;
  if (south && mz > EXIT_PUSH && s.z >= ROOM_D - EXIT_PROXIMITY) {
    if (s.x >= south[0] && s.x <= south[0] + 1) return "S";
  }
  const east = ctx.openDoors.E;
  if (east && mx > EXIT_PUSH && s.x >= ROOM_W - EXIT_PROXIMITY) {
    if (s.z >= east[1] && s.z <= east[1] + 1) return "E";
  }
  const west = ctx.openDoors.W;
  if (west && mx < -EXIT_PUSH && s.x <= EXIT_PROXIMITY) {
    if (s.z >= west[1] && s.z <= west[1] + 1) return "W";
  }
  return undefined;
}

/**
 * Where a player appears when entering a room THROUGH the given face's door.
 * (You exited the previous room heading N ⇒ you arrive at the new room's S door.)
 * Returns position + facing yaw (forward = (sin yaw, cos yaw)).
 */
export function doorSlotToSpawnPosition(
  face: Face,
  cell: readonly [number, number],
): { x: number; z: number; yaw: number } {
  const inset = 0.85;
  switch (face) {
    case "N":
      return { x: cell[0] + 0.5, z: inset, yaw: 0 }; // facing +z (into room)
    case "S":
      return { x: cell[0] + 0.5, z: ROOM_D - inset, yaw: Math.PI };
    case "E":
      return { x: ROOM_W - inset, z: cell[1] + 0.5, yaw: -Math.PI / 2 };
    case "W":
      return { x: inset, z: cell[1] + 0.5, yaw: Math.PI / 2 };
    case "U":
    case "D":
      return { x: cell[0] + 0.5, z: cell[1] + 0.5, yaw: 0 };
  }
}
