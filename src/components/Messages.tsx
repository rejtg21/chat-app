"use client";

import { useEffect, useState } from "react";
import { Blueprint } from "@/components/Blueprint";

/**
 * A message's time, rendered small and uppercase to match the other thread
 * meta labels. `align` puts it under a right-aligned bubble or a left-aligned
 * turn.
 */
export const MessageTime = ({
  time,
  align = "start",
}: {
  time: string;
  align?: "start" | "end";
}) => {
  if (!time) return null;
  return (
    <span
      style={{
        display: "block",
        marginTop: "var(--space-1)",
        fontSize: 10,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        fontVariantNumeric: "tabular-nums",
        color: "var(--color-neutral-600)",
        textAlign: align === "end" ? "right" : "left",
      }}
    >
      {time}
    </span>
  );
};

/** 3c. The user's question — right-aligned, on the accent's deepest step. */
export const UserMessage = ({
  text,
  time,
}: {
  text: string;
  time?: string;
}) => {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
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
      {time ? <MessageTime time={time} align="end" /> : null}
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
        fontWeight: 600,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: "var(--color-accent-700)",
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
export const SystemMessage = ({ text, time }: { text: string; time?: string }) => {
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
          display: "flex",
          alignItems: "baseline",
          gap: "var(--space-2)",
          fontSize: 10,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--color-accent-700)",
          marginBottom: "var(--space-1)",
        }}
      >
        <span>System</span>
        {time ? (
          <span
            style={{
              letterSpacing: "0.08em",
              fontVariantNumeric: "tabular-nums",
              color: "var(--color-neutral-600)",
            }}
          >
            {time}
          </span>
        ) : null}
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

/**
 * 3e. Stands in for the assistant turn while a question is in flight and no
 * answer text has arrived yet.
 *
 * Two phases — `searching` the document, then `generating` once retrieval is
 * done and we are waiting on the model — plus a running clock and a Stop
 * control, so a slow answer (a local model still loading into memory is the
 * usual cause) reads as "working", not "frozen".
 */
export const PendingAnswer = ({
  phase,
  onStop,
}: {
  phase: "searching" | "generating";
  onStop: () => void;
}) => {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [phase]);

  const label =
    phase === "searching" ? "Searching the document" : "Waiting for the model";
  const slow = elapsed >= 8;

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
        <span>{label}</span>
        {elapsed >= 3 ? (
          <span style={{ letterSpacing: 0, textTransform: "none" }}>
            · {elapsed}s
          </span>
        ) : null}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {["96%", "88%", "62%"].map((width) => (
          <div key={width} className="shimmer" style={{ height: 11, width }} />
        ))}
      </div>

      {slow ? (
        <p
          style={{
            margin: "var(--space-3) 0 0",
            fontSize: 12,
            lineHeight: 1.5,
            color: "var(--color-neutral-600)",
          }}
        >
          {phase === "generating"
            ? "This is taking longer than usual. If you are running a local model, it may still be loading into memory."
            : "Still searching — larger documents take a moment."}
        </p>
      ) : null}

      <button
        type="button"
        className="btn btn-ghost"
        style={{
          height: 26,
          marginTop: "var(--space-2)",
          padding: "0 var(--space-2)",
          fontSize: 12,
          color: "var(--color-neutral-600)",
        }}
        onClick={onStop}
      >
        Stop
      </button>
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
