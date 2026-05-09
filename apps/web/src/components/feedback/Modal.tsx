'use client';

import { useEffect, useRef } from 'react';
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

  useEffect(() => {
    if (!open || !panelRef.current) return;

    const focusables = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    first?.focus();

    const onKey = (event: KeyboardEvent) => {
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

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Close modal" className="absolute inset-0 bg-text-primary/35" onClick={onClose} />
      <div className="absolute inset-0 grid place-items-center p-4">
        <div
          ref={panelRef}
          className={cn('flex max-h-[min(760px,calc(100vh-2rem))] w-full max-w-[640px] flex-col overflow-hidden rounded-[var(--radius-modal)] border border-border bg-surface-overlay shadow-overlay')}
        >
          <header className="flex items-start justify-between gap-3 border-b border-border-muted p-4">
            <div>
              <h2 className="text-title-s text-text-primary">{title}</h2>
              {description ? <p className="mt-1 text-body-s text-text-secondary">{description}</p> : null}
            </div>
            <IconButton icon={<X className="h-4 w-4" />} label="Close modal" onClick={onClose} />
          </header>
          <div className="min-h-0 overflow-y-auto p-4">{children}</div>
        </div>
      </div>
    </div>
  );
}
