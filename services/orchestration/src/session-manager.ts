import {
  generateId,
  now,
  Logger,
  ConcurrencyLimitError,
  config,
} from '@devteam/core';
import type {
  PipelineState,
  PipelineStatus,
} from '@devteam/core';

// ─── Session record ───────────────────────────────────────────────────────────

export interface Session {
  id: string;
  projectId: string;
  status: PipelineStatus;
  createdAt: string;
  updatedAt: string;
  pipeline?: PipelineState;
}

// ─── Session event emitter ────────────────────────────────────────────────────

type SessionListener = (event: { type: string; data: unknown }) => void;

// ─── Manager ─────────────────────────────────────────────────────────────────

export class SessionManager {
  private readonly sessions = new Map<string, Session>();
  private readonly listeners = new Map<string, Set<SessionListener>>();
  private readonly logger = new Logger('session-manager');
  private activeSessions = 0;

  create(projectId: string): Session {
    if (this.activeSessions >= config.limits.maxConcurrentSessions) {
      throw new ConcurrencyLimitError();
    }

    const session: Session = {
      id: generateId('sess'),
      projectId,
      status: 'pending',
      createdAt: now(),
      updatedAt: now(),
    };

    this.sessions.set(session.id, session);
    this.activeSessions++;
    this.logger.info('Session created', { sessionId: session.id, projectId });
    return session;
  }

  get(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  update(sessionId: string, patch: Partial<Session>): Session {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    Object.assign(session, patch, { updatedAt: now() });

    if (patch.status === 'completed' || patch.status === 'failed' || patch.status === 'cancelled') {
      this.activeSessions = Math.max(0, this.activeSessions - 1);
    }

    this.emit(sessionId, 'session.updated', session);
    return session;
  }

  // ── Pub/sub for WebSocket streaming ────────────────────────────────────

  subscribe(sessionId: string, listener: SessionListener): () => void {
    let set = this.listeners.get(sessionId);
    if (!set) {
      set = new Set();
      this.listeners.set(sessionId, set);
    }
    set.add(listener);
    return () => set!.delete(listener);
  }

  emit(sessionId: string, type: string, data: unknown): void {
    const set = this.listeners.get(sessionId);
    if (!set) return;
    for (const listener of set) {
      listener({ type, data });
    }
  }

  getActiveCount(): number {
    return this.activeSessions;
  }
}

export const sessionManager = new SessionManager();
