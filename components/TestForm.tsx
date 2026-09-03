import React, { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from "react-native";
import InputField from "./ui/InputField";
import CustomButton from "./ui/CustomButton";
import api from "@/services/api";
interface TestFormData {
  plantName: string;
}

const TestForm = () => {
  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<TestFormData>();

  const onSubmit = async (data: TestFormData) => {
    try {
      const response = await api.post("/plants", {
        name: data.plantName,
      });
      Alert.alert("Success!");
    } catch (error: any) {
      // Check if the server actually sent a response
      if (error.response) {
        // This is where Laravel's validation errors (like "name is required") live
        const errorMessage =
          error.response.data.message || "Something went wrong";
        Alert.alert("Error", errorMessage);
        console.log("Server Error Data:", error.response.data);
      } else if (error.request) {
        // The request was made but no response was received (e.g., server is down)
        Alert.alert("Error", "No response from server. Check your connection.");
      } else {
        // Something else went wrong
        Alert.alert("Error", error.message);
      }
    }
  };
  return (
    <View>
      <Controller
        //   control connects this input field to the "database" for data to be passed through
        // additionally, states are automatically updated thanks to this render field lol
        control={control}
        name="plantName"
        rules={{ required: "This is required!" }}
        render={({ field: { onChange, value } }) => (
          <InputField
            label="Enter Plant Name:"
            value={value}
            onChangeText={onChange}
            placeholder="Plant Name"
          ></InputField>
        )}
      ></Controller>
      {errors.plantName && <Text>{errors.plantName.message}</Text>}
      <CustomButton
        title="Submit THIS!"
        onPress={handleSubmit(onSubmit)}
      ></CustomButton>
    </View>
  );
};

export default TestForm;
