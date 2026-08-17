"use client";

import Link from "next/link";
import { SignInButton, SignUpButton, UserButton, useAuth } from "@clerk/nextjs";
import GlitchingTerminal from "@/app/components/GlitchingTerminal";

const stats = [
  { label: "PROBLEMS INDEXED", value: "2,408" },
  { label: "ACTIVE CONTESTS", value: "12" },
  { label: "DAILY SUBMISSIONS", value: "15,932" },
];

const features = [
  {
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
      </svg>
    ),
    title: "Real-Time Judging",
    description: "Sub-100ms evaluation with isolated sandboxes",
  },
  {
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M18.75 4.236c.982.143 1.954.317 2.916.52A6.003 6.003 0 0016.27 9.728M18.75 4.236V4.5c0 2.108-.966 3.99-2.48 5.228m0 0a6.003 6.003 0 01-5.54 0" />
      </svg>
    ),
    title: "Contest Engine",
    description: "Schedule, host, and manage programming contests",
  },
  {
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
      </svg>
    ),
    title: "Live Rankings",
    description: "Global and contest-specific leaderboards",
  },
];

const footerLinks = [
  { label: "GitHub", href: "#" },
  { label: "Documentation", href: "#" },
  { label: "Status", href: "#" },
  { label: "Privacy", href: "#" },
];

export default function LandingPage() {
  const { isLoaded, isSignedIn } = useAuth();

  return (
    <div className="min-h-screen flex flex-col">
      {/* Hero Section */}
      <section className="flex-1 flex items-center justify-center px-4 sm:px-6 lg:px-8 py-20">
        <div className="max-w-7xl mx-auto w-full flex flex-col lg:flex-row items-center gap-12 lg:gap-20">
          {/* Left - Text */}
          <div className="flex-1 text-center lg:text-left">
            <h1 className="text-7xl sm:text-8xl font-mono font-bold text-kjprimary text-glow mb-4 leading-none">
              KOJ
            </h1>
            <p className="uppercase font-mono tracking-[0.3em] text-kjtext-muted text-sm mb-6">
              Kottayam Online Judge
            </p>
            <p className="text-lg text-kjtext-muted max-w-md mx-auto lg:mx-0 mb-10">
              Host programming contests. Judge submissions in real-time. Built
              for competitive excellence.
            </p>
            <div className="flex items-center gap-4 justify-center lg:justify-start">
              {!isLoaded ? null : !isSignedIn ? (
                <>
                  <SignUpButton mode="modal">
                    <button className="bg-kjprimary text-[#050505] font-mono font-semibold text-sm uppercase tracking-widest px-8 py-3 rounded hover:glow transition-all cursor-pointer">
                      Get Started
                    </button>
                  </SignUpButton>
                  <SignInButton mode="modal">
                    <button className="border border-kjborder text-kjtext font-mono text-sm uppercase tracking-widest px-8 py-3 rounded hover:border-kjprimary hover:text-kjprimary transition-all cursor-pointer">
                      Sign In
                    </button>
                  </SignInButton>
                </>
              ) : (
                <>
                  <Link
                    href="/dashboard"
                    className="bg-kjprimary text-[#050505] font-mono font-semibold text-sm uppercase tracking-widest px-8 py-3 rounded hover:glow transition-all"
                  >
                    Enter App
                  </Link>
                  <UserButton />
                </>
              )}
            </div>
          </div>

          {/* Right - Terminal */}
          <div className="flex-1 w-full max-w-xl">
            <GlitchingTerminal />
          </div>
        </div>
      </section>

      {/* Stats Strip */}
      <section className="border-t border-kjborder border-b border-b-kjborder bg-kjsurface/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {stats.map((stat) => (
              <div
                key={stat.label}
                className="bg-kjsurface border border-kjborder rounded-lg p-4 border-l-4 border-l-kjprimary"
              >
                <span className="block uppercase font-mono text-xs tracking-widest text-kjtext-muted mb-1">
                  {stat.label}
                </span>
                <span className="block text-2xl font-mono font-bold text-kjtext">
                  {stat.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="uppercase font-mono tracking-[0.2em] text-sm text-kjtext-muted text-center mb-12">
            Built for Competitive Excellence
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="bg-kjsurface border border-kjborder rounded-lg p-6 hover:border-kjborder-bright transition-all"
              >
                <div className="text-kjprimary mb-4">{feature.icon}</div>
                <h3 className="font-mono font-semibold text-kjtext mb-2">
                  {feature.title}
                </h3>
                <p className="text-sm text-kjtext-muted">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-kjborder py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="font-mono text-xs text-kjtext-muted">
              &copy; 2024 IIIT Kottayam. Built for Competitive Excellence.
            </p>
            <div className="flex items-center gap-6">
              {footerLinks.map((link) => (
                <Link
                  key={link.label}
                  href={link.href}
                  className="font-mono text-xs text-kjtext-muted hover:text-kjprimary transition-colors"
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
