"use client";

import { SignIn } from "@clerk/nextjs";
import Link from "next/link";

export default function SignInPage() {
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
            <SignIn
              appearance={{
                elements: {
                  rootBox: "w-full",
                  card: "bg-transparent border-0 shadow-none",
                },
              }}
            />
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

      <style>{`
        .terminal-crt-glow {
          box-shadow:
            0 0 30px rgba(0, 255, 157, 0.1),
            inset 0 0 30px rgba(0, 255, 157, 0.05);
        }
      `}</style>
    </div>
  );
}
