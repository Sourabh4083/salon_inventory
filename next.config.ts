import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  turbopack: { root: path.resolve(__dirname) },
  agentRules: false,
  poweredByHeader: false,
};

export default nextConfig;
