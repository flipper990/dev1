'use client';

import { useState } from 'react';
import type { Project, ProjectFile } from '../types/index';

interface Props {
  project: Project | null;
}

export function ProjectViewer({ project }: Props) {
  const [activeFile, setActiveFile] = useState<ProjectFile | null>(null);

  const files = project?.artifacts.files ?? [];

  return (
    <div className="panel" style={{ gridRow: '1 / 3', overflow: 'hidden' }}>
      <div className="panel-header">
        <span>Project Viewer</span>
        {project && (
          <span style={{ color: 'var(--text-2)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
            {project.name}
          </span>
        )}
      </div>
      {!project ? (
        <div className="empty-state" style={{ height: 'calc(100% - 40px)' }}>
          <span className="icon">📁</span>
          <span>Select or generate a project</span>
        </div>
      ) : (
        <div className="file-viewer" style={{ height: 'calc(100% - 40px)' }}>
          <div className="file-tree">
            {files.length === 0 && (
              <div style={{ padding: 8, color: 'var(--text-2)', fontSize: 12 }}>No files yet</div>
            )}
            {files.map((f) => (
              <div
                key={f.path}
                className={`file-tree-item ${activeFile?.path === f.path ? 'active' : ''}`}
                onClick={() => setActiveFile(f)}
                title={f.path}
              >
                <span>📄</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {f.path.split('/').pop()}
                </span>
              </div>
            ))}
          </div>
          <div className="file-preview">
            {activeFile ? (
              <pre><code>{activeFile.content}</code></pre>
            ) : (
              <div className="empty-state" style={{ height: '100%' }}>
                <span>Select a file</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
