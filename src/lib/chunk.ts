import { CHUNK_OVERLAP_CHARS, CHUNK_TARGET_CHARS } from "@/lib/config";
import type { Extraction } from "@/lib/extract";

/**
 * Chunking, on section boundaries, with overlap.
 *
 * The point of chunking here is not just retrieval quality — it is
 * citability. Every chunk carries the section it came from and either a page
 * (PDF) or a line range (TXT/MD), recorded while the text is still adjacent
 * to its source. The model never gets to invent a location; it can only name
 * a chunk, and the location is read back out of these fields.
 *
 * Sections come from Markdown ATX headings where they exist, from PDF page
 * boundaries otherwise, and fall back to a single section for a flat text
 * file.
 */

export interface PreparedChunk {
  ordinal: number;
  sectionOrdinal: number;
  sectionLabel: string;
  page: number | null;
  lineStart: number | null;
  lineEnd: number | null;
  tokenCount: number;
  text: string;
}

export interface PreparedSection {
  ordinal: number;
  title: string;
  page: number | null;
  lineStart: number | null;
  lineEnd: number | null;
}

export interface ChunkingResult {
  chunks: PreparedChunk[];
  sections: PreparedSection[];
}

interface RawSection {
  title: string;
  page: number | null;
  /** 1-based inclusive line numbers within the whole document. */
  lineStart: number;
  lineEnd: number;
  text: string;
}

/**
 * Rough token estimate. Good enough for the "142 tokens" label and for
 * keeping the prompt inside a sane budget; this deliberately avoids pulling
 * in a tokeniser for a number that is only ever displayed and bounded.
 */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.round(text.trim().length / 4));
}

export function chunkDocument(extraction: Extraction): ChunkingResult {
  const raw =
    extraction.kind === "pdf"
      ? sectionsFromPages(extraction)
      : sectionsFromHeadings(extraction.text);

  const sections: PreparedSection[] = [];
  const chunks: PreparedChunk[] = [];

  for (const section of raw) {
    const sectionOrdinal = sections.length + 1;
    sections.push({
      ordinal: sectionOrdinal,
      title: section.title,
      page: section.page,
      lineStart: extraction.kind === "pdf" ? null : section.lineStart,
      lineEnd: extraction.kind === "pdf" ? null : section.lineEnd,
    });

    for (const piece of splitWithOverlap(section.text)) {
      const text = piece.text.trim();
      if (!text) continue;

      // Offsets are relative to the section, so shift them onto the document.
      const lineStart = section.lineStart + piece.lineOffset;
      const lineEnd = lineStart + countLines(piece.text) - 1;

      chunks.push({
        ordinal: chunks.length,
        sectionOrdinal,
        sectionLabel: section.title,
        page: section.page,
        lineStart: extraction.kind === "pdf" ? null : lineStart,
        lineEnd: extraction.kind === "pdf" ? null : Math.min(lineEnd, section.lineEnd),
        tokenCount: estimateTokens(text),
        text,
      });
    }
  }

  // A document with no usable prose still needs one chunk, or there is
  // nothing to retrieve and nothing to cite.
  if (chunks.length === 0 && extraction.text.trim()) {
    chunks.push({
      ordinal: 0,
      sectionOrdinal: 1,
      sectionLabel: sections[0]?.title ?? "Document",
      page: extraction.kind === "pdf" ? 1 : null,
      lineStart: extraction.kind === "pdf" ? null : 1,
      lineEnd: extraction.kind === "pdf" ? null : countLines(extraction.text),
      tokenCount: estimateTokens(extraction.text),
      text: extraction.text.trim(),
    });
    if (sections.length === 0) {
      sections.push({
        ordinal: 1,
        title: "Document",
        page: null,
        lineStart: 1,
        lineEnd: countLines(extraction.text),
      });
    }
  }

  return { chunks, sections };
}

/** Markdown/text: split on ATX headings, keeping absolute line numbers. */
function sectionsFromHeadings(text: string): RawSection[] {
  const lines = text.split("\n");
  const headingAt = new Map<number, string>();

  lines.forEach((line, index) => {
    const atx = /^(#{1,6})\s+(.*\S)\s*$/.exec(line);
    if (atx) {
      headingAt.set(index, cleanHeading(atx[2]));
      return;
    }
    // Setext headings: a line of === or --- underlining the previous line.
    const setext = /^(=+|-{2,})\s*$/.exec(line);
    if (setext && index > 0 && lines[index - 1].trim() && !headingAt.has(index - 1)) {
      headingAt.set(index - 1, cleanHeading(lines[index - 1].trim()));
    }
  });

  const starts = [...headingAt.keys()].sort((a, b) => a - b);

  if (starts.length === 0) {
    return [
      {
        title: "Document",
        page: null,
        lineStart: 1,
        lineEnd: lines.length,
        text,
      },
    ];
  }

  const sections: RawSection[] = [];

  // Anything before the first heading is still content worth retrieving.
  if (starts[0] > 0 && lines.slice(0, starts[0]).join("\n").trim()) {
    sections.push({
      title: "Preamble",
      page: null,
      lineStart: 1,
      lineEnd: starts[0],
      text: lines.slice(0, starts[0]).join("\n"),
    });
  }

  starts.forEach((start, index) => {
    const end = index + 1 < starts.length ? starts[index + 1] : lines.length;
    const body = lines.slice(start, end);
    sections.push({
      title: headingAt.get(start) ?? "Section",
      page: null,
      lineStart: start + 1,
      lineEnd: end,
      // Drop the heading line itself from the embedded text; it is already
      // captured as the section label and repeats in every chunk otherwise.
      text: body.slice(1).join("\n"),
    });
  });

  return sections.filter((section) => section.text.trim().length > 0);
}

/** PDF: one section per page, titled by the page's first non-empty line. */
function sectionsFromPages(extraction: Extraction): RawSection[] {
  return extraction.pages
    .filter((page) => page.text.trim().length > 0)
    .map((page) => {
      const firstLine =
        page.text
          .split("\n")
          .map((line) => line.trim())
          .find((line) => line.length > 0) ?? "";
      const title =
        firstLine.length > 0 && firstLine.length <= 80
          ? firstLine
          : `Page ${page.page}`;
      return {
        title,
        page: page.page,
        lineStart: 1,
        lineEnd: countLines(page.text),
        text: page.text,
      };
    });
}

interface Piece {
  text: string;
  /** Lines from the start of the section to the start of this piece. */
  lineOffset: number;
}

/**
 * Split a section into overlapping pieces at paragraph boundaries, falling
 * back to sentence boundaries when a single paragraph is too long.
 *
 * The overlap is what stops a fact that straddles a boundary from becoming
 * unretrievable.
 */
function splitWithOverlap(text: string): Piece[] {
  if (text.trim().length <= CHUNK_TARGET_CHARS) {
    return [{ text, lineOffset: 0 }];
  }

  const units = splitIntoUnits(text);
  const pieces: Piece[] = [];

  let buffer = "";
  let bufferStart = 0;

  const flush = () => {
    if (buffer.trim()) pieces.push({ text: buffer, lineOffset: bufferStart });
    buffer = "";
  };

  for (const unit of units) {
    if (buffer && buffer.length + unit.text.length > CHUNK_TARGET_CHARS) {
      flush();
      // Carry the tail of the previous piece into the next one.
      const tail = pieces[pieces.length - 1]?.text.slice(-CHUNK_OVERLAP_CHARS) ?? "";
      const carry = tail.includes("\n") ? tail.slice(tail.indexOf("\n") + 1) : tail;
      buffer = carry ? `${carry}\n` : "";
      bufferStart = Math.max(0, unit.lineOffset - countLines(buffer) + 1);
    }
    if (!buffer) bufferStart = unit.lineOffset;
    buffer += unit.text;
  }
  flush();

  return pieces;
}

interface Unit {
  text: string;
  lineOffset: number;
}

/** Paragraphs, or sentences when a paragraph exceeds the chunk target. */
function splitIntoUnits(text: string): Unit[] {
  const units: Unit[] = [];
  const lines = text.split("\n");

  let paragraph: string[] = [];
  let paragraphStart = 0;

  const push = () => {
    if (paragraph.length === 0) return;
    const body = `${paragraph.join("\n")}\n\n`;
    if (body.length <= CHUNK_TARGET_CHARS) {
      units.push({ text: body, lineOffset: paragraphStart });
    } else {
      // Long paragraph: break it on sentence ends, keeping the line offset of
      // the paragraph (sentence-level line tracking would be false precision).
      const sentences = body.match(/[^.!?]+[.!?]+[\s]*|[^.!?]+$/g) ?? [body];
      for (const sentence of sentences) {
        units.push({ text: sentence, lineOffset: paragraphStart });
      }
    }
    paragraph = [];
  };

  lines.forEach((line, index) => {
    if (line.trim() === "") {
      push();
      paragraphStart = index + 1;
      return;
    }
    if (paragraph.length === 0) paragraphStart = index;
    paragraph.push(line);
  });
  push();

  return units;
}

function countLines(text: string): number {
  return text.split("\n").length;
}

/**
 * Strip a heading's own numbering ("3 Engagement by format", "3. Methods").
 *
 * The section ordinal is rendered separately as "§3", so leaving the number
 * in the label produces "§3 3 Methods". Only a leading integer is removed —
 * a heading like "2024 in review" keeps its number, since dropping it would
 * change what the heading says.
 */
function cleanHeading(title: string): string {
  const match = /^(\d{1,2})[.)]?\s+(\S.*)$/.exec(title);
  if (!match) return title;
  // A four-digit year, or anything that reads as part of the title, stays.
  return match[2];
}
