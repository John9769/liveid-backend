const express = require('express');
const router = express.Router();
const multer = require('multer');
const authController = require('../controllers/authController');

const upload = multer({ storage: multer.memoryStorage() });

router.post('/verify-liveness', upload.single('photo'), authController.verifyLiveness);
router.post('/start-verification', authController.startVerification);
router.get('/transaction-status/:transactionId', authController.checkTransactionStatus);
router.post('/login', authController.loginUser);
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);
router.post('/change-password', authController.changePassword);
router.get('/profile/:userId', authController.getUserProfile);
router.delete('/account/:userId', authController.deleteAccount);

module.exports = router;