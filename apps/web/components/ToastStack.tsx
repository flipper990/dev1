'use client';
import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react';
import { useStore } from '../lib/store';
import { cn } from '../lib/cn';

const AUTO_DISMISS_MS = 5000;

const TOAST_STYLE = {
  success: { icon: CheckCircle2, color: '#22C55E', border: 'border-l-[#22C55E]',  bg: 'bg-[#22C55E]/[0.08]' },
  error:   { icon: XCircle,      color: '#EF4444', border: 'border-l-[#EF4444]',  bg: 'bg-[#EF4444]/[0.08]' },
  warning: { icon: AlertTriangle, color: '#F59E0B', border: 'border-l-[#F59E0B]', bg: 'bg-[#F59E0B]/[0.08]' },
  info:    { icon: Info,          color: '#3B82F6', border: 'border-l-[#3B82F6]',  bg: 'bg-[#3B82F6]/[0.08]' },
} as const;

export function ToastStack() {
  const { toasts, removeToast } = useStore();

  return (
    <div
      className="fixed right-4 flex flex-col-reverse gap-2 z-[200] pointer-events-none"
      style={{ bottom: 'calc(var(--logs-bar-h) + 12px)' }}
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={() => removeToast(toast.id)} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: { id: string; type: keyof typeof TOAST_STYLE; title: string; message?: string };
  onDismiss: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [onDismiss]);

  const style = TOAST_STYLE[toast.type];
  const Icon  = style.icon;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 20, scale: 0.95 }}
      animate={{ opacity: 1, x: 0,  scale: 1 }}
      exit={{ opacity: 0, x: 20, scale: 0.95 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className={cn(
        'pointer-events-auto flex items-start gap-3 border border-l-4 border-white/[0.08] rounded-xl px-3.5 py-3 shadow-panel min-w-[260px] max-w-[360px] backdrop-blur-xl',
        style.border,
        style.bg,
        'bg-[#151B2B]',
      )}
    >
      <Icon size={16} style={{ color: style.color }} className="mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-semibold text-[#F1F5F9]">{toast.title}</div>
        {toast.message && (
          <div className="text-[11px] text-[#64748B] mt-0.5">{toast.message}</div>
        )}
      </div>
      <button
        onClick={onDismiss}
        className="flex-shrink-0 text-[#64748B] hover:text-[#F1F5F9] transition-colors p-0.5 mt-0.5"
      >
        <X size={13} />
      </button>
    </motion.div>
  );
}

