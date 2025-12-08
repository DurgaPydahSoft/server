import NOCChecklistConfig from '../models/NOCChecklistConfig.js';
import { createError } from '../utils/error.js';

// Get all checklist items (active and inactive)
export const getAllChecklistItems = async (req, res, next) => {
  try {
    const { activeOnly } = req.query;
    
    let query = {};
    if (activeOnly === 'true') {
      query.isActive = true;
    }

    const items = await NOCChecklistConfig.find(query)
      .sort({ order: 1, createdAt: 1 })
      .populate('createdBy updatedBy', 'username role');

    res.json({
      success: true,
      data: items
    });
  } catch (error) {
    next(error);
  }
};

// Get single checklist item
export const getChecklistItem = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    const item = await NOCChecklistConfig.findById(id)
      .populate('createdBy updatedBy', 'username role');

    if (!item) {
      return next(createError(404, 'Checklist item not found'));
    }

    res.json({
      success: true,
      data: item
    });
  } catch (error) {
    next(error);
  }
};

// Create checklist item
export const createChecklistItem = async (req, res, next) => {
  try {
    const { description, order, isActive } = req.body;
    const adminId = req.user.id;

    if (!description || !description.trim()) {
      return next(createError(400, 'Description is required'));
    }

    // Get max order if not provided
    let itemOrder = order;
    if (itemOrder === undefined || itemOrder === null) {
      const maxOrderItem = await NOCChecklistConfig.findOne().sort({ order: -1 });
      itemOrder = maxOrderItem ? maxOrderItem.order + 1 : 0;
    }

    const checklistItem = new NOCChecklistConfig({
      description: description.trim(),
      order: itemOrder,
      isActive: isActive !== undefined ? isActive : true,
      createdBy: adminId,
      updatedBy: adminId
    });

    await checklistItem.save();

    const populatedItem = await NOCChecklistConfig.findById(checklistItem._id)
      .populate('createdBy updatedBy', 'username role');

    res.status(201).json({
      success: true,
      message: 'Checklist item created successfully',
      data: populatedItem
    });
  } catch (error) {
    next(error);
  }
};

// Update checklist item
export const updateChecklistItem = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { description, order, isActive } = req.body;
    const adminId = req.user.id;

    const checklistItem = await NOCChecklistConfig.findById(id);
    if (!checklistItem) {
      return next(createError(404, 'Checklist item not found'));
    }

    if (description !== undefined) {
      if (!description || !description.trim()) {
        return next(createError(400, 'Description cannot be empty'));
      }
      checklistItem.description = description.trim();
    }

    if (order !== undefined) {
      checklistItem.order = order;
    }

    if (isActive !== undefined) {
      checklistItem.isActive = isActive;
    }

    checklistItem.updatedBy = adminId;
    await checklistItem.save();

    const populatedItem = await NOCChecklistConfig.findById(id)
      .populate('createdBy updatedBy', 'username role');

    res.json({
      success: true,
      message: 'Checklist item updated successfully',
      data: populatedItem
    });
  } catch (error) {
    next(error);
  }
};

// Delete checklist item
export const deleteChecklistItem = async (req, res, next) => {
  try {
    const { id } = req.params;

    const checklistItem = await NOCChecklistConfig.findById(id);
    if (!checklistItem) {
      return next(createError(404, 'Checklist item not found'));
    }

    await NOCChecklistConfig.findByIdAndDelete(id);

    res.json({
      success: true,
      message: 'Checklist item deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

// Reorder checklist items
export const reorderChecklistItems = async (req, res, next) => {
  try {
    const { items } = req.body; // Array of { id, order }

    if (!Array.isArray(items)) {
      return next(createError(400, 'Items must be an array'));
    }

    const updatePromises = items.map(({ id, order }) =>
      NOCChecklistConfig.findByIdAndUpdate(id, { order }, { new: true })
    );

    await Promise.all(updatePromises);

    const updatedItems = await NOCChecklistConfig.find()
      .sort({ order: 1 })
      .populate('createdBy updatedBy', 'username role');

    res.json({
      success: true,
      message: 'Checklist items reordered successfully',
      data: updatedItems
    });
  } catch (error) {
    next(error);
  }
};

