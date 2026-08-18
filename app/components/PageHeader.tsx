import Link from "next/link";
import Navigation from "@/app/components/Navigation";

export default function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: { label: string; href: string } }) {
  return (
    <>
      <Navigation />
      <header className="border-b border-kjborder bg-kjsurface/30 pt-24 pb-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row md:items-end md:justify-between gap-6">
          <div>
            <p className="uppercase font-mono tracking-[0.3em] text-xs text-kjprimary mb-3">{eyebrow}</p>
            <h1 className="text-3xl sm:text-4xl font-mono font-bold text-kjtext">{title}</h1>
            <p className="text-sm text-kjtext-muted mt-3 max-w-2xl">{description}</p>
          </div>
          {action && <Link href={action.href} className="bg-kjprimary text-kjbg font-mono text-xs font-bold tracking-widest px-5 py-3 rounded hover:glow-sm transition-all">{action.label}</Link>}
        </div>
      </header>
    </>
  );
}
