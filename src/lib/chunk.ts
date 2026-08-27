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
 * Sections come from Markdown ATX headings where they exist. For a PDF they
 * come from heading-like lines found within each page, with the rest of the
 * page kept under a "Page N" section so the outline always has a per-page
 * anchor. A flat text file falls back to a single section.
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
export const estimateTokens = (text: string): number => {
  return Math.max(1, Math.round(text.trim().length / 4));
};

export const chunkDocument = (extraction: Extraction): ChunkingResult => {
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
};

/** Markdown/text: split on ATX headings, keeping absolute line numbers. */
const sectionsFromHeadings = (text: string): RawSection[] => {
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
};

/**
 * PDF: sections are the heading-like lines found within each page, with the
 * page's remaining text kept under a section of its own. Every section keeps
 * its page number, so a citation still resolves to "p.3" however the page was
 * carved up.
 *
 * The first section of every page is always labelled "Page N - <title>", so
 * the Outline keeps a per-page anchor even once headings are pulled out;
 * later sections on the same page are labelled by their heading alone.
 *
 * PDF text arrives with no blank lines and often letter-spaced ("P R O F I L
 * E") or column-shuffled. A line is taken as a heading when it both reads
 * like one (short, capitalised, no sentence punctuation) and is set apart —
 * either it was letter-spaced (a deliberate display style) or it is isolated
 * by blank lines. Letter-spacing with no wider gap between words mashes the
 * words together, so the label is re-segmented against a small heading
 * vocabulary and folded back to title case.
 */
const sectionsFromPages = (extraction: Extraction): RawSection[] => {
  const sections: RawSection[] = [];

  extraction.pages
    .filter((page) => page.text.trim().length > 0)
    .forEach((page, pageIndex) => {
      const pageNo = page.page ?? pageIndex + 1;
      const lines = page.text.split("\n");
      const despaced = lines.map(despace);
      const spacedCount = despaced.filter((line) => line.spaced).length;
      const pageTitle = derivePageTitle(despaced);

      const headingRows = despaced.reduce<number[]>((rows, line, index) => {
        if (!looksLikeHeading(line.text)) return rows;
        const setApart = line.spaced
          ? spacedCount >= 1
          : (index === 0 || despaced[index - 1].text === "") ||
            (index === despaced.length - 1 || despaced[index + 1].text === "");
        if (setApart) rows.push(index);
        return rows;
      }, []);

      const bounds: { title: string; start: number; end: number }[] = [];
      if (headingRows.length === 0 || headingRows[0] > 0) {
        bounds.push({ title: "", start: 0, end: headingRows[0] ?? lines.length });
      }
      headingRows.forEach((row, index) => {
        bounds.push({
          title: prettifyHeading(despaced[row].text),
          // Drop the heading line itself; it is kept as the section label.
          start: row + 1,
          end: headingRows[index + 1] ?? lines.length,
        });
      });

      let firstOnPage = true;
      for (const bound of bounds) {
        const text = lines.slice(bound.start, bound.end).join("\n");
        if (text.trim().length === 0) continue;
        // The first section on a page is always the "Page N" anchor, titled
        // from the page's opening line rather than its first inner heading.
        const title = firstOnPage ? pageTitle || bound.title : bound.title;
        const label = firstOnPage
          ? title
            ? `Page ${pageNo} - ${title}`
            : `Page ${pageNo}`
          : bound.title;
        firstOnPage = false;
        sections.push({
          title: label,
          page: pageNo,
          lineStart: 1,
          lineEnd: countLines(text),
          text,
        });
      }
    });

  return sections.filter((section) => section.text.trim().length > 0);
};

interface DespacedLine {
  /** Trimmed, and de-letter-spaced when the source line was letter-spaced. */
  text: string;
  /** The source line was letter-spaced ("P R O F I L E"). */
  spaced: boolean;
}

/**
 * "R E J   M E D I O D I A" → { text: "REJ MEDIODIA", spaced: true }. A run of
 * single characters is one word; a wider gap is a word break. Lines that are
 * not letter-spaced come back trimmed and otherwise untouched.
 */
const despace = (line: string): DespacedLine => {
  const tokens = line.split(" ");
  const present = tokens.filter((token) => token.length > 0);
  const singles = present.filter((token) => token.length === 1);
  if (present.length < 4 || singles.length / present.length < 0.7) {
    return { text: line.trim(), spaced: false };
  }

  const words: string[] = [];
  let word = "";
  for (const token of tokens) {
    if (token === "") {
      if (word) words.push(word);
      word = "";
    } else if (token.length === 1) {
      word += token;
    } else {
      if (word) words.push(word);
      words.push(token);
      word = "";
    }
  }
  if (word) words.push(word);
  return { text: words.join(" ").trim(), spaced: true };
};

const HEADING_FILLER = /^(a|an|and|as|at|by|for|from|in|of|on|or|the|to|with)$/i;

/**
 * Whether a line reads as a section heading: short, no trailing sentence
 * punctuation, not a date range, and either all caps or mostly capitalised
 * words. Runs against the de-spaced copy of the line.
 */
const looksLikeHeading = (line: string): boolean => {
  const text = line.trim();
  if (text.length < 2 || text.length > 60) return false;
  if (/[.,;:!?]$/.test(text)) return false;
  // "NOV 2017 - OCT 2018", "2010 – 2014": a number with a dash is a range.
  if (/\d/.test(text) && /[-–—]/.test(text)) return false;

  const letters = text.replace(/[^A-Za-z]/g, "");
  if (letters.length < 2) return false;

  const words = text.split(/\s+/);
  if (words.length > 8) return false;

  if (letters === letters.toUpperCase()) return true;

  const capitalised = words.filter(
    (word) => /^[A-Z]/.test(word) || HEADING_FILLER.test(word),
  ).length;
  return capitalised / words.length >= 0.75;
};

/**
 * The vocabulary that actually turns up in document section headings, longest
 * first so a greedy match prefers "STACKS" over "STACK". Used only to put the
 * spaces back into a mashed-together letter-spaced heading.
 */
const HEADING_WORDS = [
  "CERTIFICATIONS", "CERTIFICATION", "QUALIFICATIONS", "RESPONSIBILITIES",
  "ACCOMPLISHMENTS", "PROFESSIONAL", "ACHIEVEMENTS", "COMPETENCIES",
  "PUBLICATIONS", "INTRODUCTION", "ENGAGEMENTS", "EXPERIENCE", "INFORMATION",
  "BACKGROUND", "TECHNOLOGY", "REFERENCES", "HIGHLIGHTS", "ADDITIONAL",
  "EMPLOYMENT", "ACTIVITIES", "CONCLUSION", "TECHNICAL", "EDUCATION",
  "LANGUAGES", "INTERESTS", "OBJECTIVE", "EXPERTISE", "VOLUNTEER", "PORTFOLIO",
  "AWARDS", "SKILLS", "STACKS", "OTHERS", "SUMMARY", "PROFILE", "CONTACT",
  "OFFICER", "PROJECTS", "OVERVIEW", "METHODS", "RESULTS", "ABSTRACT",
  "FINDINGS", "STACK", "ABOUT", "TOOLS", "WORK", "CORE", "KEY", "CHIEF",
  "SENIOR", "LEAD", "AND",
];

/** "PROFILESUMMARY" → "PROFILE SUMMARY"; anything not fully recognised is left as-is. */
const resegment = (blob: string): string => {
  if (blob.includes(" ") || !/^[A-Za-z]{4,}$/.test(blob)) return blob;
  const upper = blob.toUpperCase();
  const out: string[] = [];
  let cursor = 0;
  while (cursor < upper.length) {
    const word = HEADING_WORDS.find((candidate) => upper.startsWith(candidate, cursor));
    // A partial split reads worse than the mashed original — bail on any miss.
    if (!word) return blob;
    out.push(word);
    cursor += word.length;
  }
  return out.join(" ");
};

/**
 * "WORK EXPERIENCE" / "PROFILESUMMARY" → "Work Experience" / "Profile Summary".
 * Mixed-case text is left alone, so an already-cased heading or a term like
 * "iOS" survives untouched.
 */
const prettifyHeading = (text: string): string => {
  const segmented = resegment(text);
  const letters = segmented.replace(/[^A-Za-z]/g, "");
  if (letters.length < 2 || letters !== letters.toUpperCase()) return segmented;
  return segmented.replace(
    /[A-Za-z][A-Za-z']*/g,
    (word) => word[0] + word.slice(1).toLowerCase(),
  );
};

/** First line of a page that is not blank, a bare number or a date range. */
const derivePageTitle = (despaced: DespacedLine[]): string => {
  const candidate = despaced
    .map((line) => line.text)
    .find(
      (text) =>
        text.length > 1 &&
        /[A-Za-z]/.test(text) &&
        !/^\d/.test(text) &&
        !(/\d/.test(text) && /[-–—]/.test(text)),
    );
  if (!candidate) return "";
  return prettifyHeading(candidate).slice(0, 60);
};

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
const splitWithOverlap = (text: string): Piece[] => {
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
};

interface Unit {
  text: string;
  lineOffset: number;
}

/** Paragraphs, or sentences when a paragraph exceeds the chunk target. */
const splitIntoUnits = (text: string): Unit[] => {
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
};

const countLines = (text: string): number => {
  return text.split("\n").length;
};

/**
 * Strip a heading's own numbering ("3 Engagement by format", "3. Methods").
 *
 * The section ordinal is rendered separately as "§3", so leaving the number
 * in the label produces "§3 3 Methods". Only a leading integer is removed —
 * a heading like "2024 in review" keeps its number, since dropping it would
 * change what the heading says.
 */
const cleanHeading = (title: string): string => {
  const match = /^(\d{1,2})[.)]?\s+(\S.*)$/.exec(title);
  if (!match) return title;
  // A four-digit year, or anything that reads as part of the title, stays.
  return match[2];
};
