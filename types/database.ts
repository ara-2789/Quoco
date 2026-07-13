export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      boq_items: {
        Row: {
          adjusted_base_rate: number | null
          amount: number | null
          boq_session_id: string
          confidence_score: number | null
          created_at: string | null
          description: string | null
          description_tsv: unknown
          embedding: string | null
          final_rate: number | null
          id: string
          inflation_pct: number | null
          is_approved: boolean | null
          item_code: string | null
          location_pct: number | null
          margin_pct: number | null
          original_row_data: Json | null
          pricing_reasoning: string | null
          pricing_status: string | null
          qty_pct: number | null
          quantity: number | null
          search_layer_used: number | null
          source_date: string | null
          source_name: string | null
          source_rate: number | null
          suggested_rate: number | null
          tenant_id: string
          unit: string | null
        }
        Insert: {
          adjusted_base_rate?: number | null
          amount?: number | null
          boq_session_id: string
          confidence_score?: number | null
          created_at?: string | null
          description?: string | null
          description_tsv?: unknown
          embedding?: string | null
          final_rate?: number | null
          id?: string
          inflation_pct?: number | null
          is_approved?: boolean | null
          item_code?: string | null
          location_pct?: number | null
          margin_pct?: number | null
          original_row_data?: Json | null
          pricing_reasoning?: string | null
          pricing_status?: string | null
          qty_pct?: number | null
          quantity?: number | null
          search_layer_used?: number | null
          source_date?: string | null
          source_name?: string | null
          source_rate?: number | null
          suggested_rate?: number | null
          tenant_id: string
          unit?: string | null
        }
        Update: {
          adjusted_base_rate?: number | null
          amount?: number | null
          boq_session_id?: string
          confidence_score?: number | null
          created_at?: string | null
          description?: string | null
          description_tsv?: unknown
          embedding?: string | null
          final_rate?: number | null
          id?: string
          inflation_pct?: number | null
          is_approved?: boolean | null
          item_code?: string | null
          location_pct?: number | null
          margin_pct?: number | null
          original_row_data?: Json | null
          pricing_reasoning?: string | null
          pricing_status?: string | null
          qty_pct?: number | null
          quantity?: number | null
          search_layer_used?: number | null
          source_date?: string | null
          source_name?: string | null
          source_rate?: number | null
          suggested_rate?: number | null
          tenant_id?: string
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "boq_items_boq_session_id_fkey"
            columns: ["boq_session_id"]
            isOneToOne: false
            referencedRelation: "boq_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boq_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      boq_sessions: {
        Row: {
          created_at: string | null
          created_by: string | null
          default_margin_pct: number | null
          id: string
          original_columns: Json | null
          original_file_url: string | null
          priced_items: number | null
          project_id: string | null
          project_location: string | null
          status: string | null
          tenant_id: string
          tender_id: string | null
          total_items: number | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          default_margin_pct?: number | null
          id?: string
          original_columns?: Json | null
          original_file_url?: string | null
          priced_items?: number | null
          project_id?: string | null
          project_location?: string | null
          status?: string | null
          tenant_id: string
          tender_id?: string | null
          total_items?: number | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          default_margin_pct?: number | null
          id?: string
          original_columns?: Json | null
          original_file_url?: string | null
          priced_items?: number | null
          project_id?: string | null
          project_location?: string | null
          status?: string | null
          tenant_id?: string
          tender_id?: string | null
          total_items?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "boq_sessions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boq_sessions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boq_sessions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boq_sessions_tender_id_fkey"
            columns: ["tender_id"]
            isOneToOne: false
            referencedRelation: "tenders"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_logs: {
        Row: {
          created_at: string | null
          dpr_approved_by: string | null
          dpr_content: string | null
          dpr_generated_at: string | null
          engineer_id: string
          evening_dependencies: Json | null
          evening_equipment_utilisation: Json | null
          evening_output: string | null
          evening_output_quantities: Json | null
          evening_productive_manpower: Json | null
          evening_schedule_met: boolean | null
          evening_schedule_miss_reason: string | null
          evening_submitted_at: string | null
          evening_submitted_via: string | null
          evening_workers_on_site: number | null
          holiday_reason: string | null
          id: string
          is_holiday: boolean | null
          log_date: string
          morning_dependencies: Json | null
          morning_equipment: Json | null
          morning_execution_plan: string | null
          morning_hindrances: Json | null
          morning_manpower_planned: Json | null
          morning_plan: string | null
          morning_submitted_at: string | null
          morning_submitted_via: string | null
          project_id: string
          tenant_id: string
          weather: string | null
        }
        Insert: {
          created_at?: string | null
          dpr_approved_by?: string | null
          dpr_content?: string | null
          dpr_generated_at?: string | null
          engineer_id: string
          evening_dependencies?: Json | null
          evening_equipment_utilisation?: Json | null
          evening_output?: string | null
          evening_output_quantities?: Json | null
          evening_productive_manpower?: Json | null
          evening_schedule_met?: boolean | null
          evening_schedule_miss_reason?: string | null
          evening_submitted_at?: string | null
          evening_submitted_via?: string | null
          evening_workers_on_site?: number | null
          holiday_reason?: string | null
          id?: string
          is_holiday?: boolean | null
          log_date?: string
          morning_dependencies?: Json | null
          morning_equipment?: Json | null
          morning_execution_plan?: string | null
          morning_hindrances?: Json | null
          morning_manpower_planned?: Json | null
          morning_plan?: string | null
          morning_submitted_at?: string | null
          morning_submitted_via?: string | null
          project_id: string
          tenant_id: string
          weather?: string | null
        }
        Update: {
          created_at?: string | null
          dpr_approved_by?: string | null
          dpr_content?: string | null
          dpr_generated_at?: string | null
          engineer_id?: string
          evening_dependencies?: Json | null
          evening_equipment_utilisation?: Json | null
          evening_output?: string | null
          evening_output_quantities?: Json | null
          evening_productive_manpower?: Json | null
          evening_schedule_met?: boolean | null
          evening_schedule_miss_reason?: string | null
          evening_submitted_at?: string | null
          evening_submitted_via?: string | null
          evening_workers_on_site?: number | null
          holiday_reason?: string | null
          id?: string
          is_holiday?: boolean | null
          log_date?: string
          morning_dependencies?: Json | null
          morning_equipment?: Json | null
          morning_execution_plan?: string | null
          morning_hindrances?: Json | null
          morning_manpower_planned?: Json | null
          morning_plan?: string | null
          morning_submitted_at?: string | null
          morning_submitted_via?: string | null
          project_id?: string
          tenant_id?: string
          weather?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_logs_engineer_id_fkey"
            columns: ["engineer_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_logs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      hindrances: {
        Row: {
          area_affected: string | null
          created_at: string | null
          description: string | null
          dpr_included: boolean | null
          hindrance_type: string | null
          id: string
          impact_level: string | null
          photo_url: string | null
          project_id: string
          reported_by: string
          resolved_at: string | null
          resolved_by: string | null
          status: string | null
          submitted_via: string | null
          tenant_id: string
        }
        Insert: {
          area_affected?: string | null
          created_at?: string | null
          description?: string | null
          dpr_included?: boolean | null
          hindrance_type?: string | null
          id?: string
          impact_level?: string | null
          photo_url?: string | null
          project_id: string
          reported_by: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string | null
          submitted_via?: string | null
          tenant_id: string
        }
        Update: {
          area_affected?: string | null
          created_at?: string | null
          description?: string | null
          dpr_included?: boolean | null
          hindrance_type?: string | null
          id?: string
          impact_level?: string | null
          photo_url?: string | null
          project_id?: string
          reported_by?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string | null
          submitted_via?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hindrances_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hindrances_reported_by_fkey"
            columns: ["reported_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hindrances_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount: number | null
          cost_head: string | null
          created_at: string | null
          gstin_extracted: string | null
          id: string
          image_url: string | null
          invoice_date: string | null
          invoice_number: string | null
          line_items: Json | null
          ocr_confidence: number | null
          project_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string | null
          submitted_by: string
          submitted_via: string | null
          tenant_id: string
          vendor_id: string | null
          vendor_name: string | null
        }
        Insert: {
          amount?: number | null
          cost_head?: string | null
          created_at?: string | null
          gstin_extracted?: string | null
          id?: string
          image_url?: string | null
          invoice_date?: string | null
          invoice_number?: string | null
          line_items?: Json | null
          ocr_confidence?: number | null
          project_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
          submitted_by: string
          submitted_via?: string | null
          tenant_id: string
          vendor_id?: string | null
          vendor_name?: string | null
        }
        Update: {
          amount?: number | null
          cost_head?: string | null
          created_at?: string | null
          gstin_extracted?: string | null
          id?: string
          image_url?: string | null
          invoice_date?: string | null
          invoice_number?: string | null
          line_items?: Json | null
          ocr_confidence?: number | null
          project_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
          submitted_by?: string
          submitted_via?: string | null
          tenant_id?: string
          vendor_id?: string | null
          vendor_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          attempt_count: number
          completed_at: string | null
          created_at: string | null
          id: string
          last_error: string | null
          next_retry_at: string | null
          payload: Json
          status: string
          type: string
        }
        Insert: {
          attempt_count?: number
          completed_at?: string | null
          created_at?: string | null
          id?: string
          last_error?: string | null
          next_retry_at?: string | null
          payload?: Json
          status?: string
          type: string
        }
        Update: {
          attempt_count?: number
          completed_at?: string | null
          created_at?: string | null
          id?: string
          last_error?: string | null
          next_retry_at?: string | null
          payload?: Json
          status?: string
          type?: string
        }
        Relationships: []
      }
      processed_messages: {
        Row: {
          created_at: string | null
          id: string
          message_sid: string
          processed_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          message_sid: string
          processed_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          message_sid?: string
          processed_at?: string | null
        }
        Relationships: []
      }
      project_members: {
        Row: {
          created_at: string | null
          id: string
          project_id: string
          role: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          project_id: string
          role: string
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          project_id?: string
          role?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_members_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          client_contact: string | null
          client_name: string | null
          contract_type: string | null
          contract_value: number | null
          created_at: string | null
          created_by: string | null
          expected_end_date: string | null
          id: string
          name: string
          owner_user_id: string | null
          project_type: string | null
          site_address: string | null
          start_date: string | null
          status: string | null
          tenant_id: string
          tender_id: string | null
        }
        Insert: {
          client_contact?: string | null
          client_name?: string | null
          contract_type?: string | null
          contract_value?: number | null
          created_at?: string | null
          created_by?: string | null
          expected_end_date?: string | null
          id?: string
          name: string
          owner_user_id?: string | null
          project_type?: string | null
          site_address?: string | null
          start_date?: string | null
          status?: string | null
          tenant_id: string
          tender_id?: string | null
        }
        Update: {
          client_contact?: string | null
          client_name?: string | null
          contract_type?: string | null
          contract_value?: number | null
          created_at?: string | null
          created_by?: string | null
          expected_end_date?: string | null
          id?: string
          name?: string
          owner_user_id?: string | null
          project_type?: string | null
          site_address?: string | null
          start_date?: string | null
          status?: string | null
          tenant_id?: string
          tender_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "projects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ra_bill_payments: {
        Row: {
          amount_received: number | null
          created_at: string | null
          id: string
          notes: string | null
          payment_date: string | null
          payment_reference: string | null
          ra_bill_id: string
          tenant_id: string
        }
        Insert: {
          amount_received?: number | null
          created_at?: string | null
          id?: string
          notes?: string | null
          payment_date?: string | null
          payment_reference?: string | null
          ra_bill_id: string
          tenant_id: string
        }
        Update: {
          amount_received?: number | null
          created_at?: string | null
          id?: string
          notes?: string | null
          payment_date?: string | null
          payment_reference?: string | null
          ra_bill_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ra_bill_payments_ra_bill_id_fkey"
            columns: ["ra_bill_id"]
            isOneToOne: false
            referencedRelation: "ra_bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ra_bill_payments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ra_bills: {
        Row: {
          advance_recovery: number | null
          approved_at: string | null
          bill_number: string | null
          created_at: string | null
          gross_amount: number | null
          id: string
          net_payable: number | null
          period_from: string | null
          period_to: string | null
          project_id: string
          retention_deduction: number | null
          status: string | null
          submitted_at: string | null
          tenant_id: string
        }
        Insert: {
          advance_recovery?: number | null
          approved_at?: string | null
          bill_number?: string | null
          created_at?: string | null
          gross_amount?: number | null
          id?: string
          net_payable?: number | null
          period_from?: string | null
          period_to?: string | null
          project_id: string
          retention_deduction?: number | null
          status?: string | null
          submitted_at?: string | null
          tenant_id: string
        }
        Update: {
          advance_recovery?: number | null
          approved_at?: string | null
          bill_number?: string | null
          created_at?: string | null
          gross_amount?: number | null
          id?: string
          net_payable?: number | null
          period_from?: string | null
          period_to?: string | null
          project_id?: string
          retention_deduction?: number | null
          status?: string | null
          submitted_at?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ra_bills_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ra_bills_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_catalog: {
        Row: {
          base_rate: number | null
          created_at: string | null
          description: string | null
          description_tsv: unknown
          effective_date: string | null
          embedding: string | null
          expiry_date: string | null
          id: string
          is_active: boolean | null
          item_code: string | null
          rate_max: number | null
          rate_min: number | null
          source_name: string | null
          state_code: string | null
          trade_category: string | null
          unit: string | null
        }
        Insert: {
          base_rate?: number | null
          created_at?: string | null
          description?: string | null
          description_tsv?: unknown
          effective_date?: string | null
          embedding?: string | null
          expiry_date?: string | null
          id?: string
          is_active?: boolean | null
          item_code?: string | null
          rate_max?: number | null
          rate_min?: number | null
          source_name?: string | null
          state_code?: string | null
          trade_category?: string | null
          unit?: string | null
        }
        Update: {
          base_rate?: number | null
          created_at?: string | null
          description?: string | null
          description_tsv?: unknown
          effective_date?: string | null
          embedding?: string | null
          expiry_date?: string | null
          id?: string
          is_active?: boolean | null
          item_code?: string | null
          rate_max?: number | null
          rate_min?: number | null
          source_name?: string | null
          state_code?: string | null
          trade_category?: string | null
          unit?: string | null
        }
        Relationships: []
      }
      rate_catalog_history: {
        Row: {
          catalog_id: string
          created_at: string | null
          id: string
          location: string | null
          notes: string | null
          recorded_date: string | null
          recorded_rate: number | null
          source_url: string | null
        }
        Insert: {
          catalog_id: string
          created_at?: string | null
          id?: string
          location?: string | null
          notes?: string | null
          recorded_date?: string | null
          recorded_rate?: number | null
          source_url?: string | null
        }
        Update: {
          catalog_id?: string
          created_at?: string | null
          id?: string
          location?: string | null
          notes?: string | null
          recorded_date?: string | null
          recorded_rate?: number | null
          source_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rate_catalog_history_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "rate_catalog"
            referencedColumns: ["id"]
          },
        ]
      }
      safety_incidents: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          incident_type: string | null
          injury_status: string | null
          investigation_notes: string | null
          location: string | null
          ocr_confidence: number | null
          photo_url: string | null
          pm_notified_at: string | null
          project_id: string
          reported_by: string
          resolved_at: string | null
          resolved_by: string | null
          status: string | null
          submitted_via: string | null
          tenant_id: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          incident_type?: string | null
          injury_status?: string | null
          investigation_notes?: string | null
          location?: string | null
          ocr_confidence?: number | null
          photo_url?: string | null
          pm_notified_at?: string | null
          project_id: string
          reported_by: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string | null
          submitted_via?: string | null
          tenant_id: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          incident_type?: string | null
          injury_status?: string | null
          investigation_notes?: string | null
          location?: string | null
          ocr_confidence?: number | null
          photo_url?: string | null
          pm_notified_at?: string | null
          project_id?: string
          reported_by?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string | null
          submitted_via?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "safety_incidents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safety_incidents_reported_by_fkey"
            columns: ["reported_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safety_incidents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          annual_turnover: number | null
          cin: string | null
          created_at: string | null
          gstin: string | null
          id: string
          iso_certifications: Json | null
          last_payment_ref: string | null
          name: string
          paid_until: string | null
          payment_customer_id: string | null
          plan: string | null
          profile_complete: boolean | null
          pwd_class: string | null
          registered_address: string | null
          slug: string
          trial_ends_at: string | null
        }
        Insert: {
          annual_turnover?: number | null
          cin?: string | null
          created_at?: string | null
          gstin?: string | null
          id?: string
          iso_certifications?: Json | null
          last_payment_ref?: string | null
          name: string
          paid_until?: string | null
          payment_customer_id?: string | null
          plan?: string | null
          profile_complete?: boolean | null
          pwd_class?: string | null
          registered_address?: string | null
          slug: string
          trial_ends_at?: string | null
        }
        Update: {
          annual_turnover?: number | null
          cin?: string | null
          created_at?: string | null
          gstin?: string | null
          id?: string
          iso_certifications?: Json | null
          last_payment_ref?: string | null
          name?: string
          paid_until?: string | null
          payment_customer_id?: string | null
          plan?: string | null
          profile_complete?: boolean | null
          pwd_class?: string | null
          registered_address?: string | null
          slug?: string
          trial_ends_at?: string | null
        }
        Relationships: []
      }
      tender_chat_messages: {
        Row: {
          citations: Json | null
          content: string | null
          created_at: string | null
          id: string
          retrieved_chunk_ids: string[] | null
          role: string
          session_id: string
          tenant_id: string
          token_count: number | null
        }
        Insert: {
          citations?: Json | null
          content?: string | null
          created_at?: string | null
          id?: string
          retrieved_chunk_ids?: string[] | null
          role: string
          session_id: string
          tenant_id: string
          token_count?: number | null
        }
        Update: {
          citations?: Json | null
          content?: string | null
          created_at?: string | null
          id?: string
          retrieved_chunk_ids?: string[] | null
          role?: string
          session_id?: string
          tenant_id?: string
          token_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tender_chat_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "tender_chat_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tender_chat_messages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tender_chat_sessions: {
        Row: {
          created_at: string | null
          id: string
          last_message_at: string | null
          status: string | null
          system_prompt: string | null
          tenant_id: string
          tender_id: string
          title: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          last_message_at?: string | null
          status?: string | null
          system_prompt?: string | null
          tenant_id: string
          tender_id: string
          title?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          last_message_at?: string | null
          status?: string | null
          system_prompt?: string | null
          tenant_id?: string
          tender_id?: string
          title?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tender_chat_sessions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tender_chat_sessions_tender_id_fkey"
            columns: ["tender_id"]
            isOneToOne: false
            referencedRelation: "tenders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tender_chat_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      tender_document_chunks: {
        Row: {
          chunk_index: number | null
          chunk_text: string | null
          chunk_tsv: unknown
          created_at: string | null
          embedding: string | null
          embedding_model: string | null
          id: string
          page_number: number | null
          tenant_id: string
          tender_document_id: string
          token_count: number | null
        }
        Insert: {
          chunk_index?: number | null
          chunk_text?: string | null
          chunk_tsv?: unknown
          created_at?: string | null
          embedding?: string | null
          embedding_model?: string | null
          id?: string
          page_number?: number | null
          tenant_id: string
          tender_document_id: string
          token_count?: number | null
        }
        Update: {
          chunk_index?: number | null
          chunk_text?: string | null
          chunk_tsv?: unknown
          created_at?: string | null
          embedding?: string | null
          embedding_model?: string | null
          id?: string
          page_number?: number | null
          tenant_id?: string
          tender_document_id?: string
          token_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tender_document_chunks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tender_document_chunks_tender_document_id_fkey"
            columns: ["tender_document_id"]
            isOneToOne: false
            referencedRelation: "tender_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      tender_documents: {
        Row: {
          created_at: string | null
          document_type: string | null
          embedding_model: string | null
          file_name: string | null
          file_type: string | null
          file_url: string | null
          id: string
          processing_status: string | null
          tenant_id: string
          tender_id: string
          vector_chunks_count: number | null
        }
        Insert: {
          created_at?: string | null
          document_type?: string | null
          embedding_model?: string | null
          file_name?: string | null
          file_type?: string | null
          file_url?: string | null
          id?: string
          processing_status?: string | null
          tenant_id: string
          tender_id: string
          vector_chunks_count?: number | null
        }
        Update: {
          created_at?: string | null
          document_type?: string | null
          embedding_model?: string | null
          file_name?: string | null
          file_type?: string | null
          file_url?: string | null
          id?: string
          processing_status?: string | null
          tenant_id?: string
          tender_id?: string
          vector_chunks_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tender_documents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tender_documents_tender_id_fkey"
            columns: ["tender_id"]
            isOneToOne: false
            referencedRelation: "tenders"
            referencedColumns: ["id"]
          },
        ]
      }
      tenders: {
        Row: {
          ai_summary: string | null
          clarifications: Json | null
          client_name: string | null
          created_at: string | null
          created_by: string | null
          estimated_value: number | null
          id: string
          qualification_flags: Json | null
          status: string | null
          submission_deadline: string | null
          tenant_id: string
          title: string
        }
        Insert: {
          ai_summary?: string | null
          clarifications?: Json | null
          client_name?: string | null
          created_at?: string | null
          created_by?: string | null
          estimated_value?: number | null
          id?: string
          qualification_flags?: Json | null
          status?: string | null
          submission_deadline?: string | null
          tenant_id: string
          title: string
        }
        Update: {
          ai_summary?: string | null
          clarifications?: Json | null
          client_name?: string | null
          created_at?: string | null
          created_by?: string | null
          estimated_value?: number | null
          id?: string
          qualification_flags?: Json | null
          status?: string | null
          submission_deadline?: string | null
          tenant_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          auth_id: string | null
          avatar_url: string | null
          created_at: string | null
          delegation_active: boolean | null
          employee_id: string | null
          full_name: string | null
          hierarchy_level: number | null
          id: string
          messaging_blocked: boolean
          reporting_manager_id: string | null
          role: string | null
          status: string
          tenant_id: string | null
          whatsapp_number: string | null
        }
        Insert: {
          auth_id?: string | null
          avatar_url?: string | null
          created_at?: string | null
          delegation_active?: boolean | null
          employee_id?: string | null
          full_name?: string | null
          hierarchy_level?: number | null
          id?: string
          messaging_blocked?: boolean
          reporting_manager_id?: string | null
          role?: string | null
          status?: string
          tenant_id?: string | null
          whatsapp_number?: string | null
        }
        Update: {
          auth_id?: string | null
          avatar_url?: string | null
          created_at?: string | null
          delegation_active?: boolean | null
          employee_id?: string | null
          full_name?: string | null
          hierarchy_level?: number | null
          id?: string
          messaging_blocked?: boolean
          reporting_manager_id?: string | null
          role?: string | null
          status?: string
          tenant_id?: string | null
          whatsapp_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "users_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_invoices: {
        Row: {
          amount: number | null
          created_at: string | null
          due_date: string | null
          id: string
          invoice_date: string | null
          invoice_number: string | null
          notes: string | null
          payment_date: string | null
          project_id: string
          status: string | null
          tenant_id: string
          vendor_id: string
        }
        Insert: {
          amount?: number | null
          created_at?: string | null
          due_date?: string | null
          id?: string
          invoice_date?: string | null
          invoice_number?: string | null
          notes?: string | null
          payment_date?: string | null
          project_id: string
          status?: string | null
          tenant_id: string
          vendor_id: string
        }
        Update: {
          amount?: number | null
          created_at?: string | null
          due_date?: string | null
          id?: string
          invoice_date?: string | null
          invoice_number?: string | null
          notes?: string | null
          payment_date?: string | null
          project_id?: string
          status?: string | null
          tenant_id?: string
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_invoices_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_invoices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_invoices_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      vendors: {
        Row: {
          auto_extracted: boolean | null
          bank_details: Json | null
          created_at: string | null
          email: string | null
          gstin: string | null
          id: string
          name: string
          needs_verification: boolean | null
          phone: string | null
          rating: number | null
          status: string | null
          tenant_id: string
          trade_category: string | null
        }
        Insert: {
          auto_extracted?: boolean | null
          bank_details?: Json | null
          created_at?: string | null
          email?: string | null
          gstin?: string | null
          id?: string
          name: string
          needs_verification?: boolean | null
          phone?: string | null
          rating?: number | null
          status?: string | null
          tenant_id: string
          trade_category?: string | null
        }
        Update: {
          auto_extracted?: boolean | null
          bank_details?: Json | null
          created_at?: string | null
          email?: string | null
          gstin?: string | null
          id?: string
          name?: string
          needs_verification?: boolean | null
          phone?: string | null
          rating?: number | null
          status?: string | null
          tenant_id?: string
          trade_category?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vendors_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_sessions: {
        Row: {
          context: Json | null
          created_at: string | null
          current_flow: string | null
          current_step: number | null
          expires_at: string | null
          id: string
          pending_flows: Json | null
          phone_number: string
          tenant_id: string
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          context?: Json | null
          created_at?: string | null
          current_flow?: string | null
          current_step?: number | null
          expires_at?: string | null
          id?: string
          pending_flows?: Json | null
          phone_number: string
          tenant_id: string
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          context?: Json | null
          created_at?: string | null
          current_flow?: string | null
          current_step?: number | null
          expires_at?: string | null
          id?: string
          pending_flows?: Json | null
          phone_number?: string
          tenant_id?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_sessions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      acquire_and_transition_session: {
        Args: {
          p_caller: string
          p_now?: string
          p_phone_number: string
          p_requested_flow: string
          p_tenant_id: string
          p_test_sleep_ms?: number
          p_user_id: string
        }
        Returns: {
          context: Json | null
          created_at: string | null
          current_flow: string | null
          current_step: number | null
          expires_at: string | null
          id: string
          pending_flows: Json | null
          phone_number: string
          tenant_id: string
          updated_at: string | null
          user_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "whatsapp_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      apply_morning_flow_turn: {
        Args: {
          p_message: string
          p_now?: string
          p_phone_number: string
          p_project_id: string
          p_start_flow: boolean
          p_tenant_id: string
          p_test_sleep_ms?: number
          p_user_id: string
        }
        Returns: Json
      }
      complete_onboarding: {
        Args: { p_company_name: string; p_full_name: string; p_slug: string }
        Returns: string
      }
      drain_next_pending_flow: {
        Args: { p_now?: string; p_phone_number: string }
        Returns: {
          context: Json | null
          created_at: string | null
          current_flow: string | null
          current_step: number | null
          expires_at: string | null
          id: string
          pending_flows: Json | null
          phone_number: string
          tenant_id: string
          updated_at: string | null
          user_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "whatsapp_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_user_tenant_id: { Args: never; Returns: string }
      quoco_same_ist_day: { Args: { a: string; b: string }; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
