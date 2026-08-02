/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@cubescape/shared", "three"],
  webpack: (config) => {
    // shared package uses ESM ".js" specifiers that resolve to .ts sources
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
