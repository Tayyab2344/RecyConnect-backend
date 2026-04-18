import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const KEY_VERSION = process.env.DOCUMENT_ENCRYPTION_KEY_VERSION || 'v1';

function getEncryptionKey() {
    const rawKey = process.env.DOCUMENT_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY;

    if (!rawKey) {
        if (process.env.NODE_ENV === 'test') {
            return Buffer.alloc(32, 1);
        }
        throw new Error('DOCUMENT_ENCRYPTION_KEY is required for encrypted document uploads');
    }

    const candidates = [
        Buffer.from(rawKey, 'base64'),
        Buffer.from(rawKey, 'hex'),
        Buffer.from(rawKey, 'utf8')
    ];

    const key = candidates.find((candidate) => candidate.length === 32);
    if (!key) {
        throw new Error('DOCUMENT_ENCRYPTION_KEY must be 32 bytes as base64, hex, or raw text');
    }

    return key;
}

export function encryptBuffer(buffer) {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
        ciphertext,
        metadata: {
            encrypted: true,
            encryptionAlgorithm: ALGORITHM,
            encryptionIv: iv.toString('base64'),
            encryptionAuthTag: authTag.toString('base64'),
            encryptionKeyVersion: KEY_VERSION
        }
    };
}

export function decryptBuffer(ciphertext, metadata) {
    const decipher = crypto.createDecipheriv(
        metadata.encryptionAlgorithm || ALGORITHM,
        getEncryptionKey(),
        Buffer.from(metadata.encryptionIv, 'base64')
    );

    decipher.setAuthTag(Buffer.from(metadata.encryptionAuthTag, 'base64'));
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
