import { Button, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import type { PropsWithChildren, ReactNode } from 'react';

import { useSession } from '@/session/session-provider';

interface PageShellProps extends PropsWithChildren {
  readonly title: string;
  readonly subtitle?: string;
  readonly privatePage?: boolean;
  readonly footer?: ReactNode;
}

export function PageShell({
  title,
  subtitle,
  privatePage = false,
  footer,
  children,
}: PageShellProps) {
  const { status, error, dismissError, networkReachable, recover } =
    useSession();
  const diagnosticId = /诊断码：([^\s]+)/u.exec(error ?? '')?.[1];
  return (
    <View className={`page${privatePage ? ' private-page' : ''}`}>
      <Text className="title">{title}</Text>
      {subtitle === undefined ? null : (
        <View className="subtitle">{subtitle}</View>
      )}
      {status !== 'ANONYMOUS' &&
      status !== 'CONNECTED' &&
      status !== 'TERMINAL' ? (
        <View className="error">
          {networkReachable
            ? '正在恢复与服务器的连接…'
            : '网络不可用，等待恢复…'}
        </View>
      ) : null}
      {error === undefined ? null : (
        <View className="error">
          <Text>{error}</Text>
          <Button
            className="button button-secondary button-small"
            onClick={dismissError}
          >
            知道了
          </Button>
          {diagnosticId === undefined ? null : (
            <Button
              className="button button-secondary button-small"
              ariaLabel="复制匿名诊断码"
              onClick={() => void Taro.setClipboardData({ data: diagnosticId })}
            >
              复制诊断码
            </Button>
          )}
          {status === 'OFFLINE' || status === 'RECOVERING' ? (
            <Button
              className="button button-secondary button-small"
              ariaLabel="重试恢复连接"
              onClick={() => void recover()}
            >
              重试
            </Button>
          ) : null}
        </View>
      )}
      {children}
      {footer}
    </View>
  );
}
