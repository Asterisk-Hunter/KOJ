"use client";

import { useState } from "react";
import Link from "next/link";

const verdicts = [
  { time: "2 min ago", language: "Python", status: "Accepted", runtime: "52ms", memory: "14.2 MB" },
  { time: "5 min ago", language: "Python", status: "Wrong Answer", runtime: "48ms", memory: "14.1 MB" },
  { time: "12 min ago", language: "C++", status: "Accepted", runtime: "12ms", memory: "8.3 MB" },
  { time: "18 min ago", language: "Java", status: "Time Limit", runtime: "2001ms", memory: "42.5 MB" },
  { time: "25 min ago", language: "Python", status: "Wrong Answer", runtime: "55ms", memory: "14.3 MB" },
];

const languages = ["C++", "Python", "Java", "JavaScript"];
const placeholderCode = `class Solution:
    def twoSum(self, nums, target):
        # Write your solution here
        pass`;

export default function ProblemDetailPage() {
  const [activeLang, setActiveLang] = useState("Python");

  return (
    <div className="flex min-h-screen pt-14">
      {/* Left Panel */}
      <div className="w-full lg:w-1/2 overflow-y-auto p-6 lg:p-8">
        <Link href="/problems" className="inline-flex items-center gap-1 text-xs font-mono text-kjtext-muted hover:text-kjprimary transition-colors mb-6">
          <span>←</span> Back to Problems
        </Link>

        <h1 className="text-2xl font-mono font-bold text-kjtext mb-3">Two Sum</h1>
        <div className="flex items-center gap-2 mb-6">
          <span className="text-green-400 bg-green-400/10 border border-green-400/20 rounded-full px-2 py-0.5 text-xs font-mono">
            Easy
          </span>
          <span className="text-kjtext-muted bg-kjsurface border border-kjborder rounded-full px-2 py-0.5 text-xs font-mono">
            Arrays
          </span>
        </div>

        {/* Problem Statement */}
        <section className="mb-6">
          <div className="flex items-center gap-3 mb-3 pb-2 border-b border-kjborder">
            <h2 className="uppercase font-mono text-xs tracking-widest text-kjtext-muted">Problem Statement</h2>
          </div>
          <div className="text-sm text-kjtext leading-relaxed space-y-3">
            <p>
              Given an array of integers <code className="font-mono text-kjprimary bg-kjprimary/10 px-1 rounded">nums</code> and
              an integer <code className="font-mono text-kjprimary bg-kjprimary/10 px-1 rounded">target</code>,
              return indices of the two numbers such that they add up to target.
            </p>
            <p>
              You may assume that each input would have exactly one solution, and you may not
              use the same element twice. You can return the answer in any order.
            </p>
            <p>
              The solution must run in linear time complexity, meaning you should aim for
              a single pass through the array using a hash map approach for optimal performance.
            </p>
          </div>
        </section>

        {/* Input Format */}
        <section className="mb-6">
          <div className="flex items-center gap-3 mb-3 pb-2 border-b border-kjborder">
            <h2 className="uppercase font-mono text-xs tracking-widest text-kjtext-muted">Input Format</h2>
          </div>
          <p className="text-sm text-kjtext-muted leading-relaxed">
            The first line contains an array of integers <code className="font-mono text-kjtext">nums</code>.
            The second line contains the integer <code className="font-mono text-kjtext">target</code>.
            Array length is between 2 and 10<sup>4</sup>. Each element is between -10<sup>9</sup> and 10<sup>9</sup>.
          </p>
        </section>

        {/* Output Format */}
        <section className="mb-6">
          <div className="flex items-center gap-3 mb-3 pb-2 border-b border-kjborder">
            <h2 className="uppercase font-mono text-xs tracking-widest text-kjtext-muted">Output Format</h2>
          </div>
          <p className="text-sm text-kjtext-muted leading-relaxed">
            Return an array of two integers representing the indices of the two numbers
            that add up to the target. The indices are 0-based.
          </p>
        </section>

        {/* Sample Input/Output */}
        <section className="mb-6">
          <div className="bg-kjsurface border border-kjborder rounded-lg p-4 mb-4">
            <div className="uppercase font-mono text-xs tracking-widest text-kjtext-muted mb-2">Sample Input 1</div>
            <pre className="font-mono text-sm text-kjtext">nums = [2, 7, 11, 15]
target = 9</pre>
          </div>
          <div className="bg-kjsurface border border-kjborder rounded-lg p-4">
            <div className="uppercase font-mono text-xs tracking-widest text-kjtext-muted mb-2">Sample Output 1</div>
            <pre className="font-mono text-sm text-kjtext">[0, 1]</pre>
          </div>
        </section>
      </div>

      {/* Right Panel */}
      <div className="hidden lg:block w-1/2 border-l border-kjborder overflow-y-auto p-6 lg:p-8">
        {/* Language Tabs */}
        <div className="flex gap-0 mb-4 border-b border-kjborder">
          {languages.map((lang) => (
            <button
              key={lang}
              onClick={() => setActiveLang(lang)}
              className={`px-4 py-2 text-xs font-mono transition-colors ${
                activeLang === lang
                  ? "text-kjprimary border-b-2 border-kjprimary"
                  : "text-kjtext-muted hover:text-kjtext"
              }`}
            >
              {lang}
            </button>
          ))}
        </div>

        {/* Code Editor */}
        <div className="bg-kjsurface min-h-[400px] rounded-lg border border-kjborder p-4 mb-4 relative">
          <pre className="font-mono text-sm text-kjtext whitespace-pre">{placeholderCode}</pre>
          <span className="absolute bottom-5 font-mono text-sm text-kjprimary animate-pulse">▌</span>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-3 mb-8">
          <button className="border border-kjborder text-kjtext font-mono px-4 py-2 rounded hover:border-kjprimary hover:text-kjprimary transition-all">
            RUN
          </button>
          <button className="bg-kjprimary text-kjbg font-mono font-semibold px-4 py-2 rounded hover:glow-sm transition-all">
            SUBMIT
          </button>
        </div>

        {/* Verdicts */}
        <section>
          <div className="flex items-center gap-3 mb-4">
            <h2 className="uppercase font-mono text-xs tracking-widest text-kjtext-muted">Verdicts</h2>
            <div className="h-px flex-1 bg-kjborder" />
          </div>

          <div className="border border-kjborder rounded-lg overflow-hidden">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-kjsurface border-b border-kjborder">
                  <th className="text-left px-4 py-2 uppercase font-mono text-xs tracking-widest text-kjtext-muted">Time</th>
                  <th className="text-left px-4 py-2 uppercase font-mono text-xs tracking-widest text-kjtext-muted">Language</th>
                  <th className="text-left px-4 py-2 uppercase font-mono text-xs tracking-widest text-kjtext-muted">Status</th>
                  <th className="text-left px-4 py-2 uppercase font-mono text-xs tracking-widest text-kjtext-muted">Runtime</th>
                  <th className="text-left px-4 py-2 uppercase font-mono text-xs tracking-widest text-kjtext-muted">Memory</th>
                </tr>
              </thead>
              <tbody>
                {verdicts.map((v, i) => (
                  <tr
                    key={i}
                    className={`border-b border-kjborder/50 ${i % 2 === 0 ? "bg-kjsurface/30" : ""}`}
                  >
                    <td className="px-4 py-2 text-kjtext-muted text-xs font-mono">{v.time}</td>
                    <td className="px-4 py-2 text-kjtext text-xs font-mono">{v.language}</td>
                    <td className="px-4 py-2 text-xs font-mono">
                      <span className={
                        v.status === "Accepted" ? "text-green-400" :
                        v.status === "Wrong Answer" ? "text-red-400" :
                        "text-yellow-400"
                      }>
                        {v.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-kjtext-muted text-xs font-mono">{v.runtime}</td>
                    <td className="px-4 py-2 text-kjtext-muted text-xs font-mono">{v.memory}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Submit Button (bottom) */}
        <div className="flex justify-end mt-6">
          <button className="bg-kjprimary text-kjbg font-mono font-semibold px-8 py-3 rounded hover:glow transition-all">
            SUBMIT SOLUTION
          </button>
        </div>
      </div>
    </div>
  );
}
