import { withSentryConfig } from "@sentry/nextjs";
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
    // Decisión deliberada (2026-06-13): sin Image Optimization de Vercel — el
    // catálogo es tráfico anónimo y el plan actual (Hobby) no banca la cuota de
    // transformaciones. Fuente única de verdad: antes vivía como `unoptimized`
    // suelto en 11 componentes. Si se sube a Vercel Pro, borrar esta línea y los
    // srcset/AVIF vuelven solos (remotePatterns ya está listo para Supabase).
    unoptimized: true,
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
  skipTrailingSlashRedirect: true,
};

export default withSentryConfig(nextConfig, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "ssseba",

  project: "javascript-nextjs",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Uncomment to route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  // tunnelRoute: "/monitoring",

  webpack: {
    // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
    // See the following for more information:
    // https://docs.sentry.io/product/crons/
    // https://vercel.com/docs/cron-jobs
    automaticVercelMonitors: true,

    // Tree-shaking options for reducing bundle size
    treeshake: {
      // Automatically tree-shake Sentry logger statements to reduce bundle size
      removeDebugLogging: true,
    },
  },
});
