const express = require('express');
const router = express.Router();
const shopController = require('../controllers/shopController');
const userAuth = require('../middleware/userAuth');

// All owner-only — userId in the URL is checked against the token
router.get('/:userId/items', userAuth, userAuth.ownsResource, shopController.getMyItems);
router.post('/:userId/items', userAuth, userAuth.ownsResource, shopController.addItem);
router.patch('/:userId/items/reorder', userAuth, userAuth.ownsResource, shopController.reorderItems);
router.patch('/:userId/items/:itemId', userAuth, userAuth.ownsResource, shopController.updateItem);
router.delete('/:userId/items/:itemId', userAuth, userAuth.ownsResource, shopController.deleteItem);

module.exports = router;