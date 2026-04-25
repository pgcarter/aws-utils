import type { _Record as DynamoDBRecord } from '@aws-sdk/client-dynamodb-streams';
import { defineEntity } from '@bewdym8/dynamodb';

export type Actor = { id: string };

type UserItem = {
  PK: `USER#${string}`;
  SK: `USER#${string}`;
  name: string;
  email: string;
};

type CacheItem = {
  PK: `CACHE#${string}`;
  SK: `CACHE#${string}`;
  value: string;
};

export const userEntity = defineEntity<'USER', UserItem>('USER');
export const cacheEntity = defineEntity<'CACHE', CacheItem, [], false>('CACHE', {
  audit: false,
});

export const entities = { user: userEntity, cache: cacheEntity };

export const ACTOR: Actor = { id: 'tester' };
export const NOW_ISO = '2026-04-25T12:00:00.000Z';

const buildUserImage = (
  pk: string,
  sk: string,
  name: string,
  type: string | undefined,
): Record<string, { S: string }> => {
  const image: Record<string, { S: string }> = {
    PK: { S: pk },
    SK: { S: sk },
    name: { S: name },
    email: { S: `${name.toLowerCase()}@example.com` },
    createdAt: { S: NOW_ISO },
    modifiedAt: { S: NOW_ISO },
  };
  if (type !== undefined) image.type = { S: type };
  return image;
};

export const insertRecord = (
  overrides: {
    eventID?: string;
    sequenceNumber?: string;
    pk?: string;
    sk?: string;
    type?: string | null;
    name?: string;
    images?: 'new' | 'none';
  } = {},
): DynamoDBRecord => {
  const pk = overrides.pk ?? 'USER#1';
  const sk = overrides.sk ?? pk;
  const type = overrides.type === null ? undefined : (overrides.type ?? 'USER');
  const name = overrides.name ?? 'Alice';
  const images = overrides.images ?? 'new';
  const newImage = buildUserImage(pk, sk, name, type);
  return {
    eventID: overrides.eventID ?? 'evt-1',
    eventName: 'INSERT',
    eventSource: 'aws:dynamodb',
    awsRegion: 'us-east-1',
    dynamodb: {
      ApproximateCreationDateTime: new Date(NOW_ISO),
      Keys: { PK: { S: pk }, SK: { S: sk } } as never,
      ...(images === 'new' && { NewImage: newImage as never }),
      SequenceNumber: overrides.sequenceNumber ?? '0000001',
      SizeBytes: 100,
      StreamViewType: 'NEW_AND_OLD_IMAGES',
    },
  };
};

export const removeRecord = (
  overrides: {
    eventID?: string;
    sequenceNumber?: string;
    pk?: string;
    sk?: string;
    type?: string | null;
    name?: string;
    images?: 'old' | 'none';
  } = {},
): DynamoDBRecord => {
  const pk = overrides.pk ?? 'USER#1';
  const sk = overrides.sk ?? pk;
  const type = overrides.type === null ? undefined : (overrides.type ?? 'USER');
  const name = overrides.name ?? 'Alice';
  const images = overrides.images ?? 'old';
  const oldImage = buildUserImage(pk, sk, name, type);
  return {
    eventID: overrides.eventID ?? 'evt-1',
    eventName: 'REMOVE',
    eventSource: 'aws:dynamodb',
    awsRegion: 'us-east-1',
    dynamodb: {
      ApproximateCreationDateTime: new Date(NOW_ISO),
      Keys: { PK: { S: pk }, SK: { S: sk } } as never,
      ...(images === 'old' && { OldImage: oldImage as never }),
      SequenceNumber: overrides.sequenceNumber ?? '0000001',
      SizeBytes: 100,
      StreamViewType: 'NEW_AND_OLD_IMAGES',
    },
  };
};

export const modifyRecord = (
  overrides: {
    eventID?: string;
    sequenceNumber?: string;
    pk?: string;
    sk?: string;
    type?: string | null;
    oldName?: string;
    newName?: string;
    images?: 'both' | 'old-only' | 'new-only';
  } = {},
): DynamoDBRecord => {
  const pk = overrides.pk ?? 'USER#1';
  const sk = overrides.sk ?? pk;
  const type = overrides.type === null ? undefined : (overrides.type ?? 'USER');
  const oldName = overrides.oldName ?? 'Alice';
  const newName = overrides.newName ?? 'Alicia';
  const images = overrides.images ?? 'both';
  const oldImage = buildUserImage(pk, sk, oldName, type);
  const newImage = buildUserImage(pk, sk, newName, type);
  return {
    eventID: overrides.eventID ?? 'evt-1',
    eventName: 'MODIFY',
    eventSource: 'aws:dynamodb',
    awsRegion: 'us-east-1',
    dynamodb: {
      ApproximateCreationDateTime: new Date(NOW_ISO),
      Keys: { PK: { S: pk }, SK: { S: sk } } as never,
      ...(images !== 'old-only' && { NewImage: newImage as never }),
      ...(images !== 'new-only' && { OldImage: oldImage as never }),
      SequenceNumber: overrides.sequenceNumber ?? '0000001',
      SizeBytes: 100,
      StreamViewType: 'NEW_AND_OLD_IMAGES',
    },
  };
};
