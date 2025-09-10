import { createError } from '../utils/error.js';
import GlobalSettings from '../models/GlobalSettings.js';

// Get all global settings
export const getGlobalSettings = async (req, res, next) => {
  try {
    const settings = await GlobalSettings.getOrCreate();
    
    res.json({
      success: true,
      data: settings
    });
  } catch (error) {
    next(error);
  }
};

// Update global settings
export const updateGlobalSettings = async (req, res, next) => {
  try {
    const { section, data } = req.body;
    
    if (!section || !data) {
      return next(createError(400, 'Section and data are required'));
    }
    
    // Validate section
    const validSections = ['institution', 'urls', 'seo', 'system'];
    if (!validSections.includes(section)) {
      return next(createError(400, 'Invalid section. Valid sections: institution, urls, seo, system'));
    }
    
    // Update settings in database
    const settings = await GlobalSettings.updateSettings(
      section, 
      data, 
      req.admin?._id || req.admin?.id
    );
    
    res.json({
      success: true,
      data: {
        message: `${section} settings updated successfully`,
        updatedSection: settings[section],
        lastUpdated: settings.lastUpdated
      }
    });
  } catch (error) {
    next(error);
  }
};

// Get specific setting by key
export const getSettingByKey = async (req, res, next) => {
  try {
    const { key } = req.params;
    const settings = await GlobalSettings.getOrCreate();
    
    // Navigate to nested property using dot notation
    const keys = key.split('.');
    let value = settings;
    
    for (const k of keys) {
      value = value?.[k];
      if (value === undefined) break;
    }
    
    res.json({
      success: true,
      data: {
        key,
        value: value || null
      }
    });
  } catch (error) {
    next(error);
  }
};

// Update specific setting by key
export const updateSettingByKey = async (req, res, next) => {
  try {
    const { key } = req.params;
    const { value } = req.body;
    
    const settings = await GlobalSettings.getOrCreate();
    
    // Navigate to nested property and update
    const keys = key.split('.');
    const lastKey = keys.pop();
    let target = settings;
    
    for (const k of keys) {
      if (!target[k]) target[k] = {};
      target = target[k];
    }
    
    target[lastKey] = value;
    settings.lastUpdated = new Date();
    settings.updatedBy = req.admin?._id || req.admin?.id;
    
    await settings.save();
    
    res.json({
      success: true,
      data: {
        key,
        value,
        message: 'Setting updated successfully'
      }
    });
  } catch (error) {
    next(error);
  }
};

// Reset all settings to default
export const resetSettingsToDefault = async (req, res, next) => {
  try {
    // Delete existing settings
    await GlobalSettings.deleteMany({});
    
    // Create new default settings
    const settings = new GlobalSettings({});
    await settings.save();
    
    res.json({
      success: true,
      data: {
        message: 'Settings reset to default successfully',
        settings
      }
    });
  } catch (error) {
    next(error);
  }
};
