import {
  pipeline,
  type FeatureExtractionPipeline,
} from "@huggingface/transformers";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from "@/lib/config";
import { ApiError } from "@/lib/errors";

/**
 * Free, local embeddings.
 *
 * Supabase/gte-small runs server-side through Transformers.js — no API key,
 * no per-token cost, which is what keeps this inside the "no paid services"
 * constraint. It is 384-dimensional; that number is mirrored in
 * EMBEDDING_DIMENSIONS and in the `vector(384)` column, and all three have to
 * move together.
 *
 * The first call downloads the weights (~35 MB) and takes roughly 15 seconds.
 * Every later call in the same process reuses the warm pipeline, so the
 * promise — not the resolved pipeline — is cached: two concurrent callers
 * during a cold start must await the same load rather than starting two.
 *
 * NOTE: `onnxruntime-node` needs its native binary, and pnpm skips postinstall
 * scripts unless the package is allow-listed. `pnpm-workspace.yaml` sets
 * `allowBuilds: onnxruntime-node: true` for exactly this reason — without it
 * this module throws at runtime with a confusing error.
 */

let pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

function getPipeline(): Promise<FeatureExtractionPipeline> {
  if (!pipelinePromise) {
    pipelinePromise = pipeline("feature-extraction", EMBEDDING_MODEL).catch(
      (cause: unknown) => {
        // Clear the cache so a later request can retry a transient failure
        // (a download hiccup on a cold serverless instance, typically).
        pipelinePromise = null;
        throw new ApiError(
          "ERR_EMBEDDING_FAILED",
          "The embedding model could not be loaded.",
          {
            detail: cause instanceof Error ? cause.message : String(cause),
            cause,
          },
        );
      },
    );
  }
  return pipelinePromise;
}

function assertWidth(vector: number[]): number[] {
  if (vector.length !== EMBEDDING_DIMENSIONS) {
    throw new ApiError(
      "ERR_EMBEDDING_FAILED",
      "The embedding model returned an unexpected vector width.",
      {
        detail: `expected ${EMBEDDING_DIMENSIONS}, got ${vector.length}`,
      },
    );
  }
  return vector;
}

/**
 * Embed a batch of texts. Vectors come back mean-pooled and L2-normalised,
 * so a cosine comparison in pgvector is just `1 - (a <=> b)`.
 */
export async function embedTexts(texts: readonly string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const extractor = await getPipeline();
  const tensor = await extractor(texts as string[], {
    pooling: "mean",
    normalize: true,
  });

  const flat = Array.from(tensor.data as ArrayLike<number>, Number);
  const width = flat.length / texts.length;

  if (!Number.isInteger(width)) {
    throw new ApiError(
      "ERR_EMBEDDING_FAILED",
      "The embedding model returned a malformed tensor.",
      { detail: `${flat.length} values for ${texts.length} inputs` },
    );
  }

  return texts.map((_, index) =>
    assertWidth(flat.slice(index * width, (index + 1) * width)),
  );
}

/** Embed one text — the query side of retrieval. */
export async function embedText(text: string): Promise<number[]> {
  const [vector] = await embedTexts([text]);
  if (!vector) {
    throw new ApiError("ERR_EMBEDDING_FAILED", "The query could not be embedded.");
  }
  return vector;
}
