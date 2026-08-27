import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Transformers.js loads ONNX weights and, through onnxruntime-node, a
   * native `.node` binary. Bundling either breaks them — the loader resolves
   * paths relative to the package on disk. Keeping them external leaves them
   * in node_modules where their own resolution works.
   */
  serverExternalPackages: [
    "@huggingface/transformers",
    "onnxruntime-node",
    "sharp",
  ],
  /**
   * onnxruntime-node's native addon dynamically links `libonnxruntime.so.1`
   * from its own directory ($ORIGIN RPATH). Output file tracing follows
   * `require()` calls, so it copies the `.node` addon but never sees the
   * sibling `.so` — the deployed function then fails with
   * "libonnxruntime.so.1: cannot open shared object file". Force the whole
   * binary directory into the trace for the routes that embed. The
   * `.pnpm/onnxruntime-node@*` path is where pnpm keeps it (it is a
   * transitive dep, so there is no top-level node_modules/onnxruntime-node).
   */
  outputFileTracingIncludes: {
    "/api/documents": [
      "./node_modules/.pnpm/onnxruntime-node@*/node_modules/onnxruntime-node/bin/**/*",
    ],
    "/api/chat": [
      "./node_modules/.pnpm/onnxruntime-node@*/node_modules/onnxruntime-node/bin/**/*",
    ],
  },
};

export default nextConfig;
