"use client";

import { create } from "zustand";
import type { ServerEvent } from "@cubescape/shared";

export interface FeedItem {
  id: number;
  text: string;
  at: number;
}

export interface PingMarker {
  id: number;
  kind: string;
  x: number;
  z: number;
  room: string;
  by: string;
  until: number;
}

interface GameStore {
  connected: boolean;
  connectionError: string | null;
  sessionId: string;
  /** local predicted position (rendered); server state holds authority */
  px: number;
  py: number;
  pz: number;
  yaw: number;
  pitch: number;
  feed: FeedItem[];
  pings: PingMarker[];
  pointerLocked: boolean;
  /** divergence debug readout */
  lastCorrection: number;
  interactHint: string;
  /** increments when the local player takes damage (drives the red flash) */
  hurtNonce: number;
  /** ms timestamp of the last camera-shake trigger */
  shakeAt: number;

  setConnected(v: boolean, err?: string | null): void;
  setSession(id: string): void;
  setPredicted(x: number, y: number, z: number): void;
  setLook(yaw: number, pitch: number): void;
  pushFeed(text: string): void;
  addPing(p: Omit<PingMarker, "id">): void;
  prune(now: number): void;
  setPointerLocked(v: boolean): void;
  setLastCorrection(v: number): void;
  setInteractHint(v: string): void;
  setHurt(): void;
  setShake(): void;
}

let idCounter = 1;

export const useGame = create<GameStore>((set) => ({
  connected: false,
  connectionError: null,
  sessionId: "",
  px: 4.5,
  py: 0,
  pz: 4.5,
  yaw: 0,
  pitch: -0.35,
  feed: [],
  pings: [],
  pointerLocked: false,
  lastCorrection: 0,
  interactHint: "",
  hurtNonce: 0,
  shakeAt: 0,

  setConnected: (v, err = null) => set({ connected: v, connectionError: err }),
  setSession: (id) => set({ sessionId: id }),
  setPredicted: (x, y, z) => set({ px: x, py: y, pz: z }),
  setLook: (yaw, pitch) => set({ yaw, pitch }),
  pushFeed: (text) =>
    set((s) => ({
      feed: [...s.feed.slice(-6), { id: idCounter++, text, at: Date.now() }],
    })),
  addPing: (p) => set((s) => ({ pings: [...s.pings.slice(-8), { ...p, id: idCounter++ }] })),
  prune: (now) =>
    set((s) => ({
      feed: s.feed.filter((f) => now - f.at < 6000),
      pings: s.pings.filter((p) => p.until > now),
    })),
  setPointerLocked: (v) => set({ pointerLocked: v }),
  setLastCorrection: (v) => set({ lastCorrection: v }),
  setInteractHint: (v) => set({ interactHint: v }),
  setHurt: () => set((s) => ({ hurtNonce: s.hurtNonce + 1, shakeAt: Date.now() })),
  setShake: () => set({ shakeAt: Date.now() }),
}));

/** per-frame camera info, deliberately outside reactive state (60Hz writes) */
export const camInfo = { dist: 3.4 };

export function describeEvent(e: ServerEvent): string | null {
  switch (e.t) {
    case "message":
      return String(e.text ?? "");
    case "keyPickup":
      return `${e.by} took the ${e.color} key`;
    case "doorOpen":
      return null; // sound only
    case "doorClose":
      return "The plates release — the door seals shut.";
    case "downed":
      return `${e.who} is down!`;
    case "revived":
      return `${e.who} is back up`;
    case "objective":
      return `Objective complete`;
    case "mobDie":
      return null;
    case "matchComplete":
      return `THE EXIT OPENS. Match complete!`;
    case "emote":
      return `${e.by} ${e.kind === "taunt" ? "taunts the cube" : "points"}`;
    default:
      return null;
  }
}
