"use client";

import { type FormEvent, useState } from "react";
import { isOrganizationRole } from "@/lib/organization-policy";

type OrganizationRole = "admin" | "setter" | "contestant";

type Organization = {
  id: number;
  slug: string;
  name: string;
  isPublic: boolean;
  role: OrganizationRole | null;
};

type Member = {
  userId: string;
  username: string;
  role: OrganizationRole;
};

type Props = {
  initialOrganizations: Organization[];
  initialMembers: Member[];
  activeSlug: string | null;
};

const roleLabels: Record<OrganizationRole, string> = {
  admin: "Admin",
  setter: "Setter",
  contestant: "Contestant",
};

export default function OrganizationManager({ initialOrganizations, initialMembers, activeSlug }: Props) {
  const [organizations, setOrganizations] = useState(initialOrganizations);
  const [members, setMembers] = useState(initialMembers);
  const [name, setName] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [inviteUserId, setInviteUserId] = useState("");
  const [inviteRole, setInviteRole] = useState<OrganizationRole>("contestant");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const activeOrganization = organizations.find((organization) => organization.slug === activeSlug) ?? null;
  const isActiveAdmin = activeOrganization?.role === "admin";

  async function readResponse(response: Response): Promise<Record<string, unknown>> {
    const payload: unknown = await response.json().catch(() => null);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("Invalid server response");
    }
    if (!response.ok) {
      const error = "error" in payload && typeof payload.error === "string" ? payload.error : "Request failed";
      throw new Error(error);
    }
    return payload as Record<string, unknown>;
  }

  function parseOrganization(value: unknown): Organization {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid organization response");
    const organization = value as Record<string, unknown>;
    if (
      typeof organization.id !== "number" ||
      typeof organization.slug !== "string" ||
      typeof organization.name !== "string" ||
      typeof organization.isPublic !== "boolean" ||
      (organization.role !== undefined && organization.role !== null && !isOrganizationRole(organization.role))
    ) throw new Error("Invalid organization response");
    return organization as Organization;
  }

  function parseMember(value: unknown): Member {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid member response");
    const member = value as Record<string, unknown>;
    if (typeof member.userId !== "string" || typeof member.username !== "string" || !isOrganizationRole(member.role)) {
      throw new Error("Invalid member response");
    }
    return member as Member;
  }

  async function selectOrganization(slug: string) {
    setPending(slug);
    setError(null);
    setNotice(null);
    try {
      await readResponse(await fetch("/api/organizations/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      }));
      window.location.reload();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not switch organization");
      setPending(null);
    }
  }

  async function createOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending("create");
    setError(null);
    setNotice(null);
    try {
      const data = await readResponse(await fetch("/api/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, isPublic }),
      }));
      const created = { ...parseOrganization(data.organization), role: "admin" as const };
      setOrganizations((current) => [...current, created]);
      setName("");
      setIsPublic(false);
      setNotice(`${created.name} created. Switching workspace…`);
      await selectOrganization(created.slug);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not create organization");
      setPending(null);
    }
  }

  async function joinOrganization(slug: string) {
    setPending(`join:${slug}`);
    setError(null);
    setNotice(null);
    try {
      await readResponse(await fetch(`/api/organizations/${encodeURIComponent(slug)}/join`, { method: "POST" }));
      setOrganizations((current) => current.map((organization) =>
        organization.slug === slug ? { ...organization, role: "contestant" } : organization,
      ));
      await selectOrganization(slug);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not join organization");
      setPending(null);
    }
  }

  async function leaveOrganization(slug: string) {
    setPending(`leave:${slug}`);
    setError(null);
    setNotice(null);
    try {
      await readResponse(await fetch(`/api/organizations/${encodeURIComponent(slug)}/membership`, { method: "DELETE" }));
      setOrganizations((current) => current.map((organization) =>
        organization.slug === slug ? { ...organization, role: null } : organization,
      ));
      setMembers([]);
      setNotice(`Left ${slug}.`);
      if (slug === activeSlug) await selectOrganization("koj");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not leave organization");
      setPending(null);
    }
  }

  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeSlug) return;
    setPending("member:add");
    setError(null);
    setNotice(null);
    try {
      const data = await readResponse(await fetch(`/api/organizations/${encodeURIComponent(activeSlug)}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: inviteUserId.trim(), role: inviteRole }),
      }));
      const member = parseMember(data.member);
      setMembers((current) => [...current, member]);
      setInviteUserId("");
      setNotice("Member added.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not add member");
    } finally {
      setPending(null);
    }
  }

  async function updateMemberRole(userId: string, role: OrganizationRole) {
    if (!activeSlug) return;
    setPending(`role:${userId}`);
    setError(null);
    setNotice(null);
    try {
      await readResponse(await fetch(`/api/organizations/${encodeURIComponent(activeSlug)}/members/${encodeURIComponent(userId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      }));
      setMembers((current) => current.map((member) => member.userId === userId ? { ...member, role } : member));
      setNotice("Membership role updated.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not update membership role");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section aria-labelledby="available-orgs" className="space-y-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-kjtext-muted">Directory / {organizations.length} visible</p>
            <h2 id="available-orgs" className="mt-1 font-mono text-lg font-semibold text-white">Your workspaces</h2>
          </div>
          <span className="hidden rounded border border-kjborder px-2 py-1 font-mono text-[10px] uppercase text-kjtext-muted sm:inline">Tenant context is server-checked</span>
        </div>

        {organizations.length === 0 ? (
          <div className="rounded border border-kjborder bg-kjsurface/80 p-6 text-sm text-kjtext-muted">No public organizations are available yet.</div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {organizations.map((organization) => {
              const isActive = organization.slug === activeSlug;
              const isMember = organization.role !== null;
              return (
                <article key={organization.id} className={`relative flex min-h-44 flex-col justify-between overflow-hidden rounded border p-4 transition-colors ${
                  isActive ? "border-kjprimary/60 bg-kjsurface shadow-[0_0_26px_rgba(0,255,157,0.08)]" : "border-kjborder bg-kjsurface/75 hover:border-kjborder-bright"
                }`}>
                  <div className="pointer-events-none absolute -right-6 -top-8 h-28 w-28 rounded-full border border-kjprimary/10" />
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-kjtext-muted">/{organization.slug}</span>
                      <span className={`rounded border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${
                        isActive ? "border-kjprimary/50 text-kjprimary" : "border-kjborder-bright text-kjtext-muted"
                      }`}>{isActive ? "Active" : organization.isPublic ? "Public" : "Private"}</span>
                    </div>
                    <h3 className="mt-3 font-mono text-lg font-semibold text-white">{organization.name}</h3>
                    <p className="mt-1 text-xs text-kjtext-muted">{isMember ? roleLabels[organization.role as OrganizationRole] : "Open to join"}</p>
                  </div>
                  <div className="mt-5 flex flex-wrap items-center gap-2">
                    {isMember ? (
                      <button type="button" disabled={pending !== null || isActive} onClick={() => void selectOrganization(organization.slug)} className="rounded bg-kjprimary px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-wider text-black transition hover:bg-kjtertiary disabled:cursor-not-allowed disabled:opacity-50">
                        {isActive ? "Selected" : pending === organization.slug ? "Switching…" : "Switch workspace"}
                      </button>
                    ) : (
                      <button type="button" disabled={pending !== null} onClick={() => void joinOrganization(organization.slug)} className="rounded border border-kjprimary/50 px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-wider text-kjprimary transition hover:bg-kjprimary/10 disabled:cursor-not-allowed disabled:opacity-50">
                        {pending === `join:${organization.slug}` ? "Joining…" : "Join public"}
                      </button>
                    )}
                    {isMember && (
                      <button type="button" disabled={pending !== null} onClick={() => void leaveOrganization(organization.slug)} className="rounded px-2 py-2 font-mono text-[10px] uppercase tracking-wider text-kjtext-muted transition hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50">
                        Leave
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {isActiveAdmin && activeSlug && (
          <section aria-labelledby="members-heading" className="mt-8 rounded border border-kjborder bg-kjsurface/80">
            <div className="flex items-center justify-between border-b border-kjborder px-4 py-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-kjprimary">Access / {activeSlug}</p>
                <h2 id="members-heading" className="mt-1 font-mono text-sm font-semibold text-white">Membership</h2>
              </div>
              <span className="font-mono text-[10px] text-kjtext-muted">{members.length} members</span>
            </div>
            <div className="divide-y divide-kjborder">
              {members.map((member) => (
                <MemberRow key={member.userId} member={member} pending={pending === `role:${member.userId}`} onUpdate={updateMemberRole} />
              ))}
            </div>
            <form onSubmit={(event) => void addMember(event)} className="grid gap-3 border-t border-kjborder p-4 sm:grid-cols-[minmax(0,1fr)_9rem_auto] sm:items-end">
              <label className="block">
                <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-kjtext-muted">Existing Clerk user ID</span>
                <input value={inviteUserId} onChange={(event) => setInviteUserId(event.target.value)} required maxLength={255} autoComplete="off" className="w-full rounded border border-kjborder-bright bg-kjbg px-3 py-2 font-mono text-xs text-kjtext outline-none transition focus:border-kjprimary/70" placeholder="user_…" />
              </label>
              <label className="block">
                <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-kjtext-muted">Role</span>
                <select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as OrganizationRole)} className="w-full rounded border border-kjborder-bright bg-kjbg px-3 py-2 font-mono text-xs text-kjtext outline-none focus:border-kjprimary/70">
                  <option value="contestant">Contestant</option>
                  <option value="setter">Setter</option>
                  <option value="admin">Admin</option>
                </select>
              </label>
              <button type="submit" disabled={pending !== null || !inviteUserId.trim()} className="rounded border border-kjprimary/50 px-4 py-2 font-mono text-[10px] font-bold uppercase tracking-wider text-kjprimary transition hover:bg-kjprimary/10 disabled:cursor-not-allowed disabled:opacity-50">
                {pending === "member:add" ? "Adding…" : "Add member"}
              </button>
            </form>
            <p className="px-4 pb-4 text-[11px] leading-5 text-kjtext-muted">Member usernames and roles are visible to this organization’s admins. Email addresses are never shown.</p>
          </section>
        )}
      </section>

      <aside className="h-fit rounded border border-kjborder-bright bg-kjsurface/90 p-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-kjprimary">Provision / workspace</p>
        <h2 className="mt-2 font-mono text-lg font-semibold text-white">Create organization</h2>
        <p className="mt-2 text-xs leading-5 text-kjtext-muted">You become an admin. Add existing users by Clerk ID after creation.</p>
        <form onSubmit={(event) => void createOrganization(event)} className="mt-5 space-y-4">
          <label className="block">
            <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-kjtext-muted">Organization name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} required minLength={2} maxLength={100} className="w-full rounded border border-kjborder-bright bg-kjbg px-3 py-2.5 text-sm text-kjtext outline-none transition placeholder:text-kjtext-muted/60 focus:border-kjprimary/70" placeholder="IIIT Kottayam" />
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded border border-kjborder px-3 py-3">
            <input type="checkbox" checked={isPublic} onChange={(event) => setIsPublic(event.target.checked)} className="mt-0.5 accent-[#00ff9d]" />
            <span>
              <span className="block font-mono text-xs text-kjtext">Public directory</span>
              <span className="mt-1 block text-[11px] leading-4 text-kjtext-muted">Visible in the directory; signed-in users can join.</span>
            </span>
          </label>
          <button type="submit" disabled={pending !== null || name.trim().length < 2} className="w-full rounded bg-kjprimary px-4 py-2.5 font-mono text-xs font-bold uppercase tracking-wider text-black transition hover:bg-kjtertiary disabled:cursor-not-allowed disabled:opacity-50">
            {pending === "create" ? "Creating…" : "Create workspace"}
          </button>
        </form>
        {error && <p role="alert" className="mt-4 rounded border border-red-400/30 bg-red-950/20 px-3 py-2 text-xs text-red-200">{error}</p>}
        {notice && <p role="status" aria-live="polite" className="mt-4 rounded border border-kjprimary/25 bg-kjprimary/5 px-3 py-2 text-xs text-kjprimary">{notice}</p>}
        <div className="mt-5 border-t border-kjborder pt-4 font-mono text-[10px] leading-5 text-kjtext-muted">
          <p>Account limit: 10 organizations</p>
          <p>Public workspaces can be joined by any signed-in user.</p>
        </div>
      </aside>
    </div>
  );
}

function MemberRow({ member, pending, onUpdate }: {
  member: Member;
  pending: boolean;
  onUpdate: (userId: string, role: OrganizationRole) => Promise<void>;
}) {
  const [role, setRole] = useState<OrganizationRole>(member.role);
  const changed = role !== member.role;
  return (
    <div className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:items-center">
      <div className="min-w-0">
        <p className="truncate text-sm text-kjtext">{member.username}</p>
        <p className="mt-0.5 truncate font-mono text-[10px] text-kjtext-muted">{member.userId}</p>
      </div>
      <label>
        <span className="sr-only">Role for {member.username}</span>
        <select value={role} onChange={(event) => setRole(event.target.value as OrganizationRole)} className="w-full rounded border border-kjborder-bright bg-kjbg px-2.5 py-2 font-mono text-xs text-kjtext outline-none focus:border-kjprimary/70">
          <option value="contestant">Contestant</option>
          <option value="setter">Setter</option>
          <option value="admin">Admin</option>
        </select>
      </label>
      <button type="button" disabled={!changed || pending} onClick={() => void onUpdate(member.userId, role)} className="rounded border border-kjborder-bright px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-kjtext-muted transition hover:border-kjprimary/40 hover:text-kjprimary disabled:cursor-not-allowed disabled:opacity-40">
        {pending ? "Saving…" : "Save role"}
      </button>
    </div>
  );
}
