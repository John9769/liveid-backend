const express = require('express');
const router = express.Router();
const adminAuth = require('../middleware/adminAuth');
const adminController = require('../controllers/adminController');

// Public — login only
router.post('/login', adminController.login);

// All routes below require an admin token
router.use(adminAuth);

// Overview
router.get('/overview', adminController.getOverview);

// Users
router.get('/users', adminController.getUsers);
router.get('/users/:userId', adminController.getUserDetail);

// Transactions
router.get('/transactions', adminController.getTransactions);

// Referrals
router.get('/referrals', adminController.getReferrals);
router.post('/referrals', adminController.createReferral);
router.put('/referrals/:referralId', adminController.updateReferral);
router.post('/referrals/:referralId/payout', adminController.markPayoutPaid);

// Verify logs
router.get('/verify-logs', adminController.getVerifyLogs);

// Celebrity pipeline
router.get('/celebrities', adminController.getCelebrities);
router.post('/celebrities', adminController.createCelebrity);
router.put('/celebrities/:celebrityId', adminController.updateCelebrity);

// Waitlist
router.get('/waitlist', adminController.getWaitlist);
router.put('/waitlist/:waitlistId', adminController.updateWaitlistStatus);

// Pricing
router.get('/pricing', adminController.getPricing);
router.patch('/pricing/:key', adminController.updatePricing);

// Invitations
router.get('/invitations', adminController.getInvitations);

module.exports = router;