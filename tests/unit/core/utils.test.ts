import { describe, it, expect } from '@jest/globals';
import { generateId, stableStringify, msSince, now } from '../../core/src/index.js';
import {
  AppError, ValidationError, NotFoundError,
  UnauthorizedError, isAppError,
} from '../../core/src/errors.js';

describe('generateId', () => {
  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });

  it('includes prefix', () => {
    const id = generateId('proj');
    expect(id.startsWith('proj_')).toBe(true);
  });
});

describe('stableStringify', () => {
  it('produces same output regardless of key order', () => {
    const a = stableStringify({ z: 1, a: 2, m: 3 });
    const b = stableStringify({ a: 2, m: 3, z: 1 });
    expect(a).toBe(b);
  });

  it('handles nested objects', () => {
    const a = stableStringify({ outer: { z: 1, a: 2 } });
    const b = stableStringify({ outer: { a: 2, z: 1 } });
    expect(a).toBe(b);
  });
});

describe('msSince', () => {
  it('returns milliseconds since a past date', () => {
    const past = new Date(Date.now() - 1000).toISOString();
    expect(msSince(past)).toBeGreaterThanOrEqual(1000);
  });
});

describe('Error classes', () => {
  it('AppError has correct properties', () => {
    const err = new AppError('test', 'TEST_CODE', 400, { detail: true });
    expect(err.message).toBe('test');
    expect(err.code).toBe('TEST_CODE');
    expect(err.statusCode).toBe(400);
    expect(err.details).toEqual({ detail: true });
    expect(isAppError(err)).toBe(true);
  });

  it('ValidationError has 400 status', () => {
    const err = new ValidationError('bad input');
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('VALIDATION_ERROR');
  });

  it('NotFoundError has 404 status', () => {
    const err = new NotFoundError('Project', 'abc123');
    expect(err.statusCode).toBe(404);
    expect(err.message).toContain('abc123');
  });

  it('isAppError returns false for plain errors', () => {
    expect(isAppError(new Error('plain'))).toBe(false);
    expect(isAppError('string')).toBe(false);
  });
});
