import React, { useState, useEffect } from "react";
import { SpeciesPin } from "../MapComponent";
import { Modal } from "react-native";
import { View, StyleSheet, Text, Image, Alert } from "react-native";
import { TouchableOpacity, ScrollView } from "react-native";
import { router } from "expo-router";
import { doc, getDoc } from "firebase/firestore";
import { db, auth } from "../../firebaseConfig";
import * as ImagePicker from "expo-image-picker";
import { PinVerification } from "../MapComponent"; // Import the PinVerification type
import { COLORS } from "../../constants/Colors";

interface PinModalProp {
  visible: boolean;
  onClose: () => void;
  pinData: SpeciesPin | null;
  onSave?: (data: SpeciesPin, mode: "view" | "create") => void; // ✅ mode added
  mode: "view" | "create";
  setHighlightedNeighborId?: (id: string | null) => void;
  onVerify?: (pinId: string, isVisible: boolean) => void;
  canVerify?: boolean; // ✅ new — is the user physically near this pin?
}
const PinModal = ({
  visible,
  onClose,
  onSave,
  pinData,
  mode,
  onVerify,
  canVerify,
}: PinModalProp) => {
  const [creatorName, setCreatorName] = useState<string>("Loading...");
  const [previewImageUri, setPreviewImageUri] = useState<string | null>(null);
  // ✅ Guard against null pinData inside the initializer instead
  const [images, setImages] = useState<string[]>(pinData?.images ?? []);
  const [showVerificationLog, setShowVerificationLog] = useState(false);

  useEffect(() => {
    setImages(pinData?.images ?? []);
  }, [pinData]);

  const [localVerifications, setLocalVerifications] = useState<
    PinVerification[]
  >(pinData?.verifications ?? []);

  useEffect(() => {
    setLocalVerifications(pinData?.verifications ?? []);
  }, [pinData]);

  useEffect(() => {
    let isMounted = true;

    const fetchCreatorDetails = async () => {
      if (!pinData) return; // ✅ guard inside the effect body instead
      if (pinData?.creator?.username) {
        setCreatorName(pinData.creator.username);
        return;
      }
      if (pinData?.created_by) {
        setCreatorName(pinData.created_by);
        return;
      }
      if (pinData?.userId) {
        try {
          const userDocRef = doc(db, "users", pinData.userId);
          const userDocSnap = await getDoc(userDocRef);
          if (isMounted) {
            if (userDocSnap.exists()) {
              const userData = userDocSnap.data();
              setCreatorName(
                userData.username || userData.displayName || "Unknown User",
              );
            } else {
              setCreatorName("Unknown User");
            }
          }
        } catch (error) {
          console.error("Error fetching creator user:", error);
          if (isMounted) setCreatorName("Unknown User");
        }
      } else {
        setCreatorName("Unknown User");
      }
    };

    fetchCreatorDetails();

    return () => {
      isMounted = false;
    };
  }, [pinData]);

  const handleVerifyPress = (isVisible: boolean) => {
    if (!pinData) return;
    const currentUser = auth.currentUser;
    if (!currentUser) return;

    if (!canVerify) {
      Alert.alert(
        "Too far away",
        "You need to be near this pin's location to verify it.",
      );
      return;
    }

    onVerify?.(String(pinData.id), isVisible);

    setLocalVerifications((prev) => [
      ...prev,
      {
        timestamp: Date.now(),
        verified: isVisible,
        userId: currentUser.uid,
        userName: currentUser.displayName || currentUser.email || "Anonymous", // ← new
      },
    ]);
  };

  const isCreateMode = mode === "create";
  const MAX_EXTRA_IMAGES = 3;

  const handleAddPhoto = async () => {
    if (images.length >= MAX_EXTRA_IMAGES) {
      Alert.alert(
        "Limit reached",
        `You can only add up to ${MAX_EXTRA_IMAGES} extra photos.`,
      );
      return;
    }
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        "Permission needed",
        "Please allow photo library access to add more photos.",
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.5,
      base64: false,
    });
    if (!result.canceled && result.assets?.[0]?.uri) {
      setImages((prev) => [...prev, result.assets[0].uri]);
    }
  };

  const handleRemovePhoto = (uriToRemove: string) => {
    setImages((prev) => prev.filter((uri) => uri !== uriToRemove));
  };

  const handleSavePress = () => {
    if (!pinData) return;
    onSave?.({ ...pinData, images }, mode);
  };

  // ✅ Early return now comes AFTER every hook has been called
  if (!pinData) return null;

  const currentUser = auth.currentUser;
  const isOwner =
    isCreateMode ||
    (!!currentUser &&
      (pinData.userId === currentUser.uid ||
        pinData.creator?.uid === currentUser.uid));

  return (
    <Modal visible={visible} animationType="fade" transparent={true}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <Text style={styles.title}>
            {isCreateMode ? "Add New Pin" : "Pin Details"}
          </Text>

          <Image
            style={styles.plantImage}
            source={{
              uri: pinData.image_url || "https://via.placeholder.com/150",
            }}
          />

          {/* ✅ Extra photos strip */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.photoStrip}
            contentContainerStyle={{ gap: 8, paddingVertical: 4 }}
          >
            {images.map((uri, idx) => (
              <View key={`${uri}-${idx}`} style={styles.thumbWrapper}>
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={() => setPreviewImageUri(uri)}
                >
                  <Image source={{ uri }} style={styles.thumbImage} />
                </TouchableOpacity>

                {/* ✅ Only the owner can remove photos */}
                {isOwner && (
                  <TouchableOpacity
                    style={styles.thumbRemoveBtn}
                    onPress={() => handleRemovePhoto(uri)}
                  >
                    <Text style={styles.thumbRemoveText}>✕</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}

            {/* ✅ Only the owner can add more photos */}
            {isOwner && images.length < MAX_EXTRA_IMAGES && (
              <TouchableOpacity
                style={styles.addPhotoBtn}
                onPress={handleAddPhoto}
              >
                <Text style={styles.addPhotoBtnText}>
                  + Add Photo ({images.length}/{MAX_EXTRA_IMAGES})
                </Text>
              </TouchableOpacity>
            )}
          </ScrollView>

          <View style={styles.infoSection}>
            <View style={styles.infoRow}>
              <Text style={styles.label}>ID</Text>
              <Text style={styles.detailText}>{pinData.id}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.label}>Species</Text>
              <Text style={styles.detailText}>{pinData.specie_label}</Text>
            </View>

            <View style={styles.infoRow}>
              <Text style={styles.label}>Location</Text>
              <Text style={styles.detailText}>
                {pinData.latitude.toFixed(4)}, {pinData.longitude.toFixed(4)}
              </Text>
            </View>

            <TouchableOpacity
              style={styles.infoRow}
              onPress={() => {
                if (pinData.creator) {
                  onClose();
                  router.push({
                    pathname: "/profile",
                    params: {
                      userId: pinData.creator.uid,
                      username: pinData.creator.username,
                      email: pinData.creator.email,
                      pins_count: pinData.creator.pins_count,
                    },
                  });
                }
              }}
            >
              <Text style={styles.label}>Created by</Text>
              <Text
                style={[
                  styles.detailText,
                  { color: "#28a745", textDecorationLine: "underline" },
                ]}
              >
                {creatorName}
              </Text>
            </TouchableOpacity>
          </View>

          {!isCreateMode && (
            <View style={styles.verifySection}>
              <Text style={styles.label}>Still here?</Text>

              {localVerifications.length > 0 && (
                <TouchableOpacity
                  style={styles.verifyLogRow}
                  onPress={() => setShowVerificationLog(true)}
                >
                  <Text style={styles.lastVerifiedText}>
                    Last checked{" "}
                    {new Date(
                      localVerifications[localVerifications.length - 1]
                        .timestamp,
                    ).toLocaleDateString()}{" "}
                    •{" "}
                    {localVerifications[localVerifications.length - 1].verified
                      ? "✅ Confirmed"
                      : "❌ Not found"}
                  </Text>
                  <Text style={styles.viewLogLink}>
                    View log ({localVerifications.length}) ›
                  </Text>
                </TouchableOpacity>
              )}

              <View style={styles.verifyBtnRow}>
                <TouchableOpacity
                  style={[
                    styles.verifyYesBtn,
                    !canVerify && styles.verifyBtnDisabled,
                  ]}
                  onPress={() => handleVerifyPress(true)}
                  disabled={!canVerify}
                >
                  <Text
                    style={[
                      styles.verifyBtnText,
                      !canVerify && styles.verifyBtnTextDisabled,
                    ]}
                  >
                    Yes, still here
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.dangerButton,
                    !canVerify && styles.verifyBtnDisabled,
                  ]}
                  onPress={() => handleVerifyPress(false)}
                  disabled={!canVerify}
                >
                  <Text
                    style={[
                      styles.dangerButtonText,
                      !canVerify && styles.verifyBtnTextDisabled,
                    ]}
                  >
                    No, it's gone
                  </Text>
                </TouchableOpacity>
              </View>

              {!canVerify && (
                <Text style={styles.outOfRangeText}>
                  You must be near this pin to verify it.
                </Text>
              )}
            </View>
          )}

          <View style={styles.buttonContainer}>
            <TouchableOpacity
              style={[styles.secondaryButton, { flex: 1 }]}
              onPress={onClose}
            >
              <Text style={styles.secondaryButtonText}>
                {isCreateMode ? "Cancel" : "Close"}
              </Text>
            </TouchableOpacity>

            {/* ✅ Shown in both modes now, since photos can be added post-creation too */}
            {isOwner && (
              <TouchableOpacity
                style={[styles.primaryButton, { flex: 1.5 }]}
                onPress={handleSavePress}
              >
                <Text style={styles.primaryButtonText}>
                  {isCreateMode ? "Save Pin" : "Save Changes"}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
      {/* Fullscreen Image Preview Modal */}
      <Modal
        visible={Boolean(previewImageUri)}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setPreviewImageUri(null)}
      >
        <View style={styles.fullscreenOverlay}>
          {/* Close button in top-right corner */}
          <TouchableOpacity
            style={styles.fullscreenCloseBtn}
            onPress={() => setPreviewImageUri(null)}
          >
            <Text style={styles.fullscreenCloseText}>✕</Text>
          </TouchableOpacity>

          {/* Max View Image */}
          {previewImageUri && (
            <Image
              source={{ uri: previewImageUri }}
              style={styles.fullscreenImage}
              resizeMode="contain"
            />
          )}
        </View>
      </Modal>
      <Modal
        visible={showVerificationLog}
        transparent
        animationType="fade"
        onRequestClose={() => setShowVerificationLog(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.logModalContent}>
            <Text style={styles.title}>Verification history</Text>

            <ScrollView style={styles.logList}>
              {[...localVerifications].reverse().map((entry, idx) => (
                <View key={idx} style={styles.logEntry}>
                  <Text style={styles.logEntryIcon}>
                    {entry.verified ? "✅" : "❌"}
                  </Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.logEntryText}>
                      {entry.verified
                        ? "Confirmed present"
                        : "Reported missing"}
                    </Text>
                    <Text style={styles.logEntryMeta}>
                      by {entry.userName ?? "Unknown user"} •{" "}
                      {new Date(entry.timestamp).toLocaleString()}
                    </Text>
                  </View>
                </View>
              ))}
            </ScrollView>

            <TouchableOpacity
              style={[styles.secondaryButton, { marginTop: 12 }]}
              onPress={() => setShowVerificationLog(false)}
            >
              <Text style={styles.secondaryButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    // Dimmed Pastel Green as requested earlier
    backgroundColor: "rgba(200, 230, 201, 0.7)",
  },
  fullscreenOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.92)",
    justifyContent: "center",
    alignItems: "center",
  },
  fullscreenCloseBtn: {
    position: "absolute",
    top: 50,
    right: 20,
    zIndex: 10,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: "center",
    alignItems: "center",
  },
  fullscreenCloseText: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "bold",
  },
  fullscreenImage: {
    width: "95%",
    height: "80%",
  },
  modalContent: {
    width: "88%", // Slightly wider for a more balanced look
    padding: 24,
    backgroundColor: "#FFFFFF",
    borderRadius: 24, // Softer, more modern rounded corners

    // Smooth Elevation for iOS
    shadowColor: "#2e7d32", // Using green-tinted shadows for depth
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 20,

    // Elevation for Android
    elevation: 8,
  },
  plantImage: {
    width: "100%",
    height: 180, // Taller image for better impact
    borderRadius: 18,
    marginBottom: 20,
    backgroundColor: "#f0f0f0", // Placeholder color while loading
  },
  title: {
    fontSize: 24, // Bigger, bolder title
    fontWeight: "800", // Extra bold
    color: "#1b5e20", // Darker forest green for better contrast
    marginBottom: 6,
    letterSpacing: -0.5, // Tighter letter spacing looks more "designed"
  },

  // Extra: A "Chip" or "Label" style for metadata
  infoSection: {
    marginVertical: 10,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0", // Subtle separator lines
  },
  label: {
    fontSize: 12,
    fontWeight: "700",
    color: "#4CAF50",
    textTransform: "uppercase",
  },
  detailText: {
    fontSize: 15,
    color: "#333",
    fontWeight: "500",
  },
  interactiveRow: {
    // backgroundColor: "#f0f7ff", // Very light blue background to show it's clickable
    paddingHorizontal: 5,
    borderRadius: 5,
  },
  highlightText: {
    color: "#007AFF",
    fontWeight: "bold",
  },
  buttonContainer: {
    flexDirection: "row",
    gap: 12,
    marginTop: 20,
  },
  primaryButton: {
    backgroundColor: "#4CAF50",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  primaryButtonText: {
    color: "white",
    fontWeight: "bold",
    fontSize: 16,
  },
  secondaryButton: {
    backgroundColor: "#f5f5f5",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  secondaryButtonText: {
    color: "#666",
    fontWeight: "600",
    fontSize: 16,
  },
  photoStrip: {
    marginVertical: 8,
    maxHeight: 90,
  },
  thumbWrapper: {
    position: "relative",
    width: 70,
    height: 70,
  },
  thumbImage: {
    width: 70,
    height: 70,
    borderRadius: 8,
  },
  verifySection: {
    marginTop: 6,
  },
  lastVerifiedText: {
    fontSize: 12,
    color: "#666",
    marginTop: 4,
    marginBottom: 8,
  },
  verifyBtnRow: {
    flexDirection: "row",
    gap: 8,
  },
  verifyYesBtn: {
    flex: 1,
    backgroundColor: "rgba(232, 245, 233, 0.9)",
    borderWidth: 1,
    borderColor: COLORS.green700,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  verifyNoBtn: {
    flex: 1,
    backgroundColor: COLORS.pinRed,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
  },
  verifyBtnText: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.green700,
  },
  dangerButton: {
    backgroundColor: "rgba(229, 57, 53, 0.08)",
    borderWidth: 1,
    borderColor: COLORS.pinRed,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  dangerButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.pinRed,
  },
  verifyBtnDisabled: {
    backgroundColor: "#E0E0E0", // neutral gray fill, no colored border/tint bleeding through
    borderColor: "#E0E0E0", // in case either button normally has a colored border
  },
  verifyBtnTextDisabled: {
    color: "#9E9E9E", // muted gray text, clearly reads as "inactive"
  },
  outOfRangeText: {
    fontSize: 11,
    color: "#999",
    fontStyle: "italic",
    marginTop: 6,
    textAlign: "center",
  },
  thumbRemoveBtn: {
    position: "absolute",
    top: -6,
    right: -6,
    backgroundColor: "#e53935",
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  thumbRemoveText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
  addPhotoBtn: {
    width: 70,
    height: 70,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#4CAF50",
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  verifyLogRow: {
    marginTop: 4,
    marginBottom: 8,
  },
  viewLogLink: {
    fontSize: 12,
    color: "#28a745",
    fontWeight: "600",
    marginTop: 2,
  },
  logModalContent: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 20,
    width: "85%",
    maxHeight: "70%",
  },
  logList: {
    marginTop: 12,
    maxHeight: 300,
  },
  logEntry: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: "#eee",
  },
  logEntryIcon: {
    fontSize: 18,
  },
  logEntryText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
  },
  logEntryDate: {
    fontSize: 12,
    color: "#888",
    marginTop: 2,
  },
  addPhotoBtnText: {
    color: "#4CAF50",
    fontSize: 11,
    fontWeight: "600",
    textAlign: "center",
  },
  logEntryMeta: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
});

export default PinModal;
