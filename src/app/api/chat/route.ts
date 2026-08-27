import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
} from "ai";
import { z } from "zod";
import { CHAT_MODEL } from "@/lib/config";
import { ApiError, toErrorResponse } from "@/lib/errors";
import { annotateAnswer, buildSystemPrompt } from "@/lib/answer";
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

        const result = streamText({
          model: CHAT_MODEL,
          system: buildSystemPrompt({
            filename: document.filename,
            sources: chunks,
          }),
          messages: modelMessages,
          onError: ({ error }) => {
            console.error("[chat] stream failed", error);
          },
        });

        writer.merge(toUIMessageStream({ stream: result.stream, sendStart: false }));

        // `result.text` resolves once the prose is complete, while the merged
        // stream has already delivered it to the client. The annotation pass
        // and the citation resolution therefore happen after the user has
        // read the answer, not before they see anything.
        try {
          {
            const answer = await result.text;

            const citations = resolveCitations(answer, chunks, document.filename);
            writer.write({
              type: "data-citations",
              id: CITATIONS_PART_ID,
              data: citations,
            });

            const structured = await annotateAnswer({
              question,
              answer,
              sources: chunks,
              filename: document.filename,
            });
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
          }
        } catch (error) {
          // The prose has already reached the reader. Losing the citations or
          // the component is a degraded answer, not a failed one.
          console.error("[chat] post-stream annotation failed", error);
        }
      },
    });

    return createUIMessageStreamResponse({ stream });
  } catch (error) {
    return toErrorResponse(error);
  }
};
