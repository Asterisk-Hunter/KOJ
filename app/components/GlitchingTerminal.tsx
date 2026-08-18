"use client";

import { useState, useEffect, useRef } from "react";

const BOOT_MESSAGES = [
  "> Initializing KOJ Kernel v4.2...",
  "> Loading test cases [OK]",
  "> Spawning isolated sandboxes [OK]",
  "> Compiling judge runtime... [OK]",
  "> Connecting to Neon Postgres... [OK]",
  "> All systems operational.",
  "> Waiting for submissions...",
];

const CHARS_PER_TICK = 2;
const TYPING_INTERVAL = 30;
const LINE_DELAY = 400;

export default function GlitchingTerminal() {
  const [displayedLines, setDisplayedLines] = useState<string[]>([]);
  const [currentLine, setCurrentLine] = useState("");
  const [lineIndex, setLineIndex] = useState(0);
  const [charIndex, setCharIndex] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (lineIndex >= BOOT_MESSAGES.length) {
      return;
    }

    const line = BOOT_MESSAGES[lineIndex];

    if (charIndex < line.length) {
      const timeout = setTimeout(() => {
        setCurrentLine(line.slice(0, charIndex + CHARS_PER_TICK));
        setCharIndex((prev) => prev + CHARS_PER_TICK);
      }, TYPING_INTERVAL);
      return () => clearTimeout(timeout);
    } else {
      const timeout = setTimeout(() => {
        setDisplayedLines((prev) => [...prev, line]);
        setCurrentLine("");
        setCharIndex(0);
        setLineIndex((prev) => prev + 1);
      }, LINE_DELAY);
      return () => clearTimeout(timeout);
    }
  }, [lineIndex, charIndex]);

  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [displayedLines, currentLine]);

  return (
    <div className="glitch-terminal relative">
      <style>{`
        .glitch-terminal {
          animation: terminalGlitch 5s infinite;
        }
        @keyframes terminalGlitch {
          0%, 94%, 100% { transform: translate(0); filter: none; }
          95% { transform: translate(-2px, 1px); filter: hue-rotate(20deg); }
          96% { transform: translate(2px, -1px); filter: hue-rotate(-20deg); }
          97% { transform: translate(-1px, -1px); filter: saturate(1.5); }
          98% { transform: translate(1px, 1px); filter: none; }
          99% { transform: translate(0, -1px); filter: brightness(1.2); }
        }
        .terminal-scanlines::after {
          content: "";
          position: absolute;
          inset: 0;
          background: repeating-linear-gradient(
            0deg,
            transparent,
            transparent 2px,
            rgba(0, 255, 157, 0.03) 2px,
            rgba(0, 255, 157, 0.03) 4px
          );
          pointer-events: none;
          z-index: 10;
          border-radius: inherit;
        }
        .terminal-crt-glow {
          box-shadow:
            0 0 30px rgba(0, 255, 157, 0.1),
            inset 0 0 30px rgba(0, 255, 157, 0.05);
        }
        .terminal-crt-glow::before {
          content: "";
          position: absolute;
          inset: 0;
          border-radius: inherit;
          background: radial-gradient(
            ellipse at center,
            transparent 50%,
            rgba(0, 0, 0, 0.4) 100%
          );
          pointer-events: none;
          z-index: 11;
        }
        @keyframes cursorBlink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
        .cursor-blink {
          animation: cursorBlink 1s step-end infinite;
        }
        @keyframes glowPulse {
          0%, 100% { text-shadow: 0 0 4px rgba(0, 255, 157, 0.4); }
          50% { text-shadow: 0 0 12px rgba(0, 255, 157, 0.7); }
        }
        .terminal-glow-pulse {
          animation: glowPulse 3s ease-in-out infinite;
        }
      `}</style>

      {/* Terminal Window */}
      <div className="relative bg-[#0a0a0a] border border-kjborder rounded-lg overflow-hidden terminal-crt-glow">
        {/* Title Bar */}
        <div className="bg-kjsurface border-b border-kjborder px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-[#ef4444]" />
            <span className="w-3 h-3 rounded-full bg-[#eab308]" />
            <span className="w-3 h-3 rounded-full bg-[#00ff9d]" />
          </div>
          <span className="font-mono text-xs text-kjtext-muted tracking-wider">
            terminal@koj-sys
          </span>
          <div className="w-[52px]" />
        </div>

        {/* Terminal Body */}
        <div
          ref={bodyRef}
          className="p-4 font-mono text-sm leading-relaxed h-[280px] overflow-y-auto terminal-scanlines relative terminal-glow-pulse"
        >
          {displayedLines.map((line, i) => (
            <div key={i} className="text-kjprimary whitespace-pre">
              {line.includes("[OK]") ? (
                <>
                  <span>{line.replace("[OK]", "")}</span>
                  <span className="text-[#00ff9d] font-bold">[OK]</span>
                </>
              ) : (
                line
              )}
            </div>
          ))}
          {currentLine && (
            <div className="text-kjprimary whitespace-pre">
              {currentLine.includes("[OK]") ? (
                <>
                  <span>{currentLine.replace("[OK]", "")}</span>
                  <span className="text-[#00ff9d] font-bold">[OK]</span>
                </>
              ) : (
                currentLine
              )}
            </div>
          )}
          <span className="inline-block w-2 h-4 bg-kjprimary cursor-blink translate-y-[2px]" />
        </div>
      </div>
    </div>
  );
}
