import { describe, expect, it, vi } from 'vitest';
import { createStreamProcessor } from '../src';
import {
  type Actor,
  entities,
  insertRecord,
  modifyRecord,
  removeRecord,
} from './fixtures';

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

  it('does not dispatch a REMOVE record to an INSERT-only handler for the same entity', async () => {
    const insertHandler = vi.fn(async () => {});
    const processor = createStreamProcessor<typeof entities, Actor>({ entities }).on(
      'INSERT',
      'user',
      insertHandler,
    );

    await processor.process([removeRecord()]);

    expect(insertHandler).not.toHaveBeenCalled();
  });

  it('invokes the registered MODIFY handler with both old and new entities and metadata', async () => {
    const calls: unknown[] = [];
    const processor = createStreamProcessor<typeof entities, Actor>({ entities }).on(
      'MODIFY',
      'user',
      async (arg) => {
        calls.push(arg);
      },
    );

    const result = await processor.process([
      modifyRecord({
        pk: 'USER#42',
        oldName: 'Alice',
        newName: 'Alicia',
        sequenceNumber: 'seq-42',
      }),
    ]);

    expect(result).toEqual({ batchItemFailures: [] });
    expect(calls).toHaveLength(1);
    const arg = calls[0] as {
      oldEntity: Record<string, unknown>;
      newEntity: Record<string, unknown>;
      key: { PK: string; SK: string };
      eventID: string;
      sequenceNumber: string;
    };
    expect(arg.oldEntity).toMatchObject({ name: 'Alice', email: 'alice@example.com' });
    expect(arg.newEntity).toMatchObject({
      name: 'Alicia',
      email: 'alicia@example.com',
    });
    expect(arg.key).toEqual({ PK: 'USER#42', SK: 'USER#42' });
    expect(arg.sequenceNumber).toBe('seq-42');
  });

  it('does not dispatch a MODIFY record to an INSERT-only handler for the same entity', async () => {
    const insertHandler = vi.fn(async () => {});
    const processor = createStreamProcessor<typeof entities, Actor>({ entities }).on(
      'INSERT',
      'user',
      insertHandler,
    );

    await processor.process([modifyRecord()]);

    expect(insertHandler).not.toHaveBeenCalled();
  });

  it('silently skips a MODIFY record whose entity has no registered MODIFY handler', async () => {
    const modifyHandler = vi.fn(async () => {});
    const processor = createStreamProcessor<typeof entities, Actor>({ entities }).on(
      'MODIFY',
      'user',
      modifyHandler,
    );

    await processor.process([
      modifyRecord({ pk: 'CACHE#1', sk: 'CACHE#1', type: 'CACHE' }),
    ]);

    expect(modifyHandler).not.toHaveBeenCalled();
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

  it('passes typed old and new entities to a MODIFY handler at compile time (sanity)', async () => {
    const processor = createStreamProcessor<typeof entities, Actor>({ entities }).on(
      'MODIFY',
      'user',
      async ({ oldEntity, newEntity }) => {
        const _oldName: string = oldEntity.name;
        const _newName: string = newEntity.name;
        const _by: Actor = newEntity.modifiedBy;
        void _oldName;
        void _newName;
        void _by;
      },
    );

    await processor.process([modifyRecord()]);
  });

  it('invokes the registered REMOVE handler with the deleted entity and metadata', async () => {
    const calls: unknown[] = [];
    const processor = createStreamProcessor<typeof entities, Actor>({ entities }).on(
      'REMOVE',
      'user',
      async (arg) => {
        calls.push(arg);
      },
    );

    const result = await processor.process([
      removeRecord({ pk: 'USER#42', name: 'Alice', sequenceNumber: 'seq-42' }),
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
    expect(arg.sequenceNumber).toBe('seq-42');
  });

  it('silently skips a REMOVE record whose entity has no registered REMOVE handler', async () => {
    const removeHandler = vi.fn(async () => {});
    const processor = createStreamProcessor<typeof entities, Actor>({ entities }).on(
      'REMOVE',
      'user',
      removeHandler,
    );

    await processor.process([
      removeRecord({ pk: 'CACHE#1', sk: 'CACHE#1', type: 'CACHE' }),
    ]);

    expect(removeHandler).not.toHaveBeenCalled();
  });

  it('passes a typed entity to a REMOVE handler at compile time (sanity)', async () => {
    const processor = createStreamProcessor<typeof entities, Actor>({ entities }).on(
      'REMOVE',
      'user',
      async ({ entity }) => {
        const _name: string = entity.name;
        const _by: Actor = entity.modifiedBy;
        void _name;
        void _by;
      },
    );

    await processor.process([removeRecord()]);
  });
});
