'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, Clock3, Coins, FileOutput, Pause, Play, RotateCcw, SkipForward, Square, UserRoundCog, X } from 'lucide-react';
import { Button } from '../../../../components/ui';
import { cn } from '../../../../lib/cn';
import {
  controlProjectRuntime,
  getProjectRevisionState,
  getProjectRuntime,
  restoreProjectCheckpoint,
  type ProjectRuntimeStatus,
  type RuntimeCommand,
} from '../../../../lib/api';

interface RuntimeControlPanelProps { projectId: string | null; onRefresh: () => Promise<unknown>; }

function duration(ms: number | null) {
  if (ms === null) return 'Calculating';
  const seconds = Math.max(0, Math.round(ms / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function RuntimeControlPanel({ projectId, onRefresh }: RuntimeControlPanelProps) {
  const [runtime, setRuntime] = useState<ProjectRuntimeStatus | null>(null);
  const [versions, setVersions] = useState<number[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    if (!projectId) { setRuntime(null); setVersions([]); return; }
    try {
      const [nextRuntime, revisionState] = await Promise.all([getProjectRuntime(projectId), getProjectRevisionState(projectId)]);
      setRuntime(nextRuntime);
      setVersions(revisionState.history.map((entry) => entry.version).filter((version) => version < revisionState.currentVersion).sort((a, b) => b - a));
    } catch (error) { setNotice((error as Error).message); }
  }, [projectId]);

  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 1800); return () => window.clearInterval(timer); }, [refresh]);

  const command = async (value: RuntimeCommand) => {
    if (!projectId) return;
    if ((value === 'stop' || value === 'reject-stage') && !window.confirm(value === 'stop' ? 'Stop this run at the next safe stage boundary?' : 'Reject this stage and stop the run?')) return;
    setBusy(value); setNotice('');
    try { await controlProjectRuntime(projectId, value); await Promise.all([refresh(), onRefresh()]); }
    catch (error) { setNotice((error as Error).message); }
    finally { setBusy(null); }
  };

  const restore = async (label: string) => {
    if (!projectId || !runtime || versions.length === 0 || !window.confirm(`${label} from revision ${versions[0]}? Current files will be preserved as a new revision.`)) return;
    setBusy(label); setNotice('');
    try {
      const revisionState = await getProjectRevisionState(projectId);
      await restoreProjectCheckpoint(projectId, versions[0], revisionState.currentVersion);
      await Promise.all([refresh(), onRefresh()]);
      setNotice(`${label} completed from revision ${versions[0]}.`);
    } catch (error) { setNotice((error as Error).message); }
    finally { setBusy(null); }
  };

  if (!projectId) return null;
  if (!runtime) return <section className="rounded-xl border border-border-subtle bg-surface-card p-4 text-body-xs text-text-tertiary">Loading runtime controls…</section>;
  const state = runtime.control.state;
  const active = ['running', 'pause_requested'].includes(state);
  const paused = state === 'paused';
  const retryable = ['failed', 'stopped', 'generated', 'completed'].includes(state) || Boolean(runtime.failureReason);
  const percent = Math.round(runtime.progress * 100);

  return (
    <section aria-labelledby="runtime-heading" className="rounded-xl border border-border-subtle bg-surface-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div><p className="text-label-xs uppercase tracking-[0.14em] text-text-tertiary">Live execution</p><h2 id="runtime-heading" className="mt-1 text-body-s font-semibold text-text-primary">{runtime.control.stage || 'Ready'}</h2></div>
        <span className={cn('rounded-full border px-2 py-1 text-label-xs capitalize', active ? 'border-accent-primary/30 bg-accent-primary/10 text-accent-primary' : paused ? 'border-warning/30 bg-warning/10 text-warning' : 'border-border-subtle text-text-secondary')}>{state.replaceAll('_', ' ')}</span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-muted" role="progressbar" aria-label="Run progress" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}><div className="h-full rounded-full bg-accent-primary transition-[width] duration-500" style={{ width: `${percent}%` }} /></div>
      <div className="mt-2 flex justify-between text-label-xs text-text-tertiary"><span>{percent}% complete</span><span>ETA {duration(runtime.etaMs)}</span></div>

      <dl className="mt-4 grid grid-cols-2 gap-2 text-body-xs">
        <div className="rounded-lg bg-surface-muted p-2"><dt className="flex items-center gap-1 text-text-tertiary"><UserRoundCog size={13}/>Agent</dt><dd className="mt-1 truncate text-text-primary">{runtime.currentAgent ?? 'Coordinator'}</dd></div>
        <div className="rounded-lg bg-surface-muted p-2"><dt className="flex items-center gap-1 text-text-tertiary"><Clock3 size={13}/>Elapsed</dt><dd className="mt-1 text-text-primary">{duration(runtime.elapsedMs)}</dd></div>
        <div className="rounded-lg bg-surface-muted p-2"><dt className="text-text-tertiary">Tokens</dt><dd className="mt-1 text-text-primary">{runtime.tokens.toLocaleString()}</dd></div>
        <div className="rounded-lg bg-surface-muted p-2"><dt className="flex items-center gap-1 text-text-tertiary"><Coins size={13}/>Cost</dt><dd className="mt-1 text-text-primary">${runtime.costUsd.toFixed(4)}</dd></div>
      </dl>
      <div className="mt-3"><p className="text-label-xs text-text-tertiary">Current task</p><p className="mt-1 text-body-xs text-text-primary">{runtime.currentTask ?? 'No active task'}</p></div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-label-xs text-text-secondary"><span>Retries {runtime.retries}</span><span>Artifacts {runtime.artifacts.count}</span><span>Dependencies {runtime.dependencies.length}</span><span>Stages {runtime.steps.length}</span></div>

      <div className="mt-4 flex flex-wrap gap-2">
        {active && <Button size="sm" variant="secondary" disabled={Boolean(busy)} onClick={() => void command('pause')}><Pause size={14}/> Pause</Button>}
        {paused && <Button size="sm" disabled={Boolean(busy)} onClick={() => void command('resume')}><Play size={14}/> Resume</Button>}
        {(active || paused) && <Button size="sm" variant="secondary" disabled={Boolean(busy)} onClick={() => void command('stop')}><Square size={13}/> Stop</Button>}
        {paused && <Button size="sm" variant="secondary" disabled={Boolean(busy)} onClick={() => void command('approve-stage')}><Check size={14}/> Approve</Button>}
        {paused && <Button size="sm" variant="secondary" disabled={Boolean(busy)} onClick={() => void command('reject-stage')}><X size={14}/> Reject</Button>}
        {paused && <Button size="sm" variant="secondary" disabled={Boolean(busy)} onClick={() => void command('skip-stage')}><SkipForward size={14}/> Skip</Button>}
        {retryable && <Button size="sm" variant="secondary" disabled={Boolean(busy)} onClick={() => void command('retry-stage')}><RotateCcw size={14}/> Retry stage</Button>}
        {retryable && <Button size="sm" variant="secondary" disabled={Boolean(busy)} onClick={() => void command('retry-run')}><Play size={14}/> Retry run</Button>}
      </div>

      <details className="mt-4 border-t border-border-subtle pt-3">
        <summary className="cursor-pointer text-label-xs font-medium text-text-secondary">Dependencies & artifacts</summary>
        <div className="mt-2 space-y-2 text-label-xs text-text-tertiary">
          <p>{runtime.dependencies.length ? runtime.dependencies.map((item) => `${item.name} · ${item.status}`).join(', ') : 'No upstream stage dependencies.'}</p>
          <p className="flex items-start gap-1"><FileOutput size={13} className="mt-0.5 shrink-0"/><span>{runtime.artifacts.files.length ? runtime.artifacts.files.join(', ') : 'No artifacts produced yet.'}</span></p>
        </div>
      </details>
      <div className="mt-3 flex flex-wrap gap-2 border-t border-border-subtle pt-3">
        <Button size="sm" variant="ghost" disabled={!versions.length || Boolean(busy)} onClick={() => void restore('Rollback checkpoint')}>Rollback checkpoint</Button>
        <Button size="sm" variant="ghost" disabled={!versions.length || Boolean(busy)} onClick={() => void restore('Restore previous successful generation')}>Restore successful</Button>
      </div>
      {notice && <p className="mt-3 text-label-xs text-text-secondary" role="status">{notice}</p>}
    </section>
  );
}
