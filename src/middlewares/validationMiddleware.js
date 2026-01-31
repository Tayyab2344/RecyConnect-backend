import { sendError } from '../utils/responseHelper.js';
import { ErrorCodes } from '../constants/errorCodes.js';

/**
 * Validate that a field is a positive number
 * @param {string} fieldName - Name of the field in request body
 * @param {string} location - 'body', 'params', or 'query'
 */
export const validatePositiveNumber = (fieldName, location = 'body') => {
    return (req, res, next) => {
        const source = req[location];
        const value = parseFloat(source[fieldName]);

        if (isNaN(value) || value <= 0) {
            return sendError(
                res,
                `${fieldName} must be a positive number`,
                null,
                400,
                ErrorCodes.INVALID_INPUT
            );
        }

        // Store parsed value back
        source[fieldName] = value;
        next();
    };
};

/**
 * Validate that a param is a valid positive integer ID
 * @param {string} paramName - Name of the param
 */
export const validateId = (paramName = 'id') => {
    return (req, res, next) => {
        const value = parseInt(req.params[paramName]);

        if (isNaN(value) || value <= 0) {
            return sendError(
                res,
                `${paramName} must be a valid positive integer`,
                null,
                400,
                ErrorCodes.INVALID_INPUT
            );
        }

        req.params[paramName] = value;
        next();
    };
};

/**
 * Validate pagination parameters
 * Ensures page >= 1 and limit between 1 and 100
 */
export const validatePagination = (req, res, next) => {
    let { page = 1, limit = 10 } = req.query;

    page = parseInt(page);
    limit = parseInt(limit);

    if (isNaN(page) || page < 1) {
        page = 1;
    }

    if (isNaN(limit) || limit < 1) {
        limit = 10;
    }

    if (limit > 100) {
        limit = 100;
    }

    req.query.page = page;
    req.query.limit = limit;
    next();
};

/**
 * Validate required fields in request body
 * @param {string[]} fields - Array of required field names
 */
export const validateRequired = (fields) => {
    return (req, res, next) => {
        const missing = [];

        for (const field of fields) {
            if (req.body[field] === undefined || req.body[field] === null || req.body[field] === '') {
                missing.push(field);
            }
        }

        if (missing.length > 0) {
            return sendError(
                res,
                `Missing required fields: ${missing.join(', ')}`,
                null,
                400,
                ErrorCodes.MISSING_REQUIRED_FIELD
            );
        }

        next();
    };
};

/**
 * Validate amount is positive and reasonable
 */
export const validateAmount = (fieldName = 'amount') => {
    return (req, res, next) => {
        const value = parseFloat(req.body[fieldName]);

        if (isNaN(value) || value <= 0) {
            return sendError(
                res,
                `${fieldName} must be a positive number`,
                null,
                400,
                ErrorCodes.INVALID_AMOUNT
            );
        }

        if (value > 10000000) { // 10 million limit
            return sendError(
                res,
                `${fieldName} exceeds maximum allowed value`,
                null,
                400,
                ErrorCodes.INVALID_AMOUNT
            );
        }

        req.body[fieldName] = value;
        next();
    };
};

/**
 * Validate weight/quantity is positive
 */
export const validateQuantity = (fieldName = 'quantity') => {
    return (req, res, next) => {
        const value = parseFloat(req.body[fieldName]);

        if (isNaN(value) || value <= 0) {
            return sendError(
                res,
                `${fieldName} must be greater than 0`,
                null,
                400,
                ErrorCodes.INVALID_INPUT
            );
        }

        req.body[fieldName] = value;
        next();
    };
};

export default {
    validatePositiveNumber,
    validateId,
    validatePagination,
    validateRequired,
    validateAmount,
    validateQuantity
};
