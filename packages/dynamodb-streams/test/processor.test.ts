import { describe, expect, it, vi } from 'vitest';
import { createStreamProcessor } from '../src';
import { type Actor, entities, insertRecord } from './fixtures';

describe('createStreamProcessor', () => {
  it('invokes the registered INSERT handler with the unmarshalled entity and record metadata', async () => {
    const calls: unknown[] = [];
    const processor = createStreamProcessor<typeof entities, Actor>({ entities }).on(
      'INSERT',
      'user',
      async (arg) => {
        calls.push(arg);
      },
    );

    const result = await processor.process([
      insertRecord({ pk: 'USER#42', name: 'Alice', sequenceNumber: 'seq-42' }),
    ]);

    expect(result).toEqual({ batchItemFailures: [] });
    expect(calls).toHaveLength(1);
    const arg = calls[0] as {
      entity: Record<string, unknown>;
      key: { PK: string; SK: string };
      eventID: string;
      sequenceNumber: string;
    };
    expect(arg.entity).toMatchObject({
      PK: 'USER#42',
      SK: 'USER#42',
      type: 'USER',
      name: 'Alice',
      email: 'alice@example.com',
    });
    expect(arg.key).toEqual({ PK: 'USER#42', SK: 'USER#42' });
    expect(arg.eventID).toBe('evt-1');
    expect(arg.sequenceNumber).toBe('seq-42');
  });

  it('silently skips records with no type attribute', async () => {
    const handler = vi.fn(async () => {});
    const processor = createStreamProcessor<typeof entities, Actor>({ entities }).on(
      'INSERT',
      'user',
      handler,
    );

    const result = await processor.process([insertRecord({ type: null })]);

    expect(handler).not.toHaveBeenCalled();
    expect(result).toEqual({ batchItemFailures: [] });
  });

  it('silently skips records whose type has no registered handler', async () => {
    const handler = vi.fn(async () => {});
    const processor = createStreamProcessor<typeof entities, Actor>({ entities }).on(
      'INSERT',
      'user',
      handler,
    );

    const cacheRecord = {
      ...insertRecord({ pk: 'CACHE#1', sk: 'CACHE#1', type: 'CACHE' }),
    };
    const result = await processor.process([cacheRecord]);

    expect(handler).not.toHaveBeenCalled();
    expect(result).toEqual({ batchItemFailures: [] });
  });

  it('silently skips MODIFY and REMOVE records in this slice', async () => {
    const handler = vi.fn(async () => {});
    const processor = createStreamProcessor<typeof entities, Actor>({ entities }).on(
      'INSERT',
      'user',
      handler,
    );

    const modifyRecord = { ...insertRecord(), eventName: 'MODIFY' as const };
    const removeRecord = { ...insertRecord(), eventName: 'REMOVE' as const };

    await processor.process([modifyRecord, removeRecord]);

    expect(handler).not.toHaveBeenCalled();
  });

  it('resolves to an empty batchItemFailures on the happy path', async () => {
    const processor = createStreamProcessor<typeof entities, Actor>({ entities }).on(
      'INSERT',
      'user',
      async () => {},
    );

    const result = await processor.process([insertRecord()]);
    expect(result).toEqual({ batchItemFailures: [] });
  });

  it('passes a typed entity to the handler at compile time (sanity)', async () => {
    const processor = createStreamProcessor<typeof entities, Actor>({ entities }).on(
      'INSERT',
      'user',
      async ({ entity }) => {
        const _name: string = entity.name;
        const _by: Actor = entity.createdBy;
        void _name;
        void _by;
      },
    );

    await processor.process([insertRecord()]);
  });
});
