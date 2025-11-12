// server/src/controllers/clientController.js
const Client = require("../models/Client");

async function listClients(req, res, next) {
  try {
    const { q, page = 1, limit = 20 } = req.query;
    const filter = { isDriverAdded: { $ne: true } }; // Exclude driver-added clients
    if (q) {
      filter.$or = [
        { name: new RegExp(q, "i") },
        { phone: new RegExp(q, "i") },
        { email: new RegExp(q, "i") },
        { mptpCardNumber: new RegExp(q, "i") },
        { planManager: new RegExp(q, "i") },
      ];
    }

    const docs = await Client.find(filter)
      .sort({ createdAt: -1 })
      .skip((+page - 1) * +limit)
      .limit(+limit);

    const total = await Client.countDocuments(filter);
    res.json({ success: true, items: docs, total, page: +page, limit: +limit });
  } catch (e) {
    next(e);
  }
}

async function createClient(req, res, next) {
  try {
    const { name, phone, email, address, mptpCardNumber, planManager } =
      req.body || {};

    if (!name) {
      return res.status(400).json({
        success: false,
        code: "VALIDATION_ERROR",
        message: "name is required",
      });
    }

    const doc = await Client.create({
      name,
      phone,
      email,
      address,
      mptpCardNumber,
      planManager,
      createdBy: req.user.id,
    });

    res.status(201).json({ success: true, client: doc });
  } catch (e) {
    next(e);
  }
}

async function getClient(req, res, next) {
  try {
    const doc = await Client.findById(req.params.id);
    if (!doc)
      return res.status(404).json({
        success: false,
        code: "NOT_FOUND",
        message: "Client not found",
      });
    res.json({ success: true, client: doc });
  } catch (e) {
    next(e);
  }
}

async function updateClient(req, res, next) {
  try {
    const { name, phone, email, address, mptpCardNumber, planManager } =
      req.body || {};

    const update = {};
    if (name !== undefined) update.name = name;
    if (phone !== undefined) update.phone = phone;
    if (email !== undefined) update.email = email;
    if (address !== undefined) update.address = address;
    if (mptpCardNumber !== undefined) update.mptpCardNumber = mptpCardNumber;
    if (planManager !== undefined) update.planManager = planManager;

    const doc = await Client.findByIdAndUpdate(req.params.id, update, {
      new: true,
    });

    if (!doc)
      return res.status(404).json({
        success: false,
        code: "NOT_FOUND",
        message: "Client not found",
      });

    res.json({ success: true, client: doc });
  } catch (e) {
    next(e);
  }
}

async function deleteClient(req, res, next) {
  try {
    const doc = await Client.findByIdAndDelete(req.params.id);
    if (!doc)
      return res.status(404).json({
        success: false,
        code: "NOT_FOUND",
        message: "Client not found",
      });
    res.json({ success: true, message: "Client deleted successfully" });
  } catch (e) {
    next(e);
  }
}

// Get admin-created clients (for driver selection during ride completion)
async function getAdminClients(req, res, next) {
  try {
    const clients = await Client.find({ isDriverAdded: { $ne: true } })
      .select("_id name phone mptpCardNumber planManager")
      .sort({ name: 1 });

    res.json({ success: true, clients });
  } catch (e) {
    next(e);
  }
}

module.exports = {
  listClients,
  createClient,
  getClient,
  updateClient,
  deleteClient,
  getAdminClients,
};
