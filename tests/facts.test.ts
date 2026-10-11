import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { categorise, deriveTopics } from "@/lib/categorize";
import { confusableGroups, datedFacts, nameFacts, numberFacts, numberRecallCorrect, type FactSource } from "@/lib/facts";
import { markdownToBlocks } from "@/lib/parser/markdown";
import { parseBlocks } from "@/lib/parser/parse";

const parsed = parseBlocks(markdownToBlocks(readFileSync("data/initial/LifeInUk-mock-1-3.md", "utf8"))).questions;
const sources: FactSource[] = parsed.map((q, i) => ({
  id: `q${i + 1}`,
  prompt: q.prompt,
  options: q.options,
  correctKeys: q.correctKeys,
  categories: categorise(q),
  topics: deriveTopics(q),
  mockExamNumber: null,
  questionNumber: null,
}));
const find = (s: string) => sources.find((q) => q.prompt.startsWith(s))!;

describe("categorisation", () => {
  it("puts questions in sensible, multiple categories", () => {
    expect(find("When did the Wars of the Roses start").categories).toEqual(expect.arrayContaining(["dates", "history"]));
    expect(find("How many members does the Scottish Parliament").categories).toEqual(expect.arrayContaining(["numbers", "government"]));
    expect(find("Who was reigning in England").categories).toEqual(expect.arrayContaining(["people", "monarchy"]));
    expect(find("Where is the city of Swansea").categories).toContain("geography");
    expect(find("Which court deals with the most serious").categories).toEqual(["law"]);
    expect(find("When is the Jewish celebration").categories).toContain("religion");
    expect(find("Who was the inventor of the World Wide Web").categories).toContain("science");
    expect(sources.filter((s) => s.categories.includes("uncategorised"))).toHaveLength(0);
  });
});

describe("memory-training facts", () => {
  it("builds a timeline only from answers that contain a date", () => {
    const dated = datedFacts(sources);
    const labels = dated.map((d) => d.answer);
    expect(labels).toEqual(expect.arrayContaining(["1455", "1485", "1895", "10,000 years ago", "31 January 2020"]));
    expect(dated.every((d) => /\d/.test(d.answer))).toBe(true);
    const bronze = dated.find((d) => d.answer === "Around 4,000 years ago")!;
    const roses = dated.find((d) => d.answer === "1455")!;
    expect(bronze.sortValue).toBeLessThan(roses.sortValue);
  });

  it("checks typed number recall against the original figure", () => {
    const nums = numberFacts(sources);
    const msp = nums.find((n) => n.prompt.startsWith("How many members"))!;
    expect(msp.numbers).toEqual(["129"]);
    expect(numberRecallCorrect("129", msp)).toBe(true);
    expect(numberRecallCorrect("120", msp)).toBe(false);
    const fine = nums.find((n) => n.prompt.startsWith("How much can you be fined"))!;
    expect(numberRecallCorrect("£1,000", fine)).toBe(true);
    expect(nums.some((n) => n.answer === "1455")).toBe(false);
  });

  it("finds people for name recall and easily-confused pairs", () => {
    expect(nameFacts(sources).map((f) => f.answer)).toEqual(expect.arrayContaining(["Sir Steve Redgrave", "Dame Kelly Holmes"]));
    const groups = confusableGroups(sources);
    const pairs = groups.map((g) => g.facts.map((f) => f.answer).sort().join(" / "));
    expect(pairs).toContain("1455 / 1485");
  });
});
