import type { NextConfig } from "next";
import { networkInterfaces } from "node:os";

// Allow the machine’s own LAN addresses for phone/tablet play in development.
const lanHosts = Object.values(networkInterfaces()).flatMap((addresses) =>
  (addresses ?? []).filter((address) => address.family === "IPv4" && !address.internal)
    .map((address) => address.address),
);

const nextConfig: NextConfig = {
  allowedDevOrigins: lanHosts,
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
};

export default nextConfig;
