const express = require('express');
const router = express.Router();
const agreementController = require('../controllers/agreementController');
const { authenticateToken } = require('../middleware/auth');
const { getUploadMiddleware, handleUploadError } = require('../services/photoUploadService');

// Driver agreement routes
router.get('/status', authenticateToken, agreementController.getStatus);
router.get('/text', authenticateToken, agreementController.getAgreementText);
router.post('/', authenticateToken, agreementController.submitAgreement);

// Photo upload route
router.post('/upload-photo', 
  authenticateToken, 
  getUploadMiddleware(), 
  handleUploadError,
  agreementController.uploadAgreementPhoto
);

module.exports = router;