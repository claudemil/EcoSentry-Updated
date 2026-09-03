// components/OfflineBanner.tsx
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Animated } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { COLORS } from "@/constants/Colors";

export default function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);
  const slideAnim = React.useRef(new Animated.Value(-60)).current;

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const offline =
        state.isConnected === false || state.isInternetReachable === false;
      setIsOffline(offline);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (isOffline) {
      setShouldRender(true); // mount before animating in
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: -60,
        duration: 250,
        useNativeDriver: true,
      }).start(() => setShouldRender(false)); // unmount after animating out
    }
  }, [isOffline]);

  if (!shouldRender) return null; // fully removed from the tree when online

  return (
    <Animated.View
      style={[styles.banner, { transform: [{ translateY: slideAnim }] }]}
      pointerEvents="none"
    >
      <Text style={styles.text}>
        You're offline — pins will be saved locally and synced later.
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: "#B71C1C",
    paddingVertical: 8,
    paddingHorizontal: 16,
    zIndex: 999,
  },
  text: {
    color: COLORS.white,
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
  },
});
