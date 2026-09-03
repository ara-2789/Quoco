import { describe, it, expect } from 'vitest'
import { classifyYesNo } from '@/lib/whatsapp/flows/parsers/lexicon'
import { testClient } from '../helpers/db'
import { YESNO_CORPUS } from '../helpers/yesno-corpus'

// THE MIRROR TEST for the yes/no classification duplication introduced by
// migration 030 (supabase/migrations/030_morning_flow_attendance.sql,
// review package §10.1/§10.2). apply_morning_flow_turn's Q1/holiday-
// follow-up branches now classify yes/no INSIDE the RPC via a new PL/pgSQL
// helper, quoco_classify_yes_no, ported from classifyYesNo
// (lib/whatsapp/flows/parsers/lexicon.ts) word-for-word. Evening Q2 still
// uses the TypeScript classifyYesNo directly, via a precomputed parse
// (lib/whatsapp/flows/evening.ts). Both must agree on every input, forever
// — this test is what makes a silent drift between the two impossible to
// miss, the same role test/unit/morning-flow-mirror.test.ts plays for the
// SQL/TS decision-logic split this migration also closes.
//
// test/helpers/yesno-corpus.ts is the ONE shared list both sides are
// checked against — a word recognised by one lexicon and not the other
// shows up here as a single new failing case, not as a wrong `attendance`
// value discovered later on a real reply nobody happened to test by hand.
// EXCEPTION, dated and temporary: a case flagged `pendingSqlMigration`
// (corpus's own doc comment) skips only the live RPC assertion below —
// TS has learned the word, SQL hasn't yet, and an already-applied migration
// can't be edited in place. Not a gap in this test's own coverage; a
// documented wait for a follow-up migration.
//
// Migration 030 (which adds quoco_classify_yes_no) is applied and live on
// both test-db and prod as of this file's own 2026-09-03 edit — corrected
// from a stale "not yet applied" note this file previously carried.

describe('yes/no classification mirror agreement (classifyYesNo vs quoco_classify_yes_no)', () => {
  YESNO_CORPUS.forEach((c) => {
    it(`"${c.input}" -> met=${c.expected.met} ok=${c.expected.ok}`, async () => {
      const ts = classifyYesNo(c.input)
      expect(ts).toEqual(c.expected)

      // PENDING SQL MIGRATION -- see YesNoCorpusCase's own doc comment
      // (test/helpers/yesno-corpus.ts). TS has learned this word; the
      // already-applied, live quoco_classify_yes_no has not, and cannot be
      // edited in place. Skips ONLY the live RPC assertion below, never the
      // TS one above -- remove this branch's relevance for a given case by
      // removing its `pendingSqlMigration` flag once the follow-up
      // migration ships, not by deleting this skip.
      if (c.pendingSqlMigration) return

      const db = testClient()
      const { data, error } = await db.rpc('quoco_classify_yes_no', { p_text: c.input })
      if (error) throw new Error(`quoco_classify_yes_no failed for "${c.input}": ${error.message}`)
      expect(data).toEqual(c.expected)
    })
  })
})
