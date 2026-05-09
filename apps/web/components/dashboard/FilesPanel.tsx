'use client';

import { useEffect, useMemo, useState } from 'react';
import { Code2, FileText, Folder, FolderOpen, ExternalLink, Play } from 'lucide-react';
import { Card } from '../ui/Card';
import { LivePreview } from '../LivePreview';
import { cn } from '../../lib/cn';
import { getProjectFile, getProjectFiles } from '../../lib/api';
import type { ProjectFileContent, ProjectFileEntry } from '../../types/dashboard';

interface Props {
  projectId: string | null;
  projectName?: string;
}

type PanelTab = 'preview' | 'files' | 'code';

type TreeNode = {
  name: string;
  path: string;
  isDir: boolean;
  children?: Record<string, TreeNode>;
};

function buildTree(files: ProjectFileEntry[]): TreeNode {
  const root: TreeNode = { name: '', path: '', isDir: true, children: {} };
  for (const f of files) {
    const parts = f.path.split('/');
    let cur = root;
    parts.forEach((part, i) => {
      const isLeaf = i === parts.length - 1;
      const fullPath = parts.slice(0, i + 1).join('/');
      cur.children ??= {};
      if (!cur.children[part]) {
        cur.children[part] = {
          name: part,
          path: fullPath,
          isDir: !isLeaf,
          children: isLeaf ? undefined : {},
        };
      }
      cur = cur.children[part];
    });
  }
  return root;
}

function TreeRow({
  node,
  depth,
  selected,
  onSelect,
  expanded,
  onToggle,
}: {
  node: TreeNode;
  depth: number;
  selected: string | null;
  onSelect: (p: string) => void;
  expanded: Set<string>;
  onToggle: (p: string) => void;
}) {
  const children = node.children
    ? Object.values(node.children).sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
    : [];

  if (!node.name) {
    return (
      <>
        {children.map((c) => (
          <TreeRow
            key={c.path}
            node={c}
            depth={0}
            selected={selected}
            onSelect={onSelect}
            expanded={expanded}
            onToggle={onToggle}
          />
        ))}
      </>
    );
  }

  const isOpen = expanded.has(node.path);
  return (
    <>
      <button
        type="button"
        className={cn('cn-tree__row w-full min-h-9', selected === node.path && 'is-active')}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => (node.isDir ? onToggle(node.path) : onSelect(node.path))}
      >
        {node.isDir ? (
          isOpen ? <FolderOpen size={14} className="text-gold-300/80" />
                 : <Folder size={14} className="text-muted" />
        ) : (
          <FileText size={14} className="text-muted" />
        )}
        <span className="truncate">{node.name}</span>
      </button>
      {node.isDir && isOpen && children.map((c) => (
        <TreeRow
          key={c.path}
          node={c}
          depth={depth + 1}
          selected={selected}
          onSelect={onSelect}
          expanded={expanded}
          onToggle={onToggle}
        />
      ))}
    </>
  );
}

export function FilesPanel({ projectId, projectName }: Props) {
  const [tab, setTab] = useState<PanelTab>('preview');
  const [files, setFiles] = useState<ProjectFileEntry[]>([]);
  const [content, setContent] = useState<ProjectFileContent | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['apps', 'apps/web', 'apps/api']));
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [mobilePane, setMobilePane] = useState<'tree' | 'code'>('tree');

  useEffect(() => {
    if (!projectId) {
      setFiles([]);
      setContent(null);
      setSelectedPath(null);
      setMobilePane('tree');
      return;
    }
    let cancelled = false;
    setLoadingFiles(true);
    getProjectFiles(projectId)
      .then((list) => {
        if (cancelled) return;
        setFiles(list);
      })
      .catch(() => { if (!cancelled) setFiles([]); })
      .finally(() => { if (!cancelled) setLoadingFiles(false); });
    return () => { cancelled = true; };
  }, [projectId]);

  useEffect(() => {
    if (!projectId || !selectedPath) {
      setContent(null);
      return;
    }
    let cancelled = false;
    getProjectFile(projectId, selectedPath)
      .then((c) => {
        if (!cancelled) {
          setContent(c);
          setMobilePane('code');
        }
      })
      .catch(() => { if (!cancelled) setContent(null); });
    return () => { cancelled = true; };
  }, [projectId, selectedPath]);

  const tree = useMemo(() => buildTree(files), [files]);

  const toggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  };

  return (
    <Card padded={false} className="flex flex-col h-full overflow-hidden min-h-0">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-5 pt-3.5 pb-3 border-b border-white/[0.05]">
        <div className="flex items-center gap-1 flex-wrap min-w-0">
          <button
            type="button"
            onClick={() => setTab('preview')}
            className={cn(
              'px-3 py-2 rounded-full text-xs font-medium transition-colors min-h-9',
              tab === 'preview'
                ? 'bg-gold-500/15 text-gold-200 border border-gold-300/30'
                : 'text-muted hover:text-secondary border border-transparent',
            )}
          >
            <Play size={12} className="inline -mt-0.5 mr-1" />
            Preview
          </button>
          <button
            type="button"
            onClick={() => setTab('files')}
            className={cn(
              'px-3 py-2 rounded-full text-xs font-medium transition-colors min-h-9',
              tab === 'files'
                ? 'bg-gold-500/15 text-gold-200 border border-gold-300/30'
                : 'text-muted hover:text-secondary border border-transparent',
            )}
          >
            <FileText size={12} className="inline -mt-0.5 mr-1" />
            Files
          </button>
          <button
            type="button"
            onClick={() => setTab('code')}
            className={cn(
              'px-3 py-2 rounded-full text-xs font-medium transition-colors min-h-9',
              tab === 'code'
                ? 'bg-gold-500/15 text-gold-200 border border-gold-300/30'
                : 'text-muted hover:text-secondary border border-transparent',
            )}
          >
            <Code2 size={12} className="inline -mt-0.5 mr-1" />
            Code
          </button>
        </div>
        {projectName && (
          <span className="text-[11px] uppercase tracking-[0.16em] text-muted truncate ml-auto max-w-full sm:max-w-[40%]">
            {projectName}
          </span>
        )}
      </div>

      {tab === 'preview' ? (
        <div className="flex-1 min-h-0 overflow-hidden relative bg-ink">
          {projectId ? (
            <LivePreview />
          ) : (
            <div className="h-full grid place-items-center text-muted text-sm px-6 text-center leading-relaxed">
              Pick a recent project — or describe a new idea — to see a live, sandboxed preview here.
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col md:grid md:grid-cols-[minmax(220px,260px)_minmax(0,1fr)]">
          <div className="md:hidden sticky top-0 z-10 flex items-center gap-1 px-3 py-2 border-b border-white/[0.05] bg-ink">
            <button
              type="button"
              onClick={() => setMobilePane('tree')}
              className={cn(
                'px-3 py-1.5 rounded-full text-xs font-medium transition-colors min-h-9',
                mobilePane === 'tree'
                  ? 'bg-gold-500/15 text-gold-200 border border-gold-300/30'
                  : 'text-muted hover:text-secondary border border-transparent',
              )}
            >
              <Folder size={12} className="inline -mt-0.5 mr-1" />
              Files
            </button>
            <button
              type="button"
              onClick={() => setMobilePane('code')}
              className={cn(
                'px-3 py-1.5 rounded-full text-xs font-medium transition-colors min-h-9',
                mobilePane === 'code'
                  ? 'bg-gold-500/15 text-gold-200 border border-gold-300/30'
                  : 'text-muted hover:text-secondary border border-transparent',
              )}
            >
              <Code2 size={12} className="inline -mt-0.5 mr-1" />
              Code
            </button>
          </div>

          <div className={cn('border-r border-white/[0.05] overflow-auto py-2 px-1.5 min-h-0 bg-ink-1/20', mobilePane !== 'tree' && 'hidden md:block')}>
            {!projectId ? (
              <div className="text-muted text-sm px-3 py-6 text-center leading-relaxed">
                Pick a recent project — or describe a new idea — to inspect its files.
              </div>
            ) : loadingFiles ? (
              <div className="text-muted text-sm px-3 py-4">Loading files…</div>
            ) : files.length === 0 ? (
              <div className="text-muted text-sm px-3 py-4">No files yet.</div>
            ) : (
              <div className="cn-tree flex flex-col">
                <TreeRow
                  node={tree}
                  depth={0}
                  selected={selectedPath}
                  onSelect={setSelectedPath}
                  expanded={expanded}
                  onToggle={toggle}
                />
              </div>
            )}
          </div>

          <div className={cn('overflow-auto bg-ink-1/50 min-h-0', mobilePane !== 'code' && 'hidden md:block')}>
            {content ? (
              <>
                <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-white/[0.05] bg-ink-2/60 sticky top-0 z-10">
                  <span className="text-xs mono text-muted truncate">{content.path}</span>
                  <button className="cn-chip cn-chip--gold min-h-9" type="button">
                    <ExternalLink size={12} /> Open in editor
                  </button>
                </div>
                <pre className="cn-code text-[13px] leading-6 p-4 sm:p-5 overflow-auto">{content.content}</pre>
              </>
            ) : (
              <div className="h-full grid place-items-center text-muted text-sm px-4 text-center">
                {tab === 'files'
                  ? 'Select a file from the tree.'
                  : 'Pick a file to view its source.'}
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
