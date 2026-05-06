import { create } from 'zustand';
import type {
  GeneratedProject,
  ProjectFileContent,
  ProjectFileEntry,
  SessionProgress,
  DashboardLog,
} from '../types/dashboard';

export interface ToastItem {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  title: string;
  message?: string;
}

interface DashboardState {
  // Data
  projects: GeneratedProject[];
  selectedProjectId: string | null;
  files: ProjectFileEntry[];
  selectedFilePath: string | null;
  fileContent: ProjectFileContent | null;

  // Generation
  isGenerating: boolean;
  progress: SessionProgress | null;

  // Mode
  projectMode: 'create' | 'edit';

  // Logs
  logs: DashboardLog[];
  logFilter: 'all' | 'info' | 'warn' | 'error';
  logSearch: string;

  // UI
  sidebarCollapsed: boolean;
  logsOpen: boolean;
  rightPanelTab: 'agents' | 'files';
  wsConnected: boolean;
  toasts: ToastItem[];
  showcaseOpen: boolean;
  templateGalleryOpen: boolean;
  /** A one-shot prompt seed consumed by PromptPanel. Cleared once read. */
  pendingPrompt: string | null;

  // Actions
  setProjects: (projects: GeneratedProject[]) => void;
  /** Upsert a single project record by id (no merge by name). */
  upsertProject: (project: GeneratedProject) => void;
  /** Wipe a project's preview lifecycle (used at generation start so a
   *  stale `failed` from the previous run never bleeds into the new
   *  generation's UI). No-op if the project isn't in the cache. */
  resetPreviewState: (projectId: string) => void;
  setSelectedProjectId: (id: string | null) => void;
  setProjectMode: (mode: 'create' | 'edit') => void;
  setFiles: (files: ProjectFileEntry[]) => void;
  setSelectedFilePath: (path: string | null) => void;
  setFileContent: (content: ProjectFileContent | null) => void;
  setIsGenerating: (v: boolean) => void;
  setProgress: (p: SessionProgress | null) => void;
  pushLog: (source: string, message: string, level?: DashboardLog['level']) => void;
  clearLogs: () => void;
  setLogFilter: (f: 'all' | 'info' | 'warn' | 'error') => void;
  setLogSearch: (s: string) => void;
  toggleSidebar: () => void;
  setLogsOpen: (v: boolean) => void;
  setRightPanelTab: (t: 'agents' | 'files') => void;
  setWsConnected: (v: boolean) => void;
  addToast: (toast: Omit<ToastItem, 'id'>) => void;
  removeToast: (id: string) => void;
  setShowcaseOpen: (v: boolean) => void;
  setTemplateGalleryOpen: (v: boolean) => void;
  setPendingPrompt: (v: string | null) => void;
}

export const useStore = create<DashboardState>((set) => ({
  projects: [],
  selectedProjectId: null,
  files: [],
  selectedFilePath: null,
  fileContent: null,
  isGenerating: false,
  progress: null,
  projectMode: 'create',
  logs: [],
  logFilter: 'all',
  logSearch: '',
  sidebarCollapsed: false,
  logsOpen: true,
  rightPanelTab: 'agents',
  wsConnected: false,
  toasts: [],
  showcaseOpen: false,
  templateGalleryOpen: false,
  pendingPrompt: null,

  setProjects: (projects) =>
    set((s) => {
      // Reconcile per-id: if backend says `completed`/`generating`, that
      // ALWAYS wins over a previously cached `failed` for the same id
      // (stale-failed bug). Identity is by `id` only — never by name.
      const prevById = new Map(s.projects.map((p) => [p.id, p] as const));
      const next = projects.map((incoming) => {
        const prev = prevById.get(incoming.id);
        if (
          prev &&
          prev.status === 'failed' &&
          (incoming.status === 'completed' || incoming.status === 'generating')
        ) {
          // eslint-disable-next-line no-console
          console.info('[store] backend overrides stale failed', {
            projectId: incoming.id,
            previous: prev.status,
            next: incoming.status,
          });
        }
        return incoming;
      });
      return { projects: next };
    }),

  upsertProject: (project) =>
    set((s) => {
      const idx = s.projects.findIndex((p) => p.id === project.id);
      if (idx === -1) {
        // eslint-disable-next-line no-console
        console.info('[store] upsertProject (new)', { projectId: project.id, status: project.status });
        return { projects: [project, ...s.projects] };
      }
      const prev = s.projects[idx];
      // Never let a fresher `completed` be replaced by a stale `failed` from
      // a slow in-flight handler. Identity is by id; merging by name is
      // explicitly forbidden.
      if (prev.status === 'completed' && project.status === 'failed') {
        // eslint-disable-next-line no-console
        console.warn('[store] ignoring stale failed for completed project', { projectId: project.id });
        return s;
      }
      const next = s.projects.slice();
      // When a project transitions INTO `generating`, the previous run's
      // preview lifecycle is no longer meaningful. Without this, the
      // shallow merge below would carry a stale `failed` previewStatus
      // into the new generation, and the preview panel would render
      // "Preview failed" while the agents are still building. We force
      // a fresh idle preview block whenever the status flips into
      // `generating`, regardless of what the backend response carried.
      const enteringGeneration =
        project.status === 'generating' && prev.status !== 'generating';
      const merged: GeneratedProject = enteringGeneration
        ? {
            ...prev,
            ...project,
            preview: {
              previewStatus: 'idle',
              previewReady: false,
              previewUrl: null,
              previewError: null,
              previewStartedAt: null,
              previewReadyAt: null,
              timeline: [],
            },
          }
        : { ...prev, ...project };
      next[idx] = merged;
      // eslint-disable-next-line no-console
      console.info('[store] upsertProject (merge)', {
        projectId: project.id,
        prev: prev.status,
        next: project.status,
        previewReset: enteringGeneration,
        prevPreviewStatus: prev.preview?.previewStatus ?? null,
        nextPreviewStatus: merged.preview?.previewStatus ?? null,
      });
      return { projects: next };
    }),

  resetPreviewState: (projectId) =>
    set((s) => {
      const idx = s.projects.findIndex((p) => p.id === projectId);
      if (idx === -1) {
        // eslint-disable-next-line no-console
        console.info('[store] resetPreviewState (no-op, not in cache)', { projectId });
        return s;
      }
      const prev = s.projects[idx];
      const next = s.projects.slice();
      next[idx] = {
        ...prev,
        preview: {
          previewStatus: 'idle',
          previewReady: false,
          previewUrl: null,
          previewError: null,
          previewStartedAt: null,
          previewReadyAt: null,
          timeline: [],
        },
      };
      // eslint-disable-next-line no-console
      console.info('[store] resetPreviewState', {
        projectId,
        prevPreviewStatus: prev.preview?.previewStatus ?? null,
        prevPreviewError: prev.preview?.previewError ?? null,
        prevPreviewUrl: prev.preview?.previewUrl ?? null,
      });
      return { projects: next };
    }),
  setSelectedProjectId: (id) => {
    // eslint-disable-next-line no-console
    console.info('[store] setSelectedProjectId', { selectedProjectId: id });
    set((s) => {
      // Project switch: aggressively clear ALL per-project state that
      // isn't keyed by id in the store. Anything keyed by id (the
      // `projects[]` array, each row's status / preview / techStack) is
      // already isolated by id and stays untouched. The fields cleared
      // below are the ones that historically leaked across projects
      // with the same name (status badge from a stale `progress`,
      // file viewer showing the prior project's open file, logs panel
      // bleeding warnings from a previous session).
      if (s.selectedProjectId === id) return { selectedProjectId: id };
      // eslint-disable-next-line no-console
      console.info('[store] selection change \u2014 clearing per-project state', {
        from: s.selectedProjectId,
        to: id,
      });
      return {
        selectedProjectId: id,
        // Agent / pipeline progress is per-session; the new selection
        // will receive its own SessionProgress via WS reattachment.
        progress: null,
        // File viewer is per-project; the new selection will refetch.
        files: [],
        selectedFilePath: null,
        fileContent: null,
        // Logs panel is a rolling buffer tagged by source; clear so
        // the user doesn't see warnings from the previous project.
        logs: [],
      };
    });
  },
  setProjectMode: (projectMode) => set({ projectMode }),
  setFiles: (files) => set({ files }),
  setSelectedFilePath: (path) => set({ selectedFilePath: path }),
  setFileContent: (content) => set({ fileContent: content }),
  setIsGenerating: (v) => set({ isGenerating: v }),
  setProgress: (p) => set({ progress: p }),

  pushLog: (source, message, level = 'info') =>
    set((s) => ({
      logs: [
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          ts: new Date().toLocaleTimeString(),
          source,
          message,
          level,
        },
        ...s.logs,
      ].slice(0, 500),
    })),

  clearLogs: () => set({ logs: [] }),
  setLogFilter: (logFilter) => set({ logFilter }),
  setLogSearch: (logSearch) => set({ logSearch }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setLogsOpen: (logsOpen) => set({ logsOpen }),
  setRightPanelTab: (rightPanelTab) => set({ rightPanelTab }),
  setWsConnected: (wsConnected) => set({ wsConnected }),

  addToast: (toast) =>
    set((s) => ({
      toasts: [
        ...s.toasts,
        { ...toast, id: `t${Date.now()}${Math.random().toString(36).slice(2, 5)}` },
      ].slice(-5),
    })),

  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setShowcaseOpen: (showcaseOpen) => set({ showcaseOpen }),
  setTemplateGalleryOpen: (templateGalleryOpen) => set({ templateGalleryOpen }),
  setPendingPrompt: (pendingPrompt) => set({ pendingPrompt }),
}));
