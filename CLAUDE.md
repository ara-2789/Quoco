# QUOCO — Claude Code Instructions

## What is Quoco
Quoco is a multi-tenant SaaS for construction contractors in India. Each construction company is a tenant. The product covers two stages:

PRE-CONTRACT: AI-assisted tender document summarisation and BOQ (Bill of Quantities) price generation using RAG pipeline on Claude API.

POST-CONTRACT: Project management replacing WhatsApp groups and Excel. Core launch feature is a WhatsApp bot for daily site reporting.

## The WhatsApp Bot (core launch feature)
- 8:00 AM: bot messages site engineers — collects 5 morning inputs (plan of action, manpower, execution plan, dependencies, hindrances)
- 6:30 PM: bot re-engages — collects 4 evening inputs (daily output, schedule met yes/no, reason if no, tomorrow dependencies)
- Claude API generates a Daily Progress Report (DPR) sent to PM and Owner every evening
- Engineers can also start ad-hoc chats to report: safety incidents, expense invoices (photo/receipt), execution hindrances
- All inputs accept text, photos, or handwritten notes — Claude Vision OCR extracts fields, engineer confirms

## Tech Stack
- Next.js 16 App Router with TypeScript
- Supabase for database, auth, and file storage (pgvector for RAG later)
- Tailwind CSS + shadcn/ui for components
- Claude API (claude-sonnet-4-6) for OCR, DPR generation, BOQ generation
- Twilio WhatsApp Business API for bot
- Stripe for billing
- Vercel for deployment
- Resend for email

## Multi-Tenancy Rules (CRITICAL)
- Every database table MUST have a tenant_id UUID column
- Never query without filtering by tenant_id
- Use tenant_id not organization_id
- RLS enforced at DB layer using get_user_tenant_id() helper function
- Supabase SSR client in server components and API routes only
- Never use service role key on the client side

## User Roles (6 roles)
pm, qs, engineer, subcontractor, client, admin

## Database Tables (9 tables)
1. tenants - one row per construction company
2. users - extends auth.users, includes role and whatsapp_number
3. projects - construction projects scoped to tenant
4. project_members - links users to projects with a role
5. whatsapp_sessions - bot state: phone_number, current_flow, current_step, context JSONB, expires_at
6. daily_logs - morning_* and evening_* columns in one table, plus dpr_content TEXT
7. safety_incidents - includes photo_url, ocr_confidence, pm_notified_at
8. invoices - includes ocr_confidence, submitted_via, cost_head, image_url
9. hindrances - includes impact_level, hindrance_type, dpr_included boolean
10. vendors - supplier/subcontractor directory, includes trade_category and gstin
11. vendor_invoices - incoming bills from vendors, linked to vendor_id and project_id, includes payment status
12. ra_bills - RA Bills raised by contractor against project. Includes bill_number, period_from, period_to, gross_amount, retention_deduction, advance_recovery, net_payable, status (draft/submitted/approved/paid)
13. ra_bill_payments - Payments received from client against each RA Bill. Includes amount_received, payment_date, payment_reference
14. boq_items - Approved BOQ line items linked to project. Includes item_code, description, unit, quantity, rate, amount, trade_category

## Coding Rules
- TypeScript always — no any types
- One feature per session
- Plan first, code after confirmation
- Commit after every working feature
- No placeholder functions or TODOs in committed code
- Paste full error messages when debugging

## Auth
Supabase Auth with magic link (email only, no passwords)

## Current Status
- Next.js 16 project created
- Supabase client configured (lib/supabase/client.ts, lib/supabase/server.ts, proxy.ts)
- Environment variables set in .env.local
- Next task: create database schema in supabase/migrations/001_core_schema.sql
