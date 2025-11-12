require("dotenv").config();
const app = require("./app");
const { connectDB } = require("./config/db");
const Settings = require("./models/Settings");
const { initializeLocalStorage } = require("./services/photoUploadService");
const { getDriverReportSettings } = require("./services/driverReportSettingsService");

const port = process.env.PORT || 8080;

async function initializeDefaultSettings() {
  try {
    // Check if GST setting exists, create if not
    let gstSetting = await Settings.findOne({ key: "gst_rate" });
    
    if (!gstSetting) {
      // Create default admin user ID (you may need to adjust this)
      const adminUser = require("./models/User");
      const admin = await adminUser.findOne({ role: "admin" });
      
      if (admin) {
        gstSetting = new Settings({
          key: "gst_rate",
          value: 11, // Default: Fare Per Person ÷ 11
          description: "GST calculation divisor (Fare Per Person ÷ this value)",
          updatedBy: admin._id,
        });
        await gstSetting.save();
      }
    }

    // Initialize driver report settings
    await getDriverReportSettings();
    
  } catch (error) {
    throw error;
  }
}

async function initializeServices() {
  try {
    // Initialize Local Photo Storage
    initializeLocalStorage();
    
  } catch (error) {
    throw error;
  }
}

async function start() {
  await connectDB();
  await initializeDefaultSettings();
  await initializeServices();
  
  app.listen(port, () =>
    console.log(`🚕 Server running on http://localhost:${port}`)
  );
}

start();
