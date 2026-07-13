const express = require('express');
const router = express.Router();
const pricingController = require('../controllers/pricingController');
const adminAuth = require('../middleware/adminAuth');

router.get('/', adminAuth, pricingController.getAllPricing);
router.patch('/', adminAuth, pricingController.updatePricing);

module.exports = router;