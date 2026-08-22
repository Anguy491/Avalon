import { useEffect, useState, type PropsWithChildren } from 'react';
import { AppState, Text, View } from 'react-native';

import { useI18n } from '@/localization/localization-provider';

import { isPrivateSnapshotState } from './privacy-state';

export function AppPrivacyShield({ children }: PropsWithChildren) {
  const { t } = useI18n();
  const [shielded, setShielded] = useState(
    isPrivateSnapshotState(AppState.currentState),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setShielded(isPrivateSnapshotState(state));
    });
    return () => {
      subscription.remove();
    };
  }, []);

  return (
    <View style={{ flex: 1 }}>
      {children}
      {shielded ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 10_000,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#171A22',
          }}
        >
          <Text style={{ color: '#F4F1E8', fontSize: 18, fontWeight: '800' }}>
            Avalon
          </Text>
          <Text style={{ color: '#B9BEC9', fontSize: 14 }}>
            {t('privacyReturnToContinue')}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
