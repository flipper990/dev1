process.env.NODE_ENV = 'development';
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

async function main() {
  const { buildApp } = await import('../apps/api/src/app.ts');
  const app = await buildApp();

  const out: Record<string, unknown> = {};

  const health = await app.inject({ method: 'GET', url: '/health' });
  out.healthStatus = health.statusCode;
  out.healthHasAuthBlock = typeof health.json().auth === 'object';

  const unauthorizedProjects = await app.inject({ method: 'GET', url: '/api/projects', headers: {} });
  out.projectsWithoutAuthStatus = unauthorizedProjects.statusCode;

  const projectsWithDevBypass = await app.inject({
    method: 'GET',
    url: '/api/projects',
    headers: {
      'x-devteam-user-id': 'dev-user',
      'x-devteam-user-email': 'dev@local.test',
      'x-devteam-workspace-id': 'dev-workspace',
      'x-devteam-role': 'owner',
    },
  });
  out.projectsWithAuthStatus = projectsWithDevBypass.statusCode;
  out.projectsWithAuthIsArray = Array.isArray(projectsWithDevBypass.json());

  const create = await app.inject({
    method: 'POST',
    url: '/api/projects',
    headers: {
      'content-type': 'application/json',
      'x-devteam-user-id': 'dev-user',
      'x-devteam-user-email': 'dev@local.test',
      'x-devteam-workspace-id': 'dev-workspace',
      'x-devteam-role': 'owner',
    },
    payload: {
      prompt: 'Build a todo app with auth and dashboard',
    },
  });
  out.createProjectStatus = create.statusCode;
  const createBody = create.json() as { projectId?: string; sessionId?: string; project?: { id?: string } };
  out.createProjectHasIds = Boolean(createBody?.projectId && createBody?.sessionId && createBody?.project?.id);

  if (createBody?.projectId) {
    const getProject = await app.inject({
      method: 'GET',
      url: `/api/projects/${createBody.projectId}`,
      headers: {
        'x-devteam-user-id': 'dev-user',
        'x-devteam-user-email': 'dev@local.test',
        'x-devteam-workspace-id': 'dev-workspace',
        'x-devteam-role': 'owner',
      },
    });
    out.getCreatedProjectStatus = getProject.statusCode;
    const project = getProject.json() as { id?: string; status?: string; ownership?: { workspaceId?: string } };
    out.getCreatedProjectMatches = project?.id === createBody.projectId;
    out.getCreatedProjectOwnershipBound = project?.ownership?.workspaceId === 'dev-workspace';
  }

  await app.close();
  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
