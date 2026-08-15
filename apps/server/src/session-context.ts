export interface SessionContext {
  readonly sessionId: string;
  readonly tokenFamily: string;
  readonly roomId: string;
  readonly playerId: string;
  readonly tokenDigest: string;
  readonly credentialGeneration: number;
  readonly expiresAt: Date;
}
