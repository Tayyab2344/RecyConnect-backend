import { sendError } from '../utils/responseHelper.js'

export function errorHandler(err, req, res, next) {
  const status = err.status || 500
  const message = err.message || 'Internal Server Error'
  if (process.env.NODE_ENV !== 'production') {
    console.error(err)
  }
  sendError(res, message, null, status)
}
