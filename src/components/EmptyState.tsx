import { Upload } from "lucide-react";
import { Blueprint } from "@/components/Blueprint";

/** 3a. No document loaded. */
export const EmptyState = ({
  onUpload,
  onUseSample,
  busy,
}: {
  onUpload: () => void;
  onUseSample: () => void;
  busy: boolean;
}) => {
  return (
    <Blueprint
      style={{
        maxWidth: 520,
        margin: "var(--space-8) auto",
        padding: "var(--space-8)",
        textAlign: "center",
      }}
    >
      <Upload
        size={34}
        strokeWidth={1.5}
        color="var(--color-accent)"
        aria-hidden
        style={{ margin: "0 auto var(--space-4)" }}
      />
      <h2 style={{ margin: "0 0 var(--space-2)", fontSize: 26 }}>
        No document loaded
      </h2>
      <p
        style={{
          margin: "0 auto var(--space-6)",
          maxWidth: 340,
          fontSize: 14,
          color: "var(--color-neutral-700)",
        }}
      >
        Upload a PDF, TXT or Markdown file and ask questions about it. Your
        file and the conversation are saved automatically, so they’re still
        here if you refresh or come back later.
      </p>
      <div style={{ display: "flex", gap: "var(--space-3)", justifyContent: "center" }}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={onUpload}
          disabled={busy}
        >
          Upload document
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onUseSample}
          disabled={busy}
        >
          Use the sample
        </button>
      </div>
      <p
        style={{
          margin: "var(--space-6) 0 0",
          fontSize: 11,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--color-neutral-500)",
        }}
      >
        PDF · TXT · MD — up to 20 MB
      </p>
    </Blueprint>
  );
};
