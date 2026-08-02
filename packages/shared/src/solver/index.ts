import { gatePassableForCaps } from "../rules/doors.js";
import type { CoordId, SolverCaps } from "../types.js";

/** Structural subset of CubeSpec the solver needs (avoids an import cycle). */
export interface SolvableCube {
  spawn: CoordId;
  exit: CoordId;
  rooms: Record<
    CoordId,
    {
      templateId: string;
      keyColor?: string;
      doors: {
        face: string;
        gate: import("../types.js").Gate;
        ownerCoord?: CoordId;
      }[];
    }
  >;
}

export interface SolveResult {
  solvable: boolean;
  /** shortest room path spawn→exit in the fully-unlocked reachable graph */
  path: CoordId[];
  /** rooms never reachable with the given caps */
  unreachable: CoordId[];
  /** order in which rooms first became reachable (bot itinerary) */
  discoveryOrder: CoordId[];
}

import { FACE_DELTA, OPPOSITE_FACE, coordId, parseCoordId } from "../types.js";
import type { Face } from "../types.js";

function neighborOf(id: CoordId, face: Face): CoordId {
  const c = parseCoordId(id);
  const d = FACE_DELTA[face];
  return coordId({ cx: c.cx + d.dx, cy: c.cy + d.dy, cz: c.cz + d.dz });
}

/**
 * BFS-to-fixpoint over the gate graph simulating inventory:
 * keys are collected from every reachable room, objectives count as
 * completable once their owning room is reachable, then expansion repeats
 * until nothing changes.
 */
export function solveCube(cube: SolvableCube, caps: SolverCaps): SolveResult {
  const reachable = new Set<CoordId>([cube.spawn]);
  const discoveryOrder: CoordId[] = [cube.spawn];
  const keys = new Set<string>();
  const spawnRoom = cube.rooms[cube.spawn];
  if (spawnRoom?.keyColor) keys.add(spawnRoom.keyColor);

  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...reachable]) {
      const room = cube.rooms[id];
      if (!room) continue;
      for (const door of room.doors) {
        const nId = neighborOf(id, door.face as Face);
        if (reachable.has(nId)) continue;
        if (!cube.rooms[nId]) continue;
        const owner = door.ownerCoord;
        const passable = gatePassableForCaps(door.gate, caps, {
          keysAvailable: keys,
          objectiveCompletable: owner ? reachable.has(owner) : false,
        });
        if (!passable) continue;
        reachable.add(nId);
        discoveryOrder.push(nId);
        const nRoom = cube.rooms[nId];
        if (nRoom?.keyColor && !keys.has(nRoom.keyColor)) {
          keys.add(nRoom.keyColor);
        }
        changed = true;
      }
    }
  }

  const solvable = reachable.has(cube.exit);
  const unreachable = Object.keys(cube.rooms).filter((id) => !reachable.has(id));

  // shortest path through the final reachable graph (all inventory collected)
  let path: CoordId[] = [];
  if (solvable) {
    const prev = new Map<CoordId, CoordId>();
    const queue: CoordId[] = [cube.spawn];
    const seen = new Set<CoordId>([cube.spawn]);
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (cur === cube.exit) break;
      const room = cube.rooms[cur];
      if (!room) continue;
      for (const door of room.doors) {
        const nId = neighborOf(cur, door.face as Face);
        if (seen.has(nId) || !reachable.has(nId)) continue;
        const owner = door.ownerCoord;
        const passable = gatePassableForCaps(door.gate, caps, {
          keysAvailable: keys,
          objectiveCompletable: owner ? reachable.has(owner) : false,
        });
        if (!passable) continue;
        seen.add(nId);
        prev.set(nId, cur);
        queue.push(nId);
      }
    }
    let cur: CoordId | undefined = cube.exit;
    while (cur !== undefined) {
      path.unshift(cur);
      cur = prev.get(cur);
    }
    if (path[0] !== cube.spawn) path = []; // defensive: BFS failed to link
  }

  return { solvable, path, unreachable, discoveryOrder };
}

export { OPPOSITE_FACE };
