import React from "react";
// Import the native components
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  KeyboardTypeOptions,
} from "react-native";

interface InputFieldProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void; // Mobile uses onChangeText, not onChange
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  secureTextEntry?: boolean; // For passwords (instead of type="password")
}

const InputField = ({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType = "default",
  secureTextEntry = false,
}: InputFieldProps) => {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        keyboardType={keyboardType}
        secureTextEntry={secureTextEntry}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: 15, // Replaces Bootstrap 'mb-3'
  },
  label: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 5,
    color: "white",
  },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    padding: 10,
    borderRadius: 5,
    fontSize: 16,
    color: "white",
    width: 300,
  },
});

export default InputField;
