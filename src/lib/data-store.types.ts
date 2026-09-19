export type GeneratedFileHash = { path: string; hash: string; content?: string };

/** Serializable JSON value — used for free-form jsonb columns (safe for TanStack server-fn returns). */
export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export type CategoryScoreRow = {
  category: string;
  score: number;
  issueCount: number;
  blockerCount: number;
};

export type LaunchChecklistItemRow = {
  id: string;
  label: string;
  status: string;
  findingId?: string;
  stackSpecific: boolean;
};

/** Who started a scan: the operator clicking Scan, or scheduled monitoring. */
export type ScanTrigger = "manual" | "monitor";

export type DetectedStackRow = {
  frameworks: string[];
  services: string[];
  deployTargets: string[];
  profile: string;
};

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "12";
  };
  public: {
    Tables: {
      repos: {
        Row: {
          id: string;
          name: string;
          full_name: string;
          description: string | null;
          language: string;
          stars: number;
          updated_at: string;
          private: boolean;
          framework: string;
          owner: string | null;
          default_branch: string | null;
        };
        Insert: {
          id: string;
          name: string;
          full_name: string;
          description?: string | null;
          language?: string;
          stars?: number;
          updated_at?: string;
          private?: boolean;
          framework?: string;
          owner?: string | null;
          default_branch?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["repos"]["Insert"]>;
        Relationships: [];
      };
      scans: {
        Row: {
          id: string;
          repo_id: string;
          score: number;
          created_at: string;
          warnings: string | null;
          category_scores: CategoryScoreRow[] | null;
          stack_detected: DetectedStackRow | null;
          checklist: LaunchChecklistItemRow[] | null;
          launch_target: string | null;
          launch_timeline: string | null;
          file_hashes: Record<string, string> | null;
          git_sha: string | null;
          dependency_graph: Json | null;
          trigger: ScanTrigger;
        };
        Insert: {
          id: string;
          repo_id: string;
          score: number;
          created_at?: string;
          warnings?: string | null;
          category_scores?: CategoryScoreRow[] | null;
          stack_detected?: DetectedStackRow | null;
          checklist?: LaunchChecklistItemRow[] | null;
          launch_target?: string | null;
          launch_timeline?: string | null;
          file_hashes?: Record<string, string> | null;
          git_sha?: string | null;
          dependency_graph?: Json | null;
          trigger?: ScanTrigger;
        };
        Update: Partial<Database["public"]["Tables"]["scans"]["Insert"]>;
        Relationships: [];
      };
      issues: {
        Row: {
          id: string;
          scan_id: string;
          category: string;
          title: string;
          severity: string;
          why: string;
          time_saved: string;
          fix_id: string;
          risk_level: string | null;
          business_impact: string | null;
          production_scenario: string | null;
          affected_audience: string | null;
          fix_difficulty: string | null;
          priority: number | null;
          auto_fixable: boolean | null;
          source: string | null;
          readiness_category: string | null;
          fix_pack_id: string | null;
          checked_for: string[] | null;
          found_evidence: string | null;
          confidence: string | null;
          recommended_fix: string | null;
          ai_effort: number | null;
          detection: string[] | null;
          verified_at: string | null;
          fingerprint: string | null;
        };
        Insert: {
          id: string;
          scan_id: string;
          category: string;
          title: string;
          severity: string;
          why: string;
          time_saved: string;
          fix_id: string;
          risk_level?: string | null;
          business_impact?: string | null;
          production_scenario?: string | null;
          affected_audience?: string | null;
          fix_difficulty?: string | null;
          priority?: number | null;
          auto_fixable?: boolean | null;
          source?: string | null;
          readiness_category?: string | null;
          fix_pack_id?: string | null;
          checked_for?: string[] | null;
          found_evidence?: string | null;
          confidence?: string | null;
          recommended_fix?: string | null;
          ai_effort?: number | null;
          detection?: string[] | null;
          verified_at?: string | null;
          fingerprint?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["issues"]["Insert"]>;
        Relationships: [];
      };
      fix_requests: {
        Row: {
          id: string;
          repo_id: string;
          scan_id: string;
          fixes: string;
          status: string;
          branch_name: string;
          pr_number: number | null;
          pr_url: string | null;
          error_message: string | null;
          est_files_added: number;
          est_files_changed: number;
          est_deps: number;
          effort_score: number;
          owner_login: string | null;
          ai_files: string | null;
          generated_file_hashes: GeneratedFileHash[] | null;
          priority: number;
          pending_files: string | null;
          pending_verification_notes: string | null;
          pending_ai_files: string | null;
          regenerate_feedback: string | null;
          regenerate_count: number;
          agent_reasoning: Json | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          repo_id: string;
          scan_id: string;
          fixes: string;
          status?: string;
          branch_name: string;
          pr_number?: number | null;
          pr_url?: string | null;
          error_message?: string | null;
          est_files_added?: number;
          est_files_changed?: number;
          est_deps?: number;
          effort_score?: number;
          owner_login?: string | null;
          ai_files?: string | null;
          generated_file_hashes?: GeneratedFileHash[] | null;
          priority?: number;
          pending_files?: string | null;
          pending_verification_notes?: string | null;
          pending_ai_files?: string | null;
          regenerate_feedback?: string | null;
          regenerate_count?: number;
          agent_reasoning?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["fix_requests"]["Insert"]>;
        Relationships: [];
      };
      site_config: {
        Row: {
          key: string;
          value: string;
          updated_at: string;
        };
        Insert: {
          key: string;
          value: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["site_config"]["Insert"]>;
        Relationships: [];
      };
      marketing_articles: {
        Row: {
          id: string;
          slug: string;
          section: string;
          title: string;
          date_label: string;
          category: string | null;
          author: string;
          read_time: string | null;
          image: string | null;
          body: string;
          sort_order: number;
          published: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          slug: string;
          section: string;
          title: string;
          date_label: string;
          category?: string | null;
          author?: string;
          read_time?: string | null;
          image?: string | null;
          body: string;
          sort_order?: number;
          published?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["marketing_articles"]["Insert"]>;
        Relationships: [];
      };
      ai_usage: {
        Row: {
          id: number;
          github_login: string | null;
          provider: string;
          model: string;
          task_type: string;
          method: string;
          input_tokens: number;
          output_tokens: number;
          cached_input_tokens: number;
          est_cost_usd: number;
          created_at: string;
        };
        Insert: {
          id?: number;
          github_login?: string | null;
          provider: string;
          model: string;
          task_type: string;
          method: string;
          input_tokens?: number;
          output_tokens?: number;
          cached_input_tokens?: number;
          est_cost_usd?: number;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["ai_usage"]["Insert"]>;
        Relationships: [];
      };
      arch_scans: {
        Row: {
          id: string;
          repo_id: string;
          score: number;
          findings: string;
          scanned_files: number;
          created_at: string;
        };
        Insert: {
          id: string;
          repo_id: string;
          score: number;
          findings: string;
          scanned_files?: number;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["arch_scans"]["Insert"]>;
        Relationships: [];
      };
      ai_test_cache: {
        Row: {
          id: string;
          scan_id: string;
          fix_ids: string;
          result: string;
          content_hash: string | null;
          created_at: string;
          prompt_version: string;
        };
        Insert: {
          id: string;
          scan_id: string;
          fix_ids: string;
          result: string;
          content_hash?: string | null;
          created_at?: string;
          prompt_version?: string;
        };
        Update: Partial<Database["public"]["Tables"]["ai_test_cache"]["Insert"]>;
        Relationships: [];
      };
      fix_cache: {
        Row: {
          id: string;
          repo_id: string;
          fix_ids: string;
          framework: string;
          files_json: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          repo_id: string;
          fix_ids: string;
          framework?: string;
          files_json: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["fix_cache"]["Insert"]>;
        Relationships: [];
      };
      fix_recoveries: {
        Row: {
          id: string;
          fix_request_id: string;
          user_login: string;
          error_log: string;
          error_signature: string;
          tier: number;
          drift_level: string;
          resolution_type: string;
          patch_pr_url: string | null;
          patch_path: string | null;
          patch_content: string | null;
          attempt_count: number;
          ai_effort: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          fix_request_id: string;
          user_login: string;
          error_log: string;
          error_signature: string;
          tier: number;
          drift_level: string;
          resolution_type: string;
          patch_pr_url?: string | null;
          patch_path?: string | null;
          patch_content?: string | null;
          attempt_count?: number;
          ai_effort?: number;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["fix_recoveries"]["Insert"]>;
        Relationships: [];
      };
      launch_reports: {
        Row: {
          id: string;
          share_token: string;
          repo_id: string;
          scan_id: string;
          owner_login: string;
          revoked: boolean;
          created_at: string;
        };
        Insert: {
          id: string;
          share_token: string;
          repo_id: string;
          scan_id: string;
          owner_login: string;
          revoked?: boolean;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["launch_reports"]["Insert"]>;
        Relationships: [];
      };
      risk_acceptances: {
        Row: {
          id: string;
          repo_id: string;
          fix_id: string;
          user_id: string;
          reason_type: string;
          note: string | null;
          accepted_at: string;
        };
        Insert: {
          id?: string;
          repo_id: string;
          fix_id: string;
          user_id: string;
          reason_type: string;
          note?: string | null;
          accepted_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["risk_acceptances"]["Insert"]>;
        Relationships: [];
      };
      background_jobs: {
        Row: {
          id: string;
          kind: string;
          payload: Record<string, unknown>;
          status: "pending" | "running" | "completed" | "failed";
          attempts: number;
          max_attempts: number;
          available_at: string;
          locked_at: string | null;
          last_error: string | null;
          created_at: string;
          updated_at: string;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          kind: string;
          payload: Record<string, unknown>;
          status?: "pending" | "running" | "completed" | "failed";
          attempts?: number;
          max_attempts?: number;
          available_at?: string;
          locked_at?: string | null;
          last_error?: string | null;
          created_at?: string;
          updated_at?: string;
          completed_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["background_jobs"]["Insert"]>;
        Relationships: [];
      };
      live_site_scans: {
        Row: {
          id: string;
          user_id: string;
          domain: string;
          scan_id: string | null;
          repo_id: string | null;
          status: string;
          results: unknown;
          security_score: number | null;
          created_at: string;
          started_at: string | null;
          finished_at: string | null;
        };
        Insert: {
          id: string;
          user_id: string;
          domain: string;
          scan_id?: string | null;
          repo_id?: string | null;
          status?: string;
          results?: unknown;
          security_score?: number | null;
          created_at?: string;
          started_at?: string | null;
          finished_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["live_site_scans"]["Insert"]>;
        Relationships: [];
      };
      domain_scan_confirmations: {
        Row: {
          id: string;
          user_id: string;
          domain: string;
          confirmed_at: string;
          scan_id: string | null;
          ip_address: string | null;
        };
        Insert: {
          id: string;
          user_id: string;
          domain: string;
          confirmed_at?: string;
          scan_id?: string | null;
          ip_address?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["domain_scan_confirmations"]["Insert"]>;
        Relationships: [];
      };
      category_score_history: {
        Row: {
          id: string;
          user_id: string;
          category: string;
          repo_id: string | null;
          domain: string | null;
          score: number;
          recorded_at: string;
        };
        Insert: {
          id: string;
          user_id: string;
          category: string;
          repo_id?: string | null;
          domain?: string | null;
          score: number;
          recorded_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["category_score_history"]["Insert"]>;
        Relationships: [];
      };
      live_site_monitors: {
        Row: {
          id: string;
          user_id: string;
          domain: string;
          repo_id: string | null;
          cadence: string;
          enabled: boolean;
          last_enqueued_at: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          user_id: string;
          domain: string;
          repo_id?: string | null;
          cadence: string;
          enabled?: boolean;
          last_enqueued_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["live_site_monitors"]["Insert"]>;
        Relationships: [];
      };
      repo_monitors: {
        Row: {
          id: string;
          repo_id: string;
          user_id: string;
          cadence: string;
          enabled: boolean;
          last_enqueued_at: string | null;
          last_notified_at: string | null;
          last_head_sha: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          repo_id: string;
          user_id: string;
          cadence: string;
          enabled?: boolean;
          last_enqueued_at?: string | null;
          last_notified_at?: string | null;
          last_head_sha?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["repo_monitors"]["Insert"]>;
        Relationships: [];
      };
      sandbox_verify_runs: {
        Row: {
          id: string;
          repo_id: string;
          user_id: string;
          scan_id: string | null;
          fix_request_id: string | null;
          status: string;
          branch_name: string | null;
          runtime_version: string | null;
          package_manager: string | null;
          include_test: boolean;
          raw_log: string | null;
          structured_results: unknown;
          error_message: string | null;
          created_at: string;
          started_at: string | null;
          finished_at: string | null;
          planned_steps: unknown;
          current_step: string | null;
          completed_steps: unknown;
          live_log: string;
          git_sha: string | null;
          duration_ms: number | null;
          est_cost_usd: number | null;
          quota_refunded: boolean;
        };
        Insert: {
          id: string;
          repo_id: string;
          user_id: string;
          scan_id?: string | null;
          fix_request_id?: string | null;
          status?: string;
          branch_name?: string | null;
          runtime_version?: string | null;
          package_manager?: string | null;
          include_test?: boolean;
          raw_log?: string | null;
          structured_results?: unknown;
          error_message?: string | null;
          created_at?: string;
          started_at?: string | null;
          finished_at?: string | null;
          planned_steps?: unknown;
          current_step?: string | null;
          completed_steps?: unknown;
          live_log?: string;
          git_sha?: string | null;
          duration_ms?: number | null;
          est_cost_usd?: number | null;
          quota_refunded?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["sandbox_verify_runs"]["Insert"]>;
        Relationships: [];
      };
      project_env_vars: {
        Row: {
          id: string;
          repo_id: string;
          user_id: string;
          key: string;
          encrypted_value: string;
          key_version: number;
          is_secret: boolean;
          created_at: string;
          updated_at: string;
          created_by: string;
          last_used_at: string | null;
        };
        Insert: {
          id: string;
          repo_id: string;
          user_id: string;
          key: string;
          encrypted_value: string;
          key_version?: number;
          is_secret?: boolean;
          created_at?: string;
          updated_at?: string;
          created_by: string;
          last_used_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["project_env_vars"]["Insert"]>;
        Relationships: [];
      };
      project_build_settings: {
        Row: {
          repo_id: string;
          user_id: string;
          root_dir: string | null;
          build_command: string | null;
          node_version: string | null;
          include_test: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          repo_id: string;
          user_id: string;
          root_dir?: string | null;
          build_command?: string | null;
          node_version?: string | null;
          include_test?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["project_build_settings"]["Insert"]>;
        Relationships: [];
      };
      repo_knowledge_facts: {
        Row: {
          id: string;
          repo_id: string;
          fact_key: string;
          scope: string;
          value: unknown;
          state: string;
          tier: number;
          confidence: string;
          producer: string;
          evidence_ref: string | null;
          superseded_by: string | null;
          first_observed_at: string;
          verified_at: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          repo_id: string;
          fact_key: string;
          scope?: string;
          value: unknown;
          state: string;
          tier: number;
          confidence: string;
          producer: string;
          evidence_ref?: string | null;
          superseded_by?: string | null;
          first_observed_at?: string;
          verified_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["repo_knowledge_facts"]["Insert"]>;
        Relationships: [];
      };
      sandbox_audit_log: {
        Row: {
          id: string;
          user_id: string;
          repo_id: string | null;
          action: string;
          job_id: string | null;
          meta: unknown;
          created_at: string;
        };
        Insert: {
          id: string;
          user_id: string;
          repo_id?: string | null;
          action: string;
          job_id?: string | null;
          meta?: unknown;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["sandbox_audit_log"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      check_rate_limit: {
        Args: { p_key: string; p_max: number; p_window_seconds: number };
        Returns: {
          allowed: boolean;
          retry_after: number;
        }[];
      };
      prune_rate_limit_hits: {
        Args: Record<string, never>;
        Returns: number;
      };
      prune_short_locks: {
        Args: { p_ttl_seconds?: number };
        Returns: number;
      };
      run_retention_sweep: {
        Args: Record<string, never>;
        Returns: Record<string, number>;
      };
      table_row_estimate: {
        Args: { p_table: string };
        Returns: number;
      };
      claim_background_job: {
        Args: { p_id?: string | null };
        Returns: Database["public"]["Tables"]["background_jobs"]["Row"][];
      };
      reclaim_stuck_background_jobs: {
        Args: { p_stale_seconds?: number };
        Returns: number;
      };
      defer_background_job: {
        Args: { p_id: string; p_delay_seconds: number; p_reason?: string | null };
        Returns: undefined;
      };
      acquire_sandbox_slot: {
        Args: { p_run_id: string; p_max: number; p_stale_seconds: number };
        Returns: boolean;
      };
      release_sandbox_slot: {
        Args: { p_run_id: string };
        Returns: undefined;
      };
      acquire_short_lock: {
        Args: { p_key: string; p_ttl_seconds: number };
        Returns: boolean;
      };
      release_short_lock: {
        Args: { p_key: string };
        Returns: undefined;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
