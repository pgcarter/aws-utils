import type { _Record } from '@aws-sdk/client-dynamodb-streams';
import type {
  AnyEntityDefinition,
  EntityKey,
  ResolvedEntity,
} from '@bewdym8/dynamodb';

export type DynamoDBRecord = _Record;

export type StreamEvent = 'INSERT' | 'MODIFY' | 'REMOVE';

export type EntityMap = Record<string, AnyEntityDefinition>;

export interface RecordMeta {
  key: EntityKey;
  eventID: string;
  sequenceNumber: string;
  approximateCreationDateTime?: Date;
}

export interface InsertArg<
  D extends AnyEntityDefinition,
  Actor extends object = object,
> extends RecordMeta {
  entity: ResolvedEntity<D, Actor>;
}

export interface ModifyArg<
  D extends AnyEntityDefinition,
  Actor extends object = object,
> extends RecordMeta {
  oldEntity: ResolvedEntity<D, Actor>;
  newEntity: ResolvedEntity<D, Actor>;
}

export type HandlerArg<
  Event extends StreamEvent,
  Entities extends EntityMap,
  Name extends keyof Entities,
  Actor extends object = object,
> = Event extends 'INSERT'
  ? InsertArg<Entities[Name], Actor>
  : Event extends 'MODIFY'
    ? ModifyArg<Entities[Name], Actor>
    : never;

export type Handler<
  Event extends StreamEvent,
  Entities extends EntityMap,
  Name extends keyof Entities,
  Actor extends object = object,
> = (arg: HandlerArg<Event, Entities, Name, Actor>) => void | Promise<void>;

export interface BatchItemFailure {
  itemIdentifier: string;
}

export interface ProcessResult {
  batchItemFailures: BatchItemFailure[];
}
