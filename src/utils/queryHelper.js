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
    const p = Math.max(1, parseInt(page) || 1);
    const l = Math.min(100, Math.max(1, parseInt(limit) || 10)); // Cap at 100
    return {
        skip: (p - 1) * l,
        take: l,
        page: p,
        limit: l
    };
};

/**
 * Build sort parameters from query
 * Supports formats: "createdAt:desc" or just "createdAt"
 * @param {string} sortBy - Field name or "field:direction"
 * @param {string} sortOrder - 'asc' or 'desc' (fallback if not in sortBy)
 * @param {string[]} allowedSortFields - Whitelist of sortable fields
 * @returns {object} Prisma orderBy object
 */
export const buildSortParams = (sortBy = 'createdAt', sortOrder = 'desc', allowedSortFields = []) => {
    let field = sortBy;
    let order = sortOrder;

    // Support "field:direction" format
    if (sortBy.includes(':')) {
        const parts = sortBy.split(':');
        field = parts[0];
        order = parts[1] === 'asc' ? 'asc' : 'desc';
    }

    // Validate against allowed fields
    if (allowedSortFields.length > 0 && !allowedSortFields.includes(field)) {
        field = 'createdAt'; // Fallback to safe default
    }

    order = order === 'asc' ? 'asc' : 'desc';

    return { [field]: order };
};

/**
 * Build Prisma select object from a fields string
 * @param {string} fields - Comma-separated field names (e.g. "id,status,title")
 * @param {string[]} allowedFields - Whitelist of selectable fields
 * @returns {object|undefined} Prisma select object, or undefined for all fields
 */
export const buildFieldSelect = (fields, allowedFields = []) => {
    if (!fields || typeof fields !== 'string') return undefined;

    const requested = fields.split(',').map(f => f.trim()).filter(Boolean);
    if (requested.length === 0) return undefined;

    const select = { id: true }; // Always include id
    let hasValid = false;

    for (const f of requested) {
        if (allowedFields.length === 0 || allowedFields.includes(f)) {
            select[f] = true;
            hasValid = true;
        }
    }

    return hasValid ? select : undefined;
};

/**
 * Build generic filter params from query object
 * Maps query keys to Prisma where conditions based on field definitions
 * 
 * @param {object} query - Express req.query
 * @param {object[]} filterableFields - Array of { key, field?, type?, mode? }
 *   - key: query param name
 *   - field: Prisma field name (defaults to key)
 *   - type: 'string' | 'number' | 'boolean' | 'enum' (default 'string')
 *   - mode: 'equals' | 'contains' | 'in' (default 'equals')
 * @returns {object} Prisma where object
 * 
 * @example
 * buildFilterParams(req.query, [
 *   { key: 'status', type: 'enum' },
 *   { key: 'materialType', mode: 'contains' },
 *   { key: 'minPrice', field: 'price', type: 'number', mode: 'gte' },
 *   { key: 'maxPrice', field: 'price', type: 'number', mode: 'lte' },
 * ]);
 */
export const buildFilterParams = (query, filterableFields = []) => {
    const where = {};

    for (const { key, field, type = 'string', mode = 'equals' } of filterableFields) {
        const value = query[key];
        if (value === undefined || value === null || value === '') continue;

        const prismaField = field || key;

        // Parse value based on type
        let parsedValue;
        switch (type) {
            case 'number':
                parsedValue = parseFloat(value);
                if (isNaN(parsedValue)) continue;
                break;
            case 'boolean':
                parsedValue = value === 'true' || value === '1';
                break;
            case 'enum':
                parsedValue = value.toUpperCase();
                break;
            default:
                parsedValue = value;
        }

        // Build condition based on mode
        switch (mode) {
            case 'contains':
                where[prismaField] = { contains: parsedValue, mode: 'insensitive' };
                break;
            case 'in':
                where[prismaField] = { in: parsedValue.split(',').map(v => v.trim()) };
                break;
            case 'gte':
                where[prismaField] = { ...where[prismaField], gte: parsedValue };
                break;
            case 'lte':
                where[prismaField] = { ...where[prismaField], lte: parsedValue };
                break;
            default:
                if (type === 'string') {
                    where[prismaField] = { equals: parsedValue, mode: 'insensitive' };
                } else {
                    where[prismaField] = parsedValue;
                }
        }
    }

    return where;
};
