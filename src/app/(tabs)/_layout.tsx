import AsyncStorage from '@react-native-async-storage/async-storage';
import { usePathname } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { useEffect, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from '@/components/icon';
import { BrandFonts } from '@/constants/theme';
import { useWideLayout } from '@/hooks/use-layout';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useClub } from '@/lib/club';
import { clubWaitingTotal } from '@/lib/club-areas';
import { HomeProvider, useHome } from '@/lib/home';
import { defaultHub, HUB_TITLES, HUBS, tabsFor, type HubName } from '@/lib/home-layout';
import { useRouteAccess } from '@/lib/route-access';
import { useClubAreas } from '@/lib/use-club-areas';

/**
 * The tab bar: Today, Calendar, Messages, the member's hub (Team, Family or
 * Club) and Me. Which tabs a member has is src/lib/home-layout.ts; what they
 * share is loaded once here (src/lib/home.tsx).
 *
 * Every other screen opens over the tabs from the root stack
 * (src/app/_layout.tsx) with a back button, so the bar never has to guess
 * which tab a deeper screen belongs to.
 */
export default function TabsLayout() {
  return (
    <HomeProvider>
      <TabBar />
    </HomeProvider>
  );
}

const HUB_ICONS: Record<HubName, IconName> = {
  team: 'users',
  family: 'heart',
  club: 'briefcase',
};

/** The bar's height on a phone, before the space the phone keeps at the bottom. */
const TAB_BAR_HEIGHT = 60;

/** Where the hub a member last opened is remembered on this device. */
export const hubStorageKey = (userId: string) => `hub:${userId}`;

function tabIcon(name: IconName) {
  function TabIcon({ color, size }: { color: unknown; size: number }) {
    return <Icon name={name} size={size} color={typeof color === 'string' ? color : undefined} />;
  }
  return TabIcon;
}

/**
 * The hub the tab bar shows for someone with more than one: the one they are
 * on, else the one they last opened, else the one for their main role.
 */
function useCurrentHub(hubs: HubName[]) {
  const { session, profile } = useAuth();
  const userId = session?.user.id;
  const pathname = usePathname();
  const [chosen, setChosen] = useState<HubName | null>(null);
  const onHub = HUBS.find((hub) => pathname === `/${hub}`) ?? null;

  useEffect(() => {
    if (!userId) return;
    let stale = false;
    AsyncStorage.getItem(hubStorageKey(userId))
      .then((saved) => {
        if (!stale && HUBS.includes(saved as HubName)) setChosen((now) => now ?? (saved as HubName));
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [userId]);

  // Opening a hub makes it the one the bar shows from then on.
  if (onHub && onHub !== chosen) setChosen(onHub);

  useEffect(() => {
    if (!onHub || !userId) return;
    AsyncStorage.setItem(hubStorageKey(userId), onHub).catch(() => {});
  }, [onHub, userId]);

  if (onHub && hubs.includes(onHub)) return onHub;
  if (chosen && hubs.includes(chosen)) return chosen;
  return defaultHub(hubs, profile?.role);
}

function TabBar() {
  const theme = useTheme();
  const { features } = useClub();
  const can = useRouteAccess();
  const { single, hubs, getsMessages, unreadCount, reloadUnread, activityNew } = useHome();
  const hub = useCurrentHub(hubs);
  // On a tablet the bar becomes a rail down the left, so the screen keeps its height.
  const wide = useWideLayout();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();

  // The unread count follows the member from tab to tab.
  useEffect(() => {
    reloadUnread();
  }, [pathname, reloadUnread]);

  const tabs = tabsFor({
    single: !!single,
    calendar: features.calendar && can.open,
    messages: features.messages && can.readMessages,
    hub,
  });
  const childChanges = Object.values(activityNew).reduce((sum, n) => sum + n, 0);
  // Work waiting in the Club tab's areas, such as requests to join.
  const clubWaiting = clubWaitingTotal(useClubAreas());
  const badgeStyle = {
    backgroundColor: theme.accent,
    color: theme.onAccent,
    fontFamily: BrandFonts.bold,
  };

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.tint,
        tabBarInactiveTintColor: theme.textSecondary,
        tabBarPosition: wide ? 'left' : 'bottom',
        tabBarVariant: wide ? 'material' : 'uikit',
        tabBarLabelPosition: 'below-icon',
        tabBarLabelStyle: { fontFamily: BrandFonts.bold, fontSize: 11, lineHeight: 14 },
        tabBarBadgeStyle: badgeStyle,
        // People with one job to do keep one screen and no bar.
        tabBarStyle: single
          ? { display: 'none' }
          : {
              backgroundColor: theme.background,
              borderTopColor: theme.backgroundSelected,
              borderRightColor: theme.backgroundSelected,
              // Room for the icon and a Montserrat label, clear of the home indicator.
              ...(wide ? null : { height: TAB_BAR_HEIGHT + insets.bottom, paddingTop: 6 }),
            },
        sceneStyle: { backgroundColor: theme.background },
      }}>
      <Tabs.Screen name="index" options={{ title: 'Today', tabBarIcon: tabIcon('home') }} />
      <Tabs.Protected guard={tabs.includes('calendar')}>
        <Tabs.Screen
          name="calendar"
          options={{ title: 'Calendar', tabBarIcon: tabIcon('calendar') }}
        />
      </Tabs.Protected>
      <Tabs.Protected guard={tabs.includes('messages')}>
        <Tabs.Screen
          name="messages"
          options={{
            title: 'Messages',
            tabBarIcon: tabIcon('message-square'),
            tabBarBadge: getsMessages && unreadCount > 0 ? unreadCount : undefined,
          }}
        />
      </Tabs.Protected>
      {HUBS.map((name) => (
        <Tabs.Protected key={name} guard={hubs.includes(name)}>
          <Tabs.Screen
            name={name}
            options={{
              title: HUB_TITLES[name],
              tabBarIcon: tabIcon(HUB_ICONS[name]),
              // One hub button: the others are reached from the switch at its top.
              href: tabs.includes(name) ? undefined : null,
              tabBarBadge:
                name === 'family' && childChanges > 0
                  ? childChanges
                  : name === 'club' && clubWaiting > 0
                    ? clubWaiting
                    : undefined,
            }}
          />
        </Tabs.Protected>
      ))}
      <Tabs.Protected guard={tabs.includes('me')}>
        <Tabs.Screen name="me" options={{ title: 'Me', tabBarIcon: tabIcon('user') }} />
      </Tabs.Protected>
    </Tabs>
  );
}
