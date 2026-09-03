import React, { useCallback, useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  StatusBar,
  Image,
} from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { User } from "@/components/MapComponent";
import { useOfflinePinStore, OfflinePin } from "../store/OfflinePinStore";
import NetInfo from "@react-native-community/netinfo";
import { usePinStore } from "../store/PinStore";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../../firebaseConfig";
import { COLORS } from "@/constants/Colors";
import { AppUser } from "@/components/MapComponent";

export default function ProfileScreen() {
  const params = useLocalSearchParams();
  const router = useRouter();

  const viewedUserId = params.userId as string | undefined;
  const isPublicView = Boolean(viewedUserId);

  const [user, setUser] = useState<AppUser | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loading, setLoading] = useState(true);

  const { offlinePins, removeOfflinePin } = useOfflinePinStore();
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  // Single source of truth for pulling a user's Firestore doc
  const fetchUserData = async (uid: string) => {
    try {
      const userDocRef = doc(db, "users", uid);
      const userDocSnap = await getDoc(userDocRef);

      if (userDocSnap.exists()) {
        const data = userDocSnap.data();
        setUser({
          uid,
          username: data.username || data.displayName || "Anonymous",
          email: data.email || "",
          pins_count: data.pins_count ?? 0,
          zones_count: data.zones_count ?? 0, // ← now actually fetched
        });
      } else {
        setUser(null);
      }
    } catch (e) {
      console.error("Failed to fetch user data:", e);
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  // Public profile: fetch by the passed userId, independent of auth state
  useFocusEffect(
    useCallback(() => {
      if (isPublicView && viewedUserId) {
        setLoading(true);
        fetchUserData(viewedUserId);
      }
    }, [isPublicView, viewedUserId]),
  );

  // Own profile: track live Firebase auth session
  useEffect(() => {
    if (isPublicView) return; // public profile view doesn't need auth state

    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setIsLoggedIn(!!firebaseUser);

      if (firebaseUser) {
        setLoading(true);
        fetchUserData(firebaseUser.uid);
      } else {
        setUser(null);
        setLoading(false);
      }
    });

    return unsubscribe;
  }, [isPublicView]);

  const handleLogout = async () => {
    Alert.alert("Logout", "Are you sure you want to logout?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Logout",
        style: "destructive",
        onPress: async () => {
          try {
            await signOut(auth);
            setUser(null);
            setIsLoggedIn(false);
            router.replace("/LoginPage");
          } catch (e) {
            console.error("Logout failed:", e);
            Alert.alert("Error", "Could not log out. Please try again.");
          }
        },
      },
    ]);
  };

  const handleUploadOfflinePin = async (pin: OfflinePin) => {
    const network = await NetInfo.fetch();
    if (!network.isConnected || !network.isInternetReachable) {
      Alert.alert("No Internet", "You need to be online to upload this pin.");
      return;
    }

    const currentUser = auth.currentUser;
    if (!currentUser) {
      Alert.alert("Not Logged In", "Please login before uploading pins.");
      return;
    }

    usePinStore.getState().setPendingPin({
      label: pin.label,
      lat: pin.lat,
      lng: pin.lng,
      image: pin.image,
      timestamp: pin.timestamp,
    });

    removeOfflinePin(pin.id);
    router.replace("/");
  };

  return (
    <View style={styles.mainWrapper}>
      <StatusBar barStyle="light-content" />

      <View style={styles.navBar}>
        <View style={styles.logoRow}>
          <View style={styles.logoIcon}>
            <Ionicons name="leaf" size={18} color="#fff" />
          </View>
          <Text style={styles.headerTitle}>EcoSentry</Text>
        </View>

        {!isLoggedIn && !isPublicView && (
          <TouchableOpacity
            onPress={() => router.push("/LoginPage")}
            style={styles.navActionBtn}
          >
            <Text style={styles.navActionText}>Login</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView style={styles.container}>
        <View style={styles.profileHeader}>
          <View style={styles.avatarCircle}>
            <Ionicons name="person" size={50} color={COLORS.green700} />
          </View>
          <Text style={styles.userName}>
            {loading ? "Loading..." : user?.username || "Guest User"}
          </Text>
          <Text style={styles.userEmail}>
            {user?.email ||
              (isPublicView ? "Public Profile" : "Login to sync data")}
          </Text>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{user?.pins_count ?? 0}</Text>
            <Text style={styles.statLabel}>Total Pins</Text>
          </View>

          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{user?.zones_count ?? 0}</Text>
            <Text style={styles.statLabel}>Total Zones</Text>
          </View>
        </View>

        {!isPublicView && offlinePins.length > 0 && (
          <View style={styles.offlineSection}>
            <Text style={styles.sectionLabel}>
              OFFLINE PINS ({offlinePins.length})
            </Text>
            {offlinePins.map((pin) => (
              <View key={pin.id} style={styles.offlineCard}>
                <Image
                  source={{ uri: pin.image || "https://picsum.photos/536/354" }}
                  style={styles.offlineImage}
                />
                <View style={styles.offlineInfo}>
                  <Text style={styles.offlineLabel}>🌿 {pin.label}</Text>
                  <Text style={styles.offlineMeta}>
                    {new Date(pin.timestamp).toLocaleDateString()} •{" "}
                    {pin.lat.toFixed(4)}, {pin.lng.toFixed(4)}
                  </Text>
                </View>
                <TouchableOpacity
                  style={[
                    styles.uploadBtn,
                    uploadingId === pin.id && styles.uploadBtnDisabled,
                  ]}
                  onPress={() => handleUploadOfflinePin(pin)}
                  disabled={uploadingId === pin.id}
                >
                  <Text style={styles.uploadBtnText}>
                    {uploadingId === pin.id ? "..." : "Upload"}
                  </Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {!isPublicView && offlinePins.length === 0 && isLoggedIn && (
          <View style={styles.offlineSection}>
            <Text style={styles.sectionLabel}>OFFLINE PINS</Text>
            <Text style={styles.emptyOffline}>No offline pins saved.</Text>
          </View>
        )}

        {isLoggedIn && !isPublicView && (
          <View style={styles.menuGroup}>
            <Text style={styles.sectionLabel}>ACCOUNT</Text>
            <TouchableOpacity style={styles.menuItem} onPress={handleLogout}>
              <View style={styles.menuLeft}>
                <Ionicons
                  name="log-out-outline"
                  size={22}
                  color={COLORS.pinRed}
                />
                <Text style={[styles.menuText, { color: COLORS.pinRed }]}>
                  Sign Out
                </Text>
              </View>
            </TouchableOpacity>
          </View>
        )}

        {isPublicView && (
          <Text style={styles.publicNote}>Viewing Public Profile</Text>
        )}
      </ScrollView>
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
    gap: 12,
    justifyContent: "space-between",
    alignItems: "center",
  },
  logoIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: COLORS.white,
    letterSpacing: 0.5,
  },
  navActionBtn: {
    backgroundColor: "rgba(255,255,255,0.2)",
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  navActionText: {
    color: COLORS.white,
    fontWeight: "600",
    fontSize: 14,
  },
  container: {
    flex: 1,
    backgroundColor: COLORS.surface,
  },
  profileHeader: {
    backgroundColor: COLORS.white,
    alignItems: "center",
    paddingVertical: 30,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
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
  statsRow: {
    flexDirection: "row",
    backgroundColor: COLORS.white,
    marginVertical: 12,
    paddingVertical: 15,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: COLORS.border,
  },
  statCard: {
    flex: 1,
    alignItems: "center",
  },
  borderLeft: {
    borderLeftWidth: 1,
    borderLeftColor: COLORS.border,
  },
  logoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  statNumber: {
    fontSize: 20,
    fontWeight: "bold",
    color: COLORS.green700,
  },
  statLabel: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
    textTransform: "uppercase",
  },
  menuGroup: {
    backgroundColor: COLORS.white,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: COLORS.border,
    paddingTop: 10,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.textSecondary,
    marginLeft: 16,
    marginBottom: 8,
    letterSpacing: 1,
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
  publicNote: {
    textAlign: "center",
    color: COLORS.textSecondary,
    marginTop: 20,
    fontSize: 13,
    fontStyle: "italic",
  },
  offlineSection: {
    backgroundColor: COLORS.white,
    marginVertical: 12,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: COLORS.border,
    paddingTop: 10,
    paddingBottom: 10,
  },
  offlineCard: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.border,
    gap: 10,
  },
  offlineImage: {
    width: 52,
    height: 52,
    borderRadius: 8,
    backgroundColor: COLORS.surface,
  },
  offlineInfo: {
    flex: 1,
    gap: 4,
  },
  offlineLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
  },
  offlineMeta: {
    fontSize: 11,
    color: COLORS.textSecondary,
  },
  uploadBtn: {
    backgroundColor: COLORS.green700,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  uploadBtnDisabled: {
    backgroundColor: "#aaa",
  },
  uploadBtnText: {
    color: COLORS.white,
    fontSize: 12,
    fontWeight: "700",
  },
  emptyOffline: {
    textAlign: "center",
    color: COLORS.textSecondary,
    paddingVertical: 16,
    fontSize: 13,
    fontStyle: "italic",
  },
});
