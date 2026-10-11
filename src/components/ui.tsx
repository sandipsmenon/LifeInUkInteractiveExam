import Link from "next/link";
import type { ReactNode } from "react";
import { STATUS_LABEL } from "@/lib/types";
import type { ReviewStatus } from "@/lib/srs";

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="card p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="card p-4">
      <div className="text-xs font-medium text-ink-2">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

/** Horizontal meter: one series, so the label names it; the numeric value is always printed. */
export function Meter({ value, label, detail, href }: { value: number | null; label: string; detail?: string; href?: string }) {
  const pct = value === null ? null : Math.round(value * 100);
  const name = href ? (
    <Link href={href} className="link truncate">
      {label}
    </Link>
  ) : (
    <span className="truncate">{label}</span>
  );
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-sm" title={detail}>
      {name}
      <span className="tabular-nums text-ink-2">{pct === null ? "—" : `${pct}%`}</span>
      <div className="col-span-2 h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
        {pct !== null && <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(pct, 2)}%` }} />}
      </div>
      {detail && <div className="col-span-2 text-xs text-muted">{detail}</div>}
    </div>
  );
}

const STATUS_STYLE: Record<ReviewStatus, string> = {
  new: "bg-surface-2 text-ink-2",
  learning: "bg-accent-soft text-accent",
  needs_revision: "bg-bad-soft text-bad",
  mastered: "bg-good-soft text-good",
};

export function StatusBadge({ status }: { status: ReviewStatus }) {
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}>{STATUS_LABEL[status]}</span>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-2 p-8 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="text-sm text-ink-2">{children}</div>}
    </div>
  );
}

export function pct(v: number | null | undefined) {
  return v === null || v === undefined ? "—" : `${Math.round(v * 100)}%`;
}
