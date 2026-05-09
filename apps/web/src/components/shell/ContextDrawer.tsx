'use client';

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../../lib/cn';

interface ContextDrawerProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
}

const FOCUSABLE_SELECTOR =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function ContextDrawer({
  open,
  onClose,
  title = 'Context',
  description,
  children,
  className,
}: ContextDrawerProps) {
  const mobileRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const isDesktop = window.matchMedia('(min-width: 1280px)').matches;
    if (isDesktop) return;

    const panel = mobileRef.current;
    if (!panel) return;

    const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    first?.focus();

    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== 'Tab' || focusables.length === 0) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    document.addEventListener('keydown', handleKeydown);
    return () => document.removeEventListener('keydown', handleKeydown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <aside
        className={cn(
          'hidden h-full w-[340px] shrink-0 border-l border-border bg-surface-raised xl:flex xl:flex-col',
          className,
        )}
        aria-label="Context panel"
      >
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-label-m text-ink">{title}</h2>
          {description ? <p className="mt-1 text-label-s text-secondary">{description}</p> : null}
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">{children}</div>
      </aside>

      <div className="fixed inset-0 z-50 xl:hidden" role="dialog" aria-modal="true" aria-label={title}>
        <button
          type="button"
          aria-label="Close context panel"
          className="absolute inset-0 bg-ink/30"
          onClick={onClose}
        />
        <div
          ref={mobileRef}
          className="absolute inset-y-0 right-0 flex w-full max-w-[380px] flex-col border-l border-border bg-surface-raised"
        >
          <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
            <div>
              <h2 className="text-label-m text-ink">{title}</h2>
              {description ? <p className="mt-1 text-label-s text-secondary">{description}</p> : null}
            </div>
            <button
              type="button"
              aria-label="Close context panel"
              onClick={onClose}
              className="inline-grid h-10 w-10 place-items-center rounded-[var(--radius-control)] border border-border bg-surface-raised text-secondary hover:bg-surface-tint focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-4">{children}</div>
        </div>
      </div>
    </>
  );
}
