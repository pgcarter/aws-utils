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

export const insertRecord = (
  overrides: {
    eventID?: string;
    sequenceNumber?: string;
    pk?: string;
    sk?: string;
    type?: string | null;
    name?: string;
  } = {},
): DynamoDBRecord => {
  const pk = overrides.pk ?? 'USER#1';
  const sk = overrides.sk ?? pk;
  const type = overrides.type === null ? undefined : (overrides.type ?? 'USER');
  const name = overrides.name ?? 'Alice';
  const newImage: Record<string, { S: string }> = {
    PK: { S: pk },
    SK: { S: sk },
    name: { S: name },
    email: { S: `${name.toLowerCase()}@example.com` },
    createdAt: { S: NOW_ISO },
    modifiedAt: { S: NOW_ISO },
  };
  if (type !== undefined) newImage.type = { S: type };
  return {
    eventID: overrides.eventID ?? 'evt-1',
    eventName: 'INSERT',
    eventSource: 'aws:dynamodb',
    awsRegion: 'us-east-1',
    dynamodb: {
      ApproximateCreationDateTime: new Date(NOW_ISO),
      Keys: { PK: { S: pk }, SK: { S: sk } } as never,
      NewImage: newImage as never,
      SequenceNumber: overrides.sequenceNumber ?? '0000001',
      SizeBytes: 100,
      StreamViewType: 'NEW_AND_OLD_IMAGES',
    },
  };
};
