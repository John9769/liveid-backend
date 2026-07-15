const express = require('express');
const router = express.Router();
const vaultController = require('../controllers/vaultController');
const adminAuth = require('../middleware/adminAuth');

// Admin — declared FIRST. Previously /admin/all was unreachable because
// GET /:name matched it first and looked up a vault handle named "admin".
router.post('/admin/create', adminAuth, vaultController.createVaultHandle);
router.get('/admin/all', adminAuth, vaultController.getAllVaultHandlesAdmin);
router.patch('/admin/offers/:offerId', adminAuth, vaultController.updateOfferStatus);

// Public
router.get('/billboard', vaultController.getVaultBillboard);
router.get('/', vaultController.getVaultHandles);
router.post('/:name/offer', vaultController.submitOffer);
router.get('/:name', vaultController.getVaultHandle);

module.exports = router;