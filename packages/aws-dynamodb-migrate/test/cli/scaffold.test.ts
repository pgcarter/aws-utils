import { describe, expect, it } from 'vitest';
import { UsageError } from '../../src/cli/args';
import {
  buildMigrationId,
  scaffoldMigration,
  slugifyDescription,
} from '../../src/cli/scaffold';
import { parseMigrationFilename } from '../../src/discovery';

const NOW = new Date('2026-06-13T14:30:00.000Z');

describe('buildMigrationId', () => {
  it('formats a UTC instant as YYYYMMDDThhmm', () => {
    expect(buildMigrationId(NOW)).toBe('20260613T1430');
  });

  it('zero-pads months, days, hours, and minutes', () => {
    expect(buildMigrationId(new Date('2026-01-02T03:04:00.000Z'))).toBe('20260102T0304');
  });
});

describe('slugifyDescription', () => {
  it('lowercases, hyphenates runs of non-alphanumerics, and trims hyphens', () => {
    expect(slugifyDescription('Backfill User  Status!')).toBe('backfill-user-status');
    expect(slugifyDescription('--weird__name--')).toBe('weird-name');
  });

  it('throws when nothing alphanumeric survives', () => {
    expect(() => slugifyDescription('   ')).toThrow(UsageError);
    expect(() => slugifyDescription('!!!')).toThrow(UsageError);
  });
});

describe('scaffoldMigration', () => {
  it('produces a correctly-named, parseable filename', () => {
    const { filename } = scaffoldMigration('backfill user status', NOW);
    expect(filename).toBe('20260613T1430__backfill-user-status.ts');
    // The convention the discovery layer enforces must accept what we scaffold.
    expect(parseMigrationFilename(filename)).toEqual({
      id: '20260613T1430',
      name: filename,
    });
  });

  it('stubs a named up export with an idempotency reminder', () => {
    const { contents } = scaffoldMigration('backfill user status', NOW);
    expect(contents).toContain('export const up = async ({ db }) =>');
    expect(contents).toContain('idempotent');
    expect(contents).toContain('backfill user status');
  });
});
