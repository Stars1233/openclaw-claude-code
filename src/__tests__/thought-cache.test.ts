/**
 * Unit tests for thought signature cache
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { cacheThoughtSig, getThoughtSig, injectThoughtSigs, clearCache } from '../proxy/thought-cache.js';

beforeEach(() => {
  clearCache();
});

describe('cacheThoughtSig / getThoughtSig', () => {
  it('round-trips a cached signature', () => {
    cacheThoughtSig('tc_1', 'sig_abc');
    expect(getThoughtSig('tc_1')).toBe('sig_abc');
  });

  it('returns empty string for unknown ID', () => {
    expect(getThoughtSig('nonexistent')).toBe('');
  });

  it('skips caching when toolCallId is empty', () => {
    cacheThoughtSig('', 'sig');
    expect(getThoughtSig('')).toBe('');
  });

  it('skips caching when signature is empty', () => {
    cacheThoughtSig('tc_1', '');
    expect(getThoughtSig('tc_1')).toBe('');
  });

  it('evicts oldest entry when cache exceeds 100', () => {
    for (let i = 0; i < 101; i++) {
      cacheThoughtSig(`tc_${i}`, `sig_${i}`);
    }
    // First entry should be evicted
    expect(getThoughtSig('tc_0')).toBe('');
    // Last entry should remain
    expect(getThoughtSig('tc_100')).toBe('sig_100');
  });
});

describe('injectThoughtSigs', () => {
  it('injects cached signatures into assistant tool_calls', () => {
    cacheThoughtSig('tc_1', 'cached_sig');
    const messages = [
      {
        role: 'assistant',
        tool_calls: [{ id: 'tc_1', type: 'function', function: { name: 'test', arguments: '{}' } }],
      },
    ];
    injectThoughtSigs(messages as Array<Record<string, unknown>>);
    const tc = (messages[0].tool_calls as Array<Record<string, unknown>>)[0];
    expect(tc.extra_content).toEqual({ google: { thought_signature: 'cached_sig' } });
  });

  it('skips non-assistant messages', () => {
    cacheThoughtSig('tc_1', 'sig');
    const messages = [
      {
        role: 'user',
        tool_calls: [{ id: 'tc_1', type: 'function', function: { name: 'test', arguments: '{}' } }],
      },
    ];
    injectThoughtSigs(messages as Array<Record<string, unknown>>);
    const tc = (messages[0].tool_calls as Array<Record<string, unknown>>)[0];
    expect(tc).not.toHaveProperty('extra_content');
  });

  it('does not inject when no cached signature', () => {
    const messages = [
      {
        role: 'assistant',
        tool_calls: [{ id: 'tc_unknown', type: 'function', function: { name: 'test', arguments: '{}' } }],
      },
    ];
    injectThoughtSigs(messages as Array<Record<string, unknown>>);
    const tc = (messages[0].tool_calls as Array<Record<string, unknown>>)[0];
    expect(tc).not.toHaveProperty('extra_content');
  });
});

describe('clearCache', () => {
  it('removes all cached entries', () => {
    cacheThoughtSig('tc_1', 'sig_1');
    cacheThoughtSig('tc_2', 'sig_2');
    clearCache();
    expect(getThoughtSig('tc_1')).toBe('');
    expect(getThoughtSig('tc_2')).toBe('');
  });
});
