const express = require('express');
const router = express.Router();
const transactionController = require('../controllers/transactionController');

router.post('/callback', transactionController.handleCallback);
router.post('/renew', transactionController.initiateRenewal);
router.post('/vault-purchase', transactionController.initiateVaultPurchase);
router.post('/vault-renewal', transactionController.initiateVaultRenewal);
router.post('/premium-purchase', transactionController.initiatePremiumPurchase);
router.post('/premium-renewal', transactionController.initiatePremiumRenewal);
router.get('/:userId', transactionController.getUserTransactions);

module.exports = router;