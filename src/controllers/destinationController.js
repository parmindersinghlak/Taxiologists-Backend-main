const Destination = require("../models/Destination");

async function listDestinations(req, res, next) {
  try {
    const { q, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (q)
      filter.$or = [
        { name: new RegExp(q, "i") },
        { address: new RegExp(q, "i") },
      ];
    const docs = await Destination.find(filter)
      .sort({ createdAt: -1 })
      .skip((+page - 1) * +limit)
      .limit(+limit);
    const total = await Destination.countDocuments(filter);
    res.json({ success: true, items: docs, total, page: +page, limit: +limit });
  } catch (e) {
    next(e);
  }
}

async function createDestination(req, res, next) {
  try {
    const { name, address, coordinates } = req.body || {};
    if (!name || !address) {
      return res
        .status(400)
        .json({
          success: false,
          code: "VALIDATION_ERROR",
          message: "name and address are required",
        });
    }
    
    const destinationData = {
      name,
      address,
      createdBy: req.user.id,
    };
    
    // Only add coordinates if they are provided
    if (coordinates && coordinates.lat != null && coordinates.lng != null) {
      destinationData.coordinates = coordinates;
    }
    
    const doc = await Destination.create(destinationData);
    res.status(201).json({ success: true, destination: doc });
  } catch (e) {
    next(e);
  }
}

async function getDestination(req, res, next) {
  try {
    const doc = await Destination.findById(req.params.id);
    if (!doc)
      return res
        .status(404)
        .json({
          success: false,
          code: "NOT_FOUND",
          message: "Destination not found",
        });
    res.json({ success: true, destination: doc });
  } catch (e) {
    next(e);
  }
}

async function updateDestination(req, res, next) {
  try {
    const { name, address, coordinates } = req.body || {};
    const update = {};
    if (name) update.name = name;
    if (address) update.address = address;
    if (coordinates && coordinates.lat != null && coordinates.lng != null)
      update.coordinates = coordinates;

    const doc = await Destination.findByIdAndUpdate(req.params.id, update, {
      new: true,
    });
    if (!doc)
      return res
        .status(404)
        .json({
          success: false,
          code: "NOT_FOUND",
          message: "Destination not found",
        });
    res.json({ success: true, destination: doc });
  } catch (e) {
    next(e);
  }
}

async function deleteDestination(req, res, next) {
  try {
    const doc = await Destination.findByIdAndDelete(req.params.id);
    if (!doc)
      return res
        .status(404)
        .json({
          success: false,
          code: "NOT_FOUND",
          message: "Destination not found",
        });
    res.json({ success: true, message: "Destination deleted successfully" });
  } catch (e) {
    next(e);
  }
}

module.exports = {
  listDestinations,
  createDestination,
  getDestination,
  updateDestination,
  deleteDestination,
};
