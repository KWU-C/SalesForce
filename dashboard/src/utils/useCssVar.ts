"use client";

import { useEffect, useState } from "react";

export function useCssVar(name: string, fallback: string): string {
  const [value, setValue] = useState(fallback);

  useEffect(() => {
    const read = () => {
      const v = getComputedStyle(document.documentElement)
        .getPropertyValue(name)
        .trim();
      if (v) setValue(v);
    };
    read();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", read);
    return () => mq.removeEventListener("change", read);
  }, [name]);

  return value;
}
