import Menu from '../models/Menu.js';
import { createError } from '../utils/error.js';

// Helper to normalize date to YYYY-MM-DD (no time)
function normalizeDate(date) {
  const d = new Date(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// Create or update menu for a specific date
export const createOrUpdateMenuForDate = async (req, res, next) => {
  try {
    const { date, meals } = req.body;
    console.log('Received menu POST:', { date, meals });
    if (!date || !meals) {
      throw createError(400, 'date and meals are required');
    }
    const normDate = normalizeDate(date);
    let menu = await Menu.findOne({ date: normDate });
    if (menu) {
      menu.meals = meals;
      await menu.save();
    } else {
      menu = await Menu.create({ date: normDate, meals });
    }
    console.log('Saved menu document:', menu);
    res.json({ success: true, data: menu });
  } catch (error) {
    next(error);
  }
};

// Get menu for a specific date
export const getMenuForDate = async (req, res, next) => {
  try {
    const { date } = req.query;
    if (!date) throw createError(400, 'date is required');
    const normDate = normalizeDate(date);
    const menu = await Menu.findOne({ date: normDate });
    if (!menu) throw createError(404, 'Menu for this date not found');
    res.json({ success: true, data: menu });
  } catch (error) {
    next(error);
  }
};

// Get today's menu (for student dashboard)
export const getMenuForToday = async (req, res, next) => {
  try {
    const today = normalizeDate(new Date());
    const menu = await Menu.findOne({ date: today });
    if (!menu) throw createError(404, 'Menu for today not found');
    res.json({ success: true, data: menu });
  } catch (error) {
    next(error);
  }
};

// Add a new item to a specific meal for a date
export const addMenuItemForDate = async (req, res, next) => {
  try {
    const { date, mealType, item } = req.body;
    if (!date || !mealType || !item) {
      throw createError(400, 'date, mealType, and item are required');
    }
    const normDate = normalizeDate(date);
    let menu = await Menu.findOne({ date: normDate });
    if (!menu) {
      // Create menu for date if not exists
      menu = await Menu.create({ date: normDate, meals: { breakfast: [], lunch: [], dinner: [] } });
    }
    if (!menu.meals[mealType]) throw createError(400, 'Invalid meal type');
    if (!menu.meals[mealType].includes(item)) {
      menu.meals[mealType].push(item);
      await menu.save();
    }
    res.json({ success: true, data: menu });
  } catch (error) {
    next(error);
  }
};

// Remove an item from a specific meal for a date
export const deleteMenuItemForDate = async (req, res, next) => {
  try {
    const { date, mealType, item } = req.body;
    if (!date || !mealType || !item) {
      throw createError(400, 'date, mealType, and item are required');
    }
    const normDate = normalizeDate(date);
    const menu = await Menu.findOne({ date: normDate });
    if (!menu) throw createError(404, 'Menu for this date not found');
    if (!menu.meals[mealType]) throw createError(400, 'Invalid meal type');
    menu.meals[mealType] = menu.meals[mealType].filter(i => i !== item);
    await menu.save();
    res.json({ success: true, data: menu });
  } catch (error) {
    next(error);
  }
}; 