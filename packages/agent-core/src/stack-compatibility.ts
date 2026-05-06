// ─────────────────────────────────────────────────────────────
// Stack compatibility bundles
//
// PURPOSE
//   The generator emits package.json by collecting bare-module imports
//   from generated source and matching each to a curated version pin.
//   That works for *individual* packages but does NOT guarantee the
//   resulting set installs together: peer-dependency mismatches across
//   packages (the canonical react / react-dom / next triangle) still
//   produce ERESOLVE failures at preview time.
//
//   This module fixes that by pinning compatible *bundles* of peer-
//   coupled packages. A single source of truth for "if you have X@<a>,
//   then you must have Y@<b> and Z@<c>" so a generated package.json is
//   always installable.
//
// CURRENT BUNDLE: REACT_18_NEXT_15
//   Default for React-based stacks because:
//   - React 18.3 is the latest stable on the v18 line.
//   - Next 15.x peer-requires `react ^18.2.0 || ^19.0.0`. React 18.3 is
//     within that range, and the Next 15 type definitions and runtime
//     helpers are tested against it.
//   - react-dom MUST be the same major as react (peer requires
//     `react ^X.Y.Z` exact major in v19; v18 has matching majors).
//   - @types/react and @types/react-dom MUST be the same major
//     (TS types are coupled to runtime semantics — JSX runtime,
//     `useId`, etc.).
//   - Tailwind 3.x + autoprefixer 10 + postcss 8 are the LTS combo that
//     every Next/Vite scaffold uses today. Tailwind 4 has a different
//     plugin contract — only emit it deliberately, never as a fallback.
//
// CONSUMERS
//   1. dependency-validator.ts (generator-time) — applies the bundle
//      as the source of truth for KNOWN_VERSIONS lookups, and exposes
//      `reconcilePackageJson` to fix peer mismatches detected post-emit.
//   2. preview-dependency-preflight.ts (preview-time) — runs the
//      reconciler again before `npm install`, catching cases the
//      generator created via "latest" or LLM hallucination.
//   3. package-json-validator.ts — a static analyzer that flags
//      illegal version combinations BEFORE preview boot.
//
// EXTENSION
//   To add a new stack (Remix, Astro, Tailwind 4):
//   1. Define a new bundle constant below.
//   2. Add detection logic to `selectBundle` so it picks the new
//      bundle when the package.json signals that stack.
//   3. Add cross-package rules to `BUNDLE_RULES` so the reconciler
//      knows which packages must move together.
// ─────────────────────────────────────────────────────────────

/** A compatibility bundle is a closed set of pinned versions
 *  guaranteed to install together. The reconciler uses these as the
 *  authoritative version when a packages.json conflict is detected. */
export interface CompatibilityBundle {
  /** Stable bundle id (used in logs / postmortem dumps). */
  id: string;
  /** Human-readable description for diagnostics. */
  description: string;
  /** Map of package name → exact pinned semver range. Anything in this
   *  map overrides KNOWN_VERSIONS / "latest" when the bundle is
   *  selected. */
  versions: Record<string, string>;
  /** Hard-pinned `overrides` block written into the root package.json.
   *  npm respects this for ALL transitive resolution, including
   *  packages installed only because they're declared as peers. This
   *  is the only reliable way to stop `next@15.5.x` from auto-pulling
   *  `react-dom@19.x` (whose own `react ^19` peer then ERESOLVEs
   *  against the root's `react ^18`). The reconciler injects this
   *  whenever the bundle is selected, regardless of whether the
   *  emitted package.json already declared its own overrides. */
  overrides: Record<string, string>;
  /** Cross-package rules that MUST hold for this bundle to install.
   *  The reconciler verifies these and forces alignment when violated.
   *  e.g. `react` and `react-dom` must share the same major. */
  rules: BundleRule[];
}

/** A single cross-package coupling rule. The reconciler walks every
 *  rule against a parsed package.json, computes the violation set, and
 *  applies the rule's fix-up policy. */
export interface BundleRule {
  /** Stable rule id, surfaced in logs and the preview-time error
   *  classifier so an engineer reading the dump knows WHICH rule
   *  triggered the rewrite. */
  id: string;
  /** Human-readable description of the invariant. */
  description: string;
  /** Packages this rule governs. The reconciler reads/writes these. */
  packages: readonly string[];
  /** Apply the rule. Receives a mutable version map keyed by package
   *  name (only the packages this rule cares about are passed). The
   *  rule must mutate the map in place to enforce its invariant. The
   *  return value lists what was changed (for the audit log). */
  enforce: (versions: Record<string, string>, bundle: CompatibilityBundle) => RuleEffect[];
}

/** Audit entry produced by a rule's `enforce()` callback. */
export interface RuleEffect {
  /** Package whose version was overwritten. */
  packageName: string;
  /** Version BEFORE the rule fired. `null` when the package was
   *  absent and the rule chose to add it. */
  previousVersion: string | null;
  /** Version the rule wrote. */
  newVersion: string;
  /** Why the rule overrode the existing pin. */
  reason: string;
}

// ─── React 18 / Next 15 / Tailwind 3 LTS ─────────────────────────────
//
// This is the default bundle for every React-based stack the generator
// emits today. Versions are the latest patch of each line that has
// been verified to install cleanly with `npm install` on npm 10/11
// without `--legacy-peer-deps`. Updates require:
//   1. Verify `npm install` succeeds against the new combination.
//   2. Verify `next dev` boots and renders / for an empty page.
//   3. Update this bundle in a single commit (no piecemeal bumps).

/** Packages whose latest published major can break peer-resolution
 *  against the active bundle. The "no-latest" rule (R6) replaces any
 *  `"latest"` / `"*"` declaration of these with the bundle's pin. The
 *  list is intentionally narrow — `dotenv@latest` or `nanoid@latest`
 *  are fine, but `react-dom@latest` is not. Declared BEFORE the
 *  bundle so the rule closures in REACT_18_NEXT_15.rules can capture
 *  it without a TDZ violation at module init. */
const PEER_SENSITIVE_PACKAGES: readonly string[] = [
  'react',
  'react-dom',
  '@types/react',
  '@types/react-dom',
  'next',
  'vite',
  '@vitejs/plugin-react',
  'tailwindcss',
  'autoprefixer',
  'postcss',
  'tailwindcss-animate',
  // Radix primitives: their react peer-range moves over time and a
  // `@radix-ui/react-dialog@latest` happily installs against React 19,
  // breaking a React 18 root.
  '@radix-ui/react-accordion',
  '@radix-ui/react-alert-dialog',
  '@radix-ui/react-aspect-ratio',
  '@radix-ui/react-avatar',
  '@radix-ui/react-checkbox',
  '@radix-ui/react-collapsible',
  '@radix-ui/react-context-menu',
  '@radix-ui/react-dialog',
  '@radix-ui/react-dropdown-menu',
  '@radix-ui/react-hover-card',
  '@radix-ui/react-label',
  '@radix-ui/react-menubar',
  '@radix-ui/react-navigation-menu',
  '@radix-ui/react-popover',
  '@radix-ui/react-progress',
  '@radix-ui/react-radio-group',
  '@radix-ui/react-scroll-area',
  '@radix-ui/react-select',
  '@radix-ui/react-separator',
  '@radix-ui/react-slider',
  '@radix-ui/react-slot',
  '@radix-ui/react-switch',
  '@radix-ui/react-tabs',
  '@radix-ui/react-toast',
  '@radix-ui/react-toggle',
  '@radix-ui/react-toggle-group',
  '@radix-ui/react-tooltip',
];

export const REACT_18_NEXT_15: CompatibilityBundle = {
  id: 'react-18-next-15',
  description: 'React 18.3 + Next 15 + Tailwind 3 LTS — the default for generator-emitted React/Next apps.',
  versions: {
    // Core React runtime — tied tightly via peer rules below.
    'react':                  '^18.3.1',
    'react-dom':              '^18.3.1',
    '@types/react':           '^18.3.12',
    '@types/react-dom':       '^18.3.1',
    // Next.js — peer-requires `react ^18.2 || ^19.0`. Pinning to the
    // 15.0.x patch line (NOT a wide ^15.x caret) — every Next 15.5+
    // release tightened its own auto-pulled react-dom peer to
    // ^19.0.0, which ERESOLVEs against React 18 if the root forgets
    // to declare react-dom (the npm-implicit-peer install path that
    // produced the reference dump). 15.0.x stays compatible with
    // React 18 even when the root underspecifies react-dom.
    'next':                   '~15.0.4',
    // Vite alternative for non-Next React apps.
    'vite':                   '^5.4.0',
    '@vitejs/plugin-react':   '^4.3.0',
    // CSS toolchain — Tailwind 3 LTS. Tailwind 4 has a different
    // PostCSS plugin contract; emitting it as a fallback breaks generated
    // postcss.config.js files.
    'tailwindcss':            '^3.4.14',
    'autoprefixer':           '^10.4.20',
    'postcss':                '^8.4.49',
    'tailwindcss-animate':    '^1.0.7',
    // Common UI deps with React peer constraints. Pinned to versions
    // whose react peer satisfies ^18.
    'class-variance-authority':'^0.7.0',
    'clsx':                   '^2.1.1',
    'tailwind-merge':         '^2.5.4',
    'lucide-react':           '^0.460.0',
    'sonner':                 '^1.7.0',
    'cmdk':                   '^1.0.0',
    'vaul':                   '^1.1.1',
    'react-hook-form':        '^7.53.2',
    '@hookform/resolvers':    '^3.9.1',
    'react-day-picker':       '^9.4.0',
    'recharts':               '^2.13.0',
    'embla-carousel-react':   '^8.3.1',
    'input-otp':              '^1.4.1',
    'react-resizable-panels': '^2.1.7',
    // Radix UI primitives. Pinned to the v1 LTS line whose react peer
    // is ^16.8 || ^17 || ^18 — explicitly compatible with React 18.3.
    '@radix-ui/react-accordion':       '^1.2.1',
    '@radix-ui/react-alert-dialog':    '^1.1.2',
    '@radix-ui/react-aspect-ratio':    '^1.1.0',
    '@radix-ui/react-avatar':          '^1.1.1',
    '@radix-ui/react-checkbox':        '^1.1.2',
    '@radix-ui/react-collapsible':     '^1.1.1',
    '@radix-ui/react-context-menu':    '^2.2.2',
    '@radix-ui/react-dialog':          '^1.1.2',
    '@radix-ui/react-dropdown-menu':   '^2.1.2',
    '@radix-ui/react-hover-card':      '^1.1.2',
    '@radix-ui/react-label':           '^2.1.0',
    '@radix-ui/react-menubar':         '^1.1.2',
    '@radix-ui/react-navigation-menu': '^1.2.1',
    '@radix-ui/react-popover':         '^1.1.2',
    '@radix-ui/react-progress':        '^1.1.0',
    '@radix-ui/react-radio-group':     '^1.2.1',
    '@radix-ui/react-scroll-area':     '^1.2.1',
    '@radix-ui/react-select':          '^2.1.2',
    '@radix-ui/react-separator':       '^1.1.0',
    '@radix-ui/react-slider':          '^1.2.1',
    '@radix-ui/react-slot':            '^1.1.0',
    '@radix-ui/react-switch':          '^1.1.1',
    '@radix-ui/react-tabs':            '^1.1.1',
    '@radix-ui/react-toast':           '^1.2.2',
    '@radix-ui/react-toggle':          '^1.1.0',
    '@radix-ui/react-toggle-group':    '^1.1.0',
    '@radix-ui/react-tooltip':         '^1.1.4',
    // TypeScript and types.
    'typescript':             '^5.6.3',
    'tsx':                    '^4.19.2',
    '@types/node':            '^22.9.0',
  },
  // Hard `overrides` injected into the root package.json. Pins every
  // transitive resolution of these packages — even those introduced
  // by sub-deps (e.g. next → react-dom) — to versions that share a
  // major with the root's react. This is the canonical npm fix for
  // "sub-dep wants react-dom@19, root wants react@18".
  overrides: {
    'react':            '^18.3.1',
    'react-dom':        '^18.3.1',
    '@types/react':     '^18.3.12',
    '@types/react-dom': '^18.3.1',
  },
  rules: [
    // Rule R1: react and react-dom MUST be the same major.
    // Mismatch is THE most common cause of generator ERESOLVE failures
    // (see apps/api/src/testing/last-npm-eresolve.json — `react ^18.3.0`
    // + auto-installed `react-dom@19.x` is exactly this case).
    {
      id: 'react-dom-major-aligned-to-react',
      description: 'react-dom must share the same major version as react.',
      packages: ['react', 'react-dom'],
      enforce(versions, bundle) {
        const effects: RuleEffect[] = [];
        const reactVer = versions['react'] ?? bundle.versions['react'];
        const reactMajor = parseMajor(reactVer);
        if (reactMajor === null) return effects;
        const desiredReactDom = bundle.versions['react-dom'];
        const currentReactDom = versions['react-dom'];
        const currentReactDomMajor = currentReactDom ? parseMajor(currentReactDom) : null;
        // If react is present but react-dom is missing, force-add it.
        // This is the npm-implicit-peer install path that yielded our
        // reference ERESOLVE — npm picks `react-dom@latest` to satisfy
        // next's peer, then conflicts with the root's react pin.
        if (currentReactDom == null) {
          versions['react-dom'] = desiredReactDom;
          effects.push({
            packageName: 'react-dom',
            previousVersion: null,
            newVersion: desiredReactDom,
            reason:
              `react@${reactVer} is declared but react-dom is missing; ` +
              `npm would auto-install latest (react-dom@19.x) and conflict with react ^${reactMajor}.`,
          });
          return effects;
        }
        if (currentReactDomMajor !== reactMajor) {
          versions['react-dom'] = desiredReactDom;
          effects.push({
            packageName: 'react-dom',
            previousVersion: currentReactDom,
            newVersion: desiredReactDom,
            reason:
              `react-dom major ${currentReactDomMajor ?? '?'} mismatches react major ${reactMajor}; ` +
              `react-dom peer-requires react with the same major.`,
          });
        }
        return effects;
      },
    },
    // Rule R2: @types/react / @types/react-dom must match react's major.
    // Mismatched type majors don't trigger ERESOLVE but DO break TSC
    // (e.g. JSX.Element is restructured between 18 and 19 types).
    {
      id: 'types-react-major-aligned-to-react',
      description: '@types/react and @types/react-dom must share the same major version as react.',
      packages: ['react', '@types/react', '@types/react-dom'],
      enforce(versions, bundle) {
        const effects: RuleEffect[] = [];
        const reactVer = versions['react'] ?? bundle.versions['react'];
        const reactMajor = parseMajor(reactVer);
        if (reactMajor === null) return effects;
        for (const pkg of ['@types/react', '@types/react-dom'] as const) {
          const cur = versions[pkg];
          const curMajor = cur ? parseMajor(cur) : null;
          // @types are devDeps so a missing entry doesn't break install,
          // but it does break TSC. Add only when the host package.json
          // already declares this types entry (we don't ADD types unless
          // they were already requested). Mismatch-handling proceeds
          // even when missing→add isn't done here.
          if (curMajor !== null && curMajor !== reactMajor) {
            versions[pkg] = bundle.versions[pkg];
            effects.push({
              packageName: pkg,
              previousVersion: cur ?? null,
              newVersion: bundle.versions[pkg],
              reason:
                `${pkg} major ${curMajor} mismatches react major ${reactMajor}; ` +
                `types must track runtime major.`,
            });
          }
        }
        return effects;
      },
    },
    // Rule R3: Next.js requires both react and react-dom present.
    // If only react was declared (a common LLM emission shape), force
    // react-dom alongside.
    {
      id: 'next-requires-react-dom',
      description: 'Next.js peer-requires react-dom — adding it explicitly avoids npm auto-resolving to latest.',
      packages: ['next', 'react', 'react-dom'],
      enforce(versions, bundle) {
        const effects: RuleEffect[] = [];
        if (!versions['next']) return effects;
        if (!versions['react']) {
          versions['react'] = bundle.versions['react'];
          effects.push({
            packageName: 'react',
            previousVersion: null,
            newVersion: bundle.versions['react'],
            reason: 'next requires react as peer; root must declare it explicitly.',
          });
        }
        if (!versions['react-dom']) {
          versions['react-dom'] = bundle.versions['react-dom'];
          effects.push({
            packageName: 'react-dom',
            previousVersion: null,
            newVersion: bundle.versions['react-dom'],
            reason:
              'next requires react-dom as peer; without an explicit pin npm auto-installs latest, ' +
              'which on react 18 triggers ERESOLVE.',
          });
        }
        return effects;
      },
    },
    // Rule R4: Vite + plugin-react must be coupled.
    // If a project has @vitejs/plugin-react it MUST also have vite.
    {
      id: 'vite-plugin-react-requires-vite',
      description: '@vitejs/plugin-react peer-requires vite — both must be present together.',
      packages: ['vite', '@vitejs/plugin-react'],
      enforce(versions, bundle) {
        const effects: RuleEffect[] = [];
        if (!versions['@vitejs/plugin-react']) return effects;
        if (!versions['vite']) {
          versions['vite'] = bundle.versions['vite'];
          effects.push({
            packageName: 'vite',
            previousVersion: null,
            newVersion: bundle.versions['vite'],
            reason: '@vitejs/plugin-react peer-requires vite; vite was missing.',
          });
        }
        return effects;
      },
    },
    // Rule R5: Tailwind CSS toolchain must be coherent.
    // Tailwind 3 needs autoprefixer + postcss; if any one is present,
    // ensure the trio is consistent.
    {
      id: 'tailwind-3-toolchain-coherent',
      description: 'tailwindcss@3 needs autoprefixer and postcss; ensure all three are present and same line.',
      packages: ['tailwindcss', 'autoprefixer', 'postcss'],
      enforce(versions, bundle) {
        const effects: RuleEffect[] = [];
        if (!versions['tailwindcss']) return effects;
        const tailMajor = parseMajor(versions['tailwindcss']);
        if (tailMajor !== 3) return effects; // bundle only knows Tailwind 3
        for (const pkg of ['autoprefixer', 'postcss'] as const) {
          if (!versions[pkg]) {
            versions[pkg] = bundle.versions[pkg];
            effects.push({
              packageName: pkg,
              previousVersion: null,
              newVersion: bundle.versions[pkg],
              reason: `tailwindcss@${tailMajor} needs ${pkg}; was missing.`,
            });
          }
        }
        return effects;
      },
    },
    // Rule R6: Reject hard "latest" pins for peer-sensitive packages.
    // "latest" is npm-resolved at install time, so a project pinned at
    // generator-time can become non-installable months later when the
    // upstream ships a new major. The bundle's curated pin is used.
    {
      id: 'no-latest-for-peer-sensitive',
      description: '"latest" is unsafe for packages with React/Next/Tailwind peer deps; replace with the bundle pin.',
      packages: PEER_SENSITIVE_PACKAGES,
      enforce(versions, bundle) {
        const effects: RuleEffect[] = [];
        for (const pkg of PEER_SENSITIVE_PACKAGES) {
          const cur = versions[pkg];
          if (cur === 'latest' || cur === '*') {
            const desired = bundle.versions[pkg];
            if (desired) {
              versions[pkg] = desired;
              effects.push({
                packageName: pkg,
                previousVersion: cur,
                newVersion: desired,
                reason: `"latest" replaced with curated pin to lock peer compatibility.`,
              });
            }
          }
        }
        return effects;
      },
    },
  ],
};

/** Packages whose latest published major can break peer-resolution
 *  against the active bundle. The "no-latest" rule (R6) replaces any
 *  `"latest"` / `"*"` declaration of these with the bundle's pin. The
 *  list is intentionally narrow — `dotenv@latest` or `nanoid@latest`
 *  are fine, but `react-dom@latest` is not. Declared earlier in the
 *  file (above REACT_18_NEXT_15) so rule closures can capture it
 *  without a TDZ violation. Re-exported here under the original
 *  position so the public name is consistent with module structure. */
export { PEER_SENSITIVE_PACKAGES };

/** Known bundles, keyed by id. Future stacks (Remix, Astro, Tailwind 4)
 *  add a new entry. The default is REACT_18_NEXT_15 — see `selectBundle`. */
export const BUNDLES: Record<string, CompatibilityBundle> = {
  [REACT_18_NEXT_15.id]: REACT_18_NEXT_15,
};

/** Pick the right bundle for a given package.json. Today the only
 *  bundle we have is the default — but the function is the extension
 *  point for adding stack-specific bundles (e.g. Tailwind 4 + React 19
 *  later). */
export function selectBundle(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> },
): CompatibilityBundle {
  return REACT_18_NEXT_15;
}

/** Result of `reconcilePackageJson`. */
export interface ReconcileResult {
  /** Net version map after rules ran. Caller should write this back
   *  into `dependencies` / `devDependencies` per `classifyBlock`. */
  versions: Record<string, string>;
  /** Audit trail — every change a rule applied. Empty when the input
   *  was already compatible. */
  effects: RuleEffect[];
  /** id of the bundle the reconciler matched against. */
  bundleId: string;
}

/** Apply every rule from the selected bundle to a flat package map.
 *
 *  Input: a single object combining `dependencies` and
 *  `devDependencies` (caller's responsibility to merge before calling).
 *  Output: the reconciled map plus an audit trail of changes.
 *
 *  The reconciler is idempotent — running it twice on already-clean
 *  input produces no effects. */
export function reconcilePackageJson(
  combinedVersions: Record<string, string>,
  bundle: CompatibilityBundle = REACT_18_NEXT_15,
): ReconcileResult {
  const versions = { ...combinedVersions };
  const allEffects: RuleEffect[] = [];
  for (const rule of bundle.rules) {
    const effects = rule.enforce(versions, bundle);
    for (const e of effects) {
      allEffects.push({ ...e, reason: `[${rule.id}] ${e.reason}` });
    }
  }
  return { versions, effects: allEffects, bundleId: bundle.id };
}

/** Parse the major version out of a semver-range string, returning
 *  the integer major or null if unparseable. Accepts "^18.3.1",
 *  "~18", "18", ">=18.0.0", "18.3.1-rc.1", but NOT "latest" / "*"
 *  (returns null). */
export function parseMajor(range: string | null | undefined): number | null {
  if (!range) return null;
  if (range === 'latest' || range === '*') return null;
  const m = range.match(/(\d+)/);
  return m ? Number(m[1]) : null;
}
