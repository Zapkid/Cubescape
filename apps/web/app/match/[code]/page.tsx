"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { NetClient } from "../../../game/net";
import { Hud } from "../../../game/Hud";
import { attachInput } from "../../../game/input";

const GameCanvas = dynamic(
  () => import("../../../game/GameCanvas").then((m) => m.GameCanvas),
  { ssr: false },
);

/** daily-YYYYMMDD codes map to a deterministic world seed */
function seedFromCode(code: string): number | undefined {
  if (!code.startsWith("daily-")) return undefined;
  let h = 2166136261;
  for (const ch of code) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 2 ** 31;
}

export default function MatchPage() {
  const params = useParams<{ code: string }>();
  const search = useSearchParams();
  const [net] = useState(() => new NetClient());
  const [status, setStatus] = useState<"connecting" | "up" | "failed">("connecting");
  const joined = useRef(false);

  useEffect(() => {
    if (joined.current) return;
    joined.current = true;
    const code = params.code ?? "dev";
    const name =
      search.get("name") ??
      (typeof window !== "undefined"
        ? (localStorage.getItem("cubescape:name") ?? "Runner")
        : "Runner");
    const seedParam = search.get("seed");
    const seed = seedParam ? Number(seedParam) : seedFromCode(code);
    net
      .connect(code, name, null, seed)
      .then(() => {
        setStatus("up");
        attachInput();
        // dev/e2e introspection hook
        (window as unknown as Record<string, unknown>).__cubescape = { net };
      })
      .catch(() => setStatus("failed"));
    return () => net.dispose();
  }, [net, params.code, search]);

  if (status === "failed") {
    return (
      <main className="landing">
        <div className="panel">
          <h2>Can&apos;t reach the cube</h2>
          <p className="dim">
            Is the server running? <code>pnpm dev</code> starts it on :2567.
          </p>
          <button onClick={() => window.location.reload()}>retry</button>
        </div>
      </main>
    );
  }

  return (
    <main style={{ position: "fixed", inset: 0 }}>
      {status === "up" ? (
        <>
          <GameCanvas net={net} />
          <Hud net={net} />
        </>
      ) : (
        <div className="overlay center">
          <div className="panel dim">connecting…</div>
        </div>
      )}
    </main>
  );
}
