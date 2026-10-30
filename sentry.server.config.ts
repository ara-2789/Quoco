// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import {
  scrubBreadcrumb,
  scrubErrorEvent,
  scrubLog,
  scrubSpan,
  scrubTransactionEvent,
} from "./lib/observability/scrub-pii";
import { ownOriginTraceTargets } from "./lib/observability/trace-targets";
import { tracesSampler } from "./lib/observability/traces-sampler";

Sentry.init({
  dsn: "https://0ee933a1c02d1564624fb888891080f3@o4511670684483584.ingest.us.sentry.io/4511670692347904",

  // S1: the tick (GET /api/jobs/tick) is sampled at 0.02, everything else at 1. Quota control only, not a
  // privacy control; see traces-sampler.ts for the match mechanism and the cron check-in note. A
  // tracesSampler replaces tracesSampleRate (never set both).
  tracesSampler,

  // S1: sentry-trace and baggage go to the app's own origin only. Unset, they go to every host (Twilio,
  // Supabase, Anthropic, Resend). Never leave this undefined.
  tracePropagationTargets: ownOriginTraceTargets(process.env.NEXT_PUBLIC_APP_URL),

  // S1: @sentry/nextjs init() sets NEXT_OTEL_FETCH_DISABLED=1 unless skipOpenTelemetrySetup is set, which
  // keeps Next's AppRender.fetch span (full URL in its name and http.url) from shipping. Setting
  // skipOpenTelemetrySetup re-opens that span. test/unit/sentry-outgoing-url-envelope.test.ts asserts the
  // flag; do not set skipOpenTelemetrySetup without re-running it.

  // Enable logs to be sent to Sentry
  enableLogs: true,

  // P0: an empty dataCollection object makes the SDK collect everything
  // (user info, cookies, headers, query params, request/response bodies,
  // stack-frame variables). Every field is set explicitly instead.
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#dataCollection
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: { request: false, response: false },
    httpBodies: [],
    queryParams: false,
    genAI: { inputs: false, outputs: false },
    stackFrameVariables: false,
  },

  // Backstop: redact phone numbers and emails from anything still sent.
  beforeSend: scrubErrorEvent,
  beforeBreadcrumb: scrubBreadcrumb,
  beforeSendTransaction: scrubTransactionEvent,
  beforeSendSpan: scrubSpan,
  beforeSendLog: scrubLog,
});
