import type { ProjectFileContent, ProjectFileEntry } from '../types/dashboard';

interface FileViewerProps {
  files: ProjectFileEntry[];
  selectedFilePath: string | null;
  fileContent: ProjectFileContent | null;
  onSelectFile: (path: string) => void;
}

export function FileViewer({ files, selectedFilePath, fileContent, onSelectFile }: FileViewerProps) {
  return (
    <section className="panel panel--tall">
      <div className="panel__header panel__header--split">
        <h2>File Viewer</h2>
        <span className="count-chip">{files.length}</span>
      </div>

      <div className="file-viewer">
        <div className="file-viewer__list">
          {files.length === 0 ? (
            <div className="empty-state">Select a project to inspect files.</div>
          ) : (
              files.map((file, index) => (
              <button
                className={`file-item ${selectedFilePath === file.path ? 'file-item--active' : ''}`}
                  key={`${file.path}-${index}`}
                onClick={() => onSelectFile(file.path)}
                type="button"
              >
                <span className="file-item__path mono">{file.path}</span>
                <span className="file-item__size">{file.size} B</span>
              </button>
            ))
          )}
        </div>

        <div className="file-viewer__content">
          {fileContent ? (
            <>
              <div className="file-viewer__content-head mono">{fileContent.path}</div>
              <pre className="file-viewer__code">
                <code>{fileContent.content}</code>
              </pre>
            </>
          ) : (
            <div className="empty-state">Choose a file to preview source.</div>
          )}
        </div>
      </div>
    </section>
  );
}
