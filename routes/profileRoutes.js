const express = require('express');
const router = express.Router();
const multer = require('multer');
const profileController = require('../controllers/profileController');
const userAuth = require('../middleware/userAuth');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed'));
    }
    cb(null, true);
  },
});

// Public — the verification page. Declared FIRST so /public/* wins over /:userId
router.get('/public/:handleName', profileController.getPublicProfile);

// Public — number match check. Handle in the path, number in the body.
// Deliberately requires both: there is no way to ask "who owns this
// number", only "does this number belong to this handle".
router.post('/public/:handleName/check-whatsapp', profileController.checkWhatsapp);

// Authenticated — own profile only
router.get('/:userId', userAuth, userAuth.ownsResource, profileController.getProfile);
router.put('/:userId', userAuth, userAuth.ownsResource, profileController.upsertProfile);
router.post('/:userId/photo', userAuth, userAuth.ownsResource, upload.single('photo'), profileController.uploadPhoto);

module.exports = router;