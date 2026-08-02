import { describe, expect, it } from "vitest";
import { generateCube, renderCubeAscii } from "../src/generator/index.js";
import { coordId, type SolverCaps } from "../src/types.js";
import { getTemplate } from "../src/templates/index.js";

const teamCaps: SolverCaps = {
  might: 12, // brute 8 + tinker 4
  wits: 14, // tinker 8 + scout 6
  players: 3,
  hasBrute: true,
  hasScout: true,
  hasTinker: true,
};

const soloCaps: Record<string, SolverCaps> = {
  brute: { might: 8, wits: 3, players: 1, hasBrute: true, hasScout: false, hasTinker: false },
  scout: { might: 3, wits: 6, players: 1, hasBrute: false, hasScout: true, hasTinker: false },
  tinker: { might: 4, wits: 8, players: 1, hasBrute: false, hasScout: false, hasTinker: true },
};

const SEED_COUNT = 5000;

describe("generator determinism", () => {
  it("same seed ⇒ identical cube", () => {
    const a = generateCube(1234, teamCaps);
    const b = generateCube(1234, teamCaps);
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it("different seeds ⇒ (almost surely) different cubes", () => {
    const a = generateCube(1, teamCaps);
    const b = generateCube(2, teamCaps);
    expect(JSON.stringify(a.rooms)).not.toEqual(JSON.stringify(b.rooms));
  });
});

describe(`solvability sweep: every seed in [0, ${SEED_COUNT})`, () => {
  it("yields a solvable cube within the retry budget (team caps)", () => {
    let totalAttempts = 0;
    let maxAttempts = 0;
    for (let seed = 0; seed < SEED_COUNT; seed++) {
      const spec = generateCube(seed, teamCaps); // throws on failure
      expect(spec.solution.solvable).toBe(true);
      totalAttempts += spec.attempts;
      maxAttempts = Math.max(maxAttempts, spec.attempts);
    }
    // telemetry for tuning — visible with --reporter=verbose
    console.log(
      `sweep ok: avg attempts ${(totalAttempts / SEED_COUNT).toFixed(2)}, max ${maxAttempts}`,
    );
  });

  it("solo runs are solvable for each character (1000 seeds each)", () => {
    for (const [char, caps] of Object.entries(soloCaps)) {
      for (let seed = 0; seed < 1000; seed++) {
        const spec = generateCube(seed, caps);
        expect(spec.solution.solvable, `${char} seed ${seed}`).toBe(true);
      }
    }
  });
});

describe("quota invariants", () => {
  it("every cube has exactly 1 exit, 1 sanctuary, ≥1 vault key room, ≥1 twin plates", () => {
    for (let seed = 0; seed < 200; seed++) {
      const spec = generateCube(seed, teamCaps);
      const ids = Object.values(spec.rooms).map((r) => r.templateId);
      expect(ids.filter((t) => t === "exit_vault")).toHaveLength(1);
      expect(ids.filter((t) => t === "sanctuary")).toHaveLength(1);
      expect(ids.filter((t) => t === "vault_key").length).toBeGreaterThanOrEqual(1);
      expect(ids.filter((t) => t === "puzzle_plates").length).toBeGreaterThanOrEqual(1);
      // maxPerCube respected
      const counts = new Map<string, number>();
      for (const t of ids) counts.set(t, (counts.get(t) ?? 0) + 1);
      for (const [tid, n] of counts) {
        expect(n).toBeLessThanOrEqual(getTemplate(tid).maxPerCube);
      }
    }
  });

  it("spawn is at 0,0,0 with at least one passable edge; exit at 2,2,2", () => {
    for (let seed = 0; seed < 200; seed++) {
      const spec = generateCube(seed, teamCaps);
      expect(spec.spawn).toBe(coordId({ cx: 0, cy: 0, cz: 0 }));
      expect(spec.exit).toBe(coordId({ cx: 2, cy: 2, cz: 2 }));
      const spawnRoom = spec.rooms[spec.spawn]!;
      expect(spawnRoom.doors.length).toBeGreaterThanOrEqual(1);
      // discovery starts expanding immediately
      expect(spec.solution.discoveryOrder[0]).toBe(spec.spawn);
      expect(spec.solution.discoveryOrder.length).toBeGreaterThan(1);
    }
  });

  it("keys referenced by key doors are always placed somewhere", () => {
    for (let seed = 0; seed < 300; seed++) {
      const spec = generateCube(seed, teamCaps);
      const colorsNeeded = new Set<string>();
      const colorsPlaced = new Set<string>();
      for (const room of Object.values(spec.rooms)) {
        for (const d of room.doors) {
          if (d.gate.type === "key") colorsNeeded.add(d.gate.color);
        }
        if (room.keyColor) colorsPlaced.add(room.keyColor);
      }
      for (const c of colorsNeeded) expect(colorsPlaced).toContain(c);
    }
  });

  it("path length honors the difficulty knob", () => {
    for (let seed = 0; seed < 100; seed++) {
      const spec = generateCube(seed, teamCaps);
      expect(spec.solution.path.length).toBeGreaterThanOrEqual(4);
    }
  });
});

describe("ascii map", () => {
  it("renders all three layers with legend", () => {
    const spec = generateCube(42, teamCaps);
    const map = renderCubeAscii(spec);
    expect(map).toContain("layer y=0");
    expect(map).toContain("layer y=2");
    expect(map).toContain("@"); // spawn
    expect(map).toContain("X"); // exit
    expect(map).toContain("legend");
  });
});
