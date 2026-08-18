"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import Navigation from "@/app/components/Navigation";
import { problems } from "@/mock/data";

const starter = `# Write your solution here\n\ndef solve():\n    pass\n\nif __name__ == "__main__":\n    solve()`;

export default function ProblemDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const problem = problems.find((item) => item.id === Number(params.id)) ?? problems[0];
  const [language, setLanguage] = useState("Python");
  const [code, setCode] = useState(starter);
  const [notice, setNotice] = useState("");
  const submit = () => { setNotice("Submission #1042 queued. Opening live status..."); setTimeout(() => router.push("/submissions/1042"), 700); };

  return (
    <>
      <Navigation />
      <main className="pt-20 min-h-screen"><div className="max-w-[1500px] mx-auto px-4 sm:px-6 lg:px-8 py-6 grid lg:grid-cols-[minmax(0,1fr)_minmax(420px,0.9fr)] gap-6">
        <article className="bg-kjsurface/40 border border-kjborder rounded-lg p-6 lg:p-8">
          <Link href="/problems" className="text-xs font-mono text-kjtext-muted hover:text-kjprimary">← Back to archive</Link>
          <div className="flex flex-wrap gap-2 mt-6 mb-3"><span className="text-green-400 bg-green-400/10 border border-green-400/20 rounded-full px-2 py-1 text-xs font-mono">{problem.difficulty}</span><span className="text-kjtext-muted bg-kjbg border border-kjborder rounded-full px-2 py-1 text-xs font-mono">{problem.category}</span></div>
          <h1 className="text-3xl font-mono font-bold text-kjtext mb-8">{problem.title}</h1>
          {[["Problem Statement", problem.statement], ["Input Format", problem.input], ["Output Format", problem.output], ["Constraints", problem.constraints]].map(([heading, text]) => <section key={heading} className="mb-7"><h2 className="text-xs uppercase tracking-widest font-mono text-kjprimary border-b border-kjborder pb-2 mb-3">{heading}</h2><p className="text-sm text-kjtext-muted leading-7">{text}</p></section>)}
          <div className="grid sm:grid-cols-2 gap-3 mb-7"><pre className="bg-kjbg border border-kjborder rounded p-4 text-xs text-kjtext whitespace-pre-wrap"><span className="text-kjtext-muted">SAMPLE INPUT</span>{"\n\n"}{problem.sampleInput}</pre><pre className="bg-kjbg border border-kjborder rounded p-4 text-xs text-kjtext whitespace-pre-wrap"><span className="text-kjtext-muted">SAMPLE OUTPUT</span>{"\n\n"}{problem.sampleOutput}</pre></div>
          <div className="flex gap-5 text-xs font-mono text-kjtext-muted"><span>TIME {problem.timeLimit}</span><span>MEMORY {problem.memoryLimit}</span></div>
        </article>
        <section className="bg-kjsurface/40 border border-kjborder rounded-lg p-4 lg:p-5 h-fit lg:sticky lg:top-20">
          <div className="flex items-center justify-between border-b border-kjborder pb-3 mb-3"><p className="text-xs uppercase tracking-widest font-mono text-kjprimary">Submit solution</p><select value={language} onChange={(event) => setLanguage(event.target.value)} className="bg-kjbg border border-kjborder rounded px-3 py-2 text-xs font-mono text-kjtext"><option>C</option><option>C++</option><option>Python</option><option>Java</option></select></div>
          <textarea value={code} onChange={(event) => setCode(event.target.value)} spellCheck={false} className="w-full min-h-[360px] resize-y bg-kjbg border border-kjborder rounded p-4 text-sm leading-6 font-mono text-kjtext focus:border-kjprimary focus:outline-none" />
          <div className="flex gap-3 mt-4"><button onClick={() => setNotice("Sample tests passed locally. Ready to submit.")} className="border border-kjborder text-kjtext font-mono text-xs px-4 py-2 rounded hover:border-kjprimary hover:text-kjprimary">RUN SAMPLE</button><button onClick={submit} className="bg-kjprimary text-kjbg font-mono font-bold text-xs px-5 py-2 rounded hover:glow-sm">SUBMIT</button></div>
          {notice && <p className="mt-4 border border-kjprimary/20 bg-kjprimary/5 rounded p-3 text-xs font-mono text-kjprimary">{notice}</p>}
          <div className="mt-7"><div className="flex justify-between mb-3"><h2 className="text-xs uppercase tracking-widest font-mono text-kjtext-muted">Recent verdicts</h2><Link href="/submissions/1042" className="text-xs font-mono text-kjprimary">view all →</Link></div><div className="space-y-2 text-xs font-mono"><p className="flex justify-between border-b border-kjborder/70 pb-2"><span className="text-green-400">Accepted</span><span className="text-kjtext-muted">52 ms / 14 MB</span></p><p className="flex justify-between"><span className="text-red-400">Wrong Answer</span><span className="text-kjtext-muted">Python · 5 min ago</span></p></div></div>
        </section>
      </div></main>
    </>
  );
}
