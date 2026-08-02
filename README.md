# CubeScape

> You and your friends are trapped in a 3D cube of deadly puzzle rooms — find the exit before it finds you.

A browser-based, server-authoritative co-op PvE roguelite. Every match assembles a
**3×3×3 cube of handcrafted rooms** from a seed, gates the doors (keys, pressure
plates, combined-stat checks, objectives, lifts), places the keys — and **proves the
cube is solvable for *your* party composition before you spawn**.

Built with **Three.js (react-three-fiber) + Colyseus + TypeScript**, in a pnpm monorepo.

## The one clever mechanic

The generator and the BFS *inventory-fixpoint solver* live in `packages/shared` as
pure functions. The property-based test suite proves that **every seed in [0, 5000)
yields a solvable cube** — including *solo* runs for each of the three characters,
whose kits change what "passable" means:

| | HP | Speed | Might | Wits | Traversal | Utility | Combat |
|---|---|---|---|---|---|---|---|
| **Brute** | 140 | 0.9× | 8 | 3 | Breach (smash cracked floors) | Hold Fast (human pressure plate) | Heavy Swing |
| **Scout** | 90 | 1.25× | 3 | 6 | Grapple (cross pits, ride lifts) | Peek (reveal adjacent rooms) | Slow Dart |
| **Tinker** | 110 | 1.0× | 4 | 8 | Bypass (hotwire one door/room) | Field Kit (heal + power lifts) | Aggro Turret |

Some doors need `might 12` — no one has 12 might. Two of you standing together do.

## Play

```bash
pnpm install
pnpm dev          # server :2567 + web :3000
```

Open http://localhost:3000, pick a runner, ready up. Share the room code for co-op
(1–8 players). `/match/daily-YYYYMMDD` is the same cube for everyone that day.

**Controls:** WASD move · mouse look (click to capture) · LMB strike · E interact /
hold to channel & revive · 1-3 abilities · Space hop · V ping · T taunt · G point

## Architecture

```
packages/shared     types · room templates (JSON) · grid-collision movement ·
                    gate rules · ability effects · mob AI · room logic modules ·
                    seeded generator + solvability solver      ← pure, zero deps
packages/server     Colyseus MatchRoom · 20Hz authoritative sim · persistence
packages/botclient  headless solver-guided bots · soak harness
apps/web            Next.js + R3F client · prediction/reconciliation · HUD
```

- **Server is authoritative for everything.** Clients send inputs/intents only.
  Movement is validated with the *same* pure grid-collision function the client
  predicts with — measured divergence in playtests: **0.00m**.
- **Rooms are data.** A room is 9 strings of 9 chars + door slots + a logic id.
  New room = new JSON + one pure logic module + tests. No engine changes.
- **Bots are the regression net.** CI runs an 8-bot soak (stability, input-budget,
  zero errors) and a 4-bot solve run that must reach the exit.

## Tests

```bash
pnpm test         # 106 tests: 5000-seed solvability sweep, per-character solo
                  # solvability, speed-hack clamp property tests, gate truth
                  # tables, mob AI, room logic, loader invariants, lifecycle
pnpm soak -- --bots 8 --seconds 60 --seed 42          # stability soak
pnpm soak -- --bots 4 --seconds 150 --seed 7 --solve  # bots must escape
CUBE_DEBUG=1 pnpm dev                                  # ASCII cube map per match
```

## Design notes (what each system steals from the greats)

- **Spelunky/Isaac** — handcrafted templates + procedural assembly + daily seed
- **Deep Rock Galactic** — class interdependence, ping wheel, co-op doors
- **Hades** — failed runs still bank 60% EXP
- **Phasmophobia** — per-character senses (Brute sees cracked floors glow, Scout
  reads door gates at range, Tinker sees wiring) force callouts
- **Lethal Company** — downed-revive drama, death spectating, risk-bonus scoring

## Status / roadmap

MVP vertical slice: 10 templates, 3 characters, PvE, 3×3×3, local persistence.
See [BACKLOG.md](BACKLOG.md) for what's deliberately out (PvPvE, proximity voice,
7×7×7, Supabase auth/roster, deploy pipeline).
