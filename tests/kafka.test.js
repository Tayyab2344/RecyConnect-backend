import { jest } from '@jest/globals';
import { sendKafkaEvent, isKafkaHealthy } from '../src/lib/kafka.js';

describe('Kafka Client Integration & Resiliency', () => {
    it('should report unhealthy status by default in test environment', () => {
        expect(isKafkaHealthy()).toBe(false);
    });

    it('should return false and not throw reference errors when sending events in unhealthy/uninitialized state', async () => {
        const result = await sendKafkaEvent('order.created', { orderId: 1 });
        expect(result).toBe(false);
    });
});
