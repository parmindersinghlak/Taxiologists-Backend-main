// src/routes/shifts.js
const express = require('express');
const router = express.Router();

const { authenticateToken, requireRole } = require('../middleware/auth');
const { getShiftUploadMiddleware, handleShiftUploadError } = require('../services/shiftPhotoUploadService');
const shiftController = require('../controllers/shiftController');

// All shift routes require auth
router.use(authenticateToken);

// Start a new shift (driver only) with start meter photo
router.post(
  '/start',
  requireRole(['driver']),
  ...getShiftUploadMiddleware(),
  handleShiftUploadError,
  shiftController.startShift
);

// Update shift (e.g., photo URL from Supabase)
router.patch('/:shiftId', requireRole(['driver']), shiftController.updateShift);

// End the current shift (driver only)
router.post('/:shiftId/end', requireRole(['driver']), shiftController.endShift);

// Get current active shift (driver only)
router.get('/current', requireRole(['driver']), shiftController.getCurrentShift);

// Get ride statistics for a specific shift (driver only)
router.get('/:shiftId/ride-statistics', requireRole(['driver']), shiftController.getShiftRideStatistics);

// Admin/Manager routes
// Get shift timeline (filter by driver and/or date)
router.get('/timeline', requireRole(['admin', 'manager']), shiftController.getShiftTimeline);

// Get shift history for a specific driver
router.get('/driver/:driverId/history', requireRole(['admin', 'manager']), shiftController.getDriverShiftHistory);

module.exports = router;
