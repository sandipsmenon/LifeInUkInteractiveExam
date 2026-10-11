"use client";

import { useState } from "react";
import { api } from "@/lib/client";

export function FlagButton({ questionId, onFlagged }: { questionId: string; onFlagged?: () => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("possible_error");
  const [note, setNote] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "done" | string>("idle");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("saving");
    try {
      await api(`/api/questions/${questionId}/flags`, { reason, note });
      setState("done");
      setOpen(false);
      onFlagged?.();
    } catch (err) {
      setState((err as Error).message);
    }
  }

  if (state === "done") return <span className="text-xs text-ink-2">Flagged — thanks.</span>;
  return (
    <div className="relative">
      <button type="button" className="btn btn-sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Flag
      </button>
      {open && (
        <form onSubmit={submit} className="card absolute right-0 z-20 mt-2 w-72 space-y-2 p-3 shadow-lg">
          <label className="label" htmlFor={`fr-${questionId}`}>What is wrong?</label>
          <select id={`fr-${questionId}`} className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="possible_error">Possible error in the source</option>
            <option value="confusing">Confusing / easy to mix up</option>
            <option value="duplicate">Duplicate of another question</option>
            <option value="other">Other</option>
          </select>
          <textarea className="input min-h-16" placeholder="Optional note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
          {state !== "idle" && state !== "saving" && <p className="text-xs text-bad">{state}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn btn-sm" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn-sm btn-primary" disabled={state === "saving"}>Save flag</button>
          </div>
        </form>
      )}
    </div>
  );
}
