import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type OfflinePin = {
  id: string;
  label: string;
  lat: number;
  lng: number;
  image: string;       // thumbnail (image_url)
  images?: string[];   
  timestamp: number;
};

type OfflinePinStore = {
  offlinePins: OfflinePin[];
  addOfflinePin: (pin: OfflinePin) => void;
  removeOfflinePin: (id: string) => void;
};

export const useOfflinePinStore = create<OfflinePinStore>()(
  persist(
    (set, get) => ({
      offlinePins: [],
      addOfflinePin: (pin) =>
        set({ offlinePins: [...get().offlinePins, pin] }),
      removeOfflinePin: (id) =>
        set({ offlinePins: get().offlinePins.filter((p) => p.id !== id) }),
    }),
    {
      name: "offline-pins",
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);