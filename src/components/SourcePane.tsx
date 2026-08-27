"use client";

import { useEffect, useRef, useState } from "react";
import { Blueprint } from "@/components/Blueprint";
import { DocumentSelect } from "@/components/DocumentSelect";
import { ExcerptModal } from "@/components/ExcerptModal";
import { STORE_LINE } from "@/lib/config";
import { documentMeta, formatBytes, pluralise } from "@/lib/format";
import type {
  ChunkRecord,
  DocumentSummary,
  OutlineSection,
} from "@/lib/types";

export type SourceTab = "outline" | "chunks";

export interface UploadProgress {
  filename: string;
  sizeBytes: number;
  /** Index into the five stages. */
  stage: number;
  label: string;
}

const SKELETONS = [
  ["94%", "78%", "88%"],
  ["86%", "92%", "64%"],
  ["72%", "88%", "80%"],
  ["90%", "68%", "84%"],
];

export const SourcePane = ({
  document,
  documents,
  onSelectDocument,
  switching,
  chunks,
  outline,
  tab,
  onTabChange,
  activeChunkId,
  onFocusChunk,
  upload,
}: {
  document: DocumentSummary | null;
  /** Every indexed document — the same list the header dropdown offers. */
  documents: DocumentSummary[];
  /** Switch to another document's chat room, from the right pane. */
  onSelectDocument: (documentId: string) => void;
  /** True while a chat room is being loaded — locks the dropdown. */
  switching?: boolean;
  chunks: ChunkRecord[];
  outline: OutlineSection[];
  tab: SourceTab;
  onTabChange: (tab: SourceTab) => void;
  activeChunkId: string | null;
  onFocusChunk: (chunkId: string) => void;
  upload: UploadProgress | null;
}) => {
  // The most recently indexed document. Anything else in the list is an
  // earlier upload; this is the one "current" points back to.
  const currentId = documents[0]?.id;
  const viewingPrevious = Boolean(
    document && currentId && document.id !== currentId,
  );
  const scrollRef = useRef<HTMLDivElement>(null);

  // Bring the cited chunk to the top of the pane. Re-runs on tab change too,
  // because a citation click switches tabs and scrolls in one gesture.
  useEffect(() => {
    if (!activeChunkId || tab !== "chunks") return;
    const box = scrollRef.current;
    const target = box?.querySelector<HTMLElement>(`#src-${CSS.escape(activeChunkId)}`);
    if (!box || !target) return;
    box.scrollTop = Math.max(0, target.offsetTop - box.offsetTop - 12);
  }, [activeChunkId, tab, chunks]);

  return (
    <aside
      style={{
        minWidth: 0,
        minHeight: 0,
        height: "100%",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        background: "color-mix(in srgb, var(--color-text) 3%, transparent)",
      }}
    >
      <div
        style={{
          flex: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "var(--space-3) var(--space-4)",
          borderBottom: "1px solid var(--color-divider)",
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--color-accent-700)",
          }}
        >
          Source
        </span>
        {document ? (
          <div className="seg">
            <label className="seg-opt">
              <input
                type="radio"
                name="srctab"
                checked={tab === "outline"}
                onChange={() => onTabChange("outline")}
              />
              <span>Outline</span>
            </label>
            <label className="seg-opt">
              <input
                type="radio"
                name="srctab"
                checked={tab === "chunks"}
                onChange={() => onTabChange("chunks")}
              />
              <span>Excerpts {document.chunkCount}</span>
            </label>
          </div>
        ) : null}
      </div>

      {document ? (
        <div
          style={{
            flex: "none",
            display: "flex",
            alignItems: "center",
            gap: "var(--space-2)",
            padding: "var(--space-2) var(--space-4)",
            borderBottom: "1px solid var(--color-divider)",
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--color-accent-700)",
              flex: "none",
            }}
          >
            Document
          </span>

          {documents.length > 1 ? (
            <DocumentSelect
              documents={documents}
              value={document.id}
              onSelect={onSelectDocument}
              disabled={switching || Boolean(upload)}
              markCurrentId={currentId}
            />
          ) : (
            <span
              style={{
                fontFamily: "var(--font-heading)",
                fontSize: 14,
                minWidth: 0,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {document.filename}
            </span>
          )}

          {viewingPrevious ? (
            <button
              type="button"
              className="btn btn-ghost"
              style={{
                flex: "none",
                marginLeft: "auto",
                height: 24,
                fontSize: 11,
              }}
              onClick={() => currentId && onSelectDocument(currentId)}
              disabled={switching || Boolean(upload)}
              title="Switch back to the most recently added document"
            >
              Back to current
            </button>
          ) : null}
        </div>
      ) : null}

      <div
        ref={scrollRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "var(--space-4)",
        }}
      >
        {upload ? (
          <ParsingPanel upload={upload} />
        ) : !document ? (
          <SourceEmpty />
        ) : tab === "outline" ? (
          <Outline
            document={document}
            outline={outline}
            onJump={(section) => {
              if (section.firstChunkId) onFocusChunk(section.firstChunkId);
            }}
          />
        ) : (
          <Chunks chunks={chunks} activeChunkId={activeChunkId} />
        )}
      </div>

      {document ? (
        <div
          style={{
            flex: "none",
            padding: "var(--space-3) var(--space-4)",
            borderTop: "1px solid var(--color-divider)",
            fontSize: 11,
            color: "var(--color-neutral-600)",
          }}
        >
          {STORE_LINE}
        </div>
      ) : null}
    </aside>
  );
};

/** 5b. Real progress, reported by the indexing stream, not a timer. */
const ParsingPanel = ({ upload }: { upload: UploadProgress }) => {
  const stages = [
    "Uploading file",
    "Reading the text",
    "Splitting into excerpts",
    "Preparing for search",
    "Saving",
  ];
  const percent = Math.round(((upload.stage + 1) / stages.length) * 100);

  return (
    <div>
      <Blueprint
        style={{ padding: "var(--space-4)", marginBottom: "var(--space-6)" }}
      >
        <div style={{ fontFamily: "var(--font-heading)", fontSize: 16 }}>
          {upload.filename}
        </div>
        <div
          style={{ marginTop: 2, fontSize: 11, color: "var(--color-neutral-600)" }}
        >
          {formatBytes(upload.sizeBytes)} · reading
        </div>
        <div
          style={{
            height: 3,
            marginTop: "var(--space-3)",
            background: "var(--color-neutral-300)",
          }}
        >
          <div
            style={{
              height: 3,
              width: `${percent}%`,
              background: "var(--color-accent)",
              transition: "width 220ms linear",
            }}
          />
        </div>
        <div
          style={{
            marginTop: "var(--space-3)",
            display: "flex",
            flexDirection: "column",
            gap: 5,
          }}
        >
          {stages.map((label, index) => (
            <div
              key={label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-2)",
                fontSize: 12,
                color:
                  index <= upload.stage
                    ? "var(--color-text)"
                    : "var(--color-neutral-500)",
              }}
            >
              <span
                style={{
                  width: 5,
                  height: 5,
                  display: "block",
                  background:
                    index < upload.stage
                      ? "var(--color-accent)"
                      : index === upload.stage
                        ? "var(--color-accent-400)"
                        : "var(--color-neutral-300)",
                }}
              />
              <span>{label}</span>
            </div>
          ))}
        </div>
      </Blueprint>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        {SKELETONS.map((group, index) => (
          <div
            key={index}
            style={{ display: "flex", flexDirection: "column", gap: 7 }}
          >
            {group.map((width, barIndex) => (
              <div
                key={barIndex}
                className="shimmer"
                style={{ height: 9, width }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};

/** 5a. Nothing indexed yet. */
const SourceEmpty = () => {
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: "var(--space-8) var(--space-4)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 220,
          height: 130,
          border: "1px solid var(--color-divider)",
          background:
            "repeating-linear-gradient(135deg, transparent 0 7px, color-mix(in srgb, var(--color-text) 6%, transparent) 7px 8px)",
        }}
      />
      <p
        style={{
          margin: "var(--space-4) 0 0",
          fontSize: 12,
          fontFamily: "var(--font-mono)",
          color: "var(--color-neutral-600)",
        }}
      >
        document preview
      </p>
      <p
        style={{
          margin: "var(--space-2) 0 0",
          fontSize: 12,
          color: "var(--color-neutral-600)",
          maxWidth: 220,
        }}
      >
        Sections and excerpts appear here once you add a file.
      </p>
    </div>
  );
};

/** 5c. */
const Outline = ({
  document,
  outline,
  onJump,
}: {
  document: DocumentSummary;
  outline: OutlineSection[];
  onJump: (section: OutlineSection) => void;
}) => {
  return (
    <div>
      <div
        style={{
          marginBottom: "var(--space-4)",
          fontSize: 12,
          color: "var(--color-neutral-700)",
        }}
      >
        {document.filename} · {documentMeta(document)}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        {outline.map((section) => (
          <button
            key={section.ordinal}
            type="button"
            className="outline-btn"
            onClick={() => onJump(section)}
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: "var(--space-3)",
              width: "100%",
              padding: "var(--space-3)",
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
                fontSize: 12,
                color: "var(--color-accent)",
                minWidth: 16,
              }}
            >
              {section.ordinal}
            </span>
            <span style={{ flex: 1 }}>
              <span style={{ display: "block", fontSize: 14 }}>{section.title}</span>
              <span
                style={{
                  display: "block",
                  marginTop: 2,
                  fontSize: 11,
                  color: "var(--color-neutral-600)",
                }}
              >
                {[section.range, pluralise(section.chunkCount, "excerpt")]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};

/**
 * 5d. The exact excerpts and where they sit in the document are shown on
 * purpose: seeing the source text is what makes the answers credible, so it
 * is inspectable rather than hidden.
 */
/** "Section 4 · page 1" or "Section 2 · lines 44–52" — the excerpt's locus. */
const excerptLocus = (chunk: ChunkRecord): string => {
  const parts = [`Section ${chunk.sectionOrdinal}`];
  if (chunk.page !== null) parts.push(`page ${chunk.page}`);
  else if (chunk.lineStart !== null && chunk.lineEnd !== null) {
    parts.push(`lines ${chunk.lineStart}–${chunk.lineEnd}`);
  }
  return parts.join(" · ");
};

const Chunks = ({
  chunks,
  activeChunkId,
}: {
  chunks: ChunkRecord[];
  activeChunkId: string | null;
}) => {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = chunks.find((chunk) => chunk.id === openId) ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      {chunks.map((chunk) => {
        const isActive = chunk.id === activeChunkId;
        const title = chunk.sectionLabel || `Excerpt ${chunk.ordinal + 1}`;
        return (
          <button
            key={chunk.id}
            id={`src-${chunk.id}`}
            type="button"
            className="outline-btn"
            onClick={() => setOpenId(chunk.id)}
            aria-haspopup="dialog"
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              font: "inherit",
              color: "inherit",
              cursor: "pointer",
              padding: "var(--space-3)",
              border: `1px solid ${
                isActive ? "var(--color-accent)" : "var(--color-divider)"
              }`,
              background: isActive
                ? "color-mix(in srgb, var(--color-accent) 12%, transparent)"
                : "transparent",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: "var(--space-2)",
              }}
            >
              <span style={{ fontSize: 14, lineHeight: 1.3 }}>{title}</span>
              <span
                style={{
                  flexShrink: 0,
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  color: "var(--color-neutral-600)",
                }}
              >
                {chunk.label}
              </span>
            </div>
            <div style={{ marginTop: 2, fontSize: 11, color: "var(--color-neutral-600)" }}>
              {[chunk.where, pluralise(chunk.tokenCount, "token")]
                .filter(Boolean)
                .join(" · ")}
            </div>
            <p
              style={{
                margin: "var(--space-2) 0 0",
                fontSize: 13,
                lineHeight: 1.55,
                display: "-webkit-box",
                WebkitLineClamp: 3,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {chunk.text}
            </p>
          </button>
        );
      })}

      {open ? (
        <ExcerptModal
          badge={open.ordinal + 1}
          kind="Excerpt"
          title={open.sectionLabel || `Excerpt ${open.ordinal + 1}`}
          trail={excerptLocus(open)}
          excerpt={open.text}
          onClose={() => setOpenId(null)}
        />
      ) : null}
    </div>
  );
};
