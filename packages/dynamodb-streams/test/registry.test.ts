import { describe, expect, it } from 'vitest';
import { HandlerRegistry } from '../src/registry';

describe('HandlerRegistry', () => {
  it('returns undefined when no handler is registered for the cell', () => {
    const registry = new HandlerRegistry();
    expect(registry.lookup('INSERT', 'user')).toBeUndefined();
  });

  it('returns the registered handler for the matching cell', () => {
    const registry = new HandlerRegistry();
    const fn = async () => {};
    registry.register('INSERT', 'user', fn);

    expect(registry.lookup('INSERT', 'user')).toBe(fn);
  });

  it('keys cells independently by event and entity name', () => {
    const registry = new HandlerRegistry();
    const insertUser = async () => {};
    const insertCache = async () => {};
    registry.register('INSERT', 'user', insertUser);
    registry.register('INSERT', 'cache', insertCache);

    expect(registry.lookup('INSERT', 'user')).toBe(insertUser);
    expect(registry.lookup('INSERT', 'cache')).toBe(insertCache);
    expect(registry.lookup('MODIFY', 'user')).toBeUndefined();
  });

  it('throws on duplicate (event, entityName) registration with the conflicting cell named', () => {
    const registry = new HandlerRegistry();
    registry.register('INSERT', 'user', async () => {});
    expect(() => registry.register('INSERT', 'user', async () => {})).toThrowError(
      /INSERT:user/,
    );
  });

  it('allows the same handler function to be registered against different cells', () => {
    const registry = new HandlerRegistry();
    const fn = async () => {};
    registry.register('INSERT', 'user', fn);
    expect(() => registry.register('MODIFY', 'user', fn)).not.toThrow();
    expect(registry.lookup('INSERT', 'user')).toBe(fn);
    expect(registry.lookup('MODIFY', 'user')).toBe(fn);
  });
});
