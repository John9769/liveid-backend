const express = require('express');
const router = express.Router();
const inviteController = require('../controllers/inviteController');
const adminAuth = require('../middleware/adminAuth');

// Public — referral/super referral completes onboarding
router.get('/:token', inviteController.getInvitation);
router.post('/:token/accept', inviteController.acceptInvitation);

// Admin only
router.post('/', adminAuth, inviteController.createInvitation);
router.get('/', adminAuth, inviteController.getInvitations);
router.post('/:id/resend', adminAuth, inviteController.resendInvitation);
router.patch('/:id/revoke', adminAuth, inviteController.revokeInvitation);

module.exports = router;