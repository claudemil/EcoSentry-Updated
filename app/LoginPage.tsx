import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ScrollView,
  StatusBar,
  ActivityIndicator,
} from "react-native";
import { router } from "expo-router";
import { Stack } from "expo-router";
import axios from "axios";
import api from "@/services/api";
import * as SecureStore from "expo-secure-store";
import { Ionicons } from "@expo/vector-icons";
import { signInWithEmailAndPassword } from "firebase/auth";
import { collection, query, where, getDocs } from "firebase/firestore";
import { auth, db } from "../firebaseConfig";

const COLORS = {
  green700: "#2E7D32",
  green500: "#4CAF50",
  pinRed: "#E53935",
  blue: "#1565C0",
  white: "#fff",
  surface: "#F5F5F5",
  textSecondary: "#757575",
  border: "rgba(0,0,0,0.08)",
};

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);

  const handleLogin = async () => {
    if (!username || !password) {
      Alert.alert("Error", "Please fill in all fields");
      return;
    }

    try {
      setIsVerifying(true);
      // 1. Query Firestore to find the user's email based on their username
      const usersRef = collection(db, "users");
      const q = query(usersRef, where("username", "==", username));
      const querySnapshot = await getDocs(q);

      if (querySnapshot.empty) {
        Alert.alert("Error", "Username not found");
        return;
      }

      const userDoc = querySnapshot.docs[0];
      const userData = userDoc.data();
      const userEmail = userData.email;

      // 2. Sign in with the fetched email
      const userCredential = await signInWithEmailAndPassword(
        auth,
        userEmail,
        password,
      );

      Alert.alert("Success", "Logged in successfully!");

      router.replace({
        pathname: "/",
        params: {
          userId: userCredential.user.uid,
          username: userData.username,
          pins_count: userData.pins_count || 0,
        },
      });
    } catch (e: any) {
      Alert.alert("Error", "Invalid username or password");
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <View style={styles.mainWrapper}>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar barStyle="light-content" />

      {/* Navbar — matches ProfileScreen */}
      <View style={styles.navBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={COLORS.white} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>EcoSentry</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          style={styles.container}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Profile-style avatar header */}
          <View style={styles.profileHeader}>
            <View style={styles.avatarCircle}>
              <Ionicons name="person" size={50} color={COLORS.green700} />
            </View>
            <Text style={styles.userName}>Welcome Back</Text>
            <Text style={styles.userEmail}>Please log in to your account</Text>
          </View>

          {/* Form card — matches menuGroup card */}
          <View style={styles.menuGroup}>
            <Text style={styles.sectionLabel}>CREDENTIALS</Text>

            {/* Username field */}
            <View style={styles.inputRow}>
              <Ionicons
                name="person-outline"
                size={20}
                color={COLORS.textSecondary}
                style={styles.inputIcon}
              />
              <TextInput
                style={styles.input}
                placeholder="Username"
                placeholderTextColor={COLORS.textSecondary}
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
              />
            </View>

            {/* Password field */}
            <View style={[styles.inputRow, { borderBottomWidth: 0 }]}>
              <Ionicons
                name="lock-closed-outline"
                size={20}
                color={COLORS.textSecondary}
                style={styles.inputIcon}
              />
              <TextInput
                style={styles.input}
                placeholder="Password"
                placeholderTextColor={COLORS.textSecondary}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
              />
            </View>
          </View>

          {/* Action buttons — styled like profile menu items */}
          <View style={styles.menuGroup}>
            <Text style={[styles.sectionLabel, { marginTop: 0 }]}>ACCOUNT</Text>

            <TouchableOpacity
              style={styles.primaryAction}
              onPress={handleLogin}
              disabled={isVerifying}
            >
              <View style={styles.menuLeft}>
                <Ionicons
                  name="log-in-outline"
                  size={22}
                  color={COLORS.white}
                />
                <Text style={styles.primaryActionText}>Login</Text>
                {isVerifying && (
                  <ActivityIndicator
                    size="small"
                    color="#fff"
                    style={{ marginLeft: 8 }}
                  />
                )}
              </View>
              <Ionicons name="chevron-forward" size={18} color={COLORS.white} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => router.push("/RegisterPage")}
              disabled={isVerifying}
            >
              <View style={styles.menuLeft}>
                <Ionicons
                  name="person-add-outline"
                  size={22}
                  color={COLORS.green700}
                />
                <Text style={[styles.menuText, { color: COLORS.green700 }]}>
                  Create an Account
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#CCC" />
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  mainWrapper: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  navBar: {
    height: 100,
    paddingTop: 45,
    paddingHorizontal: 20,
    backgroundColor: COLORS.green700,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: COLORS.white,
    letterSpacing: 0.5,
  },
  backBtn: {
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "flex-start",
  },
  container: {
    flex: 1,
    backgroundColor: COLORS.surface,
  },
  scrollContent: {
    paddingBottom: 40,
  },

  /* Avatar header — mirrors ProfileScreen's profileHeader */
  profileHeader: {
    backgroundColor: COLORS.white,
    alignItems: "center",
    paddingVertical: 30,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    marginBottom: 12,
  },
  avatarCircle: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: "#E8F5E9",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 15,
  },
  userName: {
    fontSize: 24,
    fontWeight: "700",
    color: "#333",
  },
  userEmail: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 4,
  },

  /* Card group — mirrors ProfileScreen's menuGroup */
  menuGroup: {
    backgroundColor: COLORS.white,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: COLORS.border,
    paddingTop: 10,
    marginBottom: 12,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.textSecondary,
    marginLeft: 16,
    marginBottom: 8,
    letterSpacing: 1,
  },

  /* Input row — styled like a menu item */
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: COLORS.white,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.border,
  },
  inputIcon: {
    marginRight: 15,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: "#333",
  },

  /* Menu items — mirrors ProfileScreen exactly */
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    backgroundColor: COLORS.white,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.border,
  },
  menuLeft: {
    flexDirection: "row",
    alignItems: "center",
  },
  menuText: {
    marginLeft: 15,
    fontSize: 16,
    color: "#333",
  },

  /* Primary action — green-filled variant of menu item */
  primaryAction: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    backgroundColor: COLORS.green700,
    borderBottomWidth: 0.5,
    borderBottomColor: "rgba(255,255,255,0.2)",
  },
  primaryActionText: {
    marginLeft: 15,
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.white,
  },
});
