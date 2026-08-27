import { documentMeta } from "@/lib/format";
import type { DocumentSummary } from "@/lib/types";

/** 2. The "Grounded in <file>" bar, shown once a document is indexed. */
export function DocumentBar({
  document,
  onReplace,
  onToggleSource,
}: {
  document: DocumentSummary;
  onReplace: () => void;
  /** Only supplied below the breakpoint, where the source pane is a slide-over. */
  onToggleSource?: () => void;
}) {
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
        Grounded in
      </span>
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
}
