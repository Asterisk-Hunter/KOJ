"use client";

import { SignIn, UserButton, useAuth } from "@clerk/nextjs";
import Link from "next/link";

export default function SignInPage() {
  const { isLoaded, isSignedIn } = useAuth();

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Terminal Window */}
        <div className="bg-[#0a0a0a] border border-kjborder rounded-lg overflow-hidden terminal-crt-glow">
          {/* Title Bar */}
          <div className="bg-kjsurface border-b border-kjborder px-4 py-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-[#ef4444]" />
              <span className="w-3 h-3 rounded-full bg-[#eab308]" />
              <span className="w-3 h-3 rounded-full bg-[#00ff9d]" />
            </div>
            <span className="font-mono text-xs text-kjtext-muted tracking-wider">
              authentication@koj-sys
            </span>
            <div className="w-[52px]" />
          </div>

          {/* Terminal Body */}
          <div className="p-6">
            {!isLoaded ? (
              <p className="font-mono text-sm text-kjtext-muted">Checking secure session...</p>
            ) : isSignedIn ? (
              <div className="space-y-4">
                <div>
                  <h1 className="font-mono text-lg font-semibold text-kjtext">Session synchronization required</h1>
                  <p className="mt-2 text-sm text-kjtext-muted">
                    Your browser has a Clerk session, but it is not providing the localhost token KOJ needs
                    for server-side access. Use a standard browser window for local development, or test on
                    the deployed site.
                  </p>
                </div>
                <UserButton
                  appearance={{
                    elements: {
                      avatarBox: "w-8 h-8",
                    },
                  }}
                />
              </div>
            ) : (
              <SignIn
                fallbackRedirectUrl="/dashboard"
                appearance={{
                  elements: {
                    rootBox: "w-full",
                    card: "bg-transparent border-0 shadow-none",
                  },
                }}
              />
            )}
          </div>
        </div>

        {/* Back to Home */}
        <div className="mt-6 text-center">
          <Link
            href="/"
            className="font-mono text-xs text-kjtext-muted hover:text-kjprimary transition-colors"
          >
            &larr; Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
}
