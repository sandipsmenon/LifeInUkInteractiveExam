import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { docxToBlocks } from "@/lib/parser/docx";
import { markdownToBlocks } from "@/lib/parser/markdown";
import { parseBlocks } from "@/lib/parser/parse";
import { buildDocx, paragraphsFromMarkdown } from "./support/docx";

const md = readFileSync("data/initial/LifeInUk-mock-1-3.md", "utf8");

describe("initial dataset (Markdown export of the Word document)", () => {
  const result = parseBlocks(markdownToBlocks(md));

  it("finds all 75 questions with bold answers and no parse errors", () => {
    expect(result.questions).toHaveLength(75);
    expect(result.interpretation.markerStyle).toBe("bold");
    expect(result.interpretation.markerAmbiguous).toBe(false);
    expect(result.questions.filter((q) => q.issues.some((i) => i.severity === "error"))).toHaveLength(0);
    expect(result.ignoredBlocks).toEqual(["Life in UK:"]);
  });

  it("keeps question/answer pairs intact", () => {
    const byPrompt = (s: string) => result.questions.find((q) => q.prompt.startsWith(s))!;
    const answer = (s: string) => {
      const q = byPrompt(s);
      return q.options.filter((o) => q.correctKeys.includes(o.key)).map((o) => o.text);
    };
    expect(answer("Who were the first people")).toEqual(["Hunter-gatherers"]);
    expect(answer("How many members does the Scottish Parliament")).toEqual(["129"]);
    expect(answer("When did the Wars of the Roses start")).toEqual(["1455"]);
    expect(answer("When did the Wars of the Roses end")).toEqual(["1485"]);
    expect(answer("Which TWO of the following are environmental")).toEqual(["The National Trust", "Friends of the Earth"]);
    expect(answer("What does the UK offer")).toHaveLength(5);
    expect(answer("The Commonwealth has no power")).toEqual(["False"]);
    expect(answer("How much can you be fined")).toEqual(["Up to £1000"]);
    expect(byPrompt("The Commonwealth has no power").questionType).toBe("true_false");
    expect(byPrompt("Which TWO of the following are environmental").questionType).toBe("multi");
  });

  it("records the original mock result and explanation without altering text", () => {
    const q = result.questions[3];
    expect(q.prompt).toBe("Which of the following statements regarding the Black Death is NOT true?");
    expect(q.sourceResult).toBe("incorrect");
    expect(q.explanation).toMatch(/^In 1348, a disease/);
    expect(result.questions.filter((x) => x.sourceResult === "incorrect")).toHaveLength(42);
    expect(result.questions.filter((x) => x.sourceResult === "correct")).toHaveLength(33);
    // Escaped Markdown is unescaped, nothing else changes.
    expect(result.questions.find((x) => x.prompt.startsWith("Who was the inventor"))!.explanation).toContain("25 December 1990.");
  });

  it("reports that mock exam boundaries are unknown instead of guessing", () => {
    expect(result.interpretation.examHeadings).toHaveLength(0);
    expect(result.questions.every((q) => q.mockExamNumber === null && q.questionNumber === null)).toBe(true);
  });
});

describe(".docx import", () => {
  it("reads bold answers and bullet lists from a Word document identically to the Markdown export", async () => {
    const docx = await buildDocx(paragraphsFromMarkdown(md, { marker: "bold" }));
    const fromDocx = parseBlocks(await docxToBlocks(docx));
    const fromMd = parseBlocks(markdownToBlocks(md));
    expect(fromDocx.questions).toHaveLength(75);
    expect(fromDocx.questions.map((q) => [q.prompt, q.correctKeys, q.sourceResult])).toEqual(
      fromMd.questions.map((q) => [q.prompt, q.correctKeys, q.sourceResult]),
    );
  });

  it("detects highlighted answers and mock exam headings", async () => {
    const headings = new Map([
      [1, "Mock Test 1"],
      [26, "Mock Test 2"],
      [51, "Mock Test 3"],
    ]);
    const docx = await buildDocx(paragraphsFromMarkdown(md, { marker: "highlight", headings }));
    const r = parseBlocks(await docxToBlocks(docx));
    expect(r.interpretation.markerStyle).toBe("highlight");
    expect(r.interpretation.examHeadings.map((h) => h.number)).toEqual([1, 2, 3]);
    expect(r.questions[0]).toMatchObject({ mockExamNumber: 1, questionNumber: 1 });
    expect(r.questions[25]).toMatchObject({ mockExamNumber: 2, questionNumber: 1 });
    expect(r.questions[74]).toMatchObject({ mockExamNumber: 3, questionNumber: 25 });
    expect(r.questions[0].correctKeys).toEqual(["B"]);
  });

  it("flags ambiguous marking instead of guessing", async () => {
    const docx = await buildDocx([
      { runs: [{ text: "Which city is the capital of Wales?", bold: true }] },
      { runs: [{ text: "Cardiff", bold: true }], list: true },
      { runs: [{ text: "Swansea", highlight: "yellow" }], list: true },
      { runs: [{ text: "Newport" }], list: true },
      { runs: [{ text: "Correct" }] },
      { runs: [{ text: "Which TWO are in Scotland?" }] },
      { runs: [{ text: "Glasgow", bold: true }], list: true },
      { runs: [{ text: "Leeds", highlight: "yellow" }], list: true },
      { runs: [{ text: "Bristol" }], list: true },
      { runs: [{ text: "Incorrect" }] },
    ]);
    const r = parseBlocks(await docxToBlocks(docx));
    expect(r.interpretation.markerAmbiguous).toBe(true);
    expect(r.questions[1].issues.map((i) => i.code)).toContain("count_mismatch");
    const forced = parseBlocks(await docxToBlocks(docx), { markerStyle: "highlight" });
    expect(forced.questions[0].correctKeys).toEqual(["B"]);
  });

  it("keeps a bulleted list inside an explanation with the previous question", () => {
    const r = parseBlocks(
      markdownToBlocks(
        ["**Q one?**", "* **A**", "* B", "**Correct**", "The principles include:", "* tolerance", "* democracy", "**Q two?**", "* A", "* **B**", "**Incorrect**"].join("\n"),
      ),
    );
    expect(r.questions).toHaveLength(2);
    expect(r.questions[0].explanation).toContain("tolerance");
    expect(r.questions[1].correctKeys).toEqual(["B"]);
  });

  it("rejects files that are not Word documents", async () => {
    await expect(docxToBlocks(new TextEncoder().encode("not a zip"))).rejects.toThrow(/not a valid .docx/);
  });
});
