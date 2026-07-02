"use client";

import { useEffect } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * 弹窗 / 抽屉共用的可访问性行为：Escape 关闭、body 滚动锁定、基础焦点陷阱。
 *
 * 调用方负责把 panelRef 绑到可聚焦的覆盖层面板上。焦点返回触发元素由调用方
 * 自行管理（保持 hook 单一职责）。
 */
export function useModalBehavior({
  onClose,
  open,
  panelRef
}: {
  onClose: () => void;
  open: boolean;
  panelRef: React.RefObject<HTMLElement | null>;
}): void {
  // Escape 关闭 + 焦点陷阱
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab" && event.key !== "Escape") return;

      if (event.key === "Escape") {
        onClose();
        return;
      }

      // Tab 焦点陷阱：在 panel 首尾可聚焦元素间循环
      if (!panel) return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;

      if (event.shiftKey) {
        if (active === first || !panel.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else {
        if (active === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, panelRef]);

  // 打开时聚焦面板，并锁定 body 滚动
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // 聚焦面板首个可聚焦元素（无则聚焦面板自身）
    if (panel) {
      const first = panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      if (first) {
        first.focus();
      } else if (!panel.hasAttribute("tabindex")) {
        panel.setAttribute("tabindex", "-1");
        panel.focus();
      } else {
        panel.focus();
      }
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open, panelRef]);
}
