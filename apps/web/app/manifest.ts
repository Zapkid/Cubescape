import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CubeScape",
    short_name: "CubeScape",
    description:
      "Co-op escape game: you and your friends are trapped in a 3D cube of deadly puzzle rooms — find the exit before it finds you.",
    start_url: "/",
    display: "standalone",
    background_color: "#04040a",
    theme_color: "#04040a",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
