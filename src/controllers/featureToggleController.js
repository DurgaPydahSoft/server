import FeatureToggle from '../models/FeatureToggle.js';
import { createError } from '../utils/error.js';

// Get all feature toggles (Admin only)
export const getFeatureToggles = async (req, res, next) => {
  try {
    const toggles = await FeatureToggle.getFeatureToggles();
    
    // Only return the toggle values, not the full document
    const adminToggles = {
      overview: toggles.overview,
      raiseComplaint: toggles.raiseComplaint,
      myComplaints: toggles.myComplaints,
      attendance: toggles.attendance,
      leave: toggles.leave,
      foundLost: toggles.foundLost,
      hostelFee: toggles.hostelFee,
      paymentHistory: toggles.paymentHistory,
      announcements: toggles.announcements,
      polls: toggles.polls,
      profile: toggles.profile
    };
    
    res.status(200).json({
      success: true,
      data: adminToggles
    });
  } catch (error) {
    console.error('Error fetching feature toggles:', error);
    next(createError(500, 'Failed to fetch feature toggles'));
  }
};

// Update feature toggles (Admin only)
export const updateFeatureToggles = async (req, res, next) => {
  try {
    const updates = req.body;
    
    // Validate that all updates are boolean values
    const validFeatures = [
      'overview', 'raiseComplaint', 'myComplaints', 'attendance', 
      'leave', 'foundLost', 'hostelFee', 'paymentHistory', 
      'announcements', 'polls', 'profile'
    ];
    
    // Filter out non-feature fields (like _id, createdAt, updatedAt)
    const filteredUpdates = {};
    for (const [key, value] of Object.entries(updates)) {
      if (validFeatures.includes(key)) {
        if (typeof value !== 'boolean') {
          throw createError(400, `Invalid value for ${key}: must be boolean`);
        }
        filteredUpdates[key] = value;
      }
    }
    
    const toggles = await FeatureToggle.updateFeatureToggles(filteredUpdates);
    
    res.status(200).json({
      success: true,
      message: 'Feature toggles updated successfully',
      data: toggles
    });
  } catch (error) {
    console.error('Error updating feature toggles:', error);
    next(error);
  }
};

// Get feature toggles for students (filtered, no admin info)
export const getStudentFeatureToggles = async (req, res, next) => {
  try {
    const toggles = await FeatureToggle.getFeatureToggles();
    
    // Only return the toggle values, not the full document
    const studentToggles = {
      overview: toggles.overview,
      raiseComplaint: toggles.raiseComplaint,
      myComplaints: toggles.myComplaints,
      attendance: toggles.attendance,
      leave: toggles.leave,
      foundLost: toggles.foundLost,
      hostelFee: toggles.hostelFee,
      paymentHistory: toggles.paymentHistory,
      announcements: toggles.announcements,
      polls: toggles.polls,
      profile: toggles.profile
    };
    
    res.status(200).json({
      success: true,
      data: studentToggles
    });
  } catch (error) {
    console.error('Error fetching student feature toggles:', error);
    next(createError(500, 'Failed to fetch feature toggles'));
  }
};

// Reset all features to default (Admin only)
export const resetFeatureToggles = async (req, res, next) => {
  try {
    const defaultToggles = {
      overview: true,
      raiseComplaint: true,
      myComplaints: true,
      attendance: true,
      leave: true,
      foundLost: true,
      hostelFee: true,
      paymentHistory: true,
      announcements: true,
      polls: true,
      profile: true
    };
    
    const toggles = await FeatureToggle.updateFeatureToggles(defaultToggles);
    
    res.status(200).json({
      success: true,
      message: 'Feature toggles reset to default successfully',
      data: toggles
    });
  } catch (error) {
    console.error('Error resetting feature toggles:', error);
    next(error);
  }
}; 