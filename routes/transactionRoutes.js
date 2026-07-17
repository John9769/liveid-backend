const express = require('express');
const router = express.Router();
const multer = require('multer');
const transactionController = require('../controllers/transactionController');
const userAuth = require('../middleware/userAuth');

// ToyyibPay sends the callback as multipart/form-data, not the
// x-www-form-urlencoded their docs describe. express.urlencoded cannot
// parse multipart, so req.body arrives undefined. multer().none() reads
// the text fields into req.body. Handles both formats.
const parseCallbackBody = multer().none();

// Public — ToyyibPay server-to-server callback. NEVER put auth on this.
router.post('/callback', parseCallbackBody, transactionController.handleCallback);

// Authenticated — userId comes from the body, checked against the token
router.post('/renew', userAuth, userAuth.ownsResource, transactionController.initiateRenewal);
router.post('/premium-purchase', userAuth, userAuth.ownsResource, transactionController.initiatePremiumPurchase);
router.post('/premium-renewal', userAuth, userAuth.ownsResource, transactionController.initiatePremiumRenewal);
router.post('/title-renewal', userAuth, userAuth.ownsResource, transactionController.initiateTitleRenewal);

// Param route LAST so it never swallows the named routes above
router.get('/:userId', userAuth, userAuth.ownsResource, transactionController.getUserTransactions);

module.exports = router;