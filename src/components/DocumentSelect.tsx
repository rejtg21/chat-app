"use client";

import { ChevronDown } from "lucide-react";
import { formatBytes, kindLabel } from "@/lib/format";
import type { DocumentSummary } from "@/lib/types";

/**
 * The document dropdown in the "Answering from" bar.
 *
 * Each document is its own chat room, so switching the value here swaps the
 * whole conversation — the parent refetches that document's session
 * (excerpts, outline, every stored message).
 *
 * A native <select> rather than a custom menu: it stays keyboard- and
 * screen-reader-correct for free, and the list is short.
 */
export const DocumentSelect = ({
  documents,
  value,
  onSelect,
  disabled,
}: {
  documents: DocumentSummary[];
  value: string;
  onSelect: (documentId: string) => void;
  disabled?: boolean;
}) => {
  return (
    <span
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        minWidth: 0,
        maxWidth: "min(46vw, 420px)",
      }}
    >
      <select
        value={value}
        disabled={disabled}
        aria-label="Choose a document to chat with"
        onChange={(event) => onSelect(event.target.value)}
        style={{
          appearance: "none",
          WebkitAppearance: "none",
          MozAppearance: "none",
          maxWidth: "100%",
          padding: "2px 22px 2px 0",
          border: 0,
          background: "transparent",
          font: "inherit",
          fontFamily: "var(--font-heading)",
          fontSize: 16,
          color: "inherit",
          cursor: disabled ? "default" : "pointer",
          outline: "none",
          textOverflow: "ellipsis",
        }}
      >
        {documents.map((document) => (
          <option key={document.id} value={document.id}>
            {document.filename}
            {"  ·  "}
            {kindLabel(document.kind)} · {formatBytes(document.sizeBytes)}
          </option>
        ))}
      </select>
      <ChevronDown
        size={14}
        strokeWidth={1.5}
        aria-hidden
        style={{
          position: "absolute",
          right: 4,
          pointerEvents: "none",
          color: "var(--color-neutral-600)",
        }}
      />
    </span>
  );
};
