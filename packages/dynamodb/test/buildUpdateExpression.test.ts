import { describe, expect, it } from 'vitest';
import { buildUpdateExpression } from '../src';

describe('buildUpdateExpression', () => {
  it('builds a SET-only expression from a user patch', () => {
    const result = buildUpdateExpression({ name: 'Alice', email: 'alice@example.com' });

    expect(result.UpdateExpression).toBe('SET #a0 = :a0, #a1 = :a1');
    expect(result.ExpressionAttributeNames).toEqual({
      '#a0': 'name',
      '#a1': 'email',
    });
    expect(result.ExpressionAttributeValues).toEqual({
      ':a0': 'Alice',
      ':a1': 'alice@example.com',
    });
  });

  it('skips undefined values in the patch', () => {
    const result = buildUpdateExpression({ name: 'Alice', email: undefined });

    expect(result.UpdateExpression).toBe('SET #a0 = :a0');
    expect(result.ExpressionAttributeNames).toEqual({ '#a0': 'name' });
    expect(result.ExpressionAttributeValues).toEqual({ ':a0': 'Alice' });
  });

  it('builds a REMOVE-only expression and omits ExpressionAttributeValues', () => {
    const result = buildUpdateExpression({}, ['GSI1PK', 'GSI1SK']);

    expect(result.UpdateExpression).toBe('REMOVE #a0, #a1');
    expect(result.ExpressionAttributeNames).toEqual({
      '#a0': 'GSI1PK',
      '#a1': 'GSI1SK',
    });
    expect(result.ExpressionAttributeValues).toBeUndefined();
  });

  it('builds a combined SET and REMOVE expression with continuous indexing', () => {
    const result = buildUpdateExpression({ name: 'Alice' }, ['GSI1PK', 'GSI1SK']);

    expect(result.UpdateExpression).toBe('SET #a0 = :a0 REMOVE #a1, #a2');
    expect(result.ExpressionAttributeNames).toEqual({
      '#a0': 'name',
      '#a1': 'GSI1PK',
      '#a2': 'GSI1SK',
    });
    expect(result.ExpressionAttributeValues).toEqual({ ':a0': 'Alice' });
  });

  it('returns empty expression when patch is empty and no removes provided', () => {
    const result = buildUpdateExpression({});

    expect(result.UpdateExpression).toBe('');
    expect(result.ExpressionAttributeNames).toEqual({});
    expect(result.ExpressionAttributeValues).toBeUndefined();
  });

  describe('with audit payload', () => {
    const actor = { id: 'tester' };
    const now = '2026-04-25T12:00:00.000Z';

    it('emits if_not_exists for created fields and plain SET for modified fields when only audit is provided', () => {
      const result = buildUpdateExpression({}, undefined, { actor, now });

      expect(result.UpdateExpression).toBe(
        'SET #a0 = if_not_exists(#a0, :a0), #a1 = if_not_exists(#a1, :a1), #a2 = :a2, #a3 = :a3',
      );
      expect(result.ExpressionAttributeNames).toEqual({
        '#a0': 'createdAt',
        '#a1': 'createdBy',
        '#a2': 'modifiedAt',
        '#a3': 'modifiedBy',
      });
      expect(result.ExpressionAttributeValues).toEqual({
        ':a0': now,
        ':a1': actor,
        ':a2': now,
        ':a3': actor,
      });
    });

    it('appends audit clauses after a user patch with continuous indexing', () => {
      const result = buildUpdateExpression({ name: 'Alice' }, undefined, { actor, now });

      expect(result.UpdateExpression).toBe(
        'SET #a0 = :a0, #a1 = if_not_exists(#a1, :a1), #a2 = if_not_exists(#a2, :a2), #a3 = :a3, #a4 = :a4',
      );
      expect(result.ExpressionAttributeNames).toEqual({
        '#a0': 'name',
        '#a1': 'createdAt',
        '#a2': 'createdBy',
        '#a3': 'modifiedAt',
        '#a4': 'modifiedBy',
      });
      expect(result.ExpressionAttributeValues).toEqual({
        ':a0': 'Alice',
        ':a1': now,
        ':a2': actor,
        ':a3': now,
        ':a4': actor,
      });
    });

    it('combines patch, remove, and audit with continuous indexing', () => {
      const result = buildUpdateExpression(
        { name: 'Alice' },
        ['GSI1PK', 'GSI1SK'],
        { actor, now },
      );

      expect(result.UpdateExpression).toBe(
        'SET #a0 = :a0, #a3 = if_not_exists(#a3, :a3), #a4 = if_not_exists(#a4, :a4), #a5 = :a5, #a6 = :a6 REMOVE #a1, #a2',
      );
      expect(result.ExpressionAttributeNames).toEqual({
        '#a0': 'name',
        '#a1': 'GSI1PK',
        '#a2': 'GSI1SK',
        '#a3': 'createdAt',
        '#a4': 'createdBy',
        '#a5': 'modifiedAt',
        '#a6': 'modifiedBy',
      });
      expect(result.ExpressionAttributeValues).toEqual({
        ':a0': 'Alice',
        ':a3': now,
        ':a4': actor,
        ':a5': now,
        ':a6': actor,
      });
    });
  });
});
