# quoco_morning_checkin_v3 came back MARKETING, not UTILITY — investigation and decision

**Status: RESOLVED, 2026-09-02.** Read-only investigation, then a decision
by Aravind. Recorded here because `scripts/submit-templates.ts` and
`lib/whatsapp/outbound/templates.ts` both cite this file for the reasoning
behind why morning stays on template 1.

## The finding

`quoco_morning_checkin_v3` (1v3, `HXbb534f41c814a2c3a32b5682713579df`) was
submitted as UTILITY and came back Meta-approved as **MARKETING**. The
other three templates submitted in the same batch (`quoco_evening_checkin_v3`
2v3, `quoco_engineer_optin_v2` 8v2, `quoco_dpr_owner_no_report` 14) all came
back UTILITY as submitted. All submitted 2026-08-31.

## Item 4 — is `allow_category_change` set on all of them?

Live-checked (`GET .../ApprovalRequests`, read-only) on all five templates,
including live template 1 as a control:

| Template | Category (approved) | `allow_category_change` |
|---|---|---|
| 1 `quoco_morning_checkin` (live) | UTILITY | `true` |
| 1v3 `quoco_morning_checkin_v3` | **MARKETING** | `true` |
| 2v3 `quoco_evening_checkin_v3` | UTILITY | `true` |
| 8v2 `quoco_engineer_optin_v2` | UTILITY | `true` |
| 14 `quoco_dpr_owner_no_report` | UTILITY | `true` |

`true` on all five, including the live template 1, which has never been
recategorised. `scripts/submit-templates.ts`'s `buildApprovalPayload` sends
only `{name, category}` — this codebase never sets this field explicitly;
it is a Twilio/Meta-side default.

**More importantly: this field is deprecated and non-protective.** Per
Twilio's own changelog ([twilio.com/en-us/changelog/whatsapp-reclassifications](https://www.twilio.com/en-us/changelog/whatsapp-reclassifications),
fetched 2026-09-02): Meta has discontinued `allow_category_change`.
Automatic reclassification to MARKETING is now the default behaviour with
**no way to prevent it** through this field, and Twilio has unpublished it
from their docs since it no longer functions. Consequence: setting
`allow_category_change: false` on a future resubmission will **not** reduce
recategorisation risk — that mitigation doesn't exist.

## Item 1 — what actually differs, MARKETING vs UTILITY, and does it risk the 08:30 send

**Pricing** (Meta's pricing docs, fetched directly): MARKETING is charged
on every delivery, never free even inside an open service window, and not
eligible for volume discounts. UTILITY is free within an open
customer-service window and gets volume-based rate reductions. The 08:30
trigger is business-initiated (out-of-window by construction), so both
would be charged per-message here, but MARKETING is priced meaningfully
higher and never discounted.

**Frequency capping — the real delivery risk.** Multiple BSP sources
(Infobip, fetched directly; corroborated by AiSensy, Engati, vFirst — none
of these are Meta's own primary docs, flagged as secondary evidence)
converge: Meta caps MARKETING template messages to **2 per rolling 24h per
WhatsApp user, enforced across all senders**, not scoped to Quoco. An
engineer could be capped out by an unrelated business's marketing traffic
that day and receive no morning check-in — a failure mode Quoco can
neither observe in advance nor control. UTILITY messages are explicitly
exempt. The failure is not silent: it surfaces as an explicit send error
(Cloud API code 131049), which lands in this project's existing
delivery-status callback handling, not a black hole — but a visible
failure is still a failure on the one message the whole product depends
on.

**Opt-in**: a single general opt-in obtained before the first
business-initiated message covers marketing, utility, and authentication
uniformly (search-snippet level evidence, not fetched directly from
Meta's own opt-in doc page — weaker evidence class, flagged as such). No
indication of an incremental compliance gap from category alone.

**Plain statement**: yes, repointing to 1v3 as-is would have introduced a
real, new delivery-failure mode the current UTILITY template 1 does not
have.

## Item 2 — why did Meta recategorise 1v3 and not the other three?

Meta's own documented MARKETING triggers (`developers.facebook.com/.../templates/template-categorization`,
fetched directly): mixed utility+promotional content, generic/unclear body
text, upselling/cross-selling, offers/incentives.

The only change between template 1 (UTILITY) and 1v3 (MARKETING) is:
`"This is Quoco for {{2}}"` → `"This is your morning check-in for {{2}}"`.
The question text — `"Are you on site today? Reply yes or no."` — is
byte-identical. None of Meta's stated triggers apply; the new phrasing is
arguably more specific/transactional, not less.

**Reason is not determinable from the copy** against Meta's documented
criteria. Meta's classifier is widely reported (secondary sources) as
inconsistent on borderline utility-styled templates — noted as context,
not asserted as the cause.

## Item 3 — options considered

a. Request recategorisation via WhatsApp Manager (Meta's own docs, fetched:
   Message Templates → Go to Business Support → Template Category Updates →
   Request Review; 60-day window from the reclassification date, opened
   2026-08-31). Not exposed through Twilio at all — done by hand.
b. Resubmit under a new name with `allow_category_change: false` — per
   item 4 above, this control is non-functional; the same recategorisation
   risk almost certainly carries over.
c. Keep template 1 live (UTILITY, approved), repoint only the evening
   template (2v3, itself UTILITY). Zero new risk to the 08:30 trigger.
d. Accept MARKETING and repoint to 1v3 anyway.

## Decision (Aravind, 2026-09-02)

**Option (c), with (a) in parallel.** Morning stays on template 1 —
`MORNING_CHECKIN_SID` is not repointed. Reason: the per-user, cross-sender
frequency cap is a failure mode on the single message the whole product
depends on that Quoco can neither observe in advance nor control; the
improved framing line in 1v3 is not worth that trade. Evening repoints to
2v3 (UTILITY, none of the above risk applies) as part of migration 035's
lockstep — see `docs/whatsapp-templates.md`'s repointing checklist.

In parallel: a recategorisation request for 1v3 is drafted (not
auto-submitted — WhatsApp Manager has no API for this) for Aravind to
submit by hand. If Meta reclassifies 1v3 back to UTILITY, repointing
morning becomes its own small, separate change at that point. If not,
template 1 stays live indefinitely and nothing breaks.

## Sources

Primary (fetched directly): [Twilio — WhatsApp Category Reclassifications changelog](https://www.twilio.com/en-us/changelog/whatsapp-reclassifications);
[Meta — WhatsApp Business Platform pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing);
[Meta — Template categorization](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-categorization).
Secondary (BSP blog consensus, not Meta/Twilio primary docs): [Infobip — WhatsApp frequency capping](https://www.infobip.com/blog/what-is-whatsapp-frequency-capping),
[AiSensy — Meta's frequency capping](https://m.aisensy.com/blog/meta-frequency-capping-for-whatsapp-marketing-messages/).
