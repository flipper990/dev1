'use client';
import { useEffect } from 'react';
import { useStore } from '../lib/store';
import { getProjectFiles, getProjectFile } from '../lib/api';

const EXT_ICON: Record<string, string> = {
  ts: '🔷', tsx: '⚛️', js: '🟨', jsx: '⚛️',
  json: '📋', md: '📝', css: '🎨', html: '🌐',
  yml: '⚙️', yaml: '⚙️', sh: '🔧', env: '🔑',
  gitignore: '🚫', dockerfile: '🐳',
};

function fileIcon(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return EXT_ICON[ext] ?? '📄';
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  return `${(bytes / 1024).toFixed(1)}K`;
}

function highlight(code: string, ext: string): string {
  if (!['ts', 'tsx', 'js', 'jsx'].includes(ext)) return escHtml(code);
  const s = escHtml(code);
  return s
    // comments
    .replace(/(\/\/[^\n]*)/g, '<span class="tok-comment">$1</span>')
    .replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="tok-comment">$1</span>')
    // strings
    .replace(/(&quot;[^&]*?&quot;|&#039;[^&]*?&#039;|`[^`]*?`)/g, '<span class="tok-string">$1</span>')
    // keywords
    .replace(/\b(import|export|from|const|let|var|function|return|if|else|for|while|class|extends|interface|type|async|await|new|typeof|instanceof|default|null|undefined|true|false|void|in|of|try|catch|throw|switch|case|break|continue|this|super)\b/g, '<span class="tok-keyword">$1</span>')
    // types (capitalized identifiers not followed by '(')
    .replace(/\b([A-Z][A-Za-z0-9_]+)(?!\s*\()/g, '<span class="tok-type">$1</span>')
    // function calls
    .replace(/\b([a-z_][A-Za-z0-9_]*)(?=\s*\()/g, '<span class="tok-function">$1</span>')
    // numbers
    .replace(/\b(\d+\.?\d*)\b/g, '<span class="tok-number">$1</span>');
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

export function FileExplorer() {
  const {
    files, selectedFilePath, fileContent,
    selectedProjectId,
    setFiles, setSelectedFilePath, setFileContent,
  } = useStore();

  // Load files when project changes
  useEffect(() => {
    if (!selectedProjectId) { setFiles([]); setSelectedFilePath(null); setFileContent(null); return; }
    getProjectFiles(selectedProjectId)
      .then(setFiles)
      .catch(() => {});
  }, [selectedProjectId]);

  // Load file content
  useEffect(() => {
    if (!selectedProjectId || !selectedFilePath) { setFileContent(null); return; }
    getProjectFile(selectedProjectId, selectedFilePath)
      .then(setFileContent)
      .catch(() => {});
  }, [selectedProjectId, selectedFilePath]);

  if (!selectedProjectId) {
    return (
      <div className="file-explorer">
        <div className="file-explorer-empty">Select a project to browse files.</div>
      </div>
    );
  }

  const parts = selectedFilePath ? selectedFilePath.split('/') : [];
  const ext = selectedFilePath?.split('.').pop()?.toLowerCase() ?? '';

  const highlighted = fileContent
    ? highlight(fileContent.content, ext)
    : null;

  return (
    <div className="file-explorer">
      {/* Breadcrumb */}
      <div className="breadcrumb">
        {parts.map((part, i) => (
          <span key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            {i > 0 && <span className="breadcrumb__sep">/</span>}
            <span className={`breadcrumb__part${i === parts.length - 1 ? ' breadcrumb__part--file' : ''}`}>
              {part}
            </span>
          </span>
        ))}
        {!selectedFilePath && <span className="breadcrumb__part">— no file selected —</span>}
        <span className="branch-badge">
          <span>⎇</span> main
        </span>
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div className="file-list">
          {files.map((f) => (
            <div
              key={f.path}
              className={`file-node${selectedFilePath === f.path ? ' active' : ''}`}
              onClick={() => setSelectedFilePath(f.path)}
            >
              <span className="file-node__icon">{fileIcon(f.path)}</span>
              <span className="file-node__name">{f.path}</span>
              <span className="file-node__size">{fmtSize(f.size)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Code viewer */}
      <div className="code-viewer">
        {highlighted ? (
          <pre
            className="code-block"
            dangerouslySetInnerHTML={{ __html: highlighted }}
          />
        ) : selectedFilePath ? (
          <div className="file-explorer-empty" style={{ padding: '1.5rem' }}>
            <div className="skeleton" style={{ height: 12, width: '60%', marginBottom: 8 }} />
            <div className="skeleton" style={{ height: 12, width: '80%', marginBottom: 8 }} />
            <div className="skeleton" style={{ height: 12, width: '45%' }} />
          </div>
        ) : (
          <div className="file-explorer-empty">
            {files.length === 0 ? 'No files yet. Generation in progress…' : 'Select a file to view its contents.'}
          </div>
        )}
      </div>
    </div>
  );
}
