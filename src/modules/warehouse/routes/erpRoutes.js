import express from 'express';
import multer from 'multer';
import { authenticateToken } from '../../../middlewares/authMiddleware.js';
import { permit } from '../../../middlewares/roleMiddleware.js';
import {
  getInventory,
  addInventoryItem,
  updateInventoryItem,
  deleteInventoryItem,
  getExpenses,
  addExpense,
  deleteExpense,
  getFinancialSummary,
  getCustomers,
  getReports,
  getAIInsights,
  askAIAssistant
} from '../controllers/erpController.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Apply global warehouse user checks for all ERP features
router.use(authenticateToken);
router.use(permit('warehouse'));

// 1. Inventory Endpoints
router.get('/inventory', getInventory);
router.post('/inventory', upload.single('image'), addInventoryItem);
router.put('/inventory/:id', updateInventoryItem);
router.delete('/inventory/:id', deleteInventoryItem);

// 2. Expense Endpoints
router.get('/expenses', getExpenses);
router.post('/expenses', upload.single('receipt'), addExpense);
router.delete('/expenses/:id', deleteExpense);

// 3. Profit & Loss Analytics
router.get('/financial-summary', getFinancialSummary);

// 4. Customer Analytics
router.get('/customers', getCustomers);

// 5. Report Exporting
router.get('/reports', getReports);

// 6. AI Insights & Forecasting
router.get('/ai-insights', getAIInsights);

// 7. AI Assistant Chat
router.post('/ai-assistant', askAIAssistant);

export default router;
