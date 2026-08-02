# CLAUDE.md — CubeScape MVP

## Hard rules
- TypeScript strict mode everywhere. No `any` without an inline justification comment.
- Server is authoritative for ALL game state: positions (validated), doors, keys,
  puzzle state, HP, EXP. Clients send inputs/intents only, never state.
- All game logic (gates, puzzles, mobs, generator, ability effects) lives in
  `packages/shared` as pure functions with zero rendering/network imports.
  If a rule can't be unit-tested headlessly, it's in the wrong place.
- One Colyseus room class = one match.
- Room content is data (JSON templates), not code. New rooms must not require
  touching engine code.
- Every phase ends green: `pnpm test && pnpm lint && pnpm typecheck` must pass
  before moving on. New logic requires tests in the same PR/commit.
- No premature content: MVP ships with exactly 10 room templates, 3 characters,
  PvE only, 3×3×3. Resist scope creep; log ideas in BACKLOG.md instead.
- Commit style: conventional commits. Small, reviewable commits per feature.

## Deviations from the original workplan (deliberate, logged)
- Client prediction uses the SAME shared grid-collision function as the server
  (not Rapier) — deterministic, zero rubber-banding, one collision truth.
- Interest management: full state sync for MVP (state is tiny at 3×3×3);
  StateView filtering is in BACKLOG.md.
- Persistence: `packages/server/src/persistence` is an interface with a local
  no-op/JSON implementation; Supabase wiring is a later session.
- Character models: stylized procedural primitives, no external asset packs.
- Audio: WebAudio-synthesized sfx, no audio assets.

## Commands
- `pnpm dev` — runs server (2567) + web (3000) concurrently
- `pnpm test` — vitest, all packages
- `pnpm soak -- --bots 8` — headless bot soak against a spawned server
- `pnpm typecheck` / `pnpm lint`

## Architecture map
- packages/shared  → types, room templates, generator+solver, game rules, constants
- packages/server  → Colyseus app, MatchRoom, authoritative simulation, persistence
- packages/botclient → headless Colyseus client for soak tests
- apps/web         → Next.js shell (lobby) + R3F game client
