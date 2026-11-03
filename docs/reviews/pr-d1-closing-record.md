# PR-D1 CLOSING RECORD — 2 Nov 2026
PR #348, merge commit 408a35c042444816cf10733ea66811876da2efbd. Prod: app.quoco.co.in.
Evidence: browser screenshots taken by Aravind, 2 Nov 2026 10:01–10:10 IST, pasted in the PM Page design-review chat. Labelled "observed (per Aravind's screenshots)".

## OBSERVED ON PROD (per Aravind's screenshots; owning PM, D-30 test file)
- GET /api/capture-files/<file_id> -> 302 Found.
- Response headers: Cache-Control: no-store; Referrer-Policy: no-referrer; X-Matched-Path: /api/capture-files/[fileId]; Date: Mon, 02 Nov 2026 04:32:12 GMT.
- Location: <supabase host>/storage/v1/object/sign/<bucket>/<tenant>/<project>/<document>/<file_id>?token=<redacted>. No file extension in the path (C5 decision 3).
- Token claims decoded on Aravind's machine: scope "download"; iat 1793593932 (04:32:12Z); exp 1793593992 (04:33:12Z); TTL 60 s. iat equals the response Date: the URL is minted per request. Matches the design (TTL 60 s, minted on click).
- The same Location URL opened about 3 min later -> 400 InvalidJWT, "exp" claim timestamp check failed.
- Signed out (Incognito, no session), same path -> HTTP 404. WEAKER check: proves no anonymous access; does not prove the PM-only rule.

## OWED
- Signed-in non-PM -> 404 on the same path. Named blocker before the switch trigger.

## OBSERVATIONS (not PR-D1 defects)
- Before 2 Nov ~11:00 IST the file 302 took 4.41 s and the detail page fetch 4.31 s; X-Vercel-Id bom1::iad1 (functions in US East, database in Sydney ap-southeast-2).
- 2 Nov ~11:00 IST, per Aravind: Vercel function region changed to syd1 and main redeployed. After: detail page fetch 1.29 s, list 1.36 s (Aravind's screenshot); signed-out curl x-vercel-id bom1::syd1.
- 2 Nov evening jobs tick after the region change (prod, per Aravind's SQL output): 3 succeeded (created from 14:15:02Z, last completed 15:01:15Z), none pending or failed.
- The D-30 GRN photo displays sideways.

## STATUS
PR-D1 closed with one owed item (signed-in non-PM check).
