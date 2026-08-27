"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Header } from "@/components/Header";
import { DocumentBar } from "@/components/DocumentBar";
import { EmptyState } from "@/components/EmptyState";
import { Suggestions } from "@/components/Suggestions";
import { Composer } from "@/components/Composer";
import { AnswerMessage } from "@/components/AnswerMessage";
import {
  ErrorCard,
  RetrievalShimmer,
  SystemNote,
  UserMessage,
} from "@/components/Messages";
import { SourcePane, type SourceTab, type UploadProgress } from "@/components/SourcePane";
import {
  ACCEPT_ATTRIBUTE,
  DB_LABEL,
  EMBEDDING_DIMENSIONS,
} from "@/lib/config";
import { extensionOf, isAcceptedExtension } from "@/lib/extract";
import { readDataParts, toUIMessage } from "@/lib/session-client";
import type { ChatUIMessage } from "@/lib/ui-messages";
import {
  EMPTY_UI_STATE,
  type AppError,
  type IndexingEvent,
  type MessageUiState,
  type SessionPayload,
} from "@/lib/types";

const EMPTY_SESSION: SessionPayload = {
  document: null,
  chunks: [],
  outline: [],
  chatId: null,
  messages: [],
};

export function DocumentChat() {
  const [session, setSession] = useState<SessionPayload>(EMPTY_SESSION);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [tab, setTab] = useState<SourceTab>("outline");
  const [activeChunkId, setActiveChunkId] = useState<string | null>(null);
  const [upload, setUpload] = useState<UploadProgress | null>(null);
  const [fileError, setFileError] = useState<AppError | null>(null);
  const [uiState, setUiState] = useState<Record<string, MessageUiState>>({});
  const [sourceOpen, setSourceOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const narrow = useNarrowViewport();

  const documentId = session.document?.id ?? null;

  const { messages, setMessages, sendMessage, status, error, stop, clearError } =
    useChat<ChatUIMessage>({
      transport: new DefaultChatTransport({ api: "/api/chat" }),
    });

  /* ── restore from the database ───────────────────────────────────────── */

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch("/api/session", { cache: "no-store" });
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as
            | { error?: { message?: string } }
            | null;
          throw new Error(body?.error?.message ?? `Request failed (${response.status})`);
        }
        const payload = (await response.json()) as SessionPayload;
        if (cancelled) return;

        setSession(payload);
        setMessages(payload.messages.map(toUIMessage));
        setUiState(
          Object.fromEntries(
            payload.messages.map((message) => [message.id, message.uiState]),
          ),
        );
      } catch (cause) {
        if (!cancelled) {
          setLoadError(cause instanceof Error ? cause.message : String(cause));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [setMessages]);

  /* ── keep the thread pinned to the newest message ────────────────────── */

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const stick = () => {
      element.scrollTop = element.scrollHeight;
    };
    stick();
    // Twice, inside nested frames, so it lands after layout rather than
    // before it — this runs on every streaming tick.
    const frame = requestAnimationFrame(() => requestAnimationFrame(stick));
    return () => cancelAnimationFrame(frame);
  }, [messages, upload]);

  /* ── asking ──────────────────────────────────────────────────────────── */

  const ask = useCallback(
    (question: string) => {
      const trimmed = question.trim();
      if (!trimmed || !documentId) return;
      // A new question cancels whatever is still streaming.
      if (status === "streaming" || status === "submitted") stop();
      clearError();
      setInput("");
      void sendMessage({ text: trimmed }, { body: { documentId } });
    },
    [documentId, sendMessage, status, stop, clearError],
  );

  const retryLast = useCallback(() => {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    const { text } = readDataParts(lastUser);
    // Drop the failed exchange, then re-ask in place.
    setMessages(messages.filter((m) => m.id !== lastUser.id));
    clearError();
    ask(text);
  }, [messages, setMessages, ask, clearError]);

  /* ── uploading ───────────────────────────────────────────────────────── */

  const indexFile = useCallback(
    async (file: File) => {
      setFileError(null);

      // Client-side gate first, so an unsupported file never leaves the
      // browser and the thread is not disturbed.
      const extension = extensionOf(file.name);
      if (!isAcceptedExtension(extension)) {
        setFileError({
          kind: "Unsupported file",
          message: `“${file.name}” is a ${
            extension ? extension.toUpperCase() : "unrecognised"
          } file. This app reads PDF, TXT and Markdown.`,
          code: `ERR_UNSUPPORTED_TYPE · nothing was written to ${DB_LABEL}`,
        });
        return;
      }

      setUpload({
        filename: file.name,
        sizeBytes: file.size,
        stage: 0,
        label: "Uploading file",
      });

      try {
        const body = new FormData();
        body.append("file", file);
        const response = await fetch("/api/documents", { method: "POST", body });

        if (!response.ok || !response.body) {
          const payload = (await response.json().catch(() => null)) as
            | { error?: { code?: string; message?: string; detail?: string } }
            | null;
          const code = payload?.error?.code ?? "ERR_UPLOAD_FAILED";
          setUpload(null);
          setFileError({
            kind: code === "ERR_UNSUPPORTED_TYPE" ? "Unsupported file" : "Upload failed",
            message: payload?.error?.message ?? "The upload failed.",
            code: [code, payload?.error?.detail].filter(Boolean).join(" · "),
          });
          return;
        }

        for await (const event of readNdjson(response.body)) {
          if (event.type === "stage") {
            setUpload((current) =>
              current
                ? { ...current, stage: event.stage, label: event.label }
                : current,
            );
          } else if (event.type === "done") {
            setSession(event.session);
            setMessages([]);
            setUiState({});
            setTab("outline");
            setActiveChunkId(null);
            setUpload(null);
          } else {
            setUpload(null);
            setFileError({
              kind: event.code === "ERR_UNSUPPORTED_TYPE"
                ? "Unsupported file"
                : "Upload failed",
              message: event.message,
              code: [event.code, event.detail].filter(Boolean).join(" · "),
            });
          }
        }
      } catch (cause) {
        setUpload(null);
        setFileError({
          kind: "Upload failed",
          message: "The upload did not complete.",
          code: `ERR_NETWORK · ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
        });
      }
    },
    [setMessages],
  );

  const loadSample = useCallback(async () => {
    try {
      const response = await fetch("/sample/retrieval-augmented-generation.md");
      if (!response.ok) throw new Error(`sample unavailable (${response.status})`);
      const blob = await response.blob();
      await indexFile(
        new File([blob], "retrieval-augmented-generation.md", {
          type: "text/markdown",
        }),
      );
    } catch (cause) {
      setFileError({
        kind: "Upload failed",
        message: "The sample document could not be loaded.",
        code: `ERR_SAMPLE · ${cause instanceof Error ? cause.message : String(cause)}`,
      });
    }
  }, [indexFile]);

  /* ── per-message UI state ────────────────────────────────────────────── */

  const patchUiState = useCallback(
    (messageId: string, patch: (current: MessageUiState) => MessageUiState) => {
      setUiState((current) => {
        const next = patch(current[messageId] ?? EMPTY_UI_STATE);
        // Optimistic: the tick lands instantly and the write follows. A
        // failed write is not worth interrupting the reader for.
        void fetch("/api/messages/ui-state", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messageId, uiState: next }),
        }).catch(() => undefined);
        return { ...current, [messageId]: next };
      });
    },
    [],
  );

  const focusChunk = useCallback(
    (chunkId: string) => {
      setTab("chunks");
      setActiveChunkId(chunkId);
      if (narrow) setSourceOpen(true);
    },
    [narrow],
  );

  /* ── derived view state ──────────────────────────────────────────────── */

  const document = session.document;
  const busy = status === "submitted" || status === "streaming";
  const hasUserMessage = messages.some((message) => message.role === "user");
  const retrievalError = useMemo(() => parseRetrievalError(error), [error]);

  // The assistant is retrieving while the request is in flight and no answer
  // part has arrived yet.
  const awaitingAnswer =
    busy &&
    (messages.length === 0 ||
      messages[messages.length - 1].role === "user" ||
      readDataParts(messages[messages.length - 1]).retrieval === null);

  const showEmptyState = !document && !upload && !loading;
  const showSuggestions = Boolean(document) && !hasUserMessage && !busy;

  return (
    <div
      style={{
        height: "100dvh",
        maxHeight: "100dvh",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Header hasDocument={Boolean(document)} />

      <main
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
          display: "grid",
          gridTemplateColumns: narrow ? "minmax(0, 1fr)" : "minmax(0, 1fr) 400px",
          gridTemplateRows: "minmax(0, 1fr)",
          alignItems: "stretch",
          position: "relative",
        }}
      >
        <section
          style={{
            minWidth: 0,
            minHeight: 0,
            height: "100%",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            borderRight: narrow ? "none" : "1px solid var(--color-divider)",
          }}
        >
          {document ? (
            <DocumentBar
              document={document}
              onReplace={() => fileInputRef.current?.click()}
              onToggleSource={narrow ? () => setSourceOpen(true) : undefined}
            />
          ) : null}

          <div
            ref={scrollRef}
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              padding: "var(--space-8) var(--space-6)",
            }}
          >
            {loading ? <ThreadSkeleton /> : null}

            {loadError ? (
              <div style={{ maxWidth: 660, margin: "0 auto" }}>
                <ErrorCard
                  kind="Not connected"
                  message={`The app could not reach ${DB_LABEL}. Check DATABASE_URL and that the migration has been run — the steps are in SETUP.md.`}
                  code={`ERR_SESSION · ${loadError}`}
                  actionLabel="Try again"
                  onAction={() => window.location.reload()}
                />
              </div>
            ) : null}

            {showEmptyState ? (
              <EmptyState
                onUpload={() => fileInputRef.current?.click()}
                onUseSample={() => void loadSample()}
                busy={Boolean(upload)}
              />
            ) : null}

            {showSuggestions && document ? (
              <Suggestions
                filename={document.filename}
                chunkCount={document.chunkCount}
                onAsk={ask}
              />
            ) : null}

            <div
              style={{
                maxWidth: 660,
                margin: "0 auto",
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-8)",
              }}
            >
              {document ? (
                <SystemNote
                  text={`Indexed ${document.chunkCount} chunks · ${EMBEDDING_DIMENSIONS}-d embeddings · stored in ${DB_LABEL}`}
                />
              ) : null}

              {messages.map((message) => {
                const { text, retrieval, citations, structured } =
                  readDataParts(message);

                if (message.role === "user") {
                  return <UserMessage key={message.id} text={text} />;
                }

                const isLast = message.id === messages[messages.length - 1]?.id;
                return (
                  <AnswerMessage
                    key={message.id}
                    text={text}
                    streaming={isLast && busy}
                    retrieval={retrieval}
                    citations={citations}
                    structured={structured}
                    uiState={uiState[message.id] ?? EMPTY_UI_STATE}
                    onToggleChecklistItem={(index) =>
                      patchUiState(message.id, (current) => ({
                        ...current,
                        checked: {
                          ...current.checked,
                          [index]: !current.checked[String(index)],
                        },
                      }))
                    }
                    onToggleEvidenceCard={(index) =>
                      patchUiState(message.id, (current) => ({
                        ...current,
                        expanded: {
                          ...current.expanded,
                          [index]: !current.expanded[String(index)],
                        },
                      }))
                    }
                    onFocusChunk={focusChunk}
                  />
                );
              })}

              {awaitingAnswer && document ? (
                <RetrievalShimmer chunkCount={document.chunkCount} />
              ) : null}

              {retrievalError ? (
                <ErrorCard
                  kind={retrievalError.kind}
                  message={retrievalError.message}
                  code={retrievalError.code}
                  actionLabel="Retry question"
                  onAction={retryLast}
                />
              ) : null}

              {fileError ? (
                <ErrorCard
                  kind={fileError.kind}
                  message={fileError.message}
                  code={fileError.code}
                  actionLabel="Choose another file"
                  onAction={() => {
                    setFileError(null);
                    fileInputRef.current?.click();
                  }}
                />
              ) : null}
            </div>
          </div>

          <Composer
            value={input}
            onChange={setInput}
            onSend={() => ask(input)}
            onAttach={() => fileInputRef.current?.click()}
            hasDocument={Boolean(document)}
            filename={document?.filename ?? null}
            chatId={session.chatId}
            busy={busy}
          />
        </section>

        {narrow ? (
          sourceOpen ? (
            <SlideOver onClose={() => setSourceOpen(false)}>
              <SourcePane
                document={document}
                chunks={session.chunks}
                outline={session.outline}
                tab={tab}
                onTabChange={setTab}
                activeChunkId={activeChunkId}
                onFocusChunk={focusChunk}
                upload={upload}
              />
            </SlideOver>
          ) : null
        ) : (
          <SourcePane
            document={document}
            chunks={session.chunks}
            outline={session.outline}
            tab={tab}
            onTabChange={setTab}
            activeChunkId={activeChunkId}
            onFocusChunk={focusChunk}
            upload={upload}
          />
        )}
      </main>

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        style={{ display: "none" }}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void indexFile(file);
        }}
      />
    </div>
  );
}

/* ── helpers ───────────────────────────────────────────────────────────── */

/** Consume the indexing route's newline-delimited JSON. */
async function* readNdjson(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<IndexingEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) yield JSON.parse(line) as IndexingEvent;
      newline = buffer.indexOf("\n");
    }
  }

  const tail = buffer.trim();
  if (tail) yield JSON.parse(tail) as IndexingEvent;
}

/**
 * The chat transport surfaces a failed response as an Error carrying the
 * response body. Recover the structured error so the retrieval failure gets
 * its own card and its own code line rather than a generic message.
 */
function parseRetrievalError(error: Error | undefined): AppError | null {
  if (!error) return null;

  try {
    const parsed = JSON.parse(error.message) as {
      error?: { code?: string; message?: string; detail?: string };
    };
    if (parsed.error?.message) {
      return {
        kind: "Retrieval failed",
        message: parsed.error.message,
        code: [parsed.error.code, parsed.error.detail].filter(Boolean).join(" · "),
      };
    }
  } catch {
    // Not JSON — fall through to the generic shape below.
  }

  return {
    kind: "Retrieval failed",
    message: `The vector search did not come back. Your document and this conversation are safe in ${DB_LABEL} — only the lookup failed.`,
    code: `ERR_RETRIEVAL_FAILED · ${error.message}`,
  };
}

/** Matches the handoff's ~1100px breakpoint. */
function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 1100px)");
    const sync = () => setNarrow(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  return narrow;
}

function SlideOver({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        justifyContent: "flex-end",
        background: "color-mix(in srgb, var(--color-neutral-900) 40%, transparent)",
        zIndex: 10,
      }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Source"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "min(400px, 92vw)",
          height: "100%",
          background: "var(--color-bg)",
          borderLeft: "1px solid var(--color-divider)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** Loading state for the thread while the session is read back. */
function ThreadSkeleton() {
  return (
    <div
      style={{
        maxWidth: 660,
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-4)",
      }}
    >
      {["72%", "94%", "60%"].map((width) => (
        <div key={width} className="shimmer" style={{ height: 11, width }} />
      ))}
    </div>
  );
}
