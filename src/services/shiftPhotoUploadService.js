// src/services/shiftPhotoUploadService.js
/**
 * Photo upload service for Shift (start meter photo)
 * - Uses multer memory storage
 * - Compresses with sharp
 * - Saves under /uploads/shifts/<driverId>/<YYYY-MM-DD>/
 * - Attaches a public `url` to file object for controller usage
 */

const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const { v4: uuidv4 } = require('uuid');
const sharp = require('sharp');

// Base folders/URLs
const UPLOADS_ROOT = path.join(__dirname, '../../uploads');
const SHIFTS_DIR = path.join(UPLOADS_ROOT, 'shifts');
const PUBLIC_BASE_URL =
  process.env.PHOTOS_BASE_URL?.replace(/\/$/, '') ||
  'http://localhost:8080/uploads';

// Ensure base folders exist
function initShiftStorage() {
  if (!fsSync.existsSync(UPLOADS_ROOT)) {
    fsSync.mkdirSync(UPLOADS_ROOT, { recursive: true });
  }
  if (!fsSync.existsSync(SHIFTS_DIR)) {
    fsSync.mkdirSync(SHIFTS_DIR, { recursive: true });
  }
}

// Build directory /uploads/shifts/<driverId>/<YYYY-MM-DD>
async function ensureShiftDir(driverId, date = new Date()) {
  const dateFolder = new Date(date).toISOString().split('T')[0]; // YYYY-MM-DD
  const dir = path.join(SHIFTS_DIR, driverId, dateFolder);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

// Multer (memory) + file type limits
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 }, // 5MB
  fileFilter: (req, file, cb) => {
    const ok = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (ok.includes(file.mimetype)) return cb(null, true);
    return cb(new Error('Invalid file type. Only JPEG, PNG, and WebP are allowed.'));
  },
});

// Compress & save, then attach .url to file (for controller)
async function finalizeShiftUpload(req, res, next) {
  try {
    // if no files, just continue—controller will validate
    if (!req.files?.startMeterPhoto?.[0]) return next();

    const file = req.files.startMeterPhoto[0];
    const driverId = req.user?.id;
    if (!driverId) throw new Error('Missing authenticated user id for shift upload');

    // Process image
    const processed = await sharp(file.buffer)
      .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();

    // Destination path
    const destDir = await ensureShiftDir(driverId, new Date());
    const unique = uuidv4().slice(0, 8);
    const filename = `start_meter_${unique}.jpg`;
    const filepath = path.join(destDir, filename);

    await fs.writeFile(filepath, processed);

    // relative path from /uploads root
    const relativeFromUploads = path
      .relative(UPLOADS_ROOT, filepath)
      .replace(/\\/g, '/'); // windows support

    // Public URL (served by app.use('/uploads', express.static(...)))
    const publicUrl = `${PUBLIC_BASE_URL}/${relativeFromUploads}`;

    // Make it easy for the controller:
    file.url = publicUrl;
    file.path = `/uploads/${relativeFromUploads}`; // relative web path if needed

    return next();
  } catch (err) {
    return next(err);
  }
}

function getShiftUploadMiddleware() {
  // Expect field "startMeterPhoto"
  return [upload.fields([{ name: 'startMeterPhoto', maxCount: 1 }]), finalizeShiftUpload];
}

function handleShiftUploadError(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        code: 'FILE_TOO_LARGE',
        message: 'File size exceeds 5MB limit',
      });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        success: false,
        code: 'TOO_MANY_FILES',
        message: 'Only one file allowed per upload',
      });
    }
  }
  if (err?.message?.includes('Invalid file type')) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_FILE_TYPE',
      message: err.message,
    });
  }
  return next(err);
}

initShiftStorage();

module.exports = {
  getShiftUploadMiddleware,
  handleShiftUploadError,
};
