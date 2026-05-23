import type { StreamEvent } from './types';

export type RegistryHandler = (arg: unknown) => void | Promise<void>;

const cellKey = (event: StreamEvent, entityName: string): string =>
  `${event}:${entityName}`;

export class HandlerRegistry {
  private readonly cells = new Map<string, RegistryHandler>();

  register(event: StreamEvent, entityName: string, handler: RegistryHandler): void {
    const key = cellKey(event, entityName);
    if (this.cells.has(key)) {
      throw new Error(
        `[dynamodb-streams] duplicate handler registration for ${event}:${entityName}`,
      );
    }
    this.cells.set(key, handler);
  }

  lookup(event: StreamEvent, entityName: string): RegistryHandler | undefined {
    return this.cells.get(cellKey(event, entityName));
  }
}
