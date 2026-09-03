import { File } from "expo-file-system/next";

export async function uploadToCloudinary(imageInput: string): Promise<string> {
  // 1. Return as-is if already a remote web URL
  if (imageInput.startsWith("http://") || imageInput.startsWith("https://")) {
    return imageInput;
  }

  try {
    let cleanBase64 = imageInput;

    // 2. Process local file URIs using the new File API
    if (
      imageInput.startsWith("file://") ||
      imageInput.startsWith("content://") ||
      imageInput.startsWith("ph://")
    ) {
      const file = new File(imageInput);
      cleanBase64 = await file.base64();
    } else {
      // Strip any existing data URI header if raw base64 string was passed directly
      cleanBase64 = cleanBase64.replace(/^data:image\/\w+;base64,/, "");
    }

    // 3. Construct FormData payload
    const formData = new FormData();
    formData.append("file", `data:image/jpeg;base64,${cleanBase64}`);
    formData.append("upload_preset", "ecosentry");

    // 4. Send upload request to Cloudinary
    const response = await fetch(
      "https://api.cloudinary.com/v1_1/dbw36vlt3/image/upload",
      {
        method: "POST",
        body: formData,
      }
    );

    const data = await response.json();

    if (!response.ok || !data.secure_url) {
      throw new Error(
        data.error?.message || "Cloudinary upload failed: " + JSON.stringify(data)
      );
    }

    return data.secure_url;
  } catch (error) {
    console.error("Cloudinary Upload Error:", error);
    throw error;
  }
}