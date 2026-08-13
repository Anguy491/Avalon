import { router, useFocusEffect, type Href } from 'expo-router';
import {
  CameraView,
  useCameraPermissions,
  type BarcodeScanningResult,
} from 'expo-camera';
import { useCallback, useRef, useState } from 'react';
import { Linking, Text, View } from 'react-native';

import { ActionLink } from '@/components/action-link';
import { PageShell } from '@/components/page-shell';
import { PrimaryButton } from '@/components/primary-button';
import { parseJoinLink } from '@/rooms/room-code';
import { spacing, typography } from '@/theme/tokens';
import { useAppTheme } from '@/theme/use-app-theme';

const JOIN_HOST = process.env.EXPO_PUBLIC_JOIN_HOST ?? 'join.example.invalid';

export function ScanRoomScreen() {
  const { color } = useAppTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [attempted, setAttempted] = useState(false);
  const [cameraStarted, setCameraStarted] = useState(false);
  const [focused, setFocused] = useState(false);
  const [scanError, setScanError] = useState<string>();
  const acceptingScan = useRef(true);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => {
        setFocused(false);
      };
    }, []),
  );

  const startCamera = useCallback(async () => {
    setAttempted(true);
    setScanError(undefined);
    if (permission?.granted) {
      setCameraStarted(true);
      return;
    }
    const result = await requestPermission();
    setCameraStarted(result.granted);
  }, [permission?.granted, requestPermission]);

  const handleBarcode = useCallback((result: BarcodeScanningResult) => {
    if (!acceptingScan.current) return;
    acceptingScan.current = false;
    const roomCode = parseJoinLink(result.data, [JOIN_HOST]);
    if (roomCode === undefined) {
      setScanError('二维码不是受信任的 Avalon 加入链接。');
      setTimeout(() => {
        acceptingScan.current = true;
      }, 1_200);
      return;
    }
    router.replace(`/join/${roomCode}` as Href);
  }, []);

  const denied = attempted && permission?.granted !== true;

  return (
    <PageShell>
      <View style={{ gap: spacing.xs }}>
        <Text
          selectable
          accessibilityRole="header"
          style={{
            color: color.text.primary,
            fontSize: typography.title,
            fontWeight: '800',
          }}
        >
          扫描二维码
        </Text>
        <Text
          selectable
          style={{ color: color.text.secondary, fontSize: typography.body }}
        >
          相机只用于读取公开加入链接，不拍照、不录像，也不会请求麦克风权限。
        </Text>
      </View>

      {!cameraStarted || !focused || permission?.granted !== true ? null : (
        <View
          accessibilityLabel="房间二维码取景框"
          style={{
            minHeight: 320,
            overflow: 'hidden',
            borderRadius: 20,
            borderWidth: 3,
            borderColor: color.focus.visible,
          }}
        >
          <CameraView
            style={{ flex: 1 }}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={handleBarcode}
          />
        </View>
      )}

      {!cameraStarted ? (
        <PrimaryButton
          label="允许相机并开始扫描"
          onPress={() => void startCamera()}
          accessibilityHint="显示系统相机权限对话框"
        />
      ) : null}

      {denied ? (
        <View
          accessibilityLiveRegion="polite"
          style={{
            gap: spacing.md,
            padding: spacing.md,
            borderRadius: 16,
            backgroundColor: color.surface.card,
          }}
        >
          <Text
            selectable
            style={{ color: color.result.failure, fontSize: typography.body }}
          >
            相机权限未开启。你仍可手动输入房间号。
          </Text>
          {permission?.canAskAgain === false ? (
            <PrimaryButton
              label="打开系统设置"
              onPress={() => void Linking.openSettings()}
              accessibilityHint="前往系统设置修改相机权限"
            />
          ) : null}
        </View>
      ) : null}

      {scanError === undefined ? null : (
        <Text
          selectable
          accessibilityLiveRegion="assertive"
          style={{ color: color.result.failure, fontSize: typography.body }}
        >
          {scanError} 请换一个二维码，或改用房间号。
        </Text>
      )}

      <ActionLink
        href="/join"
        label="改用房间号"
        description="无需相机权限即可继续"
        primary
      />
    </PageShell>
  );
}
