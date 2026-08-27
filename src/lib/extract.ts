import { extractText, getDocumentProxy } from "unpdf";
import { ACCEPTED_EXTENSIONS } from "@/lib/config";
import { ApiError, unsupportedFileError } from "@/lib/errors";
import type { DocumentKind } from "@/lib/types";

/**
 * Server-side text extraction.
 *
 * PDFs go through unpdf (a pdf.js build packaged for serverless); TXT and
 * Markdown are read as UTF-8. Either way the result is a list of *pages*: a
 * PDF page each, or one synthetic page for a text file. Downstream, chunking
 * turns pages into sections and records where each chunk came from, which is
 * what lets a citation name a real location.
 */

export interface ExtractedPage {
  /** 1-based, and null for text files, which cite line numbers instead. */
  page: number | null;
  text: string;
}

export interface Extraction {
  kind: DocumentKind;
  pages: ExtractedPage[];
  /** Whole-document text, used for line numbering on text files. */
  text: string;
  pageCount: number | null;
  lineCount: number | null;
}

/** Lowercased extension without the dot, or "" when there isn't one. */
export const extensionOf = (filename: string): string => {
  const match = /\.([A-Za-z0-9]+)$/.exec(filename);
  return match ? match[1].toLowerCase() : "";
};

export const isAcceptedExtension = (extension: string): boolean => {
  return (ACCEPTED_EXTENSIONS as readonly string[]).includes(extension);
};

/** Map an accepted extension onto the stored document kind. */
export const kindForExtension = (extension: string): DocumentKind => {
  switch (extension) {
    case "pdf":
      return "pdf";
    case "txt":
      return "txt";
    case "md":
    case "markdown":
      return "md";
    default:
      throw new ApiError(
        "ERR_UNSUPPORTED_TYPE",
        "This app reads PDF, TXT and Markdown.",
        { detail: `unrecognised extension: ${extension || "none"}` },
      );
  }
};

/**
 * Extract text from an uploaded file. Throws ApiError with
 * ERR_UNSUPPORTED_TYPE for anything that is not PDF/TXT/MD — the UI renders
 * that as the "Unsupported file" card, and nothing is written to the database.
 */
export const extractDocument = async (
  filename: string,
  bytes: ArrayBuffer,
): Promise<Extraction> => {
  const extension = extensionOf(filename);
  if (!isAcceptedExtension(extension)) {
    throw unsupportedFileError(filename, extension);
  }

  const kind = kindForExtension(extension);
  return kind === "pdf" ? extractPdf(bytes) : extractPlainText(bytes, kind);
};

const extractPdf = async (bytes: ArrayBuffer): Promise<Extraction> => {
  let pageTexts: string[];
  let totalPages: number;

  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const result = await extractText(pdf, { mergePages: false });
    // unpdf types `text` as string | string[] depending on mergePages.
    pageTexts = Array.isArray(result.text) ? result.text : [result.text];
    totalPages = result.totalPages;
  } catch (cause) {
    throw new ApiError("ERR_PARSE_FAILED", "The PDF could not be read.", {
      detail: cause instanceof Error ? cause.message : String(cause),
      cause,
    });
  }

  const pages: ExtractedPage[] = pageTexts.map((text, index) => ({
    page: index + 1,
    text: normalise(text),
  }));

  const text = pages.map((page) => page.text).join("\n\n");
  if (!text.trim()) {
    throw new ApiError(
      "ERR_EMPTY_DOCUMENT",
      "That PDF has no extractable text. It may be a scan without OCR.",
      { detail: `${totalPages} pages, no text layer` },
    );
  }

  return { kind: "pdf", pages, text, pageCount: totalPages, lineCount: null };
};

const extractPlainText = (bytes: ArrayBuffer, kind: DocumentKind): Extraction => {
  const raw = new TextDecoder("utf-8").decode(bytes);
  const text = normalise(raw);

  if (!text.trim()) {
    throw new ApiError("ERR_EMPTY_DOCUMENT", "That file is empty.", {
      detail: "no text content",
    });
  }

  return {
    kind,
    pages: [{ page: null, text }],
    text,
    pageCount: null,
    lineCount: text.split("\n").length,
  };
};

/** Normalise newlines and strip the BOM, leaving blank-line structure intact. */
const normalise = (text: string): string => {
  return text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
};
