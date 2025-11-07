const mongoose = require('mongoose');

const purchaseSchema = new mongoose.Schema({
    purchaseId: {
        type: String,
        required: true,
        unique: true
    },
    hsnCode: {
        type: String,
        required: true
    },
    productName: {
        type: String,
        required: true
    },
    vendor: {
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
    cost: {
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
    ,
    vendorRef: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Vendor'
    }
}, {
    timestamps: true
});

// Auto-generate purchase ID before validation so required check passes
purchaseSchema.pre('validate', async function(next) {
    try {
        if (!this.purchaseId) {
            const lastPurchase = await this.constructor.findOne({}, {}, { sort: { 'purchaseId': -1 } });
            const lastNumber = lastPurchase ? parseInt(lastPurchase.purchaseId.substring(1)) : 0;
            this.purchaseId = `P${String(lastNumber + 1).padStart(3, '0')}`;
        }
        next();
    } catch (err) {
        next(err);
    }
});

// Update product stock after purchase
purchaseSchema.post('save', async function() {
    const Product = mongoose.model('Product');
    await Product.findByIdAndUpdate(this.productRef, {
        $inc: { stock: this.units }
    });
});

// Revert stock update after purchase deletion
purchaseSchema.pre('remove', async function() {
    const Product = mongoose.model('Product');
    await Product.findByIdAndUpdate(this.productRef, {
        $inc: { stock: -this.units }
    });
});

module.exports = mongoose.model('Purchase', purchaseSchema);