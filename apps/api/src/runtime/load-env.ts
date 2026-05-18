import { config as dotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function loadRuntimeEnv(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '../../.env'),
    resolve(here, '../../../../.env'),
  ];

  for (const path of candidates) {
    if (existsSync(path)) {
      dotenv({ path, override: false });
    }
  }
}
