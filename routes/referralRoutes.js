const express = require('express');
const router = express.Router();
const referralController = require('../controllers/referralController');
const adminAuth = require('../middleware/adminAuth');

// Public — FE validates referral code from cookie
router.get('/validate/:code', referralController.validateReferralCode);

// Admin only — all management endpoints
router.post('/', adminAuth, referralController.createReferral);
router.get('/', adminAuth, referralController.getAllReferrals);
router.get('/:id', adminAuth, referralController.getReferral);
router.patch('/:id', adminAuth, referralController.updateReferral);

// Super Referral management
router.patch('/:id/promote', adminAuth, referralController.promoteToSuperReferral);
router.patch('/:id/demote', adminAuth, referralController.demoteFromSuperReferral);
router.patch('/:id/assign-super', adminAuth, referralController.assignSuperReferral);
router.patch('/:id/remove-super', adminAuth, referralController.removeSuperReferralAssignment);

// Earnings and payouts
router.get('/:id/earnings', adminAuth, referralController.getReferralEarnings);
router.get('/:id/override-earnings', adminAuth, referralController.getOverrideEarnings);
router.post('/:id/payout', adminAuth, referralController.markPayout);
router.post('/:id/override-payout', adminAuth, referralController.markOverridePayout);

module.exports = router;