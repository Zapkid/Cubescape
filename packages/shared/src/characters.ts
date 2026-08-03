import type { AbilityDef, AbilityId, CharacterDef, CharId } from "./types.js";

export const CHARACTERS: Record<CharId, CharacterDef> = {
  brute: {
    id: "brute",
    name: "Brute",
    hp: 140,
    speedMult: 0.9,
    might: 8,
    wits: 3,
    abilities: ["breach", "holdfast", "swing"],
    color: "#e2574c",
  },
  scout: {
    id: "scout",
    name: "Scout",
    hp: 90,
    speedMult: 1.25,
    might: 3,
    wits: 6,
    abilities: ["grapple", "peek", "dart"],
    color: "#4cc9e2",
  },
  tinker: {
    id: "tinker",
    name: "Tinker",
    hp: 110,
    speedMult: 1.0,
    might: 4,
    wits: 8,
    abilities: ["bypass", "fieldkit", "turret"],
    color: "#e2c94c",
  },
};

export const ABILITIES: Record<AbilityId, AbilityDef> = {
  breach: {
    id: "breach",
    name: "Breach",
    cooldown: 20,
    range: 1.8,
    description: "Smash a cracked wall or floor, opening a shortcut.",
  },
  holdfast: {
    id: "holdfast",
    name: "Hold Fast",
    cooldown: 25,
    range: 0,
    description: "Plant your weight: counts as a pressure plate for 5s.",
  },
  swing: {
    id: "swing",
    name: "Heavy Swing",
    cooldown: 2.5,
    range: 2.0,
    description: "Wide melee blow. Damages and staggers mobs.",
  },
  grapple: {
    id: "grapple",
    name: "Grapple",
    cooldown: 10,
    range: 0,
    description: "2s of hookline mobility: cross pits, ride up-hatches, move fast.",
  },
  peek: {
    id: "peek",
    name: "Peek",
    cooldown: 30,
    range: 0,
    description: "Scout adjacent rooms: reveals archetype and gates on the team map.",
  },
  dart: {
    id: "dart",
    name: "Slow Dart",
    cooldown: 3.5,
    range: 10,
    description: "Ranged dart that damages and slows a mob.",
  },
  bypass: {
    id: "bypass",
    name: "Bypass",
    cooldown: 45,
    range: 2.5,
    description: "Hotwire one gated door per room (not lifts or objectives).",
  },
  fieldkit: {
    id: "fieldkit",
    name: "Field Kit",
    cooldown: 30,
    range: 0,
    description: "Deploy a kit: heals nearby allies and powers lifts for 8s.",
  },
  turret: {
    id: "turret",
    name: "Aggro Turret",
    cooldown: 35,
    range: 0,
    description: "Deploy a turret that shoots and draws mob aggro for 20s.",
  },
  punch: {
    id: "punch",
    name: "Strike",
    cooldown: 0.35,
    range: 1.7,
    description: "Quick close-range hit. Always available.",
  },
};

export function characterFor(charId: CharId): CharacterDef {
  return CHARACTERS[charId];
}
