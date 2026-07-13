const express = require('express');
const router = express.Router();
const vaultController = require('../controllers/vaultController');
const adminAuth = require('../middleware/adminAuth');

// Public
router.get('/billboard', vaultController.getVaultBillboard);
router.get('/', vaultController.getVaultHandles);
router.get('/:name', vaultController.getVaultHandle);
router.post('/:name/offer', vaultController.submitOffer);

// Admin
router.post('/admin/create', adminAuth, vaultController.createVaultHandle);
router.get('/admin/all', adminAuth, vaultController.getAllVaultHandlesAdmin);
router.patch('/admin/offers/:offerId', adminAuth, vaultController.updateOfferStatus);

module.exports = router;