'use client';

import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { IconButton } from '../../../components/ui/IconButton';
import { cn } from '../../../lib/cn';

interface ModalProps {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
}

const FOCUSABLE_SELECTOR =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function Modal({ open, title, description, onClose, children }: ModalProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open || !panelRef.current) return;

    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusables = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    const first = focusables[0];
    (first ?? panelRef.current)?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      const currentFocusables = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []);
      const currentFirst = currentFocusables[0]; const currentLast = currentFocusables[currentFocusables.length - 1];
      if (event.key !== 'Tab' || currentFocusables.length === 0) return;
      if (event.shiftKey && document.activeElement === currentFirst) {
        event.preventDefault();
        currentLast?.focus();
      } else if (!event.shiftKey && document.activeElement === currentLast) {
        event.preventDefault();
        currentFirst?.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); if (previousFocusRef.current?.isConnected) previousFocusRef.current.focus(); };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] studio-enter">
      <div aria-hidden="true" className="absolute inset-0 bg-surface-canvas/75 backdrop-blur-sm" onClick={onClose} />
      <div className="absolute inset-0 grid place-items-center p-4">
        <div
          ref={panelRef}
          role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} tabIndex={-1}
          className={cn('flex max-h-[min(760px,calc(100dvh-2rem))] w-full max-w-[640px] flex-col overflow-hidden rounded-[var(--radius-modal)] border border-border bg-surface-overlay shadow-overlay')}
        >
          <header className="flex items-start justify-between gap-3 border-b border-border-muted p-4">
            <div>
              <h2 id={titleId} className="text-title-s text-text-primary">{title}</h2>
              {description ? <p id={descriptionId} className="mt-1 text-body-s text-text-secondary">{description}</p> : null}
            </div>
            <IconButton icon={<X className="h-4 w-4" />} label="Close modal" onClick={onClose} />
          </header>
          <div className="min-h-0 overflow-y-auto p-4">{children}</div>
        </div>
      </div>
    </div>
  );
}
