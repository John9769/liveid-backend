const express = require('express');
const router = express.Router();
const multer = require('multer');
const authController = require('../controllers/authController');
const userAuth = require('../middleware/userAuth');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed'));
    }
    cb(null, true);
  },
});

// Public — registration flow
router.post('/verify-liveness', upload.single('photo'), authController.verifyLiveness);
router.post('/start-verification', authController.startVerification);
router.get('/transaction-status/:transactionId', authController.checkTransactionStatus);
router.post('/claim-session', authController.claimSession);

// Public — auth
router.post('/login', authController.loginUser);
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);

// Authenticated — own account only
router.post('/change-password', userAuth, authController.changePassword);
router.get('/profile/:userId', userAuth, userAuth.ownsResource, authController.getUserProfile);
router.delete('/account/:userId', userAuth, userAuth.ownsResource, authController.deleteAccount);

module.exports = router;