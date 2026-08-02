"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

function dailyCode(): string {
  const d = new Date();
  const iso = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  return `daily-${iso}`;
}

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [code, setCode] = useState("dev");

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
      <div className="panel wide">
        <h1 className="logo">CUBESCAPE</h1>
        <p className="tagline dim">
          You and your friends are trapped in a 3D cube of deadly puzzle rooms —
          find the exit before it finds you.
        </p>
        <div className="field">
          <label>callsign</label>
          <input
            value={name}
            maxLength={16}
            placeholder="Runner"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="field">
          <label>room code — share it with your crew</label>
          <input
            value={code}
            maxLength={24}
            onChange={(e) => setCode(e.target.value.replace(/[^\w-]/g, ""))}
            onKeyDown={(e) => e.key === "Enter" && go(code || "dev")}
          />
        </div>
        <div className="join-row">
          <button className="primary" onClick={() => go(code || "dev")}>
            ENTER THE CUBE
          </button>
          <button onClick={() => go(dailyCode())}>DAILY SEED</button>
        </div>
        <p className="dim small" style={{ marginTop: 18 }}>
          co-op PvE · 1–8 runners · everyone with the same room code lands in the
          same cube · daily seed is the same cube for the whole world
        </p>
      </div>
    </main>
  );
}
