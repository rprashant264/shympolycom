const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema({
    custId: {
        type: String,
        required: true,
        unique: true
    },
    name: {
        type: String,
        required: true
    },
    email: {
        type: String,
        required: true,
        unique: true
    },
    phone: {
        type: String
    },
    address: {
        type: String,
        required: true
    }
}, {
    timestamps: true
});

// Auto-generate customer ID before validation so required check passes
customerSchema.pre('validate', async function(next) {
    try {
        if (!this.custId) {
            const lastCustomer = await this.constructor.findOne({}, {}, { sort: { 'custId': -1 } });
            const lastNumber = lastCustomer ? parseInt(lastCustomer.custId.substring(1)) : 0;
            this.custId = `C${String(lastNumber + 1).padStart(3, '0')}`;
        }
        next();
    } catch (err) {
        next(err);
    }
});

module.exports = mongoose.model('Customer', customerSchema);