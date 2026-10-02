"use client";

import { useRouter } from "next/navigation";
import PageHeader from "@/app/components/PageHeader";
import ProblemStudio from "@/app/admin/ProblemStudio";

export default function ProblemCreateClient() {
  const router = useRouter();

  return (
    <>
      <PageHeader
        eyebrow="Studio / Problem Authoring"
        title="Create & Import Problem"
        description="Industry-standard problem creation suite: 1-click import from LeetCode, Codeforces, AtCoder, Polygon, or author problems with live split Markdown preview."
        action={{ label: "← BACK TO ARCHIVE", href: "/problems" }}
      />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <ProblemStudio
          onProblemCreated={(created) => {
            if (created?.id && typeof window !== "undefined") {
              window.scrollTo({ top: 0, behavior: "smooth" });
            }
          }}
          onCancel={() => router.push("/problems")}
        />
      </main>
    </>
  );
}
