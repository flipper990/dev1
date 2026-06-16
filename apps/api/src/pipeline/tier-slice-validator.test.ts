import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSliceManifest } from './tier-slice-validator.js';

const accepted = [
  {
    path: 'src/components/Button.tsx',
    content: 'export function Button() { return <button/>; }\n',
    imports: [],
    exports: ['Button'],
    dependencies: [],
    purpose: 'button',
  },
];

test('missing named export is caught early', () => {
  const manifest = {
    path: 'src/app/page.tsx',
    content: "import { Card } from '@/components/Button';\nexport default function Page(){ return <Card />; }\n",
    imports: ['@/components/Button'],
    exports: ['default'],
    dependencies: [],
    purpose: 'page',
  };
  const issues = validateSliceManifest('TIER_2_STRUCTURED_APP', manifest, accepted as any);
  assert.ok(issues.some((i) => i.code === 'missing_named_export'));
});

test('invalid import is caught early', () => {
  const manifest = {
    path: 'src/app/dashboard/page.tsx',
    content: "import { Foo } from '@/components/DoesNotExist';\nexport default function Page(){ return <Foo />; }\n",
    imports: ['@/components/DoesNotExist'],
    exports: ['default'],
    dependencies: [],
    purpose: 'route',
  };
  const issues = validateSliceManifest('TIER_2_STRUCTURED_APP', manifest, accepted as any);
  assert.ok(issues.some((i) => i.code === 'unresolved_import'));
});

test('tier3 contract TypeScript slice parses without ts_parse rejection', () => {
  const manifest = {
    path: 'src/contracts/api-contract.ts',
    content: "export interface ApiContract { listUsers: { route: '/api/users'; method: 'GET' } }\n",
    imports: [],
    exports: ['ApiContract'],
    dependencies: [],
    purpose: 'api-contract',
  };
  const issues = validateSliceManifest('TIER_3_FULLSTACK', manifest, []);
  assert.equal(issues.some((i) => i.code === 'ts_parse'), false);
});

test('react hook imported from non-react module is rejected early', () => {
  const manifest = {
    path: 'src/app/logout/page.tsx',
    content: "import { useEffect } from '@/lib/api-client';\nexport default function Page(){ useEffect(() => {}, []); return <main/>; }\n",
    imports: ['@/lib/api-client'],
    exports: ['default'],
    dependencies: [],
    purpose: 'route',
  };
  const issues = validateSliceManifest('TIER_2_STRUCTURED_APP', manifest, accepted as any);
  assert.ok(issues.some((i) => i.code === 'react_hook_wrong_source'));
});

test('api-client imports outside canonical contract are rejected early', () => {
  const manifest = {
    path: 'src/app/profile/page.tsx',
    content: "import { customMutation } from '@/lib/api-client';\nexport default function Page(){ return <main/>; }\n",
    imports: ['@/lib/api-client'],
    exports: ['default'],
    dependencies: [],
    purpose: 'route',
  };
  const issues = validateSliceManifest('TIER_2_STRUCTURED_APP', manifest, accepted as any);
  assert.ok(issues.some((i) => i.code === 'missing_named_export'));
});

test('missing required component prop is rejected early as component_prop_mismatch', () => {
  const acceptedWithComponent = [
    ...accepted,
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
      imports: [],
      exports: ['LogoutButton'],
      dependencies: [],
      purpose: 'component',
    },
  ];
  const manifest = {
    path: 'src/app/logout/page.tsx',
    content: "import { LogoutButton } from '@/components/LogoutButton';\nexport default function Page(){ return <LogoutButton />; }\n",
    imports: ['@/components/LogoutButton'],
    exports: ['default'],
    dependencies: [],
    purpose: 'route',
  };
  const issues = validateSliceManifest('TIER_2_STRUCTURED_APP', manifest, acceptedWithComponent as any);
  assert.ok(issues.some((i) => i.code === 'component_prop_mismatch'));
  assert.ok(issues.some((i) => i.message.includes('missingProp=onLogout')));
});
