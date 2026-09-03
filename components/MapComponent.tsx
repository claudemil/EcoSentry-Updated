import React, { useRef, forwardRef, useImperativeHandle } from "react";
import { Alert, Modal, Platform, Pressable, TextInput } from "react-native";
import Mapbox from "@rnmapbox/maps";
import { View, StyleSheet, Text, TouchableOpacity } from "react-native";
import * as Location from "expo-location";
import { useState, useEffect } from "react";
import { Ionicons } from "@expo/vector-icons";
import * as turf from "@turf/turf";
import PinModal from "./ui/PinModal";
import { router, useLocalSearchParams } from "expo-router";
import NetInfo from "@react-native-community/netinfo";
import { downloadBacolodMap, isBacolodMapDownloaded } from "@/utils/offlineMap";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { auth, db } from "../firebaseConfig";
import { COLORS } from "../constants/Colors";

Mapbox.setAccessToken(
  "pk.eyJ1Ijoiam9zaHZhbCIsImEiOiJjbW1oNmR5cHMwYzc3MnJxN3ViZzQ3aDZvIn0.0ZfS7GPnTx__wgyu4ryzCQ",
);

let MapView: any;
if (Platform.OS !== "web") {
  MapView = require("@rnmapbox/maps").default;
}

export interface User {
  id: number;
  username: string;
  email: string;
  pins_count: number;
}
export type PinVerification = {
  timestamp: number;
  verified: boolean;
  userId: string;
  userName?: string; // ← new, denormalized at write time
};

export interface SpeciesPin {
  id: number | string;
  longitude: number;
  latitude: number;
  specie_label: string;
  created_by?: string;
  image_url: string;
  images?: string[];
  userId?: string; // Firestore Auth UID (recommended)
  color?: string; // Optional badge color cache
  creator?: AppUser | null; // Nested user details
  createdAt?: string;
  verifications?: PinVerification[];
}

interface ZoneConfig {
  title: string;
  reasonLabel: string;
}

export const ZONE_CONFIG: Record<ZoneCategory, ZoneConfig> = {
  beneficial: {
    title: "Beneficial Zone",
    reasonLabel: "ECOLOGICAL BENEFITS",
  },
  negative: {
    title: "Negative Zone",
    reasonLabel: "ECOLOGICAL IMPACT",
  },
  neutral: {
    title: "Neutral Zone",
    reasonLabel: "ADDITIONAL INFORMATION",
  },
};

type ZoneCategory = "beneficial" | "negative" | "neutral";

type ZonePoint = { lng: number; lat: number };

type MapZone = {
  id: string;
  category: ZoneCategory;
  coordinates: ZonePoint[]; // ✅ was [number, number][]
  createdBy: string;
  createdAt: string;
  species?: string[]; // ✅ now an array of species labels
  description?: string; // optional description for the zone
  createdByName?: string; // ← new, optional since old docs won't have it
};

const ZONE_COLORS: Record<ZoneCategory, string> = {
  beneficial: "#4CAF50",
  negative: "#E53935",
  neutral: "#FFC107",
};

interface MapComponentProps {
  pins: SpeciesPin[];
  onPinAdded: (pin: SpeciesPin) => void;
  onSave?: (pin: SpeciesPin, mode: "view" | "create") => Promise<void>;
  userLocation: { longitude: number; latitude: number } | null;
  onLocationChange: (coords: { longitude: number; latitude: number }) => void;
  selectedSpecies: string;
  onSpeciesChange: (s: string) => void;
  isLoggedIn: boolean;
  highlightPinId?: string;
  onVerify?: (pinId: string, isVisible: boolean) => void;
  onStatusChange: (s: string) => void;
}

export interface AppUser {
  uid: string; // Firebase user.uid
  email: string | null;
  username?: string;
  pins_count?: number;
  zones_count?: number;
  isProfessional?: boolean; // optional, for future use
}

export interface MapComponentHandle {
  centerOnUser: () => Promise<void>;
  openCreatePin: (pin: SpeciesPin) => void;
  startDrawingZone: () => void;
}

const MapComponent = forwardRef<MapComponentHandle, MapComponentProps>(
  (
    {
      pins,
      userLocation,
      onLocationChange,
      onSpeciesChange,
      selectedSpecies,
      isLoggedIn,
      onSave,
      highlightPinId,
      onVerify,
      onStatusChange,
    },
    ref,
  ) => {
    const [isMapReady, setIsMapReady] = useState(false);
    const [hasJumped, setHasJumped] = useState(false);
    const cameraRef = useRef<Mapbox.Camera>(null);
    const [pendingPin, setPendingPin] = useState<SpeciesPin | null>(null);
    const [user, setUser] = useState<AppUser | null>(null);
    const [hasPermission, setHasPermission] = useState(false);
    const [isLegendOpen, setIsLegendOpen] = useState(false);
    const [highlightedNeighborId, setHighlightedNeighborId] = useState<
      string | null
    >(null);

    const [isPinModalOpen, setisPinModalOpen] = useState(false);
    const [isAddPinModalOpen, setisAddPinModalOpen] = useState(false);
    const [selectedPinId, setselectedPinId] = useState<number | null>(null);
    const [isFilterOpen, setIsFilterOpen] = useState(false);
    const verificationOptions = ["All", "Confirmed", "Reported Missing"];
    const [selectedVerification, setSelectedVerification] = useState("All");
    const [isVerifyFilterOpen, setIsVerifyFilterOpen] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isDrawingMode, setIsDrawingMode] = useState(false);
    const [editingZoneId, setEditingZoneId] = useState<string | null>(null);
    const [drawnPoints, setDrawnPoints] = useState<[number, number][]>([]);
    const [showCategoryPicker, setShowCategoryPicker] = useState(false);
    const [zones, setZones] = useState<MapZone[]>([]);
    // New state
    const [showSpeciesPicker, setShowSpeciesPicker] = useState(false); // new
    const [pendingCategory, setPendingCategory] = useState<ZoneCategory | null>(
      null,
    ); // new
    const [selectedSpeciesZone, setSelectedSpeciesZone] = useState<string[]>(
      [],
    ); // new — multi-select
    const [selectedZone, setSelectedZone] = useState<MapZone | null>(null);
    const [isZoneDetailOpen, setIsZoneDetailOpen] = useState(false);
    const [zoneDescription, setZoneDescription] = useState("");

    useEffect(() => {
      if (highlightPinId) {
        setHighlightedNeighborId(highlightPinId);

        // Optional: also pan the camera to that pin, if you have pins + a camera ref here
        const targetPin = pins.find((p) => String(p.id) === highlightPinId);
        if (targetPin && cameraRef.current) {
          cameraRef.current.setCamera({
            centerCoordinate: [targetPin.longitude, targetPin.latitude],
            zoomLevel: 32,
            animationDuration: 500,
          });
        }
      }
    }, [highlightPinId, pins]);
    useImperativeHandle(ref, () => ({
      centerOnUser: handleCenterOnUser,
      openCreatePin: (pin: SpeciesPin) => {
        setPendingPin({
          ...pin,
          created_by: user?.username, // ← attach user here
          creator: user, // ← and here
        });
        setisAddPinModalOpen(true);
      },
      startDrawingZone: () => setIsDrawingMode(true),
    }));

    // Web guard — must be after ALL hooks
    if (Platform.OS === "web") {
      return <div>Web Map Not Loaded in Native</div>;
    }

    // ── NEW: clear user when logged out ──────────────────────────────────────
    useEffect(() => {
      // If not logged in, reset user state
      if (!isLoggedIn) {
        setUser(null);
        if (selectedSpecies === "My Pins") {
          onSpeciesChange("All");
        }
        return;
      }

      // If logged in, fetch profile details from Firestore using active Firebase session
      const loadUser = async () => {
        const firebaseUser = auth.currentUser;
        if (!firebaseUser) {
          setUser(null);
          return;
        }

        try {
          const userDocRef = doc(db, "users", firebaseUser.uid);
          const userDoc = await getDoc(userDocRef);

          if (userDoc.exists()) {
            const userData = userDoc.data();
            setUser({
              uid: firebaseUser.uid,
              email: firebaseUser.email,
              username: userData.username || "",
              pins_count: userData.pins_count || 0,
              ...userData,
            });
            console.log("User loaded in MapComponent:", userData);
          }
        } catch (e) {
          console.error("Error loading user in MapComponent:", e);
        }
      };

      loadUser();
    }, [isLoggedIn]); // re-runs on login AND logout

    const handleViewCreatorProfile = async (zone: MapZone) => {
      if (!zone.createdBy) return;

      try {
        const userDocRef = doc(db, "users", zone.createdBy);
        const userDoc = await getDoc(userDocRef);

        if (!userDoc.exists()) {
          Alert.alert("Not found", "This user's profile could not be found.");
          return;
        }

        const userData = userDoc.data();

        router.push({
          pathname: "/profile",
          params: {
            userId: zone.createdBy,
            username: userData.username ?? zone.createdByName ?? "Unknown",
            email: userData.email ?? "",
            pins_count: String(userData.pins_count ?? 0), // router params must be strings
          },
        });
      } catch (e) {
        console.error("Failed to load user profile:", e);
        Alert.alert(
          "Error",
          "Could not load this user's profile. Please try again.",
        );
      }
    };

    const getGeofence = () => {
      if (
        !userLocation ||
        userLocation.longitude === undefined ||
        userLocation.latitude === undefined
      ) {
        return null;
      }
      const center: [number, number] = [
        userLocation.longitude,
        userLocation.latitude,
      ];
      const radius = 0.015;
      const options = { steps: 64, units: "kilometers" as const };
      return turf.circle(center, radius, options);
    };

    const geofencePolygon = getGeofence();
    const isPinWithinGeofence = (pin: SpeciesPin | null): boolean => {
      if (!pin || !userLocation?.latitude || !userLocation?.longitude) {
        return false;
      }

      const from = turf.point([userLocation.longitude, userLocation.latitude]);
      const to = turf.point([pin.longitude, pin.latitude]);
      const distanceKm = turf.distance(from, to, { units: "kilometers" });

      const GEOFENCE_RADIUS_KM = 0.015; // same radius as getGeofence()
      return distanceKm <= GEOFENCE_RADIUS_KM;
    };

    useEffect(() => {
      const requestPerms = async () => {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
          console.error("Permissions denied!");
        }
        setHasPermission(true);
      };
      requestPerms();
    }, []);

    const fetchZones = async () => {
      try {
        const snapshot = await getDocs(collection(db, "zones"));
        const formatted: MapZone[] = snapshot.docs.map((doc) => {
          const data = doc.data();
          return {
            id: doc.id,
            category: data.category,
            description: data.description,
            coordinates: data.coordinates, // stays as {lng, lat}[] in state
            createdBy: data.createdBy,
            createdAt: data.createdAt?.toDate
              ? data.createdAt.toDate().toISOString()
              : new Date().toISOString(),
            species: data.species ?? [], // default to empty array if missing
            createdByName: data.createdByName,
          };
        });
        setZones(formatted);
      } catch (e) {
        console.error("Failed to fetch zones:", e);
      }
    };

    useEffect(() => {
      fetchZones();
    }, []);

    const handleSaveZone = async (
      category: ZoneCategory,
      species: string[],
      description: string,
    ) => {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        Alert.alert("Login required", "Please log in to draw a zone.");
        return;
      }
      if (drawnPoints.length < 3) return;
      if (species.length === 0) return;

      const closedRing = [...drawnPoints, drawnPoints[0]];
      const firestoreCoords: ZonePoint[] = closedRing.map(([lng, lat]) => ({
        lng,
        lat,
      }));

      try {
        if (editingZoneId) {
          // Update existing zone — no count change, owner isn't changing
          await updateDoc(doc(db, "zones", editingZoneId), {
            category,
            species,
            description: description.trim(),
            coordinates: firestoreCoords,
          });
        } else {
          // Create new zone
          await addDoc(collection(db, "zones"), {
            category,
            species,
            description: description.trim(),
            coordinates: firestoreCoords,
            createdBy: currentUser.uid,
            createdByName: user?.username || currentUser.email || "Anonymous",
            createdAt: serverTimestamp(),
          });

          // Increment the owner's zone count atomically
          await updateDoc(doc(db, "users", currentUser.uid), {
            zones_count: increment(1),
          });
        }
        await fetchZones();
      } catch (e) {
        console.error("Failed to save zone:", e);
        Alert.alert("Error", "Could not save this zone. Please try again.");
      } finally {
        setShowSpeciesPicker(false);
        setShowCategoryPicker(false);
        setPendingCategory(null);
        setSelectedSpeciesZone([]);
        setZoneDescription("");
        setIsDrawingMode(false);
        setDrawnPoints([]);
        setEditingZoneId(null);
      }
    };

    const handleDeleteZone = (zone: MapZone) => {
      Alert.alert(
        "Delete zone",
        "This will permanently remove this zone. Are you sure?",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: async () => {
              try {
                await deleteDoc(doc(db, "zones", zone.id));

                // Decrement the owner's zone count
                if (zone.createdBy) {
                  await updateDoc(doc(db, "users", zone.createdBy), {
                    zones_count: increment(-1),
                  });
                }

                await fetchZones();
                setIsZoneDetailOpen(false);
                setSelectedZone(null);
              } catch (e) {
                console.error("Failed to delete zone:", e);
                Alert.alert(
                  "Error",
                  "Could not delete this zone. Please try again.",
                );
              }
            },
          },
        ],
      );
    };

    const handleStartEditZone = async (zone: MapZone) => {
      if (!user?.isProfessional) {
        Alert.alert(
          "Professional accounts only",
          "Editing zones is limited to verified professional accounts (botanists, ecologists, or field researchers).",
        );
        return;
      }

      const currentUser = auth.currentUser;
      if (!currentUser) {
        Alert.alert("Login required", "Please log in to edit this zone.");
        return;
      }

      const network = await NetInfo.fetch();
      const isOnline = network.isConnected && network.isInternetReachable;
      if (!isOnline) {
        Alert.alert(
          "You're offline",
          "Editing zones requires an internet connection. Please try again once you're back online.",
        );
        return;
      }

      const openRing = zone.coordinates.slice(0, -1);
      const points: [number, number][] = openRing.map((p) => [p.lng, p.lat]);

      setDrawnPoints(points);
      setEditingZoneId(zone.id);
      setPendingCategory(zone.category);
      setSelectedSpeciesZone(
        Array.isArray(zone.species)
          ? zone.species
          : zone.species
            ? [zone.species]
            : [],
      );
      setZoneDescription(zone.description ?? "");
      setIsDrawingMode(true);

      setIsZoneDetailOpen(false);
      setSelectedZone(null);
    };

    const handleUndoPoint = () => {
      setDrawnPoints((prev) => prev.slice(0, -1));
    };

    const handleCancelDrawing = () => {
      setDrawnPoints([]);
      setIsDrawingMode(false);
      setEditingZoneId(null);
    };

    const handleFinishDrawing = () => {
      if (drawnPoints.length < 3) {
        Alert.alert(
          "Need more points",
          "Tap at least 3 points to form a zone.",
        );
        return;
      }
      setShowCategoryPicker(true);
    };

    const getPolygonCentroid = (
      points: { lng: number; lat: number }[],
    ): [number, number] => {
      let sumLng = 0;
      let sumLat = 0;
      points.forEach((p) => {
        sumLng += p.lng;
        sumLat += p.lat;
      });
      return [sumLng / points.length, sumLat / points.length];
    };

    const onUserLocationUpdate = (location: Mapbox.Location) => {
      if (isMapReady && !hasJumped && location.coords) {
        cameraRef.current?.setCamera({
          centerCoordinate: [
            location.coords.longitude,
            location.coords.latitude,
          ],
          zoomLevel: 16,
          animationMode: "flyTo",
          animationDuration: 1000,
        });
        setHasJumped(true);
      }
      const { longitude, latitude } = location.coords;
      onLocationChange({ longitude, latitude });
    };

    const handleCenterOnUser = async () => {
      try {
        const location = await Location.getCurrentPositionAsync({});
        cameraRef.current?.setCamera({
          centerCoordinate: [
            location.coords.longitude,
            location.coords.latitude,
          ],
          zoomLevel: 20,
          animationDuration: 1000,
        });
        console.log("panning...");
      } catch (e) {
        console.log("Could not get location", e);
      }
    };

    const handleMapPress = (e: any) => {
      if (!isDrawingMode) return;
      const [lng, lat] = e.geometry.coordinates;
      setDrawnPoints((prev) => [...prev, [lng, lat] as [number, number]]);
    };

    const SPECIES_COLORS: Record<string, string> = {
      "Water Hyacinth": "#1E88E5",
      "Water Lettuce": "#00897B",
      "Siam Weed": "#D81B60",
      "Lantana Camara": "#6D4C41",
    };

    const getSpeciesColor = (label: string) =>
      SPECIES_COLORS[label] ?? "#757575"; // grey fallback
    const currentUser = auth.currentUser;
    const speciesOptions = [
      "Water Hyacinth",
      "Water Lettuce",
      "Siam Weed",
      "Lantana Camara",
      "All",
      ...(currentUser || user ? ["My Pins"] : []),
    ];

    const filteredPins = pins
      .filter((pin) => {
        // existing species filter logic
        if (selectedSpecies === "All") return true;
        if (selectedSpecies === "My Pins") {
          const currentUser = auth.currentUser;
          if (!currentUser) return false; // not logged in — no pins can be "mine"
          return pin.userId === currentUser.uid;
        }
        return pin.specie_label === selectedSpecies;
      })
      .filter((pin) => {
        if (selectedVerification === "All") return true;

        const verifications = pin.verifications ?? [];
        const last =
          verifications.length > 0
            ? verifications[verifications.length - 1]
            : null;

        if (selectedVerification === "Not Checked") return last === null;
        if (selectedVerification === "Confirmed")
          return last?.verified === true;
        if (selectedVerification === "Reported Missing")
          return last?.verified === false;

        return true;
      });

    return (
      <View style={styles.container}>
        <Mapbox.MapView
          style={styles.map}
          onDidFinishLoadingMap={async () => {
            setIsMapReady(true);

            // ✅ Trigger offline map download after map is confirmed ready
            try {
              const network = await NetInfo.fetch();
              if (!network.isConnected || !network.isInternetReachable) {
                console.log("[OFFLINE MAP] Skipping — offline");
                return;
              }

              const already = await isBacolodMapDownloaded();
              if (already) {
                console.log("[OFFLINE MAP] Already cached");
                return;
              }

              console.log("[OFFLINE MAP] Starting download...");
              await downloadBacolodMap((pct) => {
                console.log(`[OFFLINE MAP] ${pct}%`);
              });
              console.log("[OFFLINE MAP] Done ✅");
            } catch (e) {
              console.log("[OFFLINE MAP] Failed:", e);
            }
          }}
          onPress={handleMapPress}
        >
          <Mapbox.Camera
            ref={cameraRef}
            defaultSettings={{
              centerCoordinate: [122.95, 10.6765], // ✅ Bacolod City center
              zoomLevel: 13,
            }}
          />
          <Mapbox.UserLocation visible={true} onUpdate={onUserLocationUpdate} />

          {geofencePolygon && (
            <Mapbox.ShapeSource
              id="geofence-source"
              shape={geofencePolygon as any}
            >
              <Mapbox.FillLayer
                id="geofence-fill"
                style={{ fillColor: "rgba(0, 128, 0, 0.2)" }}
              />
              <Mapbox.LineLayer
                id="geofence-line"
                style={{
                  lineDasharray: [2, 2],
                  lineColor: "green",
                  lineWidth: 2,
                }}
              />
            </Mapbox.ShapeSource>
          )}

          {filteredPins
            .map((pin) => {
              const lng = Number(pin.longitude);
              const lat = Number(pin.latitude);
              if (isNaN(lng) || isNaN(lat)) return null;

              const isHighlighted =
                String(pin.id) === String(highlightedNeighborId);
              const pinIdString = String(pin.id);
              const speciesColor = getSpeciesColor(pin.specie_label);
              const hasMultipleImages = (pin.images?.length ?? 0) > 0;

              const verifications = pin.verifications ?? [];
              const lastVerification =
                verifications.length > 0
                  ? verifications[verifications.length - 1]
                  : null;
              const isVerified = Boolean(lastVerification?.verified);

              const getBorderColor = () => {
                if (isHighlighted) return "#00E5FF";
                if (isVerified && hasMultipleImages) return "#FF6F00"; // verified + multiple images
                if (isVerified) return "#2E7D32"; // verified only
                if (hasMultipleImages) return "#ffd700"; // multiple images only
                return "#ffffff"; // default
              };

              const getBorderWidth = () => {
                if (isHighlighted) return 4;
                if (isVerified && hasMultipleImages) return 3.5;
                if (isVerified) return 3;
                if (hasMultipleImages) return 3;
                return 2;
              };

              return (
                <Mapbox.PointAnnotation
                  key={`annotation-${pinIdString}-${speciesColor}-${isHighlighted}-${hasMultipleImages}-${isVerified}`}
                  id={`marker-${pinIdString}`}
                  coordinate={[lng, lat]}
                  onSelected={() => {
                    setselectedPinId(pin.id as any);
                    setisPinModalOpen(true);
                    setHighlightedNeighborId(null);
                  }}
                >
                  <View style={{ width: 24, height: 24, position: "relative" }}>
                    <View
                      style={{
                        height: 24,
                        width: 24,
                        backgroundColor: isHighlighted
                          ? "#2196F3"
                          : speciesColor,
                        borderRadius: 12,
                        borderWidth: getBorderWidth(),
                        borderColor: getBorderColor(),
                      }}
                    />
                  </View>
                </Mapbox.PointAnnotation>
              );
            })
            .filter((el): el is React.JSX.Element => el !== null)}

          <PinModal
            visible={isPinModalOpen}
            mode="view"
            onSave={(finalData, mode) => {
              onSave?.(finalData!, mode);
              setisPinModalOpen(false);
            }}
            onClose={() => setisPinModalOpen(false)}
            pinData={(() => {
              if (!selectedPinId) return null;
              const foundPin = pins.find(
                (p) => String(p.id) == String(selectedPinId), // 👈 Strict string comparison fix!
              );
              if (!foundPin) {
                console.warn(
                  "Selected pin ID not found in pins state:",
                  selectedPinId,
                );
                return null;
              }
              return { ...foundPin };
            })()}
            setHighlightedNeighborId={setHighlightedNeighborId}
            onVerify={onVerify}
            canVerify={isPinWithinGeofence(
              selectedPinId
                ? pins.find((p) => String(p.id) === String(selectedPinId)) ||
                    null
                : null,
            )}
          />
          <PinModal
            visible={isAddPinModalOpen}
            mode="create"
            onSave={(finalData, mode) => {
              onSave?.(finalData!, mode);
              setisAddPinModalOpen(false);
            }}
            onClose={() => setisAddPinModalOpen(false)}
            pinData={pendingPin}
          />
          {/* Saved zones */}
          {zones.map((zone) => {
            const centroid = getPolygonCentroid(zone.coordinates);
            const speciesList: string[] = Array.isArray(zone.species)
              ? zone.species
              : zone.species
                ? [zone.species]
                : [];

            // Build a fingerprint of everything that can change on edit
            const zoneFingerprint = `${zone.category}-${speciesList.join(",")}-${zone.coordinates
              .map((p) => `${p.lat},${p.lng}`)
              .join("|")}`;

            return (
              <React.Fragment key={`${zone.id}-${zoneFingerprint}`}>
                <Mapbox.ShapeSource
                  id={`zone-source-${zone.id}`}
                  shape={{
                    type: "Feature",
                    geometry: {
                      type: "Polygon",
                      coordinates: [
                        zone.coordinates.map((p) => [p.lng, p.lat]),
                      ],
                    },
                    properties: {},
                  }}
                >
                  <Mapbox.FillLayer
                    id={`zone-fill-${zone.id}`}
                    style={{
                      fillColor: ZONE_COLORS[zone.category],
                      fillOpacity: 0.25,
                    }}
                  />
                  <Mapbox.LineLayer
                    id={`zone-line-${zone.id}`}
                    style={{
                      lineColor: ZONE_COLORS[zone.category],
                      lineWidth: 2,
                    }}
                  />
                </Mapbox.ShapeSource>

                <Mapbox.PointAnnotation
                  id={`zone-centroid-${zone.id}`}
                  coordinate={centroid}
                  onSelected={() => {
                    setSelectedZone(zone);
                    setIsZoneDetailOpen(true);
                  }}
                >
                  <View style={{ width: 40, height: 16, position: "relative" }}>
                    {speciesList.slice(0, 4).map((species, idx) => (
                      <View
                        key={species}
                        style={{
                          position: "absolute",
                          left: idx * 10,
                          width: 14,
                          height: 14,
                          borderRadius: 7,
                          backgroundColor: SPECIES_COLORS[species] ?? "#999",
                          borderWidth: 1.5,
                          borderColor: "#ffffff",
                          zIndex: 10 - idx,
                        }}
                      />
                    ))}
                  </View>
                </Mapbox.PointAnnotation>
              </React.Fragment>
            );
          })}

          {/* In-progress drawing preview */}
          {isDrawingMode && drawnPoints.length > 1 && (
            <Mapbox.ShapeSource
              id="drawing-preview"
              shape={{
                type: "Feature",
                geometry: { type: "LineString", coordinates: drawnPoints },
                properties: {},
              }}
            >
              <Mapbox.LineLayer
                id="drawing-line"
                style={{
                  lineColor: "#2196F3",
                  lineWidth: 3,
                  lineDasharray: [2, 2],
                }}
              />
            </Mapbox.ShapeSource>
          )}

          {isDrawingMode &&
            drawnPoints.map((pt, idx) => (
              <Mapbox.PointAnnotation
                key={`draw-pt-${idx}`}
                id={`draw-pt-${idx}`}
                coordinate={pt}
              >
                <View
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    backgroundColor: "#2196F3",
                    borderWidth: 2,
                    borderColor: "#fff",
                  }}
                />
              </Mapbox.PointAnnotation>
            ))}
        </Mapbox.MapView>
        {/* Species filter dropdown */}
        {isDrawingMode && (
          <View style={styles.drawControls}>
            <Text style={styles.drawHintText}>
              Tap the map to add points ({drawnPoints.length})
            </Text>
            <View style={styles.btnGroup}>
              <TouchableOpacity
                style={styles.drawCancelBtn}
                onPress={handleCancelDrawing}
                activeOpacity={0.7}
              >
                <Text style={styles.drawCancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.drawUndoBtn,
                  drawnPoints.length === 0 && styles.btnDisabled,
                ]}
                onPress={handleUndoPoint}
                disabled={drawnPoints.length === 0}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.drawUndoBtnText,
                    drawnPoints.length === 0 && styles.btnTextDisabled,
                  ]}
                >
                  Undo
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.drawDoneBtn}
                onPress={handleFinishDrawing}
                activeOpacity={0.7}
              >
                <Text style={styles.drawDoneBtnText}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        <View style={styles.filterRow}>
          {/* 1. Species Filter */}
          <View style={styles.dropdownWrapper}>
            <TouchableOpacity
              style={styles.dropdownHeader}
              onPress={() => {
                setIsFilterOpen(!isFilterOpen);
                setIsVerifyFilterOpen(false); // Close other dropdown
              }}
            >
              <Text style={styles.dropdownText} numberOfLines={1}>
                {selectedSpecies}
              </Text>
              <Ionicons
                name={isFilterOpen ? "chevron-up" : "chevron-down"}
                size={18}
                color="#333"
              />
            </TouchableOpacity>

            {isFilterOpen && (
              <View style={styles.dropdownList}>
                {speciesOptions.map((item) => (
                  <TouchableOpacity
                    key={item}
                    style={styles.dropdownItem}
                    onPress={() => {
                      onSpeciesChange(item);
                      setIsFilterOpen(false);
                    }}
                  >
                    <Text style={styles.itemText}>{item}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>

          {/* 2. Verification Filter */}
          <View style={styles.dropdownWrapper}>
            <TouchableOpacity
              style={styles.dropdownHeader}
              onPress={() => {
                setIsVerifyFilterOpen(!isVerifyFilterOpen);
                setIsFilterOpen(false); // Close other dropdown
              }}
            >
              <Text style={styles.dropdownText} numberOfLines={1}>
                {selectedVerification}
              </Text>
              <Ionicons
                name={isVerifyFilterOpen ? "chevron-up" : "chevron-down"}
                size={18}
                color="#333"
              />
            </TouchableOpacity>

            {isVerifyFilterOpen && (
              <View style={styles.dropdownList}>
                {verificationOptions.map((item) => (
                  <TouchableOpacity
                    key={item}
                    style={styles.dropdownItem}
                    onPress={() => {
                      setSelectedVerification(item);
                      setIsVerifyFilterOpen(false);
                      onStatusChange(item);
                    }}
                  >
                    <Text style={styles.itemText}>{item}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
          <TouchableOpacity
            style={styles.legendToggle}
            onPress={() => setIsLegendOpen((prev) => !prev)}
          >
            <Text style={styles.legendToggleText}>
              {isLegendOpen ? "✕" : "ⓘ"}
            </Text>
          </TouchableOpacity>
        </View>
        {/* Legend Panel */}
        {isLegendOpen && (
          <View style={styles.legendPanel}>
            <Text style={styles.legendTitle}>Legend</Text>

            <View style={styles.legendColumns}>
              {/* Column 1: Species */}
              <View style={styles.legendColumn}>
                <Text style={styles.legendSectionLabel}>Species</Text>

                <View style={styles.legendItem}>
                  <View
                    style={[styles.legendDot, { backgroundColor: "#1E88E5" }]}
                  />
                  <Text style={styles.legendLabel}>Water Hyacinth</Text>
                </View>

                <View style={styles.legendItem}>
                  <View
                    style={[styles.legendDot, { backgroundColor: "#00897B" }]}
                  />
                  <Text style={styles.legendLabel}>Water Lettuce</Text>
                </View>

                <View style={styles.legendItem}>
                  <View
                    style={[styles.legendDot, { backgroundColor: "#D81B60" }]}
                  />
                  <Text style={styles.legendLabel}>Siam Weed</Text>
                </View>

                <View style={styles.legendItem}>
                  <View
                    style={[styles.legendDot, { backgroundColor: "#6D4C41" }]}
                  />
                  <Text style={styles.legendLabel}>Lantana Camara</Text>
                </View>
              </View>

              {/* Column 2: Status (border color) */}
              <View style={styles.legendColumn}>
                <Text style={styles.legendSectionLabel}>Status</Text>

                <View style={styles.legendItem}>
                  <View
                    style={[
                      styles.legendDot,
                      {
                        backgroundColor: "#e0e0e0",
                        borderColor: "#ffffff",
                        borderWidth: 2,
                      },
                    ]}
                  />
                  <Text style={styles.legendLabel}>Standard</Text>
                </View>

                <View style={styles.legendItem}>
                  <View
                    style={[
                      styles.legendDot,
                      {
                        backgroundColor: "#e0e0e0",
                        borderColor: "#ffd700",
                        borderWidth: 3,
                      },
                    ]}
                  />
                  <Text style={styles.legendLabel}>Multiple images</Text>
                </View>

                <View style={styles.legendItem}>
                  <View
                    style={[
                      styles.legendDot,
                      {
                        backgroundColor: "#e0e0e0",
                        borderColor: "#2E7D32",
                        borderWidth: 3,
                      },
                    ]}
                  />
                  <Text style={styles.legendLabel}>Verified</Text>
                </View>

                <View style={styles.legendItem}>
                  <View
                    style={[
                      styles.legendDot,
                      {
                        backgroundColor: "#e0e0e0",
                        borderColor: "#FF6F00",
                        borderWidth: 3.5,
                      },
                    ]}
                  />
                  <Text style={styles.legendLabel}>Verified + multiple</Text>
                </View>

                <View style={styles.legendItem}>
                  <View
                    style={[
                      styles.legendDot,
                      {
                        backgroundColor: "#e0e0e0",
                        borderColor: "#00E5FF",
                        borderWidth: 4,
                      },
                    ]}
                  />
                  <Text style={styles.legendLabel}>Highlighted</Text>
                </View>
              </View>
            </View>
          </View>
        )}

        <Modal visible={showCategoryPicker} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.title}>What does this zone represent?</Text>

              {(["beneficial", "negative", "neutral"] as ZoneCategory[]).map(
                (cat) => (
                  <TouchableOpacity
                    key={cat}
                    style={[
                      styles.categoryOption,
                      { borderColor: ZONE_COLORS[cat] },
                    ]}
                    onPress={() => {
                      setPendingCategory(cat);
                      setShowCategoryPicker(false);
                      setShowSpeciesPicker(true);
                    }}
                  >
                    <View
                      style={[
                        styles.categoryDot,
                        { backgroundColor: ZONE_COLORS[cat] },
                      ]}
                    />
                    <Text style={styles.categoryOptionText}>
                      {cat.charAt(0).toUpperCase() + cat.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ),
              )}

              <TouchableOpacity
                style={[styles.cancelButton, { marginTop: 8 }]}
                onPress={() => setShowCategoryPicker(false)}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        <Modal visible={showSpeciesPicker} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.title}>Which plant(s) is this?</Text>

              {Object.entries(SPECIES_COLORS).map(([species, color]) => {
                const isSelected = selectedSpeciesZone.includes(species);
                return (
                  <TouchableOpacity
                    key={species}
                    style={[
                      styles.categoryOption,
                      { borderColor: color },
                      isSelected && { backgroundColor: color },
                    ]}
                    onPress={() => {
                      setSelectedSpeciesZone((prev) =>
                        isSelected
                          ? prev.filter((s) => s !== species)
                          : [...prev, species],
                      );
                    }}
                  >
                    <View
                      style={[
                        styles.categoryDot,
                        { backgroundColor: isSelected ? "#ffffff" : color },
                      ]}
                    />
                    <Text
                      style={[
                        styles.categoryOptionText,
                        isSelected && { color: "#ffffff", fontWeight: "700" },
                      ]}
                    >
                      {species}
                    </Text>
                    {isSelected && (
                      <Text style={[styles.checkMark, { color: "#ffffff" }]}>
                        ✓
                      </Text>
                    )}
                  </TouchableOpacity>
                );
              })}

              {/* New: description input */}
              <Text style={styles.fieldLabel}>Why? (optional)</Text>
              <TextInput
                style={styles.descriptionInput}
                placeholder="e.g. Provides shade for native fish, or crowds out native reeds"
                placeholderTextColor="#999"
                multiline
                numberOfLines={3}
                value={zoneDescription}
                onChangeText={setZoneDescription}
              />

              <TouchableOpacity
                style={[
                  styles.primaryButton,
                  { marginTop: 12 },
                  selectedSpeciesZone.length === 0 && styles.disabledButton,
                ]}
                disabled={selectedSpeciesZone.length === 0}
                onPress={() => {
                  if (pendingCategory && selectedSpeciesZone.length > 0) {
                    handleSaveZone(
                      pendingCategory,
                      selectedSpeciesZone,
                      zoneDescription,
                    );
                  }
                }}
              >
                <Text style={styles.primaryButtonText}>
                  Save{" "}
                  {selectedSpeciesZone.length > 0
                    ? `(${selectedSpeciesZone.length})`
                    : ""}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.cancelButton, { marginTop: 8 }]}
                onPress={() => {
                  setShowSpeciesPicker(false);
                  setPendingCategory(null);
                  setSelectedSpeciesZone([]);
                  setZoneDescription("");
                  setShowCategoryPicker(true);
                }}
              >
                <Text style={styles.cancelButtonText}>Back</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        <Modal visible={isZoneDetailOpen} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              {selectedZone &&
                (() => {
                  const category = selectedZone.category as ZoneCategory;
                  const config = ZONE_CONFIG[category] ?? {
                    title: "Zone Details",
                    reasonLabel: "DETAILS",
                  };

                  return (
                    <>
                      {/* Header */}
                      <View style={styles.headerContainer}>
                        <View
                          style={[
                            styles.categoryDot,
                            {
                              backgroundColor: ZONE_COLORS[category] ?? "#666",
                            },
                          ]}
                        />
                        <Text
                          style={[
                            styles.title,
                            { color: ZONE_COLORS[category] },
                          ]}
                        >
                          {config.title}
                        </Text>
                      </View>

                      {/* Species Chips */}
                      <Text style={styles.sectionLabel}>
                        Identified Species
                      </Text>
                      <View style={styles.speciesContainer}>
                        {(Array.isArray(selectedZone.species)
                          ? selectedZone.species
                          : selectedZone.species
                            ? [selectedZone.species]
                            : []
                        ).map((species: string) => (
                          <View key={species} style={styles.speciesChip}>
                            <View
                              style={[
                                styles.speciesChipDot,
                                {
                                  backgroundColor:
                                    SPECIES_COLORS[species] ?? "#999",
                                },
                              ]}
                            />
                            <Text style={styles.speciesChipText}>
                              {species}
                            </Text>
                          </View>
                        ))}
                      </View>

                      {/* Reason Box */}
                      {selectedZone.description ? (
                        <View
                          style={[
                            styles.reasonBox,
                            {
                              borderLeftColor: ZONE_COLORS[category] ?? "#333",
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.reasonLabel,
                              { color: ZONE_COLORS[category] ?? "#475569" },
                            ]}
                          >
                            {config.reasonLabel}
                          </Text>
                          <Text style={styles.reasonText}>
                            {selectedZone.description}
                          </Text>
                        </View>
                      ) : (
                        <View style={styles.noReasonBox}>
                          <Text style={styles.noReasonText}>
                            No specific impact notes logged for this area.
                          </Text>
                        </View>
                      )}
                      <TouchableOpacity
                        onPress={() => handleViewCreatorProfile(selectedZone)}
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                        }}
                      >
                        <Text style={styles.creatorText}>Added by: </Text>
                        <Text
                          style={[
                            styles.creatorText,
                            { textDecorationLine: "underline" },
                          ]}
                        >
                          {selectedZone.createdByName ?? "Unknown user"}
                        </Text>
                      </TouchableOpacity>

                      {/* Creator-only actions */}
                      {auth.currentUser?.uid === selectedZone.createdBy && (
                        <View style={styles.ownerActionsRow}>
                          <TouchableOpacity
                            style={[styles.secondaryButton, { flex: 1 }]}
                            onPress={() => handleStartEditZone(selectedZone)}
                          >
                            <Text style={styles.secondaryButtonText}>Edit</Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={[styles.dangerButton, { flex: 1 }]}
                            onPress={() => handleDeleteZone(selectedZone)}
                          >
                            <Text style={styles.dangerButtonText}>Delete</Text>
                          </TouchableOpacity>
                        </View>
                      )}

                      {/* Close Button */}
                      <TouchableOpacity
                        activeOpacity={0.7}
                        style={styles.closeButton}
                        onPress={() => {
                          setIsZoneDetailOpen(false);
                          setSelectedZone(null);
                        }}
                      >
                        <Text style={styles.closeButtonText}>Close</Text>
                      </TouchableOpacity>
                    </>
                  );
                })()}
            </View>
          </View>
        </Modal>
      </View>
    );
  },
);

export default MapComponent;

const styles = StyleSheet.create({
  container: { flex: 1, width: "100%", height: "100%" },
  map: { flex: 1 },
  marker: {
    width: 15,
    height: 15,
    borderRadius: 5,
    backgroundColor: "green",
    borderWidth: 1,
    borderColor: "white",
  },
  pinCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: "white",
    elevation: 3,
  },
  checkMark: {
    marginLeft: "auto",
    fontSize: 16,
    fontWeight: "700",
    color: "#2E7D32",
  },
  disabledButton: {
    opacity: 0.4,
  },
  filterRow: {
    position: "absolute",
    top: 10,
    right: 10,
    left: 10,
    flexDirection: "row",
    gap: 8,
    zIndex: 999,
    elevation: 10,
  },
  legendToggle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 10,
  },
  legendToggleText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
  },
  legendPanel: {
    position: "absolute",
    top: 56,
    right: 10,
    left: 10,
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 14,
    zIndex: 998,
    elevation: 9,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  legendTitle: {
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 10,
    color: "#111",
  },
  legendColumns: {
    flexDirection: "row",
    gap: 16,
  },
  legendColumn: {
    flex: 1,
  },
  legendSectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#888",
    textTransform: "uppercase",
    marginBottom: 6,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  legendDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    marginRight: 8,
  },
  legendLabel: {
    fontSize: 12,
    color: "#333",
    flexShrink: 1,
  },
  dropdownWrapper: {
    flex: 1,
    position: "relative",
  },
  dropdownHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 10,
    borderRadius: 8,
    backgroundColor: "#2E7D32", // Green background
  },
  dropdownText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#FFFFFF", // White text for high contrast
    flexShrink: 1,
  },
  dropdownList: {
    position: "absolute",
    top: "100%",
    left: 0,
    right: 0,
    backgroundColor: "#2E7D32", // Green background
    borderRadius: 8,
    marginTop: 4,
    overflow: "hidden",
    zIndex: 2000,
    elevation: 5,
  },
  dropdownItem: {
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 255, 255, 0.2)", // Semi-transparent white dividers
  },
  itemText: {
    fontSize: 14,
    color: "#FFFFFF", // White text
  },
  // drawControls: {
  //   position: "absolute",
  //   bottom: 30,
  //   left: 16,
  //   right: 16,
  //   backgroundColor: "#fff",
  //   borderRadius: 12,
  //   padding: 12,
  //   gap: 10,
  //   elevation: 4,
  // },
  drawControls: {
    position: "absolute",
    bottom: 30,
    left: 16,
    right: 16,
    alignSelf: "center",
    width: "92%",
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: COLORS.modalBg, // Soft translucent green background
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.green700,
    alignItems: "center",

    // Floating shadow effect for map overlays
    shadowColor: COLORS.green900,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 6,
  },
  drawHintText: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.textPrimary,
    marginBottom: 12,
    textAlign: "center",
  },
  btnGroup: {
    flexDirection: "row",
    gap: 8,
    width: "100%",
  },

  // Cancel Button (Soft tint using pinRed)
  drawCancelBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "rgba(229, 57, 53, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(229, 57, 53, 0.3)",
    alignItems: "center",
    justifyContent: "center",
  },
  drawCancelBtnText: {
    color: COLORS.pinRed,
    fontWeight: "600",
    fontSize: 14,
  },

  // Undo Button (Light green surface)
  drawUndoBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: COLORS.green100,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: "center",
    justifyContent: "center",
  },
  drawUndoBtnText: {
    color: COLORS.green700,
    fontWeight: "600",
    fontSize: 14,
  },

  // Primary Done Button (Solid deep green)
  drawDoneBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: COLORS.green700,
    alignItems: "center",
    justifyContent: "center",
  },
  drawDoneBtnText: {
    color: COLORS.white,
    fontWeight: "700",
    fontSize: 14,
  },

  // Disabled State Styles
  btnDisabled: {
    backgroundColor: COLORS.surface,
    borderColor: "transparent",
    opacity: 0.6,
  },
  btnTextDisabled: {
    color: COLORS.textSecondary,
  },
  categoryOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 2,
    borderRadius: 8,
    padding: 12,
    marginTop: 10,
  },

  categoryOptionText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#333",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(18, 38, 20, 0.6)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  modalContent: {
    width: "100%",
    // maxWidth: 400,
    backgroundColor: COLORS.modalBg,
    borderRadius: 20,
    padding: 22,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    // iOS Shadow
    shadowColor: COLORS.green900,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    // Android Elevation
    elevation: 6,
  },
  headerContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  categoryDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: COLORS.green700,
    marginRight: 10,
  },
  title: {
    fontSize: 19,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: COLORS.green700,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  speciesContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 16,
  },
  speciesChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.75)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(46, 125, 50, 0.25)",
  },
  speciesChipDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.green700,
    marginRight: 6,
  },
  speciesChipText: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.green900,
  },
  reasonBox: {
    backgroundColor: "rgba(255, 255, 255, 0.75)",
    borderRadius: 12,
    padding: 14,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.green700,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 14,
  },
  reasonLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.green700,
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  reasonText: {
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.textPrimary,
  },
  noReasonBox: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 14,
  },
  noReasonText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    fontStyle: "italic",
  },
  creatorText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#4CAF50",
    textTransform: "uppercase",
    marginBottom: 18,
  },
  ownerActionsRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 10,
  },
  primaryButton: {
    width: "100%",
    backgroundColor: COLORS.green700,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.white,
  },
  secondaryButton: {
    flex: 1,
    backgroundColor: "rgba(21, 101, 192, 0.08)",
    borderWidth: 1,
    borderColor: COLORS.blue,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.blue,
  },
  cancelButton: {
    width: "100%",
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelButtonText: {
    color: COLORS.textSecondary,
    fontSize: 15,
    fontWeight: "600",
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
  closeButton: {
    width: "100%",
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  closeButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.textPrimary,
  },
  verificationBadge: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "#fff",
  },
  verificationBadgeText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "700",
    lineHeight: 12,
  },
  zoneCentroidContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    width: 48, // ← explicit size now, enough for up to 4 overlapping 12px dots
    height: 16,
  },
  zoneSpeciesDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: "#ffffff",
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#757575",
    marginTop: 12,
    marginBottom: 6,
  },
  descriptionInput: {
    borderWidth: 1,
    borderColor: "#D0D0D0",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    color: "#333",
    textAlignVertical: "top", // Android: keeps multiline text starting at top instead of centered
    minHeight: 70,
  },
});
