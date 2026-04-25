import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

export type IndexName = 'GSI1' | 'GSI2';

export interface BaseEntity {
  PK: string;
  SK: string;
}

export type EntityKey = BaseEntity;

export type Entity<TType extends string = string> = BaseEntity & { type: TType };

type IndexFields<TIndexes extends IndexName> = {
  [K in `${TIndexes}PK` | `${TIndexes}SK`]?: string;
};

export type AuditFieldKey = 'createdAt' | 'createdBy' | 'modifiedAt' | 'modifiedBy';

export type AuditFields<Actor extends object> = {
  createdAt: string;
  createdBy: Actor;
  modifiedAt: string;
  modifiedBy: Actor;
};

export interface EntityDefinition<
  TType extends string = string,
  TAttrs extends object = object,
  TIndexes extends IndexName = never,
  TAudit extends boolean = true,
> {
  type: TType;
  audit: TAudit;
  indexes: readonly TIndexes[];
  readonly __attrs?: TAttrs;
}

export const defineEntity = <
  TType extends string,
  TAttrs extends object = object,
  const TIndexes extends readonly IndexName[] = readonly [],
  const TAudit extends boolean = true,
>(
  type: TType extends Uppercase<TType> ? TType : never,
  options?: { indexes?: TIndexes; audit?: TAudit },
): EntityDefinition<TType, TAttrs, TIndexes[number], TAudit> => ({
  type,
  audit: (options?.audit ?? true) as TAudit,
  indexes: (options?.indexes ?? []) as readonly TIndexes[number][],
});

type ResolvedEntity<D, Actor extends object> = D extends EntityDefinition<
  infer T,
  infer A,
  infer I,
  infer Audit
>
  ? BaseEntity &
      IndexFields<I> &
      A & { type: T } &
      (Audit extends true ? AuditFields<Actor> : object)
  : never;

type ForbiddenAuditKeys = { [K in AuditFieldKey]?: never };

type PutInput<D> = D extends EntityDefinition<string, infer A, infer I, infer Audit>
  ? BaseEntity &
      IndexFields<I> &
      Omit<A, AuditFieldKey> &
      (Audit extends true ? ForbiddenAuditKeys : object)
  : never;

type UpdatePatch<D> = D extends EntityDefinition<string, infer A, infer I, infer Audit>
  ? IndexFields<I> &
      Omit<A, keyof BaseEntity | AuditFieldKey> &
      (Audit extends true ? ForbiddenAuditKeys : object)
  : never;

type UpdateInput<D> = D extends EntityDefinition<string, infer A, infer I, infer Audit>
  ? Partial<IndexFields<I> & Omit<A, keyof BaseEntity | 'type' | AuditFieldKey>> &
      (Audit extends true ? ForbiddenAuditKeys : object)
  : never;

type OptionalKeys<T> = {
  [K in keyof T]-?: object extends Pick<T, K> ? K : never;
}[keyof T];

type RemovableKeys<D> = D extends EntityDefinition<string, infer A, infer I>
  ? OptionalKeys<IndexFields<I> & Omit<A, keyof BaseEntity | 'type' | AuditFieldKey>> & string
  : never;

export type SkCondition =
  | { equals: string }
  | { beginsWith: string }
  | { between: [string, string] }
  | { lt: string }
  | { lte: string }
  | { gt: string }
  | { gte: string };

type IndexOption<D> = D extends EntityDefinition<string, object, infer I>
  ? [I] extends [never]
    ? { index?: never }
    : { index?: I }
  : never;

export type QueryParams<D> = {
  pk: string;
  sk?: SkCondition;
  limit?: number;
} & IndexOption<D>;

export type AnyEntityDefinition = EntityDefinition<string, object, IndexName, boolean>;

export type EntityOperations<D extends AnyEntityDefinition, Actor extends object> = {
  put: (entity: PutInput<D>) => Promise<ResolvedEntity<D, Actor>>;
  get: (key: EntityKey) => Promise<ResolvedEntity<D, Actor> | undefined>;
  pagedQuery: (params: QueryParams<D>) => Promise<ResolvedEntity<D, Actor>[]>;
  upsert: (key: EntityKey, patch: UpdatePatch<D>) => Promise<ResolvedEntity<D, Actor>>;
  update: (
    key: EntityKey,
    patch: UpdateInput<D>,
    remove?: readonly RemovableKeys<D>[],
  ) => Promise<ResolvedEntity<D, Actor>>;
};

export type DynamoClient<
  E extends Record<string, AnyEntityDefinition>,
  Actor extends object,
> = {
  [K in keyof E]: EntityOperations<E[K], Actor>;
};

export interface CreateDynamoClientOptions<
  E extends Record<string, AnyEntityDefinition>,
  Actor extends object,
> {
  tableName: string;
  entities: E;
  getActor: () => Actor | Promise<Actor>;
  client?: DynamoDBClient;
}

export interface UpdateExpressionResult {
  UpdateExpression: string;
  ExpressionAttributeNames: Record<string, string>;
  ExpressionAttributeValues?: Record<string, unknown>;
}

export interface AuditPayload {
  actor: object;
  now: string;
}

export const buildUpdateExpression = (
  patch: Record<string, unknown>,
  remove?: readonly string[],
  audit?: AuditPayload,
): UpdateExpressionResult => {
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const sets: string[] = [];
  const removes: string[] = [];
  let i = 0;
  for (const [attr, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const nameKey = `#a${i}`;
    const valueKey = `:a${i}`;
    names[nameKey] = attr;
    values[valueKey] = value;
    sets.push(`${nameKey} = ${valueKey}`);
    i += 1;
  }
  for (const attr of remove ?? []) {
    const nameKey = `#a${i}`;
    names[nameKey] = attr;
    removes.push(nameKey);
    i += 1;
  }
  if (audit) {
    const auditFields: Array<readonly [string, unknown, boolean]> = [
      ['createdAt', audit.now, true],
      ['createdBy', audit.actor, true],
      ['modifiedAt', audit.now, false],
      ['modifiedBy', audit.actor, false],
    ];
    for (const [attr, value, ifNotExists] of auditFields) {
      const nameKey = `#a${i}`;
      const valueKey = `:a${i}`;
      names[nameKey] = attr;
      values[valueKey] = value;
      sets.push(
        ifNotExists
          ? `${nameKey} = if_not_exists(${nameKey}, ${valueKey})`
          : `${nameKey} = ${valueKey}`,
      );
      i += 1;
    }
  }
  const clauses: string[] = [];
  if (sets.length) clauses.push(`SET ${sets.join(', ')}`);
  if (removes.length) clauses.push(`REMOVE ${removes.join(', ')}`);
  return {
    UpdateExpression: clauses.join(' '),
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: sets.length ? values : undefined,
  };
};

const buildKeyCondition = (
  pkAttr: string,
  skAttr: string,
  pk: string,
  sk: SkCondition | undefined,
) => {
  const names: Record<string, string> = { '#pk': pkAttr };
  const values: Record<string, unknown> = { ':pk': pk };
  let expr = '#pk = :pk';

  if (sk) {
    names['#sk'] = skAttr;
    if ('equals' in sk) {
      expr += ' AND #sk = :sk';
      values[':sk'] = sk.equals;
    } else if ('beginsWith' in sk) {
      expr += ' AND begins_with(#sk, :sk)';
      values[':sk'] = sk.beginsWith;
    } else if ('between' in sk) {
      expr += ' AND #sk BETWEEN :sk1 AND :sk2';
      values[':sk1'] = sk.between[0];
      values[':sk2'] = sk.between[1];
    } else if ('lt' in sk) {
      expr += ' AND #sk < :sk';
      values[':sk'] = sk.lt;
    } else if ('lte' in sk) {
      expr += ' AND #sk <= :sk';
      values[':sk'] = sk.lte;
    } else if ('gt' in sk) {
      expr += ' AND #sk > :sk';
      values[':sk'] = sk.gt;
    } else if ('gte' in sk) {
      expr += ' AND #sk >= :sk';
      values[':sk'] = sk.gte;
    }
  }

  return { expression: expr, names, values };
};

export const createDynamoClient = <
  E extends Record<string, AnyEntityDefinition>,
  Actor extends object,
>({
  tableName,
  entities,
  client,
  getActor,
}: CreateDynamoClientOptions<E, Actor>): DynamoClient<E, Actor> => {
  const doc = DynamoDBDocumentClient.from(client ?? new DynamoDBClient({}));

  const result = {} as DynamoClient<E, Actor>;
  for (const key of Object.keys(entities) as Array<keyof E>) {
    const def = entities[key]!;
    result[key] = {
      put: async (entity) => {
        const item: Record<string, unknown> = { ...entity, type: def.type };
        if (def.audit) {
          const actor = await getActor();
          const now = new Date().toISOString();
          item.createdAt = now;
          item.createdBy = actor;
          item.modifiedAt = now;
          item.modifiedBy = actor;
        }
        await doc.send(
          new PutCommand({
            TableName: tableName,
            Item: item,
            ConditionExpression: 'attribute_not_exists(PK)',
          }),
        );
        return item as ResolvedEntity<E[typeof key], Actor>;
      },
      get: async ({ PK, SK }) => {
        const { Item } = await doc.send(
          new GetCommand({ TableName: tableName, Key: { PK, SK } }),
        );
        return Item as ResolvedEntity<E[typeof key], Actor> | undefined;
      },
      update: async ({ PK, SK }, patch, remove) => {
        const { type: _type, ...userPatch } = patch as Record<string, unknown>;
        const audit = def.audit
          ? { actor: await getActor(), now: new Date().toISOString() }
          : undefined;
        const expr = buildUpdateExpression(userPatch, remove, audit);
        const { Attributes } = await doc.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { PK, SK },
            UpdateExpression: expr.UpdateExpression,
            ConditionExpression: 'attribute_exists(PK)',
            ExpressionAttributeNames: expr.ExpressionAttributeNames,
            ExpressionAttributeValues: expr.ExpressionAttributeValues,
            ReturnValues: 'ALL_NEW',
          }),
        );
        return Attributes as ResolvedEntity<E[typeof key], Actor>;
      },
      upsert: async ({ PK, SK }, patch) => {
        const audit = def.audit
          ? { actor: await getActor(), now: new Date().toISOString() }
          : undefined;
        const expr = buildUpdateExpression({ ...patch, type: def.type }, undefined, audit);
        const { Attributes } = await doc.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { PK, SK },
            UpdateExpression: expr.UpdateExpression,
            ExpressionAttributeNames: expr.ExpressionAttributeNames,
            ExpressionAttributeValues: expr.ExpressionAttributeValues,
            ReturnValues: 'ALL_NEW',
          }),
        );
        return Attributes as ResolvedEntity<E[typeof key], Actor>;
      },
      pagedQuery: async ({ pk, sk, index, limit }) => {
        const pkAttr = index ? `${index}PK` : 'PK';
        const skAttr = index ? `${index}SK` : 'SK';
        const keyCond = buildKeyCondition(pkAttr, skAttr, pk, sk);

        const names = { ...keyCond.names, '#type': 'type' };
        const values = { ...keyCond.values, ':type': def.type };

        const results: ResolvedEntity<E[typeof key], Actor>[] = [];
        let exclusiveStartKey: Record<string, unknown> | undefined;

        do {
          const { Items, LastEvaluatedKey } = await doc.send(
            new QueryCommand({
              TableName: tableName,
              IndexName: index,
              KeyConditionExpression: keyCond.expression,
              FilterExpression: '#type = :type',
              ExpressionAttributeNames: names,
              ExpressionAttributeValues: values,
              ExclusiveStartKey: exclusiveStartKey,
            }),
          );

          for (const item of Items ?? []) {
            results.push(item as ResolvedEntity<E[typeof key], Actor>);
            if (limit !== undefined && results.length >= limit) return results;
          }

          exclusiveStartKey = LastEvaluatedKey;
        } while (exclusiveStartKey);

        return results;
      },
    };
  }
  return result;
};
