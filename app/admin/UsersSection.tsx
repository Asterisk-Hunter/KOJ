"use client";

/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useState } from "react";

type AdminUser = {
  clerkId: string;
  username: string;
  email: string;
  role: string;
  suspended: boolean;
  createdAt: string;
};

const inputCls =
  "bg-kjsurface border border-kjborder rounded px-3 py-2 text-sm font-mono text-kjtext";

export default function UsersSection() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (query.trim()) params.set("q", query.trim());
      if (roleFilter) params.set("role", roleFilter);
      const res = await fetch(`/api/admin/users?${params.toString()}`, { cache: "no-store" });
      const j = (await res.json().catch(() => null)) as {
        users?: AdminUser[];
        error?: string;
      } | null;
      if (!res.ok) throw new Error(j?.error ?? `failed (${res.status})`);
      setUsers(j?.users ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load");
    } finally {
      setLoading(false);
    }
  }, [query, roleFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSuspend(clerkId: string, suspended: boolean) {
    setBusy(clerkId);
    setNotice(null);
    setError(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clerkId, suspended }),
      });
      const j = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(j?.error ?? `failed (${res.status})`);
      setNotice(suspended ? `Suspended ${clerkId.slice(0, 12)}…` : `Reinstated ${clerkId.slice(0, 12)}…`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "update failed");
    } finally {
      setBusy(null);
    }
  }
  async function handleRoleChange(clerkId: string, role: string) {
    setBusy(clerkId);
    setNotice(null);
    setError(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clerkId, role }),
      });
      const j = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(j?.error ?? `failed (${res.status})`);
      setNotice(`Role updated for ${clerkId.slice(0, 12)}… → ${role}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "update failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="bg-kjsurface border border-kjborder rounded-lg overflow-hidden mt-6">
      <div className="px-5 py-4 border-b border-kjborder flex justify-between items-center flex-wrap gap-3">
        <h2 className="font-mono text-sm text-kjtext">Role management</h2>
        <div className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search username/email"
            className={`${inputCls} w-52`}
          />
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className={inputCls}
            aria-label="Filter by role"
          >
            <option value="">all roles</option>
            <option value="contestant">contestant</option>
            <option value="problem_setter">problem_setter</option>
            <option value="contest_setter">contest_setter</option>
            <option value="admin">admin</option>
          </select>
        </div>
      </div>

      {notice && (
        <p className="mx-5 mt-4 border border-kjprimary/20 bg-kjprimary/5 text-kjprimary rounded p-3 text-xs font-mono">
          {notice}
        </p>
      )}
      {error && (
        <p className="mx-5 mt-4 border border-red-500/20 bg-red-500/10 text-red-400 rounded p-3 text-xs font-mono">
          {error}
        </p>
      )}

      {loading ? (
        <p className="px-5 py-8 text-center text-xs font-mono text-kjtext-muted">Loading users…</p>
      ) : users.length === 0 ? (
        <p className="px-5 py-8 text-center text-xs font-mono text-kjtext-muted">No users found.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                {["User", "Email", "Role", "Status", ""].map((heading) => (
                  <th
                    key={heading}
                    className="px-5 py-3 text-left text-[11px] uppercase tracking-widest font-mono text-kjtext-muted"
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.clerkId} className="border-t border-kjborder/70">
                  <td className="px-5 py-3 font-mono text-sm text-kjtext">{user.username}</td>
                  <td className="px-5 py-3 text-sm text-kjtext-muted">{user.email}</td>
                  <td className="px-5 py-3 text-xs font-mono text-kjprimary">{user.role}</td>
                  <td className="px-5 py-3">
                    <button
                      onClick={() => void handleSuspend(user.clerkId, !user.suspended)}
                      disabled={busy === user.clerkId}
                      className={`border rounded px-3 py-1.5 text-[11px] font-mono disabled:opacity-50 ${
                        user.suspended
                          ? "border-red-500/40 text-red-400"
                          : "border-kjborder text-kjtext-muted hover:text-kjtext"
                      }`}
                    >
                      {user.suspended ? "SUSPENDED" : "ACTIVE"}
                    </button>
                  </td>
                  <td className="px-5 py-3">
                    <select
                      value={user.role}
                      disabled={busy === user.clerkId}
                      onChange={(e) => void handleRoleChange(user.clerkId, e.target.value)}
                      className={`${inputCls} text-xs`}
                      aria-label={`Change role for ${user.username}`}
                    >
                      <option value="contestant">contestant</option>
                      <option value="problem_setter">problem_setter</option>
                      <option value="contest_setter">contest_setter</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
