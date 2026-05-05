'use client';

import { Check, Copy } from 'lucide-react';
import { useCallback, useState } from 'react';
import { cn } from '../../lib/cn';

/**
 * ProjectIdChip — uniform identity badge for a project.
 *
 * Renders the (optionally truncated) projectId in a monospace pill with a
 * one-click copy button. Used everywhere project identity must be
 * unambiguous: recent-projects list, active-project header, and the
 * logs/debug panel. The full id is always available via the title tooltip
 * and via the copy button (which copies the FULL id regardless of label).
 */
export interface ProjectIdChipProps {
  id: string;
  /** When true (default in compact lists), show only the first 8 chars. */
  truncate?: boolean;
  /** Visual size. */
  size?: 'xs' | 'sm';
  /** Hide the inline copy button (the chip itself stays). */
  hideCopy?: boolean;
  className?: string;
}

export function ProjectIdChip({
  id,
  truncate = false,
  size = 'sm',
  hideCopy = false,
  className,
}: ProjectIdChipProps) {
  const [copied, setCopied] = useState(false);

  const onCopy = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(id);
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      } catch {
        // Clipboard API can fail in insecure contexts; fall back to a
        // selection-based copy so the user still gets the value.
        const ta = document.createElement('textarea');
        ta.value = id;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); setCopied(true); setTimeout(() => setCopied(false), 1400); }
        finally { document.body.removeChild(ta); }
      }
    },
    [id],
  );

  const display = truncate ? `${id.slice(0, 8)}…` : id;
  const padding = size === 'xs' ? 'px-1.5 py-[1px]' : 'px-2 py-0.5';
  const fontSize = size === 'xs' ? 'text-[10px]' : 'text-[11px]';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded font-mono',
        padding,
        fontSize,
        className,
      )}
      style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-subtle)',
        color: 'var(--text-secondary)',
      }}
      title={`Project ID: ${id}`}
    >
      <span className="select-all">{display}</span>
      {!hideCopy && (
        <button
          type="button"
          onClick={onCopy}
          aria-label={copied ? 'Project ID copied' : 'Copy project ID'}
          className={cn(
            'grid place-items-center rounded transition-colors',
            size === 'xs' ? 'h-3.5 w-3.5' : 'h-4 w-4',
            copied
              ? 'text-[var(--success)]'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)]',
          )}
        >
          {copied ? <Check size={10} /> : <Copy size={10} />}
        </button>
      )}
    </span>
  );
}
