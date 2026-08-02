/** Core shared types for CubeScape. Zero rendering/network imports. */

export const FACES = ["N", "E", "S", "W", "U", "D"] as const;
export type Face = (typeof FACES)[number];
export const FACE_INDEX: Record<Face, number> = { N: 0, E: 1, S: 2, W: 3, U: 4, D: 5 };

/** Direction each face points in cube-lattice space. N = -z, E = +x, S = +z, W = -x, U = +y, D = -y */
export const FACE_DELTA: Record<Face, { dx: number; dy: number; dz: number }> = {
  N: { dx: 0, dy: 0, dz: -1 },
  E: { dx: 1, dy: 0, dz: 0 },
  S: { dx: 0, dy: 0, dz: 1 },
  W: { dx: -1, dy: 0, dz: 0 },
  U: { dx: 0, dy: 1, dz: 0 },
  D: { dx: 0, dy: -1, dz: 0 },
};

export const OPPOSITE_FACE: Record<Face, Face> = {
  N: "S",
  S: "N",
  E: "W",
  W: "E",
  U: "D",
  D: "U",
};

export interface CubeCoord {
  cx: number;
  cy: number;
  cz: number;
}

export type CoordId = string; // "cx,cy,cz"

export function coordId(c: CubeCoord): CoordId {
  return `${c.cx},${c.cy},${c.cz}`;
}

export function parseCoordId(id: CoordId): CubeCoord {
  const parts = id.split(",").map(Number);
  return { cx: parts[0] ?? 0, cy: parts[1] ?? 0, cz: parts[2] ?? 0 };
}

export function neighborCoord(c: CubeCoord, face: Face): CubeCoord {
  const d = FACE_DELTA[face];
  return { cx: c.cx + d.dx, cy: c.cy + d.dy, cz: c.cz + d.dz };
}

export function inCube(c: CubeCoord, size: number): boolean {
  return (
    c.cx >= 0 && c.cx < size && c.cy >= 0 && c.cy < size && c.cz >= 0 && c.cz < size
  );
}

export type StatName = "might" | "wits";

export type GateTypeName =
  | "open"
  | "key"
  | "plates"
  | "stat"
  | "objective"
  | "lift"
  | "oneway";

/** A concrete gate placed on an edge by the generator. */
export type Gate =
  | { type: "open" }
  | { type: "key"; color: string }
  | { type: "plates"; count: number }
  | { type: "stat"; stat: StatName; threshold: number }
  | { type: "objective" } // cleared flag of the room that owns this door
  | { type: "lift" }
  | { type: "oneway" };

export type CharId = "brute" | "scout" | "tinker";

export interface CharacterDef {
  id: CharId;
  name: string;
  hp: number;
  speedMult: number;
  might: number;
  wits: number;
  /** ability slot order: [traversal, utility, combat] */
  abilities: [AbilityId, AbilityId, AbilityId];
  color: string; // player tint
}

export type AbilityId =
  | "breach"
  | "holdfast"
  | "swing"
  | "grapple"
  | "peek"
  | "dart"
  | "bypass"
  | "fieldkit"
  | "turret"
  | "punch";

export interface AbilityDef {
  id: AbilityId;
  name: string;
  cooldown: number; // seconds
  range: number; // meters, 0 = self
  description: string;
}

/** Minimal player view used by pure rules (no schema classes). */
export interface RulePlayer {
  id: string;
  charId: CharId;
  x: number;
  z: number;
  might: number;
  wits: number;
  keys: readonly string[];
  grappleActiveUntil: number; // server tick until which grapple is active
  downed: boolean;
}

export interface DoorInfo {
  face: Face;
  gate: Gate;
  open: boolean;
  /** wall cell [x,z] for NESW; hatch cell for U/D */
  cell: [number, number];
}

/** Capabilities used by the solver to reason about passability. */
export interface SolverCaps {
  might: number; // best achievable stat sum in party for stat gates
  wits: number;
  players: number; // party size (plates)
  hasBrute: boolean;
  hasScout: boolean;
  hasTinker: boolean;
}

export interface MatchStats {
  roomsVisited: number;
  objectivesCleared: number;
  mobKills: number;
  deaths: number;
  reachedExit: boolean;
  hazardRoomsClearedNoDeath: number;
  finishedAlive: boolean;
}
