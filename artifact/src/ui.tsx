import * as React from "react";
import { createContext, useContext, useState, useSyncExternalStore } from "react";
import type { ReviewStatus } from "../../src/lib/srs";
import type { Store } from "./store";

export interface Nav {
  view: string;
  param: string | null;
}
export interface AppCtx {
  store: Store;
  nav: Nav;
  go: (view: string, param?: string | null) => void;
  downloads: { save: (r: { filename: string; data: string }) => Promise<unknown> } | null;
}
export const Ctx = createContext<AppCtx>(null as unknown as AppCtx);

/** Re-renders when the store changes. */
export function useApp() {
  const ctx = useContext(Ctx);
  useSyncExternalStore(ctx.store.subscribe, ctx.store.getVersion);
  return ctx;
}

export function Link({ to, param, children, className = "link" }: { to: string; param?: string | null; children: React.ReactNode; className?: string }) {
  const { go } = useContext(Ctx);
  const hash = param ? `${to}-${param}` : to;
  return (
    <a
      href={`#${hash}`}
      className={className}
      onClick={(e) => {
        e.preventDefault();
        go(to, param ?? null);
      }}
    >
      {children}
    </a>
  );
}

export function PageHeader({ title, sub, actions }: { title: string; sub?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="page-head">
      <div className="minw0">
        <h1>{title}</h1>
        {sub && <p className="sub">{sub}</p>}
      </div>
      {actions && <div className="row wrap">{actions}</div>}
    </header>
  );
}

export function Panel({ title, action, children, className = "" }: { title?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`panel ${className}`}>
      {(title || action) && (
        <div className="panel-head">
          {title && <h2>{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${tone ?? ""}`}>{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

export function Meter({ label, value, detail, onClick }: { label: string; value: number | null; detail?: string; onClick?: () => void }) {
  const p = value === null ? null : Math.round(value * 100);
  return (
    <div className="meter" title={detail}>
      <div className="meter-top">
        {onClick ? (
          <button className="linkbtn ellipsis" onClick={onClick}>
            {label}
          </button>
        ) : (
          <span className="ellipsis">{label}</span>
        )}
        <span className="num">{p === null ? "—" : `${p}%`}</span>
      </div>
      <div className="meter-track" aria-hidden>
        {p !== null && <div className="meter-fill" style={{ width: `${Math.max(p, 2)}%` }} />}
      </div>
      {detail && <div className="tiny muted">{detail}</div>}
    </div>
  );
}

const STATUS: Record<ReviewStatus, [string, string]> = {
  new: ["New", "pill"],
  learning: ["Learning", "pill pill-accent"],
  needs_revision: ["Needs revision", "pill pill-bad"],
  mastered: ["Mastered", "pill pill-good"],
};
export function StatusPill({ status }: { status: ReviewStatus }) {
  return <span className={STATUS[status][1]}>{STATUS[status][0]}</span>;
}

/** Inline two-step confirmation (the viewer cannot show browser confirm dialogs). */
export function ConfirmButton({ label, confirmLabel, onConfirm, danger, small, disabled }: { label: string; confirmLabel: string; onConfirm: () => void; danger?: boolean; small?: boolean; disabled?: boolean }) {
  const [asking, setAsking] = useState(false);
  const cls = `btn ${small ? "btn-sm" : ""} ${danger ? "btn-danger" : ""}`;
  if (!asking)
    return (
      <button className={cls} disabled={disabled} onClick={() => setAsking(true)}>
        {label}
      </button>
    );
  return (
    <span className="confirm" role="group">
      <span className="tiny">{confirmLabel}</span>
      <button
        className={`btn btn-sm ${danger ? "btn-danger-solid" : "btn-primary"}`}
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        Yes
      </button>
      <button className="btn btn-sm" onClick={() => setAsking(false)}>
        Cancel
      </button>
    </span>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={v} role="radio" aria-checked={value === v} className={value === v ? "on" : ""} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}
