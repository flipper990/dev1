process.env.NODE_ENV = 'development';
process.env.LOG_LEVEL = 'error';
process.env.DEV_AUTH_BYPASS = process.env.DEV_AUTH_BYPASS || 'true';
process.env.PROJECTS_DIR = './data/projects';
process.env.MEMORY_DIR = './data/memory';
process.env.AZURE_OPENAI_API_KEY = '';
process.env.AZURE_OPENAI_ENDPOINT = '';
process.env.MODEL_SPEC_PROVIDER = 'openai';
process.env.MODEL_BUILDER_PROVIDER = 'openai';
process.env.MODEL_QA_PROVIDER = 'openai';
process.env.MODEL_POLISH_PROVIDER = 'openai';
process.env.MODEL_BUILDER_FALLBACK_PROVIDER = 'openai';
process.env.MODEL_SPEC_FALLBACK_PROVIDER = 'openai';
process.env.MODEL_POLISH_FALLBACK_PROVIDER = 'openai';

const headers = {
  'content-type': 'application/json',
  'x-devteam-user-id': 'dev-user',
  'x-devteam-user-email': 'dev@local.test',
  'x-devteam-workspace-id': 'dev-workspace',
  'x-devteam-role': 'owner',
};

async function sleep(ms: number) { return await new Promise((r) => setTimeout(r, ms)); }

async function main() {
  const { buildApp } = await import('../apps/api/src/app.ts');
  const app = await buildApp();

  const create = await app.inject({
    method: 'POST',
    url: '/api/projects',
    headers,
    payload: { prompt: 'Build a todo app with auth and dashboard' },
  });
  const body = create.json() as { projectId?: string };

  const immediate = body.projectId
    ? await app.inject({ method: 'GET', url: `/api/projects/${body.projectId}`, headers })
    : null;

  await sleep(400);

  const delayed = body.projectId
    ? await app.inject({ method: 'GET', url: `/api/projects/${body.projectId}`, headers })
    : null;

  console.log(JSON.stringify({
    createStatus: create.statusCode,
    projectId: body.projectId ?? null,
    immediateGetStatus: immediate?.statusCode ?? null,
    delayedGetStatus: delayed?.statusCode ?? null,
  }, null, 2));

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
