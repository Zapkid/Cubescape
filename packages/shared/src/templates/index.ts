import { RoomTemplate, type TileType, FACES, type Face } from "./schema.js";

export type { RoomTemplate, TileType } from "./schema.js";
import connectorBasic from "./json/connector_basic.json";
import puzzlePlates from "./json/puzzle_plates.json";
import puzzleLevers from "./json/puzzle_levers.json";
import hazardSpikes from "./json/hazard_spikes.json";
import hazardGas from "./json/hazard_gas.json";
import combatSlimes from "./json/combat_slimes.json";
import combatTurret from "./json/combat_turret.json";
import sanctuary from "./json/sanctuary.json";
import vaultKey from "./json/vault_key.json";
import exitVault from "./json/exit_vault.json";

const RAW_TEMPLATES: unknown[] = [
  connectorBasic,
  puzzlePlates,
  puzzleLevers,
  hazardSpikes,
  hazardGas,
  combatSlimes,
  combatTurret,
  sanctuary,
  vaultKey,
  exitVault,
];

export class TemplateValidationError extends Error {
  constructor(
    public templateId: string,
    public path: string,
    message: string,
  ) {
    super(`[template:${templateId}] ${path}: ${message}`);
    this.name = "TemplateValidationError";
  }
}

/** Walkable tiles a hatch or spawn can sit on. */
const WALKABLE: ReadonlySet<TileType> = new Set([
  "floor",
  "plate",
  "lift",
  "cracked",
  "gas_vent",
  "spike",
]);

function validateTemplate(raw: unknown): RoomTemplate {
  const idGuess =
    typeof raw === "object" && raw !== null && "id" in raw
      ? String((raw as { id: unknown }).id)
      : "<unknown>";
  const parsed = RoomTemplate.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new TemplateValidationError(
      idGuess,
      first ? first.path.join(".") : "<root>",
      first ? first.message : "invalid template",
    );
  }
  const t = parsed.data;

  // Invariant: every char used in tiles exists in tileLegend.
  for (let z = 0; z < 9; z++) {
    const row = t.tiles[z]!;
    for (let x = 0; x < 9; x++) {
      const ch = row[x]!;
      if (!(ch in t.tileLegend)) {
        throw new TemplateValidationError(
          t.id,
          `tiles[${z}][${x}]`,
          `char '${ch}' missing from tileLegend`,
        );
      }
    }
  }

  const tileAt = (x: number, z: number): TileType =>
    t.tileLegend[t.tiles[z]![x]!]!;

  // Invariant: spawnCells are walkable floor-like tiles.
  for (const [x, z] of t.spawnCells) {
    if (tileAt(x, z) !== "floor") {
      throw new TemplateValidationError(
        t.id,
        `spawnCells[${x},${z}]`,
        `spawn cell must be floor, got '${tileAt(x, z)}'`,
      );
    }
  }

  // Invariant: door slot wall cells sit on the correct edge for their face.
  const edgeCheck: Record<Face, (x: number, z: number) => boolean> = {
    N: (_x, z) => z === 0,
    E: (x, _z) => x === 8,
    S: (_x, z) => z === 8,
    W: (x, _z) => x === 0,
    U: (x, z) => WALKABLE.has(tileAt(x, z)),
    D: (x, z) => WALKABLE.has(tileAt(x, z)),
  };
  t.doorSlots.forEach((slot, i) => {
    if (!slot) return;
    const face = FACES[i]!;
    if (slot.cell) {
      const [x, z] = slot.cell;
      if (!edgeCheck[face](x, z)) {
        throw new TemplateValidationError(
          t.id,
          `doorSlots[${i}].cell`,
          `cell [${x},${z}] invalid for face ${face}`,
        );
      }
    } else if (face === "U" || face === "D") {
      if (!WALKABLE.has(tileAt(4, 4))) {
        throw new TemplateValidationError(
          t.id,
          `doorSlots[${i}]`,
          `default hatch cell [4,4] is not walkable`,
        );
      }
    } else {
      throw new TemplateValidationError(
        t.id,
        `doorSlots[${i}].cell`,
        `NESW door slots require an explicit wall cell`,
      );
    }
  });

  // Invariant: a U slot needs an on-room power option (plate or lift tile present).
  const uSlot = t.doorSlots[4];
  if (uSlot) {
    let hasPower = false;
    for (let z = 0; z < 9 && !hasPower; z++) {
      for (let x = 0; x < 9 && !hasPower; x++) {
        const tt = tileAt(x, z);
        if (tt === "plate" || tt === "lift") hasPower = true;
      }
    }
    if (!hasPower) {
      throw new TemplateValidationError(
        t.id,
        "doorSlots[4]",
        "template has a U slot but no plate/lift tile to power it",
      );
    }
  }

  return t;
}

function buildRegistry(): Map<string, RoomTemplate> {
  const map = new Map<string, RoomTemplate>();
  for (const raw of RAW_TEMPLATES) {
    const t = validateTemplate(raw);
    if (map.has(t.id)) {
      throw new TemplateValidationError(t.id, "id", "duplicate template id");
    }
    map.set(t.id, t);
  }
  return map;
}

/** Validated template registry. Throws loudly at import time if any template is bad. */
export const TEMPLATES: ReadonlyMap<string, RoomTemplate> = buildRegistry();

export function getTemplate(id: string): RoomTemplate {
  const t = TEMPLATES.get(id);
  if (!t) throw new Error(`unknown template id '${id}'`);
  return t;
}

export function allTemplates(): RoomTemplate[] {
  return [...TEMPLATES.values()];
}

/** Parse a template's tiles into a [z][x] TileType grid. */
export function parseTiles(t: RoomTemplate): TileType[][] {
  return t.tiles.map((row) => row.split("").map((ch) => t.tileLegend[ch]!));
}

export { validateTemplate };
