import { describe, expect, it } from "vitest";
import { solveCube, type SolvableCube } from "../src/solver/index.js";
import type { Gate, SolverCaps } from "../src/types.js";

const caps: SolverCaps = {
  might: 12,
  wits: 11,
  players: 3,
  hasBrute: true,
  hasScout: true,
  hasTinker: true,
};

/** tiny hand-built graphs on a 1D strip of rooms along +x */
function strip(
  gates: Gate[],
  keyAt: Record<number, string> = {},
  owners: Record<number, string> = {},
): SolvableCube {
  const rooms: SolvableCube["rooms"] = {};
  const n = gates.length + 1;
  for (let i = 0; i < n; i++) {
    const id = `${i},0,0`;
    const doors: SolvableCube["rooms"][string]["doors"] = [];
    if (i > 0) {
      doors.push({ face: "W", gate: gates[i - 1]!, ...(owners[i - 1] ? { ownerCoord: owners[i - 1]! } : {}) });
    }
    if (i < n - 1) {
      doors.push({ face: "E", gate: gates[i]!, ...(owners[i] ? { ownerCoord: owners[i]! } : {}) });
    }
    rooms[id] = {
      templateId: "connector_basic",
      doors,
      ...(keyAt[i] ? { keyColor: keyAt[i]! } : {}),
    };
  }
  return { spawn: "0,0,0", exit: `${n - 1},0,0`, rooms };
}

describe("solver on hand-built graphs", () => {
  it("solves an all-open strip", () => {
    const r = solveCube(strip([{ type: "open" }, { type: "open" }]), caps);
    expect(r.solvable).toBe(true);
    expect(r.path).toEqual(["0,0,0", "1,0,0", "2,0,0"]);
    expect(r.unreachable).toEqual([]);
  });

  it("collects a key then passes the key door", () => {
    // key in room 1, key door between 1 and 2
    const r = solveCube(
      strip([{ type: "open" }, { type: "key", color: "ruby" }], { 1: "ruby" }),
      caps,
    );
    expect(r.solvable).toBe(true);
  });

  it("catches key-behind-its-own-door", () => {
    // ruby door between 0 and 1, but the ruby key is IN room 1
    const r = solveCube(
      strip([{ type: "key", color: "ruby" }], { 1: "ruby" }),
      caps,
    );
    expect(r.solvable).toBe(false);
    expect(r.unreachable).toContain("1,0,0");
  });

  it("chained keys resolve to fixpoint regardless of discovery order", () => {
    // open → ruby key at 1 → ruby door → sapphire key at 2 → sapphire door → exit
    const r = solveCube(
      strip(
        [
          { type: "open" },
          { type: "key", color: "ruby" },
          { type: "key", color: "sapphire" },
        ],
        { 1: "ruby", 2: "sapphire" },
      ),
      caps,
    );
    expect(r.solvable).toBe(true);
    expect(r.path).toHaveLength(4);
  });

  it("objective door passes only when its owner room is reachable", () => {
    // door 0-1 is objective-gated, owned by room 1 (unreachable) → stuck
    const stuck = solveCube(strip([{ type: "objective" }], {}, { 0: "1,0,0" }), caps);
    expect(stuck.solvable).toBe(false);
    // owned by room 0 (spawn side) → passable
    const fine = solveCube(strip([{ type: "objective" }], {}, { 0: "0,0,0" }), caps);
    expect(fine.solvable).toBe(true);
  });

  it("stat door respects caps", () => {
    const gate: Gate = { type: "stat", stat: "might", threshold: 20 };
    const r = solveCube(strip([gate]), caps);
    expect(r.solvable).toBe(false);
  });
});
