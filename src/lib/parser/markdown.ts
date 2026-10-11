import type { Block, Run } from "./types";

const BULLET = /^\s*(?:[*\-+•]|[A-Fa-f][.)])\s+/;
const HEADING = /^(#{1,6})\s+/;

function unescapeMd(s: string): string {
  return s.replace(/\\([\\`*_{}\[\]()#+\-.!=~|>])/g, "$1");
}

/** Splits inline Markdown into runs, understanding **bold**, __bold__, ==highlight== and <mark>. */
export function parseInline(line: string): Run[] {
  const runs: Run[] = [];
  let bold = false;
  let highlight = false;
  let buf = "";
  const flush = () => {
    if (buf) runs.push({ text: unescapeMd(buf), bold, highlight: highlight ? "markdown" : null });
    buf = "";
  };
  for (let i = 0; i < line.length; i++) {
    const two = line.slice(i, i + 2);
    if (line[i] === "\\" && i + 1 < line.length) {
      buf += line.slice(i, i + 2);
      i++;
    } else if (two === "**" || two === "__") {
      flush();
      bold = !bold;
      i++;
    } else if (two === "==") {
      flush();
      highlight = !highlight;
      i++;
    } else if (line.startsWith("<mark>", i)) {
      flush();
      highlight = true;
      i += 5;
    } else if (line.startsWith("</mark>", i)) {
      flush();
      highlight = false;
      i += 6;
    } else {
      buf += line[i];
    }
  }
  flush();
  return runs;
}

export function markdownToBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  for (const rawLine of source.replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.replace(/\s+$/, "");
    if (!line.trim()) continue;
    let body = line;
    let isListItem = false;
    let headingLevel: number | null = null;
    const h = HEADING.exec(body);
    if (h) {
      headingLevel = h[1].length;
      body = body.slice(h[0].length);
    } else if (BULLET.test(body)) {
      isListItem = true;
      body = body.replace(BULLET, "");
    }
    const runs = parseInline(body.trim());
    const text = runs.map((r) => r.text).join("").replace(/\s+/g, " ").trim();
    if (!text) continue;
    blocks.push({ runs, text, isListItem, headingLevel });
  }
  return blocks;
}
