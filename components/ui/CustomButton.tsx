import React from "react";
import { TouchableOpacity, Text, StyleSheet, Button } from "react-native";
import { StyleProp, ViewStyle } from "react-native";

interface CustomButtonProps {
  title: string;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}

const CustomButton = ({ title, onPress, style }: CustomButtonProps) => {
  return (
    <TouchableOpacity style={style} onPress={onPress}>
      <Text style={styles.buttonText}>{title}</Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  buttonText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 16,
  },
});

export default CustomButton;
