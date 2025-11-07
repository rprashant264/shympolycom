const mongoose = require('mongoose');

const vendorSchema = new mongoose.Schema({
  vendorId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  email: { type: String },
  phone: { type: String },
  address: { type: String },
  products: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }]
}, { timestamps: true });

// Auto-generate vendorId before validation
vendorSchema.pre('validate', async function(next) {
  try {
    if (!this.vendorId) {
      const last = await this.constructor.findOne({}, {}, { sort: { vendorId: -1 } });
      const lastNumber = last ? parseInt(last.vendorId.substring(1)) : 0;
      this.vendorId = `V${String(lastNumber + 1).padStart(3, '0')}`;
    }
    next();
  } catch (err) {
    next(err);
  }
});

module.exports = mongoose.model('Vendor', vendorSchema);
