const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ============================================================
// SHOP ITEMS — CRUD
//
// The shop is a generic list of items. An "item" is whatever the
// seller sells — a car, a takaful plan, a class, a plate of food.
// Fields are free text so any trade fits. No images are stored;
// hasImages just signals the buyer to contact the seller for photos.
//
// All routes here are the owner acting on their own shop. userId
// comes from the token via ownsResource, never from the body.
// ============================================================

// ---- Owner: list my items ----
exports.getMyItems = async (req, res) => {
  try {
    const { userId } = req.params;
    const items = await prisma.shopItem.findMany({
      where: { userId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    res.json({ items });
  } catch (err) {
    console.error('getMyItems error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// ---- Owner: add an item ----
exports.addItem = async (req, res) => {
  try {
    const { userId } = req.params;
    const { name, price, detail, hasImages } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Item name is required' });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    // New item goes to the end of the list
    const count = await prisma.shopItem.count({ where: { userId } });

    const item = await prisma.shopItem.create({
      data: {
        userId,
        name: name.trim(),
        price: price ? String(price).trim() : null,
        detail: detail ? String(detail).trim() : null,
        hasImages: hasImages === true,
        isAvailable: true,
        sortOrder: count,
      },
    });

    res.status(201).json({ message: 'Item added', item });
  } catch (err) {
    console.error('addItem error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// ---- Owner: update an item ----
exports.updateItem = async (req, res) => {
  try {
    const { userId, itemId } = req.params;
    const { name, price, detail, hasImages, isAvailable } = req.body;

    const existing = await prisma.shopItem.findUnique({ where: { id: itemId } });
    if (!existing) return res.status(404).json({ error: 'Item not found' });

    // An owner may only touch their own items
    if (existing.userId !== userId) {
      return res.status(403).json({ error: 'This item does not belong to you' });
    }

    const data = {};
    if (name !== undefined) {
      if (!name.trim()) return res.status(400).json({ error: 'Item name cannot be empty' });
      data.name = name.trim();
    }
    if (price !== undefined) data.price = price ? String(price).trim() : null;
    if (detail !== undefined) data.detail = detail ? String(detail).trim() : null;
    if (hasImages !== undefined) data.hasImages = hasImages === true;
    if (isAvailable !== undefined) data.isAvailable = isAvailable === true;

    if (!Object.keys(data).length) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    const item = await prisma.shopItem.update({ where: { id: itemId }, data });
    res.json({ message: 'Item updated', item });
  } catch (err) {
    console.error('updateItem error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// ---- Owner: delete an item ----
exports.deleteItem = async (req, res) => {
  try {
    const { userId, itemId } = req.params;

    const existing = await prisma.shopItem.findUnique({ where: { id: itemId } });
    if (!existing) return res.status(404).json({ error: 'Item not found' });
    if (existing.userId !== userId) {
      return res.status(403).json({ error: 'This item does not belong to you' });
    }

    await prisma.shopItem.delete({ where: { id: itemId } });
    res.json({ message: 'Item deleted' });
  } catch (err) {
    console.error('deleteItem error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// ---- Owner: reorder items ----
// Body: { order: [itemId1, itemId2, ...] } in the desired sequence.
exports.reorderItems = async (req, res) => {
  try {
    const { userId } = req.params;
    const { order } = req.body;

    if (!Array.isArray(order) || !order.length) {
      return res.status(400).json({ error: 'order must be a non-empty array of item ids' });
    }

    // Confirm every id belongs to this user before writing anything
    const items = await prisma.shopItem.findMany({ where: { userId } });
    const owned = new Set(items.map((i) => i.id));
    if (!order.every((id) => owned.has(id))) {
      return res.status(403).json({ error: 'Order contains items that are not yours' });
    }

    await prisma.$transaction(
      order.map((id, index) =>
        prisma.shopItem.update({ where: { id }, data: { sortOrder: index } })
      )
    );

    res.json({ message: 'Order updated' });
  } catch (err) {
    console.error('reorderItems error:', err.message);
    res.status(500).json({ error: err.message });
  }
};