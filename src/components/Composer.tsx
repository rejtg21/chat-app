"use client";

import { ArrowUp, Plus, Square } from "lucide-react";
import { useEffect, useRef } from "react";
import { Blueprint } from "@/components/Blueprint";

export const Composer = ({
  value,
  onChange,
  onSend,
  onStop,
  onAttach,
  hasDocument,
  filename,
  busy,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onAttach: () => void;
  hasDocument: boolean;
  filename: string | null;
  busy: boolean;
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Grow with the content up to the design's 120px ceiling, then scroll.
  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 120)}px`;
  }, [value]);

  // Sending is allowed while a previous answer is still streaming — the parent
  // interrupts it and asks the new question. Only an empty box blocks send.
  const canSend = hasDocument && value.trim().length > 0;

  return (
    <div
      style={{
        flex: "none",
        padding: "var(--space-4) var(--space-6) var(--space-6)",
        borderTop: "1px solid var(--color-divider)",
      }}
    >
      <div style={{ maxWidth: 660, margin: "0 auto" }}>
        <Blueprint
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: "var(--space-2)",
            padding: "var(--space-2) var(--space-2) var(--space-2) var(--space-3)",
          }}
        >
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            style={{ width: 32, height: 32, color: "var(--color-neutral-700)" }}
            title="Add a document"
            aria-label="Add a document"
            onClick={onAttach}
          >
            <Plus size={17} strokeWidth={1.5} aria-hidden />
          </button>

          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            placeholder={
              hasDocument
                ? `Ask about ${filename ?? "the document"}`
                : "Upload a document to start asking"
            }
            aria-label="Ask about the document"
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (canSend) onSend();
              }
            }}
            style={{
              flex: 1,
              minHeight: 32,
              maxHeight: 120,
              padding: "6px 0",
              border: 0,
              background: "transparent",
              resize: "none",
              font: "inherit",
              fontSize: 14,
              color: "inherit",
              outline: "none",
            }}
          />

          {busy ? (
            <button
              type="button"
              className="btn btn-secondary btn-icon"
              style={{ width: 32, height: 32 }}
              aria-label="Stop generating"
              title="Stop generating"
              onClick={onStop}
            >
              <Square size={13} strokeWidth={1.5} aria-hidden />
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary btn-icon"
              style={{ width: 32, height: 32 }}
              disabled={!canSend}
              aria-label="Send question"
              onClick={onSend}
            >
              <ArrowUp size={16} strokeWidth={1.5} aria-hidden />
            </button>
          )}
        </Blueprint>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: "var(--space-2)",
            fontSize: 11,
            color: "var(--color-neutral-600)",
          }}
        >
          <span>
            {!hasDocument
              ? "Works with PDF, TXT and Markdown files"
              : busy
                ? "Answering — press Stop, or Enter to ask something new"
                : "Press Enter to send · Shift+Enter for a new line"}
          </span>
        </div>
      </div>
    </div>
  );
};
