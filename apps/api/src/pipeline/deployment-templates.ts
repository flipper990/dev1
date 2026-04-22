// Standalone deployment template generation â€” extracted from ProjectGenerator.
// Called by assembleProject() to ensure baseline deployment artifacts always exist.

import type { AgentRole } from '../../../../packages/agent-core/src/types.js';
import type { ProjectFile, EnvVarSpec } from './generator-types.js';

export function ensureDeploymentReadiness(
  fileMap: Map<string, ProjectFile>,
  artifacts: Map<AgentRole, Record<string, unknown>>,
): void {
  const spec = artifacts.get('architect') as { envVars?: EnvVarSpec[] } | undefined;
  const envVars = Array.isArray(spec?.envVars) ? spec.envVars : [];

  if (!fileMap.has('.env.example')) {
    const envContent = envVars.length > 0
      ? envVars.map(v => {
          const comment = v.description ? `# ${v.description}` : '# Environment variable';
          const value = v.example ?? '';
          return `${comment}\n${v.name}=${value}`;
        }).join('\n\n')
      : '# Environment variables\nNODE_ENV=production\nPORT=3000';
    fileMap.set('.env.example', { path: '.env.example', content: `${envContent}\n` });
  }

  if (!fileMap.has('.dockerignore')) {
    fileMap.set('.dockerignore', {
      path: '.dockerignore',
      content: ['node_modules', '.next', 'dist', '.git', '.env', '.env.*', '*.log', 'coverage', 'tmp'].join('\n') + '\n',
    });
  }

  if (!fileMap.has('Dockerfile')) {
    fileMap.set('Dockerfile', {
      path: 'Dockerfile',
      content: [
        'FROM node:22-alpine AS builder',
        'WORKDIR /app',
        'COPY package*.json ./',
        'RUN npm ci',
        'COPY . .',
        'RUN npm run build',
        '',
        'FROM node:22-alpine AS runner',
        'WORKDIR /app',
        'ENV NODE_ENV=production',
        'COPY --from=builder /app/package*.json ./',
        'RUN npm ci --omit=dev',
        'COPY --from=builder /app/dist ./dist',
        'EXPOSE 3000',
        'CMD ["node", "dist/server.js"]',
      ].join('\n') + '\n',
    });
  }

  if (!fileMap.has('docker-compose.yml')) {
    fileMap.set('docker-compose.yml', {
      path: 'docker-compose.yml',
      content: [
        'services:',
        '  app:',
        '    build: .',
        '    ports:',
        '      - "3000:3000"',
        '    env_file:',
        '      - .env',
        '    restart: unless-stopped',
        '    healthcheck:',
        '      test: ["CMD", "wget", "--spider", "-q", "http://localhost:3000/health"]',
        '      interval: 15s',
        '      timeout: 5s',
        '      retries: 5',
        '      start_period: 20s',
      ].join('\n') + '\n',
    });
  }

  if (!fileMap.has('scripts/deploy.sh')) {
    fileMap.set('scripts/deploy.sh', {
      path: 'scripts/deploy.sh',
      content: [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        '',
        'if [[ ! -f .env ]]; then',
        '  echo "Missing .env file. Copy .env.example to .env and configure values."',
        '  exit 1',
        'fi',
        '',
        'docker compose pull || true',
        'docker compose build --pull',
        'docker compose up -d --remove-orphans',
        'docker compose ps',
        'echo "Deployment complete."',
      ].join('\n') + '\n',
    });
  }

  if (!fileMap.has('scripts/deploy.ps1')) {
    fileMap.set('scripts/deploy.ps1', {
      path: 'scripts/deploy.ps1',
      content: [
        '$ErrorActionPreference = "Stop"',
        '',
        'if (-not (Test-Path .env)) {',
        '  Write-Error "Missing .env file. Copy .env.example to .env and configure values."',
        '}',
        '',
        'docker compose pull',
        'docker compose build --pull',
        'docker compose up -d --remove-orphans',
        'docker compose ps',
        'Write-Host "Deployment complete."',
      ].join('\n') + '\n',
    });
  }

  if (!fileMap.has('scripts/validate-env.sh')) {
    const requiredNames = envVars.filter(v => v.required !== false).map(v => v.name).filter(Boolean);
    const requiredLiteral = requiredNames.length > 0
      ? requiredNames.map(name => `"${name}"`).join(' ')
      : '"NODE_ENV" "PORT"';

    fileMap.set('scripts/validate-env.sh', {
      path: 'scripts/validate-env.sh',
      content: [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        '',
        `required=(${requiredLiteral})`,
        'missing=0',
        'for name in "${required[@]}"; do',
        '  if [[ -z "${!name:-}" ]]; then',
        '    echo "Missing required env var: ${name}"',
        '    missing=1',
        '  fi',
        'done',
        '',
        'if [[ ${missing} -ne 0 ]]; then',
        '  exit 1',
        'fi',
        'echo "Environment validation passed."',
      ].join('\n') + '\n',
    });
  }

  if (!fileMap.has('scripts/validate-env.ps1')) {
    const requiredNames = envVars.filter(v => v.required !== false).map(v => v.name).filter(Boolean);
    const list = requiredNames.length > 0 ? requiredNames.map(v => `'${v}'`).join(', ') : `'NODE_ENV', 'PORT'`;

    fileMap.set('scripts/validate-env.ps1', {
      path: 'scripts/validate-env.ps1',
      content: [
        '$ErrorActionPreference = "Stop"',
        `$required = @(${list})`,
        '$missing = @()',
        'foreach ($name in $required) {',
        '  if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) {',
        '    $missing += $name',
        '  }',
        '}',
        '',
        'if ($missing.Count -gt 0) {',
        '  Write-Error ("Missing required env vars: " + ($missing -join ", "))',
        '}',
        'Write-Host "Environment validation passed."',
      ].join('\n') + '\n',
    });
  }

  if (!fileMap.has('.github/workflows/deploy.yml')) {
    fileMap.set('.github/workflows/deploy.yml', {
      path: '.github/workflows/deploy.yml',
      content: [
        'name: Deploy',
        '',
        'on:',
        '  workflow_dispatch:',
        '  push:',
        '    branches: ["main"]',
        '',
        'jobs:',
        '  build-and-publish:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - name: Checkout',
        '        uses: actions/checkout@v4',
        '      - name: Set up Docker Buildx',
        '        uses: docker/setup-buildx-action@v3',
        '      - name: Login to GHCR',
        '        uses: docker/login-action@v3',
        '        with:',
        '          registry: ghcr.io',
        '          username: ${{ github.actor }}',
        '          password: ${{ secrets.GITHUB_TOKEN }}',
        '      - name: Build and push',
        '        uses: docker/build-push-action@v6',
        '        with:',
        '          context: .',
        '          push: true',
        '          tags: ghcr.io/${{ github.repository }}:latest',
        '      - name: Deployment note',
        '        run: echo "Image published. Add environment-specific deploy step (Kubernetes, ECS, or VM)."',
      ].join('\n') + '\n',
    });
  }

  if (!fileMap.has('vercel.json') && !fileMap.has('infra/aws/cloudformation.yaml') && !fileMap.has('infra/aws/terraform/main.tf')) {
    fileMap.set('vercel.json', {
      path: 'vercel.json',
      content: ['{\n  "$schema": "https://openapi.vercel.sh/vercel.json",', '  "version": 2,', '  "buildCommand": "npm run build",', '  "devCommand": "npm run dev"\n}'].join('\n') + '\n',
    });

    fileMap.set('infra/aws/cloudformation.yaml', {
      path: 'infra/aws/cloudformation.yaml',
      content: [
        'AWSTemplateFormatVersion: "2010-09-09"',
        'Description: Basic ECS Fargate scaffold for generated project',
        'Resources:',
        '  Cluster:',
        '    Type: AWS::ECS::Cluster',
        '    Properties:',
        '      ClusterName: generated-project-cluster',
        'Outputs:',
        '  ClusterName:',
        '    Value: !Ref Cluster',
      ].join('\n') + '\n',
    });
  }
}
