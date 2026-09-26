import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: false,
  // The ranking lives on each model's page now.
  redirects: async () => [{ source: "/ranking", destination: "/models", permanent: true }],
  // On Vercel the app seeds /tmp from these (see src/lib/server/data-dir.ts).
  outputFileTracingIncludes: {
    "/**": [".data/vtec.json", ".data/recovery.json", ".data/summaries.json", ".data/harness.log", ".data/builds/**"],
  },
};

export default config;
