'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { api, openSessionSocket } from '../lib/api';
import type { Project, PipelineState } from '../types/index';
import { ChatInput } from '../components/ChatInput';
import { AgentActivityPanel } from '../components/AgentActivityPanel';
import { ProjectViewer } from '../components/ProjectViewer';
import { LogsView } from '../components/LogsView';

interface LogEntry {
  id: number;
  level: 'info' | 'warn' | 'error';
  message: string;
  timestamp: string;
}

let logCounter = 0;

export default function Home() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [pipeline, setPipeline] = useState<PipelineState | null>(null);
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const wsCloseRef = useRef<(() => void) | null>(null);

  // ── Bootstrap: load project list ─────────────────────────────────────────
  useEffect(() => {
    api.projects.list().then(({ projects }) => setProjects(projects)).catch(console.error);
  }, []);

  // ── Log helper ────────────────────────────────────────────────────────────
  const addLog = useCallback((level: LogEntry['level'], message: string) => {
    setLogs((prev) => [
      ...prev.slice(-199),
      { id: ++logCounter, level, message, timestamp: new Date().toISOString() },
    ]);
  }, []);

  // ── Submit prompt ─────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async (prompt: string) => {
    setLoading(true);
    setPipeline(null);
    addLog('info', `Starting pipeline for: "${prompt.slice(0, 80)}..."`);

    try {
      const { project, pipeline: initialPipeline } = await api.projects.create(prompt);

      setActiveProject(project);
      setPipeline(initialPipeline);
      setProjects((prev) => [project, ...prev]);

      addLog('info', `Session created: ${project.sessionId}`);

      // Open WebSocket for live updates
      if (project.sessionId) {
        wsCloseRef.current?.();
        wsCloseRef.current = openSessionSocket(project.sessionId, (type, data) => {
          addLog('info', `[${type}] ${JSON.stringify(data).slice(0, 100)}`);

          if (type === 'step.started') {
            const d = data as { role: string };
            addLog('info', `Agent started: ${d.role}`);
          }

          if (type === 'step.completed') {
            const d = data as { role: string; status: string };
            addLog(d.status === 'failed' ? 'error' : 'info', `Agent ${d.status}: ${d.role}`);
          }

          if (type === 'session.completed') {
            addLog('info', 'Pipeline completed');
            // Reload project to get final artifacts
            api.projects.get(project.id).then(({ project: updated }) => {
              setActiveProject(updated);
              setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
            }).catch(console.error);
          }

          if (type === 'session.failed') {
            const d = data as { error?: string };
            addLog('error', `Pipeline failed: ${d.error ?? 'unknown'}`);
          }
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog('error', `Failed to start pipeline: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, [addLog]);

  // ── Cleanup WebSocket on unmount ──────────────────────────────────────────
  useEffect(() => () => { wsCloseRef.current?.(); }, []);

  return (
    <div className="app">
      {/* Topbar */}
      <header className="topbar">
        <h1>DEVteam</h1>
        <span className="badge">AI</span>
        <span className="spacer" />
        <span className="status-dot" title="Backend connected" />
      </header>

      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <h2>Projects ({projects.length})</h2>
        </div>
        <div className="project-list">
          {projects.length === 0 && (
            <div className="empty-state" style={{ height: 120 }}>
              <span>No projects yet</span>
            </div>
          )}
          {projects.map((p) => (
            <div
              key={p.id}
              className={`project-item ${activeProject?.id === p.id ? 'active' : ''}`}
              onClick={() => { setActiveProject(p); setPipeline(null); }}
            >
              <div className="name">
                <span className={`project-status ${p.status}`} />
                {p.name}
              </div>
              <div className="meta">
                {p.artifacts.files.length} files
                {p.costUsd != null && ` · $${p.costUsd.toFixed(4)}`}
              </div>
            </div>
          ))}
        </div>

        {/* Chat input at bottom of sidebar */}
        <div className="chat-input-wrap">
          <ChatInput onSubmit={handleSubmit} loading={loading} />
        </div>
      </aside>

      {/* Main content */}
      <main className="main">
        <div className="content-grid">
          <AgentActivityPanel pipeline={pipeline} />
          <ProjectViewer project={activeProject} />
          <LogsView logs={logs} />
        </div>
      </main>
    </div>
  );
}
