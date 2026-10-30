// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
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

Sentry.init({
  dsn: "https://0ee933a1c02d1564624fb888891080f3@o4511670684483584.ingest.us.sentry.io/4511670692347904",

  // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
  tracesSampleRate: 1,

  // S1: sentry-trace and baggage go to the app's own origin only (NEXT_PUBLIC_APP_URL is inlined at build) and
  // to relative same-origin URLs. Unset, they go to every host. Never leave this undefined.
  tracePropagationTargets: ownOriginTraceTargets(process.env.NEXT_PUBLIC_APP_URL),
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

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
