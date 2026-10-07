export type SubmissionStatus = {
  status: string;
  passedTests: number | null;
  totalTests: number | null;
  executionTimeMs: number | null;
  memoryUsedMb: number | null;
  errorMessage: string | null;
};

type StreamOptions = {
  initial: SubmissionStatus;
  load: () => Promise<SubmissionStatus | null>;
  signal: AbortSignal;
  tickMs?: number;
  durationMs?: number;
};

export function createStatusStream({ initial, load, signal, tickMs = 1000, durationMs = 55000 }: StreamOptions) {
  const encoder = new TextEncoder();
  let closed = false;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let abort: () => void = () => {};
  const cleanup = () => {
    closed = true;
    clearTimeout(pollTimer);
    clearTimeout(deadline);
    signal.removeEventListener("abort", abort);
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        if (closed) return;
        cleanup();
        controller.close();
      };
      abort = close;
      if (signal.aborted) { close(); return; }
      signal.addEventListener("abort", abort, { once: true });
      controller.enqueue(encoder.encode("retry: 1000\n\n"));
      const send = (event: string, payload: unknown) => {
        if (!closed) controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`));
      };
      const sendStatus = (row: SubmissionStatus) => {
        const terminal = row.status !== "pending" && row.status !== "running";
        send(terminal ? "done" : "status", row);
        return terminal;
      };
      if (sendStatus(initial)) { close(); return; }
      // A wall-clock deadline also bounds slow/in-flight DB reads, not just ticks.
      deadline = setTimeout(close, durationMs);
      const poll = async () => {
        if (closed) return;
        try {
          const row = await load();
          if (closed) return;
          if (!row) {
            send("error", { message: "submission not found" });
            close();
          } else if (sendStatus(row)) {
            close();
          } else {
            pollTimer = setTimeout(() => { void poll(); }, tickMs);
          }
        } catch {
          if (!closed) send("error", { message: "status temporarily unavailable" });
          close();
        }
      };
      pollTimer = setTimeout(() => { void poll(); }, tickMs);
    },
    cancel: cleanup,
  });
}
