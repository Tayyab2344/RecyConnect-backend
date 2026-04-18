import { jest } from '@jest/globals';
import { withExponentialBackoff } from '../src/utils/retryHelper.js';

describe('Retry Helper: Exponential Backoff', () => {
    afterEach(() => {
        jest.clearAllMocks();
        jest.useRealTimers();
    });

    it('should return result immediately if function succeeds on first try', async () => {
        const mockFn = jest.fn().mockResolvedValue('success');
        
        const result = await withExponentialBackoff(mockFn);
        
        expect(result).toBe('success');
        expect(mockFn).toHaveBeenCalledTimes(1);
    });

    it('should retry maxRetries times on consistent failure and then throw', async () => {
        const mockError = new Error('simulated network failure');
        const mockFn = jest.fn().mockRejectedValue(mockError);

        const promise = withExponentialBackoff(mockFn, 3, 10);
        
        await expect(promise).rejects.toThrow('simulated network failure');
        expect(mockFn).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
    });

    it('should succeed if it fails initially but succeeds before maxRetries', async () => {
        const mockFn = jest.fn()
            .mockRejectedValueOnce(new Error('fail 1'))
            .mockRejectedValueOnce(new Error('fail 2'))
            .mockResolvedValueOnce('eventual success');

        const promise = withExponentialBackoff(mockFn, 3, 10);

        const result = await promise;
        expect(result).toBe('eventual success');
        expect(mockFn).toHaveBeenCalledTimes(3); 
    });
});
