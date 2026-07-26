'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Circle, Copy, FileCode2, Folder, GitCompareArrows, RefreshCw, RotateCcw, Save, Search, X } from 'lucide-react';
import {
  commitProjectFile,
  compareProjectRevisions,
  createProjectCheckpoint,
  getProjectFile,
  getProjectFiles,
  getProjectRevisionState,
  restoreProjectCheckpoint,
  type ProjectRevisionState,
  type RevisionDiff,
} from '../../../../lib/api';
import type { ProjectFileEntry } from '../../../../types/dashboard';
import { Button, EmptyState } from '../../../../components/ui';
import { cn } from '../../../../lib/cn';

interface CodeWorkbenchProps { projectId: string | null; requestedPath?: string | null; onProjectChanged?: () => void | Promise<void>; }
interface TreeNode { name: string; path: string; folders: TreeNode[]; files: ProjectFileEntry[]; }

function buildTree(files: ProjectFileEntry[]): TreeNode {
  const root: TreeNode = { name: 'root', path: '', folders: [], files: [] };
  for (const file of files) {
    const parts = file.path.split('/'); let node = root;
    parts.slice(0, -1).forEach((part) => {
      let child = node.folders.find((folder) => folder.name === part);
      if (!child) { child = { name: part, path: node.path ? `${node.path}/${part}` : part, folders: [], files: [] }; node.folders.push(child); }
      node = child;
    });
    node.files.push(file);
  }
  const sort = (node: TreeNode) => { node.folders.sort((a, b) => a.name.localeCompare(b.name)); node.files.sort((a, b) => a.path.localeCompare(b.path)); node.folders.forEach(sort); };
  sort(root); return root;
}

function TreeBranch({ node, selected, onOpen, depth = 0 }: { node: TreeNode; selected: string | null; onOpen: (path: string) => void; depth?: number }) {
  const [open, setOpen] = useState(true);
  return <>
    {node.path ? <button type="button" onClick={() => setOpen((value) => !value)} className="flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-label-s text-text-secondary hover:bg-surface-raised hover:text-text-primary" style={{ paddingLeft: 8 + depth * 12 }} aria-expanded={open}>{open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}<Folder className="h-3.5 w-3.5" /><span className="truncate">{node.name}</span></button> : null}
    {open ? <>{node.folders.map((folder) => <TreeBranch key={folder.path} node={folder} selected={selected} onOpen={onOpen} depth={depth + 1} />)}{node.files.map((file) => <button key={file.path} type="button" onClick={() => onOpen(file.path)} aria-current={selected === file.path ? 'page' : undefined} title={file.path} className={cn('flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-left font-mono text-[12px] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]', selected === file.path ? 'bg-brand-primary-subtle text-brand-primary' : 'text-text-secondary hover:bg-surface-raised hover:text-text-primary')} style={{ paddingLeft: 28 + depth * 12 }}><FileCode2 className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{file.path.split('/').pop()}</span></button>)}</> : null}
  </>;
}

function useRememberedWidth(key: string, initial: number, min: number, max: number) {
  const [width, setWidth] = useState(initial);
  useEffect(() => { const saved = Number(window.localStorage.getItem(key)); if (Number.isFinite(saved)) setWidth(Math.min(max, Math.max(min, saved))); }, [key, max, min]);
  const update = useCallback((value: number) => { const next = Math.min(max, Math.max(min, value)); setWidth(next); window.localStorage.setItem(key, String(next)); }, [key, max, min]);
  return [width, update] as const;
}

function Resizer({ onDelta, label }: { onDelta: (delta: number) => void; label: string }) {
  const origin = useRef(0);
  return <div role="separator" aria-label={label} aria-orientation="vertical" tabIndex={0} className="group relative hidden w-1 cursor-col-resize bg-border-muted outline-none hover:bg-brand-primary focus-visible:bg-brand-primary lg:block" onPointerDown={(event) => { origin.current = event.clientX; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; const delta = event.clientX - origin.current; origin.current = event.clientX; onDelta(delta); }} onKeyDown={(event) => { if (event.key === 'ArrowLeft') onDelta(-16); if (event.key === 'ArrowRight') onDelta(16); }}><span className="absolute inset-y-0 -left-1 -right-1" /></div>;
}

function DiffPane({ before, after, title }: { before: string; after: string; title: string }) {
  const oldLines = before.split('\n'); const newLines = after.split('\n'); const length = Math.max(oldLines.length, newLines.length);
  return <section className="min-w-0 overflow-hidden bg-surface-canvas" aria-label={`Diff for ${title}`}><header className="border-b border-border-muted px-3 py-2 text-label-s text-text-secondary">Changes · <span className="font-mono">{title}</span></header><div className="studio-scroll max-h-[560px] overflow-auto font-mono text-[12px] leading-5">{Array.from({ length }, (_, index) => { const oldLine = oldLines[index] ?? ''; const newLine = newLines[index] ?? ''; const changed = oldLine !== newLine; return <div key={index} className="grid grid-cols-2 border-b border-border-muted/40"><pre className={cn('min-w-0 whitespace-pre-wrap border-r border-border-muted px-3 py-0.5 text-text-secondary', changed && 'bg-status-error-subtle text-status-error')}><span className="mr-3 select-none text-text-muted">{index + 1}</span>{oldLine}</pre><pre className={cn('min-w-0 whitespace-pre-wrap px-3 py-0.5 text-text-secondary', changed && 'bg-status-success-subtle text-status-success')}><span className="mr-3 select-none text-text-muted">{index + 1}</span>{newLine}</pre></div>; })}</div></section>;
}

export function CodeWorkbench({ projectId, requestedPath, onProjectChanged }: CodeWorkbenchProps) {
  const [files, setFiles] = useState<ProjectFileEntry[]>([]); const [openFiles, setOpenFiles] = useState<string[]>([]); const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [original, setOriginal] = useState(''); const [buffer, setBuffer] = useState(''); const [search, setSearch] = useState(''); const [loading, setLoading] = useState(false); const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState<ProjectRevisionState | null>(null); const [compareFrom, setCompareFrom] = useState<number | null>(null); const [compareDiffs, setCompareDiffs] = useState<RevisionDiff[]>([]); const [comparePath, setComparePath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); const [notice, setNotice] = useState(''); const [refreshKey, setRefreshKey] = useState(0);
  const [explorerWidth, setExplorerWidth] = useRememberedWidth(`devteam:editor:${projectId}:explorer`, 240, 180, 420); const [diffWidth, setDiffWidth] = useRememberedWidth(`devteam:editor:${projectId}:diff`, 480, 320, 760);
  const lastExternalPath = useRef<string | null>(null);
  const dirty = Boolean(selectedPath && buffer !== original); const currentVersion = revision?.currentVersion ?? 1;

  const refresh = useCallback(async () => { if (!projectId) return; setLoading(true); setError(null); try { const [entries, versions] = await Promise.all([getProjectFiles(projectId), getProjectRevisionState(projectId)]); setFiles(entries); setRevision(versions); if (!selectedPath && entries[0]) setSelectedPath(entries[0].path); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load the project.'); } finally { setLoading(false); } }, [projectId, selectedPath]);
  useEffect(() => { setFiles([]); setOpenFiles([]); setSelectedPath(null); setOriginal(''); setBuffer(''); setCompareDiffs([]); setCompareFrom(null); void refresh(); }, [projectId, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { let stale = false; if (!projectId || !selectedPath) return; setLoading(true); void getProjectFile(projectId, selectedPath).then((file) => { if (stale) return; setOriginal(file.content); setBuffer(file.content); setOpenFiles((paths) => paths.includes(file.path) ? paths : [...paths, file.path]); }).catch((reason: unknown) => { if (!stale) setError(reason instanceof Error ? reason.message : 'Could not load this file.'); }).finally(() => { if (!stale) setLoading(false); }); return () => { stale = true; }; }, [projectId, selectedPath, refreshKey]);
  useEffect(() => { if (!requestedPath || requestedPath === lastExternalPath.current || !files.some((file) => file.path === requestedPath)) return; lastExternalPath.current = requestedPath; if (!dirty || requestedPath === selectedPath || window.confirm('Discard unsaved changes and jump to the related source file?')) setSelectedPath(requestedPath); }, [dirty, files, requestedPath, selectedPath]);

  const filteredFiles = useMemo(() => files.filter((file) => file.path.toLowerCase().includes(search.toLowerCase())), [files, search]); const tree = useMemo(() => buildTree(filteredFiles), [filteredFiles]);
  const versions = useMemo(() => { const values = new Set([currentVersion, ...(revision?.history ?? []).map((item) => item.version)]); return [...values].sort((a, b) => b - a); }, [currentVersion, revision]);

  const accept = async () => { if (!projectId || !selectedPath || !dirty) return; setBusy(true); setError(null); try { const result = await commitProjectFile(projectId, selectedPath, buffer, currentVersion); setOriginal(result.file.content); setRevision((state) => state ? { ...state, currentVersion: result.version } : state); setNotice(`Saved ${selectedPath} as checkpoint v${result.version}.`); await onProjectChanged?.(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save the file.'); } finally { setBusy(false); } };
  const makeCheckpoint = async () => { if (!projectId) return; setBusy(true); try { const result = await createProjectCheckpoint(projectId, `Manual checkpoint ${new Date().toLocaleString()}`, currentVersion); setNotice(`Checkpoint v${result.version} created.`); setRefreshKey((value) => value + 1); await onProjectChanged?.(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not create checkpoint.'); } finally { setBusy(false); } };
  const restore = async (version: number) => { if (!projectId || !window.confirm(`Restore checkpoint v${version} as a new revision?`)) return; setBusy(true); try { const result = await restoreProjectCheckpoint(projectId, version, currentVersion); setNotice(`Checkpoint v${version} restored as v${result.version}.`); setRefreshKey((value) => value + 1); await onProjectChanged?.(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not restore checkpoint.'); } finally { setBusy(false); } };
  const compare = async (version: number) => { if (!projectId) return; setBusy(true); try { const result = await compareProjectRevisions(projectId, version, currentVersion); setCompareFrom(version); setCompareDiffs(result.diffs); setComparePath(result.diffs[0]?.path ?? null); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not compare revisions.'); } finally { setBusy(false); } };

  if (!projectId) return <EmptyState title="Select a project" description="Choose a project to inspect and edit its source." />;
  const comparison = compareDiffs.find((item) => item.path === comparePath);
  return <section className="overflow-hidden rounded-[var(--radius-panel)] border border-border bg-surface-base" aria-label="Engineering editor">
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border-muted px-3 py-2"><div className="flex items-center gap-2"><span className="text-label-m text-text-primary">Engineering editor</span>{dirty ? <span className="inline-flex items-center gap-1 text-label-s text-status-warning"><Circle className="h-2.5 w-2.5 fill-current" />Unsaved changes</span> : <span className="text-label-s text-text-muted">Checkpoint v{currentVersion}</span>}</div><div className="flex flex-wrap gap-2"><Button variant="ghost" onClick={makeCheckpoint} disabled={busy || dirty}><Save className="h-4 w-4" /> Checkpoint</Button><Button variant="secondary" onClick={() => { setBuffer(original); setNotice('Local changes rejected.'); }} disabled={!dirty || busy}><RotateCcw className="h-4 w-4" /> Reject</Button><Button onClick={() => { void accept(); }} disabled={!dirty || busy}><Check className="h-4 w-4" /> Accept changes</Button></div></header>
    {error ? <div role="alert" className="border-b border-status-error/30 bg-status-error-subtle px-4 py-2 text-body-s text-status-error">{error}</div> : null}{notice ? <div role="status" className="border-b border-status-success/30 bg-status-success-subtle px-4 py-2 text-body-s text-status-success">{notice}</div> : null}
    <div className="grid min-h-[min(620px,calc(100dvh-190px))] grid-cols-1 lg:grid-cols-[minmax(180px,var(--explorer-width))_4px_minmax(0,1fr)]" style={{ '--explorer-width': `${explorerWidth}px` } as React.CSSProperties}>
      <label className="flex items-center gap-2 border-b border-border-muted bg-surface-tint/45 p-2 text-label-s text-text-secondary lg:hidden"><FileCode2 className="h-4 w-4"/><span className="sr-only">Open source file</span><select value={selectedPath ?? ''} onChange={(event) => { if (!dirty || window.confirm('Discard unsaved changes and open another file?')) setSelectedPath(event.target.value); }} className="min-w-0 flex-1 rounded-md border border-border-muted bg-surface-base px-2 py-2 font-mono text-[12px] text-text-primary">{files.map((file) => <option key={file.path} value={file.path}>{file.path}</option>)}</select></label>
      <aside className="hidden min-h-0 overflow-hidden border-r border-border-muted bg-surface-tint/45 lg:block"><div className="border-b border-border-muted p-2"><label className="flex items-center gap-2 rounded-md border border-border-muted bg-surface-base px-2 py-1.5"><Search className="h-3.5 w-3.5 text-text-muted" /><span className="sr-only">Search files</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search files" className="min-w-0 flex-1 bg-transparent text-label-s text-text-primary outline-none" /></label></div><div className="studio-scroll h-[min(570px,calc(100dvh-240px))] overflow-y-auto p-1.5"><TreeBranch node={tree} selected={selectedPath} onOpen={(path) => { if (!dirty || window.confirm('Discard unsaved changes and open another file?')) setSelectedPath(path); }} />{filteredFiles.length === 0 ? <p className="p-3 text-body-s text-text-secondary">No files match your search.</p> : null}</div></aside>
      <Resizer label="Resize file explorer" onDelta={(delta) => setExplorerWidth(explorerWidth + delta)} />
      <div className="min-w-0 overflow-hidden"><div className="studio-scroll flex h-10 overflow-x-auto border-b border-border-muted bg-surface-tint/35">{openFiles.map((path) => <div key={path} className={cn('flex shrink-0 items-center border-r border-border-muted', selectedPath === path && 'bg-surface-base')}><button type="button" onClick={() => { if (!dirty || path === selectedPath || window.confirm('Discard unsaved changes?')) setSelectedPath(path); }} className="flex h-full items-center gap-2 px-3 font-mono text-[12px] text-text-secondary"><FileCode2 className="h-3.5 w-3.5" />{path.split('/').pop()}{selectedPath === path && dirty ? <Circle className="h-2 w-2 fill-status-warning text-status-warning" /> : null}</button><button type="button" aria-label={`Close ${path}`} onClick={() => { const remaining = openFiles.filter((item) => item !== path); setOpenFiles(remaining); if (selectedPath === path) setSelectedPath(remaining.at(-1) ?? null); }} className="mr-1 rounded p-1 text-text-muted hover:bg-surface-tint hover:text-text-primary"><X className="h-3.5 w-3.5" /></button></div>)}</div>
        <div className={cn('grid min-h-[530px] grid-cols-1', (comparison || dirty) && 'lg:grid-cols-[minmax(0,1fr)_4px_minmax(320px,var(--diff-width))]')} style={{ '--diff-width': `${diffWidth}px` } as React.CSSProperties}><div className="min-w-0"><div className="flex h-10 items-center justify-between border-b border-border-muted px-3"><span className="truncate font-mono text-[12px] text-text-secondary">{selectedPath ?? 'Select a file'}</span><button type="button" disabled={!buffer} onClick={() => { void navigator.clipboard.writeText(buffer); }} className="min-h-9 min-w-9 rounded-md p-2 text-text-muted transition-colors hover:bg-surface-tint hover:text-text-primary" aria-label="Copy file"><Copy className="h-4 w-4" /></button></div><textarea aria-label={selectedPath ? `Edit ${selectedPath}` : 'Code editor'} spellCheck={false} value={buffer} onChange={(event) => setBuffer(event.target.value)} disabled={!selectedPath || loading} className="studio-scroll h-[min(490px,calc(100dvh-280px))] min-h-[360px] w-full resize-none bg-surface-canvas p-4 font-mono text-[13px] leading-6 text-text-primary outline-none focus:shadow-[inset_0_0_0_1px_var(--color-brand-primary)]" /></div>{comparison || dirty ? <><Resizer label="Resize diff viewer" onDelta={(delta) => setDiffWidth(diffWidth - delta)} /><DiffPane title={comparison?.path ?? selectedPath ?? 'Current file'} before={comparison?.before ?? original} after={comparison?.after ?? buffer} /></> : null}</div>
      </div>
    </div>
    <footer className="grid border-t border-border-muted lg:grid-cols-[1fr_340px]"><div className="min-w-0 p-3"><div className="mb-2 flex items-center gap-2"><GitCompareArrows className="h-4 w-4 text-text-muted" /><span className="text-label-m text-text-primary">Compare revisions</span>{compareFrom ? <span className="text-label-s text-text-muted">v{compareFrom} → v{currentVersion}</span> : null}</div>{compareDiffs.length ? <div className="flex flex-wrap gap-1.5">{compareDiffs.map((diff) => <button key={diff.path} type="button" onClick={() => setComparePath(diff.path)} className={cn('rounded-md border px-2 py-1 font-mono text-[11px]', comparePath === diff.path ? 'border-brand-primary bg-brand-primary-subtle text-brand-primary' : 'border-border-muted text-text-secondary')}>{diff.op} · {diff.path}</button>)}</div> : <p className="text-body-s text-text-secondary">Choose a checkpoint to compare it with the current revision.</p>}</div><aside className="border-t border-border-muted p-3 lg:border-l lg:border-t-0"><h3 className="text-label-m text-text-primary">Checkpoints</h3><div className="studio-scroll mt-2 max-h-40 space-y-1 overflow-y-auto">{versions.map((version) => <div key={version} className="flex items-center justify-between gap-2 rounded-md bg-surface-tint px-2 py-1.5"><span className="text-label-s text-text-secondary">v{version}{version === currentVersion ? ' · Current' : ''}</span><span className="flex gap-1"><button type="button" onClick={() => { void compare(version); }} disabled={version === currentVersion || busy} className="rounded px-2 py-1 text-label-s text-brand-primary hover:bg-brand-primary-subtle disabled:opacity-40">Compare</button><button type="button" onClick={() => { void restore(version); }} disabled={version === currentVersion || busy || dirty} className="rounded px-2 py-1 text-label-s text-text-secondary hover:bg-surface-raised disabled:opacity-40">Restore</button></span></div>)}</div></aside></footer>
  </section>;
}
