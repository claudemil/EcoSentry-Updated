import { CameraView, useCameraPermissions } from "expo-camera";
import { useRef, useState, useEffect, useCallback } from "react";
import { useFocusEffect } from "expo-router";
import { usePinStore } from "../store/PinStore";
import NetInfo from "@react-native-community/netinfo";
import { useOfflinePinStore } from "../store/OfflinePinStore";
import { Image } from "react-native"; // add this import
import {
  ActivityIndicator,
  Button,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Alert,
  Modal,
  ScrollView,
} from "react-native";
import { useRouter } from "expo-router";
import * as Location from "expo-location";
import { useYOLOv8n, type Detection } from "@/hooks/use-YOLOv8n";
import { preprocessImage } from "@/utils/preprocessImage";
import * as ImageManipulator from "expo-image-manipulator";
import { COLORS } from "@/constants/Colors";
import { getBestDetection, CLASS_NAMES } from "@/hooks/use-YOLOv8n";
import { Ionicons } from "@expo/vector-icons";

// Model input is 640x640 (square), camera preview fills SCREEN_W x SCREEN_H
// Camera fills by cropping the longer axis, so we scale by the larger dimension

export default function ObserveScreen() {
  const [permission, requestPermission] = useCameraPermissions();

  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.permText}>
          Camera access is needed to detect plants.
        </Text>
        <Button title="Grant Permission" onPress={requestPermission} />
      </View>
    );
  }

  return <ObserveScreenActive />;
}

function ObserveScreenActive() {
  const [detections, setDetections] = useState<Detection[]>([]);
  const [isInferring, setIsInferring] = useState(false);
  const [capturedFrame, setCapturedFrame] = useState<string | null>(null);
  const isInferringRef = useRef(false);
  const isPinningRef = useRef(false);
  const [cameraDims, setCameraDims] = useState({ width: 0, height: 0 });
  const [showStatsModal, setShowStatsModal] = useState(false);
  const [showLegendModal, setShowLegendModal] = useState(false);
  const cameraRef = useRef<CameraView>(null);
  const { model, runInference } = useYOLOv8n();
  const router = useRouter();
  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(false);
  const bestDetection =
    detections.length > 0
      ? detections.reduce((a, b) => (a.confidence > b.confidence ? a : b))
      : null;

  const CORNER_POSITIONS = [
    { top: -2, left: -2 },
    { top: -2, right: -2 },
    { bottom: -2, left: -2 },
    { bottom: -2, right: -2 },
  ];

  const getCornerBorderStyle = (index: number) => ({
    borderTopWidth: index < 2 ? 3 : 0,
    borderBottomWidth: index >= 2 ? 3 : 0,
    borderLeftWidth: index % 2 === 0 ? 3 : 0,
    borderRightWidth: index % 2 === 1 ? 3 : 0,
  });

  const DETECTION_COLORS = ["#4CAF50", "#2196F3", "#FF9800", "#E91E63"];
  const getDetectionColor = (label: string) => {
    const index = CLASS_NAMES.indexOf(label);
    return DETECTION_COLORS[index % DETECTION_COLORS.length] ?? "#4CAF50";
  };
  // ✅ Runs once per button tap instead of looping continuously
  const runDetection = useCallback(async () => {
    if (!cameraRef.current || isInferringRef.current || isPinningRef.current)
      return;
    isInferringRef.current = true;
    setIsInferring(true);

    try {
      const photo = await cameraRef.current.takePictureAsync({
        base64: true,
        quality: 0.2,
        skipProcessing: true,
        imageType: "jpg",
      });
      if (!photo?.base64) return;

      const inputTensor = await preprocessImage(photo.base64);
      const results = await runInference(inputTensor);

      // ✅ Freeze here whether or not we got a match — user asked for a scan,
      // they should see the result rather than the loop silently retrying
      setCapturedFrame(`data:image/jpeg;base64,${photo.base64}`);
      setDetections(results);
      isPausedRef.current = true;
      setIsPaused(true);
    } catch (e) {
      console.error("Detection error:", e);
    } finally {
      isInferringRef.current = false;
      setIsInferring(false);
    }
  }, [runInference]);

  const handleScanPress = () => {
    if (model.state !== "loaded") return;
    runDetection();
  };

  const handleResume = () => {
    isPausedRef.current = false;
    setIsPaused(false);
    setDetections([]);
    setCapturedFrame(null);
  };

  // ✅ Reset state when leaving/returning to the screen — no background loop anymore
  useFocusEffect(
    useCallback(() => {
      isPinningRef.current = false;
      isInferringRef.current = false;
      isPausedRef.current = false;
      setIsPaused(false);
      setDetections([]);
      setCapturedFrame(null);
      setIsInferring(false);

      return () => {
        isInferringRef.current = false;
        isPausedRef.current = false;
      };
    }, []),
  );

  const handlePinThis = async () => {
    if (!bestDetection) return;
    if (isPinningRef.current) return;
    isPinningRef.current = true;
    isInferringRef.current = true;

    const pinImage = capturedFrame ?? "";

    let offlineImage = "";
    if (capturedFrame) {
      try {
        const compressed = await ImageManipulator.manipulateAsync(
          capturedFrame,
          [{ resize: { width: 200 } }],
          {
            base64: true,
            format: ImageManipulator.SaveFormat.JPEG,
            compress: 0.3,
          },
        );
        offlineImage = `data:image/jpeg;base64,${compressed.base64}`;
      } catch {
        offlineImage = "";
      }
    }

    try {
      const network = await NetInfo.fetch();
      const isOnline = network.isConnected && network.isInternetReachable;

      const loc = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), 5000),
        ),
      ]);
      const latitude = (loc as any).coords.latitude;
      const longitude = (loc as any).coords.longitude;

      if (isOnline) {
        // ✅ Just stage the pin — no upload, no Firestore write here.
        // The actual save happens on index.tsx once the user confirms.
        usePinStore.getState().setPendingPin({
          label: bestDetection.label,
          lat: latitude,
          lng: longitude,
          image: pinImage, // local URI/base64 — index.tsx uploads it on confirm
          timestamp: Date.now(),
        });

        setTimeout(() => {
          router.replace("/");
        }, 100);
      } else {
        useOfflinePinStore.getState().addOfflinePin({
          id: Date.now().toString(),
          label: bestDetection.label,
          lat: latitude,
          lng: longitude,
          image: offlineImage,
          timestamp: Date.now(),
        });

        Alert.alert(
          "Saved Offline",
          `${bestDetection.label} saved locally. Upload it from your Profile when you're back online.`,
        );

        isInferringRef.current = false;
        isPinningRef.current = false;
      }
    } catch (e) {
      console.log("Pin failed:", (e as Error).message);
      isInferringRef.current = false;
      isPinningRef.current = false;
      Alert.alert("Error", "Could not get location. Please try again.");
    }
  };

  if (model.state === "loading") {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#4CAF50" />
        <Text style={styles.permText}>Loading YOLOv8 model…</Text>
      </View>
    );
  }

  if (model.state === "error") {
    return (
      <View style={styles.center}>
        <Text style={styles.permText}>
          Model failed to load: {String(model.error)}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          setCameraDims({ width, height });
        }}
        facing="back"
      >
        {isPaused && capturedFrame && (
          <Image
            source={{ uri: capturedFrame }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
          />
        )}

        {detections.length > 0 &&
          cameraDims.width > 0 &&
          detections.map((detection, i) => {
            const isBest = i === 0;
            const color = isBest
              ? "#4CAF50"
              : getDetectionColor(detection.label);

            return (
              <View
                key={`${detection.label}-${i}`}
                pointerEvents="none"
                style={{
                  position: "absolute",
                  left: detection.bbox.x * cameraDims.width,
                  top: detection.bbox.y * cameraDims.height,
                  width: detection.bbox.width * cameraDims.width,
                  height: detection.bbox.height * cameraDims.height,
                  borderWidth: isBest ? 2.5 : 1.5,
                  borderColor: color,
                  borderRadius: 4,
                }}
              >
                {isBest &&
                  CORNER_POSITIONS.map((pos, cornerIdx) => (
                    <View
                      key={cornerIdx}
                      style={[
                        styles.cornerMarker,
                        getCornerBorderStyle(cornerIdx),
                        pos,
                      ]}
                    />
                  ))}
              </View>
            );
          })}

        <View style={styles.liveIndicator}>
          <View
            style={[
              styles.liveDot,
              {
                backgroundColor: isPaused
                  ? "#FF5722"
                  : isInferring
                    ? "#FFC107"
                    : "#4CAF50",
              },
            ]}
          />
          <Text style={styles.liveText}>
            {isPaused
              ? "Paused"
              : isInferring
                ? "Analyzing…"
                : detections.length > 0
                  ? `${detections.length} detected`
                  : "Ready"}
          </Text>
        </View>

        {/* New: legend info button */}
        <TouchableOpacity
          style={styles.legendInfoBtn}
          onPress={() => setShowLegendModal(true)}
          activeOpacity={0.7}
        >
          <Ionicons name="information-circle-outline" size={22} color="#fff" />
        </TouchableOpacity>

        {!isPaused && (
          <TouchableOpacity
            style={styles.scanBtn}
            onPress={handleScanPress}
            disabled={isInferring}
            activeOpacity={0.8}
          >
            {isInferring ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.scanBtnText}>📷 Scan Plant</Text>
            )}
          </TouchableOpacity>
        )}
      </CameraView>

      {detections.length > 0 && (
        <View style={styles.resultsPanel}>
          <View style={styles.resultRow}>
            <View style={styles.resultInfo}>
              <Text style={styles.resultsTitle}>Detected Plant</Text>
              <Text style={styles.resultItem}>
                🌿 {getBestDetection(detections)?.label}
              </Text>
              <Text style={styles.confidenceText}>
                {(
                  (getBestDetection(detections)?.confidence ?? 0) * 100
                ).toFixed(1)}
                % confidence
              </Text>
            </View>

            <View style={styles.actionBtnsColumn}>
              <TouchableOpacity
                style={styles.pinBtn}
                onPress={handlePinThis}
                activeOpacity={0.8}
              >
                <Text style={styles.pinBtnIcon}>📍</Text>
                <Text style={styles.pinBtnText}>Pin This</Text>
              </TouchableOpacity>

              <View style={styles.secondaryActionsRow}>
                <TouchableOpacity
                  style={styles.secondaryActionBtn}
                  onPress={() => setShowStatsModal(true)}
                  activeOpacity={0.8}
                >
                  <Ionicons name="stats-chart" size={14} color="#666" />
                  <Text style={styles.secondaryActionText}>Stats</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.secondaryActionBtn}
                  onPress={handleResume}
                  activeOpacity={0.8}
                >
                  <Text style={styles.secondaryActionText}>✕ Skip</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      )}

      {detections.length === 0 && isPaused && (
        <View style={styles.hintPanel}>
          <Text style={styles.hintText}>No plant detected. Try again.</Text>
          <TouchableOpacity onPress={handleResume} style={{ marginTop: 8 }}>
            <Text style={styles.retryText}>↻ Scan Again</Text>
          </TouchableOpacity>
        </View>
      )}

      <Modal
        visible={showStatsModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowStatsModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.statsModalContent}>
            <Text style={styles.title}>Frame Statistics</Text>

            {/* Total count */}
            <View style={styles.statsSummaryRow}>
              <View style={styles.statsSummaryCard}>
                <Text style={styles.statsSummaryNumber}>
                  {detections.length}
                </Text>
                <Text style={styles.statsSummaryLabel}>Total Detected</Text>
              </View>
              <View style={styles.statsSummaryCard}>
                <Text style={styles.statsSummaryNumber}>
                  {detections.filter((d) => d.confidence < 0.6).length}
                </Text>
                <Text style={styles.statsSummaryLabel}>Low Confidence</Text>
              </View>
            </View>

            {/* Per-species breakdown */}
            <Text style={styles.sectionLabel}>Species Breakdown</Text>
            <ScrollView style={styles.statsList}>
              {Object.entries(
                detections.reduce(
                  (acc, det) => {
                    acc[det.label] = (acc[det.label] ?? 0) + 1;
                    return acc;
                  },
                  {} as Record<string, number>,
                ),
              ).map(([species, count]) => (
                <View key={species} style={styles.statsListItem}>
                  <View
                    style={[
                      styles.statsSpeciesDot,
                      { backgroundColor: getDetectionColor(species) },
                    ]}
                  />
                  <Text style={styles.statsListLabel}>{species}</Text>
                  <Text style={styles.statsListCount}>{count}</Text>
                </View>
              ))}
            </ScrollView>

            {/* Per-detection confidence list */}
            <Text style={styles.sectionLabel}>All Detections</Text>
            <ScrollView style={styles.statsList}>
              {detections.map((det, i) => (
                <View key={i} style={styles.statsListItem}>
                  <View
                    style={[
                      styles.confidenceBadge,
                      det.confidence < 0.6 && styles.confidenceBadgeLow,
                    ]}
                  >
                    <Text
                      style={[
                        styles.confidenceBadgeText,
                        det.confidence < 0.6 && styles.confidenceBadgeTextLow,
                      ]}
                    >
                      {(det.confidence * 100).toFixed(0)}%
                    </Text>
                  </View>
                  <Text style={styles.statsListLabel}>{det.label}</Text>
                  {i === 0 && <Text style={styles.bestBadge}>Best</Text>}
                </View>
              ))}
            </ScrollView>

            <TouchableOpacity
              style={[styles.secondaryButton, { marginTop: 12 }]}
              onPress={() => setShowStatsModal(false)}
            >
              <Text style={styles.secondaryButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showLegendModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowLegendModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.legendModalContent}>
            <Text style={styles.title}>Box Color Legend</Text>

            <View style={styles.legendItem}>
              <View style={[styles.legendSwatch, { borderColor: "#4CAF50" }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.legendItemTitle}>Best Detection</Text>
                <Text style={styles.legendItemSubtitle}>
                  Highest confidence — this is the one that gets pinned
                </Text>
              </View>
            </View>

            {CLASS_NAMES.map((species) => (
              <View key={species} style={styles.legendItem}>
                <View
                  style={[
                    styles.legendSwatch,
                    { borderColor: getDetectionColor(species) },
                  ]}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.legendItemTitle}>{species}</Text>
                  <Text style={styles.legendItemSubtitle}>
                    Detected, but not the top match
                  </Text>
                </View>
              </View>
            ))}

            <TouchableOpacity
              style={[styles.secondaryButton, { marginTop: 12 }]}
              onPress={() => setShowLegendModal(false)}
            >
              <Text style={styles.secondaryButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  scanBtn: {
    position: "absolute",
    bottom: 24,
    alignSelf: "center",
    backgroundColor: "#4CAF50",
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 30,
    flexDirection: "row",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  scanBtnText: {
    color: "white",
    fontSize: 16,
    fontWeight: "700",
  },
  container: { flex: 1, backgroundColor: "#000" },
  camera: { flex: 1, width: "100%", height: "100%" },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#111",
  },
  permText: {
    color: "#fff",
    marginBottom: 12,
    textAlign: "center",
    paddingHorizontal: 20,
  },
  liveIndicator: {
    position: "absolute",
    top: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
    gap: 6,
  },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  liveText: { color: "#fff", fontSize: 12, fontWeight: "600" },
  resultsPanel: {
    position: "absolute",
    bottom: 40,
    left: 16,
    right: 16,
    borderRadius: 16,
    gap: 8,
  },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(235, 245, 236, 0.75)", // Translucent green overlay background
    padding: 16,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: COLORS.border,
  },
  resultInfo: {
    flex: 1,
    paddingRight: 12,
  },
  resultsTitle: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  resultItem: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.textPrimary,
    marginBottom: 4,
  },
  confidenceText: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.green700,
  },
  actionBtnsColumn: {
    gap: 8,
  },
  secondaryActionsRow: {
    flexDirection: "row",
    gap: 6,
  },
  secondaryActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    backgroundColor: "#F0F0F0",
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    flex: 1,
  },
  secondaryActionText: {
    fontSize: 8,
    fontWeight: "600",
    color: "#666",
  },
  pinBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.green700,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  pinBtnIcon: {
    fontSize: 14,
    marginRight: 4,
  },
  pinBtnText: {
    color: COLORS.white,
    fontWeight: "700",
    fontSize: 13,
  },
  resumeBtn: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  resumeBtnText: {
    color: COLORS.textSecondary,
    fontWeight: "600",
    fontSize: 13,
  },
  othersLabel: { color: "#888", fontSize: 12 },
  othersText: { color: "#ccc", fontSize: 12, flex: 1 },
  hintPanel: {
    position: "absolute",
    bottom: 40,
    alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  hintText: { color: "#aaa", fontSize: 14 },
  bbox: {
    position: "absolute",
    borderWidth: 2,
    borderColor: "#4CAF50",
    borderRadius: 4,
  },
  bboxLabel: {
    backgroundColor: "#4CAF50",
    color: "#fff",
    fontSize: 11,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  detectionLabel: {
    position: "absolute",
    top: -24,
    left: -2,
    backgroundColor: "#4CAF50",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  detectionLabelText: {
    color: "white",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  cornerMarker: {
    position: "absolute",
    width: 12,
    height: 12,
    borderColor: "#fff",
  },
  retryText: {
    color: "#4CAF50",
    fontWeight: "600",
  },
  otherDetectionsList: {
    marginTop: 6,
  },
  otherDetectionText: {
    fontSize: 11,
    color: "#666",
    marginTop: 2,
  },
  resultsTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  statsIconBtn: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(76, 175, 80, 0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  statsModalContent: {
    width: "90%",
    maxWidth: 400,
    maxHeight: "75%",
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 18,
  },
  statsSummaryRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
    marginBottom: 16,
  },
  statsSummaryCard: {
    flex: 1,
    backgroundColor: "#F5F5F5",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  statsSummaryNumber: {
    fontSize: 24,
    fontWeight: "700",
    color: "#2E7D32",
  },
  statsSummaryLabel: {
    fontSize: 11,
    color: "#757575",
    marginTop: 2,
    textAlign: "center",
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#2E7D32",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 4,
  },
  statsList: {
    maxHeight: 140,
    marginBottom: 12,
  },
  statsListItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    gap: 8,
  },
  statsSpeciesDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  statsListLabel: {
    flex: 1,
    fontSize: 13,
    color: "#333",
  },
  statsListCount: {
    fontSize: 13,
    fontWeight: "700",
    color: "#2E7D32",
  },
  confidenceBadge: {
    backgroundColor: "rgba(76, 175, 80, 0.12)",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    minWidth: 44,
    alignItems: "center",
  },
  confidenceBadgeLow: {
    backgroundColor: "rgba(255, 87, 34, 0.12)",
  },
  confidenceBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#2E7D32",
  },
  confidenceBadgeTextLow: {
    color: "#FF5722",
  },
  bestBadge: {
    fontSize: 10,
    fontWeight: "700",
    color: "#fff",
    backgroundColor: "#4CAF50",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  secondaryButton: {
    backgroundColor: "rgba(76, 175, 80, 0.08)",
    borderWidth: 1.5,
    borderColor: "#4CAF50",
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonText: {
    color: "#4CAF50",
    fontSize: 14,
    fontWeight: "700",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  title: {
    fontSize: 17,
    fontWeight: "700",
    color: "#1B1B1B",
  },
  legendInfoBtn: {
    position: "absolute",
    top: 16,
    right: 16,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
  legendModalContent: {
    width: "88%",
    maxWidth: 380,
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 18,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: "#eee",
  },
  legendSwatch: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 3,
    backgroundColor: "transparent",
  },
  legendItemTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
  },
  legendItemSubtitle: {
    fontSize: 11,
    color: "#888",
    marginTop: 2,
  },
});
