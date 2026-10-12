import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Store } from "./store";
import { Ctx, useApp, type AppCtx, type Nav } from "./ui";
import { Home } from "./views/dashboard";
import { TestsView } from "./views/tests";
import { PracticeHome, RetryHome, SessionView } from "./views/practice";
import { Bank, QuestionView } from "./views/bank";
import { TrainView } from "./views/train";
import { ProgressView } from "./views/progress";
import { ImportView } from "./views/import";
import { BackupView } from "./views/backup";

type Tab = [string, string, boolean?]; // [view, label, editorsOnly]
const TABS: Tab[] = [
  ["home", "Home"],
  ["tests", "Tests"],
  ["retry", "Retry mistakes"],
  ["practice", "Practice"],
  ["bank", "Questions"],
  ["progress", "Progress"],
  ["import", "Import", true],
  ["backup", "Backup"],
];
const SUB: Record<string, string> = { session: "tests", q: "bank", drill: "practice", newq: "bank" };

function parseHash(): Nav {
  const h = (typeof location !== "undefined" ? location.hash : "").replace(/^#/, "");
  const i = h.indexOf("-");
  const view = i === -1 ? h : h.slice(0, i);
  const param = i === -1 ? null : h.slice(i + 1);
  if (!view || (!TABS.some(([t]) => t === view) && !SUB[view])) return { view: "home", param: null };
  return { view, param };
}

type Boot =
  | { state: "loading" }
  | { state: "ready"; store: Store; downloads: AppCtx["downloads"]; sample: AppCtx["sample"] }
  | { state: "unavailable"; message: string };

type Claude = { use: (n: string) => Promise<unknown> };

function Root() {
  const [boot, setBoot] = useState<Boot>({ state: "loading" });
  const [nav, setNav] = useState<Nav>(parseHash);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const claude = (window as unknown as { claude?: Claude }).claude;
      if (!claude?.use) {
        setBoot({ state: "unavailable", message: "Open this page on claude.ai to use the question bank." });
        return;
      }
      const [db, user, downloads, sample] = await Promise.all([
        claude.use("db"),
        claude.use("user").catch(() => null),
        claude.use("downloads").catch(() => null),
        claude.use("sample").catch(() => null),
      ]);
      if (cancelled) return;
      if (!db) {
        setBoot({ state: "unavailable", message: "The questions could not be reached. Make sure you are signed in to claude.ai, then reload the page." });
        return;
      }
      const u = user as { id: () => Promise<string | null>; canEdit: () => Promise<boolean> } | null;
      const [uid, editor] = await Promise.all([u?.id() ?? null, u?.canEdit() ?? false]);
      const store = new Store(db, uid, editor);
      try {
        await store.load();
        if (!cancelled) setBoot({ state: "ready", store, downloads: downloads as AppCtx["downloads"], sample });
      } catch (err) {
        const code = (err as { code?: string })?.code ?? "error";
        if (!cancelled) setBoot({ state: "unavailable", message: `The questions could not be loaded (${code}). Reload the page to try again.` });
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
        <TopBar active="" go={go} tabs={[]} />
        <main className="main">
          {boot.state === "loading" ? (
            <div className="loading" role="status">
              <div className="spinner" aria-hidden />
              Loading the question bank…
            </div>
          ) : (
            <div className="panel narrow">
              <h1 className="h2">Questions unavailable</h1>
              <p className="muted">{boot.message}</p>
            </div>
          )}
        </main>
      </div>
    );
  }
  return (
    <Ctx.Provider value={{ store: boot.store, nav, go, downloads: boot.downloads, sample: boot.sample }}>
      <Shell />
    </Ctx.Provider>
  );
}

function TopBar({ active, go, tabs, badge }: { active: string; go: (v: string) => void; tabs: Tab[]; badge?: Record<string, number> }) {
  const [open, setOpen] = useState(false);
  const label = (v: string, l: string) => (
    <>
      {l}
      {badge?.[v] ? <span className="tab-badge">{badge[v]}</span> : null}
    </>
  );
  return (
    <header className="topbar">
      <div className="topbar-in">
        <button className="brand" onClick={() => go("home")}>
          <span className="crest" aria-hidden>
            UK
          </span>
          <span>Life in the UK · 40 tests</span>
        </button>
        {tabs.length > 0 && (
          <>
            <nav aria-label="Main" className="tabs">
              {tabs.map(([v, l]) => (
                <button key={v} className={active === v ? "tab on" : "tab"} aria-current={active === v ? "page" : undefined} onClick={() => go(v)}>
                  {label(v, l)}
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
          {tabs.map(([v, l]) => (
            <button
              key={v}
              className={active === v ? "tab on" : "tab"}
              onClick={() => {
                setOpen(false);
                go(v);
              }}
            >
              {label(v, l)}
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
  const tabs = TABS.filter(([, , editorsOnly]) => !editorsOnly || store.isEditor);
  let missed = 0;
  for (const q of store.questions.values()) {
    const a = store.attemptsOf(q.id);
    if (a.length && !a[a.length - 1].ok) missed++;
  }
  let body: React.ReactNode;
  switch (nav.view) {
    case "tests":
      body = <TestsView />;
      break;
    case "session":
      body = <SessionView id={nav.param ?? ""} />;
      break;
    case "retry":
      body = <RetryHome />;
      break;
    case "practice":
      body = <PracticeHome initial={nav.param} />;
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
      body = store.isEditor ? <ImportView /> : <Home />;
      break;
    case "backup":
      body = <BackupView />;
      break;
    default:
      body = <Home />;
  }
  return (
    <div className="shell">
      <TopBar active={active} go={go} tabs={tabs} badge={{ retry: missed }} />
      {!store.canSave && (
        <div className="toast info" role="status">
          <span>You can practise here, but your answers are kept for this visit only. Ask the owner for Contributor access to save your progress.</span>
        </div>
      )}
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
