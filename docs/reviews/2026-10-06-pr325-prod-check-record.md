# PR #325 prod check record

PR #325 prod check, 6 Oct 2026, 00:47–00:48 IST. Observed by Aravind; screenshots seen by Claude.

- Prod deployment SHA 5b7c588b58ed7e86498fd7d1e16d523de1f89ba7 (observed, gh deployments API).
- PDF sent outside any check-in: reply "This file type isn't supported yet. Nothing was saved. Please send a photo instead." at 12:47 AM (observed, screenshot).
- Photo sent outside any check-in: the idle nudge, not the unsupported-file reply, at 12:48 AM (observed, screenshot). Positive control for the image gate.
- Prod row counts before and after: jobs where type = 'media_ingest' 9 and 9; daily_log_photos 9 and 9 (observed, SQL run by Aravind).
- Sentry event "Unsupported inbound media", level warning, POST /api/whatsapp/webhook: content types and count present; no request section with cookies, headers or body found; no test phone digits; a US IP address present; no user section (observed by Aravind).
- Not tested on prod: missing content type (strict option A). A phone cannot produce it.
- The test used real documents (a client design-report PDF and an RCPL company-profile image). Quoco saved nothing. Future prod checks use blank files.
- Planned change (2026-10-06): from slice 1a, PDFs are accepted in the material-inward flow, and a PDF with no active flow gets the idle nudge. Not built. Until 1a ships, the behaviour above stands on prod.
