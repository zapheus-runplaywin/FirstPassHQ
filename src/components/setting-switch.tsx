import { Platform, Switch } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

/** An on/off switch in the club's colours, named for screen readers. */
export function SettingSwitch({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: boolean;
  onValueChange: (on: boolean) => void;
}) {
  const theme = useTheme();
  return (
    <Switch
      accessibilityLabel={label}
      value={value}
      onValueChange={onValueChange}
      trackColor={{ true: theme.accent, false: theme.backgroundSelected }}
      thumbColor={theme.text}
      {...(Platform.OS === 'web' ? { activeThumbColor: theme.onAccent } : {})}
    />
  );
}
