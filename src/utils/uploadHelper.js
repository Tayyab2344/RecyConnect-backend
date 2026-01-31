import cloudinary from '../config/cloudinary.js';
import fs from 'fs/promises';
import { logger } from './logger.js';

/**
 * Upload a file to Cloudinary (supports both disk and memory storage)
 * @param {Object} file - The file object from multer
 * @param {string} folder - The folder to upload to
 * @returns {Promise<Object>} - The Cloudinary upload result
 */
export const uploadToCloudinary = (file, folder) => {
    return new Promise((resolve, reject) => {
        // 1. If we have a file path (Disk Storage)
        if (file.path) {
            cloudinary.uploader.upload(file.path, { folder })
                .then((result) => {
                    // Try to clean up local file
                    fs.unlink(file.path).catch((err) => logger.warn(`Failed to delete local file: ${err.message}`));
                    resolve(result);
                })
                .catch((err) => reject(err));
        }
        // 2. If we have a buffer (Memory Storage)
        else if (file.buffer) {
            const stream = cloudinary.uploader.upload_stream(
                { folder },
                (error, result) => {
                    if (error) return reject(error);
                    resolve(result);
                }
            );
            stream.end(file.buffer);
        }
        // 3. Fallback / Error
        else {
            reject(new Error("File upload failed: No path or buffer found"));
        }
    });
};
