const mongoose = require('mongoose');
const Product = require('../models/product');

// Connect to MongoDB
const dbUrl = process.env.MONGODB_URI || 'mongodb://localhost:27017/shyam_polycom';

async function updateProductCategories() {
  try {
    console.log('Connecting to MongoDB...');
    console.log('Database URL:', dbUrl);
    
    await mongoose.connect(dbUrl, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000
    });

    console.log('✅ Connected to MongoDB');

    // Get total count before update
    const totalCount = await Product.countDocuments();
    console.log(`\nTotal products in database: ${totalCount}`);

    // Update all products without a category to "Glass"
    const result = await Product.updateMany(
      { category: { $exists: false } },
      { $set: { category: 'Glass' } }
    );

    console.log(`\n✅ Updated ${result.modifiedCount} products (missing category field)`);

    // Also update any products with null or empty category
    const result2 = await Product.updateMany(
      { $or: [{ category: null }, { category: '' }] },
      { $set: { category: 'Glass' } }
    );

    console.log(`✅ Updated ${result2.modifiedCount} products (null/empty category)`);

    // Verify all products have a category
    const productsWithoutCategory = await Product.countDocuments({
      $or: [{ category: { $exists: false } }, { category: null }, { category: '' }]
    });

    console.log(`\n✅ Products without category: ${productsWithoutCategory}`);

    // Show summary of products by category
    const summary = await Product.aggregate([
      { $group: { _id: '$category', count: { $sum: 1 } } }
    ]);

    console.log('\n📊 Product Summary by Category:');
    summary.forEach(item => {
      console.log(`  • ${item._id || 'No Category'}: ${item.count}`);
    });

    await mongoose.disconnect();
    console.log('\n✅ Database update completed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error updating products:', err.message);
    process.exit(1);
  }
}

updateProductCategories();
