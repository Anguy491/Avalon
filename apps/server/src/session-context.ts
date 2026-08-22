export interface SessionContext {
  readonly sessionId: string;
  readonly tokenFamily: string;
  readonly roomId: string;
  readonly playerId: string;
  readonly tokenDigest: string;
  readonly credentialGeneration: number;
  readonly expiresAt: Date;
  readonly clientPlatform: 'IOS' | 'ANDROID' | 'WECHAT_MINIPROGRAM' | null;
  readonly wechatSubjectDigest?: string;
}
