const express = require('express');
const router = express.Router();
const handleController = require('../controllers/handleController');
const userAuth = require('../middleware/userAuth');
const adminAuth = require('../middleware/adminAuth');

// Admin — declared FIRST so /admin/* is never swallowed by a param route
router.post('/admin/curated-words', adminAuth, handleController.addCuratedWord);
router.get('/admin/curated-words', adminAuth, handleController.listCuratedWords);
router.delete('/admin/curated-words/:id', adminAuth, handleController.removeCuratedWord);

router.post('/admin/blocked-words', adminAuth, handleController.addBlockedWord);
router.get('/admin/blocked-words', adminAuth, handleController.listBlockedWords);
router.delete('/admin/blocked-words/:id', adminAuth, handleController.removeBlockedWord);

router.get('/admin/search-log', adminAuth, handleController.getSearchLog);

// Public
router.get('/search', handleController.searchHandle);
router.get('/billboard', handleController.getBillboard);

// REMOVED: GET /verify/:handleName
// This route served handleController.verifyHandle, which returned the
// owner's photo and WhatsApp number to anyone, logged in or not, with
// no viewer check of any kind. The verification page is now served by
// GET /api/profile/public/:handleName, which gates the photo and never
// releases the number unless the owner set it to PUBLIC.
// Delete the verifyHandle function from handleController.js too.

// Authenticated — own account only
router.post('/purchase', userAuth, userAuth.ownsResource, handleController.purchaseHandle);
router.get('/mine/:userId', userAuth, userAuth.ownsResource, handleController.getMyHandle);

module.exports = router;