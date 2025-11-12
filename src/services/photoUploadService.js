/**
 * Photo Upload Service
 * - Driver Report photos (existing)
 * - Shift photos (new)
 * Handles image compression, validation, and local file storage
 */

const multer = require('multer');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');

/* =========================
 * Paths & Base URLs
 * ========================= */
const UPLOADS_ROOT = path.join(__dirname, '../../uploads');

// Driver Reports (existing)
const DRIVER_REPORTS_DIR = path.join(UPLOADS_ROOT, 'driver-reports');
const DRIVER_REPORTS_BASE_URL =
  process.env.PHOTOS_BASE_URL || 'http://localhost:8080/uploads/driver-reports';

// Shifts (new)
const SHIFTS_DIR = path.join(UPLOADS_ROOT, 'shifts');
const SHIFTS_BASE_URL =
  process.env.SHIFT_PHOTOS_BASE_URL ||
  (process.env.PHOTOS_BASE_URL
    ? process.env.PHOTOS_BASE_URL.replace('/driver-reports', '/shifts')
    : 'http://localhost:8080/uploads/shifts');

// Generic uploads base URL (for the generic `uploadPhoto` shim below)
const UPLOADS_BASE_URL =
  process.env.UPLOADS_BASE_URL || 'http://localhost:8080/uploads';

/* =========================
 * Init
 * ========================= */
function initializeLocalStorage() {
  try {
    // Ensure /uploads
    if (!fsSync.existsSync(UPLOADS_ROOT)) {
      fsSync.mkdirSync(UPLOADS_ROOT, { recursive: true });
    }
    // Ensure /uploads/driver-reports
    if (!fsSync.existsSync(DRIVER_REPORTS_DIR)) {
      fsSync.mkdirSync(DRIVER_REPORTS_DIR, { recursive: true });
    }
    // Ensure /uploads/shifts
    if (!fsSync.existsSync(SHIFTS_DIR)) {
      fsSync.mkdirSync(SHIFTS_DIR, { recursive: true });
    }
  } catch (error) {
    throw new Error('Failed to initialize local storage: ' + error.message);
  }
}

/* =========================
 * Helpers
 * ========================= */
async function ensureDatedSubdir(baseDir, driverId, date) {
  const dateFolder = new Date(date).toISOString().split('T')[0]; // YYYY-MM-DD
  const dir = path.join(baseDir, driverId, dateFolder);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 }, // 5MB, single file
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    cb(new Error('Invalid file type. Only JPEG, PNG, and WebP images are allowed.'));
  },
});

async function processImage(imageBuffer, options = {}) {
  const {
    maxWidth = 1200,
    maxHeight = 1200,
    quality = 85,
    format = 'jpeg',
  } = options;

  try {
    let img = sharp(imageBuffer).resize(maxWidth, maxHeight, {
      fit: 'inside',
      withoutEnlargement: true,
    });

    switch (format) {
      case 'png':
        img = img.png({ quality });
        break;
      case 'webp':
        img = img.webp({ quality });
        break;
      case 'jpeg':
      default:
        img = img.jpeg({ quality });
        break;
    }

    return await img.toBuffer();
  } catch (err) {
    throw new Error('Failed to process image: ' + err.message);
  }
}

/* =========================
 * Driver Report photos (existing)
 * ========================= */
async function saveReportPhotoToLocalStorage(imageBuffer, driverId, reportId, photoType, originalName) {
  const uniqueId = uuidv4().substring(0, 8);
  const extension = path.extname(originalName) || '.jpg';
  const fileName = `${photoType}_${uniqueId}${extension}`;

  const dir = await ensureDatedSubdir(DRIVER_REPORTS_DIR, driverId, new Date());
  const filePath = path.join(dir, fileName);
  await fs.writeFile(filePath, imageBuffer);

  const relative = path.relative(DRIVER_REPORTS_DIR, filePath).replace(/\\/g, '/');
  return `${DRIVER_REPORTS_BASE_URL}/${relative}`;
}

async function uploadReportPhoto(file, reportId, photoType, driverId) {
  if (!file || !file.buffer) throw new Error('No file provided for upload');

  const valid = ['meter_start', 'meter_end', 'eftpos', 'expense'];
  if (!valid.includes(photoType)) throw new Error('Invalid photo type');

  const processed = await processImage(file.buffer, { format: 'jpeg', quality: 85 });
  const url = await saveReportPhotoToLocalStorage(processed, driverId, reportId, photoType, file.originalname);
  return url;
}

async function deleteReportPhoto(photoUrl) {
  try {
    if (!photoUrl) return true;

    // Map URL -> file path under driver-reports only
    const urlPath = photoUrl.replace(DRIVER_REPORTS_BASE_URL, '');
    const filePath = path.join(DRIVER_REPORTS_DIR, urlPath.replace(/\//g, path.sep));

    try {
      await fs.access(filePath);
      await fs.unlink(filePath);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    return true;
  } catch (err) {
    return false;
  }
}

async function validatePhotoUrl(photoUrl) {
  try {
    if (!photoUrl) return false;
    const urlPath = photoUrl.replace(DRIVER_REPORTS_BASE_URL, '');
    const filePath = path.join(DRIVER_REPORTS_DIR, urlPath.replace(/\//g, path.sep));
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  } catch (err) {
    return false;
  }
}

async function refreshPhotoUrl(photoUrl) {
  if (!photoUrl) throw new Error('No photo URL provided');
  const ok = await validatePhotoUrl(photoUrl);
  if (!ok) throw new Error('Photo file no longer exists');
  return photoUrl;
}

function getUploadMiddleware() {
  // Existing driver-report upload: expects field name "photo"
  return upload.single('photo');
}

/* =========================
 * Shift photos (new)
 * ========================= */
async function saveShiftPhotoToLocalStorage(imageBuffer, driverId, originalName) {
  const uniqueId = uuidv4().substring(0, 8);
  const extension = path.extname(originalName) || '.jpg';
  const fileName = `start_meter_${uniqueId}${extension}`;

  const dir = await ensureDatedSubdir(SHIFTS_DIR, driverId, new Date());
  const filePath = path.join(dir, fileName);
  await fs.writeFile(filePath, imageBuffer);

  const relative = path.relative(SHIFTS_DIR, filePath).replace(/\\/g, '/');
  return `${SHIFTS_BASE_URL}/${relative}`;
}

async function uploadShiftPhoto(file, driverId) {
  if (!file || !file.buffer) throw new Error('No file provided for upload');
  const processed = await processImage(file.buffer, { format: 'jpeg', quality: 85 });
  const url = await saveShiftPhotoToLocalStorage(processed, driverId, file.originalname);
  return url;
}

function getShiftUploadMiddleware() {
  // For /api/shifts/start expecting a single "startMeterPhoto" file
  return upload.single('startMeterPhoto');
}

/**
 * Back-compat generic uploader used by some controllers as `uploadPhoto(file, key)`
 * Saves under /uploads/<key>.jpg (auto-creates subdirs), returns absolute URL.
 * Use ONLY for legacy cases. Prefer uploadReportPhoto / uploadShiftPhoto.
 */
async function uploadPhoto(file, key) {
  if (!file || !file.buffer) throw new Error('No file provided for upload');
  if (!key) throw new Error('Destination key is required');

  const processed = await processImage(file.buffer, { format: 'jpeg', quality: 85 });

  // Ensure directory for the provided key
  const sanitized = key.replace(/^\/*/, '').replace(/\.\./g, '');
  const fullPathNoExt = path.join(UPLOADS_ROOT, sanitized);
  const dir = path.dirname(fullPathNoExt);
  await fs.mkdir(dir, { recursive: true });

  const finalPath = `${fullPathNoExt}.jpg`;
  await fs.writeFile(finalPath, processed);

  const relative = path.relative(UPLOADS_ROOT, finalPath).replace(/\\/g, '/');
  return `${UPLOADS_BASE_URL}/${relative}`;
}

/* =========================
 * Multer error handler
 * ========================= */
function handleUploadError(error, req, res, next) {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        code: 'FILE_TOO_LARGE',
        message: 'File size exceeds 5MB limit',
      });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        success: false,
        code: 'TOO_MANY_FILES',
        message: 'Only one file allowed per upload',
      });
    }
  }

  if (error && typeof error.message === 'string' && error.message.includes('Invalid file type')) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_FILE_TYPE',
      message: error.message,
    });
  }

  next(error);
}

module.exports = {
  // init
  initializeLocalStorage,

  // processing
  processImage,

  // driver reports (existing)
  uploadReportPhoto,
  deleteReportPhoto,
  refreshPhotoUrl,
  validatePhotoUrl,
  getUploadMiddleware, // field "photo"

  // shifts (new)
  uploadShiftPhoto,
  getShiftUploadMiddleware, // field "startMeterPhoto"

  // legacy generic
  uploadPhoto,

  // errors
  handleUploadError,
};
