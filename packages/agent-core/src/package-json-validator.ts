// ─────────────────────────────────────────────────────────────
// Static package.json validator
//
// Runs once BEFORE preview startup (after the
// `runPreviewDependencyPreflight` reconciler) to fail fast with a
// human-readable error if the package.json still has a
// peer-dependency conflict that `npm install` would surface as
// ERESOLVE. This is intentionally narrow: it ONLY catches conflicts
// our compatibility bundle's rules govern. Anything outside the
// bundle's scope is delegated to npm.
//
// CHECKS
//   1. Hard "latest"/"*" pin on a peer-sensitive package.
//   2. react / react-dom major mismatch.
//   3. @types/react / @types/react-dom major mismatch with react.
//   4. next declared without react and/or react-dom.
//   5. @vitejs/plugin-react declared without vite.
//   6. tailwindcss@3 declared without autoprefixer or postcss.
//
// Each violation is returned as a structured `PackageJsonViolation`
// with a remediation hint, so the preview-failure error surfaced to
// the dashboard names the exact rule and offending packages — same
// shape as the npm ERESOLVE postmortem.
// ─────────────────────────────────────────────────────────────

import {
  REACT_18_NEXT_15,
  selectBundle,
  parseMajor,
  type CompatibilityBundle,
} from './stack-compatibility.js';

export interface PackageJsonViolation {
  /** Stable id mapping to the bundle rule that would have caught
   *  this. Useful for log aggregation. */
  ruleId: string;
  /** Severity: `error` blocks preview, `warning` is logged but
   *  installable. */
  severity: 'error' | 'warning';
  /** Single-line, dashboard-ready description that names the offending
   *  packages and versions. */
  message: string;
  /** Programmatic detail for tooling. */
  detail: {
    packages: string[];
    foundVersions: Record<string, string | null>;
    expectedVersions?: Record<string, string>;
  };
}

export interface PackageJsonValidationResult {
  ok: boolean;
  bundleId: string;
  violations: PackageJsonViolation[];
  /** True when at least one violation is severity `error`. */
  hasBlockingError: boolean;
  /** Single-line headline for `previewError`, built from the first
   *  blocking violation. */
  headline: string | null;
}

/** Minimal package.json shape we care about. */
export interface PackageJsonInput {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  overrides?: Record<string, string>;
}

/** Combine all dep blocks into one map. Later blocks win — same order
 *  npm uses (deps > devDeps for runtime resolution). */
function flatten(pkg: PackageJsonInput): Record<string, string> {
  return {
    ...(pkg.devDependencies ?? {}),
    ...(pkg.peerDependencies ?? {}),
    ...(pkg.optionalDependencies ?? {}),
    ...(pkg.dependencies ?? {}),
  };
}

/** Validate a parsed package.json against its compatibility bundle.
 *  Pure function — does not mutate the input or read the filesystem. */
export function validatePackageJson(
  pkg: PackageJsonInput,
  bundle: CompatibilityBundle = selectBundle(pkg),
): PackageJsonValidationResult {
  const versions = flatten(pkg);
  const violations: PackageJsonViolation[] = [];

  // CHECK 1: hard "latest" / "*" on peer-sensitive packages.
  // We mirror the bundle's R6 rule. Even though the reconciler should
  // have rewritten these, we re-check here because (a) the reconciler
  // may have been bypassed (e.g. user-edited package.json), and (b)
  // surfacing the violation in the postmortem is informative.
  for (const name of Object.keys(versions)) {
    const ver = versions[name];
    if ((ver === 'latest' || ver === '*') && bundle.versions[name]) {
      violations.push({
        ruleId: 'no-latest-for-peer-sensitive',
        severity: 'error',
        message:
          `${name} is pinned to "${ver}", which is unsafe for a peer-coupled package; ` +
          `use "${bundle.versions[name]}" instead.`,
        detail: {
          packages: [name],
          foundVersions: { [name]: ver },
          expectedVersions: { [name]: bundle.versions[name] },
        },
      });
    }
  }

  // CHECK 2: react / react-dom major alignment.
  const reactVer = versions['react'];
  const reactDomVer = versions['react-dom'];
  const reactMajor = parseMajor(reactVer);
  const reactDomMajor = parseMajor(reactDomVer);
  if (reactVer && !reactDomVer) {
    // Missing react-dom is an error when next is also present (npm
    // will auto-pick latest as next's peer, which on react 18 → ERESOLVE).
    if (versions['next']) {
      violations.push({
        ruleId: 'next-requires-react-dom',
        severity: 'error',
        message:
          `next is declared but react-dom is missing. ` +
          `npm will auto-install react-dom@latest as next's peer, ` +
          `which on react ${reactVer} produces ERESOLVE. ` +
          `Add "react-dom": "${bundle.versions['react-dom']}".`,
        detail: {
          packages: ['react', 'react-dom', 'next'],
          foundVersions: { react: reactVer, 'react-dom': null, next: versions['next'] },
          expectedVersions: { 'react-dom': bundle.versions['react-dom'] },
        },
      });
    }
  } else if (reactVer && reactDomVer && reactMajor !== null && reactDomMajor !== null && reactMajor !== reactDomMajor) {
    violations.push({
      ruleId: 'react-dom-major-aligned-to-react',
      severity: 'error',
      message:
        `react-dom@${reactDomVer} (major ${reactDomMajor}) does not match ` +
        `react@${reactVer} (major ${reactMajor}); ` +
        `react-dom must share react's major version.`,
      detail: {
        packages: ['react', 'react-dom'],
        foundVersions: { react: reactVer, 'react-dom': reactDomVer },
        expectedVersions: { 'react-dom': bundle.versions['react-dom'] },
      },
    });
  }

  // CHECK 3: @types/react alignment with react major.
  if (reactMajor !== null) {
    for (const typesPkg of ['@types/react', '@types/react-dom'] as const) {
      const typesVer = versions[typesPkg];
      const typesMajor = parseMajor(typesVer);
      if (typesVer && typesMajor !== null && typesMajor !== reactMajor) {
        violations.push({
          ruleId: 'types-react-major-aligned-to-react',
          severity: 'error',
          message:
            `${typesPkg}@${typesVer} (major ${typesMajor}) does not match ` +
            `react@${reactVer} (major ${reactMajor}); types must track runtime major.`,
          detail: {
            packages: ['react', typesPkg],
            foundVersions: { react: reactVer, [typesPkg]: typesVer },
            expectedVersions: { [typesPkg]: bundle.versions[typesPkg] },
          },
        });
      }
    }
  }

  // CHECK 4: next without react.
  if (versions['next'] && !versions['react']) {
    violations.push({
      ruleId: 'next-requires-react-dom',
      severity: 'error',
      message:
        `next is declared but react is missing. next peer-requires react; ` +
        `add "react": "${bundle.versions['react']}".`,
      detail: {
        packages: ['next', 'react'],
        foundVersions: { next: versions['next'], react: null },
        expectedVersions: { react: bundle.versions['react'] },
      },
    });
  }

  // CHECK 5: @vitejs/plugin-react without vite.
  if (versions['@vitejs/plugin-react'] && !versions['vite']) {
    violations.push({
      ruleId: 'vite-plugin-react-requires-vite',
      severity: 'error',
      message:
        `@vitejs/plugin-react is declared but vite is missing; ` +
        `@vitejs/plugin-react peer-requires vite. ` +
        `Add "vite": "${bundle.versions['vite']}".`,
      detail: {
        packages: ['@vitejs/plugin-react', 'vite'],
        foundVersions: { '@vitejs/plugin-react': versions['@vitejs/plugin-react'], vite: null },
        expectedVersions: { vite: bundle.versions['vite'] },
      },
    });
  }

  // CHECK 6: Tailwind 3 toolchain coherence.
  if (versions['tailwindcss']) {
    const tailMajor = parseMajor(versions['tailwindcss']);
    if (tailMajor === 3) {
      for (const peer of ['autoprefixer', 'postcss'] as const) {
        if (!versions[peer]) {
          violations.push({
            ruleId: 'tailwind-3-toolchain-coherent',
            severity: 'warning',
            message:
              `tailwindcss@${versions['tailwindcss']} typically needs ${peer}; ` +
              `consider adding "${peer}": "${bundle.versions[peer]}".`,
            detail: {
              packages: ['tailwindcss', peer],
              foundVersions: { tailwindcss: versions['tailwindcss'], [peer]: null },
              expectedVersions: { [peer]: bundle.versions[peer] },
            },
          });
        }
      }
    }
  }

  // CHECK 7: bundle `overrides` block must be present and pinned.
  // The reconciler injects this on every emit (see
  // dependency-validator.validateAndFixDependencies). If a downstream
  // step stripped or rewrote it (user edit, malformed merge, hand-
  // written package.json), `npm install` reverts to peer-resolution
  // and a sub-dep can pull an incompatible major — the exact ERESOLVE
  // class this whole module is here to prevent. Required only when
  // the package is on a React-based stack (react OR react-dom OR
  // next declared).
  const onReactStack = !!(versions['react'] || versions['react-dom'] || versions['next']);
  if (onReactStack && bundle.overrides) {
    const declaredOverrides = pkg.overrides ?? {};
    for (const [name, expected] of Object.entries(bundle.overrides)) {
      const found = declaredOverrides[name];
      if (!found) {
        violations.push({
          ruleId: 'bundle-overrides-required',
          severity: 'error',
          message:
            `package.json is missing required npm override for ${name}. ` +
            `Without it, transitive sub-deps can resolve ${name}@latest and ERESOLVE ` +
            `against the root's pinned majors. Add "overrides": { "${name}": "${expected}", … }.`,
          detail: {
            packages: ['overrides', name],
            foundVersions: { [`overrides.${name}`]: null },
            expectedVersions: { [`overrides.${name}`]: expected },
          },
        });
      } else if (found !== expected) {
        violations.push({
          ruleId: 'bundle-overrides-version-mismatch',
          severity: 'error',
          message:
            `overrides.${name}="${found}" does not match the bundle pin "${expected}". ` +
            `Drift here re-opens the ERESOLVE class this gate exists to close.`,
          detail: {
            packages: ['overrides', name],
            foundVersions: { [`overrides.${name}`]: found },
            expectedVersions: { [`overrides.${name}`]: expected },
          },
        });
      }
    }
  }

  const blocking = violations.filter((v) => v.severity === 'error');
  const headline = blocking.length === 0
    ? null
    : blocking.length === 1
      ? `Package.json conflict: ${blocking[0].message}`
      : `Package.json has ${blocking.length} blocking conflict(s); first: ${blocking[0].message}`;

  return {
    ok: violations.length === 0,
    bundleId: bundle.id,
    violations,
    hasBlockingError: blocking.length > 0,
    headline,
  };
}

/** Convenience: validate the JSON-string form. Returns
 *  `{ ok: false, parseError: ... }` when the input doesn't parse. */
export function validatePackageJsonString(
  raw: string,
): PackageJsonValidationResult & { parseError?: string } {
  try {
    const parsed = JSON.parse(raw) as PackageJsonInput;
    return validatePackageJson(parsed);
  } catch (err) {
    return {
      ok: false,
      bundleId: REACT_18_NEXT_15.id,
      violations: [],
      hasBlockingError: true,
      headline: `package.json parse failed: ${(err as Error).message}`,
      parseError: (err as Error).message,
    };
  }
}
