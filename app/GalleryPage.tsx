import { ActivityIndicator, Dimensions, StatusBar } from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { doc, updateDoc, arrayUnion } from "firebase/firestore";
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
import {
  PinDetection,
  SpeciesVerification,
  SPECIES_COLORS,
} from "@/components/MapComponent";
import { Alert } from "react-native";
import { ALL_SPECIES } from "./(tabs)";

// Placeholder mock data — swap with real pin photos later
type PinAlbum = {
  pinId: string;
  specieLabel: string;
  photos: string[];
  detections?: Record<string, PinDetection>; // ← new, only meaningful for the first photo (image_url)
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
  const [imageLayout, setImageLayout] = useState({ width: 0, height: 0 });
  const [showPerformanceModal, setShowPerformanceModal] = useState(false);
  const [verifyPrompt, setVerifyPrompt] = useState<{
    pinId: string;
    detId: string;
    detection: PinDetection;
  } | null>(null);
  const [showSpeciesCorrection, setShowSpeciesCorrection] = useState(false);

  const currentUser = auth.currentUser;
  const [naturalImageSize, setNaturalImageSize] = useState({
    width: 1,
    height: 1,
  });

  // Fetch natural size whenever the active photo changes
  useEffect(() => {
    if (!activeAlbum) return;
    const uri = activeAlbum.photos[activeIndex];
    Image.getSize(
      uri,
      (width, height) => setNaturalImageSize({ width, height }),
      (error) => console.error("Failed to get image size:", error),
    );
  }, [activeAlbum, activeIndex]);

  // Compute the actual rendered image rect within the container, given "contain" behavior
  const getRenderedImageRect = () => {
    const { width: containerW, height: containerH } = imageLayout;
    const { width: imgW, height: imgH } = naturalImageSize;

    if (containerW === 0 || containerH === 0 || imgW === 0 || imgH === 0) {
      return { offsetX: 0, offsetY: 0, renderedWidth: 0, renderedHeight: 0 };
    }

    const containerRatio = containerW / containerH;
    const imageRatio = imgW / imgH;

    let renderedWidth: number;
    let renderedHeight: number;

    if (imageRatio > containerRatio) {
      // Image is relatively wider than container — letterboxed top/bottom
      renderedWidth = containerW;
      renderedHeight = containerW / imageRatio;
    } else {
      // Image is relatively taller than container — letterboxed left/right
      renderedHeight = containerH;
      renderedWidth = containerH * imageRatio;
    }

    const offsetX = (containerW - renderedWidth) / 2;
    const offsetY = (containerH - renderedHeight) / 2;

    return { offsetX, offsetY, renderedWidth, renderedHeight };
  };

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
        const detections = data.detections ?? undefined; // ← new

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
          detections, // ← new
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
        detections: pin.detections, // ← new
      };
    })
    .filter((album) => album.photos.length > 0);

  const getDetectionVerdict = (det: PinDetection): boolean | null => {
    const verifications = det.speciesVerifications ?? [];
    if (verifications.length === 0) return null; // no one has verified it yet

    const correctVotes = verifications.filter((v) => v.correct).length;
    const incorrectVotes = verifications.length - correctVotes;

    if (correctVotes > incorrectVotes) return true;
    if (incorrectVotes > correctVotes) return false;
    return null; // tie — treat as inconclusive
  };

  const verifyDetection = async (
    pinId: string,
    detId: string,
    correct: boolean,
    correctedLabel?: string,
  ) => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      Alert.alert("Login required", "Please log in to verify detections.");
      setVerifyPrompt(null);
      setShowSpeciesCorrection(false);
      return;
    }

    try {
      const verification: SpeciesVerification = {
        userId: currentUser.uid,
        correct,
        timestamp: Date.now(),
        ...(correctedLabel ? { correctedLabel } : {}),
      };

      await updateDoc(doc(db, "pins", pinId), {
        [`detections.${detId}.speciesVerifications`]: arrayUnion(verification),
      });

      await fetchPins();

      Alert.alert(
        "Thanks!",
        correct
          ? "Marked as correctly identified."
          : `Marked as incorrect${correctedLabel ? ` — noted as ${correctedLabel}` : ""}.`,
      );
    } catch (e) {
      console.error("Failed to verify detection:", e);
      Alert.alert(
        "Error",
        "Could not save your verification. Please try again.",
      );
    } finally {
      setVerifyPrompt(null);
      setShowSpeciesCorrection(false);
    }
  };

  const openAlbum = (album: PinAlbum) => {
    setActiveAlbum(album);
    setActiveIndex(0);
  };

  const computeSpeciesPerformanceStats = (
    detections: Record<string, PinDetection>,
  ) => {
    const detArray = Object.values(detections);

    // Only species actually present among this image's detections
    const speciesPresent = Array.from(new Set(detArray.map((d) => d.label)));

    return speciesPresent.map((species) => {
      const speciesDetections = detArray.filter((d) => d.label === species);
      const total = speciesDetections.length;

      const correctCount = speciesDetections.filter(
        (d) => getDetectionVerdict(d) === true,
      ).length;
      const incorrectCount = speciesDetections.filter(
        (d) => getDetectionVerdict(d) === false,
      ).length;
      const unverifiedCount = total - correctCount - incorrectCount;

      const precision = total > 0 ? correctCount / total : 0;

      return {
        species,
        total,
        correctCount,
        incorrectCount,
        unverifiedCount,
        precision,
      };
    });
  };

  const isReadyToRenderBoxes =
    imageLayout.width > 0 &&
    naturalImageSize.width > 1 && // > 1, not > 0, since default is {width: 1, height: 1}
    naturalImageSize.height > 1;

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

              <View
                style={styles.imageWithOverlay}
                onLayout={(e) => {
                  const { width, height } = e.nativeEvent.layout;
                  setImageLayout({ width, height });
                }}
              >
                <Image
                  source={{ uri: activeAlbum.photos[activeIndex] }}
                  style={styles.fullscreenImage}
                  resizeMode="contain"
                />

                {activeIndex === 0 &&
                  activeAlbum.detections &&
                  isReadyToRenderBoxes &&
                  (() => {
                    const { offsetX, offsetY, renderedWidth, renderedHeight } =
                      getRenderedImageRect();

                    console.log("🔍 Box positioning debug:", {
                      imageLayout,
                      naturalImageSize,
                      rect: getRenderedImageRect(),
                    });

                    return Object.entries(activeAlbum.detections).map(
                      ([detId, det]) => {
                        const verdict = getDetectionVerdict(det); // true | false | null

                        const getBoxColor = () => {
                          if (verdict === true) return "#4CAF50"; // confirmed correct
                          if (verdict === false) return COLORS.pinRed; // confirmed wrong
                          if (det.isBest) return "#FFC107"; // unverified, best detection
                          return "rgba(255,255,255,0.7)"; // unverified, other detection
                        };

                        return (
                          <TouchableOpacity
                            key={detId}
                            activeOpacity={0.7}
                            onPress={() =>
                              setVerifyPrompt({
                                pinId: activeAlbum.pinId,
                                detId,
                                detection: det,
                              })
                            }
                            style={{
                              position: "absolute",
                              left: offsetX + det.bbox.x * renderedWidth,
                              top: offsetY + det.bbox.y * renderedHeight,
                              width: det.bbox.width * renderedWidth,
                              height: det.bbox.height * renderedHeight,
                              borderWidth: det.isBest ? 2.5 : 1.5,
                              borderColor: getBoxColor(),
                              borderRadius: 4,
                            }}
                          >
                            <View style={styles.detectionTapLabel}>
                              <Text
                                style={styles.detectionTapLabelText}
                                numberOfLines={1}
                              >
                                {det.label}
                              </Text>
                            </View>
                          </TouchableOpacity>
                        );
                      },
                    );
                  })()}
              </View>

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

              {activeIndex === 0 && activeAlbum.detections && (
                <View
                  style={{ flexDirection: "row", justifyContent: "center" }}
                >
                  <TouchableOpacity
                    style={styles.performanceBtn}
                    onPress={() => setShowPerformanceModal(true)}
                  >
                    <Ionicons name="analytics-outline" size={16} color="#fff" />
                    <Text style={styles.performanceBtnText}>
                      Model Performance
                    </Text>
                  </TouchableOpacity>
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
                </View>
              )}

              {activeIndex === 0 && activeAlbum.detections && (
                <Text style={styles.tapHintText}>
                  Tap a box to verify its species
                </Text>
              )}

              {/* <TouchableOpacity
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
              </TouchableOpacity> */}
            </>
          )}
        </View>
      </Modal>

      {/* Verify prompt modal */}
      <Modal
        visible={Boolean(verifyPrompt) && !showSpeciesCorrection}
        transparent
        animationType="fade"
        onRequestClose={() => setVerifyPrompt(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.verifyPromptContent}>
            <Text style={styles.title}>Verify Detection</Text>
            <Text style={styles.verifyPromptSubtitle}>
              Is this correctly identified as{" "}
              <Text style={{ fontWeight: "700", color: COLORS.green700 }}>
                {verifyPrompt?.detection.label}
              </Text>
              ?
            </Text>

            <Text style={styles.verifyPromptConfidence}>
              Model confidence:{" "}
              <Text style={{ color: COLORS.green700, fontWeight: "700" }}>
                {((verifyPrompt?.detection.confidence ?? 0) * 100).toFixed(0)}%
              </Text>
            </Text>

            <View style={styles.verifyPromptBtnRow}>
              <TouchableOpacity
                style={styles.verifyPromptYesBtn}
                onPress={() =>
                  verifyPrompt &&
                  verifyDetection(verifyPrompt.pinId, verifyPrompt.detId, true)
                }
              >
                <Text style={styles.verifyPromptYesBtnText}>✓ Correct</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.verifyPromptNoBtn}
                onPress={() => setShowSpeciesCorrection(true)}
              >
                <Text style={styles.verifyPromptNoBtnText}>✕ Incorrect</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={{ marginTop: 12, alignItems: "center" }}
              onPress={() => setVerifyPrompt(null)}
            >
              <Text style={{ color: COLORS.textSecondary, fontSize: 13 }}>
                Cancel
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Species correction picker — shown after tapping "Incorrect" */}
      <Modal
        visible={Boolean(verifyPrompt) && showSpeciesCorrection}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSpeciesCorrection(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.title}>What is it actually?</Text>
            <Text style={styles.verifyPromptSubtitle}>
              The model guessed{" "}
              <Text style={{ fontWeight: "700" }}>
                {verifyPrompt?.detection.label}
              </Text>
              . Select the correct species:
            </Text>

            {ALL_SPECIES.filter((s) => s !== verifyPrompt?.detection.label).map(
              (species) => {
                const color = SPECIES_COLORS[species] ?? "#999";
                return (
                  <TouchableOpacity
                    key={species}
                    style={[styles.categoryOption, { borderColor: color }]}
                    onPress={() =>
                      verifyPrompt &&
                      verifyDetection(
                        verifyPrompt.pinId,
                        verifyPrompt.detId,
                        false,
                        species,
                      )
                    }
                  >
                    <View
                      style={[styles.categoryDot, { backgroundColor: color }]}
                    />
                    <Text style={styles.categoryOptionText}>{species}</Text>
                  </TouchableOpacity>
                );
              },
            )}

            <TouchableOpacity
              style={[styles.categoryOption, { borderColor: "#999" }]}
              onPress={() =>
                verifyPrompt &&
                verifyDetection(verifyPrompt.pinId, verifyPrompt.detId, false)
              }
            >
              <View style={[styles.categoryDot, { backgroundColor: "#999" }]} />
              <Text
                style={[
                  styles.categoryOptionText,
                  { color: COLORS.textSecondary },
                ]}
              >
                Not sure / Not a listed species
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.cancelButton, { marginTop: 8 }]}
              onPress={() => setShowSpeciesCorrection(false)}
            >
              <Text style={styles.cancelButtonText}>Back</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {activeIndex === 0 && activeAlbum?.detections && (
        <TouchableOpacity
          style={styles.performanceBtn}
          onPress={() => setShowPerformanceModal(true)}
        >
          <Ionicons name="analytics-outline" size={16} color="#fff" />
          <Text style={styles.performanceBtnText}>Model Performance</Text>
        </TouchableOpacity>
      )}
      <Modal
        visible={showPerformanceModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPerformanceModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.performanceModalContent}>
            <Text style={styles.title}>Detection Performance</Text>
            <Text style={styles.verifyPromptSubtitle}>
              Broken down by species detected in this photo
            </Text>

            <ScrollView style={{ maxHeight: 360, marginTop: 8 }}>
              {activeAlbum?.detections &&
                computeSpeciesPerformanceStats(activeAlbum.detections).map(
                  (stat) => (
                    <View key={stat.species} style={styles.speciesStatBlock}>
                      <Text style={styles.speciesStatTitle}>
                        {stat.species}
                      </Text>

                      <View style={styles.performanceSummaryRow}>
                        <View style={styles.performanceCard}>
                          <Text style={styles.performanceNumber}>
                            {stat.total}
                          </Text>
                          <Text style={styles.performanceLabel}>
                            Detections
                          </Text>
                        </View>
                        <View style={styles.performanceCard}>
                          <Text
                            style={[
                              styles.performanceNumber,
                              { color: COLORS.green700 },
                            ]}
                          >
                            {stat.correctCount}
                          </Text>
                          <Text style={styles.performanceLabel}>Correct</Text>
                        </View>
                        <View style={styles.performanceCard}>
                          <Text
                            style={[
                              styles.performanceNumber,
                              { color: COLORS.pinRed },
                            ]}
                          >
                            {stat.incorrectCount}
                          </Text>
                          <Text style={styles.performanceLabel}>Wrong</Text>
                        </View>
                      </View>

                      <View style={styles.metricRow}>
                        <Text style={styles.metricLabel}>Precision</Text>
                        <Text style={styles.metricValue}>
                          {(stat.precision * 100).toFixed(1)}%
                        </Text>
                      </View>

                      <View style={styles.metricRow}>
                        <Text style={styles.metricLabel}>Recall (approx.)</Text>
                        <Text style={styles.metricValue}>
                          {(stat.precision * 100).toFixed(1)}%
                        </Text>
                      </View>

                      {stat.unverifiedCount > 0 && (
                        <Text style={styles.metricNote}>
                          {stat.unverifiedCount} unverified — tap its box to
                          help improve this score.
                        </Text>
                      )}
                    </View>
                  ),
                )}
            </ScrollView>

            <Text style={[styles.metricNote, { marginTop: 8 }]}>
              Recall is approximated as correct ÷ total detections, since only
              detected boxes can be verified — missed plants aren't counted.
            </Text>

            <TouchableOpacity
              style={[styles.secondaryButton, { marginTop: 12 }]}
              onPress={() => setShowPerformanceModal(false)}
            >
              <Text style={styles.secondaryButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
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
    height: "100%",
  },
  imageWithOverlay: {
    width: "100%",
    height: "80%",
    position: "relative",
  },
  detectionTapLabel: {
    position: "absolute",
    top: -20,
    left: -1,
    backgroundColor: "rgba(0,0,0,0.7)",
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 3,
    maxWidth: 120,
  },
  detectionTapLabelText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "600",
  },
  tapHintText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 12,
    marginTop: 8,
    fontStyle: "italic",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  verifyPromptContent: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 20,
  },
  title: {
    fontSize: 17,
    fontWeight: "700",
    color: COLORS.green700,
    marginBottom: 8,
  },
  verifyPromptSubtitle: {
    fontSize: 14,
    color: "#333",
    marginBottom: 8,
  },
  verifyPromptConfidence: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginBottom: 16,
  },
  verifyPromptBtnRow: {
    flexDirection: "row",
    gap: 10,
  },
  verifyPromptYesBtn: {
    flex: 1,
    backgroundColor: "rgba(76, 175, 80, 0.1)",
    borderWidth: 1.5,
    borderColor: "#4CAF50",
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: "center",
  },
  verifyPromptYesBtnText: {
    color: "#4CAF50",
    fontWeight: "700",
    fontSize: 14,
  },
  verifyPromptNoBtn: {
    flex: 1,
    backgroundColor: "rgba(229, 57, 53, 0.1)",
    borderWidth: 1.5,
    borderColor: COLORS.pinRed,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: "center",
  },
  verifyPromptNoBtnText: {
    color: COLORS.pinRed,
    fontWeight: "700",
    fontSize: 14,
  },

  performanceBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#4CAF50",

    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    marginTop: 10,
  },
  performanceBtnText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  performanceModalContent: {
    width: "90%",
    maxWidth: 400,
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 20,
  },
  performanceSummaryRow: {
    flexDirection: "row",
    gap: 8,
    marginVertical: 12,
  },
  performanceCard: {
    flex: 1,
    backgroundColor: "rgba(46, 125, 50, 0.06)", // faint green tint instead of neutral gray
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  performanceNumber: {
    fontSize: 20,
    fontWeight: "700",
    color: COLORS.green700, // default color now green instead of neutral dark gray
  },
  performanceLabel: {
    fontSize: 10,
    color: COLORS.textSecondary,
    marginTop: 2,
    textAlign: "center",
  },
  metricRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  metricLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
  },
  metricValue: {
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.green700,
  },
  metricNote: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 4,
    lineHeight: 16,
  },
  secondaryButton: {
    backgroundColor: "rgba(76, 175, 80, 0.08)",
    borderWidth: 1.5,
    borderColor: COLORS.green700,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonText: {
    color: COLORS.green700,
    fontSize: 14,
    fontWeight: "700",
  },
  speciesCorrectionOption: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: "#F5F5F5",
    borderRadius: 8,
    marginTop: 6,
  },
  speciesCorrectionOptionText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
  },
  speciesStatBlock: {
    marginBottom: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  speciesStatTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.green700,
    marginBottom: 6,
  },
  modalContent: {
    width: "88%",
    maxWidth: 380,
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 20,
  },
  categoryOption: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 8,
  },
  categoryDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 10,
  },
  categoryOptionText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
  },
  cancelButton: {
    backgroundColor: "#F5F5F5",
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: "center",
  },
  cancelButtonText: {
    color: COLORS.textSecondary,
    fontSize: 14,
    fontWeight: "600",
  },
});
