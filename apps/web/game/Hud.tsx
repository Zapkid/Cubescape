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
import { PixelLogo } from "./PixelLogo";

interface Snapshot {
  phase: string;
  seed: number;
  tick: number;
  startedTick: number;
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
    startedTick: s?.startedTick ?? 0,
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
  const hurtNonce = useGame((s) => s.hurtNonce);
  const [debugOpen, setDebugOpen] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);

  useEffect(() => {
    const t = setInterval(() => {
      const s = snapshot(net);
      setSnap(s);
      if (s.phase === "complete") setFinalSnap(s);
    }, 120);
    return () => clearInterval(t);
  }, [net]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Backquote") setDebugOpen((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
  // late joiner (daily rooms): match is running but we haven't picked a runner
  if (!snap.me.charId) return <LateJoinSelect net={net} snap={snap} />;

  const me = snap.me;
  const def = CHARACTERS[me.charId as CharId];

  return (
    <div className="overlay">
      {/* damage flash — keyed so every hit restarts the animation */}
      {hurtNonce > 0 ? <div key={hurtNonce} className="dmg-flash" /> : null}
      {/* top-left: room + seed + timer + exp */}
      <div className="hud-top-left">
        <RoomLabel snap={snap} />
        <div className="hud-meta small">
          <span className="hud-timer">⏱ {matchClock(snap)}</span>
          <span className="hud-exp">◆ {me.exp} exp</span>
          <ExitCompass snap={snap} />
        </div>
        <div className="dim small">seed {snap.seed} · div {lastCorrection.toFixed(2)}m</div>
        <TeamPanel snap={snap} />
      </div>

      {/* teammate down alert */}
      <DownedAlert snap={snap} />

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
      {pointerLocked ? (
        <div className="dot" />
      ) : (
        <div className="overlay center click-capture">
          <div className="panel dim">click to play</div>
          <div className="pause-menu">
            <button
              onClick={() => {
                document.querySelector("canvas")?.requestPointerLock();
              }}
            >
              ▶ RESUME
            </button>
            <CopyInviteButton />
            <button onClick={() => setDebugOpen((v) => !v)}>
              DEBUG (`)
            </button>
            {confirmEnd ? (
              <button
                className="danger"
                onClick={() => {
                  net.abandon();
                  setConfirmEnd(false);
                }}
              >
                CONFIRM END — banks partial EXP
              </button>
            ) : (
              <button className="danger" onClick={() => setConfirmEnd(true)}>
                END MATCH
              </button>
            )}
            <button
              onClick={() => {
                net.dispose();
                window.location.href = "/";
              }}
            >
              LEAVE TO MENU
            </button>
          </div>
        </div>
      )}
      {debugOpen ? <DebugPanel net={net} snap={snap} /> : null}
      {interactHint ? <div className="interact-hint">{interactHint}</div> : null}

      {/* downed overlay */}
      {me.downed ? <DownedOverlay me={me} tick={snap.tick} /> : null}

      {/* bottom bar: hp, keys, abilities */}
      <div className="hud-bottom">
        <div className="hp-wrap">
          <div className="hp-label">
            <Ekg ratio={me.hp / Math.max(1, me.maxHp)} downed={me.downed} />
            <span>
              {def?.name ?? "?"} · {Math.ceil(me.hp)}/{me.maxHp}
            </span>
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
          <StrikeTile snap={snap} />
          {me.grappleUntil > snap.tick ? (
            <div className="buff-chip">
              GRAPPLE {((me.grappleUntil - snap.tick) / TICK_RATE).toFixed(1)}s
            </div>
          ) : null}
        </div>
        <div className="hint-block dim small">
          WASD move · LMB strike · RMB/E interact · MMB/V ping · 1-3/M4/M5 abilities · T taunt
        </div>
      </div>
    </div>
  );
}

/** the teaser's heartbeat motif: EKG trace that speeds up and reddens as HP drops */
function CopyInviteButton() {
  const [copied, setCopied] = useState(false);
  return (
    <button
      style={copied ? { borderColor: "#4ade80", color: "#4ade80" } : undefined}
      onClick={() => {
        navigator.clipboard
          .writeText(window.location.origin + window.location.pathname)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          })
          .catch(() => undefined);
      }}
    >
      {copied ? "✓ LINK COPIED" : "COPY INVITE LINK"}
    </button>
  );
}

function Ekg({ ratio, downed }: { ratio: number; downed: boolean }) {
  const color = downed ? "#f43f5e" : ratio > 0.6 ? "#4ade80" : ratio > 0.3 ? "#f59e0b" : "#f43f5e";
  const duration = downed ? "3s" : ratio > 0.6 ? "1.5s" : ratio > 0.3 ? "1s" : "0.55s";
  const points = downed
    ? "0,12 64,12" // flatline
    : "0,12 16,12 21,12 25,7 29,19 33,2 37,17 41,12 64,12";
  return (
    <svg className="ekg" viewBox="0 0 64 24" width="46" height="18" aria-hidden>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2.2"
        strokeLinejoin="round"
        strokeLinecap="round"
        style={{ animationDuration: duration }}
      />
    </svg>
  );
}

function matchClock(snap: Snapshot): string {
  const secs = Math.max(0, Math.floor((snap.tick - snap.startedTick) / TICK_RATE));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** direction hints toward the exit corner, e.g. "EXIT → E2 S1 U2" */
function ExitCompass({ snap }: { snap: Snapshot }) {
  const [cx, cy, cz] = snap.currentCoord.split(",").map(Number);
  const [ex, ey, ez] = snap.exit.split(",").map(Number);
  if ([cx, cy, cz, ex, ey, ez].some((n) => Number.isNaN(n))) return null;
  const dx = (ex ?? 0) - (cx ?? 0);
  const dy = (ey ?? 0) - (cy ?? 0);
  const dz = (ez ?? 0) - (cz ?? 0);
  if (dx === 0 && dy === 0 && dz === 0) {
    return <span className="hud-compass here">EXIT: THIS ROOM</span>;
  }
  const parts: string[] = [];
  if (dx !== 0) parts.push(`${dx > 0 ? "E" : "W"}${Math.abs(dx)}`);
  if (dz !== 0) parts.push(`${dz > 0 ? "S" : "N"}${Math.abs(dz)}`);
  if (dy !== 0) parts.push(`${dy > 0 ? "U" : "D"}${Math.abs(dy)}`);
  return <span className="hud-compass">EXIT → {parts.join(" ")}</span>;
}

/** teammate cards: char color, hp, where they are, downed state */
function TeamPanel({ snap }: { snap: Snapshot }) {
  const mates = snap.players.filter(
    (p) => p.sessionId !== snap.me?.sessionId && p.charId,
  );
  if (mates.length === 0) return null;
  return (
    <div className="team-panel">
      {mates.map((p) => {
        const color = CHARACTERS[(p.charId || "scout") as CharId]?.color ?? "#ccc";
        const together = p.roomCoord === snap.currentCoord;
        return (
          <div key={p.sessionId} className={`team-card ${p.downed ? "down" : ""}`}>
            <span className="team-dot" style={{ background: color }} />
            <div className="team-info">
              <div className="team-name" style={{ color }}>
                {p.name}
                {!p.connected ? " ⌁" : ""}
              </div>
              <div className="team-hp-bar">
                <div
                  className="team-hp-fill"
                  style={{
                    width: `${(100 * p.hp) / Math.max(1, p.maxHp)}%`,
                    background: p.downed
                      ? "#f43f5e"
                      : p.hp / p.maxHp > 0.35
                        ? "#4ade80"
                        : "#f59e0b",
                  }}
                />
              </div>
              <div className="team-where dim">
                {p.downed ? "DOWN — " : ""}
                {together ? "with you" : `[${p.roomCoord}]`}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** loud banner when a teammate needs a revive */
function DownedAlert({ snap }: { snap: Snapshot }) {
  const down = snap.players.find(
    (p) => p.sessionId !== snap.me?.sessionId && p.downed,
  );
  if (!down) return null;
  const together = down.roomCoord === snap.currentCoord;
  return (
    <div className="downed-alert">
      ⚠ {down.name} is DOWN {together ? "— hold E to revive!" : `in [${down.roomCoord}]`}
    </div>
  );
}

/** the universal LMB strike, slot 3 */
function StrikeTile({ snap }: { snap: Snapshot }) {
  const me = snap.me;
  if (!me) return null;
  const a = ABILITIES.punch;
  const cdUntil = me.cooldowns[3] ?? 0;
  const remaining = Math.max(0, (cdUntil - snap.tick) / TICK_RATE);
  const pct = Math.min(1, remaining / a.cooldown);
  return (
    <div className={`ability compact ${remaining > 0 ? "cooling" : ""}`}>
      <div className="ability-key">LMB</div>
      <div className="ability-name">{a.name}</div>
      {remaining > 0 ? (
        <div className="ability-cd" style={{ height: `${pct * 100}%` }} />
      ) : null}
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
        <h1 className="logo-mark centered">
          <PixelLogo height={40} />
          <span className="find-exit">FIND THE EXIT</span>
        </h1>
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

// ---------------- late join (daily rooms) ----------------

function LateJoinSelect({ net, snap }: { net: NetClient; snap: Snapshot }) {
  return (
    <div className="overlay center lobby">
      <div className="panel wide">
        <h1 className="logo-mark centered">
          <PixelLogo height={36} />
          <span className="find-exit">MATCH IN PROGRESS</span>
        </h1>
        <p className="dim">
          This cube is already being run (seed {snap.seed}). Pick a runner and
          drop in — teammates on the map are marked in green.
        </p>
        <div className="char-row">
          {Object.values(CHARACTERS).map((c) => (
            <button
              key={c.id}
              className="char-card"
              style={{ borderColor: c.color }}
              onClick={() => net.selectChar(c.id)}
            >
              <div className="char-name" style={{ color: c.color }}>
                {c.name}
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
          ))}
        </div>
        <p className="dim small">click a runner to spawn immediately</p>
      </div>
    </div>
  );
}

// ---------------- tester debug panel ----------------

function DebugPanel({ net, snap }: { net: NetClient; snap: Snapshot }) {
  const g = useGame.getState();
  const [copied, setCopied] = useState("");
  const room = snap.me ? net.state?.rooms.get(snap.me.roomCoord) : null;
  let mobsAlive = 0;
  room?.mobs.forEach((m) => {
    if (!m.friendly && m.hp > 0) mobsAlive++;
  });
  const copy = (label: string, text: string) => {
    navigator.clipboard.writeText(text).then(
      () => setCopied(label),
      () => setCopied("copy failed"),
    );
    setTimeout(() => setCopied(""), 1500);
  };
  return (
    <div className="debug-panel">
      <div className="debug-title">
        DEBUG <span className="dim">— ` to close</span>
        {copied ? <span className="debug-copied">{copied} ✓</span> : null}
      </div>
      <table className="debug-table">
        <tbody>
          <tr><td>fps / rtt</td><td>{Math.round(net.fps)} / {Math.round(net.rttMs)}ms</td></tr>
          <tr><td>seed · tick</td><td>{snap.seed} · {snap.tick}</td></tr>
          <tr><td>phase</td><td>{snap.phase} {snap.matchResult}</td></tr>
          <tr><td>room</td><td>{snap.currentCoord} ({room?.templateId ?? "?"}{room?.cleared ? " ✓" : ""})</td></tr>
          <tr><td>pos</td><td>{g.px.toFixed(2)}, {g.pz.toFixed(2)} · yaw {g.yaw.toFixed(2)}</td></tr>
          <tr><td>divergence</td><td>{g.lastCorrection.toFixed(3)}m</td></tr>
          <tr><td>hp / keys</td><td>{snap.me ? `${Math.ceil(snap.me.hp)}/${snap.me.maxHp}` : "-"} · [{snap.me?.keys.join(", ") ?? ""}]</td></tr>
          <tr><td>mobs in room</td><td>{mobsAlive}</td></tr>
          <tr><td>doors</td><td>{room?.doors.map((d) => `${d.face}:${d.gateType}${d.open ? "✓" : "✗"}`).join(" ") ?? "-"}</td></tr>
          <tr><td>players</td><td>{snap.players.map((p) => `${p.name}@${p.roomCoord}${p.downed ? "↓" : ""}`).join(" · ")}</td></tr>
        </tbody>
      </table>
      <div className="debug-events">
        {net.eventLog.slice(-8).map((l, i) => (
          <div key={i} className="debug-event">
            <span className="dim">{((Date.now() - l.at) / 1000).toFixed(0)}s</span>{" "}
            {l.e.t}
            {typeof l.e.text === "string" ? `: ${l.e.text}` : ""}
          </div>
        ))}
      </div>
      <div className="debug-actions">
        <button onClick={() => copy("report", net.debugReport())}>
          COPY BUG REPORT
        </button>
        <button
          onClick={() =>
            copy(
              "link",
              `${window.location.origin}${window.location.pathname}?seed=${snap.seed}`,
            )
          }
        >
          COPY SEED LINK
        </button>
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
