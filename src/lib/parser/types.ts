/** A run of text with the formatting the parser cares about. */
export interface Run {
  text: string;
  bold: boolean;
  highlight: string | null; // highlight / shading colour, or null
}

/** One paragraph of the source document, format-agnostic (docx and Markdown both produce these). */
export interface Block {
  runs: Run[];
  text: string;
  isListItem: boolean;
  headingLevel: number | null;
}

export type MarkerStyle = "bold" | "highlight";
export type QuestionType = "single" | "multi" | "true_false";

export interface ParsedOption {
  key: string;
  text: string;
  marked: boolean;
}

export type IssueCode =
  | "no_correct_marked"
  | "count_mismatch"
  | "too_few_options"
  | "all_options_marked"
  | "partial_marking"
  | "no_result_line"
  | "options_not_listed"
  | "duplicate_option";

export interface ParseIssue {
  code: IssueCode;
  message: string;
  severity: "error" | "warning";
}

export interface ParsedQuestion {
  sourcePosition: number; // 1-based order in the document
  mockExamNumber: number | null;
  questionNumber: number | null;
  prompt: string;
  questionType: QuestionType;
  options: ParsedOption[];
  correctKeys: string[];
  explanation: string | null;
  sourceResult: "correct" | "incorrect" | null;
  promptHighlighted: boolean;
  issues: ParseIssue[];
  /** Raw text exactly as it appeared, kept for reference after edits. */
  raw: { prompt: string; options: string[]; result: string | null; explanation: string[] };
}

export interface MarkerStats {
  style: MarkerStyle;
  questionsWithValidMarking: number;
  questionsAllMarked: number;
}

export interface Interpretation {
  markerStyle: MarkerStyle;
  markerCandidates: MarkerStats[];
  markerAmbiguous: boolean;
  examHeadings: { number: number; text: string; position: number }[];
  questionCount: number;
  questionsPerExamHint: number | null;
  notes: string[];
}

export interface ParseResult {
  interpretation: Interpretation;
  questions: ParsedQuestion[];
  ignoredBlocks: string[];
}
