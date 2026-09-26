import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: false,
  // The ranking lives on each model's page now.
  redirects: async () => [{ source: "/ranking", destination: "/models", permanent: true }],
};

export default config;
