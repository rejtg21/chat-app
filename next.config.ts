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
};

export default nextConfig;
