const express = require('express');
const router = express.Router();
const multer = require('multer');
const profileController = require('../controllers/profileController');

const upload = multer({ storage: multer.memoryStorage() });

// Public
router.get('/public/:handleName', profileController.getPublicProfile);

// Authenticated user
router.get('/:userId', profileController.getProfile);
router.put('/:userId', profileController.upsertProfile);
router.post('/:userId/photo', upload.single('photo'), profileController.uploadPhoto);

module.exports = router;