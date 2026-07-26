'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Brain, ChevronDown, Database, Pencil, Pin, PinOff, Plus, Search, ShieldCheck, Trash2 } from 'lucide-react';
import { Button } from '../../../../components/ui';
import { ConfirmDialog } from '../../../components/feedback';
import { cn } from '../../../../lib/cn';
import { createProjectMemory, deleteProjectMemory, getProjectMemories, updateProjectMemory, type MemoryCatalog, type MemoryCatalogEntry, type MemoryDraft } from '../../../../lib/api';

const SOURCES = [
  ['all', 'All'], ['project', 'Project Memory'], ['global', 'Global Memory'], ['agent', 'Agent Memory'], ['shared', 'Shared Memory'],
  ['short-term', 'Short-term Memory'], ['long-term', 'Long-term Memory'], ['system-rule', 'System Rules'], ['generation-rule', 'Generation Rules'],
] as const;
const EMPTY: MemoryDraft = { content: '', source: 'project', agentRole: 'builder', type: 'decision', tags: [], relevanceScore: 1, pinned: false };

function ago(value: string | null) { if (!value) return 'Never'; const delta = Date.now() - new Date(value).getTime(); const minutes = Math.max(0, Math.round(delta / 60000)); return minutes < 60 ? `${minutes}m ago` : `${Math.round(minutes / 60)}h ago`; }

export function MemoryWorkspace({ projectId }: { projectId: string | null }) {
  const [catalog, setCatalog] = useState<MemoryCatalog | null>(null); const [source, setSource] = useState('all'); const [query, setQuery] = useState('');
  const [usedOnly, setUsedOnly] = useState(false); const [creating, setCreating] = useState(false); const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<MemoryDraft>(EMPTY); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState('');
  const [pendingDelete, setPendingDelete] = useState<MemoryCatalogEntry | null>(null);
  const refresh = useCallback(async () => { if (!projectId) return setCatalog(null); try { setCatalog(await getProjectMemories(projectId, { q: query, source })); } catch (error) { setNotice((error as Error).message); } }, [projectId, query, source]);
  useEffect(() => { const timer = window.setTimeout(() => void refresh(), 180); return () => window.clearTimeout(timer); }, [refresh]);
  const influenced = useMemo(() => new Set(catalog?.influences.map((item) => item.memoryId) ?? []), [catalog]);
  const entries = (catalog?.entries ?? []).filter((entry) => !usedOnly || influenced.has(entry.id) || entry.source.endsWith('rule'));
  const saveNew = async () => { if (!projectId || draft.content.trim().length < 3) return; setBusy(true); try { await createProjectMemory(projectId, { ...draft, tags: draft.tags }); setDraft(EMPTY); setCreating(false); await refresh(); } catch (error) { setNotice((error as Error).message); } finally { setBusy(false); } };
  const saveEdit = async (entry: MemoryCatalogEntry) => { if (!projectId) return; setBusy(true); try { await updateProjectMemory(projectId, entry.id, { content: draft.content, tags: draft.tags, relevanceScore: draft.relevanceScore }); setEditing(null); await refresh(); } catch (error) { setNotice((error as Error).message); } finally { setBusy(false); } };
  const remove = async (entry: MemoryCatalogEntry) => { if (!projectId) return; setBusy(true); try { await deleteProjectMemory(projectId, entry.id); setPendingDelete(null); await refresh(); } catch (error) { setNotice((error as Error).message); } finally { setBusy(false); } };
  if (!projectId) return <div className="p-4 text-body-xs text-text-tertiary">Select a project to inspect its memory.</div>;

  return <section aria-labelledby="memory-title" className="space-y-4">
    <header className="rounded-xl border border-border-subtle bg-surface-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3"><div><p className="text-label-xs uppercase tracking-[.14em] text-accent-primary">Memory graph</p><h2 id="memory-title" className="mt-1 text-heading-xs text-text-primary">Generation context</h2><p className="mt-1 text-body-xs text-text-tertiary">Inspect exactly what entered model context.</p></div><Button size="sm" onClick={() => { setDraft(EMPTY); setCreating(true); }}><Plus size={14}/> Create</Button></div>
      <label className="mt-4 flex items-center gap-2 rounded-lg border border-border-subtle bg-surface-muted px-3 py-2"><Search size={14} className="text-text-tertiary"/><span className="sr-only">Search memory</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search memory…" className="min-w-0 flex-1 bg-transparent text-body-xs text-text-primary outline-none placeholder:text-text-tertiary"/></label>
      <div className="mt-3 flex flex-wrap gap-1.5">{SOURCES.map(([id, label]) => <button key={id} onClick={() => setSource(id)} className={cn('rounded-full border px-2.5 py-1 text-label-xs transition-colors', source === id ? 'border-accent-primary/40 bg-accent-primary/10 text-accent-primary' : 'border-border-subtle text-text-secondary hover:bg-surface-muted')}>{label}</button>)}</div>
      <label className="mt-3 flex items-center gap-2 text-label-xs text-text-secondary"><input type="checkbox" checked={usedOnly} onChange={(event) => setUsedOnly(event.target.checked)} className="accent-accent-primary"/> Used in this run only <span className="ml-auto">{catalog?.influences.length ?? 0} injections</span></label>
    </header>

    {creating && <MemoryForm draft={draft} setDraft={setDraft} busy={busy} onCancel={() => setCreating(false)} onSave={() => void saveNew()} />}
    <div className="space-y-2">{entries.map((entry) => {
      const isUsed = influenced.has(entry.id); const isEditing = editing === entry.id;
      if (isEditing) return <MemoryForm key={entry.id} draft={draft} setDraft={setDraft} busy={busy} editing onCancel={() => setEditing(null)} onSave={() => void saveEdit(entry)}/>;
      return <article key={entry.id} className={cn('rounded-xl border bg-surface-card p-3', isUsed ? 'border-accent-primary/35' : 'border-border-subtle')}>
        <div className="flex items-center gap-2 text-label-xs"><span className="rounded bg-surface-muted px-2 py-0.5 capitalize text-text-secondary">{entry.source.replace('-', ' ')}</span>{isUsed && <span className="text-accent-primary">Influenced this run</span>}<button aria-label={entry.pinned ? 'Unpin memory' : 'Pin memory'} disabled={!entry.editable} className="ml-auto text-text-tertiary disabled:opacity-40" onClick={() => projectId && void updateProjectMemory(projectId, entry.id, { pinned: !entry.pinned }).then(refresh)}>{entry.pinned ? <Pin size={13}/> : <PinOff size={13}/>}</button></div>
        <p className="mt-2 text-body-xs leading-relaxed text-text-primary">{entry.content}</p>
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-label-xs text-text-tertiary"><div><dt className="inline">Origin </dt><dd className="inline text-text-secondary">{entry.origin}</dd></div><div><dt className="inline">Scope </dt><dd className="inline text-text-secondary">{entry.scope}</dd></div><div><dt className="inline">Last used </dt><dd className="inline text-text-secondary">{ago(entry.lastUsedAt)}</dd></div><div><dt className="inline">Size </dt><dd className="inline text-text-secondary">{entry.sizeBytes} B</dd></div><div><dt className="inline">Confidence </dt><dd className="inline text-text-secondary">{Math.round(entry.confidence * 100)}%</dd></div><div><dt className="inline">Runs </dt><dd className="inline text-text-secondary">{entry.usedByRunIds.length}</dd></div></dl>
        {entry.usedByRunIds.length > 0 && <details className="mt-2 text-label-xs text-text-tertiary"><summary className="cursor-pointer">Run provenance</summary><p className="mt-1 break-all">{entry.usedByRunIds.join(', ')}</p></details>}
        {(entry.editable || entry.deletable) && <div className="mt-3 flex gap-2 border-t border-border-subtle pt-2">{entry.editable && <Button size="sm" variant="ghost" onClick={() => { setDraft({ content: entry.content, source: entry.source as MemoryDraft['source'], agentRole: entry.agentRole as MemoryDraft['agentRole'], type: entry.type, tags: entry.tags, relevanceScore: entry.relevanceScore, pinned: entry.pinned }); setEditing(entry.id); }}><Pencil size={13}/> Edit</Button>}{entry.deletable && <Button size="sm" variant="ghost" onClick={() => setPendingDelete(entry)}><Trash2 size={13}/> Delete</Button>}</div>}
      </article>;
    })}{entries.length === 0 && <div className="rounded-xl border border-dashed border-border-subtle p-6 text-center text-body-xs text-text-tertiary"><Brain className="mx-auto mb-2" size={20}/>No memory matches this view.</div>}</div>
    <div className="rounded-xl border border-border-subtle bg-surface-muted p-3 text-label-xs text-text-tertiary"><div className="flex gap-2"><ShieldCheck size={14}/><p>System rules are visible and immutable. Project generation-rule overlays can add guidance without replacing safety or validation contracts.</p></div><div className="mt-2 flex gap-2"><Database size={14}/><p>Short-term memory is ephemeral. Historical influence snapshots remain after a memory is edited or deleted.</p></div></div>
    {notice && <p role="status" className="text-label-xs text-text-secondary">{notice}</p>}
    <ConfirmDialog open={Boolean(pendingDelete)} title="Delete project memory?" description="The source memory will be removed. Historical generation influence snapshots remain auditable." confirmLabel="Delete memory" danger busy={busy} onCancel={() => setPendingDelete(null)} onConfirm={() => pendingDelete && void remove(pendingDelete)} />
  </section>;
}

function MemoryForm({ draft, setDraft, busy, editing, onCancel, onSave }: { draft: MemoryDraft; setDraft: (draft: MemoryDraft) => void; busy: boolean; editing?: boolean; onCancel: () => void; onSave: () => void }) {
  return <form onSubmit={(event) => { event.preventDefault(); onSave(); }} className="rounded-xl border border-accent-primary/30 bg-surface-card p-4">
    <div className="flex items-center justify-between"><h3 className="text-body-s font-semibold text-text-primary">{editing ? 'Edit memory' : 'Create memory'}</h3><ChevronDown size={15}/></div>
    <textarea required minLength={3} value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.target.value })} rows={5} className="mt-3 w-full resize-y rounded-lg border border-border-subtle bg-surface-muted p-3 text-body-xs text-text-primary outline-none focus:border-accent-primary" placeholder="Guidance, decision, preference, or learned pattern"/>
    {!editing && <div className="mt-2 grid grid-cols-2 gap-2"><select value={draft.source} onChange={(event) => setDraft({ ...draft, source: event.target.value as MemoryDraft['source'] })} className="rounded-lg border border-border-subtle bg-surface-muted p-2 text-label-xs"><option value="project">Project Memory</option><option value="agent">Agent Memory</option><option value="shared">Shared Memory</option><option value="long-term">Long-term Memory</option><option value="generation-rule">Generation Rule</option></select><select value={draft.agentRole} onChange={(event) => setDraft({ ...draft, agentRole: event.target.value as MemoryDraft['agentRole'] })} className="rounded-lg border border-border-subtle bg-surface-muted p-2 text-label-xs"><option value="global">All agents</option><option value="spec">Specification</option><option value="builder">Builder</option><option value="qa">QA</option><option value="polish">Polish</option></select></div>}
    <input value={draft.tags.join(', ')} onChange={(event) => setDraft({ ...draft, tags: event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean) })} className="mt-2 w-full rounded-lg border border-border-subtle bg-surface-muted p-2 text-label-xs" placeholder="Tags, comma separated"/>
    <div className="mt-3 flex justify-end gap-2"><Button type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Button><Button type="submit" size="sm" disabled={busy || draft.content.trim().length < 3}>Save memory</Button></div>
  </form>;
}
