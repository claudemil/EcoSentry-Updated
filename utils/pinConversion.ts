// utils/pinConversion.ts
import { OfflinePin } from "@/app/store/OfflinePinStore";
import { SpeciesPin } from "@/components/MapComponent"; // adjust path

export const offlinePinToUploadPayload = (
  pin: OfflinePin,
  userId: string
): Omit<SpeciesPin, "id" | "creator" | "verifications"> => ({
  longitude: pin.lng,
  latitude: pin.lat,
  specie_label: pin.label,
  image_url: pin.image,
  images: [pin.image],
  userId,
  createdAt: new Date(pin.timestamp).toISOString(),
});