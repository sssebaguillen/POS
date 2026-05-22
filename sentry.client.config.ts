import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://b15d89b88f20deeaa47e6bc626fc9f03@o4511436124323840.ingest.de.sentry.io/4511436130811984",
  environment: process.env.NODE_ENV,
  tracesSampleRate: 1,
  sendDefaultPii: false,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
