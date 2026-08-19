import Taro from '@tarojs/taro';
import { WebSocket as EngineWebSocketTransport } from 'engine.io-client';

interface WebSocketEventLike {
  readonly data?: string | ArrayBuffer;
  readonly code?: number;
  readonly reason?: string;
}

class WeChatWebSocketFacade {
  binaryType = 'arraybuffer';
  onopen: ((event: WebSocketEventLike) => void) | null = null;
  onclose: ((event: WebSocketEventLike) => void) | null = null;
  onmessage: ((event: WebSocketEventLike) => void) | null = null;
  onerror: ((event: WebSocketEventLike) => void) | null = null;

  private task: Taro.SocketTask | undefined;
  private closeRequested = false;

  constructor(uri: string, protocols?: string | string[]) {
    void this.connect(uri, protocols);
  }

  private async connect(
    uri: string,
    protocols?: string | string[],
  ): Promise<void> {
    try {
      const task = await Taro.connectSocket({
        url: uri,
        protocols:
          typeof protocols === 'string'
            ? [protocols]
            : protocols === undefined
              ? []
              : protocols,
      });
      this.task = task;
      task.onOpen(() => this.onopen?.({}));
      task.onMessage((event) => {
        const data = event.data as unknown;
        if (typeof data === 'string' || data instanceof ArrayBuffer) {
          this.onmessage?.({ data });
        } else {
          this.onerror?.({});
        }
      });
      task.onError(() => this.onerror?.({}));
      task.onClose((event) =>
        this.onclose?.({ code: event.code, reason: event.reason }),
      );
      if (this.closeRequested) {
        task.close({ code: 1000, reason: 'client close' });
      }
    } catch {
      this.onerror?.({});
    }
  }

  send(data: string | ArrayBuffer): void {
    this.task?.send({ data });
  }

  close(): void {
    this.closeRequested = true;
    this.task?.close({ code: 1000, reason: 'client close' });
  }
}

export class WeChatWebSocketTransport extends EngineWebSocketTransport {
  override createSocket(
    uri: string,
    protocols: string | string[] | undefined,
  ): WeChatWebSocketFacade {
    return new WeChatWebSocketFacade(uri, protocols);
  }
}
