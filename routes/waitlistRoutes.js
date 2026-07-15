const express = require('express');
const router = express.Router();
const waitlistController = require('../controllers/waitlistController');
const adminAuth = require('../middleware/adminAuth');

// Public
router.post('/', waitlistController.joinWaitlist);

// Admin
router.get('/handle/:handleName', adminAuth, waitlistController.getWaitlistByHandle);
router.get('/', adminAuth, waitlistController.getWaitlist);
router.patch('/:id', adminAuth, waitlistController.updateWaitlistStatus);

module.exports = router;