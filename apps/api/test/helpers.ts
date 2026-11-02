import { Writable } from 'node:stream';
import { createLogger } from '../src/http/logger.ts';

/** Logger que acumula las líneas en memoria para poder inspeccionarlas en los tests. */
export function captureLogger(level = 'info'): {
  logger: ReturnType<typeof createLogger>;
  lines: () => Record<string, unknown>[];
} {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString('utf8'));
      callback();
    },
  });
  const logger = createLogger(level, stream);
  return {
    logger,
    lines: () =>
      chunks
        .join('')
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}
