import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Store } from "./store";
import { Ctx, useApp, type AppCtx, type Nav } from "./ui";
import { Dashboard } from "./views/dashboard";
import { PracticeHome, SessionView } from "./views/practice";
import { Bank, QuestionView } from "./views/bank";
import { TrainHome, TrainView } from "./views/train";
import { ProgressView } from "./views/progress";
import { ImportView } from "./views/import";
import { BackupView } from "./views/backup";

const TABS: [string, string][] = [
  ["dashboard", "Dashboard"],
  ["practice", "Practice"],
  ["train", "Memory training"],
  ["bank", "Question bank"],
  ["progress", "Progress"],
  ["import", "Import"],
  ["backup", "Backup"],
];
const SUB: Record<string, string> = { session: "practice", q: "bank", drill: "train", newq: "bank" };

function parseHash(): Nav {
  const h = (typeof location !== "undefined" ? location.hash : "").replace(/^#/, "");
  const i = h.indexOf("-");
  const view = i === -1 ? h : h.slice(0, i);
  const param = i === -1 ? null : h.slice(i + 1);
  if (!view || (!TABS.some(([t]) => t === view) && !SUB[view])) return { view: "dashboard", param: null };
  return { view, param };
}

type Boot = { state: "loading" } | { state: "ready"; store: Store; downloads: AppCtx["downloads"] } | { state: "unavailable"; message: string };

function Root() {
  const [boot, setBoot] = useState<Boot>({ state: "loading" });
  const [nav, setNav] = useState<Nav>(parseHash);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const claude = (window as unknown as { claude?: { use: (n: string) => Promise<unknown> } }).claude;
      if (!claude?.use) {
        setBoot({ state: "unavailable", message: "Open this page on claude.ai to use your saved question bank." });
        return;
      }
      const [db, downloads] = await Promise.all([claude.use("db"), claude.use("downloads").catch(() => null)]);
      if (cancelled) return;
      if (!db) {
        setBoot({ state: "unavailable", message: "Your study data could not be reached. Make sure you are signed in to claude.ai, then reload the page." });
        return;
      }
      const store = new Store(db);
      try {
        await store.load();
        if (!cancelled) setBoot({ state: "ready", store, downloads: downloads as AppCtx["downloads"] });
      } catch (err) {
        const code = (err as { code?: string })?.code ?? "error";
        if (!cancelled) setBoot({ state: "unavailable", message: `Your study data could not be loaded (${code}). Reload the page to try again.` });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onHash = () => setNav(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const go = useMemo(
    () => (view: string, param: string | null = null) => {
      const hash = param ? `${view}-${param}` : view;
      if (location.hash.replace(/^#/, "") !== hash) {
        try {
          history.pushState(null, "", `#${hash}`);
        } catch {
          /* some frames refuse history changes; navigation still works in-page */
        }
      }
      setNav({ view, param });
      window.scrollTo({ top: 0 });
    },
    [],
  );

  if (boot.state !== "ready") {
    return (
      <div className="shell">
        <TopBar active="" go={go} disabled />
        <main className="main">
          {boot.state === "loading" ? (
            <div className="loading" role="status">
              <div className="spinner" aria-hidden />
              Loading your question bank…
            </div>
          ) : (
            <div className="panel narrow">
              <h1 className="h2">Study data unavailable</h1>
              <p className="muted">{boot.message}</p>
            </div>
          )}
        </main>
      </div>
    );
  }
  return (
    <Ctx.Provider value={{ store: boot.store, nav, go, downloads: boot.downloads }}>
      <Shell />
    </Ctx.Provider>
  );
}

function TopBar({ active, go, disabled }: { active: string; go: (v: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="topbar">
      <div className="topbar-in">
        <button className="brand" onClick={() => go("dashboard")} disabled={disabled}>
          <span className="crest" aria-hidden>
            UK
          </span>
          <span>Life in the UK revision</span>
        </button>
        {!disabled && (
          <>
            <nav aria-label="Main" className="tabs">
              {TABS.map(([v, l]) => (
                <button key={v} className={active === v ? "tab on" : "tab"} aria-current={active === v ? "page" : undefined} onClick={() => go(v)}>
                  {l}
                </button>
              ))}
            </nav>
            <button className="btn menu-btn" aria-expanded={open} aria-controls="mnav" onClick={() => setOpen(!open)}>
              {open ? "Close" : "Menu"}
            </button>
          </>
        )}
      </div>
      {open && (
        <nav id="mnav" aria-label="Main" className="mnav">
          {TABS.map(([v, l]) => (
            <button
              key={v}
              className={active === v ? "tab on" : "tab"}
              onClick={() => {
                setOpen(false);
                go(v);
              }}
            >
              {l}
            </button>
          ))}
        </nav>
      )}
    </header>
  );
}

function Shell() {
  const { nav, go, store } = useApp();
  const active = SUB[nav.view] ?? nav.view;
  let body: React.ReactNode;
  switch (nav.view) {
    case "practice":
      body = <PracticeHome initial={nav.param} />;
      break;
    case "session":
      body = <SessionView id={nav.param ?? ""} />;
      break;
    case "train":
      body = <TrainHome />;
      break;
    case "drill":
      body = <TrainView kind={nav.param ?? ""} />;
      break;
    case "bank":
      body = <Bank initial={nav.param} />;
      break;
    case "q":
      body = <QuestionView id={nav.param ?? ""} />;
      break;
    case "newq":
      body = <QuestionView id="" />;
      break;
    case "progress":
      body = <ProgressView />;
      break;
    case "import":
      body = <ImportView />;
      break;
    case "backup":
      body = <BackupView />;
      break;
    default:
      body = <Dashboard />;
  }
  return (
    <div className="shell">
      <TopBar active={active} go={go} />
      {store.error && (
        <div className="toast" role="alert">
          <span>{store.error}</span>
          <button className="btn btn-sm" onClick={() => store.clearError()}>
            Dismiss
          </button>
        </div>
      )}
      <main className="main" key={`${nav.view}:${nav.param ?? ""}`}>
        {body}
      </main>
    </div>
  );
}

createRoot(document.getElementById("app")!).render(<Root />);
