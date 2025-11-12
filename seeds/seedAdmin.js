require("dotenv").config();
const { connectDB } = require("../src/config/db");
const User = require("../src/models/User");
const { ROLES } = require("../src/utils/constants");

(async () => {
  try {
    await connectDB(process.env.MONGO_URI);

    const username = process.env.SEED_ADMIN_USERNAME || "admin";
    const email = process.env.SEED_ADMIN_EMAIL || "admin@example.com";
    const password = process.env.SEED_ADMIN_PASSWORD || "Admin@12345";
    const fullName = "System Admin";
    const phone = "+10000000000";

    const existing = await User.findOne({ $or: [{ username }, { email }] });
    if (existing) {
      
      process.exit(0);
    }

    const admin = await User.create({
      username,
      email,
      password,
      fullName,
      phone,
      role: ROLES.ADMIN,
    });
    
    process.exit(0);
  } catch (e) {
    
    process.exit(1);
  }
})();
