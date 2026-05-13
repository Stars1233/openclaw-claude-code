import { describe, it, expect } from 'vitest';
import { isComplete, validateAppSpec, validateAppSpecShape, makeEmptySpec, type AppSpec } from '../../ultraapp/spec.js';

describe('makeEmptySpec', () => {
  it('produces a valid skeleton with version, runId, timestamps, and empty arrays', () => {
    const spec = makeEmptySpec('run-123');
    expect(spec.version).toBe(1);
    expect(spec.runId).toBe('run-123');
    expect(spec.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(spec.updatedAt).toBe(spec.createdAt);
    expect(spec.inputs).toEqual([]);
    expect(spec.outputs).toEqual([]);
    expect(spec.pipeline.steps).toEqual([]);
  });
});

describe('validateAppSpec', () => {
  it('accepts a fully-formed spec', () => {
    const spec = completeSpec();
    expect(() => validateAppSpec(spec)).not.toThrow();
  });

  it('rejects when meta.name has bad characters', () => {
    const spec = completeSpec();
    spec.meta.name = 'Has Spaces';
    expect(() => validateAppSpec(spec)).toThrow(/meta\.name/);
  });

  it('rejects when meta.name is too short', () => {
    const spec = completeSpec();
    spec.meta.name = 'ab';
    expect(() => validateAppSpec(spec)).toThrow(/meta\.name/);
  });

  it('rejects when pipeline has a cycle', () => {
    const spec = completeSpec();
    spec.pipeline.steps = [stepRef('a', ['b.out']), stepRef('b', ['a.out'])];
    expect(() => validateAppSpec(spec)).toThrow(/cycle/i);
  });

  it('rejects when a step refs an unknown step output', () => {
    const spec = completeSpec();
    spec.pipeline.steps = [stepRef('a', ['ghost.out'])];
    expect(() => validateAppSpec(spec)).toThrow(/unknown ref/i);
  });
});

describe('validateAppSpecShape', () => {
  it('accepts a fully-formed spec', () => {
    expect(() => validateAppSpecShape(completeSpec())).not.toThrow();
  });
  it('accepts a partial spec (no inputs, dangling step refs)', () => {
    // The whole point of the lax shape check: tolerate intermediate
    // interview state where Claude has added a step but not yet declared
    // the input it references.
    const spec = makeEmptySpec('run-1');
    spec.meta.name = 'demo';
    spec.pipeline.steps = [stepRef('a', ['inputs.notyetdeclared'])];
    expect(() => validateAppSpecShape(spec)).not.toThrow();
  });
  it('still rejects bad meta.name', () => {
    const spec = completeSpec();
    spec.meta.name = 'Has Spaces';
    expect(() => validateAppSpecShape(spec)).toThrow(/meta\.name/);
  });
  it('still rejects empty runId', () => {
    const spec = completeSpec();
    spec.runId = '';
    expect(() => validateAppSpecShape(spec)).toThrow(/runId/);
  });
  it('still rejects bad version', () => {
    const spec = completeSpec();
    (spec as { version: number }).version = 2;
    expect(() => validateAppSpecShape(spec)).toThrow(/version/);
  });
});

describe('isComplete', () => {
  it('returns ok=true for a fully-formed spec', () => {
    expect(isComplete(completeSpec()).ok).toBe(true);
  });

  it('reports missing meta fields', () => {
    const spec = makeEmptySpec('r1');
    const r = isComplete(spec);
    expect(r.ok).toBe(false);
    expect(r.missing).toContain('meta.name');
    expect(r.missing).toContain('meta.title');
    expect(r.missing).toContain('meta.description');
  });

  it('requires at least one input', () => {
    const spec = completeSpec();
    spec.inputs = [];
    expect(isComplete(spec).missing).toContain('inputs[0]');
  });

  it('requires at least one pipeline step', () => {
    const spec = completeSpec();
    spec.pipeline.steps = [];
    expect(isComplete(spec).missing).toContain('pipeline.steps[0]');
  });
});

function completeSpec(): AppSpec {
  const now = new Date().toISOString();
  return {
    version: 1,
    runId: 'run-1',
    createdAt: now,
    updatedAt: now,
    meta: { name: 'demo', title: 'Demo', description: 'a demo app' },
    inputs: [{ name: 'in', type: 'text', required: true, description: 'input' }],
    outputs: [{ name: 'out', type: 'text', description: 'output' }],
    pipeline: {
      steps: [
        {
          id: 'step1',
          description: 'transform input',
          inputs: ['inputs.in'],
          outputs: ['out'],
          hints: {},
          validates: { outputType: 'text' },
        },
      ],
    },
    runtime: {
      needsLLM: false,
      llmProviders: [],
      binaryDeps: [],
      estimatedRuntimeSec: 5,
      estimatedFileSizeMB: 1,
    },
    ui: { layout: 'single-form', showProgress: false },
  };
}

function stepRef(id: string, refs: string[]) {
  return {
    id,
    description: id,
    inputs: refs,
    outputs: ['out'],
    hints: {},
    validates: { outputType: 'text' },
  };
}
