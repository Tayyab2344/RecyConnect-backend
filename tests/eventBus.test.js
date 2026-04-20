import { jest } from '@jest/globals';

// Mock redis.js directly
let redisModule;
let EventBus;

beforeAll(async () => {
    // Inject mock before dynamic imports evaluate
    jest.unstable_mockModule('../src/lib/redis.js', () => ({
        invalidateCache: jest.fn().mockResolvedValue(),
        getCache: jest.fn(),
        setCache: jest.fn(),
        deleteCache: jest.fn(),
        isRedisConnected: jest.fn().mockReturnValue(true),
        default: {}
    }));
    
    redisModule = await import('../src/lib/redis.js');
    
    // Dynamically load EventBus after mock is registered
    const eb = await import('../src/events/eventBus.js');
    EventBus = eb.EventBus;
});

describe('Event Bus Architecture', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should correctly emit and route order.created event to clear caches', async () => {
        // We trigger the event
        EventBus.emit('order.created', { orderId: 100, buyerId: 1, sellerId: 2 });
        
        // Give event loop time to process async listeners
        await new Promise(r => setTimeout(r, 50));
        
        // Assert invalidateCache was called dynamically
        expect(redisModule.invalidateCache).toHaveBeenCalledWith('cache:*/orders*');
        expect(redisModule.invalidateCache).toHaveBeenCalledWith('cache:*/reports*');
    });

    it('should isolate error crashes within listeners without bringing down the bus', async () => {
        // Temporarily jam the invaildate cache hook
        redisModule.invalidateCache.mockRejectedValueOnce(new Error('Redis is down'));

        // Action
        EventBus.emit('cache.invalidate', { pattern: 'test' });
        
        // Event should resolve cleanly and trigger the catch block logger
        await new Promise(r => setTimeout(r, 100));
        
        // Test passes implicitly because it didn't throw an unhandled promise rejection
        expect(redisModule.invalidateCache).toHaveBeenCalledTimes(1);
    });
});

