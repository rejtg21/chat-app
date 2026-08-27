import type { CSSProperties, ReactNode } from "react";

/**
 * The design system's framed object: square corners, a hairline border, and
 * four "+" registration marks.
 *
 * The marks are not decoration — the system's rule is that every framed
 * element wears all four, and dropping them is called out explicitly in its
 * guide. Wrapping them here means no call site can forget.
 */
export function Corners() {
  return (
    <>
      <i className="corner tl" />
      <i className="corner tr" />
      <i className="corner bl" />
      <i className="corner br" />
    </>
  );
}

interface BlueprintProps {
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
}

export function Blueprint({ children, style, className }: BlueprintProps) {
  return (
    <div className={className ? `blueprint ${className}` : "blueprint"} style={style}>
      <Corners />
      {children}
    </div>
  );
}
