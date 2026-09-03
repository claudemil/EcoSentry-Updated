import { Tabs } from "expo-router";
import React from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HapticTab } from "@/components/haptic-tab";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { Ionicons } from "@expo/vector-icons";
import { auth } from "../../firebaseConfig";
import { COLORS } from "@/constants/Colors";
import { View, StyleSheet } from "react-native";
import { LogBox } from "react-native";
import OfflineBanner from "@/components/ui/OfflineBanner";
import { useAutoSyncOfflinePins } from "@/hooks/useAutoSyncOfflinePins";

LogBox.ignoreLogs(["Could not reach Cloud Firestore backend"]);

// ── Module-level, runs once, guarded against re-wrapping ──
if (!(console as any).__firestoreErrorPatched) {
  const originalConsoleError = console.error;
  console.error = (...args: any[]) => {
    if (
      typeof args[0] === "string" &&
      args[0].includes("Could not reach Cloud Firestore backend")
    ) {
      return;
    }
    originalConsoleError(...args);
  };
  (console as any).__firestoreErrorPatched = true;
}

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  useAutoSyncOfflinePins();

  const handleObservePress = (e: any, navigation: any) => {
    e.preventDefault();
    const currentUser = auth.currentUser;

    if (!currentUser) {
      navigation.navigate("LoginPage");
    } else {
      navigation.navigate("observe");
    }
  };

  // ← removed: console.error override no longer lives here

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <OfflineBanner />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarButton: HapticTab,
          tabBarActiveTintColor: COLORS.white,
          tabBarInactiveTintColor: "#9E9E9E",
          tabBarStyle: {
            backgroundColor: COLORS.green700,
            borderTopWidth: 0.5,
            borderTopColor: "rgba(0,0,0,0.08)",
            elevation: 8,
            shadowColor: "#000",
            shadowOffset: { width: 0, height: -2 },
            shadowOpacity: 0.06,
            shadowRadius: 8,
            height: 60 + insets.bottom,
            paddingBottom: 8 + insets.bottom,
            paddingTop: 6,
          },
          tabBarLabelStyle: {
            fontSize: 11,
            fontWeight: "500",
          },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: "Home",
            tabBarIcon: ({ color, focused }) => (
              <View
                style={[
                  styles.iconWrapper,
                  focused && styles.iconWrapperActive,
                ]}
              >
                <IconSymbol size={24} name="house.fill" color={color} />
              </View>
            ),
          }}
        />
        <Tabs.Screen
          name="observe"
          options={{
            title: "Observe",
            tabBarIcon: ({ color, focused }) => (
              <View
                style={[
                  styles.iconWrapper,
                  focused && styles.iconWrapperActive,
                ]}
              >
                <Ionicons
                  name={focused ? "eye" : "eye-outline"}
                  size={26}
                  color={color}
                />
              </View>
            ),
          }}
          listeners={({ navigation }) => ({
            tabPress: (e) => handleObservePress(e, navigation),
          })}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: "Profile",
            tabBarIcon: ({ color, focused }) => (
              <View
                style={[
                  styles.iconWrapper,
                  focused && styles.iconWrapperActive,
                ]}
              >
                <Ionicons
                  name={focused ? "person-circle" : "person-circle-outline"}
                  size={26}
                  color={color}
                />
              </View>
            ),
          }}
          listeners={({ navigation }) => ({
            tabPress: (e) => {
              e.preventDefault();
              navigation.navigate("profile", { userId: undefined });
            },
          })}
        />
      </Tabs>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  iconWrapper: {
    width: 44,
    height: 30,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  iconWrapperActive: {
    backgroundColor: "rgba(255,255,255,0.18)",
  },
});
