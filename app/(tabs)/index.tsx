import {
  StyleSheet,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useEffect, useState, useCallback, useRef } from "react";
import { useSharedValue } from "react-native-reanimated";
import { usePinStore } from "../store/PinStore";
import { Alert, StatusBar } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Location from "expo-location";
import { View } from "react-native";
import { Text } from "react-native";
import { useFocusEffect } from "expo-router";
import { useRouter } from "expo-router";
import { uploadToCloudinary } from "@/utils/uploadToCloudinary";
import { useLocalSearchParams } from "expo-router";
import BottomSheet, { BottomSheetView } from "@gorhom/bottom-sheet";
import { Ionicons } from "@expo/vector-icons";
import MapComponent, {
  SpeciesPin,
  User,
  MapComponentHandle,
  PinVerification,
} from "@/components/MapComponent";
import { Modal, ScrollView, Image } from "react-native";
import {
  User as FirebaseUser,
  onAuthStateChanged,
  signOut,
} from "firebase/auth";
import { auth, db } from "../../firebaseConfig";
import {
  collection,
  doc,
  getDoc,
  updateDoc,
  addDoc,
  setDoc,
  getDocs,
  serverTimestamp,
  query,
  orderBy,
  DocumentData,
  increment,
  arrayUnion,
} from "firebase/firestore";
import NetInfo from "@react-native-community/netinfo";
import { useOfflinePinStore } from "../store/OfflinePinStore";
import { COLORS } from "../../constants/Colors";

interface AppUser {
  id: string; // Firebase user.uid
  email: string | null;
  username?: string;
  pins_count?: number;
  zones_count?: number;
  isProfessional?: boolean; // ← n
}

export const ALL_SPECIES = [
  "Water Hyacinth",
  "Water Lettuce",
  "Siam Weed",
  "Lantana Camara",
];

export default function Index() {
  const router = useRouter();
  const { pendingPin, clearPendingPin } = usePinStore();
  const params = useLocalSearchParams();
  const [user, setUser] = useState<AppUser | null>(null);
  const [pins, setPins] = useState<SpeciesPin[]>([]);
  const [isImageFullscreen, setIsImageFullscreen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [userLocation, setUserLocation] = useState<{
    longitude: number;
    latitude: number;
  } | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [selectedSpecies, setSelectedSpecies] = useState("All");
  const [selectedStatus, setSelectedStatus] = useState("All");
  const [isMetricsOpen, setIsMetricsOpen] = useState(false);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [isToolsMenuOpen, setIsToolsMenuOpen] = useState(false);
  const [expandedSections, setExpandedSections] = useState<
    Record<string, boolean>
  >({});

  const toggleSection = (key: string) => {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const isPinVerified = (pin: any): boolean => {
    const verifications = pin.verifications ?? [];
    const lastVerification =
      verifications.length > 0 ? verifications[verifications.length - 1] : null;
    return Boolean(lastVerification?.verified);
  };

  const filteredPins = (() => {
    // Guard against invalid coordinates so Mapbox doesn't fail silently
    const validPins = pins.filter(
      (p) =>
        typeof p.latitude === "number" &&
        !isNaN(p.latitude) &&
        typeof p.longitude === "number" &&
        !isNaN(p.longitude),
    );

    if (selectedSpecies === "All") return validPins;

    if (selectedSpecies === "My Pins") {
      const currentUid = auth.currentUser?.uid;
      const currentEmail = auth.currentUser?.email;
      const currentUsername = user?.username;

      return validPins.filter((p) => {
        // 1. Primary Check: Firebase Auth UID
        if (currentUid && p.userId === currentUid) return true;
        if (currentUid && p.creator?.uid === currentUid) return true;

        // 2. Secondary Check: Username matching
        if (currentUsername && p.created_by === currentUsername) return true;
        if (currentUsername && p.creator?.username === currentUsername)
          return true;

        // 3. Fallback Check: Email matching
        if (currentEmail && p.created_by === currentEmail) return true;
        if (currentEmail && p.creator?.email === currentEmail) return true;

        return false;
      });
    }

    return validPins.filter(
      (p) => (p.specie_label || (p as any).label) === selectedSpecies,
    );
  })();

  const handleRecenter = async () => {
    try {
      await mapRef.current?.centerOnUser();
    } catch (e) {
      Alert.alert("Location error", "Could not get your current location.");
    }
  };

  const bottomSheetRef = useRef<BottomSheet>(null);
  const snapPoints = ["18%", "38%"];
  const mapRef = useRef<MapComponentHandle>(null);
  const fabScale = useSharedValue(1);

  const fetchPins = async () => {
    try {
      const pinsQuery = query(
        collection(db, "pins"),
        orderBy("createdAt", "desc"),
      );

      const querySnapshot = await getDocs(pinsQuery);

      const formattedPins: SpeciesPin[] = querySnapshot.docs.map((doc) => {
        const data: DocumentData = doc.data();

        const latitude: number =
          typeof data.latitude === "string"
            ? parseFloat(data.latitude)
            : Number(data.latitude) || 0;

        const longitude: number =
          typeof data.longitude === "string"
            ? parseFloat(data.longitude)
            : Number(data.longitude) || 0;

        const specie_label: string = String(
          data.specie_label || data.label || "",
        );
        const image_url: string = String(
          data.image_url || data.imageUrl || "https://picsum.photos/536/354",
        );
        const userId: string = String(data.userId || "");

        const createdAt: string = data.createdAt?.toDate
          ? data.createdAt.toDate().toISOString()
          : new Date().toISOString();

        // ✅ Preserve extra photos and creator info
        const images: string[] = Array.isArray(data.images) ? data.images : [];
        const creator = data.creator ?? null;
        const created_by: string = data.created_by
          ? String(data.created_by)
          : "";

        const verifications = Array.isArray(data.verifications)
          ? data.verifications
          : [];

        return {
          id: doc.id,
          latitude,
          longitude,
          specie_label,
          image_url,
          images,
          creator,
          created_by,
          userId,
          createdAt,
          verifications,
        } as unknown as SpeciesPin;
      });

      setPins(formattedPins);
    } catch (error) {
      console.error("Failed to load pins from Firestore:", error);
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(
      auth,
      async (firebaseUser: FirebaseUser | null) => {
        if (firebaseUser) {
          try {
            // Fetch additional profile data from Firestore
            const userDocRef = doc(db, "users", firebaseUser.uid);
            const userDoc = await getDoc(userDocRef);

            const userData = userDoc.exists() ? userDoc.data() : {};

            setUser({
              id: firebaseUser.uid,
              email: firebaseUser.email,
              username: userData.username || "",
              pins_count: userData.pins_count || 0,
              zones_count: userData.zones_count || 0,
              isProfessional: userData.isProfessional,
            });
            setIsLoggedIn(true);
            console.log("you are logged in as", firebaseUser.email);
          } catch (error) {
            console.error(
              "Error fetching user document from Firestore:",
              error,
            );
            // Fallback: Set user with basic Auth info if Firestore fails
            setUser({
              id: firebaseUser.uid,
              email: firebaseUser.email,
              username: "",
              pins_count: 0,
              zones_count: 0,
            });
            setIsLoggedIn(true);
          }
        } else {
          setUser(null);
          setIsLoggedIn(false);
        }

        // 👈 2. Mark initialization as finished after the first auth resolution
        if (initializing) {
          setInitializing(false);
        }
      },
    );

    return () => unsubscribe();
  }, []);

  // 👈 3. Prevent rendering or checking logged-out states while initializing

  useEffect(() => {
    fetchPins();
    const getInitialLocation = async () => {
      try {
        const loc = await Location.getCurrentPositionAsync({});
        setUserLocation({
          longitude: loc.coords.longitude,
          latitude: loc.coords.latitude,
        });
      } catch (e) {
        console.log("Initial location error", e);
      }
    };
    getInitialLocation();
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchPins();
    }, []),
  );

  useEffect(() => {
    if (!pendingPin) return;

    const autoPin: SpeciesPin = {
      id: Date.now(),
      latitude: pendingPin.lat,
      longitude: pendingPin.lng,
      specie_label: pendingPin.label,
      image_url: pendingPin.image || "https://picsum.photos/536/354",
      detections: pendingPin.detections, // ← new
    };

    handleAddPin(autoPin);
    clearPendingPin();
  }, [pendingPin]);

  const handleAddPin = async (newPin: SpeciesPin) => {
    if (!isLoggedIn) {
      Alert.alert("You are not logged in!", "Login first to add pins.", [
        { text: "Cancel", style: "cancel" },
        { text: "Login Here", onPress: () => router.push("/LoginPage") },
      ]);
      return;
    }
    // Open PinModal in create mode — user reviews label, image, coords before saving
    mapRef.current?.openCreatePin(newPin);
  };

  const performSave = async (newPin: SpeciesPin, mode: "view" | "create") => {
    console.log("5️⃣ performSave: started");
    const currentUser = auth.currentUser;

    if (!currentUser) {
      Alert.alert("Error", "Your session has expired. Please login again.");
      setIsLoggedIn(false);
      return;
    }

    setIsSaving(true); // ← start

    try {
      const network = await NetInfo.fetch();
      const isOnline = network.isConnected && network.isInternetReachable;

      if (!isOnline) {
        if (mode === "view") {
          Alert.alert(
            "You're offline",
            "Editing existing pins requires an internet connection. Please try again once you're back online.",
          );
          return;
        }

        useOfflinePinStore.getState().addOfflinePin({
          id: `offline-${Date.now()}`,
          label: newPin.specie_label,
          lat: parseFloat(newPin.latitude.toString()),
          lng: parseFloat(newPin.longitude.toString()),
          image: newPin.image_url,
          images: newPin.images ?? [],
          timestamp: Date.now(),
        });

        Alert.alert(
          "Saved offline",
          "You're offline — this pin was saved on your device and will upload automatically once you're back online.",
        );
        return;
      }

      // ── Online branch ──

      console.log("5b️⃣ Starting image upload check");

      let imageUrl = newPin.image_url;
      if (
        imageUrl &&
        !imageUrl.startsWith("http://") &&
        !imageUrl.startsWith("https://")
      ) {
        console.log("5c️⃣ Uploading thumbnail to Cloudinary...");
        imageUrl = await uploadToCloudinary(imageUrl);
        console.log("5d️⃣ Thumbnail upload done:", imageUrl);
      } else {
        console.log("5e️⃣ Thumbnail already a URL, skipping upload");
      }

      const currentImages = newPin.images ?? [];
      console.log(
        "5f️⃣ Uploading additional images, count:",
        currentImages.length,
      );
      const uploadPromises = currentImages.map(async (img) => {
        if (img.startsWith("http://") || img.startsWith("https://")) {
          return img;
        }
        return await uploadToCloudinary(img);
      });
      const uploadedImages: string[] = await Promise.all(uploadPromises);
      console.log("5g️⃣ Additional images done:", uploadedImages);

      const plainCreator = currentUser
        ? {
            uid: currentUser.uid,
            email: currentUser.email || "",
            username:
              user?.username ||
              currentUser.displayName ||
              currentUser.email ||
              "Anonymous User",
          }
        : null;

      const isExistingPin = mode === "view";
      if (isExistingPin) {
        const pinRef = doc(db, "pins", String(newPin.id));
        await updateDoc(pinRef, {
          specie_label: newPin.specie_label,
          image_url: imageUrl || "https://picsum.photos/536/354",
          images: uploadedImages,
        });
      } else {
        const initialVerification: PinVerification = {
          timestamp: Date.now(),
          verified: true,
          userId: currentUser.uid,
        };

        const pinPayload = {
          latitude: parseFloat(newPin.latitude.toString()),
          longitude: parseFloat(newPin.longitude.toString()),
          specie_label: newPin.specie_label,
          image_url: imageUrl || "https://picsum.photos/536/354",
          images: uploadedImages,
          detections: newPin.detections ?? {}, // ← new
          verifications: [initialVerification],
          userId: currentUser.uid,
          created_by:
            user?.username ||
            currentUser.displayName ||
            currentUser.email ||
            "Anonymous",
          creator: plainCreator,
          createdAt: serverTimestamp(),
        };

        console.log("5h️⃣ About to write to Firestore");
        const docRef = await addDoc(collection(db, "pins"), pinPayload);
        console.log("5i️⃣ Firestore write done:", docRef.id);

        const userRef = doc(db, "users", currentUser.uid);
        await setDoc(userRef, { pins_count: increment(1) }, { merge: true });
        console.log("5j️⃣ pins_count increment done");
      }

      setTimeout(() => {
        fetchPins();
      }, 0);

      Alert.alert(
        "Success",
        isExistingPin ? "Pin updated!" : "Pin successfully saved!",
      );
    } catch (error) {
      console.error("Error saving pin to Firestore:", error);
      Alert.alert("Save Failed", "Could not save your pin. Please try again.");
    } finally {
      console.log("6️⃣ performSave: finished (finally block)");
      setIsSaving(false);
    }
  };
  const handleVerifyPin = async (pinId: string, isVisible: boolean) => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      Alert.alert("Login required", "Please log in to verify this pin.");
      return;
    }

    const entry: PinVerification = {
      timestamp: Date.now(),
      verified: isVisible,
      userId: currentUser.uid,
      userName: user?.username || currentUser.email || "Anonymous", // ← new
    };

    try {
      console.log("Got the call! this is index ");
      const pinRef = doc(db, "pins", pinId);
      await updateDoc(pinRef, {
        verifications: arrayUnion(entry),
      });

      setPins((prev) =>
        prev.map((p) =>
          p.id === pinId
            ? { ...p, verifications: [...(p.verifications ?? []), entry] }
            : p,
        ),
      );
    } catch (e) {
      console.error("Verification failed:", e);
      Alert.alert("Error", "Could not save verification. Please try again.");
    } finally {
      console.log("Verification saved successfully!");
    }
  };

  const handleLogout = async () => {
    console.log("logging out");
    try {
      // 1. Sign out from Firebase Auth
      await signOut(auth);

      // 2. Clear local UI state
      setUser(null);
      setIsLoggedIn(false);

      if (selectedSpecies === "My Pins") {
        setSelectedSpecies("All");
      }

      Alert.alert("Logged Out", "You have been signed out successfully.");
    } catch (e) {
      console.error("Logout failed", e);
    }
  };

  // const initials = user?.username
  //   ? user.username.slice(0, 2).toUpperCase()
  //   : "GU";

  if (initializing) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" color="#0000ff" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.green700} />
      {/* ── Header ── */}
      <View style={styles.header}>
        <View style={styles.logoRow}>
          <View style={styles.logoIcon}>
            <Ionicons name="leaf" size={18} color="#fff" />
          </View>
          <Text style={styles.appName}>EcoSentry</Text>
        </View>

        <View style={styles.headerRight}>
          <TouchableOpacity
            onPress={
              isLoggedIn ? handleLogout : () => router.push("/LoginPage")
            }
            style={styles.authBtn}
            activeOpacity={0.75}
          >
            <Text style={styles.authBtnText}>
              {isLoggedIn ? "Logout" : "Login"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
      {/* ── Map ── */}
      <View style={styles.mapWrapper}>
        <MapComponent
          ref={mapRef}
          pins={pins}
          onPinAdded={handleAddPin}
          onSave={performSave}
          userLocation={userLocation}
          onLocationChange={(coords) => setUserLocation(coords)}
          selectedSpecies={selectedSpecies}
          onSpeciesChange={setSelectedSpecies}
          isLoggedIn={isLoggedIn}
          highlightPinId={params.highlightPinId as string | undefined}
          onVerify={handleVerifyPin}
          onStatusChange={setSelectedStatus}
          isSaving={isSaving} // ← new
        />

        {/* Persistent hamburger toggle — always visible */}
        <TouchableOpacity
          style={styles.hamburgerBtn}
          activeOpacity={0.8}
          onPress={() => setIsToolsMenuOpen((prev) => !prev)}
        >
          <Ionicons
            name={isToolsMenuOpen ? "close" : "menu"}
            size={20}
            color={COLORS.green700}
          />
        </TouchableOpacity>

        {/* Recenter stays outside the menu — high-frequency action, worth keeping always accessible */}
        <TouchableOpacity
          style={styles.recenterBtn}
          activeOpacity={0.8}
          onPress={handleRecenter}
        >
          <Ionicons name="navigate" size={18} color={COLORS.green700} />
        </TouchableOpacity>

        {/* Collapsible tools panel */}
        {isToolsMenuOpen && (
          <View style={styles.toolsMenu}>
            <TouchableOpacity
              style={styles.toolsMenuItem}
              activeOpacity={0.8}
              onPress={() => {
                router.push("/GalleryPage");
                setIsToolsMenuOpen(false);
              }}
            >
              <Ionicons
                name="images-outline"
                size={18}
                color={COLORS.green700}
              />
              <Text style={styles.toolsMenuLabel}>Gallery</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.toolsMenuItem}
              activeOpacity={0.8}
              onPress={() => {
                if (!user?.isProfessional) {
                  setIsToolsMenuOpen(false);
                  Alert.alert(
                    "Professional accounts only",
                    "Drawing zones is limited to verified professional accounts (botanists, ecologists, or field researchers).",
                  );
                  return;
                }
                mapRef.current?.startDrawingZone();
                setIsToolsMenuOpen(false);
              }}
            >
              <Ionicons name="pencil-sharp" size={18} color={COLORS.green700} />
              <Text style={styles.toolsMenuLabel}>Draw Zone</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.toolsMenuItem}
              activeOpacity={0.8}
              onPress={() => {
                bottomSheetRef.current?.expand();
                setIsToolsMenuOpen(false);
              }}
            >
              <Ionicons
                name="bar-chart-outline"
                size={18}
                color={COLORS.green700}
              />
              <Text style={styles.toolsMenuLabel}>Stats</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.toolsMenuItem}
              activeOpacity={0.8}
              onPress={() => {
                setIsMetricsOpen(true);
                setIsToolsMenuOpen(false);
              }}
            >
              <Ionicons
                name="analytics-outline"
                size={18}
                color={COLORS.green700}
              />
              <Text style={styles.toolsMenuLabel}>Metrics</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.toolsMenuItem}
              activeOpacity={0.8}
              onPress={() => {
                setIsGuideOpen(true);
                setIsToolsMenuOpen(false);
              }}
            >
              <Ionicons
                name="help-circle-outline"
                size={18}
                color={COLORS.green700}
              />
              <Text style={styles.toolsMenuLabel}>Guide</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
      {/* ── Bottom Sheet ── */}
      <BottomSheet
        ref={bottomSheetRef}
        index={-1}
        snapPoints={snapPoints}
        enablePanDownToClose={true}
        handleIndicatorStyle={styles.sheetHandle}
        backgroundStyle={styles.sheetBg}
      >
        <BottomSheetView style={styles.sheetContent}>
          <Text style={styles.sheetTitle}>
            {selectedSpecies === "All"
              ? "All invasive plants"
              : selectedSpecies}
          </Text>

          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <Text style={styles.statNum}>{filteredPins.length}</Text>
              <Text style={styles.statLabel}>
                {selectedSpecies === "All" ? "Total pins" : "Matching pins"}
              </Text>
            </View>

            <View style={styles.statCard}>
              <Text style={styles.statNum}>
                {filteredPins.filter((p: any) => p.userId === user?.id).length}
              </Text>
              <Text style={styles.statLabel}>My pins</Text>
            </View>

            <View style={styles.statCard}>
              <Text style={styles.statNum}>
                {selectedStatus === "All"
                  ? filteredPins.length
                  : filteredPins.filter((p: any) => isPinVerified(p))
                      .length}{" "}
              </Text>
              <Text style={styles.statLabel}>
                {" "}
                {selectedStatus === "All"
                  ? "All"
                  : selectedStatus == "Confirmed"
                    ? "Confirmed"
                    : "Missing"}{" "}
              </Text>
            </View>
          </View>
        </BottomSheetView>
      </BottomSheet>
      {/* ── Metrics Modal ── */}
      <Modal
        visible={isMetricsOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setIsMetricsOpen(false)}
      >
        <SafeAreaView style={styles.modalSafe}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Model Performance</Text>
            <TouchableOpacity
              onPress={() => setIsMetricsOpen(false)}
              style={styles.modalClose}
            >
              <Ionicons name="close" size={22} color={COLORS.green700} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.modalScroll}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.metricSection}>
              <TouchableOpacity
                style={styles.metricSectionHeader}
                activeOpacity={0.7}
                onPress={() => toggleSection("trainingMetricsAll")}
              >
                <Text style={styles.metricSectionTitle}>
                  Training Metrics (All)
                </Text>
                <Ionicons
                  name={
                    expandedSections.trainingMetricsAll
                      ? "chevron-up"
                      : "chevron-down"
                  }
                  size={18}
                  color={COLORS.green700}
                />
              </TouchableOpacity>
              {expandedSections.trainingMetricsAll && (
                <>
                  <Text style={styles.metricDescription}>
                    The model was trained for 150 epochs. Losses all converge
                    cleanly, box, class, and dfl losses drop sharply in the
                    first 20 epochs and plateau smoothly. Validation losses
                    mirror training losses with no divergence, meaning no
                    overfitting. The model achieved a
                    <Text style={styles.highlight}> precision</Text> score of{" "}
                    <Text style={styles.highlight}>83.04% </Text>which indicates
                    that most of the detected invasive plants were correctly
                    identified by the system. Additionally, The model obtained a
                    <Text style={styles.highlight}> recall</Text> score of{" "}
                    <Text style={styles.highlight}>79.22%</Text>, showing that
                    it was able to successfully detect the majority of invasive
                    plants present in the images.
                  </Text>
                  <Text style={styles.metricDescription}>
                    The model demonstrated good overall detection performance
                    across the four invasive plant species based on its mAP50
                    and mAP50-95 scores. The{" "}
                    <Text style={styles.highlight}>mAP50</Text> score of{" "}
                    <Text style={styles.highlight}>86.44%</Text> indicates that
                    the model was generally effective at detecting and
                    localizing the target invasive plants at a 50% IoU
                    threshold. Meanwhile, the
                    <Text style={styles.highlight}> mAP50-95</Text> score of{" "}
                    <Text style={styles.highlight}>61.85%</Text>, indicates that
                    localization performance decreased under stricter IoU
                    thresholds, suggesting that some predicted bounding boxes
                    were less precisely aligned with the actual plant
                    boundaries.
                  </Text>
                  <Image
                    source={require("../../assets/images/metrics_whole.png")}
                    style={styles.metricImage}
                    resizeMode="contain"
                  />
                </>
              )}
            </View>

            <View style={styles.metricSection}>
              <TouchableOpacity
                style={styles.metricSectionHeader}
                activeOpacity={0.7}
                onPress={() => toggleSection("confusionMatrixAll")}
              >
                <Text style={styles.metricSectionTitle}>
                  Confusion Matrix (All)
                </Text>
                <Ionicons
                  name={
                    expandedSections.confusionMatrixAll
                      ? "chevron-up"
                      : "chevron-down"
                  }
                  size={18}
                  color={COLORS.green700}
                />
              </TouchableOpacity>

              {expandedSections.confusionMatrixAll && (
                <>
                  <Text style={styles.metricDescription}>
                    The model covers four invasive species:{" "}
                    <Text style={styles.highlight}>West Indian Lantana</Text>,{" "}
                    <Text style={styles.highlight}>Water Lettuce</Text>,{" "}
                    <Text style={styles.highlight}>Siam weed</Text>, and{" "}
                    <Text style={styles.highlight}>Water Hyacinth</Text>. The
                    confusion matrix shows that several background regions were
                    incorrectly predicted as invasive plants, particularly{" "}
                    <Text style={styles.highlight}>West Indian Lantana</Text>{" "}
                    and <Text style={styles.highlight}>Water Lettuce.</Text>{" "}
                    This indicates that the model occasionally interprets
                    non-target vegetation, shadows, or environmental textures as
                    invasive species, resulting in false positive detections.{" "}
                    <Text style={styles.highlight}>Water Lettuce</Text>
                    is the strongest performer with{" "}
                    <Text style={styles.highlight}>249</Text> true positives and
                    minimal inter-class confusion.{" "}
                    <Text style={styles.highlight}>West Indian Lantana </Text>
                    scores <Text style={styles.highlight}>131</Text>,{" "}
                    <Text style={styles.highlight}>Siamweed 114</Text>, and{" "}
                    <Text style={styles.highlight}>Water Hyacinth 95</Text> true
                    positives respectively. Despite this, the relatively strong
                    diagonal values for the plant classes demonstrate that the
                    model still maintains good overall classification
                    capability, though additional dataset balancing and
                    background diversity might help reduce these errors further.
                  </Text>
                  <Text style={styles.metricDescription}>
                    Critically, the classes{" "}
                    <Text style={styles.highlight}>
                      barely bleed into each other
                    </Text>{" "}
                    — only 1 Siamweed was ever predicted as West Indian Lantana
                    — meaning the model has learned visually distinct features
                    per species. Inter-class confusion is not a concern.
                  </Text>
                  <Text style={styles.metricDescription}>
                    The dominant failure mode is{" "}
                    <Text style={styles.highlight}>background confusion</Text>.
                    had{" "}
                    <Text style={styles.highlight}>West Indian Lantana 73</Text>{" "}
                    false positives from background and{" "}
                    <Text style={styles.highlight}>34</Text> true instances lost
                    to background.{" "}
                    <Text style={styles.highlight}>Siam weed</Text> had{" "}
                    <Text style={styles.highlight}>54</Text> background false
                    positives and <Text style={styles.highlight}>10</Text>{" "}
                    missed. <Text style={styles.highlight}>Water Hyacinth</Text>{" "}
                    was the cleanest with only{" "}
                    <Text style={styles.highlight}>10</Text> background false
                    positives.
                  </Text>
                  <Image
                    source={require("../../assets/images/cm_whole.png")}
                    style={styles.metricImage}
                    resizeMode="contain"
                  />
                </>
              )}
            </View>
            {/* Training Metrics */}
            <View style={styles.metricSection}>
              <TouchableOpacity
                style={styles.metricSectionHeader}
                activeOpacity={0.7}
                onPress={() => toggleSection("trainingMetricsLand")}
              >
                <Text style={styles.metricSectionTitle}>
                  Training Metrics (Land)
                </Text>
                <Ionicons
                  name={
                    expandedSections.trainingMetricsLand
                      ? "chevron-up"
                      : "chevron-down"
                  }
                  size={18}
                  color={COLORS.green700}
                />
              </TouchableOpacity>

              {expandedSections.trainingMetricsLand && (
                <>
                  <Text style={styles.metricDescription}>
                    The model was trained for 150 epochs. The performance
                    metrics and loss values demonstrate how effectively the
                    model detects two land-based invasive species,{" "}
                    <Text style={styles.highlight}>Siam weed</Text> and{" "}
                    <Text style={styles.highlight}>West Indian Lantana</Text>{" "}
                    Overall, the results suggest that the model demonstrates
                    moderate to good detection capability. However, some
                    limitations remain in terms of localization precision and
                    detection consistency. The model achieved a{" "}
                    <Text style={styles.highlight}>precision</Text> score of{" "}
                    <Text style={styles.highlight}>78.07%</Text>, indicating
                    that most predicted invasive plant detections were correct.
                    In the context of land-based invasive plant detection, this
                    suggests that the model is generally reliable when
                    identifying target species in field images. However, some
                    non-target vegetation or background objects might still
                    occasionally be mistaken for invasive plants due to
                    similarities in leaf structure, color, or environmental
                    conditions. The <Text style={styles.highlight}>recall</Text>{" "}
                    score of <Text style={styles.highlight}>69.98%</Text>{" "}
                    indicates that the model successfully detected approximately
                    70% of the actual invasive plants present in the dataset.
                    Compared to precision, the lower recall value suggests that
                    the model misses a noticeable portion of invasive plants
                    during prediction. These missed detections might occur
                    because of plant occlusion, varying plant sizes, dense
                    vegetation, or challenging image backgrounds.
                  </Text>
                  <Text style={styles.metricDescription}>
                    The model demonstrated moderate to good overall detection
                    performance for the two land-based invasive plant species
                    based on its mAP50 and mAP50-95 scores. The{" "}
                    <Text style={styles.highlight}>mAP50</Text> score of{" "}
                    <Text style={styles.highlight}>81.49%</Text>
                    indicates that the model was generally effective at
                    detecting and localizing the target species at a 50% IoU
                    threshold. However, the{" "}
                    <Text style={styles.highlight}>mAP50-95</Text> score of{" "}
                    <Text style={styles.highlight}>52.86%</Text> indicates a
                    greater decrease in localization performance under stricter
                    IoU thresholds, suggesting that some predicted bounding
                    boxes were not precisely aligned with the actual plant
                    boundaries.
                  </Text>
                  <Image
                    source={require("../../assets/images/metrics_land.png")}
                    style={styles.metricImage}
                    resizeMode="contain"
                  />
                </>
              )}
            </View>

            {/* Confusion Matrix */}
            <View style={styles.metricSection}>
              <TouchableOpacity
                style={styles.metricSectionHeader}
                activeOpacity={0.7}
                onPress={() => toggleSection("confusionMatrixLand")}
              >
                <Text style={styles.metricSectionTitle}>
                  Confusion Matrix (Land)
                </Text>
                <Ionicons
                  name={
                    expandedSections.confusionMatrixLand
                      ? "chevron-up"
                      : "chevron-down"
                  }
                  size={18}
                  color={COLORS.green700}
                />
              </TouchableOpacity>

              {expandedSections.confusionMatrixLand && (
                <>
                  <Text style={styles.metricDescription}>
                    The model distinguishes between{" "}
                    <Text style={styles.highlight}>West Indian Lantana</Text>{" "}
                    and <Text style={styles.highlight}>Siam Weed</Text> with
                    high accuracy.{" "}
                    <Text style={styles.highlight}>West Indian Lantana</Text>{" "}
                    scores <Text style={styles.highlight}>129</Text> true
                    positives with only
                    <Text style={styles.highlight}> 57 </Text>
                    misclassified as background, while{" "}
                    <Text style={styles.highlight}>Siam Weed</Text> scores{" "}
                    <Text style={styles.highlight}>105</Text> true positives
                    with <Text style={styles.highlight}>37</Text> missed.
                  </Text>
                  <Text style={styles.metricDescription}>
                    The main weakness is{" "}
                    <Text style={styles.highlight}>background confusion</Text> —
                    <Text style={styles.highlight}>57</Text> background
                    instances were predicted as{" "}
                    <Text style={styles.highlight}>West Indian Lantana</Text>{" "}
                    and
                    <Text style={styles.highlight}> 37</Text> as{" "}
                    <Text style={styles.highlight}>Siam Weed</Text>. Overall,
                    the matrix indicates that the model performs well in
                    distinguishing between West Indian Lantana and Siam Weed, as
                    most samples were correctly classified into their respective
                    classes. The strong diagonal values for both invasive plant
                    classes demonstrate that the model generally maintains good
                    classification capability and is able to effectively
                    distinguish between the two land-based invasive plant
                    species under most conditions. However, several
                    background-related false positives and missed detections are
                    still present, indicating that the model occasionally
                    struggles to differentiate invasive plants from surrounding
                    vegetation and environmental textures.
                  </Text>
                  <Image
                    source={require("../../assets/images/cm_land.png")}
                    style={styles.metricImage}
                    resizeMode="contain"
                  />
                </>
              )}
            </View>

            <View style={styles.metricSection}>
              <TouchableOpacity
                style={styles.metricSectionHeader}
                activeOpacity={0.7}
                onPress={() => toggleSection("trainingMetricsWater")}
              >
                <Text style={styles.metricSectionTitle}>
                  Training Metrics (Water)
                </Text>
                <Ionicons
                  name={
                    expandedSections.trainingMetricsWater
                      ? "chevron-up"
                      : "chevron-down"
                  }
                  size={18}
                  color={COLORS.green700}
                />
              </TouchableOpacity>
              {expandedSections.trainingMetricsWater && (
                <>
                  <Text style={styles.metricDescription}>
                    Trained for ~200 epochs on two aquatic species:{" "}
                    <Text style={styles.highlight}>Water Lettuce</Text> and{" "}
                    <Text style={styles.highlight}>Water Hyacinth</Text>. All
                    loss curves converge smoothly with no divergence between
                    training and validation, confirming{" "}
                    <Text style={styles.highlight}>no overfitting</Text>. Since
                    the model was trained on two aquatic species, the evaluation
                    reflects how effectively the system distinguishes the target
                    plants from surrounding water surfaces, aquatic vegetation,
                    and environmental backgrounds. Overall, the results
                    demonstrate strong detection capability and effective
                    classification performance. However, the lower mAP50-95
                    score and higher validation losses indicate that the model
                    experiences some difficulty in maintaining precise
                    localization on unseen data.
                  </Text>
                  <Text style={styles.metricDescription}>
                    The model achieved a{" "}
                    <Text style={styles.highlight}>precision</Text> score of{" "}
                    <Text style={styles.highlight}>84.67%</Text>, indicating
                    that the majority of predicted invasive plant detections
                    were correct. This suggests that the model is generally
                    reliable when identifying the two water-based invasive plant
                    species within images. The precision value also indicates
                    that the system learned effective visual representations of
                    the aquatic plants and could distinguish them from
                    non-target objects and background regions, although some
                    incorrect detections were still present.
                  </Text>
                  <Text style={styles.metricDescription}>
                    The <Text style={styles.highlight}>recall</Text> score of{" "}
                    <Text style={styles.highlight}>87.55%</Text> indicates that
                    the model successfully detected a large majority of the
                    actual invasive plant instances present in the dataset. The
                    high recall value demonstrates that the model was effective
                    at locating the target aquatic plants during detection. This
                    suggests that the system was able to identify the target
                    species under varying environmental conditions such as water
                    reflections, overlapping vegetation, and clustered plant
                    formations.
                  </Text>
                  <Image
                    source={require("../../assets/images/metrics_water.png")}
                    style={styles.metricImage}
                    resizeMode="contain"
                  />
                </>
              )}
            </View>

            <View style={styles.metricSection}>
              <TouchableOpacity
                style={styles.metricSectionHeader}
                activeOpacity={0.7}
                onPress={() => toggleSection("confusionMatrixWater")}
              >
                <Text style={styles.metricSectionTitle}>
                  Confusion Matrix (Water)
                </Text>
                <Ionicons
                  name={
                    expandedSections.confusionMatrixWater
                      ? "chevron-up"
                      : "chevron-down"
                  }
                  size={18}
                  color={COLORS.green700}
                />
              </TouchableOpacity>
              {expandedSections.confusionMatrixWater && (
                <>
                  <Text style={styles.metricDescription}>
                    <Text style={styles.highlight}>Water Lettuce</Text>{" "}
                    dominates with 245 true positives and zero inter-class
                    confusion with Water Hyacinth.
                    <Text style={styles.highlight}>Water Hyacinth</Text> scores
                    <Text style={styles.highlight}>98</Text> true positives with
                    only <Text style={styles.highlight}>11</Text> instances lost
                    to background.
                  </Text>
                  <Text style={styles.metricDescription}>
                    As with the land model,{" "}
                    <Text style={styles.highlight}>background confusion</Text>{" "}
                    is the only notable weakness.{" "}
                    <Text style={styles.highlight}>74</Text>{" "}
                    <Text style={styles.highlight}>Water Lettuce</Text>{" "}
                    instances were{" "}
                    <Text style={styles.highlight}>misclassified</Text> as{" "}
                    <Text style={styles.highlight}>background</Text>, and{" "}
                    <Text style={styles.highlight}>65 background regions </Text>
                    were <Text style={styles.highlight}>
                      falsely predicted
                    </Text>{" "}
                    as <Text style={styles.highlight}>Water Lettuce</Text>.
                    Overall, the confusion matrix demonstrates strong
                    classification performance, as the majority of the plant
                    instances were correctly identified with relatively few
                    missed detections and minimal confusion between the two
                    target species. The high number of correct predictions for
                    both Water Lettuce and Water Hyacinth demonstrates strong
                    recognition capability and reliable classification accuracy.
                    Although some background regions were incorrectly identified
                    as invasive plants, particularly for Water Lettuce, the
                    model still exhibits good generalization capability and
                    practical usefulness for automated aquatic invasive plant
                    monitoring and detection applications.
                  </Text>
                  <Image
                    source={require("../../assets/images/cm_water.png")}
                    style={styles.metricImage}
                    resizeMode="contain"
                  />
                </>
              )}
            </View>

            <View style={styles.metricSection}>
              <TouchableOpacity
                style={styles.metricSectionHeader}
                activeOpacity={0.7}
                onPress={() => toggleSection("trainingMetricsSiam")}
              >
                <Text style={styles.metricSectionTitle}>
                  Training Metrics (Siam weed)
                </Text>
                <Ionicons
                  name={
                    expandedSections.trainingMetricsSiam
                      ? "chevron-up"
                      : "chevron-down"
                  }
                  size={18}
                  color={COLORS.green700}
                />
              </TouchableOpacity>
              {expandedSections.trainingMetricsSiam && (
                <>
                  <Text style={styles.metricDescription}>
                    The model demonstrated good overall detection performance
                    for <Text style={styles.highlight}>Siam Weed</Text> based on
                    its <Text style={styles.highlight}>mAP50</Text> and{" "}
                    <Text style={styles.highlight}>mAP50-95</Text> scores. The
                    <Text style={styles.highlight}> mAP50</Text> score of{" "}
                    <Text style={styles.highlight}>85.98%</Text> indicates that
                    the model effectively detected and localized{" "}
                    <Text style={styles.highlight}>Siam Weed</Text> at a{" "}
                    <Text style={styles.highlight}>50% IoU threshold</Text>. The
                    <Text style={styles.highlight}>mAP50-95</Text> score of{" "}
                    <Text style={styles.highlight}>60.54%</Text>, however,
                    indicates that localization performance decreased under
                    stricter IoU thresholds, suggesting that some predicted
                    bounding boxes were not perfectly aligned with the exact
                    boundaries of the plant.
                  </Text>
                  <Text style={styles.metricDescription}>
                    The model achieved a{" "}
                    <Text style={styles.highlight}>precision</Text> score of{" "}
                    <Text style={styles.highlight}>78.99%</Text>, indicating
                    that most predicted{" "}
                    <Text style={styles.highlight}>Siam weed</Text> detections
                    were correct. This suggests that the model is generally
                    reliable when identifying{" "}
                    <Text style={styles.highlight}>Siam weed</Text> in images.
                    However, some background vegetation or non-target plants
                    might still occasionally be classified as{" "}
                    <Text style={styles.highlight}>Siam weed</Text> because of
                    similarities in texture, leaf patterns, or environmental
                    appearance.
                  </Text>
                  <Text style={styles.metricDescription}>
                    The <Text style={styles.highlight}>recall</Text> score of{" "}
                    <Text style={styles.highlight}>85.48%</Text> indicates that
                    the model successfully detected the majority of actual{" "}
                    <Text style={styles.highlight}>Siam weed</Text>
                    instances present in the dataset. The relatively high recall
                    value suggests that the model rarely misses{" "}
                    <Text style={styles.highlight}>Siam weed</Text> during
                    detection and performs effectively in locating the target
                    species within images. This indicates strong detection
                    sensitivity even under varying environmental conditions such
                    as dense vegetation, overlapping plants, or inconsistent
                    lighting.
                  </Text>
                  <Image
                    source={require("../../assets/images/metrics_siam.png")}
                    style={styles.metricImage}
                    resizeMode="contain"
                  />
                </>
              )}
            </View>

            <View style={styles.metricSection}>
              <TouchableOpacity
                style={styles.metricSectionHeader}
                activeOpacity={0.7}
                onPress={() => toggleSection("confusionMatrixSiam")}
              >
                <Text style={styles.metricSectionTitle}>
                  Confusion Matrix (Siam weed)
                </Text>
                <Ionicons
                  name={
                    expandedSections.confusionMatrixSiam
                      ? "chevron-up"
                      : "chevron-down"
                  }
                  size={18}
                  color={COLORS.green700}
                />
              </TouchableOpacity>
              {expandedSections.confusionMatrixSiam && (
                <>
                  <Text style={styles.metricDescription}>
                    Overall, the confusion matrix demonstrates good detection
                    performance, with the model correctly identifying most
                    <Text style={styles.highlight}> Siam weed</Text> instances
                    while producing relatively few missed detections. The high
                    number of correct detections combined with the relatively
                    low number of missed samples demonstrates reliable recall
                    performance and good localization capability. However, the
                    presence of several background-related false positive
                    detections suggests that further improvements in background
                    discrimination might still enhance the model’s precision.
                    Additional background diversity, image augmentation, or
                    refinement of training data might help reduce these errors
                    and further improve overall detection performance.{" "}
                  </Text>
                  <Text style={styles.metricDescription}>
                    The model successfully detected
                    <Text style={styles.highlight}> Siam weed</Text>{" "}
                    <Text style={styles.highlight}>117 </Text>
                    instances while{" "}
                    <Text style={styles.highlight}>misclassifying</Text> it as
                    background in <Text style={styles.highlight}>69 </Text>
                    instances. The model also lost{" "}
                    <Text style={styles.highlight}>7</Text>{" "}
                    <Text style={styles.highlight}> Siam weed</Text> instances
                    to the
                    <Text style={styles.highlight}> background</Text>.
                  </Text>

                  <Image
                    source={require("../../assets/images/cm_siam.png")}
                    style={styles.metricImage}
                    resizeMode="contain"
                  />
                </>
              )}
            </View>

            <View style={styles.metricSection}>
              <TouchableOpacity
                style={styles.metricSectionHeader}
                activeOpacity={0.7}
                onPress={() => toggleSection("trainingMetricsLantana")}
              >
                <Text style={styles.metricSectionTitle}>
                  Training Metrics (West Indian Lantana){" "}
                </Text>
                <Ionicons
                  name={
                    expandedSections.trainingMetricsLantana
                      ? "chevron-up"
                      : "chevron-down"
                  }
                  size={18}
                  color={COLORS.green700}
                />
              </TouchableOpacity>
              {expandedSections.trainingMetricsLantana && (
                <>
                  <Text style={styles.metricDescription}>
                    The model demonstrated moderate detection performance for
                    <Text style={styles.highlight}>
                      West Indian Lantana
                    </Text>{" "}
                    based on its <Text style={styles.highlight}>mAP50</Text> and{" "}
                    <Text style={styles.highlight}>mAP50-95</Text> scores. The{" "}
                    <Text style={styles.highlight}>mAP50</Text> score of{" "}
                    <Text style={styles.highlight}>78.29%</Text> indicates that
                    the model was generally capable of detecting and localizing
                    the target species at a{" "}
                    <Text style={styles.highlight}>50% IoU threshold</Text>.
                    However, the <Text style={styles.highlight}>mAP50-95</Text>{" "}
                    score of <Text style={styles.highlight}>42.46%</Text>{" "}
                    indicates a considerable decrease in localization
                    performance under stricter IoU thresholds, suggesting that
                    the predicted bounding boxes were less precisely aligned
                    with the actual plant boundaries.
                  </Text>
                  <Text style={styles.metricDescription}>
                    The model achieved a{" "}
                    <Text style={styles.highlight}>precision</Text> score of{" "}
                    <Text style={styles.highlight}>75.53%</Text>, indicating
                    that most predicted{" "}
                    <Text style={styles.highlight}>West Indian Lantana</Text>{" "}
                    detections were correct. This suggests that the model is
                    reasonably reliable when identifying{" "}
                    <Text style={styles.highlight}>West Indian Lantana</Text> in
                    images.{" "}
                    <Text style={styles.highlight}>
                      However, some background vegetation or non-target plants
                      might still be incorrectly identified as West Indian
                      Lantana
                    </Text>{" "}
                    because of similarities in leaf texture, plant structure, or
                    environmental appearance.
                  </Text>

                  <Image
                    source={require("../../assets/images/metrics_lantana.png")}
                    style={styles.metricImage}
                    resizeMode="contain"
                  />
                </>
              )}
            </View>

            <View style={styles.metricSection}>
              <TouchableOpacity
                style={styles.metricSectionHeader}
                activeOpacity={0.7}
                onPress={() => toggleSection("confusionMatrixLantana")}
              >
                <Text style={styles.metricSectionTitle}>
                  Confusion Matrix (West Indian Lantana){" "}
                </Text>
                <Ionicons
                  name={
                    expandedSections.confusionMatrixLantana
                      ? "chevron-up"
                      : "chevron-down"
                  }
                  size={18}
                  color={COLORS.green700}
                />
              </TouchableOpacity>
              {expandedSections.confusionMatrixLantana && (
                <>
                  <Text style={styles.metricDescription}>
                    Overall, the confusion matrix indicates moderate detection
                    performance, with the model correctly identifying many{" "}
                    <Text style={styles.highlight}>West Indian Lantana</Text>{" "}
                    instances but still producing a considerable number of false
                    positive detections. While the model correctly classified a
                    substantial number of plant instances, the relatively high
                    number of false positive detections and missed samples
                    indicates that further improvements are needed. Additional
                    training data, better background diversity, image
                    augmentation techniques, or longer training duration might
                    help improve the model’s discrimination capability and
                    reduce background-related classification errors.
                  </Text>
                  <Text style={styles.metricDescription}>
                    The model successfully detected
                    <Text style={styles.highlight}>
                      {" "}
                      West Indian Lantana
                    </Text>{" "}
                    <Text style={styles.highlight}>139 </Text>
                    instances while{" "}
                    <Text style={styles.highlight}>misclassifying</Text> it as
                    background in <Text style={styles.highlight}>116 </Text>
                    instances. The model also lost{" "}
                    <Text style={styles.highlight}>27</Text>{" "}
                    <Text style={styles.highlight}> West Indian Lantana</Text>{" "}
                    instances to the
                    <Text style={styles.highlight}> background</Text>.{" "}
                    <Text style={styles.highlight}>West Indian Lantana</Text> by
                    far is the hardest plant the model has to detect.
                  </Text>

                  <Image
                    source={require("../../assets/images/cm_lantana.png")}
                    style={styles.metricImage}
                    resizeMode="contain"
                  />
                </>
              )}
            </View>

            <View style={styles.metricSection}>
              <TouchableOpacity
                style={styles.metricSectionHeader}
                activeOpacity={0.7}
                onPress={() => toggleSection("trainingMetricsWaterHya")}
              >
                <Text style={styles.metricSectionTitle}>
                  Training Metrics (Water Hyacinth){" "}
                </Text>
                <Ionicons
                  name={
                    expandedSections.trainingMetricsWaterHya
                      ? "chevron-up"
                      : "chevron-down"
                  }
                  size={18}
                  color={COLORS.green700}
                />
              </TouchableOpacity>
              {expandedSections.trainingMetricsWaterHya && (
                <>
                  <Text style={styles.metricDescription}>
                    The model demonstrated strong overall detection performance
                    for <Text style={styles.highlight}>Water Hyacinth</Text>{" "}
                    based on its mAP50 and mAP50-95 scores. The{" "}
                    <Text style={styles.highlight}>mAP50</Text> score of{" "}
                    <Text style={styles.highlight}>90.31%</Text> indicates
                    exceptionally strong object detection performance at a 50%
                    IoU threshold. The
                    <Text style={styles.highlight}>mAP50-95</Text> score of{" "}
                    <Text style={styles.highlight}>66.92%</Text> indicates that
                    the model maintained good localization performance under
                    stricter IoU thresholds, although the lower score compared
                    with mAP50 shows that localization became more difficult as
                    the evaluation criteria became more stringent.
                  </Text>
                  <Text style={styles.metricDescription}>
                    The model achieved a{" "}
                    <Text style={styles.highlight}>precision</Text> score of{" "}
                    <Text style={styles.highlight}>94.90%</Text>, indicating
                    that nearly all predicted{" "}
                    <Text style={styles.highlight}>water hyacinth</Text>{" "}
                    detections were correct. This suggests that the system is
                    highly reliable when identifying{" "}
                    <Text style={styles.highlight}>water hyacinth</Text> within
                    images. The high precision value also indicates that the
                    visual characteristics of{" "}
                    <Text style={styles.highlight}>water hyacinth</Text> were
                    learned effectively, allowing the model to distinguish the
                    species from non-target aquatic vegetation and background
                    elements with minimal confusion.
                  </Text>

                  <Image
                    source={require("../../assets/images/metrics_waterhya.png")}
                    style={styles.metricImage}
                    resizeMode="contain"
                  />
                </>
              )}
            </View>

            <View style={styles.metricSection}>
              <TouchableOpacity
                style={styles.metricSectionHeader}
                activeOpacity={0.7}
                onPress={() => toggleSection("confusionMatrixWaterHya")}
              >
                <Text style={styles.metricSectionTitle}>
                  Confusion Matrix (Water Hyacinth){" "}
                </Text>
                <Ionicons
                  name={
                    expandedSections.confusionMatrixWaterHya
                      ? "chevron-up"
                      : "chevron-down"
                  }
                  size={18}
                  color={COLORS.green700}
                />
              </TouchableOpacity>
              {expandedSections.confusionMatrixWaterHya && (
                <>
                  <Text style={styles.metricDescription}>
                    Overall, the confusion matrix demonstrates excellent
                    classification performance, as the majority of predictions
                    were correctly identified as water hyacinth with only a
                    small number of missed detections and false positive
                    predictions. The high number of correct predictions combined
                    with the low number of missed detections demonstrates strong
                    reliability. Although a few background regions were
                    incorrectly identified as water hyacinth, the relatively
                    small number of errors indicates that the model generalizes
                    well and performs effectively for invasive plant detection
                    tasks.
                  </Text>
                  <Text style={styles.metricDescription}>
                    The model successfully detected
                    <Text style={styles.highlight}> water hyacinth</Text>{" "}
                    <Text style={styles.highlight}>97 </Text>
                    instances while{" "}
                    <Text style={styles.highlight}>misclassifying</Text> it as
                    background in <Text style={styles.highlight}>11 </Text>
                    instances. The model also lost{" "}
                    <Text style={styles.highlight}>16</Text>{" "}
                    <Text style={styles.highlight}>water hyacinth</Text>{" "}
                    instances to the
                    <Text style={styles.highlight}> background</Text>.
                  </Text>

                  <Image
                    source={require("../../assets/images/cm_waterhya.png")}
                    style={styles.metricImage}
                    resizeMode="contain"
                  />
                </>
              )}
            </View>

            <View style={styles.metricSection}>
              <TouchableOpacity
                style={styles.metricSectionHeader}
                activeOpacity={0.7}
                onPress={() => toggleSection("trainingMetricsWaterLet")}
              >
                <Text style={styles.metricSectionTitle}>
                  Training Metrics (Water Lettuce){" "}
                </Text>
                <Ionicons
                  name={
                    expandedSections.trainingMetricsWaterLet
                      ? "chevron-up"
                      : "chevron-down"
                  }
                  size={18}
                  color={COLORS.green700}
                />
              </TouchableOpacity>
              {expandedSections.trainingMetricsWaterLet && (
                <>
                  <Text style={styles.metricDescription}>
                    The model demonstrated strong overall detection performance
                    for <Text style={styles.highlight}>Water Lettuce</Text>{" "}
                    based on its mAP50 and mAP50-95 scores. The{" "}
                    <Text style={styles.highlight}>mAP50</Text> score of{" "}
                    <Text style={styles.highlight}>89.23%</Text> indicates that
                    the model effectively detected and localized{" "}
                    <Text style={styles.highlight}>Water Lettuce</Text> at a 50%
                    IoU threshold. The{" "}
                    <Text style={styles.highlight}>mAP50-95</Text> score of{" "}
                    <Text style={styles.highlight}>73.60%</Text> indicates that
                    the model also maintained reasonably accurate bounding boxes
                    under stricter IoU thresholds, demonstrating stronger
                    localization performance across varying evaluation criteria.
                  </Text>
                  <Text style={styles.metricDescription}>
                    The model achieved a{" "}
                    <Text style={styles.highlight}>precision</Text> score of{" "}
                    <Text style={styles.highlight}>81.92%</Text>, indicating
                    that most predicted{" "}
                    <Text style={styles.highlight}>water lettuce</Text>{" "}
                    detections were correct. This suggests that the model is
                    generally reliable when identifying{" "}
                    <Text style={styles.highlight}>water lettuce</Text> within
                    images. However, some background regions or visually similar
                    aquatic vegetation might still occasionally be mistaken for
                    water lettuce due to similarities in texture, color, or
                    clustering patterns.
                  </Text>
                  <Text style={styles.metricDescription}>
                    The <Text style={styles.highlight}>recall</Text> score of{" "}
                    <Text style={styles.highlight}>79.93%</Text> indicates that
                    the model successfully detected approximately{" "}
                    <Text style={styles.highlight}>
                      80% of the actual water lettuce instances present in the
                      dataset
                    </Text>
                    . The result suggests that the model is effective at
                    locating water lettuce under varying environmental
                    conditions. Nevertheless, some plants might still remain
                    undetected because of occlusion, overlapping vegetation,
                    water reflections, or variations in plant size and
                    orientation.
                  </Text>

                  <Image
                    source={require("../../assets/images/metrics_waterlet.png")}
                    style={styles.metricImage}
                    resizeMode="contain"
                  />
                </>
              )}
            </View>

            <View style={styles.metricSection}>
              <TouchableOpacity
                style={styles.metricSectionHeader}
                activeOpacity={0.7}
                onPress={() => toggleSection("confusionMatrixWaterLet")}
              >
                <Text style={styles.metricSectionTitle}>
                  Confusion Matrix (Water Lettuce){" "}
                </Text>
                <Ionicons
                  name={
                    expandedSections.confusionMatrixWaterLet
                      ? "chevron-up"
                      : "chevron-down"
                  }
                  size={18}
                  color={COLORS.green700}
                />
              </TouchableOpacity>
              {expandedSections.confusionMatrixWaterLet && (
                <>
                  <Text style={styles.metricDescription}>
                    Overall, the confusion matrix indicates strong detection
                    performance, as the majority of water lettuce instances were
                    correctly identified with relatively few missed detections.
                    The high number of correct predictions combined with the
                    relatively low number of missed detections indicates strong
                    detection sensitivity and reliable classification
                    performance. Although some background regions were
                    incorrectly identified as water lettuce, the model still
                    demonstrates good generalization capability and practical
                    usefulness for automated aquatic invasive plant monitoring
                    applications.{" "}
                  </Text>
                  <Text style={styles.metricDescription}>
                    The model successfully detected
                    <Text style={styles.highlight}> water lettuce</Text>{" "}
                    <Text style={styles.highlight}>238 </Text>
                    instances while{" "}
                    <Text style={styles.highlight}>misclassifying</Text> it as
                    background in <Text style={styles.highlight}>83 </Text>
                    instances. The model also lost{" "}
                    <Text style={styles.highlight}>34</Text>{" "}
                    <Text style={styles.highlight}>water lettuce</Text>{" "}
                    instances to the
                    <Text style={styles.highlight}> background</Text>.
                  </Text>

                  <Image
                    source={require("../../assets/images/cm_waterlet.png")}
                    style={styles.metricImage}
                    resizeMode="contain"
                  />
                </>
              )}
            </View>

            <View style={{ height: 32 }} />
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <Modal
        visible={isGuideOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setIsGuideOpen(false)}
      >
        <SafeAreaView style={styles.modalSafe}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Metrics Guide</Text>
            <TouchableOpacity
              onPress={() => setIsGuideOpen(false)}
              style={styles.modalClose}
            >
              <Ionicons name="close" size={22} color={COLORS.green700} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.modalScroll}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.metricSection}>
              <Text style={styles.metricSectionTitle}>
                How to Read Model Metrics
              </Text>
              <Text style={styles.metricDescription}>
                This guide explains each metric used to evaluate the YOLOv8
                detection model powering EcoSentry's invasive plant
                identification.
              </Text>
              <TouchableOpacity onPress={() => setIsImageFullscreen(true)}>
                <Image
                  source={require("../../assets/images/guidepic.png")}
                  style={styles.guideImage}
                  resizeMode="contain"
                />
                <Text style={styles.zoomHint}>
                  🔍 Tap to view fullscreen & pinch to zoom
                </Text>
              </TouchableOpacity>
            </View>
            <View style={{ height: 32 }} />
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.green700 },
  header: {
    backgroundColor: COLORS.green700,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  logoRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  logoIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  appName: {
    fontSize: 18,
    fontWeight: "600",
    color: COLORS.white,
    letterSpacing: 0.3,
  },
  // guideBtn: {
  //   position: "absolute",
  //   right: 16,
  //   bottom: 214, // sits above metricsBtn (160), statsBtn (56), recenterBtn (108)
  //   width: 36,
  //   height: 36,
  //   borderRadius: 8,
  //   backgroundColor: COLORS.white,
  //   borderWidth: 0.5,
  //   borderColor: COLORS.border,
  //   alignItems: "center",
  //   justifyContent: "center",
  //   shadowColor: "#000",
  //   shadowOffset: { width: 0, height: 1 },
  //   shadowOpacity: 0.15,
  //   shadowRadius: 3,
  //   elevation: 3,
  // },
  zoomHint: {
    textAlign: "center",
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 6,
    marginBottom: 4,
  },
  guideImage: {
    width: "100%",
    height: 750, // ← was 520
    marginTop: 8,
    borderRadius: 8,
    backgroundColor: COLORS.surface,
  },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 10 },
  welcomeRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 11, fontWeight: "600", color: COLORS.white },
  welcomeText: {
    fontSize: 13,
    color: "rgba(255,255,255,0.85)",
    maxWidth: 80,
  },
  authBtn: {
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 0.5,
    borderColor: "rgba(255,255,255,0.3)",
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 20,
  },
  authBtnText: { fontSize: 13, fontWeight: "500", color: COLORS.white },
  mapWrapper: {
    flex: 1,

    margin: 0, // Ensure no default margins
    padding: 0, // Ensure no default paddings
    position: "relative",
  },
  // galleryBtn: {
  //   position: "absolute",
  //   right: 16,
  //   bottom: 264, // 👈 Positioned 44px higher than statsBtn to form a clean vertical stack
  //   width: 36,
  //   height: 36,
  //   borderRadius: 8,
  //   backgroundColor: COLORS.white,
  //   borderWidth: 0.5,
  //   borderColor: COLORS.border,
  //   alignItems: "center",
  //   justifyContent: "center",
  //   shadowColor: "#000",
  //   shadowOffset: { width: 0, height: 1 },
  //   shadowOpacity: 0.15,
  //   shadowRadius: 3,
  //   elevation: 3,
  // },
  // // statsBtn: {
  // //   position: "absolute",
  // //   right: 16,
  // //   bottom: 56,
  // //   width: 36,
  // //   height: 36,
  // //   borderRadius: 8,
  // //   backgroundColor: COLORS.white,
  // //   borderWidth: 0.5,
  // //   borderColor: COLORS.border,
  // //   alignItems: "center",
  // //   justifyContent: "center",
  // //   shadowColor: "#000",
  // //   shadowOffset: { width: 0, height: 1 },
  // //   shadowOpacity: 0.15,
  // //   shadowRadius: 3,
  // //   elevation: 3,
  // // },
  // drawBtn: {
  //   position: "absolute",
  //   right: 16,
  //   bottom: 320, // sits above statsBtn (56) and recenterBtn (108)
  //   width: 36,
  //   height: 36,
  //   borderRadius: 8,
  //   backgroundColor: COLORS.white,
  //   borderWidth: 0.5,
  //   borderColor: COLORS.border,
  //   alignItems: "center",
  //   justifyContent: "center",
  //   shadowColor: "#000",
  //   shadowOffset: { width: 0, height: 1 },
  //   shadowOpacity: 0.15,
  //   shadowRadius: 3,
  //   elevation: 3,
  // },
  recenterBtn: {
    position: "absolute",
    right: 16,
    bottom: 32,
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: COLORS.white,
    borderWidth: 0.5,
    borderColor: COLORS.border,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 3,
  },
  hamburgerBtn: {
    position: "absolute",
    bottom: 78, // sits above statsBtn (56) and recenterBtn (108)
    right: 16,
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: COLORS.white,
    borderWidth: 0.5,
    borderColor: COLORS.border,
    alignItems: "center",
    justifyContent: "center",
    elevation: 6,
    zIndex: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
  },
  toolsMenu: {
    position: "absolute",
    bottom: 124, // sits just below hamburgerBtn
    right: 16,
    backgroundColor: COLORS.white,
    borderRadius: 14,
    paddingVertical: 8,
    paddingHorizontal: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
    zIndex: 19,
    minWidth: 160,
  },
  toolsMenuItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 10,
  },
  toolsMenuLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#333",
  },
  sheetBg: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  sheetHandle: { backgroundColor: "#D0D0D0", width: 36 },
  sheetContent: {
    paddingHorizontal: 16,
    paddingBottom: Platform.OS === "ios" ? 24 : 16,
  },
  sheetTitle: {
    fontSize: 13,
    fontWeight: "500",
    color: COLORS.textSecondary,
    marginBottom: 12,
  },
  statsRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  statCard: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: "center",
  },
  statNum: { fontSize: 22, fontWeight: "600", color: COLORS.green700 },
  statLabel: {
    fontSize: 10,
    color: COLORS.textSecondary,
    marginTop: 2,
    textAlign: "center",
  },
  legendRow: {
    flexDirection: "row",
    gap: 16,
    paddingTop: 10,
    borderTopWidth: 0.5,
    borderTopColor: COLORS.border,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 11, color: COLORS.textSecondary },
  // metricsBtn: {
  //   position: "absolute",
  //   right: 16,
  //   bottom: 160, // sits above statsBtn (56) and recenterBtn (108)
  //   width: 36,
  //   height: 36,
  //   borderRadius: 8,
  //   backgroundColor: COLORS.white,
  //   borderWidth: 0.5,
  //   borderColor: COLORS.border,
  //   alignItems: "center",
  //   justifyContent: "center",
  //   shadowColor: "#000",
  //   shadowOffset: { width: 0, height: 1 },
  //   shadowOpacity: 0.15,
  //   shadowRadius: 3,
  //   elevation: 3,
  // },
  modalSafe: { flex: 1, backgroundColor: COLORS.white },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.border,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: COLORS.green700,
  },
  modalClose: {
    padding: 4,
  },
  modalScroll: { flex: 1 },
  metricSection: {
    paddingHorizontal: 16,
    paddingTop: 20,
  },
  metricSectionTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#1B5E20",
    marginBottom: 10,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.green700,
    paddingLeft: 8,
  },
  metricDescription: {
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 20,
    marginBottom: 10,
  },
  highlight: {
    color: COLORS.green700,
    fontWeight: "600",
  },
  metricImage: {
    width: "100%",
    height: 220,
    marginTop: 8,
    marginBottom: 4,
    borderRadius: 8,
    backgroundColor: COLORS.surface,
  },
  metricSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
});
