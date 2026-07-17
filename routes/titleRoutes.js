const express = require('express');
const router = express.Router();
const multer = require('multer');
const titleController = require('../controllers/titleController');
const adminAuth = require('../middleware/adminAuth');

// Title documents — warrants, certificates. Images or PDF.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    cb(new Error('Only image or PDF files are allowed'));
  },
});

// Admin — declared FIRST so /admin/* is never swallowed by a param route
router.get('/admin/requests', adminAuth, titleController.listTitleRequests);
router.post('/admin/requests/:id/approve', adminAuth, titleController.approveTitleRequest);
router.post('/admin/requests/:id/reject', adminAuth, titleController.rejectTitleRequest);

router.get('/admin/prices', adminAuth, titleController.listTitlePricesAdmin);
router.post('/admin/prices', adminAuth, titleController.addTitlePrice);
router.patch('/admin/prices/:id', adminAuth, titleController.updateTitlePrice);

// Public
router.get('/prices', titleController.listTitlePrices);
router.post('/request', upload.single('document'), titleController.submitTitleRequest);

// Param route LAST
router.get('/request/:id', titleController.getTitleRequestStatus);

module.exports = router;