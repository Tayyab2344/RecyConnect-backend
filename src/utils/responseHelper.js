/**
 * Send success response
 * @param {object} res Express response object
 * @param {string} message Success message
 * @param {object} data Data to send
 * @param {number} statusCode HTTP status code (default 200)
 */
export const sendSuccess = (res, message, data = null, statusCode = 200) => {
    const response = {
        success: true,
        message
    };

    if (data) {
        response.data = data;
    }

    res.status(statusCode).json(response);
};

/**
 * Send paginated response
 * @param {object} res Express response object
 * @param {Array} data List of items
 * @param {number} totalCount Total number of items
 * @param {number} page Current page
 * @param {number} limit Items per page
 */
export const sendPaginated = (res, data, totalCount, page, limit) => {
    const p = parseInt(page);
    const l = parseInt(limit);
    const totalPages = Math.ceil(totalCount / l);

    res.json({
        success: true,
        data,
        pagination: {
            total: totalCount,
            page: p,
            limit: l,
            totalPages,
            hasNextPage: p < totalPages,
            hasPreviousPage: p > 1
        }
    });
};

/**
 * Send error response
 * @param {object} res Express response object
 * @param {string} message Error message
 * @param {object} error Error object or details
 * @param {number} statusCode HTTP status code (default 500)
 * @param {string} errorCode Optional standardized error code
 */
export const sendError = (res, message, error = null, statusCode = 500, errorCode = null) => {
    // Only log in non-test environment
    if (process.env.NODE_ENV !== 'test') {
        console.error(`Error: ${message}`, error);
    }

    const response = {
        success: false,
        message
    };

    if (errorCode) {
        response.code = errorCode;
    }

    if (error) {
        response.error = error.message || error;
    }

    res.status(statusCode).json(response);
};
