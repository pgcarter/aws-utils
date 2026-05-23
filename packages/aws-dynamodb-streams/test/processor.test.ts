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

  describe('error path hardening', () => {
    it('throws on a record whose type is not in the entities map', async () => {
      const processor = createStreamProcessor<typeof entities, Actor>({ entities }).on(
        'INSERT',
        'user',
        async () => {},
      );

      await expect(
        processor.process([insertRecord({ type: 'GHOST', eventID: 'evt-ghost' })]),
      ).rejects.toThrow(/GHOST/);
    });

    it('throws on a MODIFY record missing the OldImage, naming the view-type fix', async () => {
      const processor = createStreamProcessor<typeof entities, Actor>({ entities }).on(
        'MODIFY',
        'user',
        async () => {},
      );

      await expect(
        processor.process([modifyRecord({ images: 'new-only' })]),
      ).rejects.toThrow(/NEW_AND_OLD_IMAGES/);
    });

    it('throws on a REMOVE record missing the OldImage, naming the view-type fix', async () => {
      const processor = createStreamProcessor<typeof entities, Actor>({ entities }).on(
        'REMOVE',
        'user',
        async () => {},
      );

      await expect(
        processor.process([removeRecord({ images: 'none' })]),
      ).rejects.toThrow(/NEW_AND_OLD_IMAGES/);
    });

    it('throws on an INSERT record missing the NewImage', async () => {
      const processor = createStreamProcessor<typeof entities, Actor>({ entities }).on(
        'INSERT',
        'user',
        async () => {},
      );

      await expect(
        processor.process([insertRecord({ images: 'none' })]),
      ).rejects.toThrow(/NEW_AND_OLD_IMAGES/);
    });

    it('throws synchronously on duplicate (event, entityName) registration', () => {
      const builder = createStreamProcessor<typeof entities, Actor>({ entities }).on(
        'INSERT',
        'user',
        async () => {},
      );

      expect(() => builder.on('INSERT', 'user', async () => {})).toThrowError(
        /INSERT:user/,
      );
    });

    it('records a handler rejection in batchItemFailures and continues processing', async () => {
      const calls: string[] = [];
      const processor = createStreamProcessor<typeof entities, Actor>({ entities }).on(
        'INSERT',
        'user',
        async ({ sequenceNumber }) => {
          calls.push(sequenceNumber);
          if (sequenceNumber === 'seq-bad') throw new Error('handler failed');
        },
      );

      const result = await processor.process([
        insertRecord({ pk: 'USER#1', sequenceNumber: 'seq-1' }),
        insertRecord({ pk: 'USER#2', sequenceNumber: 'seq-bad' }),
        insertRecord({ pk: 'USER#3', sequenceNumber: 'seq-3' }),
      ]);

      expect(calls).toEqual(['seq-1', 'seq-bad', 'seq-3']);
      expect(result).toEqual({
        batchItemFailures: [{ itemIdentifier: 'seq-bad' }],
      });
    });

    it('preserves per-batch processing order across a mixed batch', async () => {
      const seen: string[] = [];
      const processor = createStreamProcessor<typeof entities, Actor>({ entities }).on(
        'INSERT',
        'user',
        async ({ sequenceNumber }) => {
          seen.push(sequenceNumber);
        },
      );

      const result = await processor.process([
        insertRecord({ pk: 'USER#1', sequenceNumber: 'seq-1' }),
        insertRecord({ type: null, sequenceNumber: 'seq-skip' }),
        insertRecord({ pk: 'USER#3', sequenceNumber: 'seq-3' }),
      ]);

      expect(seen).toEqual(['seq-1', 'seq-3']);
      expect(result).toEqual({ batchItemFailures: [] });
    });
  });

  describe('multi-event registration', () => {
    it('registers a single handler against every event in the array', async () => {
      const calls: Array<{ event: string; sequenceNumber: string }> = [];
      const processor = createStreamProcessor<typeof entities, Actor>({ entities }).on(
        ['INSERT', 'MODIFY'],
        'user',
        async (arg) => {
          const event = 'oldEntity' in arg ? 'MODIFY' : 'INSERT';
          calls.push({ event, sequenceNumber: arg.sequenceNumber });
        },
      );

      await processor.process([
        insertRecord({ sequenceNumber: 'seq-ins' }),
        modifyRecord({ sequenceNumber: 'seq-mod' }),
        removeRecord({ sequenceNumber: 'seq-rem' }),
      ]);

      expect(calls).toEqual([
        { event: 'INSERT', sequenceNumber: 'seq-ins' },
        { event: 'MODIFY', sequenceNumber: 'seq-mod' },
      ]);
    });

    it('degenerates to a singleton registration when the array has one event', async () => {
      const handler = vi.fn(async () => {});
      const processor = createStreamProcessor<typeof entities, Actor>({ entities }).on(
        ['INSERT'],
        'user',
        handler,
      );

      await processor.process([insertRecord(), modifyRecord()]);

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('mixes array-form and single-form .on() calls on the same builder', async () => {
      const userInsertOrModify = vi.fn(async () => {});
      const userRemove = vi.fn(async () => {});
      const processor = createStreamProcessor<typeof entities, Actor>({ entities })
        .on(['INSERT', 'MODIFY'], 'user', userInsertOrModify)
        .on('REMOVE', 'user', userRemove);

      await processor.process([insertRecord(), modifyRecord(), removeRecord()]);

      expect(userInsertOrModify).toHaveBeenCalledTimes(2);
      expect(userRemove).toHaveBeenCalledTimes(1);
    });

    it('throws when an array-form registration overlaps an earlier singleton on the same cell', () => {
      const builder = createStreamProcessor<typeof entities, Actor>({ entities }).on(
        'INSERT',
        'user',
        async () => {},
      );

      expect(() =>
        builder.on(['INSERT', 'MODIFY'], 'user', async () => {}),
      ).toThrowError(/INSERT:user/);
    });

    it('throws when two array-form registrations overlap on the same cell', () => {
      const builder = createStreamProcessor<typeof entities, Actor>({ entities }).on(
        ['INSERT', 'MODIFY'],
        'user',
        async () => {},
      );

      expect(() =>
        builder.on(['MODIFY', 'REMOVE'], 'user', async () => {}),
      ).toThrowError(/MODIFY:user/);
    });

    it('passes a typed union arg to the multi-event handler at compile time (sanity)', async () => {
      const processor = createStreamProcessor<typeof entities, Actor>({ entities }).on(
        ['INSERT', 'MODIFY'],
        'user',
        async (arg) => {
          const _key: { PK: string; SK: string } = arg.key;
          if ('oldEntity' in arg) {
            const _old: string = arg.oldEntity.name;
            void _old;
          } else {
            const _name: string = arg.entity.name;
            void _name;
          }
          void _key;
        },
      );

      await processor.process([insertRecord(), modifyRecord()]);
    });
  });
});
