import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  turbopack: { root: path.resolve(__dirname) },
  agentRules: false,
  poweredByHeader: false,
  // Employee document uploads (Aadhaar images / PDF up to 4 MB) go through a server action.
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
};

export default nextConfig;
