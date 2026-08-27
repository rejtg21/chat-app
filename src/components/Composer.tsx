"use client";

import { ArrowUp, Plus } from "lucide-react";
import { useEffect, useRef } from "react";
import { Blueprint } from "@/components/Blueprint";
import { DB_LABEL } from "@/lib/config";

export function Composer({
  value,
  onChange,
  onSend,
  onAttach,
  hasDocument,
  filename,
  chatId,
  busy,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onAttach: () => void;
  hasDocument: boolean;
  filename: string | null;
  chatId: string | null;
  busy: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Grow with the content up to the design's 120px ceiling, then scroll.
  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 120)}px`;
  }, [value]);

  const canSend = hasDocument && value.trim().length > 0 && !busy;

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
            title="Attach a document"
            aria-label="Attach a document"
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
            {hasDocument
              ? "Enter to send · Shift+Enter for a new line"
              : "PDF, TXT or Markdown"}
          </span>
          <span>
            {hasDocument && chatId ? `Chat ${chatId.slice(0, 4)} · ${DB_LABEL}` : ""}
          </span>
        </div>
      </div>
    </div>
  );
}
