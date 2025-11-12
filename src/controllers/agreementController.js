const DriverAgreement = require('../models/DriverAgreement');
const User = require('../models/User');
const { uploadPhoto } = require('../services/photoUploadService');

// Get driver agreement status
exports.getStatus = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }


    // Find the latest agreement submission for this driver
    const latestAgreement = await DriverAgreement.findOne({ driver: userId })
      .sort({ createdAt: -1 });

    let status = 'not_submitted';
    let canAccessApp = false;

    if (latestAgreement) {
      status = latestAgreement.status;
      canAccessApp = status === 'approved';
    } else {
    }

    return res.json({
      requiresAgreement: true,
      status,
      canAccessApp,
      lastSubmittedAt: latestAgreement ? latestAgreement.submittedAt : null,
      reviewedAt: latestAgreement ? latestAgreement.reviewedAt : null,
      reviewNotes: latestAgreement ? latestAgreement.reviewNotes : null
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to get agreement status' });
  }
};

// Get agreement text
exports.getAgreementText = async (req, res) => {
  try {
    // In a real implementation, this might come from a database or CMS
    // For now, we'll return a static agreement
    return res.json({
      version: "1.0",
      title: "Driver Services Agreement",
      body: `<h1>Driver Services Agreement</h1>
      <p>This Driver Services Agreement ("Agreement") is entered into between Taxiologists ("Company") and the undersigned Driver ("Driver").</p>
      <p>1. <strong>Services.</strong> Driver agrees to provide transportation services using the Company's platform.</p>
      <p>2. <strong>Compliance.</strong> Driver agrees to comply with all applicable laws, regulations, and Company policies.</p>
      <p>3. <strong>Independent Contractor.</strong> Driver acknowledges that they are an independent contractor and not an employee of the Company.</p>
      <p>4. <strong>Term.</strong> This Agreement shall commence on the date of acceptance and continue until terminated by either party.</p>
      <p>5. <strong>Termination.</strong> Either party may terminate this Agreement with written notice.</p>
      <p>By submitting this form, Driver acknowledges that they have read, understood, and agree to be bound by the terms of this Agreement.</p>`
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to get agreement text' });
  }
};

// Submit agreement
exports.submitAgreement = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Check if user still exists (may have been deleted by admin)
    const userExists = await User.findById(userId);
    if (!userExists) {
      return res.status(403).json({ 
        error: 'Your account has been deleted by an administrator. Please contact support.',
        code: 'ACCOUNT_DELETED'
      });
    }

    // Extract personal info from request body
    const {
      fullName,
      driverId,
      dateOfBirth,
      contactNumber,
      email,
      address,
      licenseNumber,
      licenseExpiry,
      driverAccreditationNumber,
      abn,
      gstRegistered,
      currentPoliceCheck,
      photos
    } = req.body;

    console.log('📋 Received agreement data:', {
      fullName,
      driverId,
      dateOfBirth,
      licenseExpiry,
      driverAccreditationNumber,
      hasAddress: !!address,
      hasPhotos: !!photos
    });

    // Validate required fields
    if (!fullName || !driverId || !dateOfBirth || !contactNumber || !email ||
        !address || !address.street || !address.suburb || !address.state || !address.postCode ||
        !licenseNumber || !licenseExpiry || !driverAccreditationNumber ||
        gstRegistered === undefined || gstRegistered === null) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Validate required photos
    if (!photos || !photos.driverLicenseFront || !photos.driverLicenseBack || 
        !photos.driverLicenseSelfie || !photos.driverAccreditation) {
      return res.status(400).json({ error: 'Missing required photos (Driver License Front, Back, Selfie, and Driver Accreditation)' });
    }

    // If currentPoliceCheck is true, policeCheck photo is required
    if (currentPoliceCheck === true && !photos.policeCheck) {
      return res.status(400).json({ error: 'Police check photo is required when Current Police Check is Yes' });
    }

    // Validate license expiry is in the future
    const licenseExpiryDate = new Date(licenseExpiry);
    if (licenseExpiryDate < new Date()) {
      return res.status(400).json({ error: 'License expiry date must be in the future' });
    }

    // Create new agreement
    const agreement = new DriverAgreement({
      driver: userId,
      personalInfo: {
        fullName,
        driverId,
        dateOfBirth,
        contactNumber,
        email,
        address,
        licenseNumber,
        licenseExpiry,
        driverAccreditationNumber,
        abn,
        gstRegistered: Boolean(gstRegistered),
        currentPoliceCheck: currentPoliceCheck ? Boolean(currentPoliceCheck) : undefined
      },
      photos: {
        driverLicenseFront: photos.driverLicenseFront,
        driverLicenseBack: photos.driverLicenseBack,
        driverLicenseSelfie: photos.driverLicenseSelfie,
        driverAccreditation: photos.driverAccreditation,
        policeCheck: photos.policeCheck || undefined
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      metadata: { agreementVersion: '1.1' }
    });

    await agreement.save();

    // Send notification to all admins
    const admins = await User.find({ role: 'admin' });
    const { sendNotification } = require('../services/notificationService');
    
    for (const admin of admins) {
      await sendNotification(admin._id, 'agreement_submitted', {
        message: `New agreement submitted by ${fullName}`,
        agreementId: agreement._id,
        driverName: fullName,
        driverId: driverId,
        submittedAt: new Date().toISOString()
      });
    }
    
    return res.status(201).json({
      success: true,
      agreementId: agreement._id,
      next: 'awaiting_approval'
    });
  } catch (error) {
    console.error('❌ Error submitting agreement:', error.message);
    console.error('Stack trace:', error.stack);
    return res.status(500).json({ error: 'Failed to submit agreement', details: error.message });
  }
};

// Upload agreement photo
exports.uploadAgreementPhoto = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { photoType } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const validTypes = ['driverLicenseFront', 'driverLicenseBack', 'driverLicenseSelfie', 'driverAccreditation', 'policeCheck'];
    if (!photoType || !validTypes.includes(photoType)) {
      return res.status(400).json({ error: 'Invalid photo type' });
    }

    // Upload photo to storage
    const photoUrl = await uploadPhoto(file, `agreements/${userId}/${photoType}`);

    return res.status(200).json({
      success: true,
      photoUrl,
      photoType
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to upload photo', details: error.message });
  }
};
