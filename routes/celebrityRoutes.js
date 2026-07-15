const express = require('express');
const router = express.Router();
const celebrityController = require('../controllers/celebrityController');
const adminAuth = require('../middleware/adminAuth');

// All admin only — the celebrity pipeline is private
router.use(adminAuth);

router.post('/', celebrityController.createCelebrity);
router.get('/', celebrityController.getAllCelebrities);

// Handle reservation routes — declared before /:id
router.post('/:id/handles', celebrityController.createCelebrityHandle);
router.patch('/handles/:handleId', celebrityController.updateCelebrityHandle);
router.delete('/handles/:handleId', celebrityController.deleteCelebrityHandle);

router.get('/:id', celebrityController.getCelebrity);
router.patch('/:id', celebrityController.updateCelebrity);

module.exports = router;