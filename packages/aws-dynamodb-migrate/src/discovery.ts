/**
 * A migration discovered on disk. {@link id} is the timestamp prefix (the
 * source of truth for identity and ordering); {@link name} is the full
 * filename as authored.
 */
export interface DiscoveredMigration {
  id: string;
  name: string;
}

// `<timestamp>__<description>.(ts|js)` — the part before the first `__` is the
// id, the whole filename is the human-facing name. We accept either extension
// so the same engine works against `.ts` sources (tsx) and pre-compiled `.js`
// (Lambda); see ADR-0002.
const MIGRATION_FILENAME = /^(.+?)__.+\.(?:ts|js)$/;

/**
 * Parse a migration filename into its id and name, or return `null` when the
 * filename does not match the `<timestamp>__<description>.(ts|js)` convention
 * (so non-migration files in the directory are ignored, not mis-applied).
 */
export const parseMigrationFilename = (filename: string): DiscoveredMigration | null => {
  const match = MIGRATION_FILENAME.exec(filename);
  if (!match) return null;
  return { id: match[1]!, name: filename };
};

/**
 * Turn a directory listing into the ordered set of migrations on disk: files
 * that match the convention, sorted ascending by id (timestamps sort
 * lexicographically). Non-matching files are dropped.
 */
export const discoverMigrations = (filenames: readonly string[]): DiscoveredMigration[] =>
  filenames
    .map(parseMigrationFilename)
    .filter((m): m is DiscoveredMigration => m !== null)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/**
 * Pending = on disk − ledger: the discovered migrations whose id is not already
 * recorded as applied. Preserves the input (ascending) order.
 */
export const computePending = (
  discovered: readonly DiscoveredMigration[],
  appliedIds: ReadonlySet<string>,
): DiscoveredMigration[] => discovered.filter((m) => !appliedIds.has(m.id));
