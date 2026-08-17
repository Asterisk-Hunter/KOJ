"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useAuth, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";

const navLinks = [
  {
    href: "/dashboard",
    signedOutHref: "/",
    label: "Home",
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1h-2z" />
      </svg>
    ),
  },
  {
    href: "/problems",
    signedOutHref: "/problems",
    label: "Problems",
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
      </svg>
    ),
  },
  {
    href: "/contests",
    signedOutHref: "/contests",
    label: "Contests",
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
      </svg>
    ),
  },
  {
    href: "/rankings",
    signedOutHref: "/rankings",
    label: "Rankings",
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
  },
];

export default function Navigation() {
  const pathname = usePathname();
  const { isSignedIn } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-kjsurface/80 backdrop-blur-md border-b border-kjborder">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          {/* Logo */}
          <Link href="/" className="font-mono font-bold text-lg text-kjprimary text-glow">
            IIITK Judge
          </Link>

          {/* Desktop links */}
          <div className="hidden md:flex items-center gap-6">
            {navLinks.map((link) => {
              const href = isSignedIn ? link.href : link.signedOutHref;
              const isActive = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  className={`flex items-center gap-1.5 uppercase text-xs font-mono tracking-widest transition-colors ${
                    isActive
                      ? "text-kjprimary glow-sm border-b border-kjprimary pb-0.5"
                      : "text-kjtext-muted hover:text-kjprimary"
                  }`}
                >
                  {link.icon}
                  {link.label}
                </Link>
              );
            })}
          </div>

          {/* Desktop auth controls */}
          <div className="hidden md:flex items-center gap-4">
            {!isSignedIn ? (
              <>
                <SignInButton mode="modal">
                  <button className="text-kjtext-muted hover:text-kjprimary font-mono text-xs uppercase tracking-widest transition-colors cursor-pointer">
                    Sign In
                  </button>
                </SignInButton>
                <SignUpButton mode="modal">
                  <button className="bg-kjprimary text-[#050505] font-mono text-xs font-semibold uppercase tracking-wider px-4 py-1.5 rounded cursor-pointer">
                    Get Started
                  </button>
                </SignUpButton>
              </>
            ) : (
              <UserButton
                appearance={{
                  elements: {
                    avatarBox: "w-8 h-8",
                  },
                }}
              />
            )}
          </div>

          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="md:hidden flex flex-col justify-center items-center w-8 h-8 gap-1.5 text-kjtext-muted hover:text-kjprimary transition-colors"
            aria-label="Toggle menu"
          >
            <span className={`block w-5 h-0.5 bg-current transition-transform ${mobileOpen ? "translate-y-2 rotate-45" : ""}`} />
            <span className={`block w-5 h-0.5 bg-current transition-opacity ${mobileOpen ? "opacity-0" : ""}`} />
            <span className={`block w-5 h-0.5 bg-current transition-transform ${mobileOpen ? "-translate-y-2 -rotate-45" : ""}`} />
          </button>
        </div>
      </div>

      {/* Mobile slide-down */}
      {mobileOpen && (
        <div className="md:hidden bg-kjsurface border-b border-kjborder px-4 pb-4 pt-2">
          {navLinks.map((link) => {
            const href = isSignedIn ? link.href : link.signedOutHref;
            const isActive = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-2 py-2 uppercase text-xs font-mono tracking-widest transition-colors ${
                  isActive
                    ? "text-kjprimary glow-sm"
                    : "text-kjtext-muted hover:text-kjprimary"
                }`}
              >
                {link.icon}
                {link.label}
              </Link>
            );
          })}
          <div className="flex flex-col gap-3 pt-3 mt-2 border-t border-kjborder">
            {!isSignedIn ? (
              <>
                <SignInButton mode="modal">
                  <button
                    onClick={() => setMobileOpen(false)}
                    className="text-kjtext-muted hover:text-kjprimary font-mono text-xs uppercase tracking-widest transition-colors text-left cursor-pointer"
                  >
                    Sign In
                  </button>
                </SignInButton>
                <SignUpButton mode="modal">
                  <button
                    onClick={() => setMobileOpen(false)}
                    className="bg-kjprimary text-[#050505] font-mono text-xs font-semibold uppercase tracking-wider px-4 py-1.5 rounded w-fit cursor-pointer"
                  >
                    Get Started
                  </button>
                </SignUpButton>
              </>
            ) : (
              <UserButton
                appearance={{
                  elements: {
                    avatarBox: "w-8 h-8",
                  },
                }}
              />
            )}
          </div>
        </div>
      )}
    </nav>
  );
}
