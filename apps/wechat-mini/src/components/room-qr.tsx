import { Canvas, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import qrcode from 'qrcode-generator';
import { useEffect } from 'react';

import { WECHAT_JOIN_HOST } from '../runtime/public-config';

interface RoomQrProps {
  readonly roomCode: string;
}

const CANVAS_ID = 'room-join-qr';

export function RoomQr({ roomCode }: RoomQrProps) {
  const host = WECHAT_JOIN_HOST;
  useEffect(() => {
    const qr = qrcode(0, 'M');
    qr.addData(`https://${host}/join/${roomCode}`);
    qr.make();
    const count = qr.getModuleCount();
    const size = 240;
    const cell = size / count;
    const context = Taro.createCanvasContext(CANVAS_ID);
    context.setFillStyle('#FFFFFF');
    context.fillRect(0, 0, size, size);
    context.setFillStyle('#171A22');
    for (let row = 0; row < count; row += 1) {
      for (let column = 0; column < count; column += 1) {
        if (qr.isDark(row, column)) {
          context.fillRect(
            Math.floor(column * cell),
            Math.floor(row * cell),
            Math.ceil(cell),
            Math.ceil(cell),
          );
        }
      }
    }
    void context.draw();
  }, [host, roomCode]);
  return (
    <View style="display:flex;justify-content:center;margin:24px 0;">
      <Canvas
        canvasId={CANVAS_ID}
        style="width:240px;height:240px;background:#fff;"
      />
    </View>
  );
}
