import * as React from "react";
import { createContext, useContext, useState, useSyncExternalStore } from "react";
import type { Status } from "./logic";
import type { Question } from "./model";
import type { Store } from "./store";
import { generateTips, sampleErrorText, type Sample } from "./tips";

export interface Nav {
  view: string;
  param: string | null;
}
export interface AppCtx {
  store: Store;
  nav: Nav;
  go: (view: string, param?: string | null) => void;
  downloads: { save: (r: { filename: string; data: string }) => Promise<unknown> } | null;
  sample: Sample | null;
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

const STATUS: Record<Status, [string, string]> = {
  new: ["Not answered", "pill"],
  missed: ["To retry", "pill pill-bad"],
  learned: ["Got it", "pill pill-good"],
};
export function StatusPill({ status }: { status: Status }) {
  return <span className={STATUS[status][1]}>{STATUS[status][0]}</span>;
}

/**
 * Memory help for one question: the owner's own memory aid, then the tips. When a question has no tip yet,
 * Claude can write one on request; editors save it for everyone, other people see it for this visit only.
 */
export function TipBox({ q, compact }: { q: Question; compact?: boolean }) {
  const { store, sample } = useApp();
  const [extra, setExtra] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const tips = [...(q.tips ?? []), ...extra];
  async function make() {
    setBusy(true);
    setErr(null);
    try {
      const res = await generateTips(sample, [q]);
      const got = res[q.id] ?? [];
      if (!got.length) throw new Error("empty");
      if (store.isEditor) await store.putQuestion({ ...q, tips: [...(q.tips ?? []), ...got] });
      else setExtra([...extra, ...got]);
    } catch (e) {
      setErr(e instanceof Error && e.message === "empty" ? "No tip came back. Try again." : sampleErrorText(e));
    } finally {
      setBusy(false);
    }
  }
  if (!tips.length && !q.aid && !sample) return null;
  return (
    <div className={`tipbox ${compact ? "compact" : ""}`}>
      <div className="tip-head">
        <span aria-hidden className="tip-badge">Tip</span>
        <span className="strong small">How to remember it</span>
      </div>
      {q.aid && <p className="small"><strong>Your note:</strong> {q.aid}</p>}
      {tips.map((t, i) => (
        <p key={i} className="small">{t}</p>
      ))}
      {sample && (
        <div className="row wrap">
          <button className="linkbtn tiny" disabled={busy} onClick={make}>
            {busy ? "Writing a tip…" : tips.length ? "Another tip" : "Create a memory tip"}
          </button>
          {err && <span className="tiny err">{err}</span>}
        </div>
      )}
    </div>
  );
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
