"use client";

import { useEffect, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

const EYEBROW: CSSProperties = {
  display: "block",
  marginBottom: "var(--space-2)",
  fontSize: 10,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--color-neutral-600)",
};

/**
 * The evidence modal, shared by answer citations and the source-pane excerpt
 * list: a badge, the location line and the verbatim excerpt, in a single
 * scrolling column. Portalled to <body> so no transformed or clipped ancestor
 * — a thread row or the side pane's scroll box — can constrain the overlay.
 * "Open in source" only renders when a handler is supplied (the source pane
 * is already there).
 */
export const ExcerptModal = ({
  badge,
  kind,
  title,
  trail,
  excerpt,
  onClose,
  onOpenInSource,
}: {
  badge: ReactNode;
  kind: string;
  title: string;
  trail?: string;
  excerpt: string;
  onClose: () => void;
  onOpenInSource?: () => void;
}) => {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // The modal only ever mounts after a client-side click, but guard the
  // portal target anyway so a server render can never touch `document`.
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--space-6)",
        background: "color-mix(in srgb, var(--color-neutral-900) 52%, transparent)",
        backdropFilter: "blur(2px)",
        zIndex: 50,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={kind}
        className="citation-modal"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "min(640px, 92vw)",
          maxHeight: "86vh",
          background: "var(--color-bg)",
          border: "1px solid var(--color-divider)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-lg)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            flex: "none",
            display: "flex",
            alignItems: "center",
            gap: "var(--space-3)",
            padding: "var(--space-3) var(--space-4)",
            borderBottom: "1px solid var(--color-divider)",
          }}
        >
          <span
            style={{
              flexShrink: 0,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 24,
              height: 24,
              borderRadius: "var(--radius-md)",
              background: "var(--color-accent)",
              color: "#fff",
              fontFamily: "var(--font-heading)",
              fontSize: 13,
              lineHeight: 1,
            }}
          >
            {badge}
          </span>
          <span style={{ ...EYEBROW, marginBottom: 0, flex: 1, minWidth: 0 }}>
            {kind}
          </span>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            style={{
              flexShrink: 0,
              width: 26,
              height: 26,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              background: "transparent",
              border: "1px solid var(--color-divider)",
              borderRadius: "var(--radius-md)",
              font: "inherit",
              fontSize: 15,
              lineHeight: 1,
              cursor: "pointer",
              color: "var(--color-neutral-700)",
            }}
          >
            ×
          </button>
        </div>

        {/* Body — one scrolling column */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: "var(--space-6)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-6)",
          }}
        >
          <div>
            <span style={EYEBROW}>Location</span>
            <span
              style={{
                display: "block",
                fontFamily: "var(--font-heading)",
                fontSize: 16,
                lineHeight: 1.35,
                color: "var(--color-text)",
                overflowWrap: "anywhere",
              }}
            >
              {title}
            </span>
            {trail ? (
              <span
                style={{
                  display: "block",
                  marginTop: "var(--space-1)",
                  fontSize: 12.5,
                  lineHeight: 1.5,
                  color: "var(--color-neutral-600)",
                  overflowWrap: "anywhere",
                }}
              >
                {trail}
              </span>
            ) : null}

            {onOpenInSource ? (
              <button
                type="button"
                onClick={onOpenInSource}
                style={{
                  marginTop: "var(--space-4)",
                  padding: "var(--space-2) var(--space-4)",
                  background: "var(--color-accent)",
                  border: "1px solid var(--color-accent)",
                  borderRadius: "var(--radius-md)",
                  font: "inherit",
                  fontSize: 13,
                  cursor: "pointer",
                  color: "#fff",
                }}
              >
                Open in source
              </button>
            ) : null}
          </div>

          <div style={{ minWidth: 0 }}>
            <span style={EYEBROW}>Excerpt</span>
            <blockquote
              style={{
                margin: 0,
                padding: "var(--space-4)",
                background: "var(--color-surface)",
                border: "1px solid var(--color-divider)",
                borderLeft: "3px solid var(--color-accent)",
                borderRadius: "var(--radius-sm)",
                fontSize: 14.5,
                lineHeight: 1.7,
                color: "var(--color-neutral-800)",
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
              }}
            >
              {`“${excerpt}”`}
            </blockquote>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};
