S1 Rev 3 — external review, round 2
Pins and scope
Rev 3: sha256 a321881a…9797, 618 lines. Matches your manifest.
Base: still 594e006c5c753849660ea52ac75a5f0c11eec75e. I re-ran git ls-remote last round. No new commits are claimed.
Read in full: J, K, L and the Unknowns list.
Spot-checked: the struck text that J supersedes (A2, C2 #4, D).
Not attached: s1-rev3-log.txt, s1-plan-delta.md and s1-rev2-log.txt. Only Rev 3 and the manifest came through. K’s last row says they “exist locally”. A file on your machine is not evidence I can read, so the “raw output” behind L’s VERIFIED rows is still a claim from where I sit.
This doesn’t hold up the design. I checked the load-bearing L rows against the same tarballs I used last round, and they hold.
It does hold up the package stage. Attach all three files then.
My errors, owned
N1 citation: I gave request.js:112 with no package path. The file is @sentry/browser/build/npm/cjs/prod/tracing/request.js:112 (ESM build :110), which reads targetUrl.match(/^\/(?!\/)/). You checked @sentry/core/build/cjs/utils/request.js, a different file. Your “no ^\/(?! across @sentry/*” grep also missed four hits, most likely on regex escaping. grep -rnF '/^\/(?!\/)/' finds them. Strike the NOT VERIFIED in L and A4. This was a citation-ambiguity error, mine.
Q3: I stated “Vercel cron sends no sentry-trace” as fact with no source. That’s an assertion. It isn’t load-bearing, because the inherit rule costs quota, not privacy. Keep it NOT VERIFIED.
S4: last_error was wrong. Your correction to outbound_sends.error stands.
Your NOT VERIFIED list, items I can now close or pin
Sampling runs before CRON_SECRET: VERIFIED.
Sampling happens when the root span starts at base-server.js:477 (shouldSample).
isCronRequestAuthorized runs inside the route handler, at app/api/jobs/tick/route.ts:296, which is inside that span.
Merge is deploy: not verifiable from here.
vercel.json has no git.deploymentEnabled override.
Whether the Vercel project deploys main to production is a project setting. You check Vercel → Settings → Git → Production Branch.
It doesn’t affect the design. It does decide what “merge one full day before D-30” means in §H.
Twilio 404 wording: stays unverified. Make it irrelevant: D5 should match on structure (a /2010-04-01/Accounts/ prefix, plus the SID regex), not on Twilio’s prose.
Ruling on your two choices

J3, the D1 pass also reduces request.url: accept, but the reason needs correcting.

It isn’t incidental. It’s D1 working as specified: the skip set never contained request. The Rev 2 sentence claiming otherwise was the error, and J3 strikes it correctly.
Record the cost in §E. Client error events lose the page path in request.url. The route still survives in the event’s transaction. That’s my reading of browser tracing; your RED run on the client side won’t show it, so mark it unverified.
Re-scope S1b in words. “S1b shrinks” is not a scope. What remains is the relative-URL page surfaces D1 cannot see:
navigation breadcrumb data.from / data.to;
pageload and navigation transaction names, if they carry a query.
Name those in the §I row.

J5, an exported traversal with { skip, stopDescent }: accept, with three conditions.

The positive frame-plus-phone assertion runs through production scrubErrorEvent, not through the seam. Then the production hooks are pinned by behaviour, and the separate “pin hooks to defaults” test becomes unnecessary. Drop it if it’s an identity or closure check, because those can’t see a default argument.
Only the two controls call the seam with altered config.
The seam reads no env var and is reachable from no Sentry option. stopDescent: true is a P0 regression by design and must exist only as a test argument.
Findings

B2 — Rev 3 dropped Rev 2’s relative-URL rule without flagging it, so relative outgoing URLs keep their query strings.

What changed:
Rev 2 A2 had relative -> [same-origin].
J1 Tier 1 now says “a relative value is left alone”.
Tier 2 deletes only url.path, http.target and url.template.
Neither tier touches a relative url.
Where the SDK puts a relative URL with its query:
Browser fetch span: @sentry/core/build/cjs/fetch.js:191 sets url: <raw input>, so /api/x?tenant_id=… keeps its query. http.url and server.address are set only when the URL is absolute (:198-200). The rename guard therefore finds no host and leaves the description, and the url key ships with the query.
Browser breadcrumbs: @sentry/browser/.../integrations/breadcrumbs.js:144-147 (xhr) and :186/:206 (fetch) carry the raw url the same way.
D1: cannot see any of these, because there is no scheme.
What leaks today: I found no client component calling fetch on an /api/...? path. Next’s router does issue RSC fetches (<path>?_rsc=…), and the path is the page path. So today’s real payload is small.
Why it still blocks: the decided scope is default-deny for every outgoing http breadcrumb and span. Rev 3 reopened a hole that Rev 2 had closed, and nothing in K or the dated notes says so. That is the silent-drop class.
Fix:
Tier 1: for url, url.full and http.url, a relative value gets query and fragment stripped and keeps its path, the same rule as http.target.
Tier 2: a relative value becomes [same-origin], which restores Rev 2’s rule.
Strike J1’s sentence with a date.
Test: a C5 unit row for a fetch span and an xhr breadcrumb, each with url: '/api/x?tenant_id=S1CANARY_QUERY#f'.
Tier 2 output must be [same-origin].
The canary must be absent.
Control: URL_SCRUB_CONTROL=identity makes it fail.

S6 — J2’s control can’t fail through the pipeline.

The problem: the Rev 2 transcription is applied “to the captured span JSON before assertion 1”. That proves a byte-identity assertion notices a rename. It doesn’t prove the envelope test would catch a classifier that renames inside beforeSendSpan, which is the B1 failure.
Fix: keep the control test-only, but put it in the pipeline.
Export the classifier from scrub-url.ts.
Under CLASSIFIER_CONTROL=rev2, vi.mock that module and swap in the Rev 2 presence-based classifier.
The real hooks then do the renaming, and assertion 1 must fail.
No production switch is needed.

N7 — Tier 2 takes the host from server.address first.

For browser fetch spans server.address is parsedUrl.host, which includes the port (fetch.js:200). That breaks the accepted “hostname only, no port” decision.
Strip the port, or take the host from the reduced URL first.

N8 — Unknown #13 contradicts your round-1 cover note.

The plan still marks the Rev 2 decisions “Aravind’s explicit confirmation pending”.
Your cover note said “confirmed by Aravind, 30 Oct”.
Add a dated note recording the confirmation. A GO on a plan whose own text says its decisions are pending is a GO on unconfirmed decisions.

N9 — Add next.span_type: 'AppRouteRouteHandlers.runHandler' to the J2 child.

That is what the real child carries (app-route/module.js:606, constants.js:167,188).
It also exercises J1 rule 4 as an exact match on 'AppRender.fetch', not a presence check. Approved.
Credit
J1’s rename guard. Renaming only when both a method and a host can be derived, and otherwise leaving the description alone and deleting the path keys, turns “undefined behaviour” into “no change”. That’s the right default.
Excluding the web-vitals origins by name (auto.http.browser.lcp|inp|cls|stream). A prefix rule would have renamed them. That’s the B1 class caught one level further down before it shipped.
J4’s tripwire scoped honestly. It proves the flag is set in the test process and says it proves nothing about production. The TRIPWIRE_CONTROL=skip negative makes it a guard that can be seen to fire.
J5’s key decision, with the collision cost written down and a test row for it.
J6’s sampler comment puts the inferred-name mechanism exactly where the next person would “fix” it.
L marks my claims NOT VERIFIED where your install didn’t show them, instead of taking them on trust. That is the discipline working, even though one of those misses turned out to be your grep.
Verdict

STOP, half a round. B2 is the only blocker.

What clears it: a dated J1 addendum for the relative-URL rule (Tier 1 strips query and fragment, Tier 2 turns relative into [same-origin]), plus the B2 unit rows and control. I’ll clear that as a verification pass on the addendum, not a full round.

In the same addendum:

S6: the classifier control moves into the pipeline.
N7, N8 and N9.
The two J3 notes: the §E cost line, and S1b re-scoped in words.
The three J5 conditions.
Strike N1’s NOT VERIFIED in A4 and L, and correct the citation.

When that lands it’s a design GO. The package stage then needs:

the three missing files attached;
RED and GREEN transcripts at their commit SHAs;
CI headSha equal to the PR HEAD;
your answer on Vercel’s production branch, so §H’s “one full day before D-30” means a known event.