import Stripe from 'stripe';
import { PrismaClient } from '@prisma/client';
import { ItemStatus, TransactionStatus } from '../constants/enums.js';
import { sendSuccess, sendError } from '../utils/responseHelper.js';

const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');

/**
 * Create a payment intent for an item purchase
 */
export async function createPaymentIntent(req, res) {
    try {
        const { itemId, quantity } = req.body;
        const buyerId = req.user.id;

        // Get item details
        const item = await prisma.item.findUnique({
            where: { id: parseInt(itemId) },
            include: { seller: { select: { businessName: true, name: true } } }
        });

        if (!item) {
            return sendError(res, 'Item not found', null, 404);
        }

        if (item.status !== ItemStatus.AVAILABLE) {
            return sendError(res, 'Item is not available', null, 400);
        }

        if (item.quantity < quantity) {
            return sendError(res, 'Insufficient quantity', null, 400);
        }

        // Calculate amount in cents (Stripe uses smallest currency unit)
        const amount = Math.round(item.price * quantity * 100);

        // Create payment intent
        const paymentIntent = await stripe.paymentIntents.create({
            amount,
            currency: 'pkr', // Pakistani Rupee
            automatic_payment_methods: {
                enabled: true,
            },
            metadata: {
                itemId: itemId.toString(),
                sellerId: item.sellerId.toString(),
                buyerId: buyerId.toString(),
                quantity: quantity.toString(),
            },
            description: `Purchase of ${item.title} from ${item.seller.businessName || item.seller.name}`,
        });

        sendSuccess(res, 'Payment intent created', {
            clientSecret: paymentIntent.client_secret,
            paymentIntentId: paymentIntent.id,
        });
    } catch (err) {
        sendError(res, 'Failed to create payment intent', err);
    }
}

/**
 * Webhook to handle Stripe events (payment succeeded, failed, etc.)
 */
export async function handleWebhook(req, res) {
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
        console.error('Webhook signature verification failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the event
    switch (event.type) {
        case 'payment_intent.succeeded':
            const paymentIntent = event.data.object;
            await handlePaymentSuccess(paymentIntent);
            break;
        case 'payment_intent.payment_failed':
            const failedPayment = event.data.object;
            console.error('Payment failed:', failedPayment.id);
            break;
        default:
            console.log(`Unhandled event type ${event.type}`);
    }

    res.json({ received: true });
}

/**
 * Handle successful payment - create transaction record
 */
async function handlePaymentSuccess(paymentIntent) {
    try {
        const metadata = paymentIntent.metadata;

        await prisma.$transaction(async (tx) => {
            // Create transaction record
            await tx.transaction.create({
                data: {
                    buyerId: parseInt(metadata.buyerId),
                    sellerId: parseInt(metadata.sellerId),
                    itemId: parseInt(metadata.itemId),
                    quantity: parseFloat(metadata.quantity),
                    totalAmount: paymentIntent.amount / 100, // Convert back from cents
                    status: TransactionStatus.COMPLETED,
                }
            });

            // Update item quantity
            const item = await tx.item.findUnique({
                where: { id: parseInt(metadata.itemId) }
            });

            const newQuantity = item.quantity - parseFloat(metadata.quantity);
            await tx.item.update({
                where: { id: item.id },
                data: {
                    quantity: newQuantity,
                    status: newQuantity <= 0 ? ItemStatus.SOLD : ItemStatus.AVAILABLE
                }
            });
        });

        console.log('Payment processed successfully:', paymentIntent.id);
    } catch (err) {
        console.error('Error processing payment:', err);
    }
}

/**
 * Get payment status
 */
export async function getPaymentStatus(req, res) {
    try {
        const { paymentIntentId } = req.params;

        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

        sendSuccess(res, 'Payment status fetched', {
            status: paymentIntent.status,
            amount: paymentIntent.amount / 100,
        });
    } catch (err) {
        sendError(res, 'Failed to fetch payment status', err);
    }
}
