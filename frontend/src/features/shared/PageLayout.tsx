import { Link } from "react-router-dom";

interface PageLayoutProps {
  title: string;
  subtitle?: string;
  backTo?: string;
  children: React.ReactNode;
}

export default function PageLayout({ title, subtitle, backTo, children }: PageLayoutProps) {
  return (
    <div className="max-w-5xl mx-auto px-6 py-10 space-y-6">
      {backTo && (
        <Link
          to={backTo}
          className="inline-flex items-center gap-1 text-sm text-accent hover:underline"
        >
          ← Back
        </Link>
      )}
      <div>
        <h1 className="text-2xl font-bold text-ink">{title}</h1>
        {subtitle && <p className="text-ink-muted mt-1 text-sm">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}
