import assert from 'node:assert/strict';
import test from 'node:test';
import { enforceDeterministicGenerationContract } from './deterministic-generation-contract.js';

test('deterministic contract drops app test artifacts and root app duplicates before import integrity checks', () => {
  const result = enforceDeterministicGenerationContract([
    {
      path: 'src/app/page.tsx',
      content: 'export default function Page(){ return <main>ok</main>; }\n',
    },
    {
      path: 'app/page.tsx',
      content: "import X from '../components/Missing'; export default function Legacy(){ return <X/>; }\n",
    },
    {
      path: 'src/app/logout/page.test.tsx',
      content: "import Page from './page'; test('x', () => expect(Page).toBeDefined());\n",
    },
    {
      path: '__tests__/runtime/page.test.tsx',
      content: "import Missing from '../missing'; test('x',()=>expect(Missing).toBeDefined());\n",
    },
  ]);

  assert.equal(result.files.some((f) => f.path === 'app/page.tsx'), false);
  assert.equal(result.files.some((f) => f.path === 'src/app/logout/page.test.tsx'), false);
  assert.equal(result.files.some((f) => f.path === '__tests__/runtime/page.test.tsx'), false);
  assert.equal(result.blockingViolations.some((v) => v.includes('dangling internal import')), false);
  assert.ok(result.warnings.some((w) => w.includes('dropped generated test artifact')));
  assert.ok(result.testImportViolations.length >= 1);
  assert.equal(result.testFilesDropped.includes('__tests__/runtime/page.test.tsx'), true);
  assert.equal(result.testArtifactPolicyReason, 'tier1-runtime-excludes-generated-tests');
});

test('deterministic contract canonicalizes root components to src/components', () => {
  const result = enforceDeterministicGenerationContract([
    {
      path: 'src/app/page.tsx',
      content: "import Card from '@/components/Card'; export default function Page(){ return <Card/>; }\n",
    },
    {
      path: 'components/Card.tsx',
      content: 'export default function Card(){ return <div>Card</div>; }\n',
    },
  ]);

  assert.equal(result.files.some((f) => f.path === 'components/Card.tsx'), false);
  assert.equal(result.files.some((f) => f.path === 'src/components/Card.tsx'), true);
  assert.equal(result.blockingViolations.some((v) => v.includes('dangling internal import')), false);
});

test('deterministic contract excludes apps/api/tests test artifacts from runtime import failures', () => {
  const result = enforceDeterministicGenerationContract([
    {
      path: 'src/app/page.tsx',
      content: 'export default function Page(){ return <main>ok</main>; }\n',
    },
    {
      path: 'apps/api/tests/metrics-updates.test.ts',
      content: "import x from '../src/routes/metrics'; export default x;\n",
    },
  ]);

  assert.equal(result.blockingViolations.some((v) => v.includes('metrics-updates.test.ts')), false);
  assert.equal(result.files.some((f) => f.path === 'apps/api/tests/metrics-updates.test.ts'), false);
  assert.ok(result.testFilesDropped.includes('apps/api/tests/metrics-updates.test.ts'));
  assert.ok(result.testArtifactPathsMatched.includes('apps/api/tests/metrics-updates.test.ts'));
});

test('deterministic contract drops backend runtime artifacts from tier1 preview scope', () => {
  const result = enforceDeterministicGenerationContract([
    {
      path: 'src/app/page.tsx',
      content: 'export default function Page(){ return <main>ok</main>; }\n',
    },
    {
      path: 'apps/api/src/server.ts',
      content: "import { db } from './db'; export default db;\n",
    },
    {
      path: 'routes/users.ts',
      content: "import { db } from '../db/client'; export const users = db;\n",
    },
    {
      path: 'db/client.ts',
      content: 'export const db = {};\n',
    },
  ]);

  assert.equal(result.files.some((f) => f.path === 'apps/api/src/server.ts'), false);
  assert.equal(result.files.some((f) => f.path === 'routes/users.ts'), false);
  assert.equal(result.files.some((f) => f.path === 'db/client.ts'), false);
  assert.ok(result.backendFilesDropped.includes('apps/api/src/server.ts'));
  assert.ok(result.backendFilesDropped.includes('routes/users.ts'));
  assert.ok(result.backendFilesDropped.includes('db/client.ts'));
  assert.ok(result.backendArtifactPathsMatched.includes('apps/api/src/server.ts'));
  assert.ok(result.backendImportViolations.some((v) => v.importer === 'apps/api/src/server.ts'));
  assert.equal(result.blockingViolations.some((v) => v.includes('apps/api/src/server.ts')), false);
});

test('deterministic contract drops pages-router artifacts from tier1 preview scope', () => {
  const result = enforceDeterministicGenerationContract([
    {
      path: 'src/app/page.tsx',
      content: 'export default function Page(){ return <main>ok</main>; }\n',
    },
    {
      path: 'pages/_document.tsx',
      content: "import { Html } from 'next/document'; export default function Document(){ return <Html />; }\n",
    },
    {
      path: 'src/pages/about.tsx',
      content: 'export default function About(){ return <main>about</main>; }\n',
    },
  ]);

  assert.equal(result.files.some((f) => f.path === 'pages/_document.tsx'), false);
  assert.equal(result.files.some((f) => f.path === 'src/pages/about.tsx'), false);
  assert.ok(result.backendFilesDropped.includes('pages/_document.tsx'));
  assert.ok(result.backendFilesDropped.includes('src/pages/about.tsx'));
});

test('deterministic contract adds use client to hook-based source files', () => {
  const result = enforceDeterministicGenerationContract([
    {
      path: 'src/app/page.tsx',
      content: "import Tabs from '@/components/ui/Tabs';\nexport default function Page(){ return <Tabs value=\"a\" />; }\n",
    },
    {
      path: 'src/components/ui/Tabs.tsx',
      content: [
        "import * as React from 'react';",
        'const TabsContext = React.createContext<string | null>(null);',
        'export default function Tabs(){',
        '  const value = React.useContext(TabsContext);',
        '  return <div>{value}</div>;',
        '}',
        '',
      ].join('\n'),
    },
  ]);

  const tabs = result.files.find((f) => f.path === 'src/components/ui/Tabs.tsx')?.content ?? '';
  assert.match(tabs, /^'use client';/);
  assert.ok(result.warnings.some((w) => w.includes('added use client directive for hook-based component')));
});

test('deterministic contract excludes tests/*.test.ts and src/tests/*.test.ts artifacts', () => {
  const result = enforceDeterministicGenerationContract([
    {
      path: 'src/app/page.tsx',
      content: 'export default function Page(){ return <main>ok</main>; }\n',
    },
    {
      path: 'tests/root.behavior.test.ts',
      content: "import Missing from './missing'; export default Missing;\n",
    },
    {
      path: 'src/tests/feature.behavior.test.ts',
      content: "import Missing from '../missing'; export default Missing;\n",
    },
  ]);

  assert.equal(result.blockingViolations.some((v) => v.includes('tests/root.behavior.test.ts')), false);
  assert.equal(result.blockingViolations.some((v) => v.includes('src/tests/feature.behavior.test.ts')), false);
  assert.ok(result.testFilesDropped.includes('tests/root.behavior.test.ts'));
  assert.ok(result.testFilesDropped.includes('src/tests/feature.behavior.test.ts'));
  assert.ok(result.testArtifactPathsMatched.includes('tests/root.behavior.test.ts'));
  assert.ok(result.testArtifactPathsMatched.includes('src/tests/feature.behavior.test.ts'));
});

test('deterministic contract keeps runtime source import validation strict', () => {
  const result = enforceDeterministicGenerationContract([
    {
      path: 'src/app/dashboard/page.tsx',
      content: "import Missing from './Missing'; export default function Page(){ return <Missing/>; }\n",
    },
  ]);
  assert.ok(result.runtimeImportViolations.some((v) => v.importer === 'src/app/dashboard/page.tsx'));
  assert.ok(result.blockingViolations.some((v) => v.includes('src/app/dashboard/page.tsx')));
});

test('test-artifact matcher does not drop runtime files with similar names', () => {
  const result = enforceDeterministicGenerationContract([
    {
      path: 'src/app/contest/page.tsx',
      content: 'export default function Page(){ return <main>contest</main>; }\n',
    },
  ]);
  assert.equal(result.files.some((f) => f.path === 'src/app/contest/page.tsx'), true);
  assert.equal(result.testFilesDropped.length, 0);
});

test('test-artifact dropping preserves non-source test assets and coherent manifest', () => {
  const result = enforceDeterministicGenerationContract([
    {
      path: 'src/app/page.tsx',
      content: 'export default function Page(){ return <main>ok</main>; }\n',
    },
    {
      path: 'tests/fixtures/articles.json',
      content: '{"items":[]}\n',
    },
    {
      path: 'tests/ui/home.test.ts',
      content: "import Missing from '../missing'; export default Missing;\n",
    },
  ]);
  assert.equal(result.files.some((f) => f.path === 'tests/fixtures/articles.json'), true);
  assert.equal(result.files.some((f) => f.path === 'tests/ui/home.test.ts'), false);
  assert.ok(result.testFilesDropped.includes('tests/ui/home.test.ts'));
  assert.ok(result.manifest.files.some((f) => f.path === 'tests/fixtures/articles.json'));
});

test('deterministic contract drops source files under tests directories by default', () => {
  const result = enforceDeterministicGenerationContract([
    {
      path: 'src/app/page.tsx',
      content: "import { buildRuntimeRoute } from '../tests/runtime-helper';\nexport default function Page(){ return <main>{buildRuntimeRoute()}</main>; }\n",
    },
    {
      path: 'src/tests/runtime-helper.ts',
      content: "export function buildRuntimeRoute(){ return 'ok'; }\n",
    },
  ]);

  assert.equal(result.files.some((f) => f.path === 'src/tests/runtime-helper.ts'), false);
  assert.equal(result.blockingViolations.some((v) => v.includes('runtime-helper')), false);
  assert.equal(result.testFilesDropped.some((p) => p.includes('runtime-helper')), true);
});

test('deterministic contract drops packages/**/tests source files by default', () => {
  const result = enforceDeterministicGenerationContract([
    {
      path: 'src/app/page.tsx',
      content: "import { value } from '../../packages/core/tests/runtime-helper';\nexport default function Page(){ return <main>{value}</main>; }\n",
    },
    {
      path: 'packages/core/tests/runtime-helper.ts',
      content: 'export const value = "ok";\n',
    },
    {
      path: 'packages/core/tests/runtime-helper.spec.ts',
      content: "import Missing from '../missing'; export default Missing;\n",
    },
  ]);

  assert.equal(result.files.some((f) => f.path === 'packages/core/tests/runtime-helper.ts'), false);
  assert.equal(result.files.some((f) => f.path === 'packages/core/tests/runtime-helper.spec.ts'), false);
  assert.ok(result.testFilesDropped.includes('packages/core/tests/runtime-helper.ts'));
  assert.ok(result.testFilesDropped.includes('packages/core/tests/runtime-helper.spec.ts'));
  assert.equal(result.blockingViolations.some((v) => v.includes('runtime-helper.spec.ts')), false);
});

test('deterministic contract keeps backend artifacts when override is enabled', () => {
  const result = enforceDeterministicGenerationContract(
    [
      {
        path: 'src/app/page.tsx',
        content: 'export default function Page(){ return <main>ok</main>; }\n',
      },
      {
        path: 'apps/api/src/server.ts',
        content: 'export const api = true;\n',
      },
    ],
    { allowBackendRuntimeArtifacts: true },
  );

  assert.equal(result.files.some((f) => f.path === 'apps/api/src/server.ts'), true);
  assert.equal(result.backendFilesDropped.length, 0);
});

test('deterministic contract removes repeated single-line imports from generated TSX files', () => {
  const result = enforceDeterministicGenerationContract([
    {
      path: 'src/app/page.tsx',
      content: "import { ActivityFeed } from '@/components/dashboard/ActivityFeed';\nexport default function Page(){ return <ActivityFeed activities={[]} hasMore={false} onLoadMore={() => {}} />; }\n",
    },
    {
      path: 'src/components/dashboard/ActivityFeed.tsx',
      content: [
        "'use client';",
        '',
        "import { ActivityItem } from './ActivityItem';",
        "import { Button } from '@/components/ui/Button';",
        "import { Skeleton } from '@/components/ui/Skeleton';",
        '',
        "import { ActivityItem } from './ActivityItem';",
        "import { Button } from '@/components/ui/Button';",
        "import { Skeleton } from '@/components/ui/Skeleton';",
        "import { EmptyActivityState } from './EmptyActivityState';",
        "import { Alert } from '@/components/ui/Alert';",
        '',
        'export interface Activity { id: string; }',
        'export interface ActivityFeedProps { activities: Activity[]; hasMore: boolean; onLoadMore: () => void; }',
        'export function ActivityFeed({ activities, hasMore, onLoadMore }: ActivityFeedProps) {',
        '  if (!activities.length) return <EmptyActivityState />;',
        '  return <div>{activities.map((activity) => <ActivityItem key={activity.id} activity={activity} />)}{hasMore && <Button onClick={onLoadMore}>More</Button>}<Skeleton className="hidden" /><Alert className="hidden">ok</Alert></div>;',
        '}',
        '',
      ].join('\n'),
    },
    {
      path: 'src/components/dashboard/ActivityItem.tsx',
      content: 'export function ActivityItem({ activity }: { activity: { id: string } }) { return <div>{activity.id}</div>; }\n',
    },
    {
      path: 'src/components/dashboard/EmptyActivityState.tsx',
      content: 'export function EmptyActivityState() { return <div>empty</div>; }\n',
    },
    {
      path: 'src/components/ui/Button.tsx',
      content: "import * as React from 'react'; export function Button(props: React.ButtonHTMLAttributes<HTMLButtonElement>) { return <button {...props} />; }\n",
    },
    {
      path: 'src/components/ui/Skeleton.tsx',
      content: 'export function Skeleton({ className }: { className?: string }) { return <div className={className} />; }\n',
    },
    {
      path: 'src/components/ui/Alert.tsx',
      content: "import * as React from 'react'; export function Alert(props: React.HTMLAttributes<HTMLDivElement>) { return <div {...props} />; }\n",
    },
  ]);

  const feed = result.files.find((f) => f.path === 'src/components/dashboard/ActivityFeed.tsx')?.content ?? '';
  assert.equal((feed.match(/import \{ ActivityItem \} from '\.\/ActivityItem';/g) ?? []).length, 1);
  assert.equal((feed.match(/import \{ Button \} from '@\/components\/ui\/Button';/g) ?? []).length, 1);
  assert.equal((feed.match(/import \{ Skeleton \} from '@\/components\/ui\/Skeleton';/g) ?? []).length, 1);
  assert.ok(result.warnings.some((w) => w.includes('duplicate import declaration')));
});

test('deterministic contract patches api-client with fetcher/postJson when imported', () => {
  const result = enforceDeterministicGenerationContract([
    {
      path: 'src/app/profile/ProfileContent.tsx',
      content: [
        "'use client';",
        "import useSWR from 'swr';",
        "import { fetcher, postJson } from '@/lib/api-client';",
        'export default function ProfileContent(){',
        "  const { data } = useSWR('/api/users/get', fetcher);",
        "  return <button onClick={() => postJson('/api/users/update', data)}>save</button>;",
        '}',
        '',
      ].join('\n'),
    },
    {
      path: 'src/lib/api-client.ts',
      content: [
        'export async function getUser(token: string) {',
        "  return { token };",
        '}',
        'export async function updateUser(data: unknown, token: string) {',
        '  return { data, token };',
        '}',
        '',
      ].join('\n'),
    },
  ]);

  const apiClient = result.files.find((f) => f.path === 'src/lib/api-client.ts')?.content ?? '';
  assert.match(apiClient, /export async function fetcher/);
  assert.match(apiClient, /export async function postJson/);
  assert.equal(result.blockingViolations.some((v) => v.includes('import/export mismatch')), false);
});

test('deterministic contract blocks unrecoverable api-client import/export mismatches', () => {
  const result = enforceDeterministicGenerationContract([
    {
      path: 'src/app/profile/ProfileContent.tsx',
      content: [
        "'use client';",
        "import { customMutation } from '@/lib/api-client';",
        'export default function ProfileContent(){ return <div/>; }',
        '',
      ].join('\n'),
    },
    {
      path: 'src/lib/api-client.ts',
      content: "export async function getUser(){ return {}; }\n",
    },
  ]);

  assert.ok(
    result.blockingViolations.some((v) =>
      v.includes("import/export mismatch: src/app/profile/ProfileContent.tsx imports {customMutation} from '@/lib/api-client'"),
    ),
  );
  assert.ok(
    result.blockingViolations.some((v) =>
      v.includes('failedFile=src/app/profile/ProfileContent.tsx')
      && v.includes('invalidImportName=customMutation')
      && v.includes("importedFrom=@/lib/api-client")
      && v.includes('repairAttempted=true')
      && v.includes('repairResult=failed'),
    ),
  );
});

test('deterministic contract moves React hooks from api-client import to react import and preserves api-client symbols', () => {
  const result = enforceDeterministicGenerationContract([
    {
      path: 'src/app/logout/page.tsx',
      content: [
        "'use client';",
        "import { useEffect, fetcher } from '@/lib/api-client';",
        'export default function LogoutPage(){',
        '  useEffect(() => {}, []);',
        "  return <button onClick={() => fetcher('/api/logout')}>logout</button>;",
        '}',
        '',
      ].join('\n'),
    },
    {
      path: 'src/lib/api-client.ts',
      content: 'export async function fetcher(){ return null; }\n',
    },
  ]);

  const logout = result.files.find((f) => f.path === 'src/app/logout/page.tsx')?.content ?? '';
  assert.match(logout, /import\s+\{\s*useEffect\s*\}\s+from\s+['"]react['"]/);
  assert.match(logout, /import\s+\{\s*fetcher\s*\}\s+from\s+['"]@\/lib\/api-client['"]/);
  assert.equal(
    result.blockingViolations.some((v) => v.includes('imports {useEffect} from \'@/lib/api-client\'')),
    false,
  );
});

test('deterministic contract moves React hooks imported from wrong local modules to react', () => {
  const result = enforceDeterministicGenerationContract([
    {
      path: 'src/components/dashboard/SummaryCard.tsx',
      content: [
        "'use client';",
        "import { useMemo } from '@/lib/view-helpers';",
        'export default function SummaryCard(){',
        '  const v = useMemo(() => 1, []);',
        '  return <main>{v}</main>;',
        '}',
        '',
      ].join('\n'),
    },
    {
      path: 'src/lib/view-helpers.ts',
      content: 'export const marker = true;\n',
    },
  ]);
  const card = result.files.find((f) => f.path === 'src/components/dashboard/SummaryCard.tsx')?.content ?? '';
  assert.match(card, /import\s+\{\s*useMemo\s*\}\s+from\s+['"]react['"]/);
  assert.equal(card.includes("from '@/lib/view-helpers'"), false);
});

test('deterministic contract repairs missing required callback props by making preview-safe callback optional', () => {
  const result = enforceDeterministicGenerationContract([
    {
      path: 'src/app/logout/page.tsx',
      content: [
        "import { LogoutButton } from '@/components/LogoutButton';",
        'export default function LogoutPage(){',
        '  return <LogoutButton />;',
        '}',
        '',
      ].join('\n'),
    },
    {
      path: 'src/components/LogoutButton.tsx',
      content: [
        'export interface LogoutButtonProps {',
        '  onLogout: () => void;',
        '}',
        'export function LogoutButton({ onLogout }: LogoutButtonProps) {',
        '  return <button onClick={onLogout}>Logout</button>;',
        '}',
        '',
      ].join('\n'),
    },
  ]);

  const logoutButton = result.files.find((f) => f.path === 'src/components/LogoutButton.tsx')?.content ?? '';
  assert.match(logoutButton, /onLogout\?: \(\) => void;/);
  assert.equal(result.blockingViolations.some((v) => v.includes('generated_component_prop_mismatch')), false);
  assert.ok(
    result.componentPropViolations.some((v) =>
      v.componentName === 'LogoutButton' && v.missingProp === 'onLogout' && v.repairResult === 'repaired'
    ),
  );
});

test('deterministic contract fails unrecoverable required non-callback props with component mismatch diagnostics', () => {
  const result = enforceDeterministicGenerationContract([
    {
      path: 'src/app/dashboard/page.tsx',
      content: [
        "import { KpiCard } from '@/components/KpiCard';",
        'export default function DashboardPage(){',
        '  return <KpiCard />;',
        '}',
        '',
      ].join('\n'),
    },
    {
      path: 'src/components/KpiCard.tsx',
      content: [
        'export interface KpiCardProps {',
        '  title: string;',
        '}',
        'export function KpiCard({ title }: KpiCardProps) {',
        '  return <article>{title}</article>;',
        '}',
        '',
      ].join('\n'),
    },
  ]);

  assert.ok(result.blockingViolations.some((v) => v.includes('generated_component_prop_mismatch')));
  assert.ok(
    result.blockingViolations.some((v) =>
      v.includes('failedFile=src/app/dashboard/page.tsx')
      && v.includes('componentName=KpiCard')
      && v.includes('missingProp=title')
      && v.includes('repairAttempted=false')
      && v.includes('repairResult=failed'),
    ),
  );
  assert.ok(
    result.componentPropViolations.some((v) =>
      v.componentName === 'KpiCard' && v.missingProp === 'title' && v.repairResult === 'failed'
    ),
  );
});
