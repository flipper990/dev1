'use client';

// Dev-only diagnostics overlay for project status reconciliation.
//
// Renders a compact floating panel in the bottom-right corner showing
// the canonical state of the currently-selected project. Designed to
// answer "why are these two surfaces showing different statuses for
// the same id?" without leaving the page.
//
// Always shows the RAW backend values verbatim — this overlay is
// explicitly NOT in the business of inventing or masking status. The
// `consistency` row tells you whether the backend pair is logically
// coherent.
//
// The component is gated behind NODE_ENV !== 'production' AND the
// localStorage flag `devteam:status-debug` (so it can be toggled
// without a rebuild). Open the browser console and run
//   localStorage.setItem('devteam:status-debug', '1')
// to enable.

import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../lib/store';
import { reconcileProjectStatus } from '../../lib/project-status';

export function StatusDebugOverlay() {
  const projects = useStore((s) => s.projects);
  const selectedProjectId = useStore((s) => s.selectedProjectId);
  const isGenerating = useStore((s) => s.isGenerating);

  // Re-read the toggle on mount + on storage events from other tabs.
  // We deliberately DON'T persist the toggle in zustand to keep this
  // overlay fully orthogonal to product state.
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const read = () => {
      try {
        setEnabled(window.localStorage.getItem('devteam:status-debug') === '1');
      } catch {
        setEnabled(false);
      }
    };
    read();
    window.addEventListener('storage', read);
    return () => window.removeEventListener('storage', read);
  }, []);

  // Track the wall-clock time of the most recent change to either
  // raw status field for the active project. Used as a "last refresh"
  // indicator so the developer can spot a hung dashboard at a glance.
  const selected =
    selectedProjectId && selectedProjectId !== '__new__'
      ? projects.find((p) => p.id === selectedProjectId) ?? null
      : null;
  const r = reconcileProjectStatus(selected);
  const lastSigRef = useRef<string | null>(null);
  const [lastRefreshAt, setLastRefreshAt] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const sig = `${selected?.id ?? ''}|${r.projectStatus}|${r.previewStatus ?? 'null'}`;
    if (lastSigRef.current !== sig) {
      lastSigRef.current = sig;
      setLastRefreshAt(Date.now());
    }
  }, [enabled, selected?.id, r.projectStatus, r.previewStatus]);

  if (process.env.NODE_ENV === 'production' || !enabled) return null;

  const recentCardEntry = selected ?? null;
  const headerSource =
    `AppHeader: project.status="${r.projectStatus}" + ` +
    `(isGenerating=${String(isGenerating)})`;
  const recentCardSource = recentCardEntry
    ? `RightStats.ProjectRow: project.status="${recentCardEntry.status}"`
    : '(no record in store.projects)';
  const previewPaneSource = `PreviewStage: build="${r.projectStatus}" preview="${r.previewStatus ?? 'idle'}"`;

  const lastRefreshLabel =
    lastRefreshAt == null
      ? '(never)'
      : `${new Date(lastRefreshAt).toLocaleTimeString()} (${
          Math.round((Date.now() - lastRefreshAt) / 1000)
        }s ago)`;

  return (
    <div
      style={{
        position: 'fixed',
        right: 12,
        bottom: 12,
        zIndex: 9999,
        background: 'rgba(15,23,42,0.94)',
        border: '1px solid rgba(148,163,184,0.30)',
        borderRadius: 6,
        padding: '8px 10px',
        font: '11px/1.35 ui-monospace, Menlo, Consolas, monospace',
        color: '#E2E8F0',
        maxWidth: 380,
        boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
        pointerEvents: 'auto',
      }}
      data-testid="status-debug-overlay"
    >
      <div style={{ fontWeight: 600, color: '#F1F5F9', marginBottom: 4 }}>
        status-debug
        <span
          style={{
            float: 'right',
            color: r.consistency === 'conflicting' ? '#F59E0B' : '#10B981',
            fontWeight: 700,
          }}
        >
          {r.consistency === 'conflicting' ? 'CONFLICTING' : 'IN-SYNC'}
        </span>
      </div>
      <Row k="selectedProjectId" v={selectedProjectId ?? '(none)'} />
      <Row k="project.status (raw)" v={r.projectStatus} highlight />
      <Row k="preview.previewStatus (raw)" v={r.previewStatus ?? '(no preview block)'} highlight />
      <Row k="consistency" v={r.consistency} />
      <Row k="last refresh" v={lastRefreshLabel} />
      <Row k="header source" v={headerSource} />
      <Row k="recent-card source" v={recentCardSource} />
      <Row k="preview-pane source" v={previewPaneSource} />
      {r.consistency === 'conflicting' && (
        <div
          style={{
            marginTop: 4,
            padding: '4px 6px',
            borderRadius: 3,
            background: 'rgba(245,158,11,0.18)',
            color: '#FBBF24',
          }}
        >
          {r.reason}
        </div>
      )}
    </div>
  );
}

function Row({ k, v, highlight }: { k: string; v: string; highlight?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <span style={{ color: '#94A3B8', minWidth: 168 }}>{k}</span>
      <span style={{ color: highlight ? '#7DD3FC' : '#E2E8F0', wordBreak: 'break-all' }}>{v}</span>
    </div>
  );
}
