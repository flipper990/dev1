'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AgentActivityPanel } from '../components/AgentActivityPanel';
import { ChatInput } from '../components/ChatInput';
import { FileViewer } from '../components/FileViewer';
import { LogsView } from '../components/LogsView';
import { ProjectList } from '../components/ProjectList';
import {
  generateProject,
  getProjectFile,
  getProjectFiles,
  listProjects,
  openSessionSocket,
} from '../lib/api';
import type {
  DashboardLog,
  GeneratedProject,
  ProjectFileContent,
  ProjectFileEntry,
  SessionProgress,
} from '../types/dashboard';

function createLog(source: string, message: string, level: DashboardLog['level'] = 'info'): DashboardLog {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ts: new Date().toLocaleTimeString(),
    source,
    message,
    level,
  };
}

export default function DashboardPage() {
  const [projects, setProjects] = useState<GeneratedProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [files, setFiles] = useState<ProjectFileEntry[]>([]);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<ProjectFileContent | null>(null);
  const [logs, setLogs] = useState<DashboardLog[]>([]);
  const [progress, setProgress] = useState<SessionProgress | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);

  const selectedProject = useMemo(
    () => (Array.isArray(projects) ? projects.find((project) => project.id === selectedProjectId) ?? null : null),
    [projects, selectedProjectId],
  );

  const pushLog = (source: string, message: string, level: DashboardLog['level'] = 'info') => {
    setLogs((prev) => [createLog(source, message, level), ...prev].slice(0, 250));
  };

  useEffect(() => {
    const loadProjects = async () => {
      try {
        const data = await listProjects();
        setProjects(data);
        if (!selectedProjectId && data.length > 0) {
          setSelectedProjectId(data[0].id);
        }
      } catch (error) {
        pushLog('projects', (error as Error).message, 'error');
      }
    };

    loadProjects();
    const interval = setInterval(loadProjects, 5000);

    return () => clearInterval(interval);
  }, [selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectId) {
      setFiles([]);
      setSelectedFilePath(null);
      setFileContent(null);
      return;
    }

    const loadFiles = async () => {
      try {
        const projectFiles = await getProjectFiles(selectedProjectId);
        setFiles(projectFiles);

        if (projectFiles.length > 0) {
          const defaultPath = projectFiles[0].path;
          setSelectedFilePath(defaultPath);
        } else {
          setSelectedFilePath(null);
          setFileContent(null);
        }
      } catch (error) {
        pushLog('files', (error as Error).message, 'error');
      }
    };

    loadFiles();
  }, [selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectId || !selectedFilePath) {
      setFileContent(null);
      return;
    }

    const loadFile = async () => {
      try {
        const content = await getProjectFile(selectedProjectId, selectedFilePath);
        setFileContent(content);
      } catch (error) {
        pushLog('file-viewer', (error as Error).message, 'error');
      }
    };

    loadFile();
  }, [selectedProjectId, selectedFilePath]);

  useEffect(() => {
    return () => {
      if (socketRef.current && socketRef.current.readyState < 2) {
        socketRef.current.close();
      }
    };
  }, []);

  const handleGenerate = async (prompt: string) => {
    setIsGenerating(true);
    pushLog('pipeline', 'Submitting generation request...');

    try {
      const result = await generateProject(prompt);
      setSelectedProjectId(result.projectId);
      pushLog('pipeline', `Project queued: ${result.project.name}`);

      if (socketRef.current && socketRef.current.readyState < 2) {
        socketRef.current.close();
      }

      const socket = openSessionSocket(
        result.sessionId,
        (nextProgress) => {
          setProgress(nextProgress);
          if (nextProgress.currentStep) {
            pushLog(
              'agents',
              `${nextProgress.currentStep.name} (${nextProgress.currentStep.agent}) attempt ${nextProgress.currentStep.attempt}`,
            );
          }
        },
        (status) => {
          pushLog('pipeline', `Session finished with status: ${status}`);
          setIsGenerating(false);

          // Refresh projects once done
          listProjects()
            .then((items) => setProjects(Array.isArray(items) ? items : []))
            .catch((error) => pushLog('projects', (error as Error).message, 'error'));
        },
        (message) => {
          pushLog('ws', message, 'warn');
        },
      );

      socketRef.current = socket;

    } catch (error) {
      pushLog('pipeline', (error as Error).message, 'error');
      setIsGenerating(false);
    }
  };

  return (
    <main className="dashboard">
      <header className="dashboard__header">
        <div>
          <p className="eyebrow">DEVteam Platform</p>
          <h1>Control Center</h1>
        </div>
        <div className="header-stats">
          <div className="stat-box">
            <span className="stat-box__label">Projects</span>
            <span className="stat-box__value">{projects.length}</span>
          </div>
          <div className="stat-box">
            <span className="stat-box__label">Selected</span>
            <span className="stat-box__value mono">{selectedProject ? selectedProject.name : '-'}</span>
          </div>
          <div className="stat-box">
            <span className="stat-box__label">Generation</span>
            <span className="stat-box__value">{isGenerating ? 'Running' : 'Idle'}</span>
          </div>
        </div>
      </header>

      <section className="dashboard__top-grid">
        <ChatInput loading={isGenerating} onSubmit={handleGenerate} />
        <AgentActivityPanel progress={progress} />
      </section>

      <section className="dashboard__mid-grid">
        <ProjectList
          onSelect={setSelectedProjectId}
          projects={projects}
          selectedProjectId={selectedProjectId}
        />
        <FileViewer
          files={files}
          selectedFilePath={selectedFilePath}
          fileContent={fileContent}
          onSelectFile={setSelectedFilePath}
        />
      </section>

      <section className="dashboard__bottom-grid">
        <LogsView logs={logs} />
      </section>
    </main>
  );
}
