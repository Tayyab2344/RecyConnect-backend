import cloudinary from '../config/cloudinary.js';
import fs from 'fs/promises';
import { logger } from './logger.js';
import { encryptBuffer } from './encryptionHelper.js';


/**
 * Upload a file to Cloudinary (supports both disk and memory storage)
 * @param {Object} file - The file object from multer
 * @param {string} folder - The folder to upload to
 * @returns {Promise<Object>} - The Cloudinary upload result
 */
export const uploadToCloudinary = (file, folder, options = {}) => {
    return new Promise((resolve, reject) => {
        const uploadOptions = { folder, resource_type: "auto", ...options };

        // 1. If we have a file path (Disk Storage)
        if (file.path) {
            cloudinary.uploader.upload(file.path, uploadOptions)
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
                uploadOptions,
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

async function getFileBuffer(file) {
    if (file.buffer) return file.buffer;
    if (file.path) return fs.readFile(file.path);
    throw new Error("File upload failed: No path or buffer found");
}

/**
 * Encrypt a sensitive user document before storing it in Cloudinary.
 * OCR should be performed before this helper is called because the stored
 * object is encrypted bytes, not a readable image/PDF.
 */
export const uploadEncryptedToCloudinary = async (file, folder) => {
    const buffer = await getFileBuffer(file);
    const { ciphertext, metadata } = encryptBuffer(buffer);

    const uploadResult = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            {
                folder,
                resource_type: 'raw',
                public_id: `${Date.now()}-${file.originalname || 'document'}.enc`
            },
            (error, result) => {
                if (error) return reject(error);
                resolve(result);
            }
        );
        stream.end(ciphertext);
    });

    if (file.path) {
        fs.unlink(file.path).catch((err) => logger.warn(`Failed to delete local file: ${err.message}`));
    }

    return {
        ...uploadResult,
        encryption: metadata,
        encryptedSize: ciphertext.length,
        originalMimeType: file.mimetype || null,
        originalSize: file.size || buffer.length
    };
};

export const encryptedDocumentData = (docType, file, uploadResult) => ({
    docType,
    fileUrl: uploadResult.secure_url,
    fileName: file.originalname,
    encrypted: true,
    encryptionAlgorithm: uploadResult.encryption.encryptionAlgorithm,
    encryptionIv: uploadResult.encryption.encryptionIv,
    encryptionAuthTag: uploadResult.encryption.encryptionAuthTag,
    encryptionKeyVersion: uploadResult.encryption.encryptionKeyVersion,
    mimeType: uploadResult.originalMimeType,
    fileSize: uploadResult.originalSize
});

export const deleteCloudinaryAsset = async (uploadResult, options = {}) => {
    if (!uploadResult?.public_id || typeof cloudinary.uploader.destroy !== 'function') {
        return;
    }

    try {
        await cloudinary.uploader.destroy(uploadResult.public_id, options);
    } catch (err) {
        logger.warn(`Failed to delete temporary Cloudinary asset: ${err.message}`);
    }
};
