import type { AttributeValue } from '@aws-sdk/client-dynamodb-streams';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import type { EntityKey } from '@bewdym8/dynamodb';
import type { DynamoDBRecord, EntityMap, RecordMeta } from './types';

export type ClassifiedRecord =
  | {
      kind: 'insert';
      entityName: string;
      entity: Record<string, unknown>;
      meta: RecordMeta;
    }
  | {
      kind: 'modify';
      entityName: string;
      oldEntity: Record<string, unknown>;
      newEntity: Record<string, unknown>;
      meta: RecordMeta;
    }
  | { kind: 'skip' }
  | { kind: 'unknown-type'; type: string; meta: RecordMeta };

type UnmarshallInput = Parameters<typeof unmarshall>[0];

const unmarshallImage = (
  image: Record<string, AttributeValue>,
): Record<string, unknown> => unmarshall(image as unknown as UnmarshallInput);

const findEntityName = (entities: EntityMap, type: unknown): string | undefined => {
  if (typeof type !== 'string') return undefined;
  for (const [name, def] of Object.entries(entities)) {
    if (def.type === type) return name;
  }
  return undefined;
};

const extractMeta = (record: DynamoDBRecord): RecordMeta => {
  const keys = record.dynamodb?.Keys;
  return {
    key: keys
      ? (unmarshallImage(keys) as unknown as EntityKey)
      : ({ PK: '', SK: '' } as EntityKey),
    eventID: record.eventID ?? '',
    sequenceNumber: record.dynamodb?.SequenceNumber ?? '',
    approximateCreationDateTime: record.dynamodb?.ApproximateCreationDateTime,
  };
};

export const classifyRecord = (
  record: DynamoDBRecord,
  entities: EntityMap,
): ClassifiedRecord => {
  if (record.eventName === 'INSERT') {
    const newImage = record.dynamodb?.NewImage;
    if (!newImage) return { kind: 'skip' };
    const entity = unmarshallImage(newImage);
    const type = entity.type;
    if (typeof type !== 'string') return { kind: 'skip' };
    const entityName = findEntityName(entities, type);
    if (!entityName) {
      return { kind: 'unknown-type', type, meta: extractMeta(record) };
    }
    return {
      kind: 'insert',
      entityName,
      entity,
      meta: extractMeta(record),
    };
  }
  if (record.eventName === 'MODIFY') {
    const newImage = record.dynamodb?.NewImage;
    const oldImage = record.dynamodb?.OldImage;
    if (!newImage || !oldImage) return { kind: 'skip' };
    const newEntity = unmarshallImage(newImage);
    const oldEntity = unmarshallImage(oldImage);
    const type = newEntity.type;
    if (typeof type !== 'string') return { kind: 'skip' };
    const entityName = findEntityName(entities, type);
    if (!entityName) {
      return { kind: 'unknown-type', type, meta: extractMeta(record) };
    }
    return {
      kind: 'modify',
      entityName,
      oldEntity,
      newEntity,
      meta: extractMeta(record),
    };
  }
  return { kind: 'skip' };
};
