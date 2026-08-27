"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Header } from "@/components/Header";
import { DocumentBar } from "@/components/DocumentBar";
import { EmptyState } from "@/components/EmptyState";
import { Suggestions } from "@/components/Suggestions";
import { Composer } from "@/components/Composer";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { FileDropZone } from "@/components/FileDropZone";
import { AnswerMessage } from "@/components/AnswerMessage";
import {
  ErrorCard,
  PendingAnswer,
  SystemMessage,
  SystemNote,
  UserMessage,
} from "@/components/Messages";
import { SourcePane, type SourceTab, type UploadProgress } from "@/components/SourcePane";
import { ACCEPT_ATTRIBUTE } from "@/lib/config";
import { formatMessageTime } from "@/lib/format";
import { extensionOf, isAcceptedExtension } from "@/lib/extract";
import { readDataParts, toUIMessage } from "@/lib/session-client";
import type { ChatUIMessage } from "@/lib/ui-messages";
import {
  EMPTY_UI_STATE,
  type AppError,
  type DocumentSummary,
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

export const DocumentChat = () => {
  const [session, setSession] = useState<SessionPayload>(EMPTY_SESSION);
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [tab, setTab] = useState<SourceTab>("outline");
  const [activeChunkId, setActiveChunkId] = useState<string | null>(null);
  const [upload, setUpload] = useState<UploadProgress | null>(null);
  const [fileError, setFileError] = useState<AppError | null>(null);
  const [uiState, setUiState] = useState<Record<string, MessageUiState>>({});
  const [sourceOpen, setSourceOpen] = useState(false);
  // A file dropped over the thread while a document is already open. Held here
  // until the reader confirms it wants to switch conversations.
  const [pendingDrop, setPendingDrop] = useState<File | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Signatures of errors already written to the thread this session, so a
  // render that re-runs its effect does not stack duplicate system messages.
  const recordedErrors = useRef<Set<string>>(new Set());
  // messageId → ISO `created_at`, for every message read back from the
  // database. A live message the client has just minted is not in here; it
  // renders against the current time until a reload replaces it with its
  // stored row.
  const [messageTimes, setMessageTimes] = useState<Record<string, string>>({});
  const narrow = useNarrowViewport();

  const rememberMessageTimes = useCallback(
    (stored: { id: string; createdAt: string }[]) => {
      setMessageTimes(
        Object.fromEntries(stored.map((message) => [message.id, message.createdAt])),
      );
    },
    [],
  );

  const documentId = session.document?.id ?? null;

  // The open document's id lives in the URL as `?doc=<id>` so a reload
  // restores the same conversation. This is shallow `replaceState` — it syncs
  // the address bar without a navigation; the page's state still comes from
  // the database on the next load.
  const syncDocumentIdToUrl = useCallback((id: string | null) => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("doc") === (id ?? null)) return;
    if (id) url.searchParams.set("doc", id);
    else url.searchParams.delete("doc");
    window.history.replaceState(null, "", url);
  }, []);

  const { messages, setMessages, sendMessage, status, error, stop, clearError } =
    useChat<ChatUIMessage>({
      transport: new DefaultChatTransport({ api: "/api/chat" }),
    });

  /* ── the document dropdown ───────────────────────────────────────────── */

  // Every indexed document is its own chat room. This list is the dropdown's
  // options; it is an enhancement, so a failed fetch is swallowed rather than
  // surfaced as an error card.
  const loadDocuments = useCallback(async () => {
    try {
      const response = await fetch("/api/documents", { cache: "no-store" });
      if (!response.ok) return;
      const body = (await response.json()) as { documents: DocumentSummary[] };
      setDocuments(body.documents);
    } catch {
      /* keep whatever list we already have */
    }
  }, []);

  // Write an error into the thread as a `system` message: persisted to the
  // database and dropped into the open conversation without a refetch. The
  // live error card is still shown alongside — this is the durable record of
  // "something went wrong here" that survives a reload.
  const recordSystemError = useCallback(
    async (signature: string, text: string) => {
      const chatId = session.chatId;
      if (!chatId || recordedErrors.current.has(signature)) return;
      recordedErrors.current.add(signature);

      try {
        const response = await fetch("/api/messages/system", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatId, content: text }),
        });
        if (!response.ok) {
          recordedErrors.current.delete(signature);
          return;
        }
        const { id } = (await response.json()) as { id: string };
        // No entry is added to `messageTimes` here: a system error is being
        // written right now, so the render-time "now" fallback already shows
        // the right time. A reload replaces it with the stored row.
        setMessages((current) =>
          current.some((message) => message.id === id)
            ? current
            : [...current, { id, role: "system", parts: [{ type: "text", text }] }],
        );
      } catch {
        // A failed write is not worth interrupting the reader for; the live
        // error card already told them what happened.
        recordedErrors.current.delete(signature);
      }
    },
    [session.chatId, setMessages],
  );

  const selectDocument = useCallback(
    async (id: string) => {
      if (id === documentId || switching) return;
      // Leaving a room cancels whatever it was still streaming.
      if (status === "streaming" || status === "submitted") stop();
      clearError();
      setFileError(null);
      setSwitching(true);

      try {
        const response = await fetch(
          `/api/session?documentId=${encodeURIComponent(id)}`,
          { cache: "no-store" },
        );
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as
            | { error?: { message?: string } }
            | null;
          throw new Error(
            body?.error?.message ?? `Request failed (${response.status})`,
          );
        }
        const payload = (await response.json()) as SessionPayload;

        setSession(payload);
        syncDocumentIdToUrl(payload.document?.id ?? id);
        rememberMessageTimes(payload.messages);
        setMessages(payload.messages.map(toUIMessage));
        setUiState(
          Object.fromEntries(
            payload.messages.map((message) => [message.id, message.uiState]),
          ),
        );
        setInput("");
        setTab("outline");
        setActiveChunkId(null);
        setSourceOpen(false);
      } catch (cause) {
        // The raw reason stays in the console; the reader gets stable copy.
        console.error("[session] switch failed", cause);
        setLoadError("ERR_SESSION");
        void recordSystemError(
          "session · switch failed",
          "Couldn’t open that document. Please try again in a moment.",
        );
      } finally {
        setSwitching(false);
      }
    },
    [
      documentId,
      switching,
      status,
      stop,
      clearError,
      setMessages,
      recordSystemError,
      rememberMessageTimes,
      syncDocumentIdToUrl,
    ],
  );

  /* ── restore from the database ───────────────────────────────────────── */

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      // Fetched alongside the session so the dropdown fills without delaying
      // first paint of the thread.
      const documentsLoaded = loadDocuments();
      try {
        // A `?doc=<id>` in the URL asks for that specific conversation; without
        // it the most recently indexed document wins.
        const requestedId = new URL(window.location.href).searchParams.get("doc");
        let response = await fetch(
          requestedId
            ? `/api/session?documentId=${encodeURIComponent(requestedId)}`
            : "/api/session",
          { cache: "no-store" },
        );
        // A stale link — the document was removed, or is still indexing —
        // falls back to the default session rather than an error card.
        if (!response.ok && requestedId) {
          response = await fetch("/api/session", { cache: "no-store" });
        }
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as
            | { error?: { message?: string } }
            | null;
          throw new Error(body?.error?.message ?? `Request failed (${response.status})`);
        }
        const payload = (await response.json()) as SessionPayload;
        if (cancelled) return;

        setSession(payload);
        syncDocumentIdToUrl(payload.document?.id ?? null);
        rememberMessageTimes(payload.messages);
        setMessages(payload.messages.map(toUIMessage));
        setUiState(
          Object.fromEntries(
            payload.messages.map((message) => [message.id, message.uiState]),
          ),
        );
      } catch (cause) {
        console.error("[session] load failed", cause);
        if (!cancelled) setLoadError("ERR_SESSION");
      } finally {
        if (!cancelled) setLoading(false);
      }
      await documentsLoaded;
    })();

    return () => {
      cancelled = true;
    };
  }, [setMessages, loadDocuments, rememberMessageTimes, syncDocumentIdToUrl]);

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
    const lastUserIndex = messages.map((m) => m.role).lastIndexOf("user");
    if (lastUserIndex === -1) return;
    const { text } = readDataParts(messages[lastUserIndex]);
    // Drop the failed exchange — the question and everything after it (the
    // empty or half-written answer, any error note) — then re-ask in place.
    setMessages(messages.slice(0, lastUserIndex));
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
          code: "ERR_UNSUPPORTED_TYPE · nothing was saved",
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
            | { error?: { code?: string; message?: string } }
            | null;
          const code = payload?.error?.code ?? "ERR_UPLOAD_FAILED";
          setUpload(null);
          setFileError({
            kind: code === "ERR_UNSUPPORTED_TYPE" ? "Unsupported file" : "Upload failed",
            message: payload?.error?.message ?? "The upload failed.",
            code,
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
            syncDocumentIdToUrl(event.session.document?.id ?? null);
            rememberMessageTimes(event.session.messages);
            setMessages([]);
            setUiState({});
            setTab("outline");
            setActiveChunkId(null);
            setUpload(null);
            // The new document is now the current room — refresh the dropdown.
            void loadDocuments();
          } else {
            setUpload(null);
            setFileError({
              kind: event.code === "ERR_UNSUPPORTED_TYPE"
                ? "Unsupported file"
                : "Upload failed",
              message: event.message,
              code: event.code,
            });
          }
        }
      } catch (cause) {
        console.error("[upload] request failed", cause);
        setUpload(null);
        setFileError({
          kind: "Upload failed",
          message:
            "The upload did not complete. Check your connection and try again.",
          code: "ERR_NETWORK",
        });
      }
    },
    [setMessages, loadDocuments, rememberMessageTimes, syncDocumentIdToUrl],
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
      console.error("[sample] load failed", cause);
      setFileError({
        kind: "Upload failed",
        message: "The sample document could not be loaded. Please try again.",
        code: "ERR_SAMPLE",
      });
    }
  }, [indexFile]);

  /* ── removing a document ─────────────────────────────────────────────── */

  // Delete the open document and its whole conversation, then fall back to
  // the next most-recent document (or the empty state) by re-reading the
  // session from scratch.
  const removeDocument = useCallback(async () => {
    if (!documentId) return;
    if (status === "streaming" || status === "submitted") stop();
    setRemoving(true);

    try {
      const response = await fetch(
        `/api/documents?id=${encodeURIComponent(documentId)}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        throw new Error(
          body?.error?.message ?? `Request failed (${response.status})`,
        );
      }

      clearError();
      setFileError(null);
      setLoadError(null);
      recordedErrors.current.clear();

      const next = await fetch("/api/session", { cache: "no-store" });
      const payload = (await next.json()) as SessionPayload;

      setSession(payload);
      syncDocumentIdToUrl(payload.document?.id ?? null);
      rememberMessageTimes(payload.messages);
      setMessages(payload.messages.map(toUIMessage));
      setUiState(
        Object.fromEntries(
          payload.messages.map((message) => [message.id, message.uiState]),
        ),
      );
      setInput("");
      setTab("outline");
      setActiveChunkId(null);
      setSourceOpen(false);
      setConfirmRemove(false);
      void loadDocuments();
    } catch (cause) {
      console.error("[document] delete failed", cause);
      setConfirmRemove(false);
      setFileError({
        kind: "Couldn’t remove the document",
        message: `Something went wrong while deleting it. Nothing was changed — you can try again.`,
        code: "ERR_DELETE",
      });
    } finally {
      setRemoving(false);
    }
  }, [
    documentId,
    status,
    stop,
    clearError,
    setMessages,
    rememberMessageTimes,
    loadDocuments,
    syncDocumentIdToUrl,
  ]);

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
  const chatError = useMemo(() => parseChatError(error), [error]);

  const askedQuestions = useMemo(
    () =>
      messages
        .filter((message) => message.role === "user")
        .map((message) => readDataParts(message).text),
    [messages],
  );

  // Mirror the live error cards into the thread as durable system messages.
  useEffect(() => {
    if (!chatError) return;
    void recordSystemError(
      `${chatError.kind} · ${chatError.code}`,
      `${chatError.kind}. ${chatError.message} (${chatError.code})`,
    );
  }, [chatError, recordSystemError]);

  useEffect(() => {
    if (!fileError) return;
    void recordSystemError(
      `${fileError.kind} · ${fileError.code}`,
      `${fileError.kind}. ${fileError.message} (${fileError.code})`,
    );
  }, [fileError, recordSystemError]);

  // While a question is in flight and no answer text has landed yet, a
  // stand-in card (with a clock and a Stop) speaks for the empty assistant
  // turn — rather than a lone blinking caret with no way to bail out.
  const lastMessage = messages[messages.length - 1];
  const lastAnswerEmpty =
    lastMessage?.role === "assistant" &&
    readDataParts(lastMessage).text.trim().length === 0;
  const pending =
    busy &&
    Boolean(document) &&
    (!lastMessage || lastMessage.role === "user" || lastAnswerEmpty);
  const pendingPhase: "searching" | "generating" =
    lastMessage?.role === "assistant" &&
    readDataParts(lastMessage).retrieval !== null
      ? "generating"
      : "searching";
  // Streaming ended, but nothing was said and no error was raised — the
  // model answered with an empty completion (often: still warming up).
  const emptyAnswer =
    !busy &&
    !chatError &&
    lastMessage?.role === "assistant" &&
    readDataParts(lastMessage).text.trim().length === 0;

  const showEmptyState = !document && !upload && !loading;
  const showSuggestions = Boolean(document) && !hasUserMessage && !busy;

  // Follow-ups stand under the newest answer once it has fully landed: the
  // request has settled, the last message is the assistant's, and it carries
  // prose. Errors take the space instead when there is one.
  const showFollowUps =
    Boolean(document) &&
    hasUserMessage &&
    !busy &&
    !chatError &&
    !fileError &&
    lastMessage?.role === "assistant" &&
    readDataParts(lastMessage).text.trim().length > 0;

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
          <FileDropZone
            onDropFile={(file) => {
              // With no document open there is no conversation to lose, so a
              // drop indexes straight away. Otherwise it waits for a yes.
              if (document) setPendingDrop(file);
              else void indexFile(file);
            }}
            disabled={Boolean(upload) || removing}
            style={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
            }}
          >
          {document ? (
            <DocumentBar
              document={document}
              documents={documents}
              onSelect={(id) => void selectDocument(id)}
              onAddDocument={() => fileInputRef.current?.click()}
              onRemove={() => setConfirmRemove(true)}
              onToggleSource={narrow ? () => setSourceOpen(true) : undefined}
              switching={switching}
              removing={removing}
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
            {loading || switching ? <ThreadSkeleton /> : null}

            {loadError ? (
              <div style={{ maxWidth: 660, margin: "0 auto" }}>
                <ErrorCard
                  kind="Not connected"
                  message="The app could not reach its storage. Please try again in a moment, or contact support@resmediodia.space if it keeps happening."
                  code={loadError}
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
              <Suggestions variant="intro" filename={document.filename} onAsk={ask} />
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
                <SystemNote text={`Answers come only from ${document.filename}`} />
              ) : null}

              {messages.map((message) => {
                const { text, retrieval, citations, structured } =
                  readDataParts(message);
                // Restored messages carry their stored time; a just-sent one
                // is not in the map yet and reads as the present until a
                // reload swaps in its row.
                const time = formatMessageTime(
                  messageTimes[message.id] ?? new Date().toISOString(),
                );

                if (message.role === "user") {
                  return <UserMessage key={message.id} text={text} time={time} />;
                }

                if (message.role === "system") {
                  return (
                    <SystemMessage key={message.id} text={text} time={time} />
                  );
                }

                const isLast = message.id === messages[messages.length - 1]?.id;
                // An empty last assistant turn is never a real answer — it is
                // covered by PendingAnswer (still streaming), the error card
                // (stream failed) or the "No answer" card (empty completion).
                if (isLast && text.trim().length === 0) return null;
                return (
                  <AnswerMessage
                    key={message.id}
                    text={text}
                    streaming={isLast && busy}
                    retrieval={retrieval}
                    citations={citations}
                    structured={structured}
                    time={time}
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

              {pending ? (
                <PendingAnswer phase={pendingPhase} onStop={stop} />
              ) : null}

              {showFollowUps ? (
                <Suggestions
                  variant="followup"
                  askedQuestions={askedQuestions}
                  onAsk={ask}
                />
              ) : null}

              {emptyAnswer ? (
                <ErrorCard
                  kind="No answer"
                  message="The model connected but sent nothing back. That usually means it was still loading, or the request was stopped."
                  code="ERR_EMPTY_COMPLETION"
                  actionLabel="Try again"
                  onAction={retryLast}
                />
              ) : null}

              {chatError ? (
                <ErrorCard
                  kind={chatError.kind}
                  message={chatError.message}
                  code={chatError.code}
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
            onStop={stop}
            onAttach={() => fileInputRef.current?.click()}
            hasDocument={Boolean(document)}
            filename={document?.filename ?? null}
            busy={busy}
          />
          </FileDropZone>
        </section>

        {narrow ? (
          sourceOpen ? (
            <SlideOver onClose={() => setSourceOpen(false)}>
              <SourcePane
                document={document}
                documents={documents}
                onSelectDocument={(id) => void selectDocument(id)}
                switching={switching}
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
            documents={documents}
            onSelectDocument={(id) => void selectDocument(id)}
            switching={switching}
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

      {pendingDrop ? (
        <ConfirmDialog
          title="Start a new conversation?"
          body={
            <>
              <p style={{ margin: "0 0 var(--space-3)" }}>
                <strong>{pendingDrop.name}</strong> will be added and opened in
                its own conversation.
              </p>
              <p style={{ margin: 0 }}>
                Your current document
                {document ? ` (${document.filename})` : ""} and everything you’ve
                asked about it stay saved — you can switch back to them anytime
                from the document menu at the top.
              </p>
            </>
          }
          confirmLabel="Add and switch"
          cancelLabel="Keep current"
          onConfirm={() => {
            const file = pendingDrop;
            setPendingDrop(null);
            void indexFile(file);
          }}
          onCancel={() => setPendingDrop(null)}
        />
      ) : null}

      {confirmRemove ? (
        <ConfirmDialog
          title="Remove this document?"
          tone="danger"
          busy={removing}
          busyLabel="Removing…"
          body={
            <>
              <p style={{ margin: "0 0 var(--space-3)" }}>
                <strong>{document?.filename}</strong> and the whole conversation
                about it will be permanently deleted.
              </p>
              <p style={{ margin: 0 }}>
                This can’t be undone. To read this document again you’ll need to
                upload it a second time.
              </p>
            </>
          }
          confirmLabel="Remove document"
          cancelLabel="Cancel"
          onConfirm={() => void removeDocument()}
          onCancel={() => setConfirmRemove(false)}
        />
      ) : null}

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
};

/* ── helpers ───────────────────────────────────────────────────────────── */

/** Consume the indexing route's newline-delimited JSON. */
const readNdjson = async function* (
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
};

/**
 * The chat transport surfaces a failed response — and a failed stream — as an
 * Error carrying the response body. Recover the server's `{ code, message }`
 * so a rate limit, a model outage and a retrieval failure each get their own
 * card and copy. The raw error text is never shown: the server has already
 * curated `message`, and the fallbacks below are static.
 */
const parseChatError = (error: Error | undefined): AppError | null => {
  if (!error) return null;

  try {
    const parsed = JSON.parse(error.message) as {
      error?: { code?: string; message?: string };
    };
    if (parsed.error?.message) {
      const code = parsed.error.code ?? "ERR_CHAT_FAILED";
      const kind =
        code === "ERR_RATE_LIMITED"
          ? "Server busy"
          : code === "ERR_MODEL_UNAVAILABLE"
            ? "Model unavailable"
            : "Search failed";
      return { kind, message: parsed.error.message, code };
    }
  } catch {
    // Not JSON — fall through to the generic shape below.
  }

  return {
    kind: "Search failed",
    message:
      "The request did not come back. Your document and this conversation are safe — only this answer failed.",
    code: "ERR_CHAT_FAILED",
  };
};

/** Matches the handoff's ~1100px breakpoint. */
const useNarrowViewport = (): boolean => {
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 1100px)");
    const sync = () => setNarrow(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  return narrow;
};

const SlideOver = ({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) => {
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
};

/** Loading state for the thread while the session is read back. */
const ThreadSkeleton = () => {
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
};
