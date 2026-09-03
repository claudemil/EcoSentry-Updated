import { initializeApp } from "firebase/app";
import { initializeAuth, getReactNativePersistence } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Replace the values below with your keys from Step 2
const firebaseConfig = {
  apiKey: "AIzaSyBUVtZFO0dP_hqf0uoLNQerW62dB11vTEA",
  authDomain: "ecosentry-6cee4.firebaseapp.com",
  projectId: "ecosentry-6cee4",
  storageBucket: "ecosentry-6cee4.firebasestorage.app",
  messagingSenderId: "620472753105",
  appId: "1:620472753105:web:c9c9862073c66a28b5def0",
  measurementId: "G-5YD532FWKF"
};

// Initialize Firebase App
const app = initializeApp(firebaseConfig);

// Initialize Authentication with persistent storage
const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(AsyncStorage),
});

// Initialize Firestore Database
const db = getFirestore(app);

export { app, auth, db };