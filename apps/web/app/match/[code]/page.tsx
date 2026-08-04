"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { NetClient } from "../../../game/net";
import { Hud } from "../../../game/Hud";
import { attachInput } from "../../../game/input";
import { useGame } from "../../../game/store";

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
  const [statusMsg, setStatusMsg] = useState("connecting…");
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
    const charParam = search.get("char");
    const char =
      charParam === "brute" || charParam === "scout" || charParam === "tinker"
        ? charParam
        : null;
    net
      .connect(code, name, char, seed, setStatusMsg)
      .then(() => {
        setStatus("up");
        attachInput();
        // e2e/testing aid: ?char=scout&autoready=1 skips the lobby
        if (char && search.get("autoready") === "1") {
          setTimeout(() => net.ready(true), 400);
        }
        // dev/e2e introspection hook
        (window as unknown as Record<string, unknown>).__cubescape = {
          net,
          setLook: (yaw: number, pitch: number) => useGame.getState().setLook(yaw, pitch),
        };
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
            The game server didn&apos;t respond — it may still be waking from
            sleep. Try again in a moment.
            {process.env.NEXT_PUBLIC_SERVER_URL ? null : (
              <>
                {" "}
                (local dev: <code>pnpm dev</code> starts it on :2567)
              </>
            )}
          </p>
          <button onClick={() => window.location.reload()}>retry</button>
        </div>
      </main>
    );
  }

  return (
    <main style={{ position: "fixed", inset: 0 }}>
      {/* The Canvas must mount on the initial client render: mounting it after an
          async state flip (post-connect) leaves the R3F reconciler root dead —
          HUD visible, scene permanently black. GameScene renders nothing until
          the connection is live, so early mounting is free. */}
      <GameCanvas net={net} />
      <Hud net={net} />
      {/* visibility-toggled (not mount-toggled) to keep the child list stable */}
      <div className="overlay center" style={{ display: status === "up" ? "none" : "flex" }}>
        <div className="panel dim">{statusMsg}</div>
      </div>
    </main>
  );
}
