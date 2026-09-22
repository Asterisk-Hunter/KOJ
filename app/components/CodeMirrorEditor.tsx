"use client";

import { useEffect, useRef } from "react";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightSpecialChars,
  drawSelection,
  highlightActiveLine,
} from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import { cpp } from "@codemirror/lang-cpp";
import { python } from "@codemirror/lang-python";
import { java } from "@codemirror/lang-java";
import { go } from "@codemirror/lang-go";
import { rust } from "@codemirror/lang-rust";
import { javascript } from "@codemirror/lang-javascript";

export type EditorLanguage =
  | "python"
  | "c++"
  | "c"
  | "java"
  | "go"
  | "rust"
  | "javascript";

interface CodeMirrorEditorProps {
  value: string;
  onChange: (value: string) => void;
  language: EditorLanguage;
  onSubmit: () => void;
  onRun: () => void;
  minClassName?: string;
}

function getLanguageExtension(lang: EditorLanguage) {
  switch (lang) {
    case "python":
      return python();
    case "java":
      return java();
    case "go":
      return go();
    case "rust":
      return rust();
    case "javascript":
      return javascript();
    case "c++":
    case "c":
    default:
      return cpp();
  }
}

/* ── KOJ neon-terminal theme ─────────────────────────────────── */
const kojTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: "transparent",
      color: "#e5e1e4",
      fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
      fontSize: "0.875rem",
      lineHeight: "1.5rem",
      height: "100%",
    },
    ".cm-scroller": {
      overflow: "auto",
    },
    ".cm-content": {
      padding: "1rem 0",
      caretColor: "#00ff9d",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "#00ff9d",
      borderLeftWidth: "2px",
    },
    "&.cm-focused .cm-cursor": {
      borderLeftColor: "#00ff9d",
    },
    ".cm-activeLine": {
      backgroundColor: "rgba(0, 255, 157, 0.03)",
    },
    ".cm-selectionMatch": {
      backgroundColor: "rgba(0, 255, 157, 0.12)",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
      {
        backgroundColor: "rgba(0, 255, 157, 0.2) !important",
      },
    ".cm-gutters": {
      backgroundColor: "rgba(12, 21, 15, 0.5)",
      color: "rgba(136, 136, 136, 0.4)",
      borderRight: "1px solid rgba(31, 31, 31, 0.6)",
      fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
      fontSize: "0.75rem",
    },
    ".cm-gutter .cm-gutterElement": {
      padding: "0 0.5rem",
      minWidth: "2rem",
      textAlign: "right",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "rgba(0, 255, 157, 0.05)",
      color: "rgba(0, 255, 157, 0.6)",
    },
    ".cm-matchingBracket": {
      backgroundColor: "rgba(0, 255, 157, 0.2)",
      outline: "1px solid rgba(0, 255, 157, 0.4)",
    },
    ".cm-foldPlaceholder": {
      backgroundColor: "rgba(0, 255, 157, 0.1)",
      border: "1px solid rgba(0, 255, 157, 0.3)",
      color: "#00ff9d",
    },
  },
  { dark: true },
);

/* ── Component ──────────────────────────────────────────────── */
export default function CodeMirrorEditor({
  value,
  onChange,
  language,
  onSubmit,
  onRun,
  minClassName = "min-h-[340px] lg:min-h-[55vh]",
}: CodeMirrorEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const langCompartmentRef = useRef(new Compartment());
  const prevLangRef = useRef(language);

  // Stable callback refs so the editor keymap never goes stale
  const onChangeRef = useRef(onChange);
  const onSubmitRef = useRef(onSubmit);
  const onRunRef = useRef(onRun);

  // Keep refs current via effect to satisfy React 19 lint rules
  useEffect(() => { onChangeRef.current = onChange; });
  useEffect(() => { onSubmitRef.current = onSubmit; });
  useEffect(() => { onRunRef.current = onRun; });

  /* ── Mount ─────────────────────────────────────────────────── */
  useEffect(() => {
    if (!containerRef.current || viewRef.current) return;

    const customKeymap = keymap.of([
      {
        key: "Mod-Enter",
        run: () => {
          onSubmitRef.current();
          return true;
        },
      },
      {
        key: "Mod-'",
        run: () => {
          onRunRef.current();
          return true;
        },
      },
      ...defaultKeymap,
      ...historyKeymap,
      indentWithTab,
    ]);

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        highlightActiveLine(),
        bracketMatching(),
        indentOnInput(),
        langCompartmentRef.current.of(getLanguageExtension(language)),
        kojTheme,
        customKeymap,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Sync language ─────────────────────────────────────────── */
  useEffect(() => {
    if (!viewRef.current) return;
    if (prevLangRef.current === language) return;
    prevLangRef.current = language;
    viewRef.current.dispatch({
      effects: langCompartmentRef.current.reconfigure(
        getLanguageExtension(language),
      ),
    });
  }, [language]);

  /* ── Sync external value (language switch changes the doc) ── */
  useEffect(() => {
    if (!viewRef.current) return;
    const view = viewRef.current;
    const currentDoc = view.state.doc.toString();
    if (currentDoc !== value) {
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: value },
      });
    }
  }, [value]);

  return (
    <div
      ref={containerRef}
      className={`${minClassName} [&_.cm-editor]:h-full [&_.cm-editor]:outline-none [&_.cm-scroller]:overflow-auto`}
    />
  );
}
