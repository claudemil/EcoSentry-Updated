import { File } from "expo-file-system/next";

export async function uploadToCloudinary(imageInput: string): Promise<string> {
  // 1. Return as-is if already a remote web URL
  if (imageInput.startsWith("http://") || imageInput.startsWith("https://")) {
    return imageInput;
  }

  try {
    const formData = new FormData();
    formData.append("upload_preset", "ecosentry");

    // 2. Handle file URIs directly via FormData (No Base64 needed)
    if (
      imageInput.startsWith("file://") ||
      imageInput.startsWith("content://") ||
      imageInput.startsWith("ph://")
    ) {
      const filename = imageInput.split("/").pop() || "upload.jpg";
      const match = /\.(\w+)$/.exec(filename);
      const type = match ? `image/${match[1]}` : "image/jpeg";

      // React Native FormData binary payload format
      formData.append("file", {
        uri: imageInput,
        name: filename,
        type: type,
      } as any);
    } else {
      // 3. Fallback if a raw base64 string was explicitly passed in
      const cleanBase64 = imageInput.replace(/^data:image\/\w+;base64,/, "");
      formData.append("file", `data:image/jpeg;base64,${cleanBase64}`);
    }

    // 4. Send upload request
    const response = await fetch(
      "https://api.cloudinary.com/v1_1/dbw36vlt3/auto/upload",
      {
        method: "POST",
        body: formData,
      }
    );

    // Safely parse text first to prevent JSON.parse crashes on HTML error pages
    const responseText = await response.text();
    let data;

    try {
      data = JSON.parse(responseText);
    } catch {
      throw new Error(`Server returned non-JSON response: ${responseText.slice(0, 100)}...`);
    }

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