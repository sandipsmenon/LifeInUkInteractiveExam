import JSZip from "jszip";

export interface FixtureRun {
  text: string;
  bold?: boolean;
  highlight?: string;
}
export interface FixtureParagraph {
  runs: FixtureRun[];
  list?: boolean;
  heading?: number;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Builds a minimal but valid .docx in memory, mirroring how Word stores bold, highlight and bullets. */
export async function buildDocx(paragraphs: FixtureParagraph[]): Promise<Uint8Array> {
  const body = paragraphs
    .map((p) => {
      const pPr = [
        p.heading ? `<w:pStyle w:val="Heading${p.heading}"/>` : p.list ? `<w:pStyle w:val="ListParagraph"/>` : "",
        p.list ? `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>` : "",
      ].join("");
      const runs = p.runs
        .map((r) => {
          const rPr = `${r.bold ? "<w:b/><w:bCs/>" : ""}${r.highlight ? `<w:highlight w:val="${r.highlight}"/>` : ""}`;
          return `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ""}<w:t xml:space="preserve">${esc(r.text)}</w:t></w:r>`;
        })
        .join("");
      return `<w:p w:rsidR="00A1">${pPr ? `<w:pPr>${pPr}</w:pPr>` : ""}${runs}</w:p>`;
    })
    .join("");
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:p w:rsidR="00A2"/><w:sectPr/></w:body></w:document>`,
  );
  return zip.generateAsync({ type: "uint8array" });
}

/** Converts the Markdown export of the user's document into equivalent Word paragraphs. */
export function paragraphsFromMarkdown(md: string, opts: { marker: "bold" | "highlight"; headings?: Map<number, string> }) {
  const out: FixtureParagraph[] = [];
  let q = 0;
  const lines = md.split("\n").map((l) => l.trimEnd()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isList = /^\* /.test(line);
    const isPrompt = !isList && /^\*\*.*\*\*$/.test(line) && lines[i + 1]?.startsWith("* ");
    if (isPrompt) {
      q++;
      const h = opts.headings?.get(q);
      if (h) out.push({ heading: 1, runs: [{ text: h }] });
    }
    const body = (isList ? line.slice(2) : line).replace(/\\(.)/g, "$1");
    const runs: FixtureRun[] = [];
    body.split(/(\*\*[^*]+\*\*)/).forEach((part) => {
      if (!part) return;
      const marked = part.startsWith("**") && part.endsWith("**") && part.length > 4;
      const text = marked ? part.slice(2, -2) : part;
      if (marked && isList && opts.marker === "highlight") runs.push({ text, highlight: "yellow" });
      else runs.push({ text, bold: marked });
    });
    out.push({ runs, list: isList });
  }
  return out;
}
