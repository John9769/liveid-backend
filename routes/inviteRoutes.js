const express = require('express');
const router = express.Router();
const inviteController = require('../controllers/inviteController');
const adminAuth = require('../middleware/adminAuth');

// Admin — declared FIRST so GET / is not shadowed by GET /:token
router.post('/', adminAuth, inviteController.createInvitation);
router.get('/', adminAuth, inviteController.getInvitations);
router.post('/:id/resend', adminAuth, inviteController.resendInvitation);
router.patch('/:id/revoke', adminAuth, inviteController.revokeInvitation);

// Public — referral/super referral completes onboarding
router.post('/:token/accept', inviteController.acceptInvitation);
router.get('/:token', inviteController.getInvitation);

module.exports = router;