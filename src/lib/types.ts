import type { Difficulty, ReviewStatus } from "./srs";

export interface QuestionOption {
  key: string;
  text: string;
}

export interface Category {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  questionCount?: number;
}

export interface QuestionSummary {
  id: string;
  prompt: string;
  questionType: "single" | "multi" | "true_false";
  options: QuestionOption[];
  correctKeys: string[];
  mockExamNumber: number | null;
  questionNumber: number | null;
  sourcePosition: number | null;
  sourceResult: "correct" | "incorrect" | null;
  batchId: string | null;
  topics: string[];
  categories: { slug: string; name: string; source: "auto" | "manual" }[];
  isImportant: boolean;
  isConfusing: boolean;
  status: ReviewStatus;
  dueAt: string | null;
  attempts: number;
  wrong: number;
  difficulty: Difficulty;
  openFlags: number;
  edited: boolean;
}

export interface QuestionDetail extends QuestionSummary {
  explanation: string | null;
  notes: string | null;
  memoryAid: string | null;
  original: OriginalSnapshot | null;
  batch: { id: string; filename: string; label: string | null; createdAt: string } | null;
  review: {
    ease: number;
    intervalDays: number;
    reps: number;
    lapses: number;
    correctStreak: number;
    lastReviewedAt: string | null;
  } | null;
  history: { id: string; isCorrect: boolean; mode: string; selectedKeys: string[]; confidence: number | null; createdAt: string }[];
  flags: { id: string; reason: string; note: string | null; createdAt: string; resolvedAt: string | null }[];
}

export interface OriginalSnapshot {
  prompt: string;
  options: QuestionOption[];
  correctKeys: string[];
  explanation: string | null;
  mockExamNumber: number | null;
  questionNumber: number | null;
  raw?: { prompt: string; options: string[]; result: string | null; explanation: string[] };
}

/** A question as sent to the practice runner. */
export interface PracticeQuestion {
  id: string;
  prompt: string;
  questionType: "single" | "multi" | "true_false";
  options: QuestionOption[];
  correctCount: number;
  ref: string;
  categories: string[];
  reasons?: string[];
  memoryAid: string | null;
}

export interface AttemptFeedback {
  isCorrect: boolean;
  correctKeys: string[];
  explanation: string | null;
  memoryAid: string | null;
  status: ReviewStatus;
  nextDueAt: string | null;
  intervalDays: number;
}

export const MODES = {
  quick: { label: "Quick practice", description: "Random questions from your whole bank." },
  category: { label: "Category practice", description: "Focus on one category such as dates or people." },
  mock: { label: "Mock exam practice", description: "Replay the questions from one mock test in order." },
  weak: { label: "Weak areas", description: "Questions you get wrong, forget, or have not mastered." },
  revision: { label: "Revision (due)", description: "Spaced-repetition reviews that are due now." },
  rapid: { label: "Rapid recall", description: "Fast flash-style recall of dates, numbers and names." },
  mixed: { label: "Mixed practice", description: "Interleave questions from several categories." },
  exam: { label: "Exam simulation", description: "24 questions, 45 minutes, 75% to pass, no feedback until the end." },
} as const;
export type PracticeMode = keyof typeof MODES;
export const TRAINING_MODES = ["timeline", "numbers", "names", "matching", "compare", "flashcards"] as const;

export const EXAM_FORMAT = { questions: 24, minutes: 45, passMark: 18 } as const;

export const STATUS_LABEL: Record<ReviewStatus, string> = {
  new: "New",
  learning: "Learning",
  needs_revision: "Needs revision",
  mastered: "Mastered",
};
