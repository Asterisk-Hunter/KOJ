"use client";

import { useRouter } from "next/navigation";
import PageHeader from "@/app/components/PageHeader";
import ProblemStudio from "@/app/admin/ProblemStudio";
import { useAuth, SignInButton } from "@clerk/nextjs";

export default function ProblemCreatePage() {
  const router = useRouter();
  const { isSignedIn, isLoaded } = useAuth();

  return (
    <>
      <PageHeader
        eyebrow="Studio / Problem Authoring"
        title="Create & Import Problem"
        description="Industry-standard problem creation suite: 1-click import from LeetCode, Codeforces, AtCoder, Polygon, or author problems with live split Markdown preview."
        action={{ label: "← BACK TO ARCHIVE", href: "/problems" }}
      />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {isLoaded && !isSignedIn && (
          <div className="mb-6 p-4 rounded-xl border border-yellow-400/30 bg-yellow-400/10 text-yellow-300 text-xs font-mono flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <span className="font-bold">Notice:</span> You must be signed in with problem setter or admin privileges to publish problems to the catalogue.
            </div>
            <SignInButton mode="modal">
              <button className="bg-yellow-400 text-kjbg font-bold px-4 py-2 rounded text-xs hover:opacity-90 transition-opacity cursor-pointer">
                SIGN IN
              </button>
            </SignInButton>
          </div>
        )}

        <ProblemStudio
          onProblemCreated={() => router.push("/problems")}
          onCancel={() => router.push("/problems")}
        />
      </main>
    </>
  );
}
