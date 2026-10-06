"use client";

import { useEffect, useRef } from "react";

const activeScopes: symbol[] = [];
const controls = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

function isVisible(element: HTMLElement): boolean {
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    if (node.hidden || node.inert) return false;
    const style = window.getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return false;
  }
  return true;
}

/** Modal keyboard scope: inert background, bounded Tab order, Escape and focus restoration. */
export function useModalFocus<T extends HTMLElement>(enabled: boolean, onClose: () => void) {
  const ref = useRef<T>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const dialog = ref.current;
    if (!enabled || !dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const token = Symbol("modal-focus");
    activeScopes.push(token);
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const background: Array<{ element: HTMLElement; inert: boolean }> = [];
    // A modal may be rendered within a page, rather than directly under body.
    // Disable only sibling branches, never its own ancestor or modal content.
    for (let branch: HTMLElement = dialog; branch.parentElement && branch !== document.body; branch = branch.parentElement) {
      for (const sibling of Array.from(branch.parentElement.children)) {
        if (sibling !== branch && sibling instanceof HTMLElement) {
          background.push({ element: sibling, inert: sibling.inert });
          sibling.inert = true;
        }
      }
    }
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(controls)).filter(element => element.tabIndex >= 0 && isVisible(element));
    (focusable()[0] ?? dialog).focus();

    function onKey(event: KeyboardEvent) {
      if (activeScopes.at(-1) !== token) return;
      if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation(); close.current();
      }
      if (event.key === "Tab") {
        const elements = focusable();
        const first = elements[0];
        const last = elements.at(-1);
        if (!first || !last) { event.preventDefault(); dialog!.focus(); return; }
        if (event.shiftKey && (document.activeElement === first || !dialog!.contains(document.activeElement))) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !dialog!.contains(document.activeElement))) {
          event.preventDefault(); first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      const index = activeScopes.indexOf(token);
      if (index >= 0) activeScopes.splice(index, 1);
      background.forEach(({ element, inert }) => { element.inert = inert; });
      document.body.style.overflow = originalOverflow;
      if (previous?.isConnected) previous.focus();
    };
  }, [enabled]);

  return ref;
}
