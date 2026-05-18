import { runDbPreflight } from './db-preflight.js';
import { loadRuntimeEnv } from './load-env.js';

function printResult(prefix: string, result: Awaited<ReturnType<typeof runDbPreflight>>): void {
  console.log(`${prefix} DATABASE_URL=${result.databaseUrl ?? 'missing'}`);
  console.log(`${prefix} target=${result.host ?? 'unknown'}:${result.port ?? 'unknown'} db=${result.database ?? 'unknown'} user=${result.user ?? 'unknown'}`);
  console.log(`${prefix} checks.url=${result.checks.url.ok ? 'ok' : 'fail'} (${result.checks.url.reason})`);
  console.log(`${prefix} checks.tcp=${result.checks.tcp.ok ? 'ok' : 'fail'} (${result.checks.tcp.reason})`);
  console.log(`${prefix} checks.auth=${result.checks.auth.ok ? 'ok' : 'fail'} (${result.checks.auth.reason})`);
  console.log(`${prefix} checks.database=${result.checks.database.ok ? 'ok' : 'fail'} (${result.checks.database.reason})`);
  console.log(`${prefix} checks.migrations=${result.checks.migrations.ok ? 'ok' : 'fail'} (${result.checks.migrations.reason})`);
  for (const line of result.diagnostics) {
    console.log(`${prefix} hint=${line}`);
  }
}

async function main(): Promise<void> {
  loadRuntimeEnv();
  const result = await runDbPreflight();
  printResult('[db-preflight]', result);
  if (!result.ok) {
    throw new Error(
      'Database preflight failed. Fix DATABASE_URL/credentials/postgres availability before starting API.',
    );
  }
}

main().catch((err) => {
  console.error(`[db-preflight] fatal=${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
