const mongoose = require('mongoose');

// ===========================================
// 🔹 Line item schema for products in a sale
// ===========================================
const saleLineItemSchema = new mongoose.Schema({
  productRef: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product', // ✅ Enables populate('lineItems.productRef')
    required: true
  },
  hsnCode: { type: String, required: true },
  productName: { type: String, required: true },
  units: { type: Number, required: true, min: 1 },
  price: { type: Number, required: true, min: 0 },
  amount: { type: Number, required: true }
}, { _id: false });


// ===========================================
// 🔹 Main Sale Schema
// ===========================================
const saleSchema = new mongoose.Schema({
  saleId: { type: String, required: true, unique: true },
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true
  },
  customerName: { type: String, required: true },
  date: { type: Date, required: true, default: Date.now },
  lineItems: [saleLineItemSchema],
  totalAmount: { type: Number, required: true, default: 0 },
  totalUnits: { type: Number, required: true, default: 0 },
  paymentStatus: {
    type: String,
    enum: ['unpaid', 'partial', 'paid'],
    default: 'unpaid'
  },
  paidAmount: {
    type: Number,
    default: 0,
    min: 0
  }
}, { timestamps: true });


// ===========================================
// 🔹 Auto-generate saleId and compute totals
// ===========================================
saleSchema.pre('validate', async function (next) {
  try {
    if (!this.saleId) {
      const lastSale = await this.constructor
        .findOne({}, {}, { sort: { saleId: -1 } });
      const lastNumber = lastSale
        ? parseInt(lastSale.saleId.substring(1))
        : 0;
      this.saleId = `S${String(lastNumber + 1).padStart(3, '0')}`;
    }

    // Recalculate totals before validation
    this.totalAmount = 0;
    this.totalUnits = 0;

    if (Array.isArray(this.lineItems)) {
      this.lineItems.forEach(item => {
        this.totalAmount += item.amount || 0;
        this.totalUnits += item.units || 0;
      });
    }

    next();
  } catch (err) {
    next(err);
  }
});


// ===========================================
// 🔹 Validate stock before saving
// ===========================================
saleSchema.pre('save', async function (next) {
  try {
    const Product = mongoose.model('Product');

    // Skip validation if session handles it
    if (this.$locals && this.$locals.skipStockValidation) return next();

    if (!Array.isArray(this.lineItems) || this.lineItems.length === 0) {
      return next(new Error('No line items in sale'));
    }

    for (const item of this.lineItems) {
      const product = await Product.findById(item.productRef);
      if (!product) {
        return next(new Error(`Product ${item.productName} not found`));
      }
    }

    next();
  } catch (err) {
    next(err);
  }
});


// ===========================================
// 🔹 Deduct stock after saving
// ===========================================
saleSchema.post('save', async function () {
  try {
    const Product = mongoose.model('Product');
    if (this.$locals && this.$locals.stockHandledByTransaction) return;

    if (Array.isArray(this.lineItems)) {
      for (const item of this.lineItems) {
        await Product.findByIdAndUpdate(item.productRef, {
          $inc: { stock: -item.units }
        });
      }
    }
  } catch (err) {
    console.error('Error updating stock after sale save:', err);
  }
});


// ===========================================
// 🔹 Revert stock when sale is removed
// ===========================================
saleSchema.pre('remove', async function (next) {
  try {
    const Product = mongoose.model('Product');
    if (Array.isArray(this.lineItems)) {
      for (const item of this.lineItems) {
        await Product.findByIdAndUpdate(item.productRef, {
          $inc: { stock: item.units }
        });
      }
    }
    next();
  } catch (err) {
    next(err);
  }
});

saleSchema.post('findByIdAndDelete', async function (doc) {
  try {
    if (doc && Array.isArray(doc.lineItems)) {
      const Product = mongoose.model('Product');
      for (const item of doc.lineItems) {
        await Product.findByIdAndUpdate(item.productRef, {
          $inc: { stock: item.units }
        });
      }
    }
  } catch (err) {
    console.error('Error reverting stock after sale deletion:', err);
  }
});


// ===========================================
// 🔹 Static helper for correct population
// ===========================================
saleSchema.statics.findWithPopulation = function () {
  return this.find()
    .populate('customerId', 'customerName')
    .populate('lineItems.productRef', 'productName stock price');
};


module.exports = mongoose.model('Sale', saleSchema);
