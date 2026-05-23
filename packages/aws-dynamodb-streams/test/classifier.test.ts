import { describe, expect, it } from 'vitest';
import { classifyRecord } from '../src/classifier';
import { entities, insertRecord, modifyRecord, NOW_ISO, removeRecord } from './fixtures';

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

    it('returns missing-image when the NewImage is absent', () => {
      const record = insertRecord({ images: 'none', sequenceNumber: 'seq-99' });
      const result = classifyRecord(record, entities);

      expect(result.kind).toBe('missing-image');
      if (result.kind === 'missing-image') {
        expect(result.event).toBe('INSERT');
        expect(result.missing).toBe('NewImage');
        expect(result.meta.sequenceNumber).toBe('seq-99');
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

    it('returns missing-image for a MODIFY record missing the OldImage', () => {
      const record = modifyRecord({ images: 'new-only', sequenceNumber: 'seq-12' });
      const result = classifyRecord(record, entities);

      expect(result.kind).toBe('missing-image');
      if (result.kind === 'missing-image') {
        expect(result.event).toBe('MODIFY');
        expect(result.missing).toBe('OldImage');
        expect(result.meta.sequenceNumber).toBe('seq-12');
      }
    });

    it('returns missing-image for a MODIFY record missing the NewImage', () => {
      const record = modifyRecord({ images: 'old-only' });
      const result = classifyRecord(record, entities);

      expect(result.kind).toBe('missing-image');
      if (result.kind === 'missing-image') {
        expect(result.event).toBe('MODIFY');
        expect(result.missing).toBe('NewImage');
      }
    });
  });

  describe('REMOVE', () => {
    it('matches a record with an OldImage and a known type, returning the deleted entity', () => {
      const record = removeRecord({ pk: 'USER#42', name: 'Alice' });
      const result = classifyRecord(record, entities);

      expect(result).toEqual({
        kind: 'remove',
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

    it('skips a REMOVE record with no type attribute on the old image', () => {
      const record = removeRecord({ type: null });
      expect(classifyRecord(record, entities)).toEqual({ kind: 'skip' });
    });

    it('returns unknown-type when the old image type is not in the entities map', () => {
      const record = removeRecord({ type: 'GHOST' });
      const result = classifyRecord(record, entities);

      expect(result.kind).toBe('unknown-type');
      if (result.kind === 'unknown-type') {
        expect(result.type).toBe('GHOST');
      }
    });

    it('returns missing-image for a REMOVE record missing the OldImage', () => {
      const record = removeRecord({ images: 'none', sequenceNumber: 'seq-77' });
      const result = classifyRecord(record, entities);

      expect(result.kind).toBe('missing-image');
      if (result.kind === 'missing-image') {
        expect(result.event).toBe('REMOVE');
        expect(result.missing).toBe('OldImage');
        expect(result.meta.sequenceNumber).toBe('seq-77');
      }
    });
  });
});
