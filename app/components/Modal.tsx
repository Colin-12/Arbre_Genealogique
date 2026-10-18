"use client";

import { useEffect, useId, type FormEvent, type ReactNode } from "react";

type Props = {
  title: ReactNode;
  onClose: () => void;
  /** Empêche de fermer pendant un enregistrement. */
  busy?: boolean;
  onSubmit?: (e: FormEvent) => void;
  children: ReactNode;
};

/** Fenêtre de dialogue : centrée sur ordinateur, panneau qui monte du bas sur téléphone. */
export default function Modal({ title, onClose, busy = false, onSubmit, children }: Props) {
  const titleId = useId();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  return (
    <div className="arbre-modal-backdrop">
      <form
        className="arbre-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit?.(e);
        }}
      >
        <h2 id={titleId}>{title}</h2>
        {children}
      </form>
    </div>
  );
}
