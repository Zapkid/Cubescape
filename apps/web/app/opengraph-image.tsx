import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt =
  "CubeScape — co-op escape game. Find the exit before it finds you.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const CELLS = [
  "#2dd4bf",
  "#141426",
  "#6ea8fa",
  "#141426",
  "#a78bfa",
  "#141426",
  "#f4566e",
  "#141426",
  "#4ade80",
];

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 72,
          background:
            "radial-gradient(circle at 20% 15%, rgba(45,212,191,0.16), transparent 45%), radial-gradient(circle at 85% 80%, rgba(167,139,250,0.18), transparent 45%), #04040a",
          fontFamily: "monospace",
        }}
      >
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            width: 264,
            height: 264,
            gap: 12,
            padding: 14,
            background: "#0a0a16",
            borderRadius: 28,
            border: "2px solid #26263c",
          }}
        >
          {CELLS.map((c, i) => (
            <div
              key={i}
              style={{
                width: 76,
                height: 76,
                borderRadius: 12,
                background: c,
                boxShadow: c === "#141426" ? "none" : `0 0 34px ${c}`,
              }}
            />
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              fontSize: 92,
              fontWeight: 800,
              letterSpacing: 6,
              backgroundImage:
                "linear-gradient(90deg, #2dd4bf, #6ea8fa, #a78bfa, #f4566e)",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            CUBESCAPE
          </div>
          <div
            style={{
              fontSize: 34,
              letterSpacing: 16,
              color: "#cbd5e1",
              marginTop: 18,
            }}
          >
            FIND THE EXIT
          </div>
          <div style={{ fontSize: 26, color: "#8890a4", marginTop: 26 }}>
            co-op escape · 1–8 players · free in your browser
          </div>
        </div>
      </div>
    ),
    size,
  );
}
