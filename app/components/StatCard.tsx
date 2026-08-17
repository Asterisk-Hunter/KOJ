interface StatCardProps {
  label: string;
  value: string | number;
  icon?: string;
  accent?: boolean;
}

export default function StatCard({ label, value, icon, accent = false }: StatCardProps) {
  return (
    <div className="bg-kjsurface border border-kjborder rounded-lg p-4 transition-colors hover:border-kjborder-bright">
      <div className="flex items-center gap-2 mb-2">
        {icon && <span className="text-sm">{icon}</span>}
        <span className="uppercase text-xs font-mono tracking-widest text-kjtext-muted">
          {label}
        </span>
      </div>
      <div
        className={`text-2xl font-bold font-mono ${
          accent ? "text-kjprimary" : "text-kjtext"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
