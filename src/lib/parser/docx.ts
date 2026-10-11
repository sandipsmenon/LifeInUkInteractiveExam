import JSZip from "jszip";
import type { Block, Run } from "./types";

const MAX_XML_BYTES = 25 * 1024 * 1024; // guards against zip bombs

export class DocxError extends Error {}

function decodeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function attr(tagXml: string, name: string): string | null {
  const m = new RegExp(`${name}="([^"]*)"`).exec(tagXml);
  return m ? m[1] : null;
}

/** Reads a toggle property such as <w:b/> or <w:b w:val="0"/>. Returns null when absent. */
function toggle(rPr: string, tag: string): boolean | null {
  const m = new RegExp(`<w:${tag}(\\s[^>]*)?/?>`).exec(rPr);
  if (!m) return null;
  const val = attr(m[0], "w:val");
  return !(val && /^(0|false|off|none)$/i.test(val));
}

function highlightOf(rPr: string): string | null {
  const hl = /<w:highlight\s[^>]*>/.exec(rPr);
  if (hl) {
    const val = attr(hl[0], "w:val");
    if (val && val !== "none") return val;
  }
  const shd = /<w:shd\s[^>]*>/.exec(rPr);
  if (shd) {
    const fill = attr(shd[0], "w:fill");
    if (fill && !/^(auto|ffffff|000000)$/i.test(fill)) return `#${fill}`;
  }
  return null;
}

interface CharStyle {
  bold: boolean;
  highlight: string | null;
}

function readCharacterStyles(stylesXml: string | null): Map<string, CharStyle> {
  const styles = new Map<string, CharStyle>();
  if (!stylesXml) return styles;
  for (const m of stylesXml.matchAll(/<w:style\s([^>]*)>([\s\S]*?)<\/w:style>/g)) {
    if (attr(m[1], "w:type") !== "character") continue;
    const id = attr(m[1], "w:styleId");
    const rPr = /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(m[2])?.[1] ?? "";
    if (id) styles.set(id, { bold: toggle(rPr, "b") === true, highlight: highlightOf(rPr) });
  }
  return styles;
}

function parseRun(runXml: string, charStyles: Map<string, CharStyle>): Run | null {
  const rPr = /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(runXml)?.[1] ?? "";
  const styleId = /<w:rStyle\s[^>]*>/.exec(rPr);
  const style = styleId ? charStyles.get(attr(styleId[0], "w:val") ?? "") : undefined;
  let text = "";
  for (const t of runXml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:(tab|br|cr)(?:\s[^>]*)?\/>/g)) {
    if (t[1] !== undefined) text += decodeXml(t[1]);
    else text += t[2] === "tab" ? "\t" : "\n";
  }
  if (!text) return null;
  const directBold = toggle(rPr, "b");
  return {
    text,
    bold: directBold ?? style?.bold ?? false,
    highlight: highlightOf(rPr) ?? style?.highlight ?? null,
  };
}

export async function docxToBlocks(data: ArrayBuffer | Uint8Array): Promise<Block[]> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new DocxError("The file is not a valid .docx document (could not open the archive).");
  }
  const docFile = zip.file("word/document.xml");
  if (!docFile) throw new DocxError("The .docx file has no word/document.xml part.");
  const size = (docFile as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
  if (typeof size === "number" && size > MAX_XML_BYTES) {
    throw new DocxError("The document is too large to import.");
  }
  const xml = await docFile.async("string");
  if (xml.length > MAX_XML_BYTES) throw new DocxError("The document is too large to import.");
  const stylesXml = (await zip.file("word/styles.xml")?.async("string")) ?? null;
  const charStyles = readCharacterStyles(stylesXml);

  const blocks: Block[] = [];
  const body = /<w:body>([\s\S]*)<\/w:body>/.exec(xml)?.[1] ?? xml;
  for (const p of body.matchAll(/<w:p(?:\s[^>]*?)?(?<!\/)>([\s\S]*?)<\/w:p>/g)) {
    const pXml = p[1];
    const pPr = /<w:pPr>([\s\S]*?)<\/w:pPr>/.exec(pXml)?.[1] ?? "";
    const pStyle = attr(/<w:pStyle\s[^>]*>/.exec(pPr)?.[0] ?? "", "w:val") ?? "";
    const headingMatch = /^(?:Heading|heading)\s?(\d)$/.exec(pStyle);
    const headingLevel = headingMatch ? Number(headingMatch[1]) : /^Title$/i.test(pStyle) ? 1 : null;
    const isListItem = /<w:numPr>/.test(pPr) || /List/i.test(pStyle);
    const content = pXml.replace(/<w:pPr>[\s\S]*?<\/w:pPr>/, "");
    const runs: Run[] = [];
    for (const r of content.matchAll(/<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g)) {
      const run = parseRun(r[1], charStyles);
      if (run) runs.push(run);
    }
    // A paragraph may contain soft line breaks; split them into separate blocks so each line is considered.
    const lines: Run[][] = [[]];
    for (const run of runs) {
      const parts = run.text.split("\n");
      parts.forEach((part, i) => {
        if (i > 0) lines.push([]);
        if (part) lines[lines.length - 1].push({ ...run, text: part });
      });
    }
    for (const lineRuns of lines) {
      const text = lineRuns.map((r) => r.text).join("").replace(/\s+/g, " ").trim();
      if (!text) continue;
      blocks.push({ runs: lineRuns, text, isListItem, headingLevel });
    }
  }
  return blocks;
}
