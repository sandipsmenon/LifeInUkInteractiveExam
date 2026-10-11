import type {
  Block,
  Interpretation,
  MarkerStats,
  MarkerStyle,
  ParseIssue,
  ParseResult,
  ParsedOption,
  ParsedQuestion,
  QuestionType,
} from "./types";

const RESULT_LINE = /^(correct|incorrect|wrong|right)\s*[.!]?$/i;
const EXAM_HEADING =
  /^(?:mock\s*(?:test|exam)?|practice\s*(?:test|exam)|test|exam)\s*(?:no\.?|number|#)?\s*(\d{1,3})\b/i;
const QUESTION_NUMBER = /^(?:Q(?:uestion)?\s*)?(\d{1,3})\s*[.):]\s+/i;
const COUNT_WORDS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5 };
const MARK_THRESHOLD = 0.6;
const PARTIAL_THRESHOLD = 0.15;
const OPTION_KEYS = "ABCDEFGHIJ";

export interface ParseOptions {
  /** Force how correct answers are recognised. Leave undefined to auto-detect. */
  markerStyle?: MarkerStyle;
}

function markedFraction(block: Block, style: MarkerStyle): number {
  let total = 0;
  let marked = 0;
  for (const run of block.runs) {
    const n = run.text.replace(/\s/g, "").length;
    total += n;
    if (style === "bold" ? run.bold : run.highlight) marked += n;
  }
  return total === 0 ? 0 : marked / total;
}

function examHeadingNumber(block: Block): number | null {
  if (block.isListItem || block.text.length > 60 || block.text.endsWith("?")) return null;
  const m = EXAM_HEADING.exec(block.text);
  return m ? Number(m[1]) : null;
}

function expectedCount(prompt: string): number | null {
  const m = /\b(?:choose|select|which|pick)?\s*\b(TWO|THREE|FOUR|FIVE)\b/.exec(prompt);
  if (m && m[1] === m[1].toUpperCase()) return COUNT_WORDS[m[1].toLowerCase()];
  const lower = /\(choose (two|three|four|five)/i.exec(prompt);
  return lower ? COUNT_WORDS[lower[1].toLowerCase()] : null;
}

interface RawQuestion {
  promptBlock: Block;
  optionBlocks: Block[];
  resultBlock: Block | null;
  explanationBlocks: Block[];
  optionsListed: boolean;
  exam: number | null;
}

/** Finds question/option/result/explanation groups without yet deciding which options are correct. */
function segment(blocks: Block[]) {
  const raws: RawQuestion[] = [];
  const ignored: string[] = [];
  const examHeadings: Interpretation["examHeadings"] = [];
  let currentExam: number | null = null;
  let i = 0;

  const isResult = (b: Block | undefined) => !!b && !b.isListItem && RESULT_LINE.test(b.text);
  const anyMarked = (bs: Block[]) =>
    bs.some((b) => markedFraction(b, "bold") >= MARK_THRESHOLD || markedFraction(b, "highlight") >= MARK_THRESHOLD);

  while (i < blocks.length) {
    const b = blocks[i];
    const exam = examHeadingNumber(b);
    if (exam !== null) {
      currentExam = exam;
      examHeadings.push({ number: exam, text: b.text, position: raws.length + 1 });
      i++;
      continue;
    }
    const startsListed = !b.isListItem && !isResult(b) && blocks[i + 1]?.isListItem;
    let fallbackEnd = -1;
    if (!startsListed && !b.isListItem && /[?:]$/.test(b.text) && !isResult(b)) {
      // Options written as plain paragraphs: accept only when a result line follows within a few lines.
      for (let k = i + 2; k <= Math.min(i + 7, blocks.length - 1); k++) {
        if (isResult(blocks[k])) {
          fallbackEnd = k;
          break;
        }
        if (blocks[k].isListItem || examHeadingNumber(blocks[k]) !== null) break;
      }
    }
    if (!startsListed && fallbackEnd < 0) {
      if (raws.length) raws[raws.length - 1].explanationBlocks.push(b);
      else ignored.push(b.text);
      i++;
      continue;
    }

    let j = i + 1;
    const optionBlocks: Block[] = [];
    if (startsListed) {
      while (j < blocks.length && blocks[j].isListItem) optionBlocks.push(blocks[j++]);
    } else {
      while (j < fallbackEnd) optionBlocks.push(blocks[j++]);
    }
    const resultBlock = isResult(blocks[j]) ? blocks[j++] : null;

    // A list inside an explanation (no marks, no result line) belongs to the previous question.
    if (!resultBlock && !anyMarked(optionBlocks) && raws.length) {
      raws[raws.length - 1].explanationBlocks.push(b, ...optionBlocks);
      i = j;
      continue;
    }
    raws.push({
      promptBlock: b,
      optionBlocks,
      resultBlock,
      explanationBlocks: [],
      optionsListed: !!startsListed,
      exam: currentExam,
    });
    i = j;
  }
  return { raws, ignored, examHeadings };
}

function markerStats(raws: RawQuestion[], style: MarkerStyle): MarkerStats {
  let valid = 0;
  let all = 0;
  for (const r of raws) {
    const marked = r.optionBlocks.filter((o) => markedFraction(o, style) >= MARK_THRESHOLD).length;
    if (marked > 0 && marked < r.optionBlocks.length) valid++;
    if (marked > 0 && marked === r.optionBlocks.length) all++;
  }
  return { style, questionsWithValidMarking: valid, questionsAllMarked: all };
}

function buildQuestion(r: RawQuestion, style: MarkerStyle, position: number, examCounter: number): ParsedQuestion {
  const issues: ParseIssue[] = [];
  let prompt = r.promptBlock.text;
  let questionNumber: number | null = null;
  const qn = QUESTION_NUMBER.exec(prompt);
  if (qn) {
    questionNumber = Number(qn[1]);
    prompt = prompt.slice(qn[0].length).trim();
  } else if (r.exam !== null) {
    questionNumber = examCounter;
  }

  const options: ParsedOption[] = r.optionBlocks.map((o, idx) => {
    const frac = markedFraction(o, style);
    if (frac > PARTIAL_THRESHOLD && frac < MARK_THRESHOLD) {
      issues.push({
        code: "partial_marking",
        severity: "warning",
        message: `Option "${o.text}" is only partly ${style === "bold" ? "bold" : "highlighted"}.`,
      });
    }
    return { key: OPTION_KEYS[idx] ?? String(idx + 1), text: o.text, marked: frac >= MARK_THRESHOLD };
  });
  const correctKeys = options.filter((o) => o.marked).map((o) => o.key);

  const isTrueFalse =
    options.length === 2 && options.every((o) => /^(true|false)$/i.test(o.text.replace(/[.!]$/, "")));
  const questionType: QuestionType = isTrueFalse ? "true_false" : correctKeys.length > 1 ? "multi" : "single";

  if (options.length < 2) {
    issues.push({ code: "too_few_options", severity: "error", message: "Fewer than two answer options were found." });
  }
  if (correctKeys.length === 0) {
    issues.push({ code: "no_correct_marked", severity: "error", message: "No option is marked as the correct answer." });
  } else if (correctKeys.length === options.length) {
    issues.push({ code: "all_options_marked", severity: "error", message: "Every option is marked, so the correct answer is unclear." });
  }
  const expected = expectedCount(prompt);
  if (expected !== null && correctKeys.length !== expected) {
    issues.push({
      code: "count_mismatch",
      severity: "warning",
      message: `The question asks for ${expected} answers but ${correctKeys.length} ${correctKeys.length === 1 ? "is" : "are"} marked.`,
    });
  } else if (expected === null && correctKeys.length > 1 && correctKeys.length < options.length) {
    issues.push({
      code: "count_mismatch",
      severity: "warning",
      message: `${correctKeys.length} options are marked but the question does not say how many to choose.`,
    });
  }
  const seen = new Set<string>();
  for (const o of options) {
    const k = o.text.toLowerCase();
    if (seen.has(k)) issues.push({ code: "duplicate_option", severity: "warning", message: `Option "${o.text}" appears twice.` });
    seen.add(k);
  }
  if (!r.resultBlock) {
    issues.push({ code: "no_result_line", severity: "warning", message: "No 'Correct'/'Incorrect' line was found after the options." });
  }
  if (!r.optionsListed) {
    issues.push({
      code: "options_not_listed",
      severity: "warning",
      message: "Options were plain paragraphs rather than a list; please check they were split correctly.",
    });
  }

  const resultText = r.resultBlock?.text.toLowerCase() ?? null;
  return {
    sourcePosition: position,
    mockExamNumber: r.exam,
    questionNumber,
    prompt,
    questionType,
    options,
    correctKeys,
    explanation: r.explanationBlocks.map((b) => b.text).join("\n\n") || null,
    sourceResult: resultText ? (/^(correct|right)/.test(resultText) ? "correct" : "incorrect") : null,
    promptHighlighted: markedFraction(r.promptBlock, "highlight") >= MARK_THRESHOLD,
    issues,
    raw: {
      prompt: r.promptBlock.text,
      options: r.optionBlocks.map((o) => o.text),
      result: r.resultBlock?.text ?? null,
      explanation: r.explanationBlocks.map((b) => b.text),
    },
  };
}

export function parseBlocks(blocks: Block[], opts: ParseOptions = {}): ParseResult {
  const { raws, ignored, examHeadings } = segment(blocks);
  const candidates = [markerStats(raws, "bold"), markerStats(raws, "highlight")].sort(
    (a, b) => b.questionsWithValidMarking - a.questionsWithValidMarking,
  );
  const best = candidates[0];
  const second = candidates[1];
  const markerStyle = opts.markerStyle ?? best.style;
  const notes: string[] = [];

  const markerAmbiguous =
    !opts.markerStyle &&
    raws.length > 0 &&
    (best.questionsWithValidMarking === 0 ||
      best.questionsWithValidMarking < raws.length * 0.5 ||
      second.questionsWithValidMarking > raws.length * 0.2);

  if (best.questionsWithValidMarking === 0 && raws.length) {
    notes.push("No bold or highlighted answer options were found. Correct answers will need to be set manually.");
  }
  if (markerStyle === "bold" && raws.some((r) => markedFraction(r.promptBlock, "highlight") >= MARK_THRESHOLD)) {
    notes.push("Some question prompts are highlighted; these will be marked as important.");
  }
  if (examHeadings.length === 0) {
    notes.push("No mock exam headings (e.g. 'Mock test 2') were found, so the exam each question belongs to is unknown.");
  }

  const counters = new Map<number | null, number>();
  const questions = raws.map((r, idx) => {
    const n = (counters.get(r.exam) ?? 0) + 1;
    counters.set(r.exam, n);
    return buildQuestion(r, markerStyle, idx + 1, n);
  });

  return {
    interpretation: {
      markerStyle,
      markerCandidates: candidates,
      markerAmbiguous,
      examHeadings,
      questionCount: questions.length,
      questionsPerExamHint: null,
      notes,
    },
    questions,
    ignoredBlocks: ignored,
  };
}
