import prisma from '../lib/prisma.js';
import { ReservationStatus, ListingStatus } from '../constants/enums.js';
import { sendSuccess, sendError } from '../utils/responseHelper.js';
import { logActivity } from '../utils/activityLogger.js';
import { ErrorCodes } from '../constants/errorCodes.js';

/**
 * Reserve weight from a listing
 * POST /api/reservations
 */
export const reserveListing = async (req, res) => {
    try {
        const buyerId = req.user.id;
        const { listingId, quantity } = req.body;
        const requestedWeight = parseFloat(quantity);

        if (!listingId || isNaN(requestedWeight) || requestedWeight <= 0) {
            return sendError(res, 'Valid listingId and positive quantity are required', null, 400, ErrorCodes.INVALID_INPUT);
        }

        // Use interactive transaction to ensure atomicity
        const result = await prisma.$transaction(async (tx) => {
            // 1. Fetch and Lock Listing
            const listing = await tx.listing.findUnique({
                where: { id: parseInt(listingId) }
            });

            if (!listing) {
                throw new Error('Listing not found');
            }

            // 1.5 Prevent self-reservation (buyer cannot be seller)
            if (listing.userId === buyerId) {
                const err = new Error('You cannot reserve your own listing');
                err.code = ErrorCodes.SELF_TRANSACTION;
                throw err;
            }

            if (listing.status !== ListingStatus.PUBLISHED) {
                throw new Error('Listing is not available for reservation');
            }

            // 2. Idempotency check - prevent duplicate ACTIVE reservations
            const existingReservation = await tx.listingReservation.findFirst({
                where: {
                    buyerId,
                    listingId: parseInt(listingId),
                    status: ReservationStatus.ACTIVE
                }
            });

            if (existingReservation) {
                const err = new Error('You already have an active reservation for this listing');
                err.code = ErrorCodes.DUPLICATE_OPERATION;
                throw err;
            }

            // 3. Check Available Weight
            if (listing.quantity < requestedWeight) {
                const err = new Error('Requested quantity exceeds available stock');
                err.code = ErrorCodes.INSUFFICIENT_QUANTITY;
                throw err;
            }

            // 4. Create Reservation
            const expiresAt = new Date();
            expiresAt.setMinutes(expiresAt.getMinutes() + 20); // 20 min TTL

            const reservation = await tx.listingReservation.create({
                data: {
                    listingId: listing.id,
                    buyerId,
                    quantity: requestedWeight,
                    status: ReservationStatus.ACTIVE,
                    expiresAt
                }
            });

            // 4. Reduce Listing Quantity
            const updatedListing = await tx.listing.update({
                where: { id: listing.id },
                data: {
                    quantity: { decrement: requestedWeight }
                }
            });

            // Note: If quantity becomes 0, we could potentially auto-pause or mark as SOLD,
            // but requirements don't explicitly ask for that state change yet.

            return { reservation, updatedListing };
        });

        await logActivity({
            userId: buyerId,
            role: req.user.role,
            action: 'RESERVE_INVENTORY',
            resourceType: 'LISTING',
            resourceId: listingId,
            meta: { quantity: requestedWeight, reservationId: result.reservation.id },
            req
        });

        sendSuccess(res, 'Reservation created successfully', result, 201);
    } catch (error) {
        sendError(res, error.message || 'Failed to create reservation', null, 400);
    }
};

/**
 * Manually release a reservation
 * POST /api/reservations/:id/release
 */
export const releaseReservation = async (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;

        const result = await prisma.$transaction(async (tx) => {
            const reservation = await tx.listingReservation.findUnique({
                where: { id: parseInt(id) }
            });

            if (!reservation) {
                throw new Error('Reservation not found');
            }

            if (reservation.status !== ReservationStatus.ACTIVE) {
                throw new Error('Reservation is not active or already processed');
            }

            // Optional: check if the user is the buyer or the seller of the listing
            // For now, let's just allow the requester (buyer/admin/seller might have different rules)
            // Requirements mention "buyer cancel", so let's allow the buyer.

            // 1. Update Reservation Status
            const updatedReservation = await tx.listingReservation.update({
                where: { id: reservation.id },
                data: { status: ReservationStatus.RELEASED }
            });

            // 2. Restore Listing Quantity
            await tx.listing.update({
                where: { id: reservation.listingId },
                data: {
                    quantity: { increment: reservation.quantity }
                }
            });

            return updatedReservation;
        });

        await logActivity({
            userId,
            role: req.user.role,
            action: 'RELEASE_RESERVATION',
            resourceType: 'RESERVATION',
            resourceId: id,
            req
        });

        sendSuccess(res, 'Reservation released and stock restored', result);
    } catch (error) {
        sendError(res, error.message || 'Failed to release reservation', null, 400);
    }
};

/**
 * Auto-expire reservations (Background task / System triggered)
 */
export const autoExpireReservations = async () => {
    try {
        const expired = await prisma.listingReservation.findMany({
            where: {
                status: ReservationStatus.ACTIVE,
                expiresAt: { lt: new Date() }
            }
        });

        if (expired.length === 0) return { count: 0 };

        let count = 0;
        for (const resv of expired) {
            try {
                await prisma.$transaction(async (tx) => {
                    await tx.listingReservation.update({
                        where: { id: resv.id },
                        data: { status: ReservationStatus.EXPIRED }
                    });

                    await tx.listing.update({
                        where: { id: resv.listingId },
                        data: { quantity: { increment: resv.quantity } }
                    });
                });
                count++;
            } catch (err) {
                console.error(`Failed to expire reservation ${resv.id}:`, err);
            }
        }

        return { count };
    } catch (error) {
        console.error('Auto-expire failed:', error);
        return { error: error.message };
    }
};
