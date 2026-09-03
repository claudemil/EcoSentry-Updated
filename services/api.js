import axios from'axios';
import * as SecureStore from "expo-secure-store";
import NetInfo from '@react-native-community/netinfo';


// const BASE_URL = 'http://192.168.254.197:8000/api';
// const BASE_URL = 'http://10.33.122.237:8000/api';
const BASE_URL = 'http://192.168.1.9:8000/api'
// or my local ip in my home
const api = axios.create({
    baseURL: BASE_URL,
      timeout: 8000, // ✅ 8 seconds instead of 30
    headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest', 
    }
});

api.interceptors.request.use(
  async (config) => {
    // ✅ Fail immediately if offline instead of hanging
    const network = await NetInfo.fetch();
    if (!network.isConnected || !network.isInternetReachable) {
      return Promise.reject(new Error("OFFLINE"));
    }

    const token = await SecureStore.getItemAsync("userToken");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

export default api