import { Button, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';

import { PageShell } from '@/components/page-shell';
import { useSession } from '@/session/session-provider';

export default function HomePage() {
  const { status, summary, recover, forgetSession } = useSession();
  return (
    <PageShell
      title="曼波阿瓦隆"
      subtitle="5–10 人同桌游玩，裁决与每位玩家的秘密身份由服务器安全分发。"
    >
      {summary === undefined ? null : (
        <View className="card">
          <Text className="section-title">未结束的房间 {summary.roomCode}</Text>
          <Button
            className="button"
            disabled={status === 'RECOVERING'}
            onClick={() => void recover()}
          >
            恢复对局
          </Button>
          <Button
            className="button button-secondary"
            onClick={() => void forgetSession()}
          >
            清除本机会话
          </Button>
        </View>
      )}
      <Button
        className="button"
        onClick={() => void Taro.navigateTo({ url: '/pages/create/index' })}
      >
        创建房间
      </Button>
      <Button
        className="button button-secondary"
        onClick={() => void Taro.navigateTo({ url: '/pages/join/index' })}
      >
        输入房间号加入
      </Button>
      <Button
        className="button button-secondary"
        onClick={() => void Taro.navigateTo({ url: '/pages/scan/index' })}
      >
        扫描房间二维码
      </Button>
      <View className="subtitle">无需微信登录；昵称只用于当前房间。</View>
    </PageShell>
  );
}
