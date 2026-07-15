const express = require('express');
const router = express.Router();
const transactionController = require('../controllers/transactionController');
const userAuth = require('../middleware/userAuth');

// Public — ToyyibPay server-to-server callback. NEVER put auth on this.
router.post('/callback', transactionController.handleCallback);

// Authenticated — userId comes from the body, checked against the token
router.post('/renew', userAuth, userAuth.ownsResource, transactionController.initiateRenewal);
router.post('/vault-purchase', userAuth, userAuth.ownsResource, transactionController.initiateVaultPurchase);
router.post('/vault-renewal', userAuth, userAuth.ownsResource, transactionController.initiateVaultRenewal);
router.post('/premium-purchase', userAuth, userAuth.ownsResource, transactionController.initiatePremiumPurchase);
router.post('/premium-renewal', userAuth, userAuth.ownsResource, transactionController.initiatePremiumRenewal);

// Param route LAST so it never swallows the named routes above
router.get('/:userId', userAuth, userAuth.ownsResource, transactionController.getUserTransactions);

module.exports = router;