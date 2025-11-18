const mongoose = require('mongoose');

const gatepassSchema = new mongoose.Schema({
  // Link to Sale - unique constraint ensures only 1 gatepass per sale
  saleRef: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Sale', 
    required: true,
    unique: true  // Only one gatepass per sale
  },
  
  // Gatepass metadata
  gatepassId: { type: String, required: true },
  vehicleNumber: { type: String, required: true },
  driverName: { type: String, default: '' },
  
  // Snapshot of product details from the sale
  products: [{
    productName: { type: String },
    quantity: { type: Number }  // Only name and quantity as per requirement
  }],
  
  createdBy: { type: String },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Gatepass', gatepassSchema);
