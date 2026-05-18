import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

import {
  LocalPreviewRunner,
  extractBuildFailureDiagnostics,
  type LocalPreviewFile,
} from './local-runner.js';

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as const;

function baseFiles(): LocalPreviewFile[] {
  return [
    {
      path: 'package.json',
      contents: JSON.stringify({
        name: 'snapshot-test',
        private: true,
        scripts: {
          dev: 'next dev',
          build: 'next build',
        },
        dependencies: {
          next: '15.0.0',
          react: '19.0.0',
          'react-dom': '19.0.0',
        },
      }),
    },
    {
      path: 'src/app/page.tsx',
      contents: 'export default function Page(){ return <main>ok</main>; }\n',
    },
  ];
}

function createRunner(projectRoot: string) {
  let nextPort = 45100;
  const released: number[] = [];
  const runner = new LocalPreviewRunner({
    projectStore: {
      getOutputDir(projectId: string) {
        return path.join(projectRoot, projectId, 'output');
      },
      get: async () => null,
    } as any,
    ports: {
      async allocate() {
        nextPort += 1;
        return nextPort;
      },
      release(port: number) {
        released.push(port);
      },
    } as any,
    logger: noopLogger as any,
  });
  return { runner, released };
}

test('install failure persists last failure snapshot in local-runner', async () => {
  const root = path.join(process.cwd(), '.tmp-tests', `local-runner-install-${Date.now()}`);
  await mkdir(root, { recursive: true });
  const { runner, released } = createRunner(root);
  (runner as any).snapshotFailure = () => {
    throw new Error('should not call instance snapshotFailure');
  };
  (runner as any).runInstall = async () => {
    throw new Error('install failed hard');
  };

  await assert.rejects(
    () => runner.start('project-install-fail', baseFiles()),
    /npm install failed: install failed hard/,
  );

  const snap = runner.getLastFailure('project-install-fail');
  assert.ok(snap, 'expected failedRecords snapshot');
  assert.equal(snap?.projectId, 'project-install-fail');
  assert.equal(snap?.installMode, null);
  assert.equal(snap?.childPid, null);
  assert.equal(snap?.lastSuccessfulStep, 'staged files');
  assert.equal(runner.get('project-install-fail'), null);
  assert.equal(released.length, 1);

  await rm(root, { recursive: true, force: true });
});

test('build failure persists last failure snapshot in local-runner', async () => {
  const root = path.join(process.cwd(), '.tmp-tests', `local-runner-build-${Date.now()}`);
  await mkdir(root, { recursive: true });
  const { runner, released } = createRunner(root);
  (runner as any).snapshotFailure = () => {
    throw new Error('should not call instance snapshotFailure');
  };
  (runner as any).runInstall = async () => {};
  (runner as any).runBuild = async () => {
    throw new Error('build failed hard');
  };

  await assert.rejects(
    () => runner.start('project-build-fail', baseFiles()),
    /build failed hard/,
  );

  const snap = runner.getLastFailure('project-build-fail');
  assert.ok(snap, 'expected failedRecords snapshot');
  assert.equal(snap?.projectId, 'project-build-fail');
  assert.equal(snap?.installMode, 'standard');
  assert.equal(snap?.error, 'build failed hard');
  assert.equal(snap?.childPid, null);
  assert.equal(runner.get('project-build-fail'), null);
  assert.equal(released.length, 1);

  await rm(root, { recursive: true, force: true });
});

test('extractBuildFailureDiagnostics captures failed file and TypeScript error', () => {
  const diagnostics = extractBuildFailureDiagnostics([
    '> next build',
    './src/app/404.tsx:25:21',
    "Type error: Type '{ children: string; as: string; }' is not assignable to type 'ButtonProps'.",
    '',
  ].join('\n'));

  assert.equal(diagnostics.phase, 'preview:building');
  assert.equal(diagnostics.failedFile, './src/app/404.tsx:25:21');
  assert.match(diagnostics.errorMessage, /^Type error:/);
  assert.match(diagnostics.recommendedRepairPath, /src\/app\/404\.tsx:25:21/);
});
