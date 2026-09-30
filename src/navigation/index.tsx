import React from 'react';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import TodayScreen from '../screens/TodayScreen';
import AddMeetingScreen from '../screens/AddMeetingScreen';
import HistoryScreen from '../screens/HistoryScreen';
import SettingsScreen from '../screens/SettingsScreen';
import AlarmScreen from '../screens/AlarmScreen';
import SignInScreen from '../screens/auth/SignInScreen';
import CreateAccountScreen from '../screens/auth/CreateAccountScreen';
import PhoneSignInScreen from '../screens/auth/PhoneSignInScreen';
import ForgotPasswordScreen from '../screens/auth/ForgotPasswordScreen';
import { useThemeColors, useIsDark } from '../theme';
import { useAuthStore } from '../store/authStore';
import { useUiStore } from '../store/uiStore';
import { navigationRef } from './navigationRef';
import AppAlertHost from '../components/AppAlertHost';
import { AgendaIcon, HistoryIcon, SettingsIcon, AddIcon, TabIconProps } from '../components/TabIcons';

const Stack = createNativeStackNavigator();
const AuthStack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

// Route name ("Today") is unchanged everywhere internally — only the label
// shown on the tab itself is "Agenda", since that's what this tab actually
// displays (every saved upcoming meeting, not just today's).
const TAB_LABELS: Record<string, string> = { Today: 'Agenda', History: 'History', Settings: 'Settings' };
const TAB_ICON_COMPONENTS: Record<string, React.ComponentType<TabIconProps>> = {
  Today: AgendaIcon,
  History: HistoryIcon,
  Settings: SettingsIcon,
};

/** Bottom bar: Agenda / a floating gradient + (opens Add meeting as a modal,
 * it's not a real tab) / History / Settings. Icons are themed stroke vectors
 * (see TabIcons.tsx) rather than emoji, tinted with the brand palette. */
function CustomTabBar({ state, navigation }: any) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  // AddMeetingScreen sets this while it's the focused screen (see
  // store/uiStore.ts) — the Add tab itself never becomes the Tab
  // Navigator's focused route (its tabPress always redirects to the
  // AddMeeting modal instead, below), so this is how the tab bar knows
  // "Add" is the one currently active.
  const addMeetingOpen = useUiStore((s) => s.addMeetingOpen);

  return (
    <View
      style={[
        tabStyles.bar,
        { backgroundColor: colors.surface, borderTopColor: colors.border, paddingBottom: insets.bottom + 10 },
      ]}
    >
      {state.routes.map((route: any, index: number) => {
        if (route.name === 'AddTab') {
          return (
            <TouchableOpacity
              key={route.key}
              style={tabStyles.tabItem}
              onPress={() => navigation.navigate('AddMeeting')}
            >
              {/* Add always sits in its own solid chip, not just while the
                  Add screen is open — it's the bar's one primary action,
                  not a nav destination like the other three, so it
                  shouldn't carry the same plain weight as an inactive tab.
                  The dot below still shows only while Add is actually
                  open, the same "you are here" cue the other tabs use. */}
              <View style={[tabStyles.fab, tabStyles.addFab, { backgroundColor: colors.primary }]}>
                <AddIcon color={colors.white} size={16} strokeWidth={2.4} />
              </View>
              <Text style={[tabStyles.tabLabel, { color: colors.primary, fontWeight: '700' }]}>Add</Text>
              {addMeetingOpen && <View style={[tabStyles.activeDot, { backgroundColor: colors.primary }]} />}
            </TouchableOpacity>
          );
        }

        const isFocused = state.index === index;
        const IconComponent = TAB_ICON_COMPONENTS[route.name];
        const iconColor = isFocused ? colors.primary : colors.textSecondary;
        return (
          <TouchableOpacity key={route.key} style={tabStyles.tabItem} onPress={() => navigation.navigate(route.name)}>
            {IconComponent ? (
              isFocused ? (
                // Active tab sits in a rounded-square gradient chip (the
                // same teal-to-blue brand gradient as before, just squared
                // off to match the other chips), with a bolder icon and a
                // small dot underneath, so "this is where you are" reads
                // clearly next to the dimmed, chip-backed inactive tabs.
                <LinearGradient colors={[colors.gradientStart, colors.gradientEnd]} style={tabStyles.fab}>
                  <IconComponent color={colors.white} size={17} strokeWidth={2.4} />
                </LinearGradient>
              ) : (
                <View style={[tabStyles.iconSlot, tabStyles.inactiveChip, { backgroundColor: colors.surfaceAlt }]}>
                  <IconComponent color={iconColor} size={20} />
                </View>
              )
            ) : null}
            <Text
              style={[
                tabStyles.tabLabel,
                { color: iconColor, fontWeight: isFocused ? '700' : '600' },
                !isFocused && tabStyles.inactiveChip,
              ]}
            >
              {TAB_LABELS[route.name] ?? route.name}
            </Text>
            {isFocused && <View style={[tabStyles.activeDot, { backgroundColor: colors.primary }]} />}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function Tabs() {
  return (
    <Tab.Navigator tabBar={(props) => <CustomTabBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tab.Screen name="Today" component={TodayScreen} />
      <Tab.Screen
        name="AddTab"
        component={TodayScreen}
        listeners={({ navigation }) => ({
          tabPress: (e) => {
            e.preventDefault();
            navigation.navigate('AddMeeting');
          },
        })}
      />
      <Tab.Screen name="History" component={HistoryScreen} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}

/** The signed-out stack — sign in, create account, phone OTP, forgot
 * password. Shown instead of the main app whenever there's no signed-in
 * Firebase user (see RootNavigator below). */
function AuthNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="SignIn" component={SignInScreen} />
      <AuthStack.Screen name="CreateAccount" component={CreateAccountScreen} />
      <AuthStack.Screen name="PhoneSignIn" component={PhoneSignInScreen} />
      <AuthStack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
    </AuthStack.Navigator>
  );
}

export default function RootNavigator() {
  const colors = useThemeColors();
  const isDark = useIsDark();
  const user = useAuthStore((s) => s.user);
  const initializing = useAuthStore((s) => s.initializing);

  const navTheme = {
    ...(isDark ? DarkTheme : DefaultTheme),
    colors: {
      ...(isDark ? DarkTheme.colors : DefaultTheme.colors),
      background: colors.background,
      primary: colors.primary,
      card: colors.surface,
      text: colors.textPrimary,
      border: colors.border,
    },
  };

  // Firebase hasn't yet told us whether a session is already persisted on
  // this device — avoid flashing the sign-in screen for a split second
  // while that resolves.
  if (initializing) {
    return (
      <View style={[styles.loadingScreen, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <>
      <NavigationContainer ref={navigationRef} theme={navTheme}>
        {!user ? (
          <AuthNavigator />
        ) : (
          <Stack.Navigator
            screenOptions={{
              headerStyle: { backgroundColor: colors.primary },
              headerTintColor: colors.white,
              headerTitleStyle: { fontWeight: '700' },
              // Android centers header titles left by default, unlike iOS —
              // force center on both so "Add meeting"/"Edit meeting" lines
              // up the same way everywhere.
              headerTitleAlign: 'center',
            }}
          >
            <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
            <Stack.Screen
              name="AddMeeting"
              component={AddMeetingScreen}
              options={({ route }: any) => ({
                title: route.params?.meeting ? 'Edit meeting' : 'Add meeting',
                presentation: 'modal',
              })}
            />
            <Stack.Screen
              name="Alarm"
              component={AlarmScreen}
              options={{ headerShown: false, presentation: 'fullScreenModal', gestureEnabled: false }}
            />
          </Stack.Navigator>
        )}
      </NavigationContainer>
      {/* Mounted once here (not per-screen) so every showAlert() call in the
          app — from any screen or service — renders through this one
          rounded-corner card. See services/appAlert.ts. */}
      <AppAlertHost />
    </>
  );
}

const styles = StyleSheet.create({
  loadingScreen: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});

const tabStyles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 10,
    borderTopWidth: 1,
  },
  tabItem: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tabLabel: { fontSize: 11, marginTop: 4 },
  // Active tab / Add: a rounded-square chip, not a circle, so every tab
  // shares one chip language and only the fill changes with state
  // (gradient for "you are here", solid primary for Add, see addFab).
  fab: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Add's chip stays round instead of squared, so the bar's one primary
  // "create" action still stands apart from the three squared destinations.
  addFab: { borderRadius: 15 },
  // Same 30x30 footprint as `fab` so switching tabs never nudges the label
  // up or down, with its own subtle tinted background (the same surfaceAlt
  // panel tint used elsewhere in the app) instead of no background at all
  // — a bare background is what made every icon blend together before.
  iconSlot: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  // Dims an inactive tab's icon chip and label so the active tab's full-
  // strength gradient chip and colored label clearly stand out next to it.
  inactiveChip: { opacity: 0.7 },
  activeDot: { width: 4, height: 4, borderRadius: 2, marginTop: 3 },
  fabIcon: { color: '#fff', fontSize: 16, fontWeight: '700', marginTop: -1 },
});
