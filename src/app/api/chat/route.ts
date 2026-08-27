import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
  type StreamTextTransform,
  type ToolSet,
} from "ai";
import { z } from "zod";
import { CHAT_MODEL, MAX_ANSWER_SEGMENTS } from "@/lib/config";
import {
  ApiError,
  SAFE_MESSAGES,
  looksRateLimited,
  toErrorResponse,
} from "@/lib/errors";
import {
  CONTINUE_ANSWER_INSTRUCTION,
  annotateAnswer,
  buildSystemPrompt,
} from "@/lib/answer";
import { normalizeCitationMarkers } from "@/lib/format";
import type { RenderablePayload } from "@/lib/structured";
import { resolveCitations, retrieve } from "@/lib/retrieval";
import {
  getDocument,
  getOrCreateChat,
  insertMessage,
} from "@/lib/repository";
import {
  CITATIONS_PART_ID,
  RETRIEVAL_PART_ID,
  STRUCTURED_PART_ID,
  lastUserText,
  type ChatUIMessage,
} from "@/lib/ui-messages";

/**
 * The RAG endpoint.
 *
 * Node runtime, not edge: the embedding model runs in-process through
 * onnxruntime-node, which has no edge build. Streaming works on the Node
 * runtime with no extra configuration.
 */
export const runtime = "nodejs";
export const maxDuration = 300;

const requestSchema = z.object({
  documentId: z.string().min(1),
  messages: z.array(z.custom<ChatUIMessage>()).min(1),
});

/**
 * Fold fancy citation brackets (`【1】` and friends, which `gpt-oss` favours)
 * to ASCII `[1]` as the prose streams, so the live answer, the citation
 * chips and the persisted row all carry the same markers. This runs per
 * delta; a marker split across two deltas is left alone here and caught by
 * the whole-text pass before the answer is resolved and stored.
 */
const foldCitationMarkers: StreamTextTransform<ToolSet> = () =>
  new TransformStream({
    transform(part, controller) {
      controller.enqueue(
        part.type === "text-delta"
          ? { ...part, text: normalizeCitationMarkers(part.text) }
          : part,
      );
    },
  });

/**
 * Serialise a stream failure into the error envelope the client parses. The
 * real cause is logged here and nowhere else — the payload carries only a
 * stable code and curated copy, so a rate limit reads as "try again later"
 * and anything else as a generic outage, never the provider's raw text.
 */
const forwardStreamError = (cause: unknown): string => {
  console.error("[chat] stream failed", cause);
  const rateLimited = looksRateLimited(cause);
  return JSON.stringify({
    error: rateLimited
      ? { code: "ERR_RATE_LIMITED", message: SAFE_MESSAGES.rateLimited }
      : { code: "ERR_MODEL_UNAVAILABLE", message: SAFE_MESSAGES.modelUnavailable },
  });
};

export const POST = async (request: Request): Promise<Response> => {
  try {
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new ApiError("ERR_BAD_REQUEST", "Malformed chat request.", {
        detail: parsed.error.message,
      });
    }

    const { documentId } = parsed.data;
    // `system` messages are the app's own error notes in the thread. They are
    // persisted and rendered, but they are not conversation the model should
    // see — drop them before anything downstream reads the history.
    const messages = parsed.data.messages.filter(
      (message) => message.role !== "system",
    );

    const document = await getDocument(documentId);
    if (!document || document.status !== "ready") {
      throw new ApiError("ERR_NOT_FOUND", "That document is not available.", {
        detail: `document ${documentId} is ${document?.status ?? "missing"}`,
      });
    }

    const question = lastUserText(messages);
    if (!question) {
      throw new ApiError("ERR_BAD_REQUEST", "There is no question to answer.");
    }

    // Retrieval happens before the stream opens, so a lookup failure becomes
    // a clean JSON error the UI can render as the "Retrieval failed" card,
    // rather than an exception halfway down an already-committed stream.
    const { chunks, meta } = await retrieve(
      documentId,
      question,
      document.chunkCount,
    );

    const chatId = await getOrCreateChat(documentId);
    const assistantMessageId = crypto.randomUUID();

    // Persist the question immediately. If the answer never lands, the
    // conversation still reads correctly after a reload.
    const userMessage = messages[messages.length - 1];
    await insertMessage({
      id: userMessage.id,
      chatId,
      role: "user",
      content: question,
    });

    const stream = createUIMessageStream<ChatUIMessage>({
      originalMessages: messages,
      // A failure inside `execute` (most often: the answer model is
      // unreachable) would otherwise close the stream cleanly and leave the
      // client with a silent empty bubble. Forward it as a structured error
      // the UI renders as an error card — with curated copy, never the raw
      // provider message.
      onError: (cause) => forwardStreamError(cause),
      // `execute` may return a promise, and the stream stays open until it
      // settles. The post-stream work below therefore has to be awaited here
      // — fire-and-forget would race the stream closing and the citations
      // would never reach the client.
      execute: async ({ writer }) => {
        writer.write({ type: "start", messageId: assistantMessageId });

        // Ends the retrieval shimmer and fills in the
        // "3 chunks retrieved · cosine 0.71–0.91" meta label.
        writer.write({
          type: "data-retrieval",
          id: RETRIEVAL_PART_ID,
          data: meta,
        });

        // Strip our data parts before they reach the model: they are UI
        // concerns, and re-feeding resolved citations invites the model to
        // start writing locations itself.
        const modelMessages = await convertToModelMessages(
          messages.map((message) => ({
            ...message,
            parts: message.parts.filter((part) => !part.type.startsWith("data-")),
          })),
        );

        const system = buildSystemPrompt({
          filename: document.filename,
          sources: chunks,
        });

        const forwardModelError = (cause: unknown) => forwardStreamError(cause);

        // A whole-document question — "summarise this whitepaper" — can run
        // past the model's output-token ceiling and stop mid-sentence. When a
        // segment ends on finishReason "length" rather than "stop", replay the
        // answer so far as an assistant turn and ask the model to continue,
        // merging the next piece into the same message. MAX_ANSWER_SEGMENTS
        // caps the loop so a runaway generation can't eat the whole
        // maxDuration budget; the client sees one answer that keeps growing.
        let answer = "";
        let segment = 0;
        let truncated = false;

        do {
          const result = streamText({
            model: CHAT_MODEL,
            system,
            messages:
              segment === 0
                ? modelMessages
                : [
                    ...modelMessages,
                    { role: "assistant", content: answer },
                    { role: "user", content: CONTINUE_ANSWER_INSTRUCTION },
                  ],
            experimental_transform: foldCitationMarkers,
            onError: ({ error }) => {
              console.error("[chat] stream failed", error);
            },
          });

          // The finish event is held back on every segment — one is written by
          // hand once the loop settles — so the client keeps a single open
          // answer while the continuations stream in rather than seeing
          // several that each complete. Without an explicit onError a provider
          // failure would reach the client masked as a generic "An error
          // occurred."; forward the real reason instead.
          writer.merge(
            toUIMessageStream({
              stream: result.stream,
              sendStart: false,
              sendFinish: false,
              onError: forwardModelError,
            }),
          );

          // `result.text` resolves once this segment is complete, while the
          // merged stream has already delivered it to the client. The stream
          // transform folded most citation markers as they flowed; this
          // catches any split across a delta boundary.
          try {
            answer += normalizeCitationMarkers(await result.text);
            truncated = (await result.finishReason) === "length";
          } catch (error) {
            // The merged stream has already forwarded the real reason to the
            // client as an error chunk. Stop looping and keep whatever prose
            // landed — a short answer beats a lost one.
            console.error("[chat] answer segment failed", error);
            truncated = false;
          }
          segment += 1;
        } while (truncated && segment < MAX_ANSWER_SEGMENTS && answer.trim());

        // Close the single message the segments streamed into.
        writer.write({ type: "finish" });

        if (truncated) {
          console.warn(
            `[chat] answer still hit the length limit after ${segment} segment(s)`,
          );
        }

        // The citation resolution and the annotation pass happen after the
        // user has read the answer, not before they see anything.
        try {
          // One more whole-text pass so a marker split across a segment
          // boundary is folded before the prose is stored and cited.
          answer = normalizeCitationMarkers(answer);

          // Citations come from the retrieved chunk rows alone — no model
          // call — so they are resolved, streamed and persisted on their own,
          // never gated behind the annotation pass.
          const citations = resolveCitations(answer, chunks, document.filename);
          writer.write({
            type: "data-citations",
            id: CITATIONS_PART_ID,
            data: citations,
          });

          // The structured component is a best-effort enhancement.
          // `annotateAnswer` already swallows its own failures and returns
          // null, but guard here too: a throw must never cost the citations
          // or the persisted row.
          let structured: RenderablePayload | null = null;
          try {
            structured = await annotateAnswer({
              question,
              answer,
              sources: chunks,
              filename: document.filename,
            });
          } catch (error) {
            console.warn(
              "[chat] annotation pass threw, prose only:",
              error instanceof Error ? error.message : error,
            );
          }
          if (structured) {
            writer.write({
              type: "data-structured",
              id: STRUCTURED_PART_ID,
              data: structured,
            });
          }

          await insertMessage({
            id: assistantMessageId,
            chatId,
            role: "assistant",
            content: answer,
            structured,
            citations,
            retrieval: meta,
          });
        } catch (error) {
          // The prose has already reached the reader. Losing the citations or
          // the component is a degraded answer, not a failed one.
          console.error("[chat] post-stream work failed", error);
        }
      },
    });

    return createUIMessageStreamResponse({ stream });
  } catch (error) {
    return toErrorResponse(error);
  }
};
