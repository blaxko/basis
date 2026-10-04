// The dashboard lives in app/dashboard/page.tsx and is served at /app.
// Its file can't be app/app/page.tsx: when the project root is itself /app
// (Railway's build container), Next's build then renders the dashboard at
// / as well (seen live on 2026-09-29, reproduced in WSL). /dashboard
// redirects to /app, so the dashboard has one address.
// test/landing-and-app.test.ts checks both rules.
//
// htmlLimitedBots matches every client, so each page's title, description
// and link-preview tags are in the <head> of the HTML for everyone, not
// streamed after it (Next 15 streams them on dynamic pages, such as the
// landing page and How it works, to all but a list of known bots).
// Lighthouse and the like read the head. The metadata is static, so this
// delays nothing. test/site-pages.test.ts checks it.

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  htmlLimitedBots: /.*/,
  async rewrites() {
    return [{ source: "/app", destination: "/dashboard" }];
  },
  async redirects() {
    return [{ source: "/dashboard", destination: "/app", permanent: false }];
  },
};

export default nextConfig;
