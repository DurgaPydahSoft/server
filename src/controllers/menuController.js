import Menu from '../models/Menu.js';
import { createError } from '../utils/error.js';
import User from '../models/User.js';
import notificationService from '../utils/notificationService.js';

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

    // Send notification if menu is for today
    const today = normalizeDate(new Date());
    if (normDate.getTime() === today.getTime()) {
      try {
        const students = await User.find({ role: 'student' });
        
        if (students.length > 0) {
          const studentIds = students.map(student => student._id);
          
          await notificationService.sendMenuNotification(
            studentIds,
            menu,
            req.admin ? req.admin.name : 'Admin',
            req.admin ? req.admin._id : null
          );

          console.log('🍽️ Menu notification sent to students:', studentIds.length);
        }
      } catch (notificationError) {
        console.error('🍽️ Error sending menu notification:', notificationError);
        // Don't fail the menu update if notification fails
      }
    }

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

// Get today's menu with user's ratings (for student dashboard)
export const getMenuForTodayWithRatings = async (req, res, next) => {
  try {
    const today = normalizeDate(new Date());
    const menu = await Menu.findOne({ date: today });
    if (!menu) throw createError(404, 'Menu for today not found');
    
    // Get user's ratings for today
    const userRatings = menu.ratings.filter(rating => 
      rating.studentId.toString() === req.user.id
    );
    
    // Calculate average ratings for each meal
    const avgRatings = {};
    ['breakfast', 'lunch', 'dinner'].forEach(mealType => {
      const mealRatings = menu.ratings.filter(r => r.mealType === mealType);
      if (mealRatings.length > 0) {
        const total = mealRatings.reduce((sum, r) => sum + r.rating, 0);
        avgRatings[mealType] = {
          average: Math.round((total / mealRatings.length) * 10) / 10,
          totalRatings: mealRatings.length
        };
      } else {
        avgRatings[mealType] = { average: 0, totalRatings: 0 };
      }
    });
    
    res.json({ 
      success: true, 
      data: {
        ...menu.toObject(),
        userRatings,
        avgRatings
      }
    });
  } catch (error) {
    next(error);
  }
};

// Submit a rating for a meal
export const submitMealRating = async (req, res, next) => {
  try {
    const { date, mealType, rating, comment } = req.body;
    const studentId = req.user.id;
    
    if (!date || !mealType || !rating) {
      throw createError(400, 'date, mealType, and rating are required');
    }
    
    if (!['breakfast', 'lunch', 'dinner'].includes(mealType)) {
      throw createError(400, 'Invalid meal type');
    }
    
    if (rating < 1 || rating > 5) {
      throw createError(400, 'Rating must be between 1 and 5');
    }
    
    const normDate = normalizeDate(date);
    let menu = await Menu.findOne({ date: normDate });
    
    if (!menu) {
      throw createError(404, 'Menu for this date not found');
    }
    
    // Check if user already rated this meal
    const existingRatingIndex = menu.ratings.findIndex(r => 
      r.studentId.toString() === studentId && r.mealType === mealType
    );
    
    const newRating = {
      mealType,
      rating,
      studentId,
      comment: comment || '',
      createdAt: new Date()
    };
    
    if (existingRatingIndex !== -1) {
      // Update existing rating
      menu.ratings[existingRatingIndex] = newRating;
    } else {
      // Add new rating
      menu.ratings.push(newRating);
    }
    
    await menu.save();
    
    res.json({ 
      success: true, 
      message: 'Rating submitted successfully',
      data: newRating
    });
  } catch (error) {
    next(error);
  }
};

// Get user's rating for a specific meal
export const getUserMealRating = async (req, res, next) => {
  try {
    const { date, mealType } = req.query;
    const studentId = req.user.id;
    
    if (!date || !mealType) {
      throw createError(400, 'date and mealType are required');
    }
    
    const normDate = normalizeDate(date);
    const menu = await Menu.findOne({ date: normDate });
    
    if (!menu) {
      throw createError(404, 'Menu for this date not found');
    }
    
    const userRating = menu.ratings.find(r => 
      r.studentId.toString() === studentId && r.mealType === mealType
    );
    
    res.json({ 
      success: true, 
      data: userRating || null
    });
  } catch (error) {
    next(error);
  }
};

// Get rating statistics for admin
export const getRatingStats = async (req, res, next) => {
  try {
    const { date } = req.query;
    const normDate = normalizeDate(date || new Date());
    
    const menu = await Menu.findOne({ date: normDate });
    if (!menu) {
      throw createError(404, 'Menu for this date not found');
    }
    
    const stats = {};
    ['breakfast', 'lunch', 'dinner'].forEach(mealType => {
      const mealRatings = menu.ratings.filter(r => r.mealType === mealType);
      
      if (mealRatings.length > 0) {
        const total = mealRatings.reduce((sum, r) => sum + r.rating, 0);
        const average = Math.round((total / mealRatings.length) * 10) / 10;
        
        // Count ratings by star
        const ratingCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        mealRatings.forEach(r => {
          ratingCounts[r.rating]++;
        });
        
        stats[mealType] = {
          average,
          totalRatings: mealRatings.length,
          ratingCounts,
          comments: mealRatings.filter(r => r.comment).map(r => ({
            rating: r.rating,
            comment: r.comment,
            createdAt: r.createdAt
          }))
        };
      } else {
        stats[mealType] = {
          average: 0,
          totalRatings: 0,
          ratingCounts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
          comments: []
        };
      }
    });
    
    res.json({ success: true, data: stats });
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

      // Send notification if menu is for today
      const today = normalizeDate(new Date());
      if (normDate.getTime() === today.getTime()) {
        try {
          const students = await User.find({ role: 'student' });
          
          if (students.length > 0) {
            const studentIds = students.map(student => student._id);
            
            await notificationService.sendMenuNotification(
              studentIds,
              menu,
              req.admin ? req.admin.name : 'Admin',
              req.admin ? req.admin._id : null
            );

            console.log('🍽️ Menu item added notification sent to students:', studentIds.length);
          }
        } catch (notificationError) {
          console.error('🍽️ Error sending menu notification:', notificationError);
          // Don't fail the menu update if notification fails
        }
      }
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