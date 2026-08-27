import { DocumentSelect } from "@/components/DocumentSelect";
import { documentMeta } from "@/lib/format";
import type { DocumentSummary } from "@/lib/types";

/** 2. The "Answering from <file>" bar, shown once a document is ready. */
export const DocumentBar = ({
  document,
  documents,
  onSelect,
  onReplace,
  onToggleSource,
  switching,
}: {
  document: DocumentSummary;
  /** Every indexed document — the dropdown's options. */
  documents: DocumentSummary[];
  /** Switch to another document's chat room. */
  onSelect: (documentId: string) => void;
  onReplace: () => void;
  /** Only supplied below the breakpoint, where the source pane is a slide-over. */
  onToggleSource?: () => void;
  /** True while a chat room is being loaded — locks the dropdown. */
  switching?: boolean;
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
          fontSize: 10,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--color-accent)",
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
          color: "var(--color-neutral-600)",
          whiteSpace: "nowrap",
        }}
      >
        {documentMeta(document)}
      </span>
      <span style={{ flex: 1 }} />
      {onToggleSource ? (
        <button
          type="button"
          className="btn btn-ghost"
          style={{ height: 28, fontSize: 12 }}
          onClick={onToggleSource}
        >
          Source
        </button>
      ) : null}
      <button
        type="button"
        className="btn btn-ghost"
        style={{ height: 28, fontSize: 12 }}
        onClick={onReplace}
      >
        Replace
      </button>
    </div>
  );
};
