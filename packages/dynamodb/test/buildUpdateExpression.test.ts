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
});
