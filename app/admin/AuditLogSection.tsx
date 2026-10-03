"use client";

/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useState } from "react";

type AuditLog = {
  id: number;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string | number | null;
  metadata: Record<string, string | number | boolean>;
  createdAt: string;
};

type AuditLogResponse = { auditLogs: AuditLog[]; error?: string };

function formatDate(value: string): string {
  try {
    return new Intl.DateTimeFormat("en-IN", {
      dateStyle: "medium",
      timeStyle: "medium",
      timeZone: "Asia/Kolkata",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export default function AuditLogSection() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/audit-logs", { cache: "no-store" });
      const result = (await response.json().catch(() => null)) as AuditLogResponse | null;
      if (!response.ok) throw new Error(result?.error ?? `Failed (${response.status})`);
      setLogs(result?.auditLogs ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load audit logs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="bg-kjsurface border border-kjborder rounded-lg overflow-hidden mt-6">
      <div className="px-5 py-4 border-b border-kjborder flex justify-between items-center gap-3">
        <div>
          <h2 className="font-mono text-sm text-kjtext">Admin audit log</h2>
          <p className="mt-1 text-[11px] font-mono text-kjtext-muted">Latest 100 actions · sensitive metadata omitted</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="border border-kjborder rounded px-3 py-1.5 text-[11px] font-mono text-kjtext-muted hover:text-kjprimary disabled:opacity-50"
        >
          {loading ? "LOADING…" : "REFRESH"}
        </button>
      </div>
      {error && <p role="alert" className="mx-5 mt-4 border border-red-500/20 bg-red-500/10 text-red-400 rounded p-3 text-xs font-mono">{error}</p>}
      {loading && logs.length === 0 ? (
        <p className="px-5 py-8 text-center text-xs font-mono text-kjtext-muted">Loading audit log…</p>
      ) : logs.length === 0 ? (
        <p className="px-5 py-8 text-center text-xs font-mono text-kjtext-muted">No audit events recorded.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr>{["When", "Actor", "Action", "Entity", "Details"].map((heading) => (
                <th key={heading} className="px-4 py-3 text-[11px] uppercase tracking-widest font-mono text-kjtext-muted">{heading}</th>
              ))}</tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="border-t border-kjborder/70">
                  <td className="px-4 py-3 text-xs font-mono text-kjtext-muted whitespace-nowrap">{formatDate(log.createdAt)}</td>
                  <td className="px-4 py-3 text-xs font-mono text-kjtext">{log.actorId}</td>
                  <td className="px-4 py-3 text-xs font-mono text-kjprimary">{log.action}</td>
                  <td className="px-4 py-3 text-xs font-mono text-kjtext-muted">{log.entityType}{log.entityId === null ? "" : ` #${log.entityId}`}</td>
                  <td className="px-4 py-3 text-xs font-mono text-kjtext-muted">{Object.entries(log.metadata).map(([key, value]) => `${key}: ${value}`).join(" · ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
