import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  turbopack: { root: path.resolve(__dirname) },
  agentRules: false,
  poweredByHeader: false,
  // Employee document uploads (Aadhaar images / PDF up to 4 MB) go through a server action.
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
  // The bill PDF reads its fonts from disk at request time; ship them with that route.
  outputFileTracingIncludes: { "/b/[token]/pdf": ["./src/assets/fonts/*.ttf"] },
};

export default nextConfig;
