import assert from 'node:assert/strict';
import test from 'node:test';
import {
  describePreviewFileIssue,
  validateProjectFilesForPreview,
  type ValidatableFile,
} from './preview-file-validator.js';

function baselineNextFiles(): ValidatableFile[] {
  return [
    {
      path: 'package.json',
      contents: JSON.stringify({
        name: 'generated-app',
        private: true,
        type: 'module',
        scripts: {
          dev: 'next dev',
          build: 'next build',
          start: 'next start',
        },
        dependencies: {
          next: '15.2.0',
          react: '18.3.1',
          'react-dom': '18.3.1',
        },
      }, null, 2),
    },
    {
      path: 'src/app/layout.tsx',
      contents: [
        'import "./globals.css";',
        '',
        'export default function RootLayout({ children }: { children: React.ReactNode }) {',
        '  return <html lang="en"><body>{children}</body></html>;',
        '}',
        '',
      ].join('\n'),
    },
    {
      path: 'src/app/page.tsx',
      contents: 'export default function Page(){ return <main>Hello</main>; }\n',
    },
    {
      path: 'src/app/globals.css',
      contents: ':root { --bg: #fff; }\nbody { background: var(--bg); }\n',
    },
  ];
}

test('valid generated Next baseline passes preview contract', () => {
  const res = validateProjectFilesForPreview(baselineNextFiles());
  assert.equal(res.ok, true);
  assert.equal(res.issues.length, 0);
});

test('missing app/layout fails fast', () => {
  const files = baselineNextFiles().filter((f) => f.path !== 'src/app/layout.tsx');
  const res = validateProjectFilesForPreview(files);
  assert.equal(res.ok, false);
  assert.ok(res.issues.some((i) => i.reason === 'missing-next-layout'));
});

test('missing app/page fails fast', () => {
  const files = baselineNextFiles().filter((f) => f.path !== 'src/app/page.tsx');
  const res = validateProjectFilesForPreview(files);
  assert.equal(res.ok, false);
  assert.ok(
    res.issues.some(
      (i) => i.reason === 'missing-next-page' || i.reason === 'missing-critical-file',
    ),
  );
});

test('invalid global CSS import fails fast', () => {
  const files = baselineNextFiles().map((f) =>
    f.path === 'src/app/layout.tsx'
      ? {
          ...f,
          contents: 'export default function RootLayout({ children }: { children: React.ReactNode }) { return <html><body>{children}</body></html>; }\n',
        }
      : f,
  );
  const res = validateProjectFilesForPreview(files);
  assert.equal(res.ok, false);
  const issue = res.issues.find((i) => i.reason === 'invalid-global-css-import');
  assert.ok(issue);
  assert.match(describePreviewFileIssue(issue), /Invalid global CSS import/i);
});

test('invalid CSS syntax fails fast', () => {
  const files = baselineNextFiles().map((f) =>
    f.path === 'src/app/globals.css'
      ? { ...f, contents: 'body { color: red;\n' }
      : f,
  );
  const res = validateProjectFilesForPreview(files);
  assert.equal(res.ok, false);
  assert.ok(res.issues.some((i) => i.reason === 'invalid-css-syntax'));
});

test('type=module with CommonJS postcss config fails fast', () => {
  const files = [
    ...baselineNextFiles(),
    {
      path: 'postcss.config.js',
      contents: 'module.exports = { plugins: { tailwindcss: {}, autoprefixer: {} } };\n',
    },
  ];
  const res = validateProjectFilesForPreview(files);
  assert.equal(res.ok, false);
  assert.ok(res.issues.some((i) => i.reason === 'invalid-postcss-config-module-format'));
});
