# P0: stop sending personal and request data to Sentry. LIGHT tier.

- PR #326. Head ef2b18f31668c70ade0621cbf8af094857e6bf50. Merge commit 422321cbc28cbc3e028915a3ab741d6e31d91ac3, parents 5b7c588 and ef2b18f (observed, git log).
- CI on PR head: https://github.com/ara-2789/Quoco/actions/runs/37361949018 success on ef2b18f, including "Test (real test-db)" (observed).
- CI on main: https://github.com/ara-2789/Quoco/actions/runs/37408997374 success on 422321c (observed).
- Red run https://github.com/ara-2789/Quoco/actions/runs/37361235622 on b14f122: 1,682 passed, 1 todo; one suite failed in cleanup at test/migration-017.test.ts:101 calling test/helpers/db.ts:1121; Supabase Auth listUsers error printed as {} (observed). It overlapped run 37361949018 on the shared test-db from 19:14 to 19:33 UTC (observed). Cause: test-db contention (inferred, not proven).
- Changes: all three Sentry runtimes set every dataCollection field off (user info, cookies, request and response headers, query params, all http bodies, genAI inputs and outputs, stack-frame variables). lib/observability/scrub-pii.ts on beforeSend, beforeBreadcrumb, beforeSendTransaction, beforeSendSpan, beforeSendLog redacts phone numbers and emails. Call sites stopped passing phone numbers. Internal UUIDs kept.
- Before P0: SDK 10.63.0 applies full collection defaults when dataCollection is {} (observed in installed SDK source). Whether cookies or bodies reached Sentry before P0: not observed either way.
- Red controls (observed in off-repo log /tmp/quoco/p0-sentry-log.txt): scrubber as identity, 26 of 40 fail; hooks as identity, 18 of 24 fail; dataCollection {}, 3 fail; call sites restored to pre-change, 7 of 36 fail, then restored with no source diff. Final local run 100 of 100 pass.
- Prod after-check, 6 Oct about 08:59 IST (observed by Aravind; screenshots seen by Claude): prod SHA 422321c; Additional Data holds only contentTypes ["application/pdf"] and numMedia 1; no IP address field (geography Ashburn = Vercel region iad1, the sending server); no test phone digits; HTTP request shows method, path and host only. WhatsApp reply to the blank PDF was the approved text (per Aravind).
- Limit: the before event also showed no request section. Removal of request data is proven by tests, not by comparing prod events.

## FOLLOW-UPS (all open)

1. 12 thrown error messages embed phone numbers (they also reach Vercel logs).
2. beforeSendMetric not wired; no metric calls exist today.
3. The morning sweep RPC returns no user UUID.
4. npm audit: 17 vulnerabilities, 1 critical, unreviewed.
5. test/helpers/db.ts prints Supabase Auth errors as {}.
6. CI allows two test-db runs at once. Interim rule (per Aravind via review): no push while a test-db job runs.
7. The failed migration-017 cleanup may have left two test tenants on test-db. About six orphan media_ingest jobs with fake URLs remain. Neither verified harmless.
8. The idle nudge says "Your check-in will arrive shortly" at night (observed 12:48 AM IST).
9. Sentry project setting "Prevent Storing of IP Addresses": recommended, not confirmed.
10. test/unit/media-reply.test.ts group title still says "NOT approved" for an approved string.
11. Equipment location (A9).
12. Cofounder confirmation of A10.
13. The 1a plan needs revision with these decisions before P1.
14. Existing image ingest handler has no size cap (O20); separate LIGHT PR.
15. All 1a user-facing strings need wording and approval.
16. A supplier DC sample is still needed (rates on supplier DCs; typing load).
