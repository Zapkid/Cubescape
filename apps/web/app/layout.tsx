import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CubeScape",
  description:
    "You and your friends are trapped in a 3D cube of deadly puzzle rooms — find the exit before it finds you.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
