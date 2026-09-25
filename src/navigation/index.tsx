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
import { navigationRef } from './navigationRef';

const Stack = createNativeStackNavigator();
const AuthStack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const TAB_ICONS: Record<string, string> = { Today: '📅', History: '🕐', Settings: '⚙️' };

/** Bottom bar matching the concept: Today / History / a floating gradient +
 * (opens Add meeting as a modal, it's not a real tab) / Settings. */
function CustomTabBar({ state, navigation }: any) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();

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
              <LinearGradient colors={[colors.gradientStart, colors.gradientEnd]} style={tabStyles.fab}>
                <Text style={tabStyles.fabIcon}>+</Text>
              </LinearGradient>
              <Text style={[tabStyles.tabLabel, { color: colors.textSecondary }]}>Add</Text>
            </TouchableOpacity>
          );
        }

        const isFocused = state.index === index;
        return (
          <TouchableOpacity key={route.key} style={tabStyles.tabItem} onPress={() => navigation.navigate(route.name)}>
            <Text style={{ fontSize: 20, opacity: isFocused ? 1 : 0.65 }}>{TAB_ICONS[route.name]}</Text>
            <Text
              style={[
                tabStyles.tabLabel,
                { color: isFocused ? colors.primary : colors.textSecondary, fontWeight: isFocused ? '700' : '600' },
              ]}
            >
              {route.name}
            </Text>
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
      <Tab.Screen name="History" component={HistoryScreen} />
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
    <NavigationContainer ref={navigationRef} theme={navTheme}>
      {!user ? (
        <AuthNavigator />
      ) : (
        <Stack.Navigator
          screenOptions={{
            headerStyle: { backgroundColor: colors.primary },
            headerTintColor: colors.white,
            headerTitleStyle: { fontWeight: '700' },
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
  fab: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabIcon: { color: '#fff', fontSize: 16, fontWeight: '700', marginTop: -1 },
});
