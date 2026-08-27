import { MAX_UPLOAD_BYTES } from "@/lib/config";
import {
  ApiError,
  SAFE_MESSAGES,
  looksRateLimited,
  toErrorResponse,
} from "@/lib/errors";
import { chunkDocument } from "@/lib/chunk";
import { embedTexts } from "@/lib/embeddings";
import { extractDocument, extensionOf, isAcceptedExtension } from "@/lib/extract";
import {
  buildOutline,
  createDocument,
  deleteDocument,
  getChunks,
  getDocument,
  getOrCreateChat,
  insertChunksWithEmbeddings,
  listDocuments,
  markDocumentFailed,
  markDocumentReady,
} from "@/lib/repository";
import { unsupportedFileError } from "@/lib/errors";
import type { IndexingEvent, SessionPayload } from "@/lib/types";

/**
 * Upload and index a document.
 *
 * The response is a newline-delimited JSON stream rather than a single JSON
 * body, so the five-stage progress in the right pane reports work that has
 * actually happened. The alternative — returning once at the end and letting
 * the client animate a timer — would show "Embedding" while the server was
 * still extracting text.
 */
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * The document dropdown's data: every indexed document, newest first. Each is
 * a separate chat room — selecting one loads its conversation via
 * GET /api/session?documentId=….
 */
export const GET = async (): Promise<Response> => {
  try {
    const documents = await listDocuments();
    return Response.json({ documents }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error);
  }
};

/**
 * Remove a document and its whole conversation.
 *
 * `DELETE /api/documents?id=…`. Chunks, embeddings, the chat and its messages
 * all cascade from the `documents` row, so this is a single delete. The client
 * then re-reads `GET /api/session` — the next most-recent document (or the
 * empty state) takes over.
 */
export const DELETE = async (request: Request): Promise<Response> => {
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) {
      throw new ApiError("ERR_BAD_REQUEST", "No document was specified.");
    }

    const existing = await getDocument(id);
    if (!existing) {
      throw new ApiError("ERR_NOT_FOUND", "That document no longer exists.");
    }

    await deleteDocument(id);
    return Response.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
};

const STAGES = [
  "Uploading file",
  "Reading the text",
  "Splitting into excerpts",
  "Preparing for search",
  "Saving",
] as const;

export const POST = async (request: Request): Promise<Response> => {
  let form: FormData;
  try {
    form = await request.formData();
  } catch (cause) {
    return toErrorResponse(
      new ApiError("ERR_BAD_REQUEST", "The upload could not be read.", {
        detail: cause instanceof Error ? cause.message : String(cause),
      }),
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return toErrorResponse(new ApiError("ERR_NO_FILE", "No file was uploaded."));
  }

  // Validate before opening the stream so a rejected file is a plain JSON
  // error the client can render as the "Unsupported file" card. Nothing has
  // been written to the database at this point, and nothing will be.
  const extension = extensionOf(file.name);
  if (!isAcceptedExtension(extension)) {
    return toErrorResponse(unsupportedFileError(file.name, extension));
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return toErrorResponse(
      new ApiError("ERR_FILE_TOO_LARGE", "That file is larger than 20 MB.", {
        detail: `${file.name} is ${(file.size / (1024 * 1024)).toFixed(1)} MB`,
      }),
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: IndexingEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      const stage = (index: number) => {
        send({ type: "stage", stage: index, label: STAGES[index] });
      };

      let documentId: string | null = null;

      try {
        stage(0);
        const bytes = await file.arrayBuffer();

        stage(1);
        const extraction = await extractDocument(file.name, bytes);

        documentId = await createDocument({
          filename: file.name,
          kind: extraction.kind,
          mimeType: file.type || inferMime(extraction.kind),
          sizeBytes: file.size,
        });

        stage(2);
        const { chunks } = chunkDocument(extraction);
        if (chunks.length === 0) {
          throw new ApiError(
            "ERR_EMPTY_DOCUMENT",
            "There was no readable text in that file.",
          );
        }

        stage(3);
        const vectors = await embedTexts(chunks.map((chunk) => chunk.text));

        stage(4);
        await insertChunksWithEmbeddings(documentId, chunks, vectors);
        await markDocumentReady(documentId, {
          pageCount: extraction.pageCount,
          lineCount: extraction.lineCount,
          chunkCount: chunks.length,
        });

        const chatId = await getOrCreateChat(documentId);
        const stored = await getChunks(documentId);

        const session: SessionPayload = {
          document: {
            id: documentId,
            filename: file.name,
            kind: extraction.kind,
            mimeType: file.type || inferMime(extraction.kind),
            sizeBytes: file.size,
            pageCount: extraction.pageCount,
            lineCount: extraction.lineCount,
            chunkCount: chunks.length,
            status: "ready",
            createdAt: new Date().toISOString(),
          },
          chunks: stored,
          outline: buildOutline(stored),
          chatId,
          messages: [],
        };

        send({ type: "done", session });
      } catch (error) {
        if (documentId) {
          // The row exists but the pipeline failed partway. Mark it rather
          // than leaving a document stuck in 'parsing' forever.
          await markDocumentFailed(
            documentId,
            error instanceof Error ? error.message : String(error),
          ).catch(() => undefined);
        }

        if (error instanceof ApiError) {
          // `error.detail` is operator context — logged, never streamed.
          if (error.status >= 500) console.error(`[${error.code}]`, error);
          send({ type: "error", code: error.code, message: error.message });
        } else if (looksRateLimited(error)) {
          console.error("[upload] rate limited", error);
          send({
            type: "error",
            code: "ERR_RATE_LIMITED",
            message: SAFE_MESSAGES.rateLimited,
          });
        } else {
          console.error("[upload] indexing failed", error);
          send({
            type: "error",
            code: "ERR_INTERNAL",
            message: "The document could not be indexed. " + SAFE_MESSAGES.internal,
          });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      // Streamed progress is worthless if a proxy buffers it.
      "X-Accel-Buffering": "no",
    },
  });
};

const inferMime = (kind: "pdf" | "txt" | "md"): string => {
  switch (kind) {
    case "pdf":
      return "application/pdf";
    case "txt":
      return "text/plain";
    case "md":
      return "text/markdown";
  }
};
