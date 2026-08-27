/**
 * API error shapes.
 *
 * The UI renders two visually distinct error cards (spec §3h), so the code
 * matters as much as the message:
 *
 *   ERR_UNSUPPORTED_TYPE  -> "Unsupported file" card. Nothing was written to
 *                            the database. The message thread is undisturbed.
 *   ERR_RETRIEVAL_FAILED  -> "Retrieval failed" card. The document and the
 *                            conversation are safe; only the lookup failed.
 *
 * Every non-2xx JSON response from this API has the same envelope:
 *   { error: { code, message } }
 *
 * `detail` is deliberately NOT part of the wire shape. It is operator context
 * — provider error text, `cause.message`, stack-ish strings, connection hints
 * — and it stays server-side in the logs. Users only ever see the curated
 * `message` and the stable `code` token.
 */

/** Where users are pointed when an error is ours to fix. */
export const SUPPORT_CONTACT = "support@resmediodia.space";

/**
 * Curated, non-debuggable copy per error class. Nothing here interpolates a
 * raw error string — that is the whole point.
 */
export const SAFE_MESSAGES = {
  rateLimited:
    `The server has reached its request limit for this agent. ` +
    `Please try again tomorrow, or contact ${SUPPORT_CONTACT}.`,
  internal:
    `Something went wrong on our end. Please try again in a moment, or ` +
    `contact ${SUPPORT_CONTACT} if it keeps happening.`,
  badRequest:
    "That request could not be processed. Please refresh the page and try again.",
  modelUnavailable:
    `The assistant is temporarily unavailable. Please try again in a moment, ` +
    `or contact ${SUPPORT_CONTACT} if it continues.`,
  retrieval:
    "The search did not come back. Your document and this conversation are " +
    "safe — only this answer failed.",
  notFound: "That document or conversation is no longer available.",
} as const;

/**
 * True when an error looks like an upstream rate limit / quota exhaustion —
 * an HTTP 429, or provider text that says as much ("rate limit", "quota",
 * "free tier", "too many requests"). Used to swap in {@link SAFE_MESSAGES.rateLimited}
 * instead of a generic failure so the user knows it is transient.
 */
export const looksRateLimited = (error: unknown): boolean => {
  if (error == null) return false;

  if (typeof error === "object") {
    const record = error as {
      status?: unknown;
      statusCode?: unknown;
      code?: unknown;
    };
    const status = record.statusCode ?? record.status;
    if (status === 429 || status === "429") return true;
    if (
      record.code === "rate_limit_exceeded" ||
      record.code === "insufficient_quota"
    ) {
      return true;
    }
  }

  const text = error instanceof Error ? error.message : String(error);
  return /rate[\s-]?limit|too many requests|quota|free tier|429/i.test(text);
};

export const ERROR_CODES = [
  /** File extension / MIME type is not PDF, TXT or Markdown. */
  "ERR_UNSUPPORTED_TYPE",
  /** File is larger than MAX_UPLOAD_BYTES. */
  "ERR_FILE_TOO_LARGE",
  /** No file part in the multipart body, or it was empty. */
  "ERR_NO_FILE",
  /** The file was a supported type but the text could not be extracted. */
  "ERR_PARSE_FAILED",
  /** Text extracted, but there was nothing to chunk. */
  "ERR_EMPTY_DOCUMENT",
  /** The embedding model failed to load or run. */
  "ERR_EMBEDDING_FAILED",
  /** The pgvector top-k query failed or timed out. */
  "ERR_RETRIEVAL_FAILED",
  /** Referenced document / chat / message does not exist. */
  "ERR_NOT_FOUND",
  /** Request body or query string failed validation. */
  "ERR_BAD_REQUEST",
  /** An upstream model / gateway rate limit or quota was hit. */
  "ERR_RATE_LIMITED",
  /** A required environment variable is missing or malformed. */
  "ERR_CONFIG",
  /** Anything not otherwise classified. */
  "ERR_INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
  };
}

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly detail: string | undefined;

  constructor(
    code: ErrorCode,
    message: string,
    options: { status?: number; detail?: string; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "ApiError";
    this.code = code;
    this.status = options.status ?? defaultStatusFor(code);
    // Kept for server-side logging only — never serialised onto the wire.
    this.detail = options.detail;
  }

  toBody(): ApiErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
      },
    };
  }

  toResponse(): Response {
    return Response.json(this.toBody(), { status: this.status });
  }
}

const defaultStatusFor = (code: ErrorCode): number => {
  switch (code) {
    case "ERR_UNSUPPORTED_TYPE":
      // 415: the request was well-formed, the media type is not supported.
      return 415;
    case "ERR_FILE_TOO_LARGE":
      return 413;
    case "ERR_NO_FILE":
    case "ERR_BAD_REQUEST":
    case "ERR_EMPTY_DOCUMENT":
      return 400;
    case "ERR_NOT_FOUND":
      return 404;
    case "ERR_RATE_LIMITED":
      return 429;
    case "ERR_PARSE_FAILED":
      return 422;
    case "ERR_RETRIEVAL_FAILED":
    case "ERR_EMBEDDING_FAILED":
      return 503;
    case "ERR_CONFIG":
    case "ERR_INTERNAL":
      return 500;
  }
};

/**
 * Turn anything thrown inside a route handler into a JSON error response.
 * The full error is logged server-side; the client only ever receives a
 * stable code and curated, non-debuggable copy.
 */
export const toErrorResponse = (error: unknown): Response => {
  if (error instanceof ApiError) {
    if (error.status >= 500) console.error(`[${error.code}]`, error);
    return error.toResponse();
  }
  if (looksRateLimited(error)) {
    console.error("[ERR_RATE_LIMITED]", error);
    return new ApiError("ERR_RATE_LIMITED", SAFE_MESSAGES.rateLimited).toResponse();
  }
  console.error("[ERR_INTERNAL]", error);
  return new ApiError("ERR_INTERNAL", SAFE_MESSAGES.internal).toResponse();
};

/** The message the "Unsupported file" card shows, per spec §3h. */
export const unsupportedFileError = (filename: string, extension: string): ApiError => {
  const shown = extension ? extension.toUpperCase() : "unrecognised";
  return new ApiError(
    "ERR_UNSUPPORTED_TYPE",
    `"${filename}" is a ${shown} file. This app reads PDF, TXT and Markdown.`,
    { detail: "nothing was written to Neon" },
  );
};
