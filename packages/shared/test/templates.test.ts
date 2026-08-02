import { describe, expect, it } from "vitest";
import {
  TEMPLATES,
  allTemplates,
  parseTiles,
  validateTemplate,
  TemplateValidationError,
} from "../src/templates/index.js";
import { getTemplate } from "../src/templates/index.js";

const base = () => JSON.parse(JSON.stringify(getTemplate("connector_basic")));

describe("template registry", () => {
  it("loads exactly the 10 MVP templates", () => {
    expect(TEMPLATES.size).toBe(10);
  });

  it("has unique ids and required archetypes", () => {
    const ids = allTemplates().map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    const archetypes = new Set(allTemplates().map((t) => t.archetype));
    for (const required of ["connector", "puzzle", "hazard", "combat", "sanctuary", "vault", "exit"]) {
      expect(archetypes).toContain(required);
    }
  });

  it("exit and sanctuary are singleton templates", () => {
    expect(getTemplate("exit_vault").maxPerCube).toBe(1);
    expect(getTemplate("sanctuary").maxPerCube).toBe(1);
    expect(getTemplate("exit_vault").minPerCube).toBe(1);
    expect(getTemplate("sanctuary").minPerCube).toBe(1);
  });

  it("parses tiles into a 9×9 grid", () => {
    const grid = parseTiles(getTemplate("puzzle_plates"));
    expect(grid.length).toBe(9);
    expect(grid[0]!.length).toBe(9);
    expect(grid[4]![4]).toBe("pit");
    expect(grid[3]![4]).toBe("plate");
  });
});

describe("loader invariants fail loudly", () => {
  it("rejects a tile char missing from the legend", () => {
    const t = base();
    t.tiles[0] = "....Z....";
    expect(() => validateTemplate(t)).toThrowError(TemplateValidationError);
    expect(() => validateTemplate(t)).toThrowError(/tiles\[0\]\[4\]/);
  });

  it("rejects spawn cells on non-floor tiles", () => {
    const t = base();
    t.spawnCells = [[4, 4]]; // that's the lift tile
    expect(() => validateTemplate(t)).toThrowError(/spawn cell must be floor/);
  });

  it("rejects a door slot cell off its face's edge", () => {
    const t = base();
    t.doorSlots[0] = { allowedGates: ["open"], cell: [4, 3] }; // N door must be z=0
    expect(() => validateTemplate(t)).toThrowError(/invalid for face N/);
  });

  it("rejects NESW door slots without an explicit cell", () => {
    const t = base();
    t.doorSlots[1] = { allowedGates: ["open"] };
    expect(() => validateTemplate(t)).toThrowError(/require an explicit wall cell/);
  });

  it("rejects a U slot with no power source in the room", () => {
    const t = base();
    // remove plate+lift from row 4
    t.tiles[4] = ".........";
    expect(() => validateTemplate(t)).toThrowError(/no plate\/lift tile/);
  });

  it("reports the offending template id and path", () => {
    const t = base();
    t.lighting.intensity = 99;
    try {
      validateTemplate(t);
      expect.unreachable();
    } catch (err) {
      const e = err as TemplateValidationError;
      expect(e.templateId).toBe("connector_basic");
      expect(e.path).toContain("lighting.intensity");
    }
  });
});
