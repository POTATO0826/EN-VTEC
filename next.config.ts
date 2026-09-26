import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: false,
  // The ranking lives on each model's page now.
  redirects: async () => [{ source: "/ranking", destination: "/models", permanent: true }],
  // Track specs are read at runtime; data starts empty on Vercel (see src/lib/server/data-dir.ts).
  outputFileTracingIncludes: {
    "/**": ["tracks/**"],
  },
};

export default config;
