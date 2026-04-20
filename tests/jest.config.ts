import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@devteam/core$': '<rootDir>/../core/src/index.ts',
    '^@devteam/agents$': '<rootDir>/../services/agents/src/index.ts',
    '^@devteam/memory$': '<rootDir>/../services/memory/src/index.ts',
    '^@devteam/orchestration$': '<rootDir>/../services/orchestration/src/index.ts',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { useESM: true }],
  },
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: [
    '../core/src/**/*.ts',
    '../services/*/src/**/*.ts',
    '../apps/backend/src/**/*.ts',
  ],
};

export default config;
