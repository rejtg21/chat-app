"use client";

import { Fragment, useState, type ReactNode } from "react";

import { ExcerptModal } from "@/components/ExcerptModal";
import { StructuredBlock } from "@/components/structured/StructuredBlock";
import { retrievalLabel } from "@/lib/format";
import type { Citation, MessageUiState, RetrievalMeta } from "@/lib/types";

/**
 * 3f/3g. A streamed answer, its structured component and its citations.
 *
 * The component and the citation block mount only once streaming has
 * finished — that is the specified behaviour, and it is also the honest one:
 * a half-streamed answer has not finished saying what it cites.
 */
export const AnswerMessage = ({
  text,
  streaming,
  retrieval,
  citations,
  structured,
  uiState,
  time,
  onToggleChecklistItem,
  onToggleEvidenceCard,
  onFocusChunk,
}: {
  text: string;
  streaming: boolean;
  retrieval: RetrievalMeta | null;
  citations: Citation[];
  structured: unknown;
  uiState: MessageUiState;
  time?: string;
  onToggleChecklistItem: (index: number) => void;
  onToggleEvidenceCard: (index: number) => void;
  onFocusChunk: (chunkId: string) => void;
}) => {
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-2)",
          marginBottom: "var(--space-3)",
          fontSize: 10,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--color-neutral-600)",
        }}
      >
        <span>Answer</span>
        <span style={{ height: 1, width: 26, background: "var(--color-divider)" }} />
        <span>{retrieval ? retrievalLabel(retrieval) : "searching"}</span>
        {time ? (
          <>
            <span
              style={{ height: 1, width: 26, background: "var(--color-divider)" }}
            />
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{time}</span>
          </>
        ) : null}
      </div>

      <div style={{ fontSize: 15, lineHeight: 1.62 }}>
        <AnswerBody text={text} streaming={streaming} />
      </div>

      {!streaming ? (
        <StructuredBlock
          payload={structured}
          uiState={uiState}
          onToggleChecklistItem={onToggleChecklistItem}
          onToggleEvidenceCard={onToggleEvidenceCard}
          onOpenInSource={onFocusChunk}
        />
      ) : null}

      {!streaming && citations.length > 0 ? (
        <Citations citations={citations} onFocusChunk={onFocusChunk} />
      ) : null}
    </div>
  );
};

/**
 * The answer arrives as light Markdown. While it streams we keep the cheap
 * line-per-paragraph rendering (a half-streamed table is just broken pipes);
 * once it settles we parse GFM tables into real <table>s and give paragraphs
 * inline emphasis. Anything we don't recognise falls through as plain text.
 */
const AnswerBody = ({ text, streaming }: { text: string; streaming: boolean }) => {
  if (streaming) {
    const lines = text.split("\n").filter((line) => line.trim().length > 0);
    return (
      <>
        {lines.map((line, index) => (
          <p key={index} style={{ margin: "0 0 var(--space-3)" }}>
            {line}
            {/* The caret rides the last line so it follows the text
                rather than sitting on its own. */}
            {index === lines.length - 1 ? <Caret /> : null}
          </p>
        ))}
        {lines.length === 0 ? <Caret /> : null}
      </>
    );
  }

  const blocks = parseBlocks(text);
  return (
    <>
      {blocks.map((block, index) =>
        block.kind === "table" ? (
          <MarkdownTable key={index} block={block} />
        ) : (
          <Fragment key={index}>
            {block.text.split("\n").map((line, lineIndex) => (
              <p key={lineIndex} style={{ margin: "0 0 var(--space-3)" }}>
                {renderInline(line)}
              </p>
            ))}
          </Fragment>
        ),
      )}
    </>
  );
};

type Block =
  | { kind: "text"; text: string }
  | { kind: "table"; header: string[]; align: Align[]; rows: string[][] };

type Align = "left" | "right" | "center";

const DELIMITER_ROW = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/;

/** Split a cell row on unescaped pipes, dropping the outer border pipes. */
const splitRow = (line: string): string[] => {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed
    .split(/(?<!\\)\|/)
    .map((cell) => cell.replace(/\\\|/g, "|").trim());
};

const readAlign = (spec: string): Align => {
  const s = spec.trim();
  const left = s.startsWith(":");
  const right = s.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  return "left";
};

const parseBlocks = (text: string): Block[] => {
  const lines = text.split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    const joined = paragraph.join("\n").trim();
    if (joined.length > 0) blocks.push({ kind: "text", text: joined });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const next = lines[i + 1];
    const looksLikeTable =
      line.includes("|") && next !== undefined && DELIMITER_ROW.test(next);

    if (looksLikeTable) {
      flushParagraph();
      const header = splitRow(line);
      const align = splitRow(next).map(readAlign);
      const rows: string[][] = [];
      i += 1;
      while (i + 1 < lines.length && lines[i + 1].includes("|")) {
        i += 1;
        rows.push(splitRow(lines[i]));
      }
      blocks.push({ kind: "table", header, align, rows });
      continue;
    }

    if (line.trim().length === 0) {
      flushParagraph();
    } else {
      paragraph.push(line);
    }
  }
  flushParagraph();
  return blocks;
};

const MarkdownTable = ({ block }: { block: Extract<Block, { kind: "table" }> }) => {
  return (
    <div style={{ overflowX: "auto", margin: "0 0 var(--space-3)" }}>
      <table className="table">
        <thead>
          <tr>
            {block.header.map((cell, index) => (
              <th
                key={index}
                scope="col"
                style={{ textAlign: block.align[index] ?? "left" }}
              >
                {renderInline(cell)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {block.header.map((_, cellIndex) => (
                <td
                  key={cellIndex}
                  style={{ textAlign: block.align[cellIndex] ?? "left" }}
                >
                  {renderInline(row[cellIndex] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|(?<![*\w])\*[^*\n]+\*(?!\w)|_[^_\n]+_)/g;

/** Bold, italic and inline code — the emphasis the model actually reaches for. */
const renderInline = (text: string): ReactNode => {
  const parts = text.split(INLINE).filter((part) => part.length > 0);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={index}
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "0.9em",
            padding: "0.1em 0.3em",
            background: "color-mix(in srgb, var(--color-text) 7%, transparent)",
            borderRadius: 3,
          }}
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    if (
      (part.startsWith("*") && part.endsWith("*")) ||
      (part.startsWith("_") && part.endsWith("_"))
    ) {
      return <em key={index}>{part.slice(1, -1)}</em>;
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
};

const Caret = () => {
  return (
    <span
      className="blink"
      style={{
        display: "inline-block",
        width: 8,
        height: 16,
        background: "var(--color-accent)",
        verticalAlign: -3,
        marginLeft: 2,
      }}
    />
  );
};

/**
 * Citations render as a compact numbered link list so the answer keeps the
 * reader's focus. The evidence — location and excerpt — moves into a modal
 * that opens on click, with a jump into the source pane from there.
 */
const Citations = ({
  citations,
  onFocusChunk,
}: {
  citations: Citation[];
  onFocusChunk: (chunkId: string) => void;
}) => {
  const [openN, setOpenN] = useState<number | null>(null);
  const active = citations.find((citation) => citation.n === openN) ?? null;

  return (
    <div
      style={{
        marginTop: "var(--space-6)",
        paddingTop: "var(--space-3)",
        borderTop: "1px solid var(--color-divider)",
        display: "flex",
        alignItems: "baseline",
        flexWrap: "wrap",
        gap: "var(--space-2)",
      }}
    >
      <span
        style={{
          fontSize: 10,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--color-neutral-600)",
        }}
      >
        Citations
      </span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
        {citations.map((citation) => (
          <button
            key={citation.n}
            type="button"
            className="citation-btn"
            onClick={() => setOpenN(citation.n)}
            aria-haspopup="dialog"
            title={citation.where}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--space-1)",
              padding: "2px var(--space-2)",
              background: "transparent",
              border: "1px solid var(--color-divider)",
              font: "inherit",
              cursor: "pointer",
              color: "inherit",
              lineHeight: 1.4,
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-heading)",
                fontSize: 12,
                color: "var(--color-accent)",
              }}
            >
              {citation.n}
            </span>
            <span
              style={{
                fontSize: 12,
                color: "var(--color-neutral-700)",
                maxWidth: 220,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {citation.where}
            </span>
          </button>
        ))}
      </div>

      {active ? (
        <ExcerptModal
          badge={active.n}
          kind="Citation"
          {...splitWhere(active.where)}
          excerpt={active.excerpt}
          onClose={() => setOpenN(null)}
          onOpenInSource={() => {
            onFocusChunk(active.chunkId);
            setOpenN(null);
          }}
        />
      ) : null}
    </div>
  );
};

/** "report.md · §3 Engagement by format · L44–52" → title + trailing detail. */
const splitWhere = (where: string): { title: string; trail?: string } => {
  const [title, ...rest] = where.split(" · ");
  return { title, trail: rest.length > 0 ? rest.join(" · ") : undefined };
};
