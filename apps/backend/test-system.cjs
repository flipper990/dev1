// End-to-end system smoke test — hits the live backend on :3001.
// Validates: health, projects CRUD, status guard, preview shape, export shape,
// and that the post-fix resilience (retry wrapper) is present in the router bundle.
/* eslint-disable */
const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3001';

function req(method, url, body) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const u = new URL(url);
    const r = http.request({
      method, hostname: u.hostname, port: u.port, path: u.pathname + u.search,
      headers: { 'Content-Type': 'application/json', ...(data ? { 'Content-Length': data.length } : {}) },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let json; try { json = JSON.parse(raw); } catch { json = null; }
        resolve({ status: res.statusCode, json, raw, headers: res.headers });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail: detail ?? '' });
  console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${name}${detail ? ' — ' + detail : ''}`);
};

(async () => {
  // 1. Health endpoint
  const h = await req('GET', `${BASE}/health`);
  check('health endpoint returns 200', h.status === 200, `status=${h.status}`);
  check('health reports ok', h.json?.status === 'ok');

  // 2. Projects list
  const list = await req('GET', `${BASE}/api/projects`);
  check('projects list returns 200', list.status === 200);
  check('projects list has array', Array.isArray(list.json?.projects));
  const projects = list.json?.projects ?? [];
  console.log(`       — ${projects.length} projects found`);

  // 3. Find a completed project (use the ConnectSphere one)
  const completed = projects.find(p => p.id === 'proj_moat5mbs2610a0bbc8407d5252f5744d') ?? projects.find(p => p.status === 'completed');
  check('has a completed project to test against', !!completed);
  if (!completed) { finish(); return; }

  // 4. Fetch that project
  const got = await req('GET', `${BASE}/api/projects/${completed.id}`);
  check('GET single project returns 200', got.status === 200);
  check('project has artifacts.files', Array.isArray(got.json?.project?.artifacts?.files));
  const fileCount = got.json?.project?.artifacts?.files?.length ?? 0;
  console.log(`       — ${fileCount} files`);

  // 5. Preview endpoint — shape check
  const prev = await req('GET', `${BASE}/api/projects/${completed.id}/preview`);
  check('preview endpoint returns 200', prev.status === 200);
  check('preview has <!DOCTYPE', /<!DOCTYPE/i.test(prev.raw));
  check('preview includes Babel standalone', /babel.*standalone/i.test(prev.raw));
  check('preview includes mount for React', /ReactDOM\.createRoot/.test(prev.raw));
  check('preview has no leaked bare next/* import', !/from\s+['"]next\/(?:link|router|app|navigation|head|image)['"]/.test(prev.raw));
  check('preview has no leaked bare react-redux import', !/from\s+['"]react-redux['"]/.test(prev.raw));
  check('preview has no leaked bare express import', !/from\s+['"]express['"]/.test(prev.raw));
  check('preview excludes Prisma schema text', !/datasource\s+db\s*\{/.test(prev.raw));

  // 6. Export endpoint — shape check
  const exp = await req('GET', `${BASE}/api/projects/${completed.id}/export`);
  check('export endpoint returns 200', exp.status === 200);
  check('export is a zip (PK header)', exp.raw.slice(0, 2) === 'PK');
  check('export Content-Type is zip', /zip/i.test(exp.headers['content-type'] ?? ''));
  check('export has filename', /attachment/i.test(exp.headers['content-disposition'] ?? ''));

  // 7. Concurrent-update guard (should now 409 for running, but this project is completed so should 202)
  const upd = await req('POST', `${BASE}/api/projects/${completed.id}/prompts`, { prompt: 'no-op validation probe — do not actually generate' });
  check('prompts endpoint accepts new prompt on completed project (202)', upd.status === 202, `got ${upd.status}`);

  // Immediately fire a second update while the first is running — expect 409
  const upd2 = await req('POST', `${BASE}/api/projects/${completed.id}/prompts`, { prompt: 'second concurrent probe' });
  check('prompts endpoint rejects concurrent update with 409', upd2.status === 409, `got ${upd2.status}`);

  // 8. Retry wrapper landed in built router
  try {
    const routerDist = path.join(__dirname, '..', '..', 'services', 'api-routing', 'dist', 'router.js');
    const src = fs.readFileSync(routerDist, 'utf8');
    check('retry wrapper present in built router', /executeWithRetry|isRetriable/.test(src));
    check('exponential backoff constant present', /2\s*\*\*\s*attempt|backoffMs/.test(src));
  } catch (e) {
    check('retry wrapper present in built router', false, 'dist/router.js not found');
  }

  // 9. Coder validator landed
  try {
    const coderDist = path.join(__dirname, '..', '..', 'services', 'agents', 'dist', 'agents', 'coder-agent.js');
    const src = fs.readFileSync(coderDist, 'utf8');
    check('coder parseOutput strengthened (rejects path traversal)', /\.\./.test(src) && /seenPaths/.test(src));
  } catch (e) {
    check('coder parseOutput strengthened (rejects path traversal)', false, 'dist coder-agent.js not found');
  }

  // 10. README detector landed — verify by checking the actual export README for the ConnectSphere project
  try {
    const zipBuf = Buffer.from(exp.raw, 'binary');
    // Find README.md filename in central directory; zip entries have filename ASCII in clear text.
    const readmeIdx = zipBuf.indexOf('README.md');
    check('export ZIP contains README.md entry', readmeIdx > 0);
    // Verify source file has the detector — tsx runs from source so dist doesn't exist.
    const expSrc = path.join(__dirname, 'src', 'routes', 'export-builder.ts');
    const src = fs.readFileSync(expSrc, 'utf8');
    check('detectTechStack present in export-builder source', /function\s+detectTechStack/.test(src) && /Python \(FastAPI\)/.test(src));
  } catch (e) {
    check('detectTechStack present in export-builder source', false, e.message);
  }

  finish();
})().catch(e => {
  console.error('SCRIPT ERROR:', e);
  process.exit(2);
});

function finish() {
  console.log('');
  const pass = results.filter(r => r.ok).length;
  const fail = results.length - pass;
  console.log(`=== ${pass}/${results.length} checks passed${fail ? `, ${fail} FAILED` : ''} ===`);
  process.exit(fail ? 1 : 0);
}
