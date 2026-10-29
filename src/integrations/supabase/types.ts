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
      audit_log: {
        Row: {
          action: string
          context: Json | null
          created_at: string
          field: string | null
          id: string
          new_value: string | null
          old_value: string | null
          record_id: string | null
          table_name: string
          user_id: string | null
        }
        Insert: {
          action: string
          context?: Json | null
          created_at?: string
          field?: string | null
          id?: string
          new_value?: string | null
          old_value?: string | null
          record_id?: string | null
          table_name: string
          user_id?: string | null
        }
        Update: {
          action?: string
          context?: Json | null
          created_at?: string
          field?: string | null
          id?: string
          new_value?: string | null
          old_value?: string | null
          record_id?: string | null
          table_name?: string
          user_id?: string | null
        }
        Relationships: []
      }
      branch_attendants: {
        Row: {
          assigned_at: string
          branch_id: string
          id: string
          user_id: string
        }
        Insert: {
          assigned_at?: string
          branch_id: string
          id?: string
          user_id: string
        }
        Update: {
          assigned_at?: string
          branch_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "branch_attendants_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      branch_fuel_type_tanks: {
        Row: {
          branch_fuel_type_id: string
          created_at: string
          tank_id: string
        }
        Insert: {
          branch_fuel_type_id: string
          created_at?: string
          tank_id: string
        }
        Update: {
          branch_fuel_type_id?: string
          created_at?: string
          tank_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "branch_fuel_type_tanks_branch_fuel_type_id_fkey"
            columns: ["branch_fuel_type_id"]
            isOneToOne: false
            referencedRelation: "branch_fuel_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_fuel_type_tanks_tank_id_fkey"
            columns: ["tank_id"]
            isOneToOne: false
            referencedRelation: "tanks"
            referencedColumns: ["id"]
          },
        ]
      }
      branch_fuel_types: {
        Row: {
          branch_id: string
          buying_price: number | null
          created_at: string
          id: string
          last_modified_at: string | null
          last_modified_by: string | null
          name: string
          price_per_litre: number
          stock_level: number
          tank_id: string | null
          updated_at: string
          vat_rate: number
        }
        Insert: {
          branch_id: string
          buying_price?: number | null
          created_at?: string
          id?: string
          last_modified_at?: string | null
          last_modified_by?: string | null
          name: string
          price_per_litre: number
          stock_level?: number
          tank_id?: string | null
          updated_at?: string
          vat_rate?: number
        }
        Update: {
          branch_id?: string
          buying_price?: number | null
          created_at?: string
          id?: string
          last_modified_at?: string | null
          last_modified_by?: string | null
          name?: string
          price_per_litre?: number
          stock_level?: number
          tank_id?: string | null
          updated_at?: string
          vat_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "branch_fuel_types_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_fuel_types_tank_id_fkey"
            columns: ["tank_id"]
            isOneToOne: false
            referencedRelation: "tanks"
            referencedColumns: ["id"]
          },
        ]
      }
      branch_mpesa_credentials: {
        Row: {
          branch_id: string
          mpesa_consumer_key: string | null
          mpesa_consumer_secret: string | null
          mpesa_passkey: string | null
          mpesa_shortcode: string | null
          updated_at: string
        }
        Insert: {
          branch_id: string
          mpesa_consumer_key?: string | null
          mpesa_consumer_secret?: string | null
          mpesa_passkey?: string | null
          mpesa_shortcode?: string | null
          updated_at?: string
        }
        Update: {
          branch_id?: string
          mpesa_consumer_key?: string | null
          mpesa_consumer_secret?: string | null
          mpesa_passkey?: string | null
          mpesa_shortcode?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "branch_mpesa_credentials_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: true
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      branches: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          last_modified_at: string | null
          last_modified_by: string | null
          location: string | null
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          last_modified_at?: string | null
          last_modified_by?: string | null
          location?: string | null
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          last_modified_at?: string | null
          last_modified_by?: string | null
          location?: string | null
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      daily_fuel_stock: {
        Row: {
          branch_fuel_type_id: string | null
          branch_id: string | null
          closing_stock: number
          created_at: string
          fuel_name: string
          id: string
          locked: boolean
          locked_at: string | null
          locked_by: string | null
          opening_stock: number
          recorded_by: string | null
          revenue: number
          sold_litres: number
          stock_date: string
          topups_litres: number
          updated_at: string
        }
        Insert: {
          branch_fuel_type_id?: string | null
          branch_id?: string | null
          closing_stock?: number
          created_at?: string
          fuel_name: string
          id?: string
          locked?: boolean
          locked_at?: string | null
          locked_by?: string | null
          opening_stock?: number
          recorded_by?: string | null
          revenue?: number
          sold_litres?: number
          stock_date?: string
          topups_litres?: number
          updated_at?: string
        }
        Update: {
          branch_fuel_type_id?: string | null
          branch_id?: string | null
          closing_stock?: number
          created_at?: string
          fuel_name?: string
          id?: string
          locked?: boolean
          locked_at?: string | null
          locked_by?: string | null
          opening_stock?: number
          recorded_by?: string | null
          revenue?: number
          sold_litres?: number
          stock_date?: string
          topups_litres?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_fuel_stock_branch_fuel_type_id_fkey"
            columns: ["branch_fuel_type_id"]
            isOneToOne: false
            referencedRelation: "branch_fuel_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_fuel_stock_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      drive_off_incidents: {
        Row: {
          attendant_id: string | null
          branch_id: string
          estimated_amount: number | null
          estimated_litres: number | null
          id: string
          notes: string | null
          pump_id: string | null
          reported_at: string
          reported_by: string | null
          vehicle_plate: string | null
        }
        Insert: {
          attendant_id?: string | null
          branch_id: string
          estimated_amount?: number | null
          estimated_litres?: number | null
          id?: string
          notes?: string | null
          pump_id?: string | null
          reported_at?: string
          reported_by?: string | null
          vehicle_plate?: string | null
        }
        Update: {
          attendant_id?: string | null
          branch_id?: string
          estimated_amount?: number | null
          estimated_litres?: number | null
          id?: string
          notes?: string | null
          pump_id?: string | null
          reported_at?: string
          reported_by?: string | null
          vehicle_plate?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "drive_off_incidents_pump_id_fkey"
            columns: ["pump_id"]
            isOneToOne: false
            referencedRelation: "pumps"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount: number
          category: string | null
          created_at: string
          created_by: string | null
          date: string
          description: string
          id: string
          last_modified_at: string | null
          last_modified_by: string | null
        }
        Insert: {
          amount: number
          category?: string | null
          created_at?: string
          created_by?: string | null
          date?: string
          description: string
          id?: string
          last_modified_at?: string | null
          last_modified_by?: string | null
        }
        Update: {
          amount?: number
          category?: string | null
          created_at?: string
          created_by?: string | null
          date?: string
          description?: string
          id?: string
          last_modified_at?: string | null
          last_modified_by?: string | null
        }
        Relationships: []
      }
      fuel_topups: {
        Row: {
          branch_fuel_type_id: string | null
          branch_id: string | null
          cost_per_litre: number | null
          created_at: string
          created_by: string | null
          expected_litres: number | null
          fuel_type_id: string | null
          id: string
          last_modified_at: string | null
          last_modified_by: string | null
          litres: number
          notes: string | null
          supplier: string | null
          tank_id: string | null
          topup_date: string
        }
        Insert: {
          branch_fuel_type_id?: string | null
          branch_id?: string | null
          cost_per_litre?: number | null
          created_at?: string
          created_by?: string | null
          expected_litres?: number | null
          fuel_type_id?: string | null
          id?: string
          last_modified_at?: string | null
          last_modified_by?: string | null
          litres: number
          notes?: string | null
          supplier?: string | null
          tank_id?: string | null
          topup_date?: string
        }
        Update: {
          branch_fuel_type_id?: string | null
          branch_id?: string | null
          cost_per_litre?: number | null
          created_at?: string
          created_by?: string | null
          expected_litres?: number | null
          fuel_type_id?: string | null
          id?: string
          last_modified_at?: string | null
          last_modified_by?: string | null
          litres?: number
          notes?: string | null
          supplier?: string | null
          tank_id?: string | null
          topup_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "fuel_topups_tank_id_fkey"
            columns: ["tank_id"]
            isOneToOne: false
            referencedRelation: "tanks"
            referencedColumns: ["id"]
          },
        ]
      }
      fuel_types: {
        Row: {
          created_at: string
          id: string
          name: string
          price_per_litre: number
          stock_level: number
          updated_at: string
          vat_rate: number
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          price_per_litre: number
          stock_level?: number
          updated_at?: string
          vat_rate?: number
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          price_per_litre?: number
          stock_level?: number
          updated_at?: string
          vat_rate?: number
        }
        Relationships: []
      }
      mpesa_transactions: {
        Row: {
          amount: number
          created_at: string
          id: string
          mpesa_code: string | null
          phone: string
          sale_id: string | null
          status: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          mpesa_code?: string | null
          phone: string
          sale_id?: string | null
          status?: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          mpesa_code?: string | null
          phone?: string
          sale_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "mpesa_transactions_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_runs: {
        Row: {
          expense_id: string | null
          id: string
          net_amount: number
          period_month: string
          submitted_at: string
          submitted_by: string | null
          user_id: string
        }
        Insert: {
          expense_id?: string | null
          id?: string
          net_amount?: number
          period_month: string
          submitted_at?: string
          submitted_by?: string | null
          user_id: string
        }
        Update: {
          expense_id?: string | null
          id?: string
          net_amount?: number
          period_month?: string
          submitted_at?: string
          submitted_by?: string | null
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string
          id: string
          id_number: string | null
          id_number_used_as_password: boolean
          must_change_password: boolean
          phone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          full_name?: string
          id?: string
          id_number?: string | null
          id_number_used_as_password?: boolean
          must_change_password?: boolean
          phone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          full_name?: string
          id?: string
          id_number?: string | null
          id_number_used_as_password?: boolean
          must_change_password?: boolean
          phone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      pump_nozzles: {
        Row: {
          branch_fuel_type_id: string
          code: string
          created_at: string
          id: string
          pump_id: string
        }
        Insert: {
          branch_fuel_type_id: string
          code: string
          created_at?: string
          id?: string
          pump_id: string
        }
        Update: {
          branch_fuel_type_id?: string
          code?: string
          created_at?: string
          id?: string
          pump_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pump_nozzles_pump_id_fkey"
            columns: ["pump_id"]
            isOneToOne: false
            referencedRelation: "pumps"
            referencedColumns: ["id"]
          },
        ]
      }
      pumps: {
        Row: {
          assigned_attendant_id: string | null
          branch_id: string
          code: string
          created_at: string
          id: string
          label: string | null
          last_modified_at: string | null
          last_modified_by: string | null
          notes: string | null
          status: string
          updated_at: string
        }
        Insert: {
          assigned_attendant_id?: string | null
          branch_id: string
          code: string
          created_at?: string
          id?: string
          label?: string | null
          last_modified_at?: string | null
          last_modified_by?: string | null
          notes?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          assigned_attendant_id?: string | null
          branch_id?: string
          code?: string
          created_at?: string
          id?: string
          label?: string | null
          last_modified_at?: string | null
          last_modified_by?: string | null
          notes?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      reconciliation_reviews: {
        Row: {
          id: string
          note: string | null
          reviewed_at: string
          reviewed_by: string | null
          sale_id: string | null
          status: string
          tx_id: string | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          id?: string
          note?: string | null
          reviewed_at?: string
          reviewed_by?: string | null
          sale_id?: string | null
          status?: string
          tx_id?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          id?: string
          note?: string | null
          reviewed_at?: string
          reviewed_by?: string | null
          sale_id?: string | null
          status?: string
          tx_id?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: []
      }
      sale_deduction_log: {
        Row: {
          branch_fuel_type_id: string
          idempotency_key: string
          litres: number
          processed_at: string
          processed_by: string | null
        }
        Insert: {
          branch_fuel_type_id: string
          idempotency_key: string
          litres: number
          processed_at?: string
          processed_by?: string | null
        }
        Update: {
          branch_fuel_type_id?: string
          idempotency_key?: string
          litres?: number
          processed_at?: string
          processed_by?: string | null
        }
        Relationships: []
      }
      sale_reversals: {
        Row: {
          branch_id: string | null
          created_at: string
          id: string
          reason: string
          requested_at: string
          requested_by: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          sale_id: string
          status: string
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          id?: string
          reason: string
          requested_at?: string
          requested_by?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          sale_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          id?: string
          reason?: string
          requested_at?: string
          requested_by?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          sale_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sale_reversals_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          attendant_id: string | null
          branch_id: string | null
          created_at: string
          fuel_type_id: string
          id: string
          litres: number
          payment_method: string
          pump_id: string | null
          reversed_at: string | null
          reversed_by: string | null
          total_amount: number
        }
        Insert: {
          attendant_id?: string | null
          branch_id?: string | null
          created_at?: string
          fuel_type_id: string
          id?: string
          litres: number
          payment_method: string
          pump_id?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          total_amount: number
        }
        Update: {
          attendant_id?: string | null
          branch_id?: string | null
          created_at?: string
          fuel_type_id?: string
          id?: string
          litres?: number
          payment_method?: string
          pump_id?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          total_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "sales_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_fuel_type_id_fkey"
            columns: ["fuel_type_id"]
            isOneToOne: false
            referencedRelation: "fuel_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_pump_id_fkey"
            columns: ["pump_id"]
            isOneToOne: false
            referencedRelation: "pumps"
            referencedColumns: ["id"]
          },
        ]
      }
      tank_dips: {
        Row: {
          dip_litres: number
          id: string
          notes: string | null
          recorded_at: string
          recorded_by: string | null
          tank_id: string
        }
        Insert: {
          dip_litres: number
          id?: string
          notes?: string | null
          recorded_at?: string
          recorded_by?: string | null
          tank_id: string
        }
        Update: {
          dip_litres?: number
          id?: string
          notes?: string | null
          recorded_at?: string
          recorded_by?: string | null
          tank_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tank_dips_tank_id_fkey"
            columns: ["tank_id"]
            isOneToOne: false
            referencedRelation: "tanks"
            referencedColumns: ["id"]
          },
        ]
      }
      tanks: {
        Row: {
          branch_id: string
          capacity_litres: number
          created_at: string
          current_level_litres: number
          fuel_name: string
          id: string
          last_modified_at: string | null
          last_modified_by: string | null
          low_stock_threshold: number
          notes: string | null
          updated_at: string
        }
        Insert: {
          branch_id: string
          capacity_litres?: number
          created_at?: string
          current_level_litres?: number
          fuel_name: string
          id?: string
          last_modified_at?: string | null
          last_modified_by?: string | null
          low_stock_threshold?: number
          notes?: string | null
          updated_at?: string
        }
        Update: {
          branch_id?: string
          capacity_litres?: number
          created_at?: string
          current_level_litres?: number
          fuel_name?: string
          id?: string
          last_modified_at?: string | null
          last_modified_by?: string | null
          low_stock_threshold?: number
          notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      user_page_permissions: {
        Row: {
          created_at: string
          granted_by: string | null
          id: string
          page_key: string
          user_id: string
        }
        Insert: {
          created_at?: string
          granted_by?: string | null
          id?: string
          page_key: string
          user_id: string
        }
        Update: {
          created_at?: string
          granted_by?: string | null
          id?: string
          page_key?: string
          user_id?: string
        }
        Relationships: []
      }
      user_payroll: {
        Row: {
          allowances: number
          created_at: string
          deductions: number
          gross_salary: number
          id: string
          notes: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          allowances?: number
          created_at?: string
          deductions?: number
          gross_salary?: number
          id?: string
          notes?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          allowances?: number
          created_at?: string
          deductions?: number
          gross_salary?: number
          id?: string
          notes?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_access_branch: {
        Args: { _branch_id: string; _user_id: string }
        Returns: boolean
      }
      deduct_fuel_sale:
        | {
            Args: { _branch_fuel_type_id: string; _litres: number }
            Returns: undefined
          }
        | {
            Args: {
              _branch_fuel_type_id: string
              _idempotency_key?: string
              _litres: number
            }
            Returns: undefined
          }
      delete_reversed_sale: { Args: { _sale_id: string }; Returns: undefined }
      finalize_fuel_day: { Args: { _date: string }; Returns: number }
      get_profile_names: {
        Args: { _ids: string[] }
        Returns: {
          full_name: string
          user_id: string
        }[]
      }
      has_page_permission: {
        Args: { _page: string; _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_assigned_to_branch: {
        Args: { _branch_id: string; _user_id: string }
        Returns: boolean
      }
      log_offline_sync_event: {
        Args: {
          _action: string
          _context?: Json
          _field?: string
          _new_value?: string
          _old_value?: string
          _record_id: string
        }
        Returns: string
      }
      recalc_daily_fuel_stock: {
        Args: { _bft_id: string; _date: string }
        Returns: undefined
      }
      review_sale_reversal: {
        Args: { _approve: boolean; _note?: string; _reversal_id: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "manager" | "attendant"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "manager", "attendant"],
    },
  },
} as const
