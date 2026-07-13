const express = require('express');
const router = express.Router();
const handleController = require('../controllers/handleController');

router.get('/search', handleController.searchHandle);
router.post('/purchase', handleController.purchaseHandle);
router.get('/mine/:userId', handleController.getMyHandle);
router.get('/verify/:handleName', handleController.verifyHandle);
router.get('/billboard', handleController.getBillboard);

router.post('/admin/curated-words', handleController.addCuratedWord);
router.get('/admin/curated-words', handleController.listCuratedWords);
router.delete('/admin/curated-words/:id', handleController.removeCuratedWord);

module.exports = router;