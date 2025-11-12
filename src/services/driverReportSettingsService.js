/**
 * Driver Report Settings Service
 * Manages configuration settings for driver reports
 */

const Settings = require("../models/Settings");

// Default settings for driver reports
const DEFAULT_DRIVER_REPORT_SETTINGS = {
  rentalRatePercentage: 45,
  tripLevyRate: 1.32,
  gstRate: 10,
  photoUploadMaxSize: 5,
  requirePhotoForEFTPOS: true,
  requirePhotoForExpenses: true,
  autoApproveThreshold: 0,
  notifyAdminsOnSubmission: true,
  retentionPeriodDays: 2555, // 7 years for tax purposes
  allowReportEditsAfterSubmission: false
};

const SETTING_KEY = 'driverReportSettings';

/**
 * Get driver report settings
 * Returns merged default and custom settings
 */
async function getDriverReportSettings() {
  try {
    const setting = await Settings.findOne({ key: SETTING_KEY });
    
    if (!setting) {
      return DEFAULT_DRIVER_REPORT_SETTINGS;
    }

    // Merge defaults with stored settings to ensure all keys exist
    return {
      ...DEFAULT_DRIVER_REPORT_SETTINGS,
      ...setting.value
    };
  } catch (error) {
    return DEFAULT_DRIVER_REPORT_SETTINGS;
  }
}

/**
 * Update driver report settings
 * @param {Object} newSettings - New settings to merge
 * @param {string} updatedBy - User ID who updated the settings
 */
async function updateDriverReportSettings(newSettings, updatedBy) {
  try {
    const currentSettings = await getDriverReportSettings();
    
    // Validate new settings
    const validatedSettings = validateSettings({
      ...currentSettings,
      ...newSettings
    });

    // Update or create settings record
    const result = await Settings.findOneAndUpdate(
      { key: SETTING_KEY },
      {
        key: SETTING_KEY,
        value: validatedSettings,
        description: 'Configuration settings for driver report system',
        updatedBy: updatedBy
      },
      { 
        upsert: true, 
        new: true,
        runValidators: true
      }
    );

    return {
      success: true,
      settings: result.value,
      updatedAt: result.updatedAt
    };
  } catch (error) {
    throw new Error('Failed to update settings: ' + error.message);
  }
}

/**
 * Validate settings values
 * Ensures all settings are within acceptable ranges
 */
function validateSettings(settings) {
  const validated = { ...settings };

  // Validate rental rate percentage (0-100)
  if (typeof validated.rentalRatePercentage !== 'number' || 
      validated.rentalRatePercentage < 0 || 
      validated.rentalRatePercentage > 100) {
    throw new Error('Rental rate percentage must be between 0 and 100');
  }

  // Validate trip levy rate (non-negative)
  if (typeof validated.tripLevyRate !== 'number' || validated.tripLevyRate < 0) {
    throw new Error('Trip levy rate must be a non-negative number');
  }

  // Validate GST rate (0-50, reasonable range)
  if (typeof validated.gstRate !== 'number' || 
      validated.gstRate < 0 || 
      validated.gstRate > 50) {
    throw new Error('GST rate must be between 0 and 50');
  }

  // Validate photo upload max size (1-50 MB)
  if (typeof validated.photoUploadMaxSize !== 'number' || 
      validated.photoUploadMaxSize < 1 || 
      validated.photoUploadMaxSize > 50) {
    throw new Error('Photo upload max size must be between 1 and 50 MB');
  }

  // Validate retention period (30-3650 days, 30 days to 10 years)
  if (typeof validated.retentionPeriodDays !== 'number' || 
      validated.retentionPeriodDays < 30 || 
      validated.retentionPeriodDays > 3650) {
    throw new Error('Retention period must be between 30 and 3650 days');
  }

  // Validate auto-approve threshold (non-negative)
  if (typeof validated.autoApproveThreshold !== 'number' || validated.autoApproveThreshold < 0) {
    throw new Error('Auto-approve threshold must be a non-negative number');
  }

  // Ensure boolean settings are boolean
  validated.requirePhotoForEFTPOS = Boolean(validated.requirePhotoForEFTPOS);
  validated.requirePhotoForExpenses = Boolean(validated.requirePhotoForExpenses);
  validated.notifyAdminsOnSubmission = Boolean(validated.notifyAdminsOnSubmission);
  validated.allowReportEditsAfterSubmission = Boolean(validated.allowReportEditsAfterSubmission);

  return validated;
}

/**
 * Get specific setting value
 * @param {string} settingName - Name of the setting to retrieve
 */
async function getSettingValue(settingName) {
  try {
    const settings = await getDriverReportSettings();
    return settings[settingName];
  } catch (error) {
    return DEFAULT_DRIVER_REPORT_SETTINGS[settingName];
  }
}

/**
 * Reset settings to defaults
 * @param {string} updatedBy - User ID who reset the settings
 */
async function resetToDefaults(updatedBy) {
  try {
    return await updateDriverReportSettings(DEFAULT_DRIVER_REPORT_SETTINGS, updatedBy);
  } catch (error) {
    throw error;
  }
}

/**
 * Get settings schema for validation on frontend
 */
function getSettingsSchema() {
  return {
    rentalRatePercentage: {
      type: 'number',
      min: 0,
      max: 100,
      label: 'Rental Rate Percentage (%)',
      description: 'Percentage of total fare and liftings that goes to rentals'
    },
    tripLevyRate: {
      type: 'number',
      min: 0,
      max: 10,
      label: 'Trip Levy Rate ($)',
      description: 'Government charge per trip in dollars'
    },
    gstRate: {
      type: 'number',
      min: 0,
      max: 50,
      label: 'GST Rate (%)',
      description: 'Goods and Services Tax rate percentage'
    },
    photoUploadMaxSize: {
      type: 'number',
      min: 1,
      max: 50,
      label: 'Photo Upload Max Size (MB)',
      description: 'Maximum file size allowed for photo uploads'
    },
    requirePhotoForEFTPOS: {
      type: 'boolean',
      label: 'Require Photo for EFTPOS',
      description: 'Require photo upload when EFTPOS amount is greater than $0'
    },
    requirePhotoForExpenses: {
      type: 'boolean',
      label: 'Require Photo for Expenses',
      description: 'Require photo upload when expense amount is greater than $0'
    },
    autoApproveThreshold: {
      type: 'number',
      min: 0,
      max: 10000,
      label: 'Auto-Approve Threshold ($)',
      description: 'Reports with net pay below this amount are auto-approved (0 = disabled)'
    },
    notifyAdminsOnSubmission: {
      type: 'boolean',
      label: 'Notify Admins on Submission',
      description: 'Send notifications to admins when reports are submitted'
    },
    retentionPeriodDays: {
      type: 'number',
      min: 30,
      max: 3650,
      label: 'Retention Period (Days)',
      description: 'How long to keep archived reports (recommended: 2555 days = 7 years)'
    },
    allowReportEditsAfterSubmission: {
      type: 'boolean',
      label: 'Allow Edits After Submission',
      description: 'Allow drivers to edit reports after submission (not recommended)'
    }
  };
}

module.exports = {
  getDriverReportSettings,
  updateDriverReportSettings,
  getSettingValue,
  resetToDefaults,
  getSettingsSchema,
  DEFAULT_DRIVER_REPORT_SETTINGS
};
