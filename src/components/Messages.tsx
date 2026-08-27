import { Blueprint } from "@/components/Blueprint";

/** 3c. The user's question — right-aligned, on the accent's deepest step. */
export const UserMessage = ({ text }: { text: string }) => {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end" }}>
      <div
        style={{
          maxWidth: "78%",
          padding: "var(--space-3) var(--space-4)",
          background: "var(--color-accent-900)",
          color: "var(--color-bg)",
          fontSize: 14,
          lineHeight: 1.5,
          whiteSpace: "pre-wrap",
        }}
      >
        {text}
      </div>
    </div>
  );
};

/** 3d. The rule-and-caps note that marks the end of indexing. */
export const SystemNote = ({ text }: { text: string }) => {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-3)",
        fontSize: 11,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: "var(--color-neutral-600)",
      }}
    >
      <span style={{ height: 1, flex: 1, background: "var(--color-divider)" }} />
      <span>{text}</span>
      <span style={{ height: 1, flex: 1, background: "var(--color-divider)" }} />
    </div>
  );
};

/**
 * 3d-bis. The app speaking for itself. Written when an error is worth the
 * reader knowing about after the fact — a failed document switch, a retrieval
 * failure, a rejected upload — and persisted with the thread so it survives a
 * reload. Distinct from `SystemNote`, which is a quiet divider; this is a
 * flagged entry with the accent rule down its edge.
 */
export const SystemMessage = ({ text }: { text: string }) => {
  return (
    <div
      style={{
        borderLeft: "2px solid var(--color-accent-700)",
        background: "var(--color-neutral-100)",
        padding: "var(--space-3) var(--space-4)",
      }}
    >
      <div
        style={{
          fontSize: 10,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--color-accent-700)",
          marginBottom: "var(--space-1)",
        }}
      >
        System
      </div>
      <p
        style={{
          margin: 0,
          fontSize: 13,
          lineHeight: 1.5,
          color: "var(--color-neutral-700)",
          whiteSpace: "pre-wrap",
        }}
      >
        {text}
      </p>
    </div>
  );
};

/** 3e. Shown while the document search runs, before any of the answer arrives. */
export const RetrievalShimmer = () => {
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
        <span
          className="blink"
          style={{
            width: 5,
            height: 5,
            background: "var(--color-accent)",
            display: "block",
          }}
        />
        <span>Searching the document</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {["96%", "88%", "62%"].map((width) => (
          <div key={width} className="shimmer" style={{ height: 11, width }} />
        ))}
      </div>
    </div>
  );
};

/**
 * 3h. Both designed error cards.
 *
 * The copy is deliberate: a retrieval failure says the document and the
 * conversation are safe, because the user's first fear is that they lost
 * their upload.
 */
export const ErrorCard = ({
  kind,
  message,
  code,
  actionLabel,
  onAction,
}: {
  kind: string;
  message: string;
  code: string;
  actionLabel: string;
  onAction: () => void;
}) => {
  return (
    <Blueprint
      style={{
        padding: "var(--space-4)",
        borderColor: "var(--color-accent-700)",
      }}
    >
      <div
        style={{
          fontSize: 10,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--color-accent-700)",
          marginBottom: "var(--space-2)",
        }}
      >
        {kind}
      </div>
      <p style={{ margin: "0 0 var(--space-3)", fontSize: 14 }}>{message}</p>
      <p
        style={{
          margin: "0 0 var(--space-4)",
          fontSize: 12,
          fontFamily: "var(--font-mono)",
          color: "var(--color-neutral-600)",
        }}
      >
        {code}
      </p>
      <button
        type="button"
        className="btn btn-secondary"
        style={{ height: 30, fontSize: 12 }}
        onClick={onAction}
      >
        {actionLabel}
      </button>
    </Blueprint>
  );
};
