"use client";

/** Pixel-font wordmark matching the teaser end card — pure SVG, no font assets.
 *  5×7 pixel glyphs, teal→violet→red gradient across the word. */

const GLYPHS: Record<string, string[]> = {
  C: [".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
};

const CELL = 4; // px per pixel-cell in the viewBox
const GAP = 1; // cells between letters

export function PixelLogo({
  word = "CUBESCAPE",
  height = 56,
  className,
}: {
  word?: string;
  height?: number;
  className?: string;
}) {
  const letters = word
    .toUpperCase()
    .split("")
    .filter((ch) => GLYPHS[ch]);
  const widthCells = letters.length * (5 + GAP) - GAP;
  const w = widthCells * CELL;
  const h = 7 * CELL;

  const rects: { x: number; y: number }[] = [];
  letters.forEach((ch, li) => {
    const glyph = GLYPHS[ch]!;
    const ox = li * (5 + GAP);
    glyph.forEach((row, gy) => {
      row.split("").forEach((cell, gx) => {
        if (cell === "#") rects.push({ x: (ox + gx) * CELL, y: gy * CELL });
      });
    });
  });

  return (
    <svg
      className={className}
      viewBox={`0 0 ${w} ${h}`}
      height={height}
      width={(height / h) * w}
      role="img"
      aria-label={word}
      style={{ display: "block", maxWidth: "100%" }}
      shapeRendering="crispEdges"
    >
      <defs>
        <linearGradient id="cubegrad" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={w} y2="0">
          <stop offset="0%" stopColor="#2dd4bf" />
          <stop offset="38%" stopColor="#6ea8fa" />
          <stop offset="66%" stopColor="#a78bfa" />
          <stop offset="100%" stopColor="#f4566e" />
        </linearGradient>
      </defs>
      {rects.map((r, i) => (
        <rect
          key={i}
          x={r.x + 0.35}
          y={r.y + 0.35}
          width={CELL - 0.7}
          height={CELL - 0.7}
          fill="url(#cubegrad)"
        />
      ))}
    </svg>
  );
}
