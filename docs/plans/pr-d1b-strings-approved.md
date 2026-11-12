# PR-D1b strings record

English only. Tamil owed for every entry. Pinned exactly by `test/pm-strings-approved.test.ts`; the constants live in `lib/capture/pm-copy.ts`.
This record supersedes `docs/plans/pr-d1-strings-approved.md` for the keys below. That file is left as written (history).

## Approved (per Aravind, 3 Nov 2026)

Every entry below is "per Aravind", 3 Nov.

```
PM_KIND_DC = "DC / GRN"                       (was "DC")
PM_TYPE_INTERNAL_TRANSFER = "Internal transfer"   (was "Internal GRN (from another site)")
PM_DETAILS_TOGGLE = "More details (optional)"
PM_FILE_PREVIEW_ALT = "Photo of the document"
PM_LINK_OPTION = "{date}, {time} · {engineer} · {answer}"
PM_VIEWER_CLOSE = "Close"
PM_VIEWER_ROTATE = "Rotate"
```

`PM_VIEWER_CLOSE` and `PM_VIEWER_ROTATE` are the names given in the PR-D1b plan, §3 (viewer buttons), per Aravind.
`PM_FILE_PREVIEW_ALT` is also the viewer dialog's accessible name, so no further string was added for it.

Placeholders of `PM_LINK_OPTION`: `{date}` is `formatIstDate`; `{time}` is 12-hour IST, lowercase am/pm, e.g. "10:33 am"
(per Aravind, 12 Nov); `{engineer}` is the site engineer's name, or an em dash when none; `{answer}` is the engineer's answer label of the
candidate's own kind.

## Removed

`PM_FIELD_VEHICLE` ("Vehicle no.") is deleted (per Aravind, 12 Nov): the vehicle field left the form and the list. The stored value is passed
through unchanged on every save. Git history holds the old line.

## NOT approved (proposed text, Tamil owed, NOT approved)

A word swap of the 2 Nov text ("internal GRN" to "internal transfer"). No earlier "internal transfer" wording exists in the history to restore.
Aravind has not approved this wording.

```
PM_ERR_LINK_TARGET_INELIGIBLE
  now:      "This DC cannot take an invoice. It is an internal GRN, created from an invoice, or rejected."
  proposed: "This DC cannot take an invoice. It is an internal transfer, created from an invoice, or rejected."
PM_ERR_RETYPE_LINKED
  now:      "Unlink the invoice before you change this to an internal GRN."
  proposed: "Unlink the invoice before you change this to an internal transfer."
PM_ERR_RETYPE_AUTOMATIC
  now:      "A delivery created from an invoice cannot be an internal GRN."
  proposed: "A delivery created from an invoice cannot be an internal transfer."
```
