import { enforceDeterministicGenerationContract } from '../pipeline/deterministic-generation-contract.js';
import { validateArtifactIntegrity } from '../pipeline/artifact-integrity.js';
import { validatePackageJsonString } from '../../../../packages/agent-core/src/package-json-validator.js';

export function runFastContractCheck(): void {
  const baseline = [
    {
      path: 'src/app/page.tsx',
      content: 'export default function Page(){ return <main>ok</main>; }\n',
    },
  ];

  const contract = enforceDeterministicGenerationContract(baseline);
  if (contract.blockingViolations.length > 0) {
    throw new Error(`deterministic contract failed: ${contract.blockingViolations.join(' | ')}`);
  }

  const integrity = validateArtifactIntegrity(contract.files, {
    requireAppEntry: true,
    requirePackageJson: true,
  });
  if (!integrity.ok) {
    const first = integrity.issues.find((i) => i.severity === 'error');
    throw new Error(`artifact integrity failed: ${first?.code ?? 'unknown'} ${first?.message ?? ''}`.trim());
  }

  const pkg = contract.files.find((f) => f.path === 'package.json');
  if (!pkg) throw new Error('contract did not emit package.json');
  const pkgValidation = validatePackageJsonString(pkg.content);
  if (pkgValidation.hasBlockingError) {
    const first = pkgValidation.violations.find((v) => v.severity === 'error');
    throw new Error(`package.json validation failed: ${first?.ruleId ?? 'unknown'} ${first?.message ?? ''}`.trim());
  }
}

if ((process.argv[1] ?? '').includes('contract-fast-check')) {
  try {
    runFastContractCheck();
    console.log('[contract-fast-check] ok');
  } catch (err) {
    console.error(`[contract-fast-check] failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
