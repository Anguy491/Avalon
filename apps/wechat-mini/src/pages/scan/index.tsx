import { Button, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useState } from 'react';

import { parseJoinLink } from '@avalon/client-core';

import { PageShell } from '@/components/page-shell';
import { WECHAT_JOIN_HOST } from '../../runtime/public-config';

export default function ScanPage() {
  const [error, setError] = useState<string>();
  const scan = async () => {
    setError(undefined);
    try {
      const result = await Taro.scanCode({
        onlyFromCamera: true,
        scanType: ['qrCode'],
      });
      const host = WECHAT_JOIN_HOST;
      const roomCode = parseJoinLink(result.result, [host]);
      if (roomCode === undefined) {
        setError('这不是本应用生成的房间二维码。');
        return;
      }
      await Taro.redirectTo({ url: `/pages/join/index?roomCode=${roomCode}` });
    } catch {
      setError('未能读取二维码。你仍可返回并手动输入房间号。');
    }
  };
  return (
    <PageShell
      title="扫描房间二维码"
      subtitle="摄像头只用于本次主动扫码，不会保存照片或视频。"
    >
      {error === undefined ? null : <View className="error">{error}</View>}
      <Button className="button" onClick={() => void scan()}>
        打开扫码器
      </Button>
      <Button
        className="button button-secondary"
        onClick={() => void Taro.redirectTo({ url: '/pages/join/index' })}
      >
        改用房间号
      </Button>
    </PageShell>
  );
}
