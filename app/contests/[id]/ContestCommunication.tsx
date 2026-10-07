"use client";

import { useCallback, useEffect, useState } from "react";

type Communication = {
  canManage: boolean;
  announcements: Array<{ id: number; body: string; createdAt: string }>;
  clarifications: Array<{ id: number; question: string; answer: string | null; visibility: "private" | "public"; createdAt: string }>;
};

const fieldClass = "w-full rounded border border-kjborder bg-kjbg px-3 py-2 text-xs font-mono text-kjtext";

export default function ContestCommunication({ contestId, numericContestId, registered }: { contestId: string; numericContestId: number; registered: boolean }) {
  const [data, setData] = useState<Communication>({ announcements: [], clarifications: [], canManage: false });
  const [question, setQuestion] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/contests/${encodeURIComponent(contestId)}/clarifications`, { cache: "no-store" });
      if (response.ok) setData(await response.json() as Communication);
    } catch {
      // Keep the last view during a transient failure; the next poll retries.
    }
  }, [contestId]);

  useEffect(() => {
    const initial = window.setTimeout(() => { void load(); }, 0);
    const timer = window.setInterval(() => { void load(); }, 5000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, [load]);

  async function send(url: string, method: string, body: unknown) {
    const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json() as { error?: string };
    if (!response.ok) throw new Error(result.error ?? `Request failed (${response.status})`);
    await load();
  }

  async function run(action: () => Promise<void>) {
    setNotice(null);
    try { await action(); setNotice("Saved."); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Request failed"); }
  }

  return (
    <section className="mt-6 rounded-lg border border-kjborder bg-kjsurface p-5">
      <h2 className="font-mono text-sm text-kjprimary">ANNOUNCEMENTS & CLARIFICATIONS</h2>
      {notice && <p className="mt-3 text-xs font-mono text-kjtext-muted">{notice}</p>}
      <div className="mt-4 space-y-3">
        {data.announcements.map((item) => <article key={`a${item.id}`} className="border-l-2 border-kjprimary/60 pl-3">
          <p className="text-xs font-mono text-kjtext">{item.body}</p><time className="text-[10px] font-mono text-kjtext-muted">{new Date(item.createdAt).toLocaleString()}</time>
        </article>)}
        {data.clarifications.map((item) => <article key={`q${item.id}`} className="rounded border border-kjborder p-3">
          <p className="text-xs font-mono text-kjtext">Q: {item.question}</p>
          <p className="mt-2 text-xs font-mono text-kjtext-muted">{item.answer ? `A: ${item.answer}` : "Awaiting staff response"}</p>
          {item.answer && item.visibility === "private" && <span className="text-[10px] font-mono text-yellow-400">PRIVATE ANSWER</span>}
          {data.canManage && <form className="mt-3 flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); void run(() => send(`/api/admin/contests/${numericContestId}/clarifications/${item.id}`, "PATCH", { answer: answers[item.id] ?? item.answer ?? "", visibility: (event.currentTarget.elements.namedItem("visibility") as HTMLSelectElement).value })); }}>
            <input className={fieldClass} maxLength={2000} required value={answers[item.id] ?? item.answer ?? ""} onChange={(event) => setAnswers((prev) => ({ ...prev, [item.id]: event.target.value }))} placeholder="Answer" />
            <select name="visibility" defaultValue={item.visibility} className={`${fieldClass} w-auto`}><option value="private">Private to asker</option><option value="public">Broadcast publicly</option></select>
            <button className="rounded border border-kjborder px-3 py-2 text-xs font-mono text-kjtext">SAVE ANSWER</button>
          </form>}
        </article>)}
      </div>
      {registered && <form className="mt-4 flex gap-2" onSubmit={(event) => { event.preventDefault(); void run(async () => { await send(`/api/contests/${encodeURIComponent(contestId)}/clarifications`, "POST", { question }); setQuestion(""); }); }}>
        <input className={fieldClass} maxLength={2000} required value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask contest staff a question" />
        <button className="shrink-0 rounded bg-kjprimary px-3 py-2 text-xs font-mono font-bold text-kjbg">ASK</button>
      </form>}
      {data.canManage && <form className="mt-4 flex gap-2 border-t border-kjborder pt-4" onSubmit={(event) => { event.preventDefault(); void run(async () => { await send(`/api/admin/contests/${numericContestId}/announcements`, "POST", { body: announcement }); setAnnouncement(""); }); }}>
        <input className={fieldClass} maxLength={2000} required value={announcement} onChange={(event) => setAnnouncement(event.target.value)} placeholder="Publish an announcement to all contestants" />
        <button className="shrink-0 rounded border border-kjprimary px-3 py-2 text-xs font-mono text-kjprimary">ANNOUNCE</button>
      </form>}
    </section>
  );
}
