const DriverAgreement = require('../models/DriverAgreement');
const User = require('../models/User');

// Get all agreements with pagination and filtering
exports.getAgreements = async (req, res) => {
  try {
    const { status, search, page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;


    // Build query
    const query = {};
    if (status) {
      query.status = status;
    }

    // Add search functionality if provided
    if (search) {
      query['$or'] = [
        { 'personalInfo.fullName': { $regex: search, $options: 'i' } },
        { 'personalInfo.email': { $regex: search, $options: 'i' } },
        { 'personalInfo.driverId': { $regex: search, $options: 'i' } }
      ];
    }

    // Execute query with pagination
    const agreements = await DriverAgreement.find(query)
      .populate('driver', 'username fullName email')
      .populate('reviewedBy', 'username fullName')
      .sort({ submittedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Filter out agreements where driver was deleted (null driver reference)
    const validAgreements = agreements.filter(agreement => agreement.driver !== null);
    
    // If we filtered out some agreements, log it
    if (validAgreements.length < agreements.length) {
      const orphanedCount = agreements.length - validAgreements.length;
      
      // Clean up orphaned agreements from database
      const orphanedIds = agreements
        .filter(a => a.driver === null)
        .map(a => a._id);
      
      if (orphanedIds.length > 0) {
        await DriverAgreement.deleteMany({ _id: { $in: orphanedIds } });
      }
    }

    // Get total count for pagination (excluding orphaned agreements)
    const allAgreements = await DriverAgreement.find(query).populate('driver', '_id');
    const validTotal = allAgreements.filter(a => a.driver !== null).length;

    

    return res.json({
      data: validAgreements,
      pagination: {
        total: validTotal,
        page: parseInt(page),
        pages: Math.ceil(validTotal / limit),
        limit: parseInt(limit)
      }
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to get agreements' });
  }
};

// Update agreement status (approve/reject)
exports.updateStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const agreement = await DriverAgreement.findById(id);
    if (!agreement) {
      return res.status(404).json({ error: 'Agreement not found' });
    }

    const reviewerId = req.user?._id || req.user?.id;
    if (!reviewerId) return res.status(401).json({ error: 'Unauthorized' });

    // Update agreement
    agreement.status = status;
    agreement.reviewedAt = new Date();
    agreement.reviewedBy = reviewerId;
    agreement.reviewNotes = notes || '';

    await agreement.save();

    // Update user's agreement status (only if user still exists)
    const user = await User.findById(agreement.driver);
    if (user) {
      if (status === 'approved') {
        user.agreementAccepted = true;
        user.agreementAcceptedAt = new Date();
      } else {
        user.agreementAccepted = false;
        user.agreementAcceptedAt = null;
      }
      await user.save();
      
      
      // Send notification to driver
      const { sendNotification } = require('../services/notificationService');
      await sendNotification(user._id, `agreement_${status}`, {
        message: status === 'approved' 
          ? 'Your driver agreement has been approved! You now have full access to the app.'
          : 'Your driver agreement was rejected. Please review the notes and resubmit.',
        agreementId: agreement._id,
        status: status,
        reviewNotes: notes || '',
        reviewedAt: new Date().toISOString()
      });
      
      
    } else {
      
    }

    return res.json({
      success: true,
      agreement
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update agreement status' });
  }
};

// Reset agreement for resubmission
exports.resetAgreement = async (req, res) => {
  try {
    const { id } = req.params;

    const agreement = await DriverAgreement.findById(id);
    if (!agreement) {
      return res.status(404).json({ error: 'Agreement not found' });
    }

    const reviewerId = req.user?._id || req.user?.id;
    if (!reviewerId) return res.status(401).json({ error: 'Unauthorized' });

    // We don't delete the agreement, just mark it as reset
    // This preserves the history
    agreement.status = 'rejected';
    agreement.reviewedAt = new Date();
    agreement.reviewedBy = reviewerId;
    agreement.reviewNotes = 'Reset for resubmission';

    await agreement.save();

    // Update user's agreement status to allow resubmission (only if user still exists)
    const user = await User.findById(agreement.driver);
    if (user) {
      user.agreementAccepted = false;
      user.agreementAcceptedAt = null;
      await user.save();
      
    } else {
      
    }

    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to reset agreement' });
  }
};

// Delete agreement (admin only)
exports.deleteAgreement = async (req, res) => {
  try {
    const { id } = req.params;

    

    const agreement = await DriverAgreement.findById(id);
    if (!agreement) {
      
      return res.status(404).json({ error: 'Agreement not found' });
    }

    // Delete the agreement
    await DriverAgreement.findByIdAndDelete(id);

    // Update user's agreement status if user still exists
    const user = await User.findById(agreement.driver);
    if (user) {
      user.agreementAccepted = false;
      user.agreementAcceptedAt = null;
      await user.save();
      
    } else {
      
    }

    

    return res.json({ 
      success: true,
      message: 'Agreement deleted successfully'
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to delete agreement' });
  }
};
