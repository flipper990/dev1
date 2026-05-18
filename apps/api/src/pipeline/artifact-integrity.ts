import { validatePackageJsonString } from '../../../../packages/agent-core/src/package-json-validator.js';

export type ArtifactIntegritySeverity = 'error' | 'warning';

export interface ArtifactIntegrityIssue {
  severity: ArtifactIntegritySeverity;
  code:
    | 'NO_FILES'
    | 'DUPLICATE_PATH'
    | 'INVALID_FILE_SHAPE'
    | 'EMPTY_SOURCE_FILE'
    | 'MISSING_PACKAGE_JSON'
    | 'INVALID_PACKAGE_JSON'
    | 'MISSING_REQUIRED_SCRIPT'
    | 'MISSING_APP_ENTRY';
  message: string;
  path?: string;
}

export interface ArtifactIntegrityReport {
  ok: boolean;
  issues: ArtifactIntegrityIssue[];
  stats: {
    totalFiles: number;
    uniquePaths: number;
    emptySourceFiles: number;
  };
}

const SOURCE_RE = /\.(?:tsx?|jsx?|mjs|cjs|mts|cts|css|scss|json)$/i;
const APP_ENTRY_CANDIDATES = [
  'src/app/page.tsx',
  'src/app/page.jsx',
  'app/page.tsx',
  'app/page.jsx',
  'src/pages/index.tsx',
  'src/pages/index.jsx',
  'pages/index.tsx',
  'pages/index.jsx',
];

export function validateArtifactIntegrity(
  files: Array<{ path: string; content: string; language?: string }>,
  opts?: { requireAppEntry?: boolean; requirePackageJson?: boolean },
): ArtifactIntegrityReport {
  const issues: ArtifactIntegrityIssue[] = [];
  if (!Array.isArray(files) || files.length === 0) {
    issues.push({
      severity: 'error',
      code: 'NO_FILES',
      message: 'No files were generated for this phase.',
    });
    return {
      ok: false,
      issues,
      stats: { totalFiles: 0, uniquePaths: 0, emptySourceFiles: 0 },
    };
  }

  const byPath = new Map<string, { path: string; content: string; language?: string }>();
  let emptySourceFiles = 0;

  for (const file of files) {
    if (!file || typeof file.path !== 'string' || typeof file.content !== 'string') {
      issues.push({
        severity: 'error',
        code: 'INVALID_FILE_SHAPE',
        message: 'A generated file has invalid shape (path/content must be strings).',
      });
      continue;
    }
    const normalized = file.path.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!normalized) {
      issues.push({
        severity: 'error',
        code: 'INVALID_FILE_SHAPE',
        message: 'A generated file has an empty path.',
      });
      continue;
    }
    if (byPath.has(normalized)) {
      issues.push({
        severity: 'error',
        code: 'DUPLICATE_PATH',
        message: `Duplicate generated file path: ${normalized}`,
        path: normalized,
      });
      continue;
    }
    byPath.set(normalized, { ...file, path: normalized });
    if (SOURCE_RE.test(normalized) && file.content.trim().length === 0) {
      emptySourceFiles += 1;
      issues.push({
        severity: 'warning',
        code: 'EMPTY_SOURCE_FILE',
        message: `Generated source file is empty: ${normalized}`,
        path: normalized,
      });
    }
  }

  const requirePackageJson = opts?.requirePackageJson !== false;
  const packageJson = byPath.get('package.json')
    ?? byPath.get('src/package.json')
    ?? Array.from(byPath.entries()).find(([p]) => p.endsWith('/package.json'))?.[1];
  if (!packageJson) {
    if (requirePackageJson) {
      issues.push({
        severity: 'error',
        code: 'MISSING_PACKAGE_JSON',
        message: 'No package.json found in generated artifacts.',
      });
    }
  } else {
    const parsed = validatePackageJsonString(packageJson.content);
    const hardViolations = parsed.violations.filter((v) => v.severity === 'error');
    if (hardViolations.length > 0) {
      issues.push({
        severity: 'error',
        code: 'INVALID_PACKAGE_JSON',
        path: packageJson.path,
        message: `package.json failed validation (${hardViolations[0]?.ruleId ?? 'unknown'})`,
      });
    }
    try {
      const pkg = JSON.parse(packageJson.content) as { scripts?: Record<string, unknown> };
      const scripts = pkg.scripts ?? {};
      for (const required of ['dev', 'build'] as const) {
        if (typeof scripts[required] !== 'string' || scripts[required].trim().length === 0) {
          issues.push({
            severity: 'error',
            code: 'MISSING_REQUIRED_SCRIPT',
            path: packageJson.path,
            message: `package.json is missing required script '${required}'.`,
          });
        }
      }
    } catch {
      issues.push({
        severity: 'error',
        code: 'INVALID_PACKAGE_JSON',
        path: packageJson.path,
        message: 'package.json is not valid JSON.',
      });
    }
  }

  if (opts?.requireAppEntry) {
    const hasEntry = APP_ENTRY_CANDIDATES.some((p) => byPath.has(p));
    if (!hasEntry) {
      issues.push({
        severity: 'error',
        code: 'MISSING_APP_ENTRY',
        message: 'No application entry page was generated.',
      });
    }
  }

  return {
    ok: issues.every((issue) => issue.severity !== 'error'),
    issues,
    stats: {
      totalFiles: files.length,
      uniquePaths: byPath.size,
      emptySourceFiles,
    },
  };
}
