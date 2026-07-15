const express = require('express');
const router = express.Router();
const handleController = require('../controllers/handleController');
const userAuth = require('../middleware/userAuth');
const adminAuth = require('../middleware/adminAuth');

// Admin — declared FIRST so /admin/* is never swallowed by a param route
router.post('/admin/curated-words', adminAuth, handleController.addCuratedWord);
router.get('/admin/curated-words', adminAuth, handleController.listCuratedWords);
router.delete('/admin/curated-words/:id', adminAuth, handleController.removeCuratedWord);

// Public
router.get('/search', handleController.searchHandle);
router.get('/billboard', handleController.getBillboard);
router.get('/verify/:handleName', handleController.verifyHandle);

// Authenticated — own account only
router.post('/purchase', userAuth, userAuth.ownsResource, handleController.purchaseHandle);
router.get('/mine/:userId', userAuth, userAuth.ownsResource, handleController.getMyHandle);

module.exports = router;