'use client';
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react';
import { useStore } from '../lib/store';
import { cn } from '../lib/cn';

const AUTO_DISMISS_MS = 5000;

const TOAST_STYLE = {
  success: { icon: CheckCircle2,  color: '#22C55E', border: 'border-l-[#22C55E]',  bg: 'bg-[#22C55E]/[0.08]' },
  error:   { icon: XCircle,       color: '#EF4444', border: 'border-l-[#EF4444]',  bg: 'bg-[#EF4444]/[0.08]' },
  warning: { icon: AlertTriangle, color: '#F59E0B', border: 'border-l-[#F59E0B]',  bg: 'bg-[#F59E0B]/[0.08]' },
  info:    { icon: Info,          color: '#3B82F6', border: 'border-l-[#3B82F6]',  bg: 'bg-[#3B82F6]/[0.08]' },
} as const;

export function ToastStack() {
  const { toasts, removeToast } = useStore();

  return (
    <div
      className="fixed right-4 flex flex-col-reverse gap-2 z-[200] pointer-events-none"
      style={{ bottom: 'calc(var(--logs-bar-h) + 12px)' }}
      aria-live="polite"
      aria-atomic="false"
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
  const [paused, setPaused] = useState(false);
  const elapsedRef = useRef(0);
  const startedAtRef = useRef<number>(Date.now());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Progress state for the countdown bar. rAF-driven only while not paused.
  const [progress, setProgress] = useState(0); // 0 → 1 over AUTO_DISMISS_MS

  // Schedule dismiss honouring paused state.
  useEffect(() => {
    if (paused) {
      if (timerRef.current) clearTimeout(timerRef.current);
      elapsedRef.current += Date.now() - startedAtRef.current;
      return;
    }
    startedAtRef.current = Date.now();
    const remaining = Math.max(0, AUTO_DISMISS_MS - elapsedRef.current);
    timerRef.current = setTimeout(onDismiss, remaining);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [paused, onDismiss]);

  // Animate the progress bar via rAF so it stays visually smooth and
  // automatically freezes while paused.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const effective = paused ? elapsedRef.current : elapsedRef.current + (Date.now() - startedAtRef.current);
      setProgress(Math.min(1, effective / AUTO_DISMISS_MS));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [paused]);

  const style = TOAST_STYLE[toast.type];
  const Icon  = style.icon;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 20, scale: 0.95 }}
      animate={{ opacity: 1, x: 0,  scale: 1 }}
      exit={{ opacity: 0, x: 20, scale: 0.95 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      role="status"
      className={cn(
        'pointer-events-auto relative flex items-start gap-3 border border-l-4 border-white/[0.08] rounded-xl px-3.5 py-3 shadow-panel min-w-[260px] max-w-[360px] backdrop-blur-xl overflow-hidden',
        style.border,
        style.bg,
        'bg-[#151B2B]',
      )}
    >
      <Icon size={16} style={{ color: style.color }} className="mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-semibold text-[#F1F5F9]">{toast.title}</div>
        {toast.message && (
          <div className="text-[11px] text-[#64748B] mt-0.5 leading-relaxed">{toast.message}</div>
        )}
      </div>
      <button
        onClick={onDismiss}
        title="Dismiss"
        className="flex-shrink-0 text-[#64748B] hover:text-[#F1F5F9] transition-colors p-0.5 mt-0.5"
      >
        <X size={13} />
      </button>

      {/* Countdown progress bar — pauses on hover/focus for a premium feel. */}
      <span
        aria-hidden="true"
        className="absolute left-0 bottom-0 h-[2px] will-change-[width] transition-[width] duration-100 ease-linear"
        style={{ width: `${(1 - progress) * 100}%`, background: style.color, opacity: 0.7 }}
      />
    </motion.div>
  );
}


