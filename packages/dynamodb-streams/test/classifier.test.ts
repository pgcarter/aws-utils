import { describe, expect, it } from 'vitest';
import { classifyRecord } from '../src/classifier';
import { entities, insertRecord, NOW_ISO } from './fixtures';

describe('classifyRecord', () => {
  describe('INSERT', () => {
    it('matches a record whose type is in the entities map', () => {
      const record = insertRecord({ pk: 'USER#42', name: 'Alice' });
      const result = classifyRecord(record, entities);

      expect(result).toEqual({
        kind: 'insert',
        entityName: 'user',
        entity: {
          PK: 'USER#42',
          SK: 'USER#42',
          type: 'USER',
          name: 'Alice',
          email: 'alice@example.com',
          createdAt: NOW_ISO,
          modifiedAt: NOW_ISO,
        },
        meta: {
          key: { PK: 'USER#42', SK: 'USER#42' },
          eventID: 'evt-1',
          sequenceNumber: '0000001',
          approximateCreationDateTime: new Date(NOW_ISO),
        },
      });
    });

    it('skips an INSERT record with no type attribute on the new image', () => {
      const record = insertRecord({ type: null });
      expect(classifyRecord(record, entities)).toEqual({ kind: 'skip' });
    });

    it('returns unknown-type when the type is not in the entities map', () => {
      const record = insertRecord({ type: 'GHOST' });
      const result = classifyRecord(record, entities);

      expect(result.kind).toBe('unknown-type');
      if (result.kind === 'unknown-type') {
        expect(result.type).toBe('GHOST');
        expect(result.meta.eventID).toBe('evt-1');
      }
    });
  });

  it('skips MODIFY events in this slice', () => {
    const record = { ...insertRecord(), eventName: 'MODIFY' as const };
    expect(classifyRecord(record, entities)).toEqual({ kind: 'skip' });
  });

  it('skips REMOVE events in this slice', () => {
    const record = { ...insertRecord(), eventName: 'REMOVE' as const };
    expect(classifyRecord(record, entities)).toEqual({ kind: 'skip' });
  });
});
