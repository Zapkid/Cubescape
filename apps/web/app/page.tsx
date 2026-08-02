"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PixelLogo } from "../game/PixelLogo";

function dailyCode(): string {
  const d = new Date();
  const iso = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  return `daily-${iso}`;
}

const CHARS = [
  { name: "Brute", color: "#e2574c", blurb: "HP 140 · breach walls, hold plates" },
  { name: "Scout", color: "#4cc9e2", blurb: "SPD 1.25× · grapple pits, read doors" },
  { name: "Tinker", color: "#e2c94c", blurb: "WIT 8 · hotwire locks, power lifts" },
];

/** which cells glow on each cube face, keyed by archetype color */
const FACE_CELLS: { color: string; cells: number[] }[] = [
  { color: "#2dd4bf", cells: [0, 4, 7] }, // puzzle
  { color: "#f43f5e", cells: [2, 3, 8] }, // hazard
  { color: "#f59e0b", cells: [1, 5] }, // combat
  { color: "#a78bfa", cells: [4, 6] }, // vault
  { color: "#4ade80", cells: [8] }, // exit
  { color: "#fbbf24", cells: [4] }, // sanctuary
];

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [code, setCode] = useState("dev");
  const daily = useMemo(dailyCode, []);

  useEffect(() => {
    const saved = localStorage.getItem("cubescape:name");
    if (saved) setName(saved);
  }, []);

  const go = (target: string) => {
    const n = name.trim() || "Runner";
    localStorage.setItem("cubescape:name", n);
    router.push(`/match/${encodeURIComponent(target)}?name=${encodeURIComponent(n)}`);
  };

  return (
    <main className="landing">
      <div className="landing-grid" aria-hidden />
      <div className="landing-inner">
        <section className="hero">
          <div className="cube-scene" aria-hidden>
            <div className="cube3d">
              {FACE_CELLS.map((face, i) => (
                <div key={i} className={`cube-face face-${i}`}>
                  {Array.from({ length: 9 }, (_, c) => (
                    <span
                      key={c}
                      className="cube-cell"
                      style={
                        face.cells.includes(c)
                          ? {
                              background: face.color,
                              boxShadow: `0 0 12px ${face.color}`,
                              opacity: 0.9,
                            }
                          : undefined
                      }
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
          <h1 className="logo-mark">
            <PixelLogo height={54} />
            <span className="find-exit">FIND THE EXIT</span>
          </h1>
          <p className="tagline">
            You and your friends are trapped in a 3D cube of deadly puzzle rooms.
            <br />
            <em>Find the exit before it finds you.</em>
          </p>
          <div className="char-chips">
            {CHARS.map((c) => (
              <div key={c.name} className="char-chip" style={{ borderColor: c.color }}>
                <span className="char-chip-dot" style={{ background: c.color }} />
                <div>
                  <div className="char-chip-name" style={{ color: c.color }}>
                    {c.name}
                  </div>
                  <div className="char-chip-blurb">{c.blurb}</div>
                </div>
              </div>
            ))}
          </div>
          <ul className="feature-line dim">
            <li>server-authoritative co-op · 1–8 runners</li>
            <li>every cube seeded &amp; proven solvable for your team</li>
            <li>doors that need two of you — bring friends, or a plan</li>
          </ul>
        </section>

        <section className="join-card">
          <h2 className="join-title">DEPLOY A RUNNER</h2>
          <div className="field">
            <label htmlFor="callsign">callsign</label>
            <input
              id="callsign"
              value={name}
              maxLength={16}
              placeholder="Runner"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="roomcode">room code — same code, same cube</label>
            <input
              id="roomcode"
              value={code}
              maxLength={24}
              onChange={(e) => setCode(e.target.value.replace(/[^\w-]/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && go(code || "dev")}
            />
          </div>
          <button className="cta-primary" onClick={() => go(code || "dev")}>
            ENTER THE CUBE
            <span className="cta-sub">co-op · room “{code || "dev"}”</span>
          </button>
          <button className="cta-secondary" onClick={() => go(daily)}>
            DAILY SEED
            <span className="cta-sub">one cube, the whole world, today</span>
          </button>
          <p className="join-foot dim small">
            WASD + mouse · E interact · abilities on 1–3 · nobody escapes alone*
            <br />
            <span className="dimmer">*technically solvable solo. we checked. 5000 times.</span>
          </p>
        </section>
      </div>
    </main>
  );
}
