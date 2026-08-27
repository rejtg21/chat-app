"use client";

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
export function AnswerMessage({
  text,
  streaming,
  retrieval,
  citations,
  structured,
  uiState,
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
  onToggleChecklistItem: (index: number) => void;
  onToggleEvidenceCard: (index: number) => void;
  onFocusChunk: (chunkId: string) => void;
}) {
  const paragraphs = text.split("\n").filter((line) => line.trim().length > 0);

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
        <span>{retrieval ? retrievalLabel(retrieval) : "retrieving"}</span>
      </div>

      <div style={{ fontSize: 15, lineHeight: 1.62 }}>
        {paragraphs.map((paragraph, index) => (
          <p key={index} style={{ margin: "0 0 var(--space-3)" }}>
            {paragraph}
            {/* The caret rides the last paragraph so it follows the text
                rather than sitting on its own line. */}
            {streaming && index === paragraphs.length - 1 ? <Caret /> : null}
          </p>
        ))}
        {streaming && paragraphs.length === 0 ? <Caret /> : null}
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
}

function Caret() {
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
}

/**
 * Excerpts are shown in full rather than behind a tooltip. Verifiability is
 * the product here, so the evidence is visible by default.
 */
function Citations({
  citations,
  onFocusChunk,
}: {
  citations: Citation[];
  onFocusChunk: (chunkId: string) => void;
}) {
  return (
    <div
      style={{
        marginTop: "var(--space-6)",
        paddingTop: "var(--space-3)",
        borderTop: "1px solid var(--color-divider)",
      }}
    >
      <div
        style={{
          fontSize: 10,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--color-neutral-600)",
          marginBottom: "var(--space-3)",
        }}
      >
        Citations
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        {citations.map((citation) => (
          <button
            key={citation.n}
            type="button"
            className="citation-btn"
            onClick={() => onFocusChunk(citation.chunkId)}
            style={{
              display: "grid",
              gridTemplateColumns: "22px 1fr",
              gap: "var(--space-3)",
              width: "100%",
              padding: "var(--space-2) var(--space-3)",
              background: "transparent",
              border: "1px solid var(--color-divider)",
              font: "inherit",
              textAlign: "left",
              cursor: "pointer",
              color: "inherit",
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-heading)",
                fontSize: 13,
                color: "var(--color-accent)",
              }}
            >
              {citation.n}
            </span>
            <span>
              <span
                style={{
                  display: "block",
                  fontSize: 12,
                  color: "var(--color-neutral-700)",
                }}
              >
                {citation.where}
              </span>
              <span style={{ display: "block", marginTop: 2, fontSize: 13, lineHeight: 1.5 }}>
                {`“${citation.excerpt}”`}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
