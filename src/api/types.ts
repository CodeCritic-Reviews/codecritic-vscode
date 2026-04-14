/** Subset of codecritic-frontend review types for the extension. */

export type ReviewStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';

export type FindingVisibility = 'visible' | 'collapsed_chain' | 'collapsed_user_rule';
export type FindingUserState = 'dismissed' | 'done';

export interface FindingUiItem {
  index: number;
  fingerprint: string;
  visibility: FindingVisibility;
  user_state: FindingUserState | null;
  collapse_reason: string | null;
}

export interface FindingsSummary {
  total: number;
  done_count: number;
  dismissed_count: number;
}

export interface FindingsUi {
  version: number;
  chain: {
    root_review_uuid: string | null;
    previous_review_uuid: string | null;
  };
  issues_summary: FindingsSummary;
  suggestions_summary: FindingsSummary;
  issues: FindingUiItem[];
  suggestions: FindingUiItem[];
}

export interface TrustFocusResult {
  version?: number;
  status?: 'ok' | 'failed' | string;
  error?: string;
  trust_risk_level?: string;
  risk_rationale?: string;
  what_green_ci_can_miss?: string[];
  assumptions_introduced_or_changed?: string[];
  invariants_and_boundaries?: string[];
  failure_modes?: string[];
  verification_ladder?: string[];
  blind_spots?: string[];
  signals_from_tooling?: Record<string, unknown>;
}

export interface ReviewIssue {
  type?: string;
  message: string;
  line?: number;
  path?: string;
  suggestion?: string;
  suggestion_code?: string;
  severity?: string;
}

export interface ReviewResult {
  score?: number;
  issues?: ReviewIssue[];
  suggestions?: Array<string | { message?: string; text?: string }>;
  analyzed_at?: string;
  trust_focus?: TrustFocusResult;
  ai_analysis?: {
    summary?: string;
    strengths?: string[];
    improvements?: string[];
    programming_language?: string;
  };
}

export interface CodeReviewPayload {
  uuid: string;
  title?: string | null;
  language?: string;
  status: ReviewStatus;
  review_result?: ReviewResult | null;
  findings_ui?: FindingsUi | null;
  error_message?: string;
}

export interface ApiErrorBody {
  error?: string;
  message?: string;
  reason?: string;
  success?: false;
}
