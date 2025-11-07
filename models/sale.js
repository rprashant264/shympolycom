const mongoose = require('mongoose');

const saleSchema = new mongoose.Schema({
    saleId: {
        type: String,
        required: true,
        unique: true
    },
    customerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Customer',
        required: true
    },
    customerName: {
        type: String,
        required: true
    },
    hsnCode: {
        type: String,
        required: true
    },
    productName: {
        type: String,
        required: true
    },
    date: {
        type: Date,
        required: true,
        default: Date.now
    },
    units: {
        type: Number,
        required: true
    },
    price: {
        type: Number,
        required: true
    },
    amount: {
        type: Number,
        required: true
    },
    productRef: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true
    }
}, {
    timestamps: true
});

// Auto-generate sale ID before validation so required check passes
saleSchema.pre('validate', async function(next) {
    try {
        if (!this.saleId) {
            const lastSale = await this.constructor.findOne({}, {}, { sort: { 'saleId': -1 } });
            const lastNumber = lastSale ? parseInt(lastSale.saleId.substring(1)) : 0;
            this.saleId = `S${String(lastNumber + 1).padStart(3, '0')}`;
        }
        next();
    } catch (err) {
        next(err);
    }
});

// Validate stock availability before save
saleSchema.pre('save', async function(next) {
    const Product = mongoose.model('Product');
    const product = await Product.findById(this.productRef);
    if (!product || product.stock < this.units) {
        return next(new Error('Insufficient stock'));
    }
    next();
});

// Update product stock after sale
saleSchema.post('save', async function() {
    const Product = mongoose.model('Product');
    await Product.findByIdAndUpdate(this.productRef, {
        $inc: { stock: -this.units }
    });
});

// Revert stock update after sale deletion
saleSchema.pre('remove', async function() {
    const Product = mongoose.model('Product');
    await Product.findByIdAndUpdate(this.productRef, {
        $inc: { stock: this.units }
    });
});

module.exports = mongoose.model('Sale', saleSchema);