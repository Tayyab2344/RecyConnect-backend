/**
 * Field Selection Middleware
 * 
 * Parses `?fields=id,status,title` from the query string and
 * attaches a Prisma-compatible `select` object to `req.prismaSelect`.
 * 
 * Usage:
 *   router.get('/listings', authenticate, fieldSelect(LISTING_FIELDS), getListings);
 *   // In controller: const select = req.prismaSelect || undefined;
 * 
 * @param {string[]} allowedFields - Whitelist of selectable fields for this model
 * @returns {Function} Express middleware
 */
export const fieldSelect = (allowedFields = []) => {
  return (req, res, next) => {
    const { fields } = req.query;

    if (!fields || typeof fields !== 'string') {
      // No field selection requested — controller uses default behavior
      req.prismaSelect = null;
      return next();
    }

    const requestedFields = fields
      .split(',')
      .map(f => f.trim())
      .filter(f => f.length > 0);

    if (requestedFields.length === 0) {
      req.prismaSelect = null;
      return next();
    }

    // Build Prisma select object, only including allowed fields
    const select = {};
    let hasValidField = false;

    for (const field of requestedFields) {
      if (allowedFields.length === 0 || allowedFields.includes(field)) {
        select[field] = true;
        hasValidField = true;
      }
    }

    // Always include 'id' for consistency
    if (hasValidField) {
      select.id = true;
      req.prismaSelect = select;
    } else {
      req.prismaSelect = null;
    }

    next();
  };
};

/**
 * Allowed fields per model (whitelist to prevent data leaks)
 */
export const LISTING_FIELDS = [
  'id', 'userId', 'category', 'title', 'description', 'materialType',
  'estimatedWeight', 'price', 'quantity', 'pickupAddress', 'images',
  'latitude', 'longitude', 'locationMethod', 'notes', 'status',
  'createdAt', 'updatedAt'
];

export const ORDER_FIELDS = [
  'id', 'buyerId', 'sellerId', 'status', 'totalAmount', 'paymentMethod',
  'cogs', 'stripeFee', 'collectorCost', 'netProfit', 'stripePaymentId',
  'createdAt', 'updatedAt'
];

export const USER_FIELDS = [
  'id', 'name', 'email', 'role', 'businessName', 'companyName',
  'profileImage', 'address', 'contactNo', 'city', 'area',
  'verificationStatus', 'kycStage', 'createdAt'
];

export const TRANSACTION_FIELDS = [
  'id', 'buyerId', 'sellerId', 'itemId', 'quantity',
  'totalAmount', 'status', 'createdAt', 'updatedAt'
];
