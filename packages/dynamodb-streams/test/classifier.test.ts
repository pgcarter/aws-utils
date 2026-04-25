import { describe, expect, it } from 'vitest';
import { classifyRecord } from '../src/classifier';
import { entities, insertRecord, modifyRecord, NOW_ISO } from './fixtures';

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

  describe('MODIFY', () => {
    it('matches a record with both images and a known type, returning both entities', () => {
      const record = modifyRecord({
        pk: 'USER#42',
        oldName: 'Alice',
        newName: 'Alicia',
      });
      const result = classifyRecord(record, entities);

      expect(result).toEqual({
        kind: 'modify',
        entityName: 'user',
        oldEntity: {
          PK: 'USER#42',
          SK: 'USER#42',
          type: 'USER',
          name: 'Alice',
          email: 'alice@example.com',
          createdAt: NOW_ISO,
          modifiedAt: NOW_ISO,
        },
        newEntity: {
          PK: 'USER#42',
          SK: 'USER#42',
          type: 'USER',
          name: 'Alicia',
          email: 'alicia@example.com',
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

    it('skips a MODIFY record with no type attribute on the new image', () => {
      const record = modifyRecord({ type: null });
      expect(classifyRecord(record, entities)).toEqual({ kind: 'skip' });
    });

    it('returns unknown-type when the new image type is not in the entities map', () => {
      const record = modifyRecord({ type: 'GHOST' });
      const result = classifyRecord(record, entities);

      expect(result.kind).toBe('unknown-type');
      if (result.kind === 'unknown-type') {
        expect(result.type).toBe('GHOST');
      }
    });

    it('skips a MODIFY record missing the OldImage in this slice', () => {
      const record = modifyRecord({ images: 'new-only' });
      expect(classifyRecord(record, entities)).toEqual({ kind: 'skip' });
    });

    it('skips a MODIFY record missing the NewImage in this slice', () => {
      const record = modifyRecord({ images: 'old-only' });
      expect(classifyRecord(record, entities)).toEqual({ kind: 'skip' });
    });
  });

  it('skips REMOVE events in this slice', () => {
    const record = { ...insertRecord(), eventName: 'REMOVE' as const };
    expect(classifyRecord(record, entities)).toEqual({ kind: 'skip' });
  });
});
