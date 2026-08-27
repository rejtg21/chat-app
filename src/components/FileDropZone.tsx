"use client";

import { Upload } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type ReactNode,
} from "react";
import { Corners } from "@/components/Blueprint";

/**
 * Makes a region accept a file dropped anywhere inside it — over the thread,
 * over the composer, over the empty state. The first dropped file is handed to
 * `onDropFile`; validation and error reporting stay in the caller's upload
 * path, so an unsupported drop lands the same "Unsupported file" card as the
 * file picker would.
 *
 * dragenter/dragleave also fire as the pointer crosses child elements, so a
 * depth counter tracks whether the pointer is genuinely inside the zone rather
 * than toggling the overlay on every hover boundary.
 */
export const FileDropZone = ({
  onDropFile,
  disabled = false,
  hint = "PDF, TXT or Markdown",
  style,
  children,
}: {
  onDropFile: (file: File) => void;
  disabled?: boolean;
  hint?: string;
  style?: CSSProperties;
  children: ReactNode;
}) => {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);

  // A file dropped outside the zone would otherwise make the browser navigate
  // away to render it. Swallow that default everywhere while this zone is
  // mounted; drops that land inside still get their own handler.
  useEffect(() => {
    const swallow = (event: Event) => event.preventDefault();
    window.addEventListener("dragover", swallow);
    window.addEventListener("drop", swallow);
    return () => {
      window.removeEventListener("dragover", swallow);
      window.removeEventListener("drop", swallow);
    };
  }, []);

  const carriesFiles = (event: DragEvent) =>
    Array.from(event.dataTransfer.types).includes("Files");

  const onDragEnter = useCallback(
    (event: DragEvent) => {
      if (disabled || !carriesFiles(event)) return;
      event.preventDefault();
      depth.current += 1;
      setDragging(true);
    },
    [disabled],
  );

  const onDragOver = useCallback(
    (event: DragEvent) => {
      if (disabled || !carriesFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    [disabled],
  );

  const onDragLeave = useCallback(
    (event: DragEvent) => {
      if (disabled || !carriesFiles(event)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    },
    [disabled],
  );

  const onDrop = useCallback(
    (event: DragEvent) => {
      depth.current = 0;
      setDragging(false);
      if (disabled || !carriesFiles(event)) return;
      event.preventDefault();
      const file = event.dataTransfer.files[0];
      if (file) onDropFile(file);
    },
    [disabled, onDropFile],
  );

  return (
    <div
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{ position: "relative", ...style }}
    >
      {children}

      {dragging ? (
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: "var(--space-3)",
            zIndex: 20,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "var(--space-3)",
            pointerEvents: "none",
            border: "1px dashed var(--color-accent)",
            background:
              "color-mix(in srgb, var(--color-accent) 12%, var(--color-bg))",
            color: "var(--color-accent-800)",
          }}
        >
          <Corners />
          <Upload size={30} strokeWidth={1.5} aria-hidden />
          <div style={{ textAlign: "center", lineHeight: 1.4 }}>
            <div style={{ fontSize: 15, fontWeight: 500 }}>
              Drop your file here to add it
            </div>
            <div style={{ fontSize: 12, color: "var(--color-accent-700)" }}>
              {hint} — up to 20 MB
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
