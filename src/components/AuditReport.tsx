"use client";

import { useCallback, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Copy,
  Info,
  Loader2,
  Wrench,
} from "lucide-react";
import type {
  AuditFinding,
  AuditReport as AuditReportType,
  AuditCategory,
  FixAction,
} from "@/lib/audit-types";
import { CATEGORY_LABEL, CATEGORY_ORDER } from "@/lib/audit-types";

const PAGE_SIZE = 10;

type FixStatus = "idle" | "fixing" | "fixed" | "error";

interface AuditReportProps {
  report: AuditReportType | null;
  loading: boolean;
  haUrl: string;
  haToken: string;
}

export function AuditReport({ report, loading, haUrl, haToken }: AuditReportProps) {
  // Track fix status per finding id.
  const [fixStatuses, setFixStatuses] = useState<Map<string, FixStatus>>(new Map());
  const [fixErrors, setFixErrors] = useState<Map<string, string>>(new Map());

  const applyFix = useCallback(
    async (findingId: string, entityId: string, action: FixAction) => {
      setFixStatuses((m) => new Map(m).set(findingId, "fixing"));
      try {
        const res = await fetch("/api/ha-fix", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ haUrl, haToken, entityId, action }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error || `Fix failed (${res.status})`);
        }
        setFixStatuses((m) => new Map(m).set(findingId, "fixed"));
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Fix failed";
        setFixStatuses((m) => new Map(m).set(findingId, "error"));
        setFixErrors((m) => new Map(m).set(findingId, msg));
      }
    },
    [haUrl, haToken],
  );

  const applyAllInSection = useCallback(
    async (findings: AuditFinding[]) => {
      const fixable = findings.filter(
        (f) => f.fix && f.entityId && fixStatuses.get(f.id) !== "fixed",
      );
      for (const f of fixable) {
        await applyFix(f.id, f.entityId!, f.fix!);
      }
    },
    [applyFix, fixStatuses],
  );

  if (loading) {
    return (
      <div className="p-6 bg-slate-800/40 border border-slate-700 rounded-xl text-center">
        <ClipboardCheck className="w-8 h-8 mx-auto mb-2 text-cyan-400 animate-pulse" />
        <p className="text-sm text-slate-300">Auditing your Home Assistant setup...</p>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="p-8 bg-slate-800/30 border border-slate-700/50 rounded-xl text-center space-y-2">
        <ClipboardCheck className="w-10 h-10 mx-auto text-slate-600" />
        <p className="text-sm text-slate-400">
          Run an audit to analyse your HA entities for naming issues, stale
          devices, duplicates, and clutter.
        </p>
      </div>
    );
  }

  const grouped = groupByCategory(report.findings);
  const total = report.errors + report.warnings + report.infos;
  const fixedCount = [...fixStatuses.values()].filter((s) => s === "fixed").length;

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="p-4 bg-slate-800/50 border border-slate-700 rounded-xl">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="text-sm font-semibold text-slate-200">
            Audit Results — {report.entityCount} entities scanned
          </h3>
          <span className="text-xs text-slate-500">{report.elapsedMs}ms</span>
        </div>
        <div className="flex items-center gap-4 mt-2 flex-wrap">
          {report.errors > 0 && (
            <SeverityBadge icon={<AlertCircle className="w-3.5 h-3.5" />} count={report.errors} label="errors" className="text-red-400 bg-red-500/10 border-red-500/30" />
          )}
          {report.warnings > 0 && (
            <SeverityBadge icon={<AlertTriangle className="w-3.5 h-3.5" />} count={report.warnings} label="warnings" className="text-amber-400 bg-amber-500/10 border-amber-500/30" />
          )}
          {report.infos > 0 && (
            <SeverityBadge icon={<Info className="w-3.5 h-3.5" />} count={report.infos} label="info" className="text-blue-400 bg-blue-500/10 border-blue-500/30" />
          )}
          {fixedCount > 0 && (
            <SeverityBadge icon={<Check className="w-3.5 h-3.5" />} count={fixedCount} label="fixed" className="text-green-400 bg-green-500/10 border-green-500/30" />
          )}
          {total === 0 && (
            <span className="text-sm text-green-400 font-medium flex items-center gap-1.5">
              <Check className="w-4 h-4" />
              Everything looks clean!
            </span>
          )}
        </div>
      </div>

      {/* Category groups */}
      {CATEGORY_ORDER.map((cat) => {
        const findings = grouped.get(cat);
        if (!findings || findings.length === 0) return null;
        return (
          <CategorySection
            key={cat}
            category={cat}
            findings={findings}
            fixStatuses={fixStatuses}
            fixErrors={fixErrors}
            onFix={applyFix}
            onFixAll={applyAllInSection}
          />
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SeverityBadge({
  icon,
  count,
  label,
  className,
}: {
  icon: React.ReactNode;
  count: number;
  label: string;
  className: string;
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium ${className}`}>
      {icon}
      {count} {label}
    </span>
  );
}

function CategorySection({
  category,
  findings,
  fixStatuses,
  fixErrors,
  onFix,
  onFixAll,
}: {
  category: AuditCategory;
  findings: AuditFinding[];
  fixStatuses: Map<string, FixStatus>;
  fixErrors: Map<string, string>;
  onFix: (findingId: string, entityId: string, action: FixAction) => Promise<void>;
  onFixAll: (findings: AuditFinding[]) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(true);
  const [page, setPage] = useState(0);
  const [fixingAll, setFixingAll] = useState(false);

  const totalPages = Math.ceil(findings.length / PAGE_SIZE);
  const pageFindings = findings.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const fixableCount = findings.filter(
    (f) => f.fix && f.entityId && fixStatuses.get(f.id) !== "fixed",
  ).length;
  const fixedInSection = findings.filter((f) => fixStatuses.get(f.id) === "fixed").length;

  const handleFixAll = async () => {
    setFixingAll(true);
    await onFixAll(findings);
    setFixingAll(false);
  };

  return (
    <div className="border border-slate-700 rounded-xl overflow-hidden">
      {/* Section header */}
      <div className="flex items-center bg-slate-800/60">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex-1 flex items-center gap-2 px-4 py-3 hover:bg-slate-800 text-left transition-colors"
        >
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-slate-400" />
          ) : (
            <ChevronRight className="w-4 h-4 text-slate-400" />
          )}
          <span className="text-sm font-semibold text-slate-200">
            {CATEGORY_LABEL[category]}
          </span>
          <span className="text-xs text-slate-500">
            {findings.length} finding{findings.length === 1 ? "" : "s"}
            {fixedInSection > 0 && (
              <span className="text-green-400 ml-1">· {fixedInSection} fixed</span>
            )}
          </span>
        </button>
        {fixableCount > 0 && expanded && (
          <button
            type="button"
            onClick={handleFixAll}
            disabled={fixingAll}
            className="flex items-center gap-1.5 px-3 py-1.5 mr-3 text-xs font-medium bg-violet-500/15 text-violet-300 border border-violet-500/30 rounded-lg hover:bg-violet-500/25 disabled:opacity-50 transition-colors"
          >
            {fixingAll ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Wrench className="w-3.5 h-3.5" />
            )}
            Fix All ({fixableCount})
          </button>
        )}
      </div>

      {expanded && (
        <>
          <div className="divide-y divide-slate-700/50">
            {pageFindings.map((f) => (
              <FindingRow
                key={f.id}
                finding={f}
                fixStatus={fixStatuses.get(f.id) ?? "idle"}
                fixError={fixErrors.get(f.id)}
                onFix={onFix}
              />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-2 bg-slate-900/40 border-t border-slate-700/50">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Previous
              </button>
              <span className="text-xs text-slate-500">
                Page {page + 1} of {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                Next
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FindingRow({
  finding,
  fixStatus,
  fixError,
  onFix,
}: {
  finding: AuditFinding;
  fixStatus: FixStatus;
  fixError?: string;
  onFix: (findingId: string, entityId: string, action: FixAction) => Promise<void>;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!finding.suggestion) return;
    navigator.clipboard.writeText(finding.suggestion).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const canFix = finding.fix && finding.entityId && fixStatus !== "fixed";

  return (
    <div className={`px-4 py-3 space-y-1 ${fixStatus === "fixed" ? "opacity-50" : ""}`}>
      <div className="flex items-start gap-2">
        {fixStatus === "fixed" ? (
          <Check className="w-4 h-4 text-green-400 shrink-0 mt-0.5" />
        ) : (
          <SeverityIcon severity={finding.severity} />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm text-slate-200 font-medium">
            {finding.title}
            {fixStatus === "fixed" && (
              <span className="ml-2 text-xs text-green-400 font-normal">Fixed</span>
            )}
          </p>
          {finding.entityId && (
            <p className="text-xs text-slate-500 font-mono truncate">{finding.entityId}</p>
          )}
        </div>
        {canFix && (
          <button
            type="button"
            onClick={() => onFix(finding.id, finding.entityId!, finding.fix!)}
            disabled={fixStatus === "fixing"}
            className="flex items-center gap-1 px-2 py-1 text-xs font-medium bg-violet-500/15 text-violet-300 border border-violet-500/30 rounded-md hover:bg-violet-500/25 disabled:opacity-50 transition-colors shrink-0"
          >
            {fixStatus === "fixing" ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Wrench className="w-3 h-3" />
            )}
            {finding.fix!.type === "rename" ? "Rename" : "Disable"}
          </button>
        )}
      </div>
      {fixStatus !== "fixed" && (
        <p className="text-xs text-slate-400 leading-relaxed pl-6">{finding.detail}</p>
      )}
      {fixStatus === "error" && fixError && (
        <p className="text-xs text-red-400 pl-6">{fixError}</p>
      )}
      {finding.suggestion && fixStatus !== "fixed" && (
        <div className="pl-6 flex items-center gap-2 mt-1">
          <span className="text-xs text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 rounded px-2 py-0.5 font-mono truncate max-w-[300px]">
            {finding.suggestion}
          </span>
          <button
            type="button"
            onClick={handleCopy}
            className="text-slate-500 hover:text-slate-300 transition-colors shrink-0"
            title="Copy suggestion"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
      )}
    </div>
  );
}

function SeverityIcon({ severity }: { severity: AuditFinding["severity"] }) {
  switch (severity) {
    case "error":
      return <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />;
    case "warning":
      return <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />;
    case "info":
      return <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupByCategory(findings: AuditFinding[]): Map<AuditCategory, AuditFinding[]> {
  const map = new Map<AuditCategory, AuditFinding[]>();
  for (const f of findings) {
    let arr = map.get(f.category);
    if (!arr) {
      arr = [];
      map.set(f.category, arr);
    }
    arr.push(f);
  }
  return map;
}
