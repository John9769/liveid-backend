const express = require('express');
const router = express.Router();
const celebrityController = require('../controllers/celebrityController');
const adminAuth = require('../middleware/adminAuth');

// All admin only — celebrity pipeline is private
router.post('/', adminAuth, celebrityController.createCelebrity);
router.get('/', adminAuth, celebrityController.getAllCelebrities);
router.get('/:id', adminAuth, celebrityController.getCelebrity);
router.patch('/:id', adminAuth, celebrityController.updateCelebrity);
router.post('/:id/handles', adminAuth, celebrityController.createCelebrityHandle);

module.exports = router;