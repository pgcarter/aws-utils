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

  const processor: StreamProcessor<Entities, Actor> = {
    on(event, entityName, handler) {
      registry.register(event, entityName as string, handler as RegistryHandler);
      return processor;
    },
    async process(records) {
      const failures: ProcessResult['batchItemFailures'] = [];
      for (const record of records) {
        const classified = classifyRecord(record, entities);
        if (classified.kind === 'skip' || classified.kind === 'unknown-type') {
          continue;
        }
        if (classified.kind === 'insert') {
          const handler = registry.lookup('INSERT', classified.entityName);
          if (!handler) continue;
          await handler({ entity: classified.entity, ...classified.meta });
          continue;
        }
        if (classified.kind === 'modify') {
          const handler = registry.lookup('MODIFY', classified.entityName);
          if (!handler) continue;
          await handler({
            oldEntity: classified.oldEntity,
            newEntity: classified.newEntity,
            ...classified.meta,
          });
          continue;
        }
        if (classified.kind === 'remove') {
          const handler = registry.lookup('REMOVE', classified.entityName);
          if (!handler) continue;
          await handler({ entity: classified.entity, ...classified.meta });
          continue;
        }
      }
      return { batchItemFailures: failures };
    },
  };

  return processor;
};
