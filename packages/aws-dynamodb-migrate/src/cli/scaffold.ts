import { UsageError } from './args.js';

/** A scaffolded migration file: where to write it and what to put in it. */
export interface ScaffoldedMigration {
  /** `<timestamp>__<slug>.ts`, the name the file must be written under. */
  filename: string;
  /** The file's contents: a named `up` stub with an idempotency reminder. */
  contents: string;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * Build the timestamp-prefix id from a clock instant: `YYYYMMDDThhmm` in UTC.
 * This is the migration's identity and sort key, so generating it (rather than
 * hand-typing it) is the point of the `new` command.
 */
export const buildMigrationId = (now: Date): string =>
  `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T` +
  `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}`;

/**
 * Turn a free-text description into a filename-safe slug: lowercase, runs of
 * non-alphanumerics collapsed to single hyphens, no leading/trailing hyphen.
 * Throws {@link UsageError} if nothing alphanumeric survives.
 */
export const slugifyDescription = (description: string): string => {
  const slug = description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) {
    throw new UsageError('description must contain at least one letter or number');
  }
  return slug;
};

/**
 * Produce a new migration's filename and contents from a description and clock.
 * The stub exports a named `up` (not a default — leaves room for future metadata
 * exports) and leads with the load-bearing idempotency reminder, since a retried
 * migration re-runs from the top over possibly-half-transformed items.
 */
export const scaffoldMigration = (description: string, now: Date): ScaffoldedMigration => {
  const id = buildMigrationId(now);
  const slug = slugifyDescription(description);
  const filename = `${id}__${slug}.ts`;

  const contents = `// ${description}
//
// IMPORTANT: \`up\` MUST be idempotent. A failed run is retried from the top over
// items that may already be half-transformed, so re-processing an item must be a
// safe no-op — guard every write on whether it has already been applied.
//
// Reach data only through indexed \`pagedQuery\` calls and change it with per-item
// \`update\`s — never a \`Scan\`.
export const up = async ({ db }) => {
  // const items = await db.<entity>.pagedQuery({ index: 'GSI1', pk: '<partition>' });
  // for (const item of items) {
  //   if (/* already migrated? */ false) continue;
  //   await db.<entity>.update({ PK: item.PK, SK: item.SK }, { /* ...changes */ });
  // }
};
`;

  return { filename, contents };
};
