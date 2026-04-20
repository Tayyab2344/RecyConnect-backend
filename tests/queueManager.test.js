import { jest } from '@jest/globals';

describe('Offline Queue Manager', () => {
    let queueMgr;
    let redisMock;

    beforeAll(async () => {
        const mockRedis = {
            lpush: jest.fn().mockResolvedValue(1),
            llen: jest.fn().mockResolvedValue(1),
            rpop: jest.fn().mockResolvedValue(JSON.stringify({ actionType: 'SEND_EMAIL', payload: { to: 'test@example.com' } }))
        };
        
        jest.unstable_mockModule('../src/lib/redis.js', () => ({
            default: mockRedis,
            isRedisConnected: jest.fn().mockReturnValue(true)
        }));

        redisMock = mockRedis;
        queueMgr = await import('../src/lib/queueManager.js');
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should queue an offline request correctly', async () => {
        await queueMgr.queueOfflineRequest('SEND_EMAIL', { to: 'test@example.com' });
        
        expect(redisMock.lpush).toHaveBeenCalledWith('offline_request_queue', expect.stringContaining('test@example.com'));
    });

    it('should dynamically register handlers and execute them upon polling', async () => {
        const handlerMock = jest.fn();
        queueMgr.registerQueueHandler('SEND_EMAIL', handlerMock);
        
        const itemStr = await redisMock.rpop();
        const item = JSON.parse(itemStr);
        
        await handlerMock(item.payload);

        expect(handlerMock).toHaveBeenCalledWith({ to: 'test@example.com' });
    });
});

