import { normalizeText } from "../../src/lib/text";
import type { Attempt, Batch, Progress, Question, Session } from "./model";
import { textHash } from "./model";

/* eslint-disable @typescript-eslint/no-explicit-any */
type DB = any;

export function contentHash(prompt: string, options: { text: string }[]) {
  return textHash(`${normalizeText(prompt)}\u0000${options.map((o) => normalizeText(o.text)).sort().join("\u0001")}`);
}

/**
 * In-memory mirror of the artifact database. Everything is loaded once on open (a personal bank is a few
 * hundred to a couple of thousand small documents), then every change is applied locally and written through.
 */
export class Store {
  questions = new Map<string, Question>();
  progress = new Map<string, Progress>();
  sessions = new Map<string, Session>();
  batches = new Map<string, Batch>();
  version = 0;
  error: string | null = null;
  private listeners = new Set<() => void>();

  constructor(private db: DB) {}

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = () => this.version;
  private emit() {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  private async readAll(collection: string, orderField: string): Promise<any[]> {
    const out: any[] = [];
    let last: unknown = null;
    // Pages of 1000, ordered by a field every document has.
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
    const [qs, ps, ss, bs] = await Promise.all([
      this.readAll("questions", "seq"),
      this.readAll("progress", "qid"),
      this.readAll("sessions", "startedAt"),
      this.readAll("batches", "createdAt"),
    ]);
    for (const q of qs) this.questions.set(q.id, q);
    for (const p of ps) this.progress.set(p.id, { attempts: p.attempts ?? [] });
    for (const s of ss) this.sessions.set(s.id, s);
    for (const b of bs) this.batches.set(b.id, b);
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
          ? "The database is full. Delete old import batches or sessions on the Backup page."
          : `Could not save (${err?.code ?? "error"}). Your last change may not be stored — check your connection and try again.`;
      this.emit();
      throw err;
    }
  }
  clearError() {
    this.error = null;
    this.emit();
  }

  // ---------- questions
  allQuestions(): Question[] {
    return [...this.questions.values()].sort((a, b) => a.seq - b.seq);
  }
  nextSeq() {
    let max = 0;
    for (const q of this.questions.values()) max = Math.max(max, q.seq);
    return max + 1;
  }
  async putQuestion(q: Question) {
    this.questions.set(q.id, q);
    this.emit();
    await this.write(() => this.db.doc(`questions/${q.id}`).set(strip(q)));
  }
  async putQuestions(qs: Question[]) {
    for (const q of qs) this.questions.set(q.id, q);
    this.emit();
    for (const q of qs) await this.write(() => this.db.doc(`questions/${q.id}`).set(strip(q)));
  }
  async deleteQuestion(id: string) {
    this.questions.delete(id);
    this.progress.delete(id);
    this.emit();
    await this.write(() => this.db.doc(`questions/${id}`).delete());
    await this.write(() => this.db.doc(`progress/${id}`).delete());
  }

  // ---------- attempts
  attemptsOf(id: string): Attempt[] {
    return this.progress.get(id)?.attempts ?? [];
  }
  async setAttempts(qid: string, attempts: Attempt[]) {
    this.progress.set(qid, { attempts });
    this.emit();
    await this.write(() => this.db.doc(`progress/${qid}`).set({ qid, attempts }));
  }
  async addAttempt(qid: string, a: Attempt) {
    await this.setAttempts(qid, [...this.attemptsOf(qid), a]);
  }

  // ---------- sessions & batches
  async putSession(s: Session) {
    this.sessions.set(s.id, s);
    this.emit();
    await this.write(() => this.db.doc(`sessions/${s.id}`).set(strip(s)));
  }
  async deleteSession(id: string) {
    this.sessions.delete(id);
    this.emit();
    await this.write(() => this.db.doc(`sessions/${id}`).delete());
  }
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
