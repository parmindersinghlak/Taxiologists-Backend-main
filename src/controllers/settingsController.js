const Settings = require("../models/Settings");

const DEFAULT_GST_RATE = 11; 

function getReqUserId(req) {
  // normalize whatever your auth provides
  return req?.user?.id || req?.user?._id || req?.user?.userId || null;
}

/**
 * GET /api/settings/gst
 * Roles: admin | manager
 */
async function getGSTSettings(req, res, next) {
  try {
    let gstSetting = await Settings.findOne({ key: "gst_rate" });

    if (!gstSetting) {
      const userId = getReqUserId(req);            
      if (!userId) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }
      gstSetting = new Settings({
        key: "gst_rate",
        value: DEFAULT_GST_RATE, // divisor
        description: "GST calculation divisor (Fare Per Person ÷ this value)",
        updatedBy: userId,                              
      });
      await gstSetting.save();
    }

    // return "gstDivisor" to be explicit
    return res.json({
      success: true,
      gstDivisor: gstSetting.value,
      description: gstSetting.description,
      lastUpdated: gstSetting.updatedAt,
    });
  } catch (e) {
    next(e);
  }
}

/**
 * PUT /api/settings/gst
 * Roles: admin only
 */
async function updateGSTSettings(req, res, next) {
  try {
    const userId = getReqUserId(req);               
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    // accept both names to avoid FE/BE drift
    const incoming = req.body?.gstDivisor ?? req.body?.gstRate;
    const divisor = Number(incoming);

    if (!Number.isFinite(divisor) || divisor <= 0) {
      return res.status(400).json({
        success: false,
        code: "VALIDATION_ERROR",
        message: "GST divisor must be a positive number",
      });
    }

    let gstSetting = await Settings.findOne({ key: "gst_rate" });

    if (!gstSetting) {
      gstSetting = new Settings({
        key: "gst_rate",
        value: divisor,
        description: "GST calculation divisor (Fare Per Person ÷ this value)",
        updatedBy: userId,                             
      });
    } else {
      gstSetting.value = divisor;
      gstSetting.updatedBy = userId;                  
    }

    await gstSetting.save();

    return res.json({
      success: true,
      message: "GST divisor updated successfully",
      gstDivisor: gstSetting.value,
    });
  } catch (e) {
    next(e);
  }
}

/**
 * Helper: current GST divisor
 */
async function getCurrentGSTRate() {
  try {
    const gstSetting = await Settings.findOne({ key: "gst_rate" });
    return gstSetting ? gstSetting.value : DEFAULT_GST_RATE;
  } catch (e) {
    return DEFAULT_GST_RATE;
  }
}

/**
 * Helper: calculate GST from fare per person
 */
async function calculateGST(farePerPerson) {
  const gstDivisor = await getCurrentGSTRate(); // this is a divisor
  return Number((farePerPerson / gstDivisor).toFixed(2));
}

module.exports = {
  getGSTSettings,
  updateGSTSettings,
  getCurrentGSTRate,
  calculateGST,
};
