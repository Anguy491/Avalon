import { performance } from 'node:perf_hooks';

const baseUrl = process.env.LOAD_BASE_URL ?? 'http://127.0.0.1:3000';
const requestCount = 50;
const timings = [];

await Promise.all(
  Array.from({ length: requestCount }, async () => {
    const startedAt = performance.now();
    const response = await fetch(`${baseUrl}/v1/health/live`, {
      headers: { accept: 'application/json' },
    });
    timings.push(performance.now() - startedAt);
    if (!response.ok) {
      throw new Error(`Load smoke received HTTP ${response.status}`);
    }
  }),
);

timings.sort((left, right) => left - right);
const percentileIndex = Math.ceil(timings.length * 0.95) - 1;
const p95 = timings[percentileIndex];
if (p95 === undefined) throw new Error('Load smoke produced no timing samples');

process.stdout.write(
  `M0 health load smoke: ${requestCount} requests, p95=${p95.toFixed(1)}ms\n`,
);
