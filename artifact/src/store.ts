import { normalizeText } from "../../src/lib/text";
import type { Attempt, Batch, Progress, Question, Session } from "./model";
import { textHash } from "./model";

/* eslint-disable @typescript-eslint/no-explicit-any */
type DB = any;

export function contentHash(prompt: string, options: { text: string }[]) {
  return textHash(`${normalizeText(prompt)}\u0000${options.map((o) => normalizeText(o.text)).sort().join("\u0001")}`);
}

/**
 * In-memory mirror of the artifact database.
 *  - Shared by everyone: `questions/*` and `batches/*` (only editors can change them).
 *  - Private to each person: `data/users/<id>/profile/progress/*` and `.../sessions/*`.
 * Everything is loaded once on open, then changes are applied locally and written through.
 */
export class Store {
  questions = new Map<string, Question>();
  progress = new Map<string, Progress>();
  sessions = new Map<string, Session>();
  batches = new Map<string, Batch>();
  version = 0;
  error: string | null = null;
  /** False when this viewer has no private space (signed out, or view-only access): answers are kept for this visit only. */
  canSave: boolean;
  private listeners = new Set<() => void>();

  constructor(
    private db: DB,
    private uid: string | null,
    public isEditor: boolean,
  ) {
    this.canSave = !!uid;
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = () => this.version;
  private emit() {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  private mine(sub: "progress" | "sessions") {
    return `data/users/${this.uid}/profile/${sub}`;
  }

  private async readAll(collection: string, orderField: string): Promise<any[]> {
    const out: any[] = [];
    let last: unknown = null;
    for (let guard = 0; guard < 50; guard++) {
      let q = this.db.collection(collection).orderBy(orderField).limit(1000);
      if (last !== null) q = q.where(orderField, ">", last);
      const snap = await q.get();
      for (const d of snap.docs) out.push({ ...d.data(), id: d.id });
      if (snap.size < 1000) break;
      last = snap.docs[snap.docs.length - 1].data()[orderField];
    }
    return out;
  }

  async load() {
    const [qs, bs, ps, ss] = await Promise.all([
      this.readAll("questions", "seq"),
      this.readAll("batches", "createdAt"),
      this.uid ? this.readAll(this.mine("progress"), "qid") : Promise.resolve([]),
      this.uid ? this.readAll(this.mine("sessions"), "startedAt") : Promise.resolve([]),
    ]);
    for (const q of qs) this.questions.set(q.id, { tips: [], ...q });
    for (const b of bs) this.batches.set(b.id, b);
    for (const p of ps) this.progress.set(p.id, { attempts: p.attempts ?? [] });
    for (const s of ss) this.sessions.set(s.id, s);
    this.emit();
  }

  private async write(fn: () => Promise<void>) {
    try {
      await fn();
    } catch (err: any) {
      if (err?.code === "unavailable") {
        await new Promise((r) => setTimeout(r, 400 + Math.random() * 600));
        try {
          await fn();
          return;
        } catch (e2: any) {
          err = e2;
        }
      }
      this.error =
        err?.code === "quota_exceeded"
          ? "The database is full. Delete old import batches on the Backup page."
          : err?.code === "invalid_argument"
            ? "You don't have permission to save this change."
            : `Could not save (${err?.code ?? "error"}). Check your connection and try again.`;
      this.emit();
      throw err;
    }
  }
  /** Saves to this person's private space, or keeps it in memory when they have none. */
  private async writeMine(fn: () => Promise<void>) {
    if (!this.canSave) return;
    try {
      await this.write(fn);
    } catch (err: any) {
      if (err?.code === "invalid_argument") {
        // View-only access: keep going for this visit without saving.
        this.canSave = false;
        this.error = null;
        this.emit();
        return;
      }
      throw err;
    }
  }
  clearError() {
    this.error = null;
    this.emit();
  }

  // ---------- questions (shared)
  allQuestions(): Question[] {
    return [...this.questions.values()].sort((a, b) => a.seq - b.seq);
  }
  maxPos() {
    let max = 0;
    for (const q of this.questions.values()) max = Math.max(max, q.pos ?? 0, q.seq);
    return max;
  }
  async putQuestion(q: Question) {
    this.questions.set(q.id, q);
    this.emit();
    await this.write(() => this.db.doc(`questions/${q.id}`).set(strip(q)));
  }
  async putQuestions(qs: Question[], onProgress?: (done: number) => void) {
    for (const q of qs) this.questions.set(q.id, q);
    this.emit();
    let done = 0;
    for (const q of qs) {
      await this.write(() => this.db.doc(`questions/${q.id}`).set(strip(q)));
      onProgress?.(++done);
    }
  }
  async deleteQuestion(id: string) {
    this.questions.delete(id);
    this.progress.delete(id);
    this.emit();
    await this.write(() => this.db.doc(`questions/${id}`).delete());
    await this.writeMine(() => this.db.doc(`${this.mine("progress")}/${id}`).delete());
  }

  // ---------- my answers (private)
  attemptsOf(id: string): Attempt[] {
    return this.progress.get(id)?.attempts ?? [];
  }
  async setAttempts(qid: string, attempts: Attempt[]) {
    this.progress.set(qid, { attempts });
    this.emit();
    await this.writeMine(() => this.db.doc(`${this.mine("progress")}/${qid}`).set({ qid, attempts }));
  }
  async addAttempt(qid: string, a: Attempt) {
    await this.setAttempts(qid, [...this.attemptsOf(qid), a]);
  }
  async resetMyProgress() {
    const ids = [...this.progress.keys()];
    const sids = [...this.sessions.keys()];
    this.progress.clear();
    this.sessions.clear();
    this.emit();
    for (const id of ids) await this.writeMine(() => this.db.doc(`${this.mine("progress")}/${id}`).delete());
    for (const id of sids) await this.writeMine(() => this.db.doc(`${this.mine("sessions")}/${id}`).delete());
  }

  // ---------- my sessions (private)
  async putSession(s: Session) {
    this.sessions.set(s.id, s);
    this.emit();
    await this.writeMine(() => this.db.doc(`${this.mine("sessions")}/${s.id}`).set(strip(s)));
  }

  // ---------- batches (shared)
  async putBatch(b: Batch) {
    this.batches.set(b.id, b);
    this.emit();
    await this.write(() => this.db.doc(`batches/${b.id}`).set(strip(b)));
  }
  async deleteBatch(id: string) {
    this.batches.delete(id);
    this.emit();
    await this.write(() => this.db.doc(`batches/${id}`).delete());
  }
}

function strip<T extends { id: string }>(o: T) {
  const { id: _id, ...rest } = o;
  void _id;
  return JSON.parse(JSON.stringify(rest));
}
