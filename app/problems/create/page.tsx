"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import PageHeader from "@/app/components/PageHeader";
import ProblemStudio from "@/app/admin/ProblemStudio";
import { useAuth, SignInButton } from "@clerk/nextjs";

type AuthMeResponse = {
  canAuthor?: boolean;
};

export default function ProblemCreatePage() {
  const router = useRouter();
  const { isSignedIn, isLoaded } = useAuth();
  const [authMe, setAuthMe] = useState<AuthMeResponse | null>(null);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) return;
    let cancelled = false;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: AuthMeResponse | null) => {
        if (!cancelled) setAuthMe(data);
      })
      .catch(() => {
        if (!cancelled) setAuthMe({ canAuthor: false });
      });
    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn]);

  const accessLoading = Boolean(isLoaded && isSignedIn && authMe === null);
  const canAuthor = Boolean(isSignedIn && authMe?.canAuthor);

  return (
    <>
      <PageHeader
        eyebrow="Studio / Problem Authoring"
        title="Create & Import Problem"
        description="Industry-standard problem creation suite: 1-click import from LeetCode, Codeforces, AtCoder, Polygon, or author problems with live split Markdown preview."
        action={{ label: "← BACK TO ARCHIVE", href: "/problems" }}
      />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {!isLoaded ? (
          <div className="mb-6 p-4 rounded-xl border border-kjborder bg-kjsurface text-kjtext-muted text-xs font-mono">
            Checking authoring access…
          </div>
        ) : !isSignedIn ? (
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
        ) : accessLoading ? (
          <div className="mb-6 p-4 rounded-xl border border-kjborder bg-kjsurface text-kjtext-muted text-xs font-mono">
            Verifying authoring permissions…
          </div>
        ) : !canAuthor ? (
          <div className="mb-6 p-4 rounded-xl border border-red-400/30 bg-red-400/10 text-red-300 text-xs font-mono">
            <p className="font-bold">403 · authoring access required</p>
            <p className="mt-2 text-red-200/80">Problem creation is limited to problem setters and administrators.</p>
          </div>
        ) : (
          <ProblemStudio
            onProblemCreated={(created) => {
              if (created?.id && typeof window !== "undefined") {
                window.scrollTo({ top: 0, behavior: "smooth" });
              }
            }}
            onCancel={() => router.push("/problems")}
          />
        )}
      </main>
    </>
  );
}
