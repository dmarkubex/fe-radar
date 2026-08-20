"use client";

import { useRef } from "react";
import { useModalBehavior } from "@/hooks/use-modal-behavior";
import { cn } from "@/lib/utils";

export function Dialog({
  ariaLabel,
  children,
  enabled = true,
  onClose,
  open,
  overlayClassName,
  panelClassName
}: {
  ariaLabel: string;
  children: React.ReactNode;
  // enabled=false 时该层不响应 Escape/Tab、不锁滚动、不抢焦点（多层叠加时只留顶层交互）
  enabled?: boolean;
  onClose: () => void;
  open: boolean;
  overlayClassName?: string;
  panelClassName?: string;
}): React.JSX.Element | null {
  const panelRef = useRef<HTMLDivElement>(null);
  useModalBehavior({ enabled, onClose, open, panelRef });

  if (!open) return null;

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60",
        overlayClassName
      )}
    >
      <div
        aria-label={ariaLabel}
        aria-modal="true"
        className={panelClassName}
        ref={panelRef}
        role="dialog"
      >
        {children}
      </div>
    </div>
  );
}
