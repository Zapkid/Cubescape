"use client";

import { useEffect, useState } from "react";
import {
  ABILITIES,
  ARCHETYPE_LIGHTING,
  CHARACTERS,
  TICK_RATE,
  type CharId,
} from "@cubescape/shared";
import type { NetClient, PlayerView, StateView } from "./net";
import { useGame } from "./store";

interface Snapshot {
  phase: string;
  seed: number;
  tick: number;
  me: PlayerView | null;
  players: PlayerView[];
  revealed: Map<string, string>;
  currentCoord: string;
  exit: string;
  matchResult: string;
  roomCleared: boolean;
  keyHere: string;
}

function snapshot(net: NetClient): Snapshot {
  const s = net.state as StateView | null;
  const me = net.me;
  const players: PlayerView[] = [];
  s?.players.forEach((p) => players.push(p));
  const room = me ? s?.rooms.get(me.roomCoord) : null;
  return {
    phase: s?.phase ?? "connecting",
    seed: s?.seed ?? 0,
    tick: s?.tick ?? 0,
    me,
    players,
    revealed: s?.revealed ?? new Map(),
    currentCoord: me?.roomCoord ?? "",
    exit: s?.exit ?? "2,2,2",
    matchResult: s?.matchResult ?? "",
    roomCleared: room?.cleared ?? false,
    keyHere: room && room.keyColor && !room.keyTaken ? room.keyColor : "",
  };
}

export function Hud({ net }: { net: NetClient }) {
  const [snap, setSnap] = useState<Snapshot>(() => snapshot(net));
  const [finalSnap, setFinalSnap] = useState<Snapshot | null>(null);
  const feed = useGame((s) => s.feed);
  const connected = useGame((s) => s.connected);
  const connectionError = useGame((s) => s.connectionError);
  const pointerLocked = useGame((s) => s.pointerLocked);
  const lastCorrection = useGame((s) => s.lastCorrection);
  const interactHint = useGame((s) => s.interactHint);

  useEffect(() => {
    const t = setInterval(() => {
      const s = snapshot(net);
      setSnap(s);
      if (s.phase === "complete") setFinalSnap(s);
    }, 120);
    return () => clearInterval(t);
  }, [net]);

  // once the match ended, the scoreboard is the terminal screen — even after
  // the room disposes and the socket drops
  if (finalSnap) return <Scoreboard snap={finalSnap} />;

  if (!connected && connectionError) {
    return (
      <div className="overlay center">
        <div className="panel">
          <h2>Disconnected</h2>
          <p className="dim">{connectionError}</p>
          <button onClick={() => window.location.reload()}>Rejoin</button>
        </div>
      </div>
    );
  }

  if (snap.phase === "lobby") return <Lobby net={net} snap={snap} />;
  if (snap.phase === "complete") return <Scoreboard snap={snap} />;
  if (!snap.me) return null;

  const me = snap.me;
  const def = CHARACTERS[(me.charId || "scout") as CharId];

  return (
    <div className="overlay">
      {/* top-left: room + seed */}
      <div className="hud-top-left">
        <RoomLabel snap={snap} />
        <div className="dim small">seed {snap.seed} · div {lastCorrection.toFixed(2)}m</div>
      </div>

      {/* minimap */}
      <Minimap snap={snap} />

      {/* feed */}
      <div className="hud-feed">
        {feed.map((f) => (
          <div key={f.id} className="feed-item">
            {f.text}
          </div>
        ))}
      </div>

      {/* crosshair-ish focus dot + interact hint */}
      {pointerLocked ? <div className="dot" /> : (
        <div className="overlay center click-capture">
          <div className="panel dim">click to capture mouse</div>
        </div>
      )}
      {interactHint ? <div className="interact-hint">{interactHint}</div> : null}

      {/* downed overlay */}
      {me.downed ? <DownedOverlay me={me} tick={snap.tick} /> : null}

      {/* bottom bar: hp, keys, abilities */}
      <div className="hud-bottom">
        <div className="hp-wrap">
          <div className="hp-label">
            {def?.name ?? "?"} · {Math.ceil(me.hp)}/{me.maxHp}
          </div>
          <div className="hp-bar">
            <div
              className="hp-fill"
              style={{
                width: `${(100 * me.hp) / Math.max(1, me.maxHp)}%`,
                background: me.hp / me.maxHp > 0.35 ? "#4ade80" : "#f43f5e",
              }}
            />
          </div>
          <div className="keys">
            {me.keys.map((k) => (
              <span key={k} className="key-chip" style={{ borderColor: keyColor(k), color: keyColor(k) }}>
                ⬥ {k}
              </span>
            ))}
          </div>
        </div>
        <div className="abilities">
          {def?.abilities.map((abilityId, slot) => {
            const a = ABILITIES[abilityId];
            const cdUntil = me.cooldowns[slot] ?? 0;
            const remaining = Math.max(0, (cdUntil - snap.tick) / TICK_RATE);
            const total = a.cooldown;
            const pct = Math.min(1, remaining / total);
            return (
              <div key={abilityId} className={`ability ${remaining > 0 ? "cooling" : ""}`}>
                <div className="ability-key">{slot + 1}</div>
                <div className="ability-name">{a.name}</div>
                {remaining > 0 ? (
                  <>
                    <div className="ability-cd" style={{ height: `${pct * 100}%` }} />
                    <div className="ability-timer">{remaining.toFixed(0)}</div>
                  </>
                ) : null}
              </div>
            );
          })}
        </div>
        <div className="hint-block dim small">
          WASD move · LMB strike · E interact · 1-3 abilities · V ping · T taunt
        </div>
      </div>
    </div>
  );
}

function keyColor(k: string): string {
  const colors: Record<string, string> = {
    ruby: "#e2504c",
    sapphire: "#4c7ee2",
    amber: "#e2a44c",
    jade: "#4ce27e",
  };
  return colors[k] ?? "#ccc";
}

function RoomLabel({ snap }: { snap: Snapshot }) {
  const info = snap.revealed.get(snap.currentCoord);
  const arch = info?.split("|")[1] ?? "";
  const light = ARCHETYPE_LIGHTING[arch];
  return (
    <div className="room-label" style={{ color: light?.point ?? "#fff" }}>
      [{snap.currentCoord}] {info?.split("|")[0]?.replace(/_/g, " ") ?? "?"}
      {snap.roomCleared ? " ✓" : ""}
      {snap.keyHere ? ` · ${snap.keyHere} key here` : ""}
    </div>
  );
}

function DownedOverlay({ me, tick }: { me: PlayerView; tick: number }) {
  const secondsLeft = Math.max(0, Math.ceil((me.downedUntil - tick) / TICK_RATE));
  const reviving = me.reviveProgress > 0;
  return (
    <div className="overlay center downed">
      <div>
        <h1>DOWN</h1>
        <p>{reviving ? "teammate reviving you…" : `bleeding out in ${secondsLeft}s`}</p>
        <p className="dim small">teammates: hold E next to you</p>
      </div>
    </div>
  );
}

const ARCH_CHIP: Record<string, string> = {
  connector: "·",
  puzzle: "P",
  hazard: "H",
  combat: "C",
  sanctuary: "S",
  vault: "V",
  exit: "E",
};

function Minimap({ snap }: { snap: Snapshot }) {
  const layers = [2, 1, 0];
  return (
    <div className="minimap">
      {layers.map((y) => (
        <div key={y} className="mm-layer">
          <div className="mm-title">y{y}</div>
          <div className="mm-grid">
            {[0, 1, 2].map((z) =>
              [0, 1, 2].map((x) => {
                const id = `${x},${y},${z}`;
                const info = snap.revealed.get(id);
                const isCurrent = id === snap.currentCoord;
                const isExit = id === snap.exit && info;
                const arch = info?.split("|")[1] ?? "";
                const light = ARCHETYPE_LIGHTING[arch];
                const others = snap.players.filter(
                  (p) => p.roomCoord === id && !p.downed,
                ).length;
                return (
                  <div
                    key={id}
                    className={`mm-cell ${isCurrent ? "current" : ""} ${info ? "known" : ""}`}
                    style={info ? { color: light?.point ?? "#888" } : undefined}
                    title={info?.split("|")[0] ?? "unknown"}
                  >
                    {isExit ? "X" : info ? ARCH_CHIP[arch] ?? "?" : ""}
                    {others > 0 && !isCurrent ? <span className="mm-dot" /> : null}
                  </div>
                );
              }),
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------- lobby ----------------

function Lobby({ net, snap }: { net: NetClient; snap: Snapshot }) {
  const me = snap.me;
  const taken = new Set(snap.players.filter((p) => p !== me).map((p) => p.charId));
  return (
    <div className="overlay center lobby">
      <div className="panel wide">
        <h1 className="logo">CUBESCAPE</h1>
        <p className="dim">
          Pick a runner. The cube is generated when everyone is ready — it will be
          solvable for <em>this</em> team. Probably.
        </p>
        <div className="char-row">
          {(Object.values(CHARACTERS)).map((c) => {
            const selected = me?.charId === c.id;
            const takenByOther = taken.has(c.id);
            return (
              <button
                key={c.id}
                className={`char-card ${selected ? "selected" : ""}`}
                style={{ borderColor: selected ? c.color : "#333" }}
                onClick={() => net.selectChar(c.id)}
              >
                <div className="char-name" style={{ color: c.color }}>
                  {c.name}
                  {takenByOther ? " ●" : ""}
                </div>
                <div className="char-stats small">
                  HP {c.hp} · SPD {c.speedMult}× · MGT {c.might} · WIT {c.wits}
                </div>
                <ul className="small dim char-abilities">
                  {c.abilities.map((a) => (
                    <li key={a}>{ABILITIES[a].name}</li>
                  ))}
                </ul>
              </button>
            );
          })}
        </div>
        <div className="lobby-footer">
          <div className="roster">
            {snap.players.map((p) => (
              <span key={p.sessionId} className={`roster-chip ${p.ready ? "ready" : ""}`}>
                {p.name} {p.charId ? `(${p.charId})` : ""} {p.ready ? "✓" : "…"}
              </span>
            ))}
          </div>
          <button
            className="ready-btn"
            disabled={!me?.charId}
            onClick={() => net.ready(!me?.ready)}
          >
            {me?.ready ? "UNREADY" : "READY"}
          </button>
        </div>
        <p className="dim small">match starts when every runner is ready</p>
      </div>
    </div>
  );
}

// ---------------- scoreboard ----------------

function Scoreboard({ snap }: { snap: Snapshot }) {
  const sorted = [...snap.players].sort((a, b) => b.exp - a.exp);
  return (
    <div className="overlay center">
      <div className="panel wide">
        <h1>{snap.matchResult === "victory" ? "ESCAPED" : "MATCH OVER"}</h1>
        <table className="score-table">
          <thead>
            <tr>
              <th>runner</th>
              <th>exp</th>
              <th>kills</th>
              <th>deaths</th>
              <th>rooms</th>
              <th>objectives</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => (
              <tr key={p.sessionId}>
                <td style={{ color: CHARACTERS[(p.charId || "scout") as CharId]?.color }}>
                  {p.name}
                </td>
                <td>{p.exp}</td>
                <td>{p.kills}</td>
                <td>{p.deaths}</td>
                <td>{p.roomsVisited}</td>
                <td>{p.objectives}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <button onClick={() => (window.location.href = "/")}>back to base</button>
      </div>
    </div>
  );
}
