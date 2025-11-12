const mongoose = require("mongoose");
const Ride = require("../src/models/Ride");
const { calculateGST } = require("../src/controllers/settingsController");
require("dotenv").config();

/**
 * Migration script to update existing rides with new fields:
 * - passengers (default: 1)
 * - fare.halfFare (calculated from total)
 * - driverNotes (default: empty string)
 */

async function migrateRides() {
  try {
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    

    // Find all rides missing the new fields
    const ridesToUpdate = await Ride.find({
      $or: [
        { passengers: { $exists: false } },
        { "fare.halfFare": { $exists: false } },
        { driverNotes: { $exists: false } }
      ]
    });

    

    if (ridesToUpdate.length === 0) {
      
      return;
    }

    let updated = 0;
    let errors = 0;

    for (const ride of ridesToUpdate) {
      try {
        let needsUpdate = false;

        // Add passengers field if missing (default to 1)
        if (!ride.passengers) {
          ride.passengers = 1;
          needsUpdate = true;
        }

        // Add halfFare if missing
        if (!ride.fare.halfFare && ride.fare.total) {
          ride.fare.halfFare = Number((ride.fare.total / 2).toFixed(2));
          needsUpdate = true;
        }

        // Add driverNotes if missing
        if (!ride.driverNotes) {
          ride.driverNotes = "";
          needsUpdate = true;
        }

        // Recalculate GST if missing or incorrect
        if (ride.fare.perPerson) {
          const expectedGst = await calculateGST(ride.fare.perPerson);
          if (!ride.fare.gst || Math.abs(ride.fare.gst - expectedGst) > 0.01) {
            ride.fare.gst = expectedGst;
            needsUpdate = true;
          }
        }

        if (needsUpdate) {
          await ride.save();
          updated++;
          
          if (updated % 10 === 0) {
            
          }
        }

      } catch (error) {
        
        errors++;
      }
    }

    

  } catch (error) {
    
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    
  }
}

// Run migration if this file is executed directly
if (require.main === module) {
  migrateRides()
    .then(() => {
      
      process.exit(0);
    })
    .catch((error) => {
      
      process.exit(1);
    });
}

module.exports = { migrateRides };
