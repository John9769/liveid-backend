const express = require('express');
const router = express.Router();
const referralController = require('../controllers/referralController');
const userAuth = require('../middleware/userAuth');
const adminAuth = require('../middleware/adminAuth');

// Public — FE validates a referral code from the URL or cookie
router.get('/validate/:code', referralController.validateReferralCode);

// Authenticated — referral dashboard. Email in the URL is checked
// against the token's user inside the controller guard below.
router.get('/my-dashboard/:email', userAuth, referralController.getMyDashboard);

// Admin only — all management endpoints
router.post('/', adminAuth, referralController.createReferral);
router.get('/', adminAuth, referralController.getAllReferrals);

// Super Referral management — declared before /:id so they are reachable
router.patch('/:id/promote', adminAuth, referralController.promoteToSuperReferral);
router.patch('/:id/demote', adminAuth, referralController.demoteFromSuperReferral);
router.patch('/:id/assign-super', adminAuth, referralController.assignSuperReferral);
router.patch('/:id/remove-super', adminAuth, referralController.removeSuperReferralAssignment);

// Earnings and payouts
router.get('/:id/earnings', adminAuth, referralController.getReferralEarnings);
router.get('/:id/override-earnings', adminAuth, referralController.getOverrideEarnings);
router.post('/:id/payout', adminAuth, referralController.markPayout);
router.post('/:id/override-payout', adminAuth, referralController.markOverridePayout);

router.get('/:id', adminAuth, referralController.getReferral);
router.patch('/:id', adminAuth, referralController.updateReferral);

module.exports = router;