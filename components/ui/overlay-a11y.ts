'use client';

import * as React from 'react';

export function blurActiveElement() {
  const active = document.activeElement;
  if (active instanceof HTMLElement) active.blur();
}

/** Portaled Select/Menu/Popover content lives outside the overlay DOM; ignore those events. */
export function isPortaledOverlayTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest('[data-radix-select-content]') ||
      target.closest('[data-radix-popper-content-wrapper]') ||
      target.closest('[data-radix-menu-content]') ||
      target.closest('[role="listbox"]')
  );
}

function isInsideClosingDialog(node: EventTarget | null) {
  return node instanceof HTMLElement && Boolean(node.closest('[role="dialog"][data-state="closed"]'));
}

let closeGuardTimer: ReturnType<typeof setTimeout> | undefined;
let closeGuardListener: ((event: FocusEvent) => void) | undefined;

/** Drop focus that Select/Combobox restores into a dialog that is already closing. */
export function guardFocusDuringDialogClose() {
  if (closeGuardListener) {
    document.removeEventListener('focusin', closeGuardListener, true);
  }
  closeGuardListener = (event: FocusEvent) => {
    if (isInsideClosingDialog(event.target)) {
      (event.target as HTMLElement).blur();
    }
  };
  document.addEventListener('focusin', closeGuardListener, true);
  if (closeGuardTimer) window.clearTimeout(closeGuardTimer);
  closeGuardTimer = window.setTimeout(() => {
    if (closeGuardListener) {
      document.removeEventListener('focusin', closeGuardListener, true);
      closeGuardListener = undefined;
    }
    closeGuardTimer = undefined;
  }, 400);
}

/**
 * Keeps Radix overlays `open` for one layout frame after a controlled close so we
 * can blur before Presence applies aria-hidden (Chrome blocks aria-hidden on a
 * focused descendant).
 */
export function useDeferredOverlayOpen(
  open: boolean | undefined,
  onOpenChange?: (open: boolean) => void
) {
  const isControlled = open !== undefined;
  const [renderedOpen, setRenderedOpen] = React.useState(open);
  const wasOpen = React.useRef(Boolean(open));

  React.useLayoutEffect(() => {
    if (!isControlled) return;
    if (open) {
      wasOpen.current = true;
      setRenderedOpen(true);
      return;
    }
    if (wasOpen.current) {
      wasOpen.current = false;
      blurActiveElement();
      guardFocusDuringDialogClose();
    }
    setRenderedOpen(false);
  }, [isControlled, open]);

  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        blurActiveElement();
        guardFocusDuringDialogClose();
      }
      onOpenChange?.(nextOpen);
    },
    [onOpenChange]
  );

  return {
    open: isControlled ? Boolean(renderedOpen) : open,
    onOpenChange: handleOpenChange,
  };
}
