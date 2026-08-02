import { CUBE_SIZE, GEN } from "../constants.js";
import { allTemplates, type RoomTemplate } from "../templates/index.js";
import { FACE_INDEX } from "../types.js";
import {
  coordId,
  inCube,
  neighborCoord,
  OPPOSITE_FACE,
  parseCoordId,
  type CoordId,
  type CubeCoord,
  type Face,
  type Gate,
  type SolverCaps,
  FACES,
} from "../types.js";
import { mulberry32, pickWeighted, shuffled, type Rng } from "./prng.js";
import { solveCube, type SolveResult } from "../solver/index.js";

export interface CubeDoorSpec {
  face: Face;
  gate: Gate;
  cell: readonly [number, number];
  /** coord of the room whose objective controls this door (objective gates) */
  ownerCoord?: CoordId;
}

export interface CubeRoomSpec {
  coord: CubeCoord;
  templateId: string;
  doors: CubeDoorSpec[];
  /** key color available for pickup in this room, if any */
  keyColor?: string;
}

export interface CubeSpec {
  seed: number;
  size: number;
  spawn: CoordId;
  exit: CoordId;
  sanctuary: CoordId;
  rooms: Record<CoordId, CubeRoomSpec>;
  solution: SolveResult;
  attempts: number;
}

/** Logic ids whose rooms can flip `cleared` (valid objective-gate owners). */
const CLEARABLE_LOGIC = new Set([
  "plates_and_gate",
  "levers_sequence",
  "gas_room",
  "combat_clear",
  "vault_bridge",
  "exit_terminal",
]);

interface EdgeCandidate {
  a: CoordId;
  b: CoordId;
  faceFromA: Face;
}

export class GenerationError extends Error {}

/**
 * Seeded, deterministic 3×3×3 cube assembly with guaranteed solvability.
 * Retries gates/keys (then templates) within one rng stream, so the same
 * seed always yields the identical cube.
 */
export function generateCube(seed: number, caps: SolverCaps): CubeSpec {
  const rng = mulberry32(seed);
  for (let attempt = 1; attempt <= GEN.maxGenRetries; attempt++) {
    const spec = tryGenerate(seed, rng, caps, attempt);
    if (spec) return spec;
  }
  throw new GenerationError(
    `seed ${seed}: no solvable cube within ${GEN.maxGenRetries} attempts`,
  );
}

function tryGenerate(
  seed: number,
  rng: Rng,
  caps: SolverCaps,
  attempt: number,
): CubeSpec | null {
  const size = CUBE_SIZE;
  const spawn: CubeCoord = { cx: 0, cy: 0, cz: 0 };
  const exit: CubeCoord = { cx: size - 1, cy: size - 1, cz: size - 1 };
  const sanctuary: CubeCoord = { cx: 1, cy: 1, cz: 1 };
  const spawnId = coordId(spawn);
  const exitId = coordId(exit);
  const sanctuaryId = coordId(sanctuary);

  // ---- 1. template assignment ----
  const templates = allTemplates();
  const byId = new Map(templates.map((t) => [t.id, t]));
  const counts = new Map<string, number>();
  const assignment = new Map<CoordId, string>();

  const place = (id: CoordId, templateId: string) => {
    assignment.set(id, templateId);
    counts.set(templateId, (counts.get(templateId) ?? 0) + 1);
  };
  place(spawnId, "connector_basic");
  place(exitId, "exit_vault");
  place(sanctuaryId, "sanctuary");

  const openCells: CoordId[] = [];
  for (let x = 0; x < size; x++)
    for (let y = 0; y < size; y++)
      for (let z = 0; z < size; z++) {
        const id = coordId({ cx: x, cy: y, cz: z });
        if (!assignment.has(id)) openCells.push(id);
      }

  // satisfy minPerCube quotas first
  const shuffledCells = shuffled(rng, openCells);
  let cellIdx = 0;
  for (const t of templates) {
    const need = t.minPerCube - (counts.get(t.id) ?? 0);
    for (let i = 0; i < need; i++) {
      const cell = shuffledCells[cellIdx++];
      if (cell === undefined) return null;
      place(cell, t.id);
    }
  }
  // weighted fill for the rest
  for (; cellIdx < shuffledCells.length; cellIdx++) {
    const cell = shuffledCells[cellIdx]!;
    const eligible = templates.filter(
      (t) =>
        (counts.get(t.id) ?? 0) < t.maxPerCube &&
        t.id !== "exit_vault" &&
        t.id !== "sanctuary",
    );
    if (eligible.length === 0) return null;
    place(cell, pickWeighted(rng, eligible, (t) => t.weight).id);
  }

  const templateOf = (id: CoordId): RoomTemplate => byId.get(assignment.get(id)!)!;

  // ---- 2. candidate edges ----
  const candidates: EdgeCandidate[] = [];
  for (const [id] of assignment) {
    const c = parseCoordId(id);
    for (const face of ["E", "S", "U"] as const) {
      const n = neighborCoord(c, face);
      if (!inCube(n, size)) continue;
      const nId = coordId(n);
      const slotA = templateOf(id).doorSlots[FACE_INDEX[face]];
      const slotB = templateOf(nId).doorSlots[FACE_INDEX[OPPOSITE_FACE[face]]];
      if (slotA && slotB) candidates.push({ a: id, b: nId, faceFromA: face });
    }
  }

  // ---- 3. spanning tree + extras ----
  const nodes = [...assignment.keys()];
  const chosen: EdgeCandidate[] = [];
  const parent = new Map<CoordId, CoordId>(nodes.map((n) => [n, n]));
  const find = (x: CoordId): CoordId => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  const union = (x: CoordId, y: CoordId): boolean => {
    const rx = find(x);
    const ry = find(y);
    if (rx === ry) return false;
    parent.set(rx, ry);
    return true;
  };
  const shuffledEdges = shuffled(rng, candidates);
  const extras: EdgeCandidate[] = [];
  for (const e of shuffledEdges) {
    if (union(e.a, e.b)) chosen.push(e);
    else extras.push(e);
  }
  const roots = new Set(nodes.map((n) => find(n)));
  if (roots.size > 1) return null; // templates produced a disconnected lattice
  for (const e of extras) if (rng() < 0.4) chosen.push(e);

  // ---- 4. gate assignment ----
  interface EdgeWithGate extends EdgeCandidate {
    gate: Gate;
    ownerCoord?: CoordId;
  }
  const keyColorsInPlay: string[] = [];
  const edges: EdgeWithGate[] = chosen.map((e) => {
    const isVertical = e.faceFromA === "U";
    if (isVertical) return { ...e, gate: { type: "lift" } };

    const slotA = templateOf(e.a).doorSlots[FACE_INDEX[e.faceFromA]]!;
    const slotB =
      templateOf(e.b).doorSlots[FACE_INDEX[OPPOSITE_FACE[e.faceFromA]]]!;
    const allowed = slotA.allowedGates.filter(
      (g) => slotB.allowedGates.includes(g) && g !== "oneway" && g !== "lift",
    );
    // the more restrictive slot wins when the intersection is empty (puzzle doors)
    const pool =
      allowed.length > 0
        ? allowed
        : (slotA.allowedGates.length <= slotB.allowedGates.length
            ? slotA.allowedGates
            : slotB.allowedGates
          ).filter((g) => g !== "oneway" && g !== "lift");
    const gatedPool = pool.filter((g) => g !== "open");
    const forceGated = !pool.includes("open");
    const roll = rng();
    if (
      gatedPool.length === 0 ||
      (!forceGated && roll >= GEN.gatedEdgeFraction)
    ) {
      return { ...e, gate: { type: "open" } };
    }

    const kind = pickWeighted(
      rng,
      gatedPool,
      (g) => GEN.gateWeights[g] ?? 1,
    );
    switch (kind) {
      case "key": {
        const idx = Math.floor(rng() * Math.min(GEN.keyColors.length, GEN.maxKeyChainDepth));
        const color = GEN.keyColors[idx]!;
        if (!keyColorsInPlay.includes(color)) keyColorsInPlay.push(color);
        return { ...e, gate: { type: "key", color } };
      }
      case "plates": {
        // need a plate tile on one side to press
        const hasPlates = (id: CoordId) =>
          templateOf(id).tiles.some((row, z) =>
            row.split("").some((ch, x) => {
              void x;
              void z;
              return templateOf(id).tileLegend[ch] === "plate";
            }),
          );
        if (!hasPlates(e.a) && !hasPlates(e.b))
          return { ...e, gate: { type: "open" } };
        const maxCount = Math.min(2, caps.players + (caps.hasBrute ? 1 : 0));
        if (maxCount < 1) return { ...e, gate: { type: "open" } };
        const count = maxCount >= 2 && rng() < 0.6 ? 2 : 1;
        return { ...e, gate: { type: "plates", count } };
      }
      case "stat": {
        const stat = rng() < 0.5 ? ("might" as const) : ("wits" as const);
        const cap = stat === "might" ? caps.might : caps.wits;
        if (cap < 4) return { ...e, gate: { type: "open" } };
        const threshold = 4 + Math.floor(rng() * Math.max(1, cap - 3));
        return { ...e, gate: { type: "stat", stat, threshold } };
      }
      case "objective": {
        const aClearable = CLEARABLE_LOGIC.has(templateOf(e.a).logicId ?? "");
        const bClearable = CLEARABLE_LOGIC.has(templateOf(e.b).logicId ?? "");
        const owner = aClearable ? e.a : bClearable ? e.b : undefined;
        if (!owner) return { ...e, gate: { type: "open" } };
        return { ...e, gate: { type: "objective" }, ownerCoord: owner };
      }
      default:
        return { ...e, gate: { type: "open" } };
    }
  });

  // ---- 5. key placement ----
  const keyRooms = new Map<CoordId, string>();
  if (keyColorsInPlay.length > 0) {
    const roomPool = nodes.filter((n) => n !== exitId);
    for (const color of keyColorsInPlay) {
      const weighted = roomPool.filter((n) => !keyRooms.has(n));
      if (weighted.length === 0) return null;
      const room = pickWeighted(rng, weighted, (n) =>
        templateOf(n).archetype === "vault" ? 6 : 1,
      );
      keyRooms.set(room, color);
    }
  }

  // ---- 6. build spec + solve ----
  const rooms: Record<CoordId, CubeRoomSpec> = {};
  for (const id of nodes) {
    rooms[id] = {
      coord: parseCoordId(id),
      templateId: assignment.get(id)!,
      doors: [],
      ...(keyRooms.has(id) ? { keyColor: keyRooms.get(id)! } : {}),
    };
  }
  for (const e of edges) {
    const tA = templateOf(e.a);
    const tB = templateOf(e.b);
    const faceA = e.faceFromA;
    const faceB = OPPOSITE_FACE[faceA];
    const slotA = tA.doorSlots[FACE_INDEX[faceA]]!;
    const slotB = tB.doorSlots[FACE_INDEX[faceB]]!;
    const cellA = slotA.cell ?? ([4, 4] as const);
    const cellB = slotB.cell ?? ([4, 4] as const);
    rooms[e.a]!.doors.push({
      face: faceA,
      gate: e.gate,
      cell: cellA,
      ...(e.ownerCoord ? { ownerCoord: e.ownerCoord } : {}),
    });
    rooms[e.b]!.doors.push({
      face: faceB,
      gate: e.gate,
      cell: cellB,
      ...(e.ownerCoord ? { ownerCoord: e.ownerCoord } : {}),
    });
  }

  const partial: Omit<CubeSpec, "solution" | "attempts"> = {
    seed,
    size,
    spawn: spawnId,
    exit: exitId,
    sanctuary: sanctuaryId,
    rooms,
  };
  const solution = solveCube(partial, caps);
  if (!solution.solvable) return null;
  if (solution.path.length < GEN.minPathLengthToExit) return null;

  // quota invariants (cheap self-check — the property tests assert these too)
  const exitCount = nodes.filter((n) => assignment.get(n) === "exit_vault").length;
  const sancCount = nodes.filter((n) => assignment.get(n) === "sanctuary").length;
  if (exitCount !== 1 || sancCount !== 1) return null;

  return { ...partial, solution, attempts: attempt };
}

/** ASCII cube map, one 3×3 grid per Y layer. Debug/dev aid. */
export function renderCubeAscii(spec: CubeSpec): string {
  const arch: Record<string, string> = {
    connector: ".",
    puzzle: "P",
    hazard: "H",
    combat: "C",
    sanctuary: "S",
    vault: "V",
    exit: "E",
  };
  const lines: string[] = [];
  for (let y = spec.size - 1; y >= 0; y--) {
    lines.push(`── layer y=${y} ──`);
    for (let z = 0; z < spec.size; z++) {
      let rowTop = "";
      let rowMid = "";
      for (let x = 0; x < spec.size; x++) {
        const id = coordId({ cx: x, cy: y, cz: z });
        const room = spec.rooms[id]!;
        const t = room.templateId;
        const a = arch[getArchetype(t)] ?? "?";
        const doors = new Set(room.doors.map((d) => d.face));
        const gateChar = (f: Face) => {
          const d = room.doors.find((dd) => dd.face === f);
          if (!d) return " ";
          switch (d.gate.type) {
            case "open":
              return "·";
            case "key":
              return "k";
            case "plates":
              return "p";
            case "stat":
              return "s";
            case "objective":
              return "o";
            case "lift":
              return "^";
            default:
              return "?";
          }
        };
        rowTop += `  ${doors.has("N") ? gateChar("N") : " "}   `;
        const mark = id === spec.spawn ? "@" : id === spec.exit ? "X" : a;
        const up = doors.has("U") ? "^" : " ";
        const down = doors.has("D") ? "v" : " ";
        rowMid += `${doors.has("W") ? gateChar("W") : " "}${up}${mark}${down}${doors.has("E") ? gateChar("E") : " "} `;
      }
      lines.push(rowTop);
      lines.push(rowMid);
      let rowBot = "";
      for (let x = 0; x < spec.size; x++) {
        const id = coordId({ cx: x, cy: y, cz: z });
        const room = spec.rooms[id]!;
        const d = room.doors.find((dd) => dd.face === "S");
        const ch = d
          ? d.gate.type === "open"
            ? "·"
            : d.gate.type[0]!
          : " ";
        rowBot += `  ${ch}   `;
      }
      lines.push(rowBot);
    }
  }
  lines.push(
    `legend: @ spawn, X exit, S sanctuary, P puzzle, H hazard, C combat, V vault, . connector`,
  );
  lines.push(
    `gates: · open, k key, p plates, s stat, o objective, ^ lift`,
  );
  return lines.join("\n");
}

function getArchetype(templateId: string): string {
  const t = allTemplates().find((tt) => tt.id === templateId);
  return t?.archetype ?? "?";
}

export { FACES };
