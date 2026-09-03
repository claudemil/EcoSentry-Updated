import { ActivityIndicator, Dimensions, StatusBar } from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { useState, useEffect, useCallback } from "react";
import { Stack } from "expo-router";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  Modal,
  StyleSheet,
} from "react-native";
import { SpeciesPin } from "@/components/MapComponent";
import {
  collection,
  DocumentData,
  getDocs,
  orderBy,
  query,
} from "firebase/firestore";
import { auth, db } from "@/firebaseConfig";
import Ionicons from "@expo/vector-icons/build/Ionicons";

// Placeholder mock data — swap with real pin photos later
type PinAlbum = {
  pinId: string;
  specieLabel: string;
  photos: string[];
};

type GalleryPhoto = {
  key: string;
  uri: string;
  pinId: string;
  specieLabel: string;
};

export default function GalleryScreen() {
  const router = useRouter();
  const [pins, setPins] = useState<SpeciesPin[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [previewPhoto, setPreviewPhoto] = useState<GalleryPhoto | null>(null);
  const [activeAlbum, setActiveAlbum] = useState<PinAlbum | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [selectedSpecies, setSelectedSpecies] = useState("All");

  const currentUser = auth.currentUser;

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

        const images: string[] = Array.isArray(data.images) ? data.images : [];
        const creator = data.creator ?? null;
        const created_by: string = data.created_by
          ? String(data.created_by)
          : "";

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
        } as unknown as SpeciesPin;
      });

      setPins(formattedPins);
    } catch (error) {
      console.error("Failed to load pins from Firestore:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      fetchPins();
    }, []),
  );

  const speciesOptions = [
    "Water Hyacinth",
    "Water Lettuce",
    "Siam Weed",
    "Lantana Camara",
    "All",
    ...(currentUser ? ["My Pins"] : []),
  ];

  // ✅ Flatten every pin's primary image + extra images into one photo list
  const photos: GalleryPhoto[] = pins.flatMap((pin) => {
    const urls = [pin.image_url, ...(pin.images ?? [])].filter(
      (uri): uri is string => Boolean(uri),
    );
    // De-dupe in case image_url also appears inside images
    const uniqueUrls = Array.from(new Set(urls));

    return uniqueUrls.map((uri, idx) => ({
      key: `${pin.id}-${idx}`,
      uri,
      pinId: String(pin.id),
      specieLabel: pin.specie_label,
    }));
  });

  const albums: PinAlbum[] = pins
    .filter((pin) => {
      if (selectedSpecies === "All") return true;
      if (selectedSpecies === "My Pins") {
        return (
          currentUser &&
          (pin.userId === currentUser.uid ||
            pin.creator?.uid === currentUser.uid)
        );
      }
      return pin.specie_label === selectedSpecies;
    })
    .map((pin) => {
      const urls = [pin.image_url, ...(pin.images ?? [])].filter(
        (uri): uri is string => Boolean(uri),
      );
      const uniqueUrls = Array.from(new Set(urls));

      return {
        pinId: String(pin.id),
        specieLabel: pin.specie_label,
        photos: uniqueUrls,
      };
    })
    .filter((album) => album.photos.length > 0);

  const openAlbum = (album: PinAlbum) => {
    setActiveAlbum(album);
    setActiveIndex(0);
  };

  return (
    <View style={styles.mainWrapper}>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar barStyle="light-content" />

      <View style={styles.navBar}>
        <View style={styles.logoIcon}>
          <Ionicons name="leaf" size={18} color="#fff" />
        </View>
        <Text style={styles.headerTitle}>EcoSentry</Text>
      </View>

      {/* ✅ Filter chip row */}
      <View style={styles.filterBar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
        >
          {speciesOptions.map((option) => {
            const isActive = selectedSpecies === option;
            return (
              <TouchableOpacity
                key={option}
                onPress={() => setSelectedSpecies(option)}
                style={[styles.filterChip, isActive && styles.filterChipActive]}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    isActive && styles.filterChipTextActive,
                  ]}
                >
                  {option}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView style={styles.container}>
        {isLoading ? (
          <ActivityIndicator
            style={{ marginTop: 40 }}
            color={COLORS.green700}
          />
        ) : (
          <View style={styles.galleryGrid}>
            {albums.map((album) => {
              const extraCount = album.photos.length - 1;
              return (
                <TouchableOpacity
                  key={album.pinId}
                  activeOpacity={0.85}
                  onPress={() => openAlbum(album)}
                  style={{ width: tileSize, height: tileSize }}
                >
                  {/* ✅ Stacked-card look when there's more than one photo */}
                  {extraCount > 0 && (
                    <View
                      style={[
                        styles.stackLayer,
                        { top: -4, left: 4, right: -4 },
                      ]}
                    />
                  )}
                  <Image
                    source={{ uri: album.photos[0] }}
                    style={styles.galleryTile}
                  />
                  {extraCount > 0 && (
                    <View style={styles.albumBadge}>
                      <Text style={styles.albumBadgeText}>+{extraCount}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {!isLoading && albums.length === 0 && (
          <Text style={styles.emptyOffline}>No pins with photos yet.</Text>
        )}
      </ScrollView>

      {/* Album viewer — mini carousel through this pin's photos */}
      <Modal
        visible={Boolean(activeAlbum)}
        transparent
        animationType="fade"
        onRequestClose={() => setActiveAlbum(null)}
      >
        <View style={styles.fullscreenOverlay}>
          <TouchableOpacity
            style={styles.fullscreenCloseBtn}
            onPress={() => setActiveAlbum(null)}
          >
            <Text style={styles.fullscreenCloseText}>✕</Text>
          </TouchableOpacity>

          {activeAlbum && (
            <>
              <Text style={styles.fullscreenCaption}>
                🌿 {activeAlbum.specieLabel}
              </Text>
              <Image
                source={{ uri: activeAlbum.photos[activeIndex] }}
                style={styles.fullscreenImage}
                resizeMode="contain"
              />

              {activeAlbum.photos.length > 1 && (
                <>
                  <View style={styles.dotsRow}>
                    {activeAlbum.photos.map((_, idx) => (
                      <View
                        key={idx}
                        style={[
                          styles.dot,
                          idx === activeIndex && styles.dotActive,
                        ]}
                      />
                    ))}
                  </View>

                  <View style={styles.carouselNav}>
                    <TouchableOpacity
                      onPress={() =>
                        setActiveIndex((i) =>
                          i === 0 ? activeAlbum.photos.length - 1 : i - 1,
                        )
                      }
                      style={styles.navBtn}
                    >
                      <Text style={styles.navBtnText}>‹</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() =>
                        setActiveIndex((i) =>
                          i === activeAlbum.photos.length - 1 ? 0 : i + 1,
                        )
                      }
                      style={styles.navBtn}
                    >
                      <Text style={styles.navBtnText}>›</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}

              <TouchableOpacity
                style={styles.viewOnMapBtn}
                onPress={() => {
                  const pinId = activeAlbum.pinId;
                  setActiveAlbum(null);
                  router.push({
                    pathname: "/",
                    params: { highlightPinId: pinId },
                  });
                }}
              >
                <Text style={styles.viewOnMapBtnText}>📍 View on map</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </Modal>
    </View>
  );
}

const { width } = Dimensions.get("window");
const GALLERY_GAP = 6;
const GALLERY_COLUMNS = 3;
const tileSize =
  (width - 32 - GALLERY_GAP * (GALLERY_COLUMNS - 1)) / GALLERY_COLUMNS;

const COLORS = {
  green700: "#2E7D32",
  pinRed: "#E53935",
  blue: "#1565C0",
  white: "#fff",
  surface: "#F5F5F5",
  textSecondary: "#757575",
  border: "rgba(0,0,0,0.08)",
};
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
    alignItems: "center",
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: COLORS.white,
    letterSpacing: 0.5,
  },
  container: {
    flex: 1,
    backgroundColor: COLORS.surface,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.textSecondary,
    marginLeft: 16,
    marginBottom: 8,
    letterSpacing: 1,
  },
  galleryHeader: {
    backgroundColor: COLORS.white,
    paddingTop: 20,
    paddingBottom: 8,
  },
  filterBar: {
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingVertical: 10,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.white,
  },
  filterChipActive: {
    backgroundColor: COLORS.green700,
    borderColor: COLORS.green700,
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.textSecondary,
  },
  filterChipTextActive: {
    color: COLORS.white,
  },
  gallerySubtext: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginLeft: 16,
    marginBottom: 4,
  },
  logoIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  fullscreenCaption: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
    marginTop: 12,
  },
  galleryGrid: {
    backgroundColor: COLORS.white,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: COLORS.border,
    padding: 10,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  viewOnMapBtn: {
    position: "absolute",
    bottom: 40,
    backgroundColor: "#4CAF50",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
  },
  viewOnMapBtnText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
  stackLayer: {
    position: "absolute",
    bottom: 0,
    height: "94%",
    backgroundColor: "#C8E6C9",
    borderRadius: 8,
    zIndex: -1,
  },
  albumBadge: {
    position: "absolute",
    bottom: 6,
    right: 6,
    backgroundColor: "rgba(0,0,0,0.65)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
  },
  albumBadgeText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
  },
  dotsRow: {
    flexDirection: "row",
    gap: 6,
    marginTop: 10,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.4)",
  },
  dotActive: {
    backgroundColor: "#fff",
  },
  carouselNav: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: "100%",
    paddingHorizontal: 20,
    position: "absolute",
    top: "45%",
  },
  navBtn: {
    backgroundColor: "rgba(0,0,0,0.4)",
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  navBtnText: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "700",
  },
  emptyOffline: {
    textAlign: "center",
    color: COLORS.textSecondary,
    paddingVertical: 16,
    fontSize: 13,
    fontStyle: "italic",
  },
  galleryTile: {
    width: "100%",
    height: "100%",
    borderRadius: 8,
    backgroundColor: COLORS.surface,
  },
  fullscreenOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.9)",
    justifyContent: "center",
    alignItems: "center",
  },
  fullscreenCloseBtn: {
    position: "absolute",
    top: 50,
    right: 20,
    zIndex: 10,
    padding: 10,
  },
  fullscreenCloseText: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "700",
  },
  fullscreenImage: {
    width: "100%",
    height: "80%",
  },
});
