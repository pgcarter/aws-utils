import { classifyRecord } from './classifier';
import { HandlerRegistry, type RegistryHandler } from './registry';
import type {
  DynamoDBRecord,
  EntityMap,
  Handler,
  ProcessResult,
  StreamEvent,
} from './types';

export interface StreamProcessor<Entities extends EntityMap, Actor extends object> {
  on<E extends StreamEvent, N extends keyof Entities>(
    event: E,
    entityName: N,
    handler: Handler<E, Entities, N, Actor>,
  ): StreamProcessor<Entities, Actor>;
  on<
    const Events extends readonly [StreamEvent, ...StreamEvent[]],
    N extends keyof Entities,
  >(
    events: Events,
    entityName: N,
    handler: Handler<Events[number], Entities, N, Actor>,
  ): StreamProcessor<Entities, Actor>;
  process(records: readonly DynamoDBRecord[]): Promise<ProcessResult>;
}

export interface CreateStreamProcessorOptions<Entities extends EntityMap> {
  entities: Entities;
}

export const createStreamProcessor = <
  Entities extends EntityMap,
  Actor extends object = object,
>(
  options: CreateStreamProcessorOptions<Entities>,
): StreamProcessor<Entities, Actor> => {
  const { entities } = options;
  const registry = new HandlerRegistry();

  const onImpl = (
    eventOrEvents: StreamEvent | readonly StreamEvent[],
    entityName: string,
    handler: RegistryHandler,
  ): StreamProcessor<Entities, Actor> => {
    const events = Array.isArray(eventOrEvents) ? eventOrEvents : [eventOrEvents];
    for (const event of events) {
      registry.register(event, entityName, handler);
    }
    return processor;
  };

  const processor: StreamProcessor<Entities, Actor> = {
    on: onImpl as StreamProcessor<Entities, Actor>['on'],
    async process(records) {
      const failures: ProcessResult['batchItemFailures'] = [];
      for (const record of records) {
        const classified = classifyRecord(record, entities);
        if (classified.kind === 'skip') continue;
        if (classified.kind === 'unknown-type') {
          throw new Error(
            `[dynamodb-streams] unknown entity type "${classified.type}" on record ${classified.meta.eventID || classified.meta.sequenceNumber}; add it to the entities map or remove the deploy skew`,
          );
        }
        if (classified.kind === 'missing-image') {
          throw new Error(
            `[dynamodb-streams] ${classified.event} record ${classified.meta.eventID || classified.meta.sequenceNumber} is missing ${classified.missing}; configure the table's StreamViewType to NEW_AND_OLD_IMAGES`,
          );
        }
        let handler: ((arg: unknown) => void | Promise<void>) | undefined;
        let arg: unknown;
        if (classified.kind === 'insert') {
          handler = registry.lookup('INSERT', classified.entityName);
          arg = { entity: classified.entity, ...classified.meta };
        } else if (classified.kind === 'modify') {
          handler = registry.lookup('MODIFY', classified.entityName);
          arg = {
            oldEntity: classified.oldEntity,
            newEntity: classified.newEntity,
            ...classified.meta,
          };
        } else if (classified.kind === 'remove') {
          handler = registry.lookup('REMOVE', classified.entityName);
          arg = { entity: classified.entity, ...classified.meta };
        }
        if (!handler) continue;
        try {
          await handler(arg);
        } catch {
          failures.push({ itemIdentifier: classified.meta.sequenceNumber });
        }
      }
      return { batchItemFailures: failures };
    },
  };

  return processor;
};
