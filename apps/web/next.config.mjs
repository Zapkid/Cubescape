/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@cubescape/shared", "three"],
  poweredByHeader: false,
  webpack: (config) => {
    // shared package uses ESM ".js" specifiers that resolve to .ts sources
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
  async headers() {
    // next dev needs eval + HMR websockets; only enforce CSP in production
    if (process.env.NODE_ENV === "development") return [];
    if (process.env.DISABLE_CSP === "1") return []; // debug switch
    const csp = [
      "default-src 'self'",
      // 'unsafe-inline': Next.js inlines bootstrap scripts (no nonce infra yet).
      // blob:: troika-three-text (drei <Text>) importScripts() blob: URLs INSIDE
      // its worker; worker-internal loads are governed by script-src, and
      // blocking them kills the entire R3F scene (black screen, HUD alive).
      "script-src 'self' 'unsafe-inline' blob:",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      // colyseus matchmake (https) + game socket (wss); jsdelivr hosts the
      // unicode-font-resolver data troika fetches for <Text> glyphs
      "connect-src 'self' https://cubescape-server.fly.dev wss://cubescape-server.fly.dev https://vitals.vercel-insights.com https://cdn.jsdelivr.net",
      // troika text renders glyphs in a blob worker
      "worker-src 'self' blob:",
      "media-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; ");
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains",
          },
          { key: "X-DNS-Prefetch-Control", value: "on" },
        ],
      },
    ];
  },
};

export default nextConfig;
