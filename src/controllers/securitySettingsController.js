import SecuritySettings from '../models/SecuritySettings.js';

// Get current security settings (singleton pattern)
export const getSettings = async (req, res) => {
  try {
    let settings = await SecuritySettings.findOne();
    if (!settings) {
      // Create default if not exists
      settings = await SecuritySettings.create({});
    }
    res.json({ success: true, data: settings });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch security settings', error: err.message });
  }
};

// Update security settings
export const updateSettings = async (req, res) => {
  try {
    const { viewProfilePictures, viewPhoneNumbers, viewGuardianImages } = req.body;
    let settings = await SecuritySettings.findOne();
    if (!settings) {
      settings = new SecuritySettings({});
    }
    if (typeof viewProfilePictures === 'boolean') settings.viewProfilePictures = viewProfilePictures;
    if (typeof viewPhoneNumbers === 'boolean') settings.viewPhoneNumbers = viewPhoneNumbers;
    if (typeof viewGuardianImages === 'boolean') settings.viewGuardianImages = viewGuardianImages;
    settings.updatedAt = new Date();
    // Optionally: settings.updatedBy = req.user?._id;
    await settings.save();
    res.json({ success: true, data: settings });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update security settings', error: err.message });
  }
}; 