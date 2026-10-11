import { createHash } from "node:crypto";
import { normalizeText } from "./text";

export function sha256(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Same prompt + same set of options (order-insensitive) = same question. */
export function contentHash(prompt: string, options: { text: string }[]): string {
  const opts = options.map((o) => normalizeText(o.text)).sort();
  return sha256(`${normalizeText(prompt)}\u0000${opts.join("\u0001")}`);
}
