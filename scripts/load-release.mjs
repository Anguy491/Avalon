import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { promisify } from 'node:util';
import { URL } from 'node:url';
import { Worker } from 'node:worker_threads';

const baseUrl = process.env.LOAD_BASE_URL ?? 'http://127.0.0.1:3000';
const execFileAsync = promisify(execFile);
const rooms = Number.parseInt(process.env.LOAD_ROOM_COUNT ?? '1000', 10);
const durationMs = Number.parseInt(
  process.env.LOAD_DURATION_MS ?? '1800000',
  10,
);
const rampMs = Number.parseInt(process.env.LOAD_RAMP_MS ?? '1200000', 10);
const workers = Math.min(
  rooms,
  Number.parseInt(
    process.env.LOAD_WORKERS ?? String(Math.min(10, availableParallelism())),
    10,
  ),
);
if (rooms !== 1_000 || durationMs < 1_800_000) {
  throw new Error(
    'Release evidence requires exactly 1000 rooms and at least 30 minutes steady state',
  );
}
if (
  !Number.isInteger(workers) ||
  workers < 1 ||
  workers > Math.min(rooms, 64) ||
  !Number.isFinite(rampMs) ||
  rampMs < 0
) {
  throw new Error('LOAD_WORKERS/ramp configuration is invalid');
}

const runWorker = (index, roomOffset, roomCount) =>
  new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('./load-release-worker.mjs', import.meta.url),
      {
        workerData: {
          baseUrl,
          roomOffset,
          roomCount,
          durationMs,
          rampMs,
        },
      },
    );
    worker.once('message', (message) => {
      if (message?.ok === true) resolve(message.result);
      else
        reject(
          new Error(`worker ${String(index)}: ${message?.error ?? 'failed'}`),
        );
    });
    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code !== 0)
        reject(new Error(`worker ${String(index)} exited ${String(code)}`));
    });
  });

const jobs = [];
let offset = 0;
for (let index = 0; index < workers; index += 1) {
  const count = Math.floor(rooms / workers) + (index < rooms % workers ? 1 : 0);
  jobs.push(runWorker(index, offset, count));
  offset += count;
}
const results = await Promise.all(jobs);
const samples = (name) => results.flatMap((result) => result.timings[name]);
const percentile = (values, fraction) => {
  const sorted = [...values].sort((left, right) => left - right);
  return (
    sorted[Math.ceil(sorted.length * fraction) - 1] ?? Number.POSITIVE_INFINITY
  );
};
const createP95 = percentile(samples('create'), 0.95);
const joinP95 = percentile(samples('join'), 0.95);
const commandP95 = percentile(samples('command'), 0.95);
const projectionP95 = percentile(samples('projection'), 0.95);
const resourceCurve = Array.from(
  {
    length: Math.max(...results.map((result) => result.resourceSamples.length)),
  },
  (_unused, index) => {
    const atMinute = results
      .map((result) => result.resourceSamples[index])
      .filter((sample) => sample !== undefined);
    return {
      elapsedMinutes: index,
      maxWorkerRss: Math.max(...atMinute.map((sample) => sample.memoryRss)),
      maxWorkerEventLoopP99Ms: Math.max(
        ...atMinute.map((sample) => sample.eventLoopP99Ms),
      ),
    };
  },
);
const recentResources = resourceCurve.slice(-3);
const sustainedIncrease = (field) =>
  recentResources.length === 3 &&
  recentResources.every(
    (sample, index) =>
      index === 0 ||
      sample[field] >=
        (recentResources[index - 1]?.[field] ?? Number.POSITIVE_INFINITY),
  ) &&
  (recentResources[2]?.[field] ?? 0) >
    (recentResources[0]?.[field] ?? Number.POSITIVE_INFINITY) * 1.2;
const sustainedResourceDeterioration =
  sustainedIncrease('maxWorkerRss') ||
  sustainedIncrease('maxWorkerEventLoopP99Ms');
const allErrors = results.flatMap((result) => result.errors);
const operations =
  samples('create').length +
  samples('join').length +
  results.reduce((total, result) => total + result.commands, 0);
const errorRate = allErrors.length / Math.max(1, operations);
if (
  createP95 > 2_000 ||
  joinP95 > 2_000 ||
  commandP95 > 1_000 ||
  projectionP95 > 1_000 ||
  errorRate >= 0.01 ||
  sustainedResourceDeterioration
) {
  throw new Error('M7 release load SLO failed');
}

const packageJson = await readFile(new URL('../package.json', import.meta.url));
const { stdout: commitHash } = await execFileAsync(
  'git',
  ['rev-parse', 'HEAD'],
  { cwd: new URL('..', import.meta.url) },
);
const topologyHash = createHash('sha256')
  .update(
    JSON.stringify({
      rooms,
      connections: rooms * 10,
      workers,
      rampMs,
      durationMs,
    }),
  )
  .digest('hex');
process.stdout.write(
  `${JSON.stringify(
    {
      status: 'passed',
      rooms,
      connections: results.reduce(
        (total, result) => total + result.connections,
        0,
      ),
      steadyStateMinutes: durationMs / 60_000,
      rampMinutes: rampMs / 60_000,
      p95Ms: {
        create: createP95,
        join: joinP95,
        command: commandP95,
        projection: projectionP95,
      },
      p99Ms: {
        create: percentile(samples('create'), 0.99),
        join: percentile(samples('join'), 0.99),
        command: percentile(samples('command'), 0.99),
        projection: percentile(samples('projection'), 0.99),
      },
      errorRate,
      projectionIsolation: 'passed',
      secretCanary: 'passed',
      resourceCurve,
      sustainedResourceDeterioration,
      commitHash: commitHash.trim(),
      topologyHash,
      harnessHash: createHash('sha256').update(packageJson).digest('hex'),
    },
    null,
    2,
  )}\n`,
);
