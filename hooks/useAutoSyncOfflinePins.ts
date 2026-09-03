// hooks/useAutoSyncOfflinePins.ts
import { useEffect } from "react";
import NetInfo from "@react-native-community/netinfo";
import { useOfflinePinStore } from "@/app/store/OfflinePinStore";
import { auth, db } from "@/firebaseConfig";
import { addDoc, collection, doc, setDoc, increment } from "firebase/firestore";
import { uploadToCloudinary } from "@/utils/uploadToCloudinary"; // adjust path
import { PinVerification } from "@/components/MapComponent"; // adjust path

export function useAutoSyncOfflinePins() {
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(async (state) => {
      const isOnline = state.isConnected && state.isInternetReachable;
      if (!isOnline) return;

      const currentUser = auth.currentUser;
      if (!currentUser) return;

      const { offlinePins, removeOfflinePin } = useOfflinePinStore.getState();
      if (offlinePins.length === 0) return;

      for (const pin of offlinePins) {
        try {
          const imageUrl = pin.image
            ? await uploadToCloudinary(pin.image)
            : "https://picsum.photos/536/354";

          // Upload any additional images, preserving order
          const additionalImages = pin.images ?? [];
          const uploadedImages: string[] = await Promise.all(
            additionalImages.map((img) => uploadToCloudinary(img))
          );

          const initialVerification: PinVerification = {
            timestamp: pin.timestamp,
            verified: true,
            userId: currentUser.uid,
          };

          await addDoc(collection(db, "pins"), {
            latitude: pin.lat,
            longitude: pin.lng,
            specie_label: pin.label,
            image_url: imageUrl,
            images: uploadedImages, 
            verifications: [initialVerification],
            userId: currentUser.uid,
            created_by: currentUser.displayName || currentUser.email || "Anonymous",
            creator: {
              uid: currentUser.uid,
              email: currentUser.email || "",
              username: currentUser.displayName || "Anonymous User",
            },
            createdAt: new Date(pin.timestamp).toISOString(),
          });

          await setDoc(
            doc(db, "users", currentUser.uid),
            { pins_count: increment(1) },
            { merge: true }
          );

          removeOfflinePin(pin.id);
        } catch (e) {
          console.error("Failed to sync offline pin:", pin.id, e);
        }
      }
    });

    return unsubscribe;
  }, []);
}