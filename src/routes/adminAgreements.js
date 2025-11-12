const express = require('express');
const router = express.Router();
const adminAgreementController = require('../controllers/adminAgreementController');
const { authenticateToken, isAdmin } = require('../middleware/auth');

// Admin agreement routes
router.get('/', authenticateToken, isAdmin, adminAgreementController.getAgreements);
router.put('/:id/status', authenticateToken, isAdmin, adminAgreementController.updateStatus);
router.post('/:id/reset', authenticateToken, isAdmin, adminAgreementController.resetAgreement);
router.delete('/:id', authenticateToken, isAdmin, adminAgreementController.deleteAgreement);

module.exports = router;