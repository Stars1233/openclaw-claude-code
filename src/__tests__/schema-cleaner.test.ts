/**
 * Unit tests for Gemini schema cleaner
 */

import { describe, it, expect } from 'vitest';
import { cleanGeminiSchema } from '../proxy/schema-cleaner.js';

describe('cleanGeminiSchema', () => {
  it('removes additionalProperties', () => {
    const schema = {
      type: 'object',
      properties: { name: { type: 'string' } },
      additionalProperties: false,
    };
    const result = cleanGeminiSchema(schema) as Record<string, unknown>;
    expect(result).not.toHaveProperty('additionalProperties');
    expect(result.type).toBe('object');
    expect(result.properties).toEqual({ name: { type: 'string' } });
  });

  it('removes default and $schema', () => {
    const schema = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'string',
      default: 'hello',
    };
    const result = cleanGeminiSchema(schema) as Record<string, unknown>;
    expect(result).not.toHaveProperty('$schema');
    expect(result).not.toHaveProperty('default');
    expect(result.type).toBe('string');
  });

  it('preserves allowed string formats (enum, date-time)', () => {
    const schema = { type: 'string', format: 'date-time' };
    const result = cleanGeminiSchema(schema) as Record<string, unknown>;
    expect(result.format).toBe('date-time');
  });

  it('removes unsupported string formats (uri, email)', () => {
    const schemaUri = { type: 'string', format: 'uri' };
    const resultUri = cleanGeminiSchema(schemaUri) as Record<string, unknown>;
    expect(resultUri).not.toHaveProperty('format');

    const schemaEmail = { type: 'string', format: 'email' };
    const resultEmail = cleanGeminiSchema(schemaEmail) as Record<string, unknown>;
    expect(resultEmail).not.toHaveProperty('format');
  });

  it('recursively cleans nested objects', () => {
    const schema = {
      type: 'object',
      properties: {
        nested: {
          type: 'object',
          additionalProperties: true,
          properties: {
            deep: { type: 'string', default: 'test' },
          },
        },
      },
    };
    const result = cleanGeminiSchema(schema) as Record<string, unknown>;
    const nested = (result.properties as Record<string, unknown>).nested as Record<string, unknown>;
    expect(nested).not.toHaveProperty('additionalProperties');
    const deep = (nested.properties as Record<string, unknown>).deep as Record<string, unknown>;
    expect(deep).not.toHaveProperty('default');
    expect(deep.type).toBe('string');
  });

  it('handles arrays', () => {
    const schema = [
      { type: 'string', default: 'a' },
      { type: 'number', default: 1 },
    ];
    const result = cleanGeminiSchema(schema) as Array<Record<string, unknown>>;
    expect(result).toHaveLength(2);
    expect(result[0]).not.toHaveProperty('default');
    expect(result[1]).not.toHaveProperty('default');
  });

  it('passes through null, undefined, and primitives', () => {
    expect(cleanGeminiSchema(null)).toBe(null);
    expect(cleanGeminiSchema(undefined)).toBe(undefined);
    expect(cleanGeminiSchema(42)).toBe(42);
    expect(cleanGeminiSchema('hello')).toBe('hello');
    expect(cleanGeminiSchema(true)).toBe(true);
  });
});
