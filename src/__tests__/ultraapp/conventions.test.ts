import { describe, it, expect } from 'vitest';
import { ARCHITECTURAL_CONVENTIONS } from '../../ultraapp/conventions.js';

describe('ARCHITECTURAL_CONVENTIONS', () => {
  it('mentions path-based deploy', () => {
    expect(ARCHITECTURAL_CONVENTIONS).toMatch(/forge\/<slug>/);
    expect(ARCHITECTURAL_CONVENTIONS).toMatch(/basePath|base path/i);
  });
  it('mentions async file-queue runtime endpoints', () => {
    expect(ARCHITECTURAL_CONVENTIONS).toMatch(/POST \/run/);
    expect(ARCHITECTURAL_CONVENTIONS).toMatch(/GET \/status/);
    expect(ARCHITECTURAL_CONVENTIONS).toMatch(/GET \/result/);
  });
  it('mentions BYOK localStorage and forbids server keys', () => {
    expect(ARCHITECTURAL_CONVENTIONS).toMatch(/BYOK/);
    expect(ARCHITECTURAL_CONVENTIONS).toMatch(/localStorage/);
    expect(ARCHITECTURAL_CONVENTIONS).toMatch(/never receive|MUST NOT.*key/i);
  });
  it('mentions Dockerfile + smoke test requirements', () => {
    expect(ARCHITECTURAL_CONVENTIONS).toMatch(/Dockerfile/);
    expect(ARCHITECTURAL_CONVENTIONS).toMatch(/smoke/);
    expect(ARCHITECTURAL_CONVENTIONS).toMatch(/\/health/);
  });
  it('mentions consensus voting protocol', () => {
    expect(ARCHITECTURAL_CONVENTIONS).toMatch(/CONSENSUS: YES/);
  });
});
