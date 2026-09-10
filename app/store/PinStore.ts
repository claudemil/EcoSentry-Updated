import { create } from 'zustand';
import { PinDetection } from '@/components/MapComponent';

type PendingPin = {
  label: string;
  lat: number;
  lng: number;
  image: string;
  timestamp: number;
    detections?: Record<string, PinDetection>; // ← new

};

type PinStore = {
  pendingPin: PendingPin | null;
  setPendingPin: (pin: PendingPin) => void;
  clearPendingPin: () => void;
};

export const usePinStore = create<PinStore>((set) => ({
  pendingPin: null,
  setPendingPin: (pin) => set({ pendingPin: pin }),
  clearPendingPin: () => set({ pendingPin: null }),
}));