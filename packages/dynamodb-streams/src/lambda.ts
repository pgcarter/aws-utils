import type { DynamoDBStreamHandler } from 'aws-lambda';

import type { StreamProcessor } from './processor';
import type { DynamoDBRecord } from './types';

// Accept any concrete StreamProcessor: .on() makes the type invariant in its
// generics, but the adapter only calls .process() so the entity types are
// irrelevant here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const toLambdaHandler = (
  processor: StreamProcessor<any, any>,
): DynamoDBStreamHandler => {
  return async (event) => {
    const records = event.Records as unknown as DynamoDBRecord[];
    return processor.process(records);
  };
};
