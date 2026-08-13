import { useColorScheme } from 'react-native';

import { darkColor, lightColor } from './tokens';

export function useAppTheme() {
  const scheme = useColorScheme();
  return {
    color: scheme === 'dark' ? darkColor : lightColor,
    isDark: scheme === 'dark',
  };
}
