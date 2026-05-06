import type { NextConfig } from "next";

// CSP with per-request nonces is handled in src/proxy.ts (middleware).
// These static headers complement it but do not include CSP.
const securityHeaders = [
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
];

const supabaseHostname = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')
  .replace(/^https?:\/\//, '')
  .split('/')[0]

const nextConfig: NextConfig = {
  reactCompiler: true,
  devIndicators: {
    position: 'bottom-right',
  },
  images: {
    remotePatterns: supabaseHostname
      ? [{ protocol: 'https', hostname: supabaseHostname }]
      : [],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/ingest/static/:path*",
        destination: "https://eu-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/ingest/array/:path*",
        destination: "https://eu-assets.i.posthog.com/array/:path*",
      },
      {
        source: "/ingest/:path*",
        destination: "https://eu.i.posthog.com/:path*",
      },
    ];
  },
  productionBrowserSourceMaps: true,
  skipTrailingSlashRedirect: true,
};

export default nextConfig;
