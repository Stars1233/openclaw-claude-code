/**
 * Unit tests for shared types and constants
 */

import { describe, it, expect } from 'vitest';
import { MODEL_PRICING, MODEL_ALIASES } from '../types.js';

describe('MODEL_PRICING', () => {
  it('contains expected models', () => {
    const expected = [
      'claude-opus-4-6',
      'claude-sonnet-4-6',
      'claude-haiku-4-5',
      'gemini-2.5-pro',
      'gpt-4o',
      'o4-mini',
    ];
    for (const model of expected) {
      expect(MODEL_PRICING[model], `missing pricing for ${model}`).toBeDefined();
    }
  });

  it('has positive input and output prices', () => {
    for (const [model, pricing] of Object.entries(MODEL_PRICING)) {
      expect(pricing.input, `${model} input should be positive`).toBeGreaterThan(0);
      expect(pricing.output, `${model} output should be positive`).toBeGreaterThan(0);
    }
  });

  it('cached is optional but positive when defined', () => {
    for (const [model, pricing] of Object.entries(MODEL_PRICING)) {
      if (pricing.cached !== undefined) {
        expect(pricing.cached, `${model} cached should be positive`).toBeGreaterThan(0);
      }
    }
  });
});

describe('MODEL_ALIASES', () => {
  it('all aliases resolve to a model in MODEL_PRICING', () => {
    for (const [alias, model] of Object.entries(MODEL_ALIASES)) {
      expect(MODEL_PRICING[model], `alias '${alias}' -> '${model}' not in MODEL_PRICING`).toBeDefined();
    }
  });

  it('contains expected aliases', () => {
    expect(MODEL_ALIASES['opus']).toBeDefined();
    expect(MODEL_ALIASES['sonnet']).toBeDefined();
    expect(MODEL_ALIASES['haiku']).toBeDefined();
  });
});
