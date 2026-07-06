import { jest } from '@jest/globals';
import request from 'supertest';
import prisma from '../../../src/lib/prisma.js';
import { createTestUser, generateTestToken } from '../../helpers.js';

// Setup ES module mocks at the top level
jest.unstable_mockModule('../../../src/lib/redis.js', () => ({
    invalidateCache: jest.fn().mockResolvedValue(),
    getCache: jest.fn().mockResolvedValue(null),
    setCache: jest.fn().mockResolvedValue(),
    deleteCache: jest.fn().mockResolvedValue(),
    default: { get: jest.fn(), setex: jest.fn() },
    isRedisConnected: jest.fn().mockReturnValue(false)
}));

jest.unstable_mockModule('../../../src/services/firebaseService.js', () => ({
    sendPushNotification: jest.fn().mockResolvedValue({ success: true })
}));

jest.unstable_mockModule('../../../src/utils/uploadHelper.js', () => ({
    uploadToCloudinary: jest.fn().mockResolvedValue({ secure_url: 'http://cloudinary.mock/proof.jpg' }),
    uploadEncryptedToCloudinary: jest.fn().mockResolvedValue({ secure_url: 'http://cloudinary.mock/cnic.pdf' }),
    encryptedDocumentData: jest.fn().mockReturnValue({ docType: 'CNIC', fileUrl: 'http://cloudinary.mock/cnic.pdf', encrypted: true }),
    uploadBase64ToCloudinary: jest.fn().mockResolvedValue('http://cloudinary.mock/listing.jpg'),
    deleteCloudinaryAsset: jest.fn().mockResolvedValue()
}));

const { default: app } = await import('../../../src/index.js');

describe('System E2E Workflow: Collector Dispatch & Operations Journey', () => {
    let warehouse;
    let seller;
    let collector;
    let warehouseToken;
    let collectorToken;
    let taskId;

    beforeAll(async () => {
        // Create Warehouse user
        warehouse = await createTestUser({
            name: 'Eco Warehouse Central',
            email: `wh-disp-${Date.now()}@journey.com`,
            role: 'warehouse',
            businessName: 'Central Depot',
            emailVerified: true
        });

        // Create Seller user
        seller = await createTestUser({
            name: 'Local Seller',
            email: `seller-disp-${Date.now()}@journey.com`,
            role: 'individual',
            emailVerified: true
        });

        // Create Collector user and associate with Warehouse
        collector = await createTestUser({
            name: 'Rider Ali',
            email: `coll-disp-${Date.now()}@journey.com`,
            role: 'collector',
            emailVerified: true,
            createdById: warehouse.id // Associate with warehouse
        });

        // Create collector profile
        await prisma.collectorProfile.create({
            data: {
                userId: collector.id,
                employeeId: `EMP-${Date.now()}`,
                availabilityStatus: 'ON_DUTY'
            }
        });

        warehouseToken = generateTestToken(warehouse);
        collectorToken = generateTestToken(collector);
    });

    afterAll(async () => {
        // Clean up created records in reverse order
        if (taskId) {
            await prisma.collectorEarning.deleteMany({ where: { taskId } }).catch(() => {});
            await prisma.wasteVerification.deleteMany({ where: { taskId } }).catch(() => {});
            await prisma.collectorDelivery.deleteMany({ where: { taskId } }).catch(() => {});
            await prisma.collectorTask.deleteMany({ where: { id: taskId } }).catch(() => {});
        }
        await prisma.collectorProfile.deleteMany({ where: { userId: collector.id } }).catch(() => {});
        if (warehouse) {
            await prisma.warehouseInventory.deleteMany({ where: { warehouseId: warehouse.id } }).catch(() => {});
        }
        await prisma.user.deleteMany({
            where: { id: { in: [warehouse.id, seller.id, collector.id] } }
        }).catch(() => {});
    });

    it('Workflow 1: Warehouse creates and assigns a collector task', async () => {
        const res = await request(app)
            .post('/api/warehouse/collector-tasks')
            .set('Authorization', `Bearer ${warehouseToken}`)
            .send({
                collectorId: collector.id,
                taskType: 'SELLER_TO_WAREHOUSE',
                sourceType: 'INDIVIDUAL',
                sourceUserId: seller.id,
                sourceName: seller.name,
                sourceAddress: '123 Street Lahore',
                destinationType: 'WAREHOUSE',
                destinationUserId: warehouse.id,
                destinationName: warehouse.businessName,
                destinationAddress: 'Central Warehouse Depot Lahore',
                materialCategory: 'PLASTIC',
                estimatedWeight: 15.0
            });

        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveProperty('id');
        expect(res.body.data.status).toBe('ASSIGNED');

        taskId = res.body.data.id;
    });

    it('Workflow 2: Collector accepts the assigned task', async () => {
        const res = await request(app)
            .post(`/api/collector/tasks/${taskId}/accept`)
            .set('Authorization', `Bearer ${collectorToken}`)
            .send();

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.status).toBe('ACCEPTED');
    });

    it('Workflow 3: Collector marks the task as picked up (proof files & verified weight)', async () => {
        const res = await request(app)
            .post(`/api/collector/task/${taskId}/collected`)
            .set('Authorization', `Bearer ${collectorToken}`)
            .field('verifiedWeight', '16.5')
            .field('verifiedCategory', 'PLASTIC')
            .field('verifiedMaterial', 'PET')
            .field('notes', 'Clean plastic bottles picked up')
            .attach('proofImages', Buffer.from('mock_collected_proof'), 'collect_proof.jpg');

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.status).toBe('PICKED_UP');

        // Verify WasteVerification table entry was created
        const verification = await prisma.wasteVerification.findUnique({
            where: { taskId }
        });
        expect(verification).not.toBeNull();
        expect(verification.verifiedWeight).toBe(16.5);
    });

    it('Workflow 4: Collector delivers the waste to warehouse depot', async () => {
        const res = await request(app)
            .post(`/api/collector/task/${taskId}/delivered`)
            .set('Authorization', `Bearer ${collectorToken}`)
            .field('receivedWeight', '16.5')
            .field('packageCondition', 'Good')
            .field('receiverName', 'Depot Incharge')
            .field('notes', 'Delivered successfully')
            .attach('proofImages', Buffer.from('mock_delivery_proof'), 'deliver_proof.jpg');

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.task.status).toBe('COMPLETED');

        // Verify CollectorDelivery table entry was created
        const delivery = await prisma.collectorDelivery.findUnique({
            where: { taskId }
        });
        expect(delivery).not.toBeNull();
        expect(delivery.status).toBe('DELIVERED');
    });
});
