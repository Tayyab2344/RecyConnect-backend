/**
 * Cloudinary Upload Utility
 *
 * Shared helper for uploading base64-encoded images to Cloudinary
 * with automatic retry and image optimization.
 *
 * @module utils/cloudinaryUploader
 */

import cloudinary from "../config/cloudinary.js";
import { withExponentialBackoff } from "./retryHelper.js";

/**
 * Upload a base64-encoded image string to Cloudinary.
 *
 * Applies automatic optimization (resize to 800×800 max, auto quality)
 * and retries up to 3 times with exponential backoff on failure.
 *
 * @param {string} base64String - Raw base64 string or data URI
 * @param {string} folder - Cloudinary folder path (e.g. "recyconnect/listings/42")
 * @returns {Promise<string>} The secure URL of the uploaded image
 */
export async function uploadBase64ToCloudinary(base64String, folder) {
  const dataUri = base64String.startsWith("data:")
    ? base64String
    : `data:image/jpeg;base64,${base64String}`;

  const result = await withExponentialBackoff(
    () =>
      cloudinary.uploader.upload(dataUri, {
        folder,
        resource_type: "image",
        transformation: [
          { width: 800, height: 800, crop: "limit" },
          { quality: "auto" },
        ],
      }),
    3,
    1500,
    "Cloudinary Image Upload"
  );

  return result.secure_url;
}
