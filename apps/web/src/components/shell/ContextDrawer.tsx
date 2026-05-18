'use client';

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { IconButton } from '../../../components/ui/IconButton';
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

export function ContextDrawer({ open, onClose, title = 'Context', description, children, className }: ContextDrawerProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const panel = panelRef.current;
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
    <div className="fixed inset-0 top-[var(--shell-header-offset)] z-[60]" role="dialog" aria-modal="true" aria-label={title}>
      <button
        type="button"
        aria-label="Close context drawer"
        className="absolute inset-0 bg-text-primary/24 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className={cn(
          'studio-glass absolute inset-y-0 right-0 flex w-full max-w-[430px] flex-col rounded-l-[var(--radius-modal)]',
          'sm:max-w-[462px]',
          className,
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border-muted px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-title-s text-text-primary">{title}</h2>
            {description ? <p className="mt-1 text-body-s text-text-secondary">{description}</p> : null}
          </div>
          <IconButton icon={<X className="h-4 w-4" aria-hidden="true" />} label="Close context drawer" onClick={onClose} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-5 pb-[calc(var(--safe-bottom)+var(--space-6))]">{children}</div>
      </div>
    </div>
  );
}
