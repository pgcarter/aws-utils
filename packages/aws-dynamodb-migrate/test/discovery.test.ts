import { describe, expect, it } from 'vitest';
import {
  computePending,
  discoverMigrations,
  findOutOfOrder,
  newestApplied,
  parseMigrationFilename,
} from '../src';

describe('parseMigrationFilename', () => {
  it('splits id (timestamp prefix) from the full name', () => {
    expect(parseMigrationFilename('20260613T1430__backfill-user-status.ts')).toEqual({
      id: '20260613T1430',
      name: '20260613T1430__backfill-user-status.ts',
    });
  });

  it('accepts compiled .js as well as .ts', () => {
    expect(parseMigrationFilename('20260613T1430__x.js')?.id).toBe('20260613T1430');
  });

  it('rejects files that do not match the convention', () => {
    expect(parseMigrationFilename('README.md')).toBeNull();
    expect(parseMigrationFilename('no-separator.ts')).toBeNull();
    expect(parseMigrationFilename('20260613T1430__x.txt')).toBeNull();
  });
});

describe('discoverMigrations', () => {
  it('drops non-migration files and sorts ascending by id', () => {
    const discovered = discoverMigrations([
      '20260102T0000__b.ts',
      'README.md',
      '20260101T0000__a.ts',
      'helpers.ts',
    ]);
    expect(discovered.map((m) => m.id)).toEqual(['20260101T0000', '20260102T0000']);
  });
});

describe('computePending', () => {
  it('returns disk minus ledger, preserving order', () => {
    const discovered = discoverMigrations([
      '20260101T0000__a.ts',
      '20260102T0000__b.ts',
      '20260103T0000__c.ts',
    ]);
    const pending = computePending(discovered, new Set(['20260101T0000']));
    expect(pending.map((m) => m.id)).toEqual(['20260102T0000', '20260103T0000']);
  });
});

describe('newestApplied', () => {
  it('returns the lexicographically greatest id', () => {
    expect(newestApplied(new Set(['20260101T0000', '20260103T0000', '20260102T0000']))).toBe(
      '20260103T0000',
    );
  });

  it('returns null for an empty ledger', () => {
    expect(newestApplied(new Set())).toBeNull();
  });
});

describe('findOutOfOrder', () => {
  const disk = discoverMigrations([
    '20260101T0000__a.ts',
    '20260102T0000__b.ts',
    '20260103T0000__c.ts',
  ]);

  it('flags the oldest pending migration older than the newest applied', () => {
    // b applied; a (older) is pending — out of order.
    const pending = computePending(disk, new Set(['20260102T0000']));
    const result = findOutOfOrder(pending, new Set(['20260102T0000']));
    expect(result?.migration.id).toBe('20260101T0000');
    expect(result?.newestApplied).toBe('20260102T0000');
  });

  it('returns null when every pending migration is newer than the ledger high-water mark', () => {
    const pending = computePending(disk, new Set(['20260101T0000']));
    expect(findOutOfOrder(pending, new Set(['20260101T0000']))).toBeNull();
  });

  it('returns null for an empty ledger', () => {
    expect(findOutOfOrder(disk, new Set())).toBeNull();
  });
});
