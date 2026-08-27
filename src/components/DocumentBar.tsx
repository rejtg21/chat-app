import { Plus, Trash2 } from "lucide-react";
import { DocumentSelect } from "@/components/DocumentSelect";
import { documentMeta } from "@/lib/format";
import type { DocumentSummary } from "@/lib/types";

/** 2. The "Answering from <file>" bar, shown once a document is ready. */
export const DocumentBar = ({
  document,
  documents,
  onSelect,
  onAddDocument,
  onRemove,
  onToggleSource,
  switching,
  removing,
}: {
  document: DocumentSummary;
  /** Every indexed document — the dropdown's options. */
  documents: DocumentSummary[];
  /** Switch to another document's chat room. */
  onSelect: (documentId: string) => void;
  /** Open the file picker to add another document. */
  onAddDocument: () => void;
  /** Delete this document and its conversation from the database. */
  onRemove: () => void;
  /** Only supplied below the breakpoint, where the source pane is a slide-over. */
  onToggleSource?: () => void;
  /** True while a chat room is being loaded — locks the dropdown. */
  switching?: boolean;
  /** True while the delete request is in flight. */
  removing?: boolean;
}) => {
  // With a single document there is nothing to choose between, so the name
  // stays a plain label rather than a one-option menu.
  const hasChoice = documents.length > 1;

  return (
    <div
      style={{
        flex: "none",
        display: "flex",
        alignItems: "center",
        gap: "var(--space-3)",
        padding: "var(--space-3) var(--space-6)",
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
        Answering from
      </span>
      {hasChoice ? (
        <DocumentSelect
          documents={documents}
          value={document.id}
          onSelect={onSelect}
          disabled={switching}
          markCurrentId={documents[0]?.id}
        />
      ) : (
        <span
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 16,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {document.filename}
        </span>
      )}
      <span
        style={{
          fontSize: 11,
          color: "var(--color-neutral-700)",
          whiteSpace: "nowrap",
        }}
      >
        {documentMeta(document)}
      </span>
      <span style={{ flex: 1 }} />
      {onToggleSource ? (
        <button
          type="button"
          className="btn btn-secondary"
          style={{ height: 30, fontSize: 13 }}
          onClick={onToggleSource}
        >
          Source
        </button>
      ) : null}
      <button
        type="button"
        className="btn btn-secondary"
        style={{ height: 30, fontSize: 13, gap: 6 }}
        onClick={onAddDocument}
        disabled={removing}
      >
        <Plus size={15} strokeWidth={1.6} aria-hidden />
        New document
      </button>
      <button
        type="button"
        className="btn btn-danger"
        style={{ height: 30, fontSize: 13, gap: 6 }}
        onClick={onRemove}
        disabled={removing}
        title="Delete this document and its conversation"
      >
        <Trash2 size={14} strokeWidth={1.6} aria-hidden />
        {removing ? "Removing…" : "Remove"}
      </button>
    </div>
  );
};
