// The dashboard lives in app/dashboard/page.tsx and is served at /app.
// Its file can't be app/app/page.tsx: when the project root is itself /app
// (Railway's build container), Next's build then renders the dashboard at
// / as well (seen live on 2026-09-29, reproduced in WSL). /dashboard
// redirects to /app, so the dashboard has one address.
// test/landing-and-app.test.ts checks both rules.

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: "/app", destination: "/dashboard" }];
  },
  async redirects() {
    return [{ source: "/dashboard", destination: "/app", permanent: false }];
  },
};

export default nextConfig;
