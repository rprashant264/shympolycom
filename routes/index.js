var express = require('express');
var router = express.Router();
const mongoose = require('mongoose');
const userModel = require("./users");
const postModel = require("./posts");
const passport = require('passport');
const upload = require('./multer');

// Import all models
const Product = require('../models/product');
const Customer = require('../models/customer');
const Employee = require('../models/employee');
const Sale = require('../models/sale');
const Purchase = require('../models/purchase');
const Vendor = require('../models/vendor');


// Home Page (Public)
router.get('/', (req, res) => {
  res.render('index', { title: 'My App' });
});

// Dashboard / Home (Protected)
router.get('/home', isLoggedIn, async (req, res) => {
  try {
    console.log('Accessing /home route');
    console.log('Session:', req.session);
    console.log('User:', req.user);
    
    if (!req.session.passport || !req.session.passport.user) {
      console.log('No user in session, redirecting to login');
      return res.redirect('/login');
    }

    const user = await userModel
      .findOne({ username: req.session.passport.user })
      .populate('posts')
      .lean();
    
    if (!user) {
      console.log('User not found in database');
      req.logout(err => {
        if (err) console.error('Error during logout:', err);
        res.redirect('/login');
      });
      return;
    }

    console.log('User found:', user.username);
    // Prepare dashboard stats
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Top selling products (by units)
    const topProductsAgg = await Sale.aggregate([
      { $group: { _id: '$productRef', productName: { $first: '$productName' }, units: { $sum: '$units' }, amount: { $sum: '$amount' } } },
      { $sort: { units: -1 } },
      { $limit: 5 }
    ]);
const lowStockProducts = await Product.find({ stock: { $lt: 10 } })
  .sort({ stock: 1 })
  .limit(5)
  .lean();


    // Monthly totals
    const salesThisMonthAgg = await Sale.aggregate([
      { $match: { date: { $gte: startOfMonth } } },
      { $group: { _id: null, totalAmount: { $sum: '$amount' }, totalUnits: { $sum: '$units' } } }
    ]);
    const purchasesThisMonthAgg = await Purchase.aggregate([
      { $match: { date: { $gte: startOfMonth } } },
      { $group: { _id: null, totalAmount: { $sum: '$amount' }, totalUnits: { $sum: '$units' } } }
    ]);

    const salesThisMonth = (salesThisMonthAgg[0] && salesThisMonthAgg[0].totalAmount) || 0;
    const purchasesThisMonth = (purchasesThisMonthAgg[0] && purchasesThisMonthAgg[0].totalAmount) || 0;

    // Recent activity
    const recentSales = await Sale.find().sort({ date: -1 }).limit(5).lean();
    const recentPurchases = await Purchase.find().sort({ date: -1 }).limit(5).lean();

    const totalProducts = await Product.countDocuments();

    res.render('home', {
      user,
      dashboard: {
        topProducts: topProductsAgg,
        lowStock: lowStockProducts,
        salesThisMonth,
        purchasesThisMonth,
        recentSales,
        recentPurchases,
        totalProducts
      }
    });
  } catch (err) {
    console.error('Error preparing dashboard:', err);
    // fallback to original user render
    const user = await userModel.findOne({ username: req.session.passport.user }).populate('posts');
    res.render('home', { user });
  }
});

// Registration Page
router.get('/register', (req, res) => {
  res.render('register');
});

// Register User
router.post('/register', async (req, res) => {
  try {
    const existingUser = await userModel.findOne({ username: req.body.username });
    if (existingUser) {
      return res.status(400).send("Username already exists. Please choose a different one.");
    }

    const newUser = new userModel({
      username: req.body.username,
      secret: req.body.secret,
      name: req.body.fullname
    });

    await userModel.register(newUser, req.body.password);
    passport.authenticate("local")(req, res, () => res.redirect('/home'));
  } catch (err) {
    console.error(err);
    res.status(500).send("Error during registration.");
  }
});

// Login Page
router.get('/login', (req, res) => {
  res.render('login', { error: req.flash('error') });
});

// Login Auth
router.post('/login', (req, res, next) => {
  console.log('Login attempt for username:', req.body.username);
  
  if (!req.body.username || !req.body.password) {
    console.log('Missing credentials');
    req.flash('error', 'Please enter both username and password');
    return res.redirect('/login');
  }

  passport.authenticate('local', (err, user, info) => {
    console.log('Inside passport.authenticate callback');
    console.log('Error:', err);
    console.log('User:', user);
    console.log('Info:', info);
    
    if (err) {
      console.error('Authentication error:', err);
      req.flash('error', 'An error occurred during authentication');
      return res.redirect('/login');
    }
    
    if (!user) {
      console.log('Login failed. Info:', info);
      req.flash('error', info.message || 'Invalid username or password');
      return res.redirect('/login');
    }

    req.logIn(user, (err) => {
      console.log('Inside req.logIn callback');
      if (err) {
        console.error('Login error:', err);
        req.flash('error', 'An error occurred during login');
        return res.redirect('/login');
      }

      console.log('Login successful for user:', user.username);
      console.log('Session ID:', req.sessionID);
      console.log('Session:', req.session);
      req.flash('success', 'Welcome back!');
      res.redirect('/home');
    });
  })(req, res, next);
});

// Logout
router.get('/logout', (req, res, next) => {
  req.logout(err => {
    if (err) return next(err);
    res.redirect('/login');
  });
});

// Inventory page: compute compiled inventory from Product, Purchase and Sale collections
router.get('/inventory', isLoggedIn, async (req, res, next) => {
  try {
    // aggregate total purchased units per product
    const purchasesAgg = await Purchase.aggregate([
      { $group: { _id: '$productRef', totalPurchased: { $sum: '$units' } } }
    ]);
    // aggregate total sold units per product
    const salesAgg = await Sale.aggregate([
      { $group: { _id: '$productRef', totalSold: { $sum: '$units' } } }
    ]);

    const purchaseMap = {};
    purchasesAgg.forEach(p => { if (p._id) purchaseMap[String(p._id)] = p.totalPurchased; });
    const saleMap = {};
    salesAgg.forEach(s => { if (s._id) saleMap[String(s._id)] = s.totalSold; });

    const products = await Product.find().sort({ productName: 1 }).lean();

    const items = products.map(p => {
      const id = String(p._id);
      const purchaseUnits = purchaseMap[id] || 0;
      const saleUnits = saleMap[id] || 0;
      const stock = (typeof p.stock === 'number') ? p.stock : Math.max(purchaseUnits - saleUnits, 0);
      const cost = Number(p.cost || 0);
      const stockAmount = Number((stock * cost) || 0);
      return {
        _id: p._id,
        hsnCode: p.hsnCode,
        productName: p.productName,
        cost,
        purchaseUnits,
        saleUnits,
        stock,
        stockAmount
      };
    });

    res.render('inventory', { items });
  } catch (err) {
    next(err);
  }
});





// Create new inventory item
router.post('/inventory', isLoggedIn, async (req, res, next) => {
  try {
    // Check if HSN code already exists
    const existingItem = await Item.findOne({ hsnCode: req.body.hsnCode });
    if (existingItem) {
      return res.status(400).json({ error: 'HSN Code already exists' });
    }

    const newItem = new Item({
      hsnCode: req.body.hsnCode,
      productName: req.body.productName,
      cost: req.body.cost,
      purchaseUnits: req.body.purchaseUnits,
      saleUnits: req.body.saleUnits,
      stock: req.body.stock
    });

    await newItem.save();
    res.status(201).json(newItem);
  } catch (err) {
    next(err);
  }
});

// Update inventory item
router.put('/inventory/:id', isLoggedIn, async (req, res, next) => {
  try {
    // If HSN code is being changed, check if new code already exists
    if (req.body.hsnCode) {
      const existingItem = await Item.findOne({ 
        hsnCode: req.body.hsnCode,
        _id: { $ne: req.params.id }
      });
      if (existingItem) {
        return res.status(400).json({ error: 'HSN Code already exists' });
      }
    }

    const updatedItem = await Item.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          hsnCode: req.body.hsnCode,
          productName: req.body.productName,
          cost: req.body.cost,
          purchaseUnits: req.body.purchaseUnits,
          saleUnits: req.body.saleUnits,
          stock: req.body.stock
        }
      },
      { new: true, runValidators: true }
    );

    if (!updatedItem) {
      return res.status(404).json({ error: 'Item not found' });
    }

    res.json(updatedItem);
  } catch (err) {
    next(err);
  }
});

// Delete inventory item
router.delete('/inventory/:id', isLoggedIn, async (req, res, next) => {
  try {
    const deletedItem = await Item.findByIdAndDelete(req.params.id);
    
    if (!deletedItem) {
      return res.status(404).json({ error: 'Item not found' });
    }

    res.json({ message: 'Item deleted successfully' });
  } catch (err) {
    next(err);
  }
});

// Customers page
router.get('/customers', isLoggedIn, async (req, res, next) => {
  try {
    const customers = await Customer.find().sort({ name: 1 }).lean();
    res.render('customers', { customers });
  } catch (err) {
    next(err);
  }
});

// Create customer
router.post('/customers', isLoggedIn, async (req, res, next) => {
  try {
    // Basic validation
    const { name, email, phone, address } = req.body;
    if (!name || !email || !address) {
      return res.status(400).json({ error: 'Missing required fields: name, email, address' });
    }

    // Check duplicate email
    const existing = await Customer.findOne({ email });
    if (existing) {
      return res.status(400).json({ error: 'Email already in use' });
    }

    const newCustomer = new Customer({ name, email, phone, address });
    await newCustomer.save();
    res.status(201).json(newCustomer);
  } catch (err) {
    console.error('Error creating customer:', err);
    // Mongoose validation or other known errors -> 400
    if (err.name === 'ValidationError' || err.code === 11000) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: err.message || 'Failed to create customer' });
  }
});

// Update customer
router.put('/customers/:id', isLoggedIn, async (req, res, next) => {
  try {
    const { name, email, phone, address } = req.body;
    const updated = await Customer.findByIdAndUpdate(req.params.id, { name, email, phone, address }, { new: true, runValidators: true });
    if (!updated) return res.status(404).json({ error: 'Customer not found' });
    res.json(updated);
  } catch (err) {
    console.error('Error updating customer:', err);
    if (err.name === 'ValidationError' || err.code === 11000) return res.status(400).json({ error: err.message });
    res.status(500).json({ error: err.message || 'Failed to update customer' });
  }
});

// Delete customer
router.delete('/customers/:id', isLoggedIn, async (req, res, next) => {
  try {
    // prevent deleting customers linked to sales
    const hasSales = await Sale.exists({ customerId: req.params.id });
    if (hasSales) return res.status(400).json({ error: 'Cannot delete customer with sales' });
    const deleted = await Customer.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Customer not found' });
    res.json({ message: 'Customer deleted' });
  } catch (err) {
    console.error('Error deleting customer:', err);
    res.status(500).json({ error: err.message || 'Failed to delete customer' });
  }
});

// Employees page
router.get('/employees', isLoggedIn, async (req, res, next) => {
  try {
    const employees = await Employee.find().sort({ name: 1 }).lean();
    res.render('employees', { employees });
  } catch (err) {
    next(err);
  }
});

// Create employee
router.post('/employees', isLoggedIn, async (req, res, next) => {
  try {
    const newEmployee = new Employee({
      name: req.body.name,
      email: req.body.email,
      phone: req.body.phone,
      address: req.body.address,
      role: req.body.role || 'staff'
    });
    await newEmployee.save();
    res.status(201).json(newEmployee);
  } catch (err) {
    console.error('Error creating employee:', err);
    res.status(500).json({ error: err.message || 'Failed to create employee' });
  }
});

// Update employee
router.put('/employees/:id', isLoggedIn, async (req, res, next) => {
  try {
    const { name, email, phone, address, role } = req.body;
    const updated = await Employee.findByIdAndUpdate(req.params.id, { name, email, phone, address, role }, { new: true, runValidators: true });
    if (!updated) return res.status(404).json({ error: 'Employee not found' });
    res.json(updated);
  } catch (err) {
    console.error('Error updating employee:', err);
    if (err.name === 'ValidationError' || err.code === 11000) return res.status(400).json({ error: err.message });
    res.status(500).json({ error: err.message || 'Failed to update employee' });
  }
});

// Delete employee
router.delete('/employees/:id', isLoggedIn, async (req, res, next) => {
  try {
    const deleted = await Employee.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Employee not found' });
    res.json({ message: 'Employee deleted' });
  } catch (err) {
    console.error('Error deleting employee:', err);
    res.status(500).json({ error: err.message || 'Failed to delete employee' });
  }
});

// Create purchase
router.post('/purchases', isLoggedIn, async (req, res, next) => {
  try {
    // Accept either productRef (id) or hsnCode to locate product
    // vendorId may be provided to link to a Vendor
    const { productRef, productId, hsnCode, units, cost, vendor, vendorId, date } = req.body;
    let product = null;
    if (productRef || productId) {
      const id = productRef || productId;
      product = await Product.findById(id);
    } else if (hsnCode) {
      product = await Product.findOne({ hsnCode });
    }

    if (!product) {
      return res.status(400).json({ error: 'Product not found for purchase' });
    }

    const unitsNum = Number(units || 0);
    const costNum = Number(cost || product.cost || 0);
    const amount = unitsNum * costNum;

    // resolve vendor if vendorId provided
    let vendorName = vendor || '';
    let vendorRef = vendorId || null;
    if (vendorRef) {
      try {
        const v = await Vendor.findById(vendorRef).lean();
        if (v) vendorName = v.name;
      } catch (e) {}
    }

    const purchase = new Purchase({
      hsnCode: product.hsnCode,
      productName: product.productName,
      vendor: vendorName || '',
      vendorRef: vendorRef || null,
      date: date ? new Date(date) : Date.now(),
      units: unitsNum,
      cost: costNum,
      amount,
      productRef: product._id
    });

    await purchase.save();
    // post-save hook on Purchase increments product stock; reload to return normalized object
    const saved = await Purchase.findById(purchase._id).populate('productRef').lean();
    res.status(201).json(saved);
  } catch (err) {
    console.error('Error creating purchase:', err);
    res.status(500).json({ error: err.message || 'Failed to create purchase' });
  }
});

// Update purchase (stable + correct stock handling + debug logs)
router.put('/purchases/:id', isLoggedIn, async (req, res) => {
  try {
    const purchase = await Purchase.findById(req.params.id);
    if (!purchase) return res.status(404).json({ error: 'Purchase not found' });

    const oldUnits = Number(purchase.units || 0);
    const oldProductId = purchase.productRef ? String(purchase.productRef) : null;

    // Cast safely to numbers
    const newUnits = Number(req.body.units);
    const newCost = Number(req.body.cost ?? purchase.cost);
    if (isNaN(newUnits) || newUnits < 0) {
      return res.status(400).json({ error: 'Invalid units value' });
    }
    if (isNaN(newCost) || newCost < 0) {
      return res.status(400).json({ error: 'Invalid cost value' });
    }

    const amount = newUnits * newCost;

    // Determine product ID
    let productId = req.body.productRef || req.body.productId || oldProductId;
    if (!productId && req.body.hsnCode) {
      const product = await Product.findOne({ hsnCode: req.body.hsnCode }).lean();
      if (product) productId = String(product._id);
    }

    if (!productId) {
      return res.status(400).json({ error: 'No product specified for purchase' });
    }

    console.log('--- PURCHASE UPDATE START ---');
    console.log('Old Product:', oldProductId);
    console.log('New Product:', productId);
    console.log('Old Units:', oldUnits);
    console.log('New Units:', newUnits);

    // =========================
    // STOCK ADJUSTMENT
    // =========================
    if (String(productId) !== String(oldProductId)) {
      // Product changed → revert old stock, add new stock
      if (oldProductId) {
        await Product.findByIdAndUpdate(oldProductId, { $inc: { stock: -oldUnits } });
        console.log(`Reverted old product (${oldProductId}) by -${oldUnits}`);
      }

      await Product.findByIdAndUpdate(productId, { $inc: { stock: newUnits } });
      console.log(`Added to new product (${productId}) +${newUnits}`);

      const np = await Product.findById(productId).lean();
      if (np) {
        purchase.productRef = np._id;
        purchase.hsnCode = np.hsnCode;
        purchase.productName = np.productName;
      }
    } else {
      // Same product → adjust by difference
      const diff = newUnits - oldUnits;
      console.log('Stock difference:', diff);

      if (diff !== 0) {
        await Product.findByIdAndUpdate(productId, { $inc: { stock: diff } });
        console.log(`Adjusted product (${productId}) stock by ${diff}`);
      } else {
        console.log('No stock change (same quantity)');
      }
    }

    // =========================
    // VENDOR HANDLING
    // =========================
    if (req.body.vendorId) {
      const v = await Vendor.findById(req.body.vendorId).lean();
      if (v) {
        purchase.vendor = v.name;
        purchase.vendorRef = v._id;
      }
    } else if (req.body.vendor !== undefined) {
      purchase.vendor = req.body.vendor;
      purchase.vendorRef = null;
    }

    // =========================
    // FINAL FIELD UPDATES
    // =========================
    purchase.date = req.body.date ? new Date(req.body.date) : purchase.date;
    purchase.units = newUnits;
    purchase.cost = newCost;
    purchase.amount = amount;

    await purchase.save();

    const updated = await Purchase.findById(purchase._id).populate('productRef').lean();

    console.log('--- PURCHASE UPDATE END ---\n');
    res.json(updated);

  } catch (err) {
    console.error('Error updating purchase:', err);
    res.status(500).json({ error: err.message || 'Failed to update purchase' });
  }
});




// Delete purchase
router.delete('/purchases/:id', isLoggedIn, async (req, res, next) => {
  try {
    const purchase = await Purchase.findById(req.params.id);
    if (!purchase) return res.status(404).json({ error: 'Purchase not found' });

    // decrement product stock when a purchase is removed
    if (purchase.productRef) {
      await Product.findByIdAndUpdate(purchase.productRef, { $inc: { stock: -purchase.units } });
    }

    await Purchase.findByIdAndDelete(req.params.id);
    res.json({ message: 'Purchase deleted' });
  } catch (err) {
    console.error('Error deleting purchase:', err);
    res.status(500).json({ error: err.message || 'Failed to delete purchase' });
  }
});

// Create sale
router.post('/sales', isLoggedIn, async (req, res, next) => {
  try {
    // accept productRef id or hsnCode, and customerId
    const { productRef, productId, hsnCode, units, price, customerId } = req.body;
    let product = null;
    if (productRef || productId) {
      const id = productRef || productId;
      product = await Product.findById(id);
    } else if (hsnCode) {
      product = await Product.findOne({ hsnCode });
    }

    if (!product) return res.status(400).json({ error: 'Product not found for sale' });

    const unitsNum = Number(units || 0);
    const priceNum = Number(price || product.sellingPrice || product.cost || 0);
    if (product.stock < unitsNum) {
      return res.status(400).json({ error: 'Insufficient stock' });
    }

    const amount = unitsNum * priceNum;

    // If customerId provided, resolve customerName from DB
    let custName = req.body.customerName || '';
    let custRef = customerId || null;
    if (custRef) {
      try {
        const cust = await Customer.findById(custRef).lean();
        if (cust) custName = cust.name;
      } catch (e) {
        // ignore lookup error here; will be validated by schema
      }
    }

    const sale = new Sale({
      customerId: custRef,
      customerName: custName,
      hsnCode: product.hsnCode,
      productName: product.productName,
      date: req.body.date ? new Date(req.body.date) : Date.now(),
      units: unitsNum,
      price: priceNum,
      amount,
      productRef: product._id
    });

    await sale.save();
    const saved = await Sale.findById(sale._id).populate('productRef').populate('customerId').lean();
    res.status(201).json(saved);
  } catch (err) {
    console.error('Error creating sale:', err);
    // Validation-like errors -> 400
    if (err.name === 'ValidationError' || /Insufficient stock/.test(err.message)) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: err.message || 'Failed to create sale' });
  }
});

// Update sale
router.put('/sales/:id', isLoggedIn, async (req, res, next) => {
  // Robust transactional handler for editing a sale.
  // - Validates inputs (ids, units, price, date)
  // - Defaults to existing sale product when no product identifier provided
  // - Uses a mongoose session/transaction to make stock + sale updates atomic
  // - Returns clear 4xx for invalid input and 500 for other errors
  let session;
  try {
    const saleId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(saleId)) return res.status(400).json({ error: 'Invalid sale id' });

    session = await mongoose.startSession();
    let resultSale = null;

    // Attempt to use a transaction; if the server doesn't support transactions (standalone),
    // fall back to a safe non-transactional update path.
    try {
      await session.withTransaction(async () => {
        // Load the sale inside the session
        const sale = await Sale.findById(saleId).session(session);
      if (!sale) {
        const err = new Error('Sale not found'); err.status = 404; throw err;
      }

      // Determine target product (use sale's product when client omits product identifiers)
      const inputProductId = req.body.productRef || req.body.productId;
      const inputHsn = req.body.hsnCode;
      let targetProductId = null;

      if (inputProductId) {
        if (!mongoose.Types.ObjectId.isValid(String(inputProductId))) {
          const err = new Error('Invalid product id'); err.status = 400; throw err;
        }
        targetProductId = String(inputProductId);
      } else if (inputHsn) {
        const p = await Product.findOne({ hsnCode: inputHsn }).session(session);
        if (!p) { const err = new Error('Product not found for provided HSN'); err.status = 400; throw err; }
        targetProductId = String(p._id);
      } else {
        targetProductId = sale.productRef ? String(sale.productRef) : null;
      }

      if (!targetProductId) { const err = new Error('No product specified'); err.status = 400; throw err; }

      // Parse and validate numeric inputs
      const rawUnits = req.body.units != null ? req.body.units : sale.units;
      const rawPrice = req.body.price != null ? req.body.price : sale.price;

      const newUnits = Number(rawUnits);
      const newPrice = Number(rawPrice);
      if (!Number.isFinite(newUnits) || newUnits < 0 || !Number.isInteger(newUnits)) {
        const err = new Error('Invalid units; must be a non-negative integer'); err.status = 400; throw err;
      }
      if (!Number.isFinite(newPrice) || newPrice < 0) { const err = new Error('Invalid price'); err.status = 400; throw err; }

      // Validate and normalize date if provided
      let newDate = sale.date;
      if (req.body.date) {
        const d = new Date(req.body.date);
        if (isNaN(d.getTime())) { const err = new Error('Invalid date'); err.status = 400; throw err; }
        newDate = d;
      }

      // Resolve customer if provided (optional)
      let custRef = req.body.customerId != null ? req.body.customerId : sale.customerId;
      if (custRef && !mongoose.Types.ObjectId.isValid(String(custRef))) {
        const err = new Error('Invalid customer id'); err.status = 400; throw err;
      }
      let custName = req.body.customerName || sale.customerName || '';
      if (custRef) {
        const c = await Customer.findById(custRef).session(session).lean();
        if (c) custName = c.name;
      }

      // Old values
      const oldUnits = sale.units || 0;
      const oldProductId = sale.productRef ? String(sale.productRef) : null;

      // Stock checks and updates (all inside the transaction)
      if (oldProductId === targetProductId) {
        // same product: compute effective availability by adding back the old sale units
        const product = await Product.findById(targetProductId).session(session);
        if (!product) { const err = new Error('Product not found'); err.status = 404; throw err; }

        const effectiveStock = (product.stock || 0) + oldUnits;
        if (effectiveStock < newUnits) {
          const err = new Error(`Insufficient stock. Available: ${effectiveStock}, Requested: ${newUnits}`);
          err.status = 400; throw err;
        }

        const unitsDiff = newUnits - oldUnits; // positive => need to decrement more
        if (unitsDiff !== 0) {
          await Product.findByIdAndUpdate(targetProductId, { $inc: { stock: -unitsDiff } }).session(session);
        }
      } else {
        // different product: validate new product stock first
        const [oldProduct, newProduct] = await Promise.all([
          oldProductId ? Product.findById(oldProductId).session(session) : Promise.resolve(null),
          Product.findById(targetProductId).session(session)
        ]);

        if (!newProduct) { const err = new Error('New product not found'); err.status = 404; throw err; }
        if ((newProduct.stock || 0) < newUnits) {
          const err = new Error(`Insufficient stock on new product. Available: ${newProduct.stock || 0}, Requested: ${newUnits}`);
          err.status = 400; throw err;
        }

        // All validations passed; perform stock updates atomically
        const ops = [];
        if (oldProductId && oldProduct) {
          // restore old product's stock
          ops.push(Product.findByIdAndUpdate(oldProductId, { $inc: { stock: oldUnits } }).session(session));
        }
        ops.push(Product.findByIdAndUpdate(targetProductId, { $inc: { stock: -newUnits } }).session(session));
        await Promise.all(ops);
      }

      // Update sale document
  sale.productRef = new mongoose.Types.ObjectId(targetProductId);
      sale.hsnCode = req.body.hsnCode || sale.hsnCode;
      sale.productName = req.body.productName || sale.productName;
      sale.units = newUnits;
      sale.price = newPrice;
      sale.amount = Number(newUnits * newPrice) || 0;
  sale.customerId = custRef ? new mongoose.Types.ObjectId(custRef) : sale.customerId;
      sale.customerName = custName;
      sale.date = newDate;

      // Save updated sale WITHOUT triggering save hooks (use findByIdAndUpdate)
      await Sale.findByIdAndUpdate(sale._id, {
        productRef: sale.productRef,
        hsnCode: sale.hsnCode,
        productName: sale.productName,
        units: sale.units,
        price: sale.price,
        amount: sale.amount,
        customerId: sale.customerId,
        customerName: sale.customerName,
        date: sale.date
      }, { new: true, runValidators: true, session });

      // Load the saved sale (populate) inside the session so we return the committed state
      resultSale = await Sale.findById(sale._id).populate('productRef').populate('customerId').session(session).lean();
      });

      session.endSession();
      return res.json(resultSale);
    } catch (txErr) {
      // Detect transactions-not-supported error message and fall back
      const msg = String(txErr && txErr.message || '').toLowerCase();
      if (!/replica set|transaction numbers are only allowed|not a replica set/.test(msg)) {
        // Not the transactions-unsupported case — rethrow
        throw txErr;
      }

      // End session and perform non-transactional fallback
      try { session.endSession(); } catch (e) {}

      // Non-transactional fallback path
      // We'll perform the same validations, but use conditional updates to keep operations
      // as atomic as possible (findOneAndUpdate with $inc and query conditions).
      // Load sale outside transaction
      const sale = await Sale.findById(saleId);
      if (!sale) return res.status(404).json({ error: 'Sale not found' });

      // Determine target product id
      const inputProductId = req.body.productRef || req.body.productId;
      const inputHsn = req.body.hsnCode;
      let targetProductId = null;
      if (inputProductId) {
        if (!mongoose.Types.ObjectId.isValid(String(inputProductId))) return res.status(400).json({ error: 'Invalid product id' });
        targetProductId = String(inputProductId);
      } else if (inputHsn) {
        const p = await Product.findOne({ hsnCode: inputHsn });
        if (!p) return res.status(400).json({ error: 'Product not found for provided HSN' });
        targetProductId = String(p._id);
      } else {
        targetProductId = sale.productRef ? String(sale.productRef) : null;
      }
      if (!targetProductId) return res.status(400).json({ error: 'No product specified' });

      // Parse and validate numeric inputs
      const rawUnits = req.body.units != null ? req.body.units : sale.units;
      const rawPrice = req.body.price != null ? req.body.price : sale.price;
      const newUnits = Number(rawUnits);
      const newPrice = Number(rawPrice);
      if (!Number.isFinite(newUnits) || newUnits < 0 || !Number.isInteger(newUnits)) return res.status(400).json({ error: 'Invalid units; must be a non-negative integer' });
      if (!Number.isFinite(newPrice) || newPrice < 0) return res.status(400).json({ error: 'Invalid price' });

      // Validate date
      let newDate = sale.date;
      if (req.body.date) {
        const d = new Date(req.body.date);
        if (isNaN(d.getTime())) return res.status(400).json({ error: 'Invalid date' });
        newDate = d;
      }

      // Resolve customer
      let custRef = req.body.customerId != null ? req.body.customerId : sale.customerId;
      if (custRef && !mongoose.Types.ObjectId.isValid(String(custRef))) return res.status(400).json({ error: 'Invalid customer id' });
      let custName = req.body.customerName || sale.customerName || '';
      if (custRef) {
        const c = await Customer.findById(custRef).lean(); if (c) custName = c.name;
      }

      const oldUnits = sale.units || 0;
      const oldProductId = sale.productRef ? String(sale.productRef) : null;

      // Non-transactional stock updates
      if (oldProductId === targetProductId) {
        // same product: perform conditional update on product to ensure availability
        const product = await Product.findById(targetProductId);
        if (!product) return res.status(404).json({ error: 'Product not found' });
        const effectiveStock = (product.stock || 0) + oldUnits;
        if (effectiveStock < newUnits) return res.status(400).json({ error: `Insufficient stock. Available: ${effectiveStock}, Requested: ${newUnits}` });

        const unitsDiff = newUnits - oldUnits;
        if (unitsDiff > 0) {
          // Need to decrement additional unitsDiff. Use atomic conditional update.
          const updated = await Product.findOneAndUpdate(
            { _id: targetProductId, stock: { $gte: unitsDiff } },
            { $inc: { stock: -unitsDiff } },
            { new: true }
          );
          if (!updated) return res.status(400).json({ error: 'Insufficient stock for the increased units' });
        } else if (unitsDiff < 0) {
          // Increase stock by -unitsDiff
          await Product.findByIdAndUpdate(targetProductId, { $inc: { stock: -unitsDiff } });
        }
      } else {
        // different product: ensure new product has enough stock before mutating
        const newP = await Product.findById(targetProductId).lean();
        if (!newP) return res.status(404).json({ error: 'New product not found' });
        if ((newP.stock || 0) < newUnits) return res.status(400).json({ error: `Insufficient stock on new product. Available: ${newP.stock || 0}, Requested: ${newUnits}` });

        // Restore old product's stock first, then decrement new product's stock
        if (oldProductId) {
          await Product.findByIdAndUpdate(oldProductId, { $inc: { stock: oldUnits } });
        }
        const dec = await Product.findOneAndUpdate({ _id: targetProductId, stock: { $gte: newUnits } }, { $inc: { stock: -newUnits } }, { new: true });
        if (!dec) {
          // Attempt to rollback restore of old product if possible (best-effort)
          if (oldProductId) await Product.findByIdAndUpdate(oldProductId, { $inc: { stock: -oldUnits } });
          return res.status(400).json({ error: 'Insufficient stock on new product (race detected)' });
        }
      }

      // Update sale document
  sale.productRef = new mongoose.Types.ObjectId(targetProductId);
      sale.hsnCode = req.body.hsnCode || sale.hsnCode;
      sale.productName = req.body.productName || sale.productName;
      sale.units = newUnits;
      sale.price = newPrice;
      sale.amount = Number(newUnits * newPrice) || 0;
  sale.customerId = custRef ? new mongoose.Types.ObjectId(custRef) : sale.customerId;
      sale.customerName = custName;
      sale.date = newDate;
      // Save updated sale via findByIdAndUpdate to avoid triggering pre/post save hooks
      await Sale.findByIdAndUpdate(sale._id, {
        productRef: sale.productRef,
        hsnCode: sale.hsnCode,
        productName: sale.productName,
        units: sale.units,
        price: sale.price,
        amount: sale.amount,
        customerId: sale.customerId,
        customerName: sale.customerName,
        date: sale.date
      }, { new: true, runValidators: true });

      const updatedSale = await Sale.findById(sale._id).populate('productRef').populate('customerId').lean();
      return res.json(updatedSale);
    }
  } catch (err) {
    if (session) try { await session.abortTransaction(); session.endSession(); } catch (e) {}
    console.error('Error updating sale:', err);
    if (err && err.status) return res.status(err.status).json({ error: err.message });
    return res.status(500).json({ error: err.message || 'Failed to update sale' });
  }
});

// Delete sale
router.delete('/sales/:id', isLoggedIn, async (req, res, next) => {
  try {
    const sale = await Sale.findById(req.params.id);
    if (!sale) return res.status(404).json({ error: 'Sale not found' });

    // restore stock
    if (sale.productRef) {
      await Product.findByIdAndUpdate(sale.productRef, { $inc: { stock: sale.units } });
    }

    await Sale.findByIdAndDelete(req.params.id);
    res.json({ message: 'Sale deleted' });
  } catch (err) {
    console.error('Error deleting sale:', err);
    res.status(500).json({ error: err.message || 'Failed to delete sale' });
  }
});

// Feed page
router.get('/feed', isLoggedIn, async (req, res, next) => {
  try {
    const posts = await postModel.find({})
      .populate('author')
      .sort({ createdAt: -1 })
      .lean();
    res.render('feed', { posts });
  } catch (err) {
    next(err);
  }
});

// Products routes
router.get('/products', isLoggedIn, async (req, res, next) => {
  try {
    const products = await Product.find()
      .sort({ productName: 1 })
      .lean();
    res.render('products', { products });
  } catch (err) {
    next(err);
  }
});

// API: list products (JSON)
router.get('/api/products', isLoggedIn, async (req, res, next) => {
  try {
    const products = await Product.find().sort({ productName: 1 }).lean();
    res.json(products);
  } catch (err) {
    next(err);
  }
});

// API: list customers (JSON)
router.get('/api/customers', isLoggedIn, async (req, res, next) => {
  try {
    const customers = await Customer.find().sort({ name: 1 }).lean();
    res.json(customers);
  } catch (err) {
    next(err);
  }
});

// API: list vendors (JSON). Optional filter by productId to get vendors that supply a product
router.get('/api/vendors', isLoggedIn, async (req, res, next) => {
  try {
    const { productId } = req.query;
    let q = {};
    if (productId) q.products = productId;
    const vendors = await Vendor.find(q).sort({ name: 1 }).lean();
    res.json(vendors);
  } catch (err) {
    next(err);
  }
});

// Create new product
router.post('/products', isLoggedIn, async (req, res, next) => {
  try {
    const existingProduct = await Product.findOne({ hsnCode: req.body.hsnCode });
    if (existingProduct) {
      return res.status(400).json({ error: 'HSN Code already exists' });
    }

    const newProduct = new Product({
      hsnCode: req.body.hsnCode,
      productName: req.body.productName,
      cost: req.body.cost,
      sellingPrice: req.body.sellingPrice,
      stock: req.body.stock || 0
    });

    await newProduct.save();
    res.status(201).json(newProduct);
  } catch (err) {
    next(err);
  }
});

// Vendors page
router.get('/vendors', isLoggedIn, async (req, res, next) => {
  try {
    const vendors = await Vendor.find().sort({ name: 1 }).lean();
    res.render('vendors', { vendors });
  } catch (err) {
    next(err);
  }
});

// Create vendor
router.post('/vendors', isLoggedIn, async (req, res, next) => {
  try {
    const { name, email, phone, address, products } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });
    // Handle products array - ensure we get valid ObjectIds
    const prodArray = Array.isArray(products) ? products : (products ? [products] : []);
    const v = new Vendor({ name, email, phone, address, products: prodArray.filter(p => mongoose.Types.ObjectId.isValid(p)) });
    await v.save();
    res.status(201).json(v);
  } catch (err) {
    console.error('Error creating vendor:', err);
    if (err.name === 'ValidationError' || err.code === 11000) return res.status(400).json({ error: err.message });
    res.status(500).json({ error: err.message || 'Failed to create vendor' });
  }
});

// Update vendor
router.put('/vendors/:id', isLoggedIn, async (req, res, next) => {
  try {
    const { name, email, phone, address, products } = req.body;
    // Handle products array - ensure we get valid ObjectIds
    const prodArray = Array.isArray(products) ? products : (products ? [products] : []);
    const validProducts = prodArray.filter(p => mongoose.Types.ObjectId.isValid(p));
    const updated = await Vendor.findByIdAndUpdate(req.params.id, { name, email, phone, address, products: validProducts }, { new: true, runValidators: true });
    if (!updated) return res.status(404).json({ error: 'Vendor not found' });
    res.json(updated);
  } catch (err) {
    console.error('Error updating vendor:', err);
    res.status(500).json({ error: err.message || 'Failed to update vendor' });
  }
});

// Delete vendor
router.delete('/vendors/:id', isLoggedIn, async (req, res, next) => {
  try {
    // optionally, prevent delete if used in purchases
    const hasPurchases = await Purchase.exists({ vendorRef: req.params.id });
    if (hasPurchases) return res.status(400).json({ error: 'Cannot delete vendor with associated purchases' });
    const deleted = await Vendor.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Vendor not found' });
    res.json({ message: 'Vendor deleted' });
  } catch (err) {
    console.error('Error deleting vendor:', err);
    res.status(500).json({ error: err.message || 'Failed to delete vendor' });
  }
});

// Update product
router.put('/products/:id', isLoggedIn, async (req, res, next) => {
  try {
    if (req.body.hsnCode) {
      const existingProduct = await Product.findOne({
        hsnCode: req.body.hsnCode,
        _id: { $ne: req.params.id }
      });
      if (existingProduct) {
        return res.status(400).json({ error: 'HSN Code already exists' });
      }
    }

    const updatedProduct = await Product.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true, runValidators: true }
    );

    if (!updatedProduct) {
      return res.status(404).json({ error: 'Product not found' });
    }

    res.json(updatedProduct);
  } catch (err) {
    next(err);
  }
});

// Delete product
router.delete('/products/:id', isLoggedIn, async (req, res, next) => {
  try {
    // Check if product is referenced in purchases or sales
    const hasPurchases = await Purchase.exists({ productRef: req.params.id });
    const hasSales = await Sale.exists({ productRef: req.params.id });

    if (hasPurchases || hasSales) {
      return res.status(400).json({ 
        error: 'Cannot delete product with associated purchases or sales' 
      });
    }

    const deletedProduct = await Product.findByIdAndDelete(req.params.id);
    if (!deletedProduct) {
      return res.status(404).json({ error: 'Product not found' });
    }

    res.json({ message: 'Product deleted successfully' });
  } catch (err) {
    next(err);
  }
});

// Profile page
router.get('/profile', isLoggedIn, async (req, res, next) => {
  try {
    const user = await userModel
      .findOne({ username: req.session.passport.user })
      .populate('posts')
      .lean();
    res.render('profile', { user });
  } catch (err) {
    next(err);
  }
});

// Purchases page
router.get('/purchases', isLoggedIn, async (req, res, next) => {
  try {
    const purchases = await Purchase.find()
      .populate('productRef')
      .sort({ createdAt: -1 })
      .lean();
    // normalize for template
    const normalized = purchases.map(p => ({
      _id: p._id,
      productRef: p.productRef && p.productRef._id,
      hsnCode: p.hsnCode || (p.productRef && p.productRef.hsnCode),
      productName: p.productName || (p.productRef && p.productRef.productName),
      vendor: p.vendor,
      vendorRef: p.vendorRef ? (p.vendorRef._id || p.vendorRef) : '',
      date: p.date ? p.date.toISOString().slice(0,10) : '',
      units: p.units,
      cost: p.cost,
      amount: p.amount
    }));
    res.render('purchases', { purchases: normalized });
  } catch (err) {
    next(err);
  }
});

// Sales page
router.get('/sales', isLoggedIn, async (req, res, next) => {
  try {
    const sales = await Sale.find()
      .populate('productRef')
      .populate('customerId')
      .sort({ createdAt: -1 })
      .lean();
    const normalized = sales.map(s => ({
      _id: s._id,
      // customerId (display) is the human-friendly custId, keep separately from DB _id
      customerId: s.customerId ? s.customerId.custId : '',
      customerDbId: s.customerId ? (s.customerId._id || s.customerId) : '',
      customerName: s.customerName || (s.customerId && s.customerId.name),
      // include productRef DB id separately so UI can select by id when editing
      productRef: s.productRef ? (s.productRef._id || s.productRef) : '',
      hsnCode: s.hsnCode || (s.productRef && s.productRef.hsnCode),
      productName: s.productName || (s.productRef && s.productRef.productName),
      date: s.date ? s.date.toISOString().slice(0,10) : '',
      stockUnits: s.stockUnits || (s.productRef && s.productRef.stock) || 0,
      units: s.units,
      price: s.price,
      amount: s.amount
    }));
    res.render('sales', { sales: normalized });
  } catch (err) {
    next(err);
  }
});

// Auth middleware
function isLoggedIn(req, res, next) {
  console.log('=== isLoggedIn Middleware ===');
  console.log('Auth check - isAuthenticated:', req.isAuthenticated());
  console.log('Session ID:', req.sessionID);
  console.log('Session:', req.session);
  console.log('User:', req.user);
  console.log('Cookies:', req.cookies);
  console.log('=========================');

  if (req.isAuthenticated()) {
    console.log('User is authenticated, proceeding to next middleware');
    return next();
  }
  
  console.log('User is not authenticated, redirecting to login');
  // Store the requested URL for redirection after login
  req.session.returnTo = req.originalUrl;
  res.redirect('/login');
}

module.exports = router;
