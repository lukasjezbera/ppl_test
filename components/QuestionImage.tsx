"use client";

import { useState } from "react";

export default function QuestionImage({ src, alt }: { src: string; alt: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <img
        src={src}
        alt={alt}
        onClick={() => setOpen(true)}
        className="max-w-md w-full rounded-xl border border-white/10 cursor-zoom-in mx-auto"
      />

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
        >
          <img
            src={src}
            alt={alt}
            className="max-w-full max-h-full rounded-xl"
          />
        </div>
      )}
    </>
  );
}
