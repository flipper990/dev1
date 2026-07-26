import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ProjectGenerator } from '../pipeline/project-generator.js';
import type { ProjectStore } from '../storage/project-store.js';
import type { createAuthGuards } from '../security/auth.js';
import { getAuthPrincipal } from '../security/auth.js';
import { computeFileDiffs } from '../pipeline/diff-utils.js';
import type { ProjectRecord, ProjectSnapshot } from '../storage/project-store.js';
import { nanoid } from 'nanoid';

const UpdateSchema = z.object({
  prompts: z.array(z.string().min(10).max(5000)).min(1).max(3),
  userId: z.string().optional(),
  preferences: z.record(z.unknown()).optional(),
  scope: z.enum(['code', 'design', 'full']).optional(),
});

const FileCommitSchema = z.object({
  content: z.string().max(2_000_000),
  expectedVersion: z.number().int().positive(),
});

const CheckpointSchema = z.object({
  label: z.string().trim().min(1).max(120).default('Manual checkpoint'),
  expectedVersion: z.number().int().positive(),
});

const RestoreSchema = z.object({ expectedVersion: z.number().int().positive() });
const BranchSchema = z.object({ name: z.string().trim().min(1).max(120).optional() });
const RuntimeCommandSchema = z.object({ command: z.enum(['pause', 'resume', 'stop', 'skip-stage', 'approve-stage', 'reject-stage', 'retry-stage', 'retry-run']) });

function toSnapshot(project: ProjectRecord, version = project.version ?? 1, diffs = project.versionHistory?.find((item) => item.version === version)?.diffs ?? []): ProjectSnapshot {
  return { version, prompts: project.prompts ?? [], files: project.files.map((file) => ({ path: file.path, content: file.content })), diffs, spec: project.spec, plan: project.plan, totalTokens: project.totalTokens, totalCostUsd: project.totalCostUsd, durationMs: project.durationMs, createdAt: project.updatedAt ?? project.createdAt };
}

function safeEditorPath(raw: string) {
  const normalized = raw.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/') || normalized.includes('\0') || normalized.split('/').some((part) => part === '..' || part === '')) return null;
  return normalized;
}

export function registerVersionRoutes(
  app: FastifyInstance,
  generator: ProjectGenerator,
  projectStore: ProjectStore,
  auth: ReturnType<typeof createAuthGuards>,
): void {
  // Accepts either { prompt: string } (frontend shape) or { prompts: string[] } (legacy).
  const PromptsOrPromptSchema = z.union([
    UpdateSchema,
    z.object({
      prompt: z.string().min(1).max(5000),
      preferences: z.record(z.unknown()).optional(),
      scope: z.enum(['code', 'design', 'full']).optional(),
    }),
  ]);

  const handleUpdate = async (request: FastifyRequest, reply: FastifyReply) => {
    const principal = getAuthPrincipal(request);
    const { id } = request.params as { id: string };
    const authorized = await auth.ensureProjectAccess(request, reply, id, { minRole: 'member' });
    if (!authorized) return;
    const parsed = PromptsOrPromptSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid update request', details: parsed.error.issues });
    }
    const data = parsed.data as { prompt?: string; prompts?: string[]; preferences?: Record<string, unknown>; scope?: 'code' | 'design' | 'full' };
    const prompts = data.prompts ?? (data.prompt ? [data.prompt] : []);
    if (prompts.length === 0) {
      return reply.status(400).send({ error: 'At least one prompt is required' });
    }

    // Quick existence check so the caller gets a fast 404 instead of a
    // background failure they can only see in logs.
    const existing = await projectStore.get(id);
    if (!existing) return reply.status(404).send({ error: `Project ${id} not found` });
    if (existing.status === 'generating') {
      return reply.status(409).send({ error: 'Project is still generating; wait for it to complete before updating' });
    }

    const reservation = generator.reserveUpdate({
      projectId: id,
      prompts,
      userId: principal.userId,
      preferences: data.preferences,
      scope: data.scope,
    });

    // Persist the new sessionId + 'generating' status synchronously so the
    // dashboard's poll/auto-attach picks up the new run instead of the
    // stale one from the original generation. Without this, the
    // websocket attaches to the dead original session and the UI shows
    // no progress even though the pipeline is running fine in the bg.
    // Use update() so the read-modify-write is held under the
    // per-project lock — protects against a racing updatePreview()
    // from a still-warm preview container clobbering this status flip.
    await projectStore.update(id, (rec) => {
      rec.sessionId = reservation.sessionId;
      rec.status = 'generating';
      rec.projectStatus = 'generating';
      rec.verificationStatus = 'pending';
    }, {
      phase: 'update-route:reserve-session',
      caller: 'version-routes:update',
      reason: 'user-initiated update flow flips generated→generating',
      allowStatusDowngrade: true,
    });

    void generator.runReservedUpdate(reservation).catch((err) => {
      request.log.error({ err, projectId: id }, 'Background update failed');
    });

    return reply.status(202).send({
      projectId: id,
      sessionId: reservation.sessionId,
      project:  { id: existing.id, name: existing.name, sessionId: reservation.sessionId, status: 'generating', projectStatus: 'generating', verificationStatus: 'pending', fileCount: existing.files.length, totalTokens: existing.totalTokens, totalCostUsd: existing.totalCostUsd, durationMs: existing.durationMs },
      pipeline: { sessionId: reservation.sessionId },
    });
  };

  // Canonical route + frontend-facing alias.
  app.post('/api/projects/:id/update', handleUpdate);
  app.post('/api/projects/:id/prompts', handleUpdate);

  // Prompt history — used by frontend to render the prompt timeline.
  app.get('/api/projects/:id/prompts', { preHandler: [auth.requireProjectAccess('viewer')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = request.project ?? await projectStore.get(id);
    if (!project) return reply.status(404).send({ error: 'Project not found' });
    const history = (project.versionHistory ?? []).flatMap((v) =>
      (v.prompts ?? []).map((text) => ({
        text,
        createdAt: v.createdAt,
        snapshotVersionId: String(v.version),
        changedFiles: (v.diffs ?? []).map((d) => d.path),
        added:    (v.diffs ?? []).filter((d) => d.op === 'added').map((d) => d.path),
        modified: (v.diffs ?? []).filter((d) => d.op === 'modified').map((d) => d.path),
        removed:  (v.diffs ?? []).filter((d) => d.op === 'deleted').map((d) => d.path),
      })),
    );
    // If versionHistory is empty (single-version project), fall back to the
    // top-level prompts list so the UI still has something to show.
    if (history.length === 0 && project.prompts?.length) {
      for (const text of project.prompts) {
        history.push({
          text,
          createdAt: project.createdAt,
          snapshotVersionId: '1',
          changedFiles: [],
          added: [],
          modified: [],
          removed: [],
        });
      }
    }
    return { prompts: history };
  });

  app.get('/api/projects/:id/versions', { preHandler: [auth.requireProjectAccess('viewer')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = request.project ?? await projectStore.get(id);
    if (!project) return reply.status(404).send({ error: 'Project not found' });
    return { projectId: id, currentVersion: project.version ?? 1, history: project.versionHistory ?? [] };
  });

  app.get('/api/projects/:id/runtime', { preHandler: [auth.requireProjectAccess('viewer')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = request.project ?? await projectStore.get(id);
    if (!project) return reply.status(404).send({ error: 'Project not found' });
    const control = generator.getRuntimeControl(id);
    const progress = generator.getRuntimeProgress(id);
    const elapsedMs = Number(progress?.durationMs ?? project.durationMs ?? 0);
    const completion = Math.max(0, Math.min(1, Number(progress?.progress ?? (project.status === 'generated' ? 1 : 0))));
    const etaMs = completion > 0 && completion < 1 ? Math.max(0, Math.round(elapsedMs / completion - elapsedMs)) : null;
    const steps = progress?.steps ?? [];
    const currentIndex = progress?.currentStep ? steps.findIndex((step) => step.stepId === progress.currentStep?.stepId) : -1;
    return {
      projectId: id,
      sessionId: control?.sessionId ?? project.sessionId,
      control: control ?? { state: project.status === 'generating' ? 'running' : project.status, stage: project.progress?.phase ?? project.status, approvedStages: [], rejectedStages: [], skippedStages: [], retryCount: 0, updatedAt: project.updatedAt },
      progress: completion,
      currentAgent: progress?.currentStep?.agent ?? progress?.activeWorker ?? null,
      currentTask: progress?.currentStep?.description ?? progress?.currentStep?.name ?? project.progress?.lastMeaningfulStep ?? null,
      etaMs,
      elapsedMs,
      tokens: project.totalTokens,
      costUsd: project.totalCostUsd,
      retries: progress?.retryAttempt ?? 0,
      dependencies: currentIndex > 0 ? steps.slice(0, currentIndex).map((step) => ({ id: step.stepId, name: step.name, status: step.status })) : [],
      artifacts: { count: project.files.length, files: project.files.slice(-20).map((file) => file.path) },
      steps: steps.map((step) => ({ id: step.stepId, name: step.name, agent: step.agent, status: step.status, durationMs: step.durationMs, attempt: step.attempt, error: step.error })),
      failureReason: progress?.failureReason ?? project.error ?? null,
    };
  });

  app.post('/api/projects/:id/runtime/control', { preHandler: [auth.requireProjectAccess('member')] }, async (request, reply) => {
    const principal = getAuthPrincipal(request);
    const { id } = request.params as { id: string };
    const parsed = RuntimeCommandSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid runtime command', details: parsed.error.issues });
    const project = await projectStore.get(id);
    if (!project) return reply.status(404).send({ error: 'Project not found' });
    const command = parsed.data.command;
    if (command === 'retry-run' || command === 'retry-stage') {
      if (project.status === 'generating') return reply.status(409).send({ error: 'The current run must finish or stop before retrying' });
      const prompt = project.versionHistory?.at(-1)?.prompts?.at(-1) ?? project.prompts?.at(-1);
      if (!prompt) return reply.status(409).send({ error: 'No retained prompt is available to retry' });
      const retryPrompt = command === 'retry-stage' && project.failure?.failedPhase ? `${prompt}\n\nRetry the failed ${project.failure.failedPhase} stage using the retained project state.` : prompt;
      const reservation = generator.reserveUpdate({ projectId: id, prompts: [retryPrompt], userId: principal.userId });
      await projectStore.update(id, (record) => { record.sessionId = reservation.sessionId; record.status = 'generating'; record.projectStatus = 'generating'; record.verificationStatus = 'pending'; }, { phase: 'runtime-control:retry', caller: 'version-routes:runtime-control', reason: command, allowStatusDowngrade: true });
      void generator.runReservedUpdate(reservation).catch((err) => request.log.error({ err, projectId: id }, 'Runtime retry failed'));
      return reply.status(202).send({ command, state: 'running', sessionId: reservation.sessionId });
    }
    const control = generator.requestRuntimeControl(id, command);
    if (!control) return reply.status(409).send({ error: 'No controllable runtime is registered for this project' });
    return reply.status(202).send({ command, control });
  });

  app.put('/api/projects/:id/files/*', { preHandler: [auth.requireProjectAccess('member')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const filePath = safeEditorPath((request.params as Record<string, string>)['*'] ?? '');
    if (!filePath) return reply.status(400).send({ error: 'Invalid file path' });
    const parsed = FileCommitSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid file commit', details: parsed.error.issues });
    const current = await projectStore.get(id);
    if (!current) return reply.status(404).send({ error: 'Project not found' });
    if (current.status === 'generating') return reply.status(409).send({ error: 'Files cannot be edited while generation is running' });
    const currentVersion = current.version ?? 1;
    if (parsed.data.expectedVersion !== currentVersion) return reply.status(409).send({ error: 'Project changed since this file was opened', currentVersion });
    const existingIndex = current.files.findIndex((file) => file.path === filePath);
    if (existingIndex < 0) return reply.status(404).send({ error: 'File not found' });
    if (current.files[existingIndex].content === parsed.data.content) return { version: currentVersion, file: { path: filePath, content: parsed.data.content }, diffs: [] };
    await projectStore.saveSnapshot(id, toSnapshot(current, currentVersion));
    const nextFiles = current.files.map((file) => file.path === filePath ? { ...file, content: parsed.data.content } : file);
    const diffs = computeFileDiffs(current.files, nextFiles);
    const nextVersion = currentVersion + 1;
    const createdAt = new Date().toISOString();
    const updated = await projectStore.update(id, (project) => {
      if ((project.version ?? 1) !== currentVersion) return false;
      project.files = nextFiles;
      project.version = nextVersion;
      project.versionHistory = [...(project.versionHistory ?? []), { version: nextVersion, prompts: [`Edited ${filePath}`], diffs, totalTokens: project.totalTokens, totalCostUsd: project.totalCostUsd, durationMs: project.durationMs, createdAt }];
      project.verificationStatus = 'pending';
      project.previewHealthStatus = 'unknown';
    }, { phase: 'editor:file-commit', persistFiles: true, caller: 'version-routes:file-commit', reason: `manual edit ${filePath}` });
    if (!updated || (updated.version ?? 1) !== nextVersion) return reply.status(409).send({ error: 'Project changed while the file was being saved' });
    await projectStore.saveSnapshot(id, toSnapshot(updated, nextVersion, diffs));
    return { version: nextVersion, file: { path: filePath, content: parsed.data.content }, diffs };
  });

  app.post('/api/projects/:id/checkpoints', { preHandler: [auth.requireProjectAccess('member')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = CheckpointSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid checkpoint request', details: parsed.error.issues });
    const current = await projectStore.get(id);
    if (!current) return reply.status(404).send({ error: 'Project not found' });
    if (current.status === 'generating') return reply.status(409).send({ error: 'Wait for generation to finish before creating a checkpoint' });
    const currentVersion = current.version ?? 1;
    if (parsed.data.expectedVersion !== currentVersion) return reply.status(409).send({ error: 'Project changed before the checkpoint was created', currentVersion });
    await projectStore.saveSnapshot(id, toSnapshot(current, currentVersion));
    const nextVersion = currentVersion + 1;
    const createdAt = new Date().toISOString();
    const updated = await projectStore.update(id, (project) => {
      if ((project.version ?? 1) !== currentVersion) return false;
      project.version = nextVersion;
      project.versionHistory = [...(project.versionHistory ?? []), { version: nextVersion, prompts: [parsed.data.label], diffs: [], totalTokens: project.totalTokens, totalCostUsd: project.totalCostUsd, durationMs: project.durationMs, createdAt }];
    }, { phase: 'editor:checkpoint', caller: 'version-routes:checkpoint', reason: parsed.data.label });
    if (!updated || (updated.version ?? 1) !== nextVersion) return reply.status(409).send({ error: 'Project changed while creating the checkpoint' });
    await projectStore.saveSnapshot(id, toSnapshot(updated, nextVersion));
    return { version: nextVersion, createdAt, label: parsed.data.label };
  });

  app.post('/api/projects/:id/versions/:version/restore', { preHandler: [auth.requireProjectAccess('member')] }, async (request, reply) => {
    const { id, version } = request.params as { id: string; version: string };
    const sourceVersion = Number.parseInt(version, 10);
    const parsed = RestoreSchema.safeParse(request.body);
    if (!Number.isInteger(sourceVersion) || sourceVersion < 1 || !parsed.success) return reply.status(400).send({ error: 'Invalid restore request' });
    const current = await projectStore.get(id);
    if (!current) return reply.status(404).send({ error: 'Project not found' });
    if (current.status === 'generating') return reply.status(409).send({ error: 'Wait for generation to finish before restoring a revision' });
    const currentVersion = current.version ?? 1;
    if (parsed.data.expectedVersion !== currentVersion) return reply.status(409).send({ error: 'Project changed before restore', currentVersion });
    const source = sourceVersion === currentVersion ? toSnapshot(current, currentVersion) : await projectStore.getSnapshot(id, sourceVersion);
    if (!source) return reply.status(404).send({ error: `Version ${sourceVersion} not found` });
    await projectStore.saveSnapshot(id, toSnapshot(current, currentVersion));
    const nextVersion = currentVersion + 1;
    const diffs = computeFileDiffs(current.files, source.files);
    const createdAt = new Date().toISOString();
    const updated = await projectStore.update(id, (project) => {
      if ((project.version ?? 1) !== currentVersion) return false;
      project.files = source.files.map((file) => ({ ...file }));
      project.version = nextVersion;
      project.versionHistory = [...(project.versionHistory ?? []), { version: nextVersion, prompts: [`Restored checkpoint v${sourceVersion}`], diffs, totalTokens: project.totalTokens, totalCostUsd: project.totalCostUsd, durationMs: project.durationMs, createdAt }];
      project.verificationStatus = 'pending'; project.previewHealthStatus = 'unknown';
    }, { phase: 'editor:restore', persistFiles: true, caller: 'version-routes:restore', reason: `restore v${sourceVersion}` });
    if (!updated || (updated.version ?? 1) !== nextVersion) return reply.status(409).send({ error: 'Project changed while restoring' });
    await projectStore.saveSnapshot(id, toSnapshot(updated, nextVersion, diffs));
    return { version: nextVersion, restoredFromVersion: sourceVersion, diffs };
  });

  app.post('/api/projects/:id/versions/:version/branch', { preHandler: [auth.requireProjectAccess('member')] }, async (request, reply) => {
    const { id, version } = request.params as { id: string; version: string };
    const sourceVersion = Number.parseInt(version, 10);
    const parsed = BranchSchema.safeParse(request.body ?? {});
    if (!Number.isInteger(sourceVersion) || sourceVersion < 1 || !parsed.success) return reply.status(400).send({ error: 'Invalid branch request' });
    const current = await projectStore.get(id);
    if (!current) return reply.status(404).send({ error: 'Project not found' });
    if (current.status === 'generating') return reply.status(409).send({ error: 'Wait for generation to finish before branching' });
    const currentVersion = current.version ?? 1;
    const source = sourceVersion === currentVersion ? toSnapshot(current, currentVersion) : await projectStore.getSnapshot(id, sourceVersion);
    if (!source) return reply.status(404).send({ error: `Version ${sourceVersion} not found` });
    const now = new Date().toISOString();
    const branchId = nanoid(12);
    const branch: ProjectRecord = {
      ...current,
      id: branchId,
      name: parsed.data.name ?? `${current.name} · branch v${sourceVersion}`,
      sessionId: `branch-${nanoid(10)}`,
      files: source.files.map((file) => ({ ...file })),
      prompts: [...source.prompts],
      version: 1,
      versionHistory: [{ version: 1, prompts: [`Branched from ${id} v${sourceVersion}`], diffs: computeFileDiffs([], source.files), totalTokens: 0, totalCostUsd: 0, durationMs: 0, createdAt: now }],
      status: 'generated', projectStatus: 'generated', verificationStatus: 'pending', previewHealthStatus: 'unknown',
      preview: undefined,
      runtimeValidation: undefined,
      executionValidation: undefined,
      diagnostics: undefined,
      tasks: [],
      createdAt: now,
      updatedAt: now,
    };
    await projectStore.save(branch);
    await projectStore.saveSnapshot(branchId, toSnapshot(branch, 1, branch.versionHistory?.[0]?.diffs ?? []));
    return reply.status(201).send({ projectId: branchId, branchedFromProjectId: id, branchedFromVersion: sourceVersion, project: branch });
  });

  app.get('/api/projects/:id/versions/compare', { preHandler: [auth.requireProjectAccess('viewer')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = z.object({ from: z.coerce.number().int().positive(), to: z.coerce.number().int().positive() }).safeParse(request.query);
    if (!query.success) return reply.status(400).send({ error: 'from and to versions are required' });
    const current = await projectStore.get(id);
    if (!current) return reply.status(404).send({ error: 'Project not found' });
    const currentVersion = current.version ?? 1;
    const load = async (version: number) => version === currentVersion ? toSnapshot(current, currentVersion) : projectStore.getSnapshot(id, version);
    const [from, to] = await Promise.all([load(query.data.from), load(query.data.to)]);
    if (!from || !to) return reply.status(404).send({ error: 'One or both versions were not found' });
    const diffs = computeFileDiffs(from.files, to.files);
    const fromMap = new Map(from.files.map((file) => [file.path, file.content]));
    const toMap = new Map(to.files.map((file) => [file.path, file.content]));
    return { fromVersion: from.version, toVersion: to.version, diffs: diffs.map((diff) => ({ ...diff, before: fromMap.get(diff.path) ?? '', after: toMap.get(diff.path) ?? '' })) };
  });

  app.get('/api/projects/:id/versions/:version', { preHandler: [auth.requireProjectAccess('viewer')] }, async (request, reply) => {
    const { id, version } = request.params as { id: string; version: string };
    const v = parseInt(version, 10);
    if (isNaN(v) || v < 1) return reply.status(400).send({ error: 'Version must be a positive integer' });
    const snapshot = await projectStore.getSnapshot(id, v);
    if (!snapshot) return reply.status(404).send({ error: `Version ${v} not found for project ${id}` });
    return snapshot;
  });
}
