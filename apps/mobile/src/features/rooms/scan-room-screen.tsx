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
import { useI18n } from '@/localization/localization-provider';
import { parseJoinLink } from '@/rooms/room-code';
import { spacing, typography } from '@/theme/tokens';
import { useAppTheme } from '@/theme/use-app-theme';

const JOIN_HOST = process.env.EXPO_PUBLIC_JOIN_HOST ?? 'join.example.invalid';

export function ScanRoomScreen() {
  const { color } = useAppTheme();
  const { t } = useI18n();
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

  const handleBarcode = useCallback(
    (result: BarcodeScanningResult) => {
      if (!acceptingScan.current) return;
      acceptingScan.current = false;
      const roomCode = parseJoinLink(result.data, [JOIN_HOST]);
      if (roomCode === undefined) {
        setScanError(t('scanUntrusted'));
        setTimeout(() => {
          acceptingScan.current = true;
        }, 1_200);
        return;
      }
      router.replace(`/join/${roomCode}` as Href);
    },
    [t],
  );

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
          {t('scanTitle')}
        </Text>
        <Text
          selectable
          style={{ color: color.text.secondary, fontSize: typography.body }}
        >
          {t('scanSubtitle')}
        </Text>
      </View>

      {!cameraStarted || !focused || permission?.granted !== true ? null : (
        <View
          accessibilityLabel={t('scanFrameAccessibility')}
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
          label={t('scanStart')}
          onPress={() => void startCamera()}
          accessibilityHint={t('scanStartHint')}
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
            {t('scanDenied')}
          </Text>
          {permission?.canAskAgain === false ? (
            <PrimaryButton
              label={t('scanOpenSettings')}
              onPress={() => void Linking.openSettings()}
              accessibilityHint={t('scanOpenSettingsHint')}
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
          {t('scanErrorRecovery', { error: scanError })}
        </Text>
      )}

      <ActionLink
        href="/join"
        label={t('scanUseCode')}
        description={t('scanUseCodeDescription')}
        primary
      />
    </PageShell>
  );
}
