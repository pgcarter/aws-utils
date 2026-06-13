import { describe, expect, it } from 'vitest';
import { parseArgs, UsageError } from '../../src/cli/args';

describe('parseArgs', () => {
  it('treats no args, help, and --help/-h as the help command', () => {
    for (const argv of [[], ['help'], ['--help'], ['-h']]) {
      expect(parseArgs(argv)).toEqual({ kind: 'help' });
    }
  });

  it('parses up with and without --dry-run', () => {
    expect(parseArgs(['up'])).toEqual({ kind: 'up', dryRun: false });
    expect(parseArgs(['up', '--dry-run'])).toEqual({ kind: 'up', dryRun: true });
  });

  it('rejects unknown options and stray args on up', () => {
    expect(() => parseArgs(['up', '--nope'])).toThrow(UsageError);
    expect(() => parseArgs(['up', 'extra'])).toThrow(UsageError);
  });

  it('parses status with no arguments', () => {
    expect(parseArgs(['status'])).toEqual({ kind: 'status' });
    expect(() => parseArgs(['status', 'x'])).toThrow(UsageError);
  });

  it('parses new, joining a multi-word description', () => {
    expect(parseArgs(['new', 'backfill user status'])).toEqual({
      kind: 'new',
      description: 'backfill user status',
    });
    expect(parseArgs(['new', 'backfill', 'user', 'status'])).toEqual({
      kind: 'new',
      description: 'backfill user status',
    });
  });

  it('requires a non-empty description for new', () => {
    expect(() => parseArgs(['new'])).toThrow(UsageError);
    expect(() => parseArgs(['new', '   '])).toThrow(UsageError);
  });

  it('maps repair --retry/--resolve to the core repair modes', () => {
    expect(parseArgs(['repair', '20260101T0000', '--retry'])).toEqual({
      kind: 'repair',
      id: '20260101T0000',
      mode: 'retry',
    });
    expect(parseArgs(['repair', '20260101T0000', '--resolve'])).toEqual({
      kind: 'repair',
      id: '20260101T0000',
      mode: 'resolve',
    });
  });

  it('requires exactly one of --retry/--resolve and an id for repair', () => {
    expect(() => parseArgs(['repair', '20260101T0000'])).toThrow(UsageError);
    expect(() => parseArgs(['repair', '20260101T0000', '--retry', '--resolve'])).toThrow(
      UsageError,
    );
    expect(() => parseArgs(['repair', '--retry'])).toThrow(UsageError);
  });

  it('parses unlock only with --force', () => {
    expect(parseArgs(['unlock', '--force'])).toEqual({ kind: 'unlock' });
    expect(() => parseArgs(['unlock'])).toThrow(UsageError);
  });

  it('rejects an unknown command', () => {
    expect(() => parseArgs(['frobnicate'])).toThrow(UsageError);
  });
});
