import Stripe from 'stripe';

// Initialize Stripe with secret key from environment
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2023-10-16'
});

// Default currency from environment or fallback to PKR
const DEFAULT_CURRENCY = process.env.STRIPE_CURRENCY || 'pkr';

/**
 * Create a PaymentIntent
 * @param {number} amount - Amount in smallest currency unit (e.g., paisa for PKR)
 * @param {string} currency - Currency code (default: PKR)
 * @param {object} metadata - Additional metadata (orderId, buyerId, etc.)
 * @param {boolean} captureManual - If true, requires manual capture
 * @returns {Promise<Stripe.PaymentIntent>}
 */
export const createPaymentIntent = async (amount, currency = DEFAULT_CURRENCY, metadata = {}, captureManual = true) => {
    try {
        const paymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(amount * 100), // Convert to smallest currency unit
            currency: currency.toLowerCase(),
            metadata,
            capture_method: captureManual ? 'manual' : 'automatic',
            // Enable automatic payment methods for flexibility
            automatic_payment_methods: {
                enabled: true
            }
        });

        return paymentIntent;
    } catch (error) {
        console.error('Stripe createPaymentIntent error:', error);
        throw new Error(`Failed to create PaymentIntent: ${error.message}`);
    }
};

/**
 * Retrieve a PaymentIntent by ID
 * @param {string} paymentIntentId - Stripe PaymentIntent ID
 * @returns {Promise<Stripe.PaymentIntent>}
 */
export const retrievePaymentIntent = async (paymentIntentId) => {
    try {
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
        return paymentIntent;
    } catch (error) {
        console.error('Stripe retrievePaymentIntent error:', error);
        throw new Error(`Failed to retrieve PaymentIntent: ${error.message}`);
    }
};

/**
 * Confirm a PaymentIntent (used server-side when needed)
 * @param {string} paymentIntentId - Stripe PaymentIntent ID
 * @param {string} paymentMethodId - Optional payment method ID
 * @returns {Promise<Stripe.PaymentIntent>}
 */
export const confirmPaymentIntent = async (paymentIntentId, paymentMethodId = null) => {
    try {
        const params = {};
        if (paymentMethodId) {
            params.payment_method = paymentMethodId;
        }

        const paymentIntent = await stripe.paymentIntents.confirm(paymentIntentId, params);
        return paymentIntent;
    } catch (error) {
        console.error('Stripe confirmPaymentIntent error:', error);
        throw new Error(`Failed to confirm PaymentIntent: ${error.message}`);
    }
};

/**
 * Capture a PaymentIntent (for manual capture mode)
 * @param {string} paymentIntentId - Stripe PaymentIntent ID
 * @param {number} amountToCapture - Optional amount to capture (partial capture)
 * @returns {Promise<Stripe.PaymentIntent>}
 */
export const capturePaymentIntent = async (paymentIntentId, amountToCapture = null) => {
    try {
        const params = {};
        if (amountToCapture !== null) {
            params.amount_to_capture = Math.round(amountToCapture * 100);
        }

        const paymentIntent = await stripe.paymentIntents.capture(paymentIntentId, params);
        return paymentIntent;
    } catch (error) {
        console.error('Stripe capturePaymentIntent error:', error);
        throw new Error(`Failed to capture PaymentIntent: ${error.message}`);
    }
};

/**
 * Cancel a PaymentIntent
 * @param {string} paymentIntentId - Stripe PaymentIntent ID
 * @returns {Promise<Stripe.PaymentIntent>}
 */
export const cancelPaymentIntent = async (paymentIntentId) => {
    try {
        const paymentIntent = await stripe.paymentIntents.cancel(paymentIntentId);
        return paymentIntent;
    } catch (error) {
        console.error('Stripe cancelPaymentIntent error:', error);
        throw new Error(`Failed to cancel PaymentIntent: ${error.message}`);
    }
};

/**
 * Create a refund for a PaymentIntent
 * @param {string} paymentIntentId - Stripe PaymentIntent ID
 * @param {number} amount - Optional amount to refund (partial refund). Null = full refund
 * @param {string} reason - Reason for refund (duplicate, fraudulent, requested_by_customer)
 * @returns {Promise<Stripe.Refund>}
 */
export const createRefund = async (paymentIntentId, amount = null, reason = 'requested_by_customer') => {
    try {
        const params = {
            payment_intent: paymentIntentId,
            reason
        };

        if (amount !== null) {
            params.amount = Math.round(amount * 100);
        }

        const refund = await stripe.refunds.create(params);
        return refund;
    } catch (error) {
        console.error('Stripe createRefund error:', error);
        throw new Error(`Failed to create refund: ${error.message}`);
    }
};

/**
 * List refunds for a PaymentIntent
 * @param {string} paymentIntentId - Stripe PaymentIntent ID
 * @returns {Promise<Stripe.ApiList<Stripe.Refund>>}
 */
export const listRefunds = async (paymentIntentId) => {
    try {
        const refunds = await stripe.refunds.list({
            payment_intent: paymentIntentId
        });
        return refunds;
    } catch (error) {
        console.error('Stripe listRefunds error:', error);
        throw new Error(`Failed to list refunds: ${error.message}`);
    }
};

/**
 * Map Stripe PaymentIntent status to our PaymentStatus
 * @param {string} stripeStatus - Stripe PaymentIntent status
 * @returns {string} Our PaymentStatus
 */
export const mapStripeStatusToPaymentStatus = (stripeStatus) => {
    const statusMap = {
        'requires_payment_method': 'INITIATED',
        'requires_confirmation': 'INITIATED',
        'requires_action': 'INITIATED',
        'processing': 'INITIATED',
        'requires_capture': 'AUTHORIZED',
        'canceled': 'FAILED',
        'succeeded': 'CAPTURED'
    };

    return statusMap[stripeStatus] || 'INITIATED';
};

export default {
    createPaymentIntent,
    retrievePaymentIntent,
    confirmPaymentIntent,
    capturePaymentIntent,
    cancelPaymentIntent,
    createRefund,
    listRefunds,
    mapStripeStatusToPaymentStatus
};
