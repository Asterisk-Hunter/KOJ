import Navigation from "@/app/components/Navigation";

type RouteLoadingProps = {
  label?: string;
  description?: string;
};

export default function RouteLoading({
  label = "Loading KOJ",
  description = "Preparing your workspace",
}: RouteLoadingProps) {
  return (
    <>
      <Navigation />
      <main
        aria-busy="true"
        aria-live="polite"
        aria-label={label}
        className="min-h-[calc(100vh-4.5rem)] bg-grid px-4 pb-16 pt-28 sm:px-6 lg:px-8"
      >
        <div className="mx-auto max-w-7xl">
          <div className="mb-8 max-w-2xl space-y-3">
            <div className="h-3 w-36 animate-pulse rounded bg-kjprimary/20" />
            <div className="h-10 w-72 animate-pulse rounded bg-kjsurface" />
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-kjtext-muted">
              {description}
            </p>
          </div>

          <section className="rounded-lg border border-kjborder bg-kjsurface/70 p-5 sm:p-6">
            <div className="mb-6 flex items-center gap-3 font-mono text-xs uppercase tracking-[0.2em] text-kjprimary">
              <span className="h-2 w-2 animate-pulse rounded-full bg-kjprimary shadow-[0_0_12px_rgba(0,255,157,0.8)]" />
              {label}
            </div>
            <div className="space-y-3" aria-hidden="true">
              <div className="h-12 animate-pulse rounded border border-kjborder bg-kjbg/70" />
              <div className="h-12 animate-pulse rounded border border-kjborder bg-kjbg/70" />
              <div className="h-12 w-5/6 animate-pulse rounded border border-kjborder bg-kjbg/70" />
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
