"use client";

import { useEffect, useState } from "react";

export default function Splash() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timeout = setTimeout(() => setVisible(false), 1500);
    return () => clearTimeout(timeout);
  }, []);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0a0a0a]">
      <div className="flex flex-col items-center select-none">
        <img
          src="/logo.png"
          alt="Aster Logo"
          className="h-16 w-16 splash-item"
          style={{ animationDelay: "0ms" }}
        />
        <div className="mt-4 flex items-start gap-3 text-white font-bold tracking-tight leading-none">
          <div className="flex items-start gap-3">
            <span
              className="splash-item text-4xl sm:text-5xl"
              style={{ animationDelay: "375ms" }}
            >
              Aster
            </span>
            <span
              className="splash-item text-4xl sm:text-5xl"
              style={{ animationDelay: "750ms" }}
            >
              AI
            </span>
            <span
              className="splash-item text-4xl sm:text-5xl"
              style={{ animationDelay: "1125ms" }}
            >
              Agent
            </span>
          </div>
          <span
            className="splash-item relative -top-1 inline-flex items-center rounded px-2 py-0.5 text-[10px] leading-none bg-[#f2b46d] text-white"
            style={{ animationDelay: "1350ms" }}
          >
            BETA
          </span>
        </div>
      </div>
    </div>
  );
}


