import express from 'express';
import { submitComplaint, getMyComplaints } from '../controllers/complaintController.js';
import { authenticateToken } from '../../../middlewares/authMiddleware.js';

const router = express.Router();

// All complaint routes require authentication
router.use(authenticateToken);

router.post('/', submitComplaint);
router.get('/my', getMyComplaints);

export default router;
