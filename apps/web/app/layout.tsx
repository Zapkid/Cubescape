import type { Metadata, Viewport } from "next";
import "./globals.css";

const SITE_URL = "https://cubescape-seven.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "CubeScape — co-op escape the cube",
    template: "%s · CubeScape",
  },
  description:
    "You and your friends are trapped in a 3D cube of deadly puzzle rooms — find the exit before it finds you. Free browser co-op for 1–8 players: seeded, provably-solvable dungeons, three interlocking classes, server-authoritative multiplayer.",
  applicationName: "CubeScape",
  keywords: [
    "co-op game",
    "browser game",
    "multiplayer puzzle game",
    "escape game",
    "roguelite",
    "free online game",
    "three.js game",
    "play with friends",
  ],
  authors: [{ name: "Rowan Kendal" }],
  category: "game",
  robots: { index: true, follow: true },
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: "CubeScape",
    title: "CubeScape — find the exit before it finds you",
    description:
      "Free browser co-op escape game for 1–8 players. Every cube is seeded and proven solvable for your team — some doors need two of you.",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "CubeScape — co-op escape the cube",
    description:
      "Free browser co-op escape game. You and your friends vs a 3×3×3 cube of deadly puzzle rooms.",
  },
};

export const viewport: Viewport = {
  themeColor: "#04040a",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
