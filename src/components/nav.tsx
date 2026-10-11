"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/practice", label: "Practice" },
  { href: "/train", label: "Memory training" },
  { href: "/questions", label: "Question bank" },
  { href: "/progress", label: "Progress" },
  { href: "/import", label: "Import" },
  { href: "/data", label: "Backup" },
];

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  if (pathname === "/login") return null;
  const active = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-2 sm:px-6">
        <Link href="/" className="flex items-center gap-2 py-2 font-semibold text-ink" onClick={() => setOpen(false)}>
          <span aria-hidden className="grid h-7 w-7 place-items-center rounded-md bg-accent text-xs font-bold text-accent-ink">UK</span>
          <span className="hidden sm:inline">Life in the UK revision</span>
        </Link>
        <nav aria-label="Main" className="ml-auto hidden lg:block">
          <ul className="flex items-center gap-1">
            {LINKS.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  aria-current={active(l.href) ? "page" : undefined}
                  className={`rounded-md px-3 py-2 text-sm ${active(l.href) ? "bg-accent-soft font-medium text-accent" : "text-ink-2 hover:bg-surface-2"}`}
                >
                  {l.label}
                </Link>
              </li>
            ))}
            <li>
              <button onClick={signOut} className="rounded-md px-3 py-2 text-sm text-muted hover:bg-surface-2">
                Sign out
              </button>
            </li>
          </ul>
        </nav>
        <button
          className="btn ml-auto lg:hidden"
          aria-expanded={open}
          aria-controls="mobile-nav"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "Close" : "Menu"}
        </button>
      </div>
      {open && (
        <nav id="mobile-nav" aria-label="Main" className="border-t border-line lg:hidden">
          <ul className="mx-auto grid max-w-6xl grid-cols-2 gap-1 p-3 sm:grid-cols-4">
            {LINKS.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  onClick={() => setOpen(false)}
                  aria-current={active(l.href) ? "page" : undefined}
                  className={`block rounded-md px-3 py-3 text-sm ${active(l.href) ? "bg-accent-soft font-medium text-accent" : "text-ink-2 hover:bg-surface-2"}`}
                >
                  {l.label}
                </Link>
              </li>
            ))}
            <li>
              <button onClick={signOut} className="w-full rounded-md px-3 py-3 text-left text-sm text-muted hover:bg-surface-2">
                Sign out
              </button>
            </li>
          </ul>
        </nav>
      )}
    </header>
  );
}
