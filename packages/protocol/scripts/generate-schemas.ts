import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { schemaDocuments } from '../src/schemas/index.js';
import {
  CommandResultSchema,
  ErrorResponseSchema,
  ReadRoomViewResponseSchema,
  RoomViewMessageSchema,
  SessionPingSchema,
  SessionPongSchema,
  SessionRevokedSchema,
  ServerMaintenanceSchema,
  AudioTelemetrySchema,
  SessionBootstrapSchema,
  SessionReadySchema,
  TerminalViewAckResultSchema,
  WechatIdentityBootstrapSchema,
  RoomConfigValidationResponseSchema,
} from '../src/schemas/index.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = resolve(packageRoot, '../../docs/contracts');
const mobileContractsPath = resolve(
  packageRoot,
  'src/generated/mobile-contracts.json',
);
const checkOnly = process.argv.includes('--check');
const driftedFiles: string[] = [];

const mobileContracts = {
  errorResponse: ErrorResponseSchema,
  readRoomViewResponse: ReadRoomViewResponseSchema,
  roomViewMessage: RoomViewMessageSchema,
  sessionPing: SessionPingSchema,
  sessionPong: SessionPongSchema,
  sessionRevoked: SessionRevokedSchema,
  serverMaintenance: ServerMaintenanceSchema,
  audioTelemetry: AudioTelemetrySchema,
  sessionBootstrap: SessionBootstrapSchema,
  sessionReady: SessionReadySchema,
  commandResult: CommandResultSchema,
  terminalViewAckResult: TerminalViewAckResultSchema,
  wechatIdentityBootstrap: WechatIdentityBootstrapSchema,
  roomConfigValidationResponse: RoomConfigValidationResponseSchema,
};

for (const [filename, schema] of Object.entries(schemaDocuments)) {
  const outputPath = resolve(outputDirectory, filename);
  const generated = `${JSON.stringify(schema, null, 2)}\n`;

  if (checkOnly) {
    const existing = await readFile(outputPath, 'utf8');
    if (existing !== generated) {
      driftedFiles.push(filename);
    }
  } else {
    await writeFile(outputPath, generated, 'utf8');
  }
}

const generatedMobileContracts = `${JSON.stringify(mobileContracts, null, 2)}\n`;
if (checkOnly) {
  const existing = await readFile(mobileContractsPath, 'utf8');
  if (existing !== generatedMobileContracts) {
    driftedFiles.push('src/generated/mobile-contracts.json');
  }
} else {
  await mkdir(dirname(mobileContractsPath), { recursive: true });
  await writeFile(mobileContractsPath, generatedMobileContracts, 'utf8');
}

if (driftedFiles.length > 0) {
  throw new Error(
    `Generated protocol snapshots are stale: ${driftedFiles.join(', ')}. Run pnpm protocol:generate.`,
  );
}
