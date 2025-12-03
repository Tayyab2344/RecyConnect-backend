/**
 * Build date range filter
 * @param {string} startDate 
 * @param {string} endDate 
 * @returns {object} Prisma date filter
 */
export const buildDateFilter = (startDate, endDate) => {
    if (!startDate && !endDate) return {};

    return {
        createdAt: {
            ...(startDate && { gte: new Date(startDate) }),
            ...(endDate && { lte: new Date(endDate) })
        }
    };
};

/**
 * Build search filter for multiple fields
 * @param {string} search 
 * @param {string[]} fields 
 * @returns {object} Prisma OR filter
 */
export const buildSearchFilter = (search, fields) => {
    if (!search) return {};

    return {
        OR: fields.map(field => ({
            [field]: { contains: search, mode: 'insensitive' }
        }))
    };
};

/**
 * Calculate pagination parameters
 * @param {number|string} page 
 * @param {number|string} limit 
 * @returns {object} { skip, take, page, limit }
 */
export const getPaginationParams = (page = 1, limit = 10) => {
    const p = parseInt(page);
    const l = parseInt(limit);
    return {
        skip: (p - 1) * l,
        take: l,
        page: p,
        limit: l
    };
};
