// Types for the HA entity auditor.

export type AuditSeverity = "error" | "warning" | "info";

export type AuditCategory =
  | "naming"
  | "stale"
  | "duplicate"
  | "organization"
  | "clutter";

/** What automated fix the "Fix" button should apply. */
export type FixAction =
  | { type: "rename"; newName: string }
  | { type: "disable" };

export interface AuditFinding {
  /** Unique key for React rendering. */
  id: string;
  category: AuditCategory;
  severity: AuditSeverity;
  /** The entity this finding relates to (if applicable). */
  entityId?: string;
  /** Short summary shown as the finding title. */
  title: string;
  /** Longer explanation or recommendation. */
  detail: string;
  /** Suggested fix (e.g. a new friendly_name). */
  suggestion?: string;
  /** If present, this finding can be auto-fixed. */
  fix?: FixAction;
}

export interface AuditReport {
  /** Total entities analysed. */
  entityCount: number;
  /** Counts per severity. */
  errors: number;
  warnings: number;
  infos: number;
  /** All findings, grouped by category in display order. */
  findings: AuditFinding[];
  /** Milliseconds the audit took. */
  elapsedMs: number;
}

export const CATEGORY_LABEL: Record<AuditCategory, string> = {
  naming: "Naming Issues",
  stale: "Stale Entities",
  duplicate: "Duplicates",
  organization: "Organization",
  clutter: "Clutter",
};

export const CATEGORY_ORDER: AuditCategory[] = [
  "stale",
  "naming",
  "duplicate",
  "organization",
  "clutter",
];
