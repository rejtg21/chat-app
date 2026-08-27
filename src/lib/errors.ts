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
 *   { error: { code, message, detail? } }
 */

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
    /** Operator-facing extra context. Rendered as the small mono code line. */
    detail?: string;
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
    this.detail = options.detail;
  }

  toBody(): ApiErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.detail === undefined ? {} : { detail: this.detail }),
      },
    };
  }

  toResponse(): Response {
    return Response.json(this.toBody(), { status: this.status });
  }
}

function defaultStatusFor(code: ErrorCode): number {
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
    case "ERR_PARSE_FAILED":
      return 422;
    case "ERR_RETRIEVAL_FAILED":
    case "ERR_EMBEDDING_FAILED":
      return 503;
    case "ERR_CONFIG":
    case "ERR_INTERNAL":
      return 500;
  }
}

/**
 * Turn anything thrown inside a route handler into a JSON error response.
 * Unknown errors are logged in full but reported opaquely.
 */
export function toErrorResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    if (error.status >= 500) console.error(`[${error.code}]`, error);
    return error.toResponse();
  }
  console.error("[ERR_INTERNAL]", error);
  return new ApiError("ERR_INTERNAL", "Something went wrong on the server.", {
    detail: error instanceof Error ? error.message : String(error),
  }).toResponse();
}

/** The message the "Unsupported file" card shows, per spec §3h. */
export function unsupportedFileError(filename: string, extension: string): ApiError {
  const shown = extension ? extension.toUpperCase() : "unrecognised";
  return new ApiError(
    "ERR_UNSUPPORTED_TYPE",
    `"${filename}" is a ${shown} file. This app reads PDF, TXT and Markdown.`,
    { detail: "nothing was written to Neon" },
  );
}
