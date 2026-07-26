'use client';

import { AlertTriangle } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { Modal } from './Modal';

export function ConfirmDialog({ open, title, description, confirmLabel = 'Confirm', danger = false, busy = false, onCancel, onConfirm }: { open: boolean; title: string; description: string; confirmLabel?: string; danger?: boolean; busy?: boolean; onCancel: () => void; onConfirm: () => void }) {
  return <Modal open={open} title={title} description={description} onClose={onCancel}><div className="flex gap-3 rounded-[var(--radius-card)] border border-border-muted bg-surface-tint p-3"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-status-warning"/><p className="text-body-s text-text-secondary">Review the impact before continuing. This action is recorded in workspace history when supported.</p></div><div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button><Button variant={danger ? 'danger' : 'primary'} loading={busy} onClick={onConfirm}>{confirmLabel}</Button></div></Modal>;
}
