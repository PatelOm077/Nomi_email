import type { HTMLAttributes } from "react";

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "s-app-nav": HTMLAttributes<HTMLElement>;
    }
  }
}

export {};
