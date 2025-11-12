const jwt = require("jsonwebtoken");
const User = require("../models/User");

async function login(req, res, next) {
  try {
    const { username, password } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        code: "VALIDATION_ERROR",
        message: "username and password are required",
      });
    }

    const user = await User.findOne({ username });

    if (!user) {
      return res.status(401).json({
        success: false,
        code: "UNAUTHORIZED",
        message: "Invalid credentials",
      });
    }

    const ok = await user.comparePassword(password);

    if (!ok) {
      return res.status(401).json({
        success: false,
        code: "UNAUTHORIZED",
        message: "Invalid credentials",
      });
    }

    // Check terms acceptance for drivers only (managers don't need terms)
    if (user.role === "driver" && !user.termsAccepted) {
      return res.json({
        success: true,
        user: user.toJSON(),
        token: null,
        needsTerms: true,
      });
    }

    const payload = {
      id: user._id.toString(),
      role: user.role,
      fullName: user.fullName,
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || "7d",
    });

    res.json({ success: true, token, user: user.toJSON(), needsTerms: false });
  } catch (e) {
    next(e);
  }
}

async function acceptTerms(req, res, next) {
  try {
    const { username, password } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: "username and password are required",
      });
    }

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (user.role !== "driver") {
      return res.status(400).json({
        success: false,
        message: "Only drivers need to accept terms",
      });
    }

    const ok = await user.comparePassword(password);
    if (!ok) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    user.termsAccepted = true;
    user.termsAcceptedAt = new Date();
    await user.save();

    const token = jwt.sign(
      { id: user._id.toString(), role: user.role, fullName: user.fullName },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
    );

    return res.json({
      success: true,
      message: "Terms accepted successfully",
      user: user.toJSON(),
      token,
    });
  } catch (e) {
    next(e);
  }
}

module.exports = { login, acceptTerms };
