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
} from "react-native";
import { router } from "expo-router";
import { Stack } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import { auth, db } from "../firebaseConfig";

const COLORS = {
  green700: "#2E7D32",
  green500: "#4CAF50",
  pinRed: "#E53935",
  white: "#fff",
  surface: "#F5F5F5",
  textSecondary: "#757575",
  border: "rgba(0,0,0,0.08)",
};

export default function RegisterPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [isProfessional, setIsProfessional] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState("");

  const handleRegister = async () => {
    if (!username || !password || !confirmPassword || !email) {
      Alert.alert("Error", "Please fill in all fields");
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert("Error", "Passwords do not match");
      return;
    }

    try {
      // 1. Create User in Firebase Auth
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        email,
        password,
      );
      const user = userCredential.user;

      // 2. Save additional user details in Firestore
      await setDoc(doc(db, "users", user.uid), {
        uid: user.uid,
        username: username,
        email: email,
        createdAt: new Date().toISOString(),
        pins_count: 0,
        zones_count: 0,
        isProfessional: isProfessional, // ← new field
      });
      Alert.alert("Success", "Account created successfully!");

      // 3. Navigate away
      router.replace({
        pathname: "/",
        params: { userId: user.uid, username: username },
      });
    } catch (e: any) {
      // Firebase Auth Error Handling
      let errorMessage = "Registration failed";

      if (e.code === "auth/email-already-in-use") {
        errorMessage = "That email address is already in use!";
      } else if (e.code === "auth/invalid-email") {
        errorMessage = "That email address is invalid!";
      } else if (e.code === "auth/weak-password") {
        errorMessage = "Password should be at least 6 characters.";
      } else if (e.message) {
        errorMessage = e.message;
      }

      Alert.alert("Error", errorMessage);
    }
  };

  return (
    <View style={styles.mainWrapper}>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar barStyle="light-content" />

      {/* Navbar */}
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
        keyboardVerticalOffset={Platform.OS === "android" ? 40 : 0}
      >
        <ScrollView
          style={styles.container}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Avatar header */}
          <View style={styles.profileHeader}>
            <View style={styles.avatarCircle}>
              <Ionicons name="person-add" size={46} color={COLORS.green700} />
            </View>
            <Text style={styles.userName}>Create Account</Text>
            <Text style={styles.userEmail}>
              Enter your credentials to get started
            </Text>
          </View>

          {/* Credentials card */}
          <View style={styles.menuGroup}>
            <Text style={styles.sectionLabel}>CREDENTIALS</Text>

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

            <View style={styles.inputRow}>
              <Ionicons
                name="mail-outline"
                size={20}
                color={COLORS.textSecondary}
                style={styles.inputIcon}
              />
              <TextInput
                style={styles.input}
                placeholder="Email"
                placeholderTextColor={COLORS.textSecondary}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
              />
            </View>

            <View style={styles.inputRow}>
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

            <View style={[styles.inputRow, { borderBottomWidth: 0 }]}>
              <Ionicons
                name="shield-checkmark-outline"
                size={20}
                color={COLORS.textSecondary}
                style={styles.inputIcon}
              />
              <TextInput
                style={styles.input}
                placeholder="Confirm Password"
                placeholderTextColor={COLORS.textSecondary}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry
              />
            </View>

            {/* Professional checkbox — new */}
            <TouchableOpacity
              style={styles.checkboxRow}
              activeOpacity={0.7}
              onPress={() => setIsProfessional((prev) => !prev)}
            >
              <View
                style={[
                  styles.checkbox,
                  isProfessional && styles.checkboxChecked,
                ]}
              >
                {isProfessional && (
                  <Ionicons name="checkmark" size={14} color={COLORS.white} />
                )}
              </View>
              <Text style={styles.checkboxLabel}>I am a professional</Text>
            </TouchableOpacity>
          </View>

          {/* Action card */}
          <View style={styles.menuGroup}>
            <Text style={[styles.sectionLabel, { marginTop: 0 }]}>ACCOUNT</Text>

            <TouchableOpacity
              style={styles.primaryAction}
              onPress={handleRegister}
            >
              <View style={styles.menuLeft}>
                <Ionicons
                  name="person-add-outline"
                  size={22}
                  color={COLORS.white}
                />
                <Text style={styles.primaryActionText}>Create Account</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={COLORS.white} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => router.back()}
            >
              <View style={styles.menuLeft}>
                <Ionicons
                  name="log-in-outline"
                  size={22}
                  color={COLORS.green700}
                />
                <Text style={[styles.menuText, { color: COLORS.green700 }]}>
                  Already have an account? Login
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
  checkboxRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 10,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: COLORS.textSecondary,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.white,
  },
  checkboxChecked: {
    backgroundColor: COLORS.green700,
    borderColor: COLORS.green700,
  },
  checkboxLabel: {
    fontSize: 13,
    color: "#333",
    flex: 1, // wraps to a second line instead of overflowing on smaller screens
  },
});
