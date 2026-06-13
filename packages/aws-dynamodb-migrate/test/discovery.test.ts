import { describe, expect, it } from 'vitest';
import { computePending, discoverMigrations, parseMigrationFilename } from '../src';

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
