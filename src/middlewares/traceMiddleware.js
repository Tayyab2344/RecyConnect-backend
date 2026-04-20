import crypto from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';

// Setup Async Local Storage for deep trace injection without passing req around everywhere
export const traceStore = new AsyncLocalStorage();

/**
 * Tracing Middleware
 * 
 * Generates a globally unique Correlation ID (Trace ID) for every incoming request.
 * Exposes it on the HTTP response headers and places it in an AsyncLocalStorage
 * execution context so deepest database level logs can instantly map back to the route.
 */
export const traceMiddleware = (req, res, next) => {
    // Check if client provided their own trace header (e.g. from an API Gateway)
    const traceId = req.headers['x-trace-id'] || req.headers['x-correlation-id'] || crypto.randomUUID();
    
    // Stamp the raw request inside Express
    req.traceId = traceId;
    
    // Stamp the outgoing response headers for the client
    res.setHeader('X-Trace-Id', traceId);

    // Run the remaining pipeline isolated completely inside our Trace Context
    traceStore.run(traceId, () => {
        next();
    });
};

/**
 * Convenience helper to grab trace ID anywhere heavily nested
 */
export const getTraceId = () => {
    return traceStore.getStore();
};
