import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { CliConfig, CliDeps } from '../../src/cli/commands';
import { dispatch } from '../../src/cli/commands';
import { noopLogger } from '../../src/logger';

const config: CliConfig = {
  client: { marker: 'user-client' },
  tableName: 'my-table',
  dynamoClient: { marker: 'raw-client' } as never,
  migrationsDir: '/abs/migrations',
};

const NOW = new Date('2026-06-13T14:30:00.000Z');

const makeDeps = (overrides: Partial<CliDeps> = {}): CliDeps => ({
  runMigrations: vi.fn(async () => ({ applied: ['20260101T0000'], skipped: [] })),
  status: vi.fn(async () => ({ migrations: [], lock: { held: false } })),
  repair: vi.fn(async () => {}),
  forceUnlock: vi.fn(async () => true),
  writeFile: vi.fn(async () => {}),
  logger: noopLogger,
  now: () => NOW,
  ...overrides,
});

describe('dispatch — args mapped onto core options', () => {
  it('up forwards client/table/dir and the parsed dryRun flag', async () => {
    const deps = makeDeps();
    await dispatch({ kind: 'up', dryRun: true }, config, deps);

    expect(deps.runMigrations).toHaveBeenCalledTimes(1);
    expect(deps.runMigrations).toHaveBeenCalledWith({
      client: config.client,
      tableName: 'my-table',
      dynamoClient: config.dynamoClient,
      migrationsDir: '/abs/migrations',
      dryRun: true,
      logger: deps.logger,
    });
  });

  it('status calls the read-only core status with the table and dir', async () => {
    const deps = makeDeps();
    await dispatch({ kind: 'status' }, config, deps);

    expect(deps.status).toHaveBeenCalledWith({
      tableName: 'my-table',
      dynamoClient: config.dynamoClient,
      migrationsDir: '/abs/migrations',
    });
  });

  it('new writes the scaffold into migrationsDir under the generated filename', async () => {
    const deps = makeDeps();
    await dispatch({ kind: 'new', description: 'backfill user status' }, config, deps);

    const expectedPath = join('/abs/migrations', '20260613T1430__backfill-user-status.ts');
    expect(deps.writeFile).toHaveBeenCalledTimes(1);
    const [path, contents] = (deps.writeFile as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(path).toBe(expectedPath);
    expect(contents).toContain('export const up = async ({ db }) =>');
  });

  it('repair maps the parsed mode onto the core repair primitive', async () => {
    const deps = makeDeps();
    await dispatch({ kind: 'repair', id: '20260101T0000', mode: 'resolve' }, config, deps);

    expect(deps.repair).toHaveBeenCalledWith({
      tableName: 'my-table',
      dynamoClient: config.dynamoClient,
      id: '20260101T0000',
      mode: 'resolve',
    });
  });

  it('unlock calls forceUnlock with the table', async () => {
    const deps = makeDeps();
    await dispatch({ kind: 'unlock' }, config, deps);

    expect(deps.forceUnlock).toHaveBeenCalledWith({
      tableName: 'my-table',
      dynamoClient: config.dynamoClient,
    });
  });
});
