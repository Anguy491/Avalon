import type { ClientCapabilities } from '@avalon/protocol';

export interface ClientIdentity {
  readonly clientPlatform: ClientCapabilities['platform'];
  readonly wechatSubjectDigest?: string;
}
