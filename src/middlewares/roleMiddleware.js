import { sendError } from '../utils/responseHelper.js'

export function permit(...allowedRoles) {
  return (req, res, next) => {
    const role = req.user?.role
    if (!role || !allowedRoles.includes(role)) {
      return sendError(res, 'Forbidden', null, 403)
    }
    next()
  }
}
