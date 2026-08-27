import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

/**
 * Single source of truth for the values that have to agree across the
 * database schema, the API routes and the UI copy.
 *
 * EMBEDDING_DIMENSIONS in particular is load-bearing: it must match the
 * `vector(N)` column width in db/migrations/0001_init.sql. Changing the
 * embedding model means changing both, and re-indexing every document.
 */

/** Local, free, runs server-side via Transformers.js. 384-dimensional. */
export const EMBEDDING_MODEL = "Supabase/gte-small";
export const EMBEDDING_DIMENSIONS = 384;

/**
 * Local-model escape hatch. Set LMSTUDIO_BASE_URL (e.g.
 * "http://localhost:1234/v1") to route every LLM call at an OpenAI-compatible
 * server — LM Studio, Ollama, llama.cpp — instead of the Vercel AI Gateway.
 * Unset it and the Gateway path below is unchanged.
 */
const lmStudio = process.env.LMSTUDIO_BASE_URL
  ? createOpenAICompatible({
      name: "lmstudio",
      baseURL: process.env.LMSTUDIO_BASE_URL,
      // LM Studio ignores the key but the SDK still sends an Authorization header.
      apiKey: process.env.LMSTUDIO_API_KEY ?? "lm-studio",
    })
  : null;

/**
 * Chat model. Through the Vercel AI Gateway by default, addressed as a plain
 * "provider/model" string; override with CHAT_MODEL to swap providers without
 * touching code. When LMSTUDIO_BASE_URL is set, CHAT_MODEL is instead the id
 * of the model loaded in LM Studio.
 */
export const CHAT_MODEL: LanguageModel = lmStudio
  ? lmStudio(process.env.CHAT_MODEL ?? "local-model")
  : process.env.CHAT_MODEL ?? "anthropic/claude-sonnet-5";

/**
 * Model used for the post-answer annotation pass (citations + the structured
 * component). Cheaper/faster than the answer model by default. Falls back to
 * the chat model when running locally — one loaded model is the common case.
 */
export const ANNOTATION_MODEL: LanguageModel = lmStudio
  ? lmStudio(
      process.env.ANNOTATION_MODEL ?? process.env.CHAT_MODEL ?? "local-model",
    )
  : process.env.ANNOTATION_MODEL ??
    process.env.CHAT_MODEL ??
    "anthropic/claude-haiku-4.5";

/** Upload limits, per the design's "PDF · TXT · MD — up to 20 MB". */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const ACCEPTED_EXTENSIONS = ["pdf", "txt", "md", "markdown"] as const;
export const ACCEPT_ATTRIBUTE = ".pdf,.txt,.md,.markdown";

/** Retrieval. */
export const RETRIEVAL_TOP_K = 5;

/**
 * Cosine similarity below which a chunk is not considered to answer the
 * question. When nothing clears it, the answer is still a first-class answer
 * — it just carries no citations and no structured component.
 *
 * The value is model-specific and has to be measured, not guessed. gte-small
 * has a high similarity floor: against the bundled sample, questions with no
 * answer in the document ("What is the capital of Peru?", "How do I bake
 * sourdough?") still score 0.685–0.781, while genuinely on-topic questions
 * score 0.836–0.897 at the top chunk. 0.80 sits in that gap.
 *
 * A naive low threshold like 0.3 would make the "no passage above threshold"
 * state unreachable, and every off-topic question would get a confident
 * answer assembled from unrelated passages.
 *
 * Retune this when changing the embedding model or moving to a corpus with a
 * very different register; SIMILARITY_THRESHOLD is env-overridable so that
 * does not require a code change.
 */
export const SIMILARITY_THRESHOLD = Number(
  process.env.SIMILARITY_THRESHOLD ?? 0.8,
);

/** Chunking. Sized so a chunk is a readable excerpt in the source pane. */
export const CHUNK_TARGET_CHARS = 900;
export const CHUNK_OVERLAP_CHARS = 160;

/** Shown in the header and the source-pane footer. */
export const DB_LABEL = "Neon";
export const STORE_LINE = "Your document and chat history are saved automatically.";
