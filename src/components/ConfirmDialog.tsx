"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Corners } from "@/components/Blueprint";

/**
 * A blocking yes/no dialog for actions that can't be undone or that throw away
 * work — removing a document, or replacing the one a conversation is built on.
 *
 * The confirm button is focused on open and Escape (or a backdrop click)
 * cancels, so the safe choice is always the easy one. `tone="danger"` paints
 * the confirm button in the warm destructive hue; the default is the accent.
 */
export const ConfirmDialog = ({
  title,
  body,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "primary",
  busy = false,
  busyLabel = "Working…",
  onConfirm,
  onCancel,
}: {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "primary" | "danger";
  busy?: boolean;
  busyLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) => {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, busy]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--space-6)",
        background: "color-mix(in srgb, var(--color-neutral-900) 42%, transparent)",
      }}
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="blueprint"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "min(460px, 100%)",
          background: "var(--color-bg)",
          padding: "var(--space-6)",
          boxShadow: "var(--shadow-lg)",
        }}
      >
        <Corners />

        <h2 style={{ margin: "0 0 var(--space-3)", fontSize: 24 }}>{title}</h2>

        <div
          style={{
            margin: "0 0 var(--space-6)",
            fontSize: 14,
            lineHeight: 1.55,
            color: "var(--color-neutral-700)",
          }}
        >
          {body}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "var(--space-3)",
          }}
        >
          <button
            type="button"
            className="btn btn-secondary"
            style={{ height: 38, paddingInline: "var(--space-4)" }}
            onClick={onCancel}
            disabled={busy}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={`btn ${tone === "danger" ? "btn-danger-solid" : "btn-primary"}`}
            style={{ height: 38, paddingInline: "var(--space-4)" }}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
