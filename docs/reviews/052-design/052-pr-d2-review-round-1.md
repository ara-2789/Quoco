PR-D2 (UI chat) on MI-KIND-REMOVAL contract rev 3. Fits, with two objections and four tightenings.

OBJECTIONS
O1 Set-once with no correction path makes a PM misclick permanent (QE011 for ever; SQL fix by Aravind only). Request: allow a change of kind while the delivery is incomplete or awaiting_pm AND has no pm_manual link. The old delivery is cancelled with reason 'reclassified' and the new one is created in the same transaction. After approval or a PM link, the kind is fixed (QE011). If you keep set-once, record "misclassification = SQL fix by Aravind" as an accepted risk in the plan; PR-D2 then adds a confirm step.
O2 Status derived from the engineer's ack: publish the mapping table (kind × ack value → delivery status, and self-link status for invoices). Show that v3 §2.2 still holds: an invoice's ack is never evidence that a DC arrived. The neutral ack wording (option A/B) is decided after this table.

TIGHTEN
T1 Return jsonb shape, fixed and documented: { document_id, kind, delivery_id, self_link_id (invoice only, else null), already_classified }. Same shape on the already_classified path.
T2 Concurrency: lock the capture_documents row (FOR NO KEY UPDATE or stronger) before the kind check. Two PMs at once: one wins; same kind → already_classified; different kind → QE011 (or the O1 rule). Add a CI-only concurrency test.
T3 kind_set_by is a users.id (FK to users), never an auth uid.
T4 "Unclassified" is kind IS NULL. kind_set_at may be NULL on classified rows (the 5 D-30 rows). State this in the plan, so no reader keys on kind_set_at.

ALSO CONFIRM
- Grants follow the 048/050 pattern: REVOKE FROM PUBLIC, anon, service_role; GRANT TO authenticated.
- A document whose files are all rejected or failed can still be classified.
- No WhatsApp message goes to the engineer on classify.
- The existing capture_documents_select / capture_files_select policies already let the PM read kind-null rows (no policy change), or name the change.

PR-D1 already hides kind-null documents and uses a neutral file name for them, so prod stays safe between the migration and the PR-D2 merge, as long as kind-null documents cannot be created before PR-D2 merges.
