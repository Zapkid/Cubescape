import type { Face } from "../types.js";

/** Everything abilities, room logic and mobs can do to the world.
 *  Pure modules RETURN effects; only the server sim APPLIES them. */
export type Effect =
  | { type: "damagePlayer"; playerId: string; amount: number; cause: string }
  | { type: "healPlayer"; playerId: string; amount: number }
  | {
      type: "damageMob";
      mobId: string;
      amount: number;
      slowMult?: number;
      slowSeconds?: number;
      staggerSeconds?: number;
    }
  | { type: "openDoorFace"; face: Face }
  | { type: "setWalkable"; cells: readonly string[]; on: boolean }
  | { type: "clearObjective" }
  | { type: "spawnTriggeredMobs" }
  | { type: "revealAdjacent"; byPlayerId: string }
  | { type: "breachFloor"; cell: readonly [number, number] }
  | { type: "placeHoldfast"; x: number; z: number; untilTick: number }
  | { type: "placeFieldkit"; x: number; z: number; untilTick: number }
  | { type: "deployTurret"; x: number; z: number; untilTick: number }
  | { type: "setGrapple"; playerId: string; untilTick: number }
  | { type: "message"; text: string };
