export interface AppSpec {
  version: 1;
  runId: string;
  createdAt: string;
  updatedAt: string;
  meta: { name: string; title: string; description: string };
  inputs: AppSpecInput[];
  outputs: AppSpecOutput[];
  pipeline: { steps: AppSpecStep[] };
  runtime: AppSpecRuntime;
  ui: AppSpecUi;
}

export interface AppSpecInput {
  name: string;
  type: 'file' | 'files' | 'text' | 'enum' | 'number';
  accept?: string;
  required: boolean;
  description: string;
  examples?: Array<{ ref: string; metadata?: Record<string, unknown> }>;
  enumValues?: string[];
}

export interface AppSpecOutput {
  name: string;
  type: 'file' | 'text' | 'json' | 'image-gallery' | 'video';
  description: string;
}

export interface AppSpecStep {
  id: string;
  description: string;
  inputs: string[];
  outputs: string[];
  hints: {
    likelyTools?: string[];
    referenceCommand?: string;
    referenceCode?: string;
    notes?: string;
  };
  validates: { outputType: string };
}

export interface AppSpecRuntime {
  needsLLM: boolean;
  llmProviders: Array<'anthropic' | 'openai' | 'google'>;
  binaryDeps: string[];
  estimatedRuntimeSec: number;
  estimatedFileSizeMB: number;
}

export interface AppSpecUi {
  layout: 'single-form' | 'wizard' | 'split-view';
  showProgress: boolean;
  accentColor?: string;
}

const NAME_RE = /^[a-z0-9][a-z0-9-]{2,31}$/;

export function makeEmptySpec(runId: string): AppSpec {
  const now = new Date().toISOString();
  return {
    version: 1,
    runId,
    createdAt: now,
    updatedAt: now,
    meta: { name: '', title: '', description: '' },
    inputs: [],
    outputs: [],
    pipeline: { steps: [] },
    runtime: {
      needsLLM: false,
      llmProviders: [],
      binaryDeps: [],
      estimatedRuntimeSec: 0,
      estimatedFileSizeMB: 0,
    },
    ui: { layout: 'single-form', showProgress: false },
  };
}

/**
 * Lax shape check for intermediate AppSpec writes during interview iteration.
 * Catches obviously-broken state but tolerates partial pipelines, references
 * to inputs not yet declared, etc. — Claude builds the spec incrementally and
 * transient invalid states are expected. Strict cross-ref + DAG check happens
 * at startBuild via {@link validateAppSpec}.
 */
export function validateAppSpecShape(spec: AppSpec): void {
  if (spec.version !== 1) throw new Error('AppSpec.version must be 1');
  if (typeof spec.runId !== 'string' || spec.runId.length === 0) {
    throw new Error('AppSpec.runId required');
  }
  if (spec.meta.name && !NAME_RE.test(spec.meta.name)) {
    throw new Error('AppSpec.meta.name must match [a-z0-9][a-z0-9-]{2,31}');
  }
}

/**
 * Strict validation: shape + every pipeline step's input refs must resolve to
 * a declared input or a prior step + the pipeline DAG must be acyclic. Called
 * at startBuild; do NOT call from writeSpec (that fires on every interview
 * patch and Claude iterates incrementally).
 */
export function validateAppSpec(spec: AppSpec): void {
  validateAppSpecShape(spec);
  const stepIds = new Set(spec.pipeline.steps.map((s) => s.id));
  const inputNames = new Set(spec.inputs.map((i) => i.name));
  for (const step of spec.pipeline.steps) {
    for (const ref of step.inputs) {
      if (ref.startsWith('inputs.')) {
        const k = ref.slice('inputs.'.length);
        if (!inputNames.has(k)) {
          throw new Error(`pipeline step '${step.id}': unknown ref '${ref}'`);
        }
      } else {
        const [stepId] = ref.split('.');
        if (!stepIds.has(stepId)) {
          throw new Error(`pipeline step '${step.id}': unknown ref '${ref}'`);
        }
      }
    }
  }
  const incoming = new Map<string, Set<string>>();
  for (const s of spec.pipeline.steps) incoming.set(s.id, new Set());
  for (const s of spec.pipeline.steps) {
    for (const ref of s.inputs) {
      if (!ref.startsWith('inputs.')) {
        const [src] = ref.split('.');
        incoming.get(s.id)!.add(src);
      }
    }
  }
  const queue: string[] = [];
  for (const s of spec.pipeline.steps) {
    if (incoming.get(s.id)!.size === 0) queue.push(s.id);
  }
  let visited = 0;
  while (queue.length) {
    const id = queue.shift()!;
    visited++;
    for (const s of spec.pipeline.steps) {
      const deps = incoming.get(s.id)!;
      if (deps.has(id)) {
        deps.delete(id);
        if (deps.size === 0) queue.push(s.id);
      }
    }
  }
  if (visited !== spec.pipeline.steps.length) throw new Error('pipeline has a cycle');
}

export function isComplete(spec: AppSpec): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!spec.meta.name) missing.push('meta.name');
  if (!spec.meta.title) missing.push('meta.title');
  if (!spec.meta.description) missing.push('meta.description');
  if (spec.inputs.length === 0) {
    missing.push('inputs[0]');
  } else {
    spec.inputs.forEach((inp, i) => {
      if (!inp.name) missing.push(`inputs[${i}].name`);
      if (!inp.type) missing.push(`inputs[${i}].type`);
      if (!inp.description) missing.push(`inputs[${i}].description`);
    });
  }
  if (spec.outputs.length === 0) missing.push('outputs[0]');
  if (spec.pipeline.steps.length === 0) missing.push('pipeline.steps[0]');
  return { ok: missing.length === 0, missing };
}
