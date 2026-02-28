const express = require("express");
const mysql = require("mysql2/promise");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const path = require("path");
const multer = require("multer");
const fs = require("fs");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ===== AUTHENTICATE TOKEN (MOVED TO TOP) =====
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }
  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
}

// ===== DATABASE SETUP =====


let db;
const dataFilePath = path.join(__dirname, "preorders.json");
if (process.env.NODE_ENV === 'production') {
  db = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASS,
    database: process.env.MYSQL_DB,
    waitForConnections: true,
    connectionLimit: 10,
  });
  console.log('✅ Connected to MySQL (production)');
} else {
  console.log('📁 Using JSON files (local dev)');
}

// ===== JSON HELPERS =====
const readJsonFile = (filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
    return [];
  } catch {
    return [];
  }
};
const writeJsonFile = (filePath, data) => {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return true;
  } catch {
    return false;
  }
};




app.get("/api/test", (req, res) => {
  res.json({ message: "Backend is working!" });
});

app.get('/api/epubs/:filename', (req, res) => {
  const filePath = path.join(__dirname, 'epubs', req.params.filename);
  res.type('application/epub+zip');
  res.sendFile(filePath);
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'public', 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|pdf|mp3|wav/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  }
});

const placeholderImage = "/images/placeholder.jpg";

let storeProducts = [
  ...Array.from({ length: 13 }, (_, i) => ({
    id: `album-${i + 1}`,
    name: `Album ${i + 1}`,
    price: 1000,
    image: placeholderImage,
    type: "album",
    preorderGoal: 100,
    preorders: Math.floor(Math.random() * 100),
    featured: i < 3
  })),
  ...Array.from({ length: 8 }, (_, i) => ({
    id: `novel-${i + 1}`,
    name: `Novel ${i + 1}`,
    price: 1500,
    image: placeholderImage,
    type: "novel",
    featured: i === 0
  })),
  ...Array.from({ length: 200 }, (_, i) => ({
    id: `art-${i + 1}`,
    name: `Art PDF ${i + 1}`,
    price: 500,
    image: placeholderImage,
    type: "art",
    featured: i === 41
  })),
  ...Array.from({ length: 100 }, (_, i) => ({
    id: `tshirt-${i + 1}`,
    name: `T-shirt ${i + 1}`,
    price: 2500,
    image: placeholderImage,
    type: "tshirt",
    featured: i < 2
  }))
];


app.post("/api/admin/login", (req, res) => {
  const { username, password } = req.body;
  
  if (!process.env.JWT_SECRET) {
    return res.status(500).json({ 
      error: "Server configuration error: JWT_SECRET not set" 
    });
  }
  
  const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "password123";
  
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    const token = jwt.sign({ username }, process.env.JWT_SECRET, { expiresIn: "1h" });
    return res.json({ token });
  }
  
  res.status(401).json({ error: "Invalid credentials" });
});

app.get('/api/admin/products', authenticateToken, (req, res) => {
  try {
    const productsFilePath = path.join(__dirname, "products.json");
    
    if (fs.existsSync(productsFilePath)) {
      const data = fs.readFileSync(productsFilePath, "utf8");
      const products = data.trim() ? JSON.parse(data) : [];
      res.json(products);
    } else {
      res.json([]);
    }
  } catch (error) {
    console.error("Error fetching products:", error);
    res.status(500).json({ error: "Failed to load products" });
  }
});

app.post('/api/admin/products', authenticateToken, upload.single('image'), (req, res) => {
  try {
    const { name, price, type, featured, downloadLink } = req.body;
    
    if (!name || !price || !type) {
      return res.status(400).json({ error: 'Name, price, and type are required' });
    }
    
    const productsFilePath = path.join(__dirname, "products.json");
    let products = [];
    if (fs.existsSync(productsFilePath)) {
      const data = fs.readFileSync(productsFilePath, "utf8");
      products = data.trim() ? JSON.parse(data) : [];
    }
    
    const id = `${type}-${Date.now()}`;
    const imagePath = req.file ? `/uploads/${req.file.filename}` : '/images/default.jpg';
    
    const newProduct = {
      id,
      name,
      price: parseFloat(price) * 100,
      type,
      image: imagePath,
      featured: featured === 'true' || featured === true,
      downloadLink: downloadLink || '',
      preorderGoal: null,
      preorders: 0
    };
    
    products.push(newProduct);
    fs.writeFileSync(productsFilePath, JSON.stringify(products, null, 2));
    
    res.json({ success: true, product: newProduct });
    
  } catch (error) {
    console.error('Error creating product:', error);
    res.status(500).json({ error: 'Failed to create product' });
  }
});

app.patch('/api/products/:id', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const { featured } = req.body;
    
    const productsFilePath = path.join(__dirname, "products.json");
    
    if (!fs.existsSync(productsFilePath)) {
      return res.status(404).json({ error: "Products file not found" });
    }
    
    const data = fs.readFileSync(productsFilePath, "utf8");
    const products = data.trim() ? JSON.parse(data) : [];
    
    const productIndex = products.findIndex(p => p.id === id);
    
    if (productIndex === -1) {
      return res.status(404).json({ error: "Product not found" });
    }
    
    products[productIndex] = {
      ...products[productIndex],
      featured: featured
    };
    
    fs.writeFileSync(productsFilePath, JSON.stringify(products, null, 2));
    
    res.json({ success: true, product: products[productIndex] });
    
  } catch (error) {
    console.error("Error updating product:", error);
    res.status(500).json({ error: "Failed to update product" });
  }
});

app.get('/api/products/featured', (req, res) => {
  console.log('â­ Featured products called');
  
  let featured = [];
  try {
    const productsFilePath = path.join(__dirname, "products.json");
    if (!fs.existsSync(productsFilePath)) {
      console.log('âŒ No products.json');
      return res.json([]);
    }
    
    const data = fs.readFileSync(productsFilePath, "utf8");
    let products = [];
    try {
      products = JSON.parse(data);
    } catch (e) {
      console.error('JSON ERROR:', e.message);
      return res.json([]);  // Empty array, no crash
    }
    
    if (Array.isArray(products)) {
      featured = products.filter(p => p.featured === true);
    }
    
    console.log('â­ Found', featured.length, 'featured products');
    res.json(featured);
    
  } catch (error) {
    console.error('â­ FEATURED ERROR:', error.message);
    res.json([]);  // Always safe fallback
  }
});


app.get('/api/products', (req, res) => {
  try {
    const productsFilePath = path.join(__dirname, "products.json");
    
    if (fs.existsSync(productsFilePath)) {
      const data = fs.readFileSync(productsFilePath, "utf8");
      let products = [];
try {
  products = JSON.parse(data);
} catch (error) {
  console.error('JSON PARSE ERROR:', error.message);
  products = [];
}

      res.json(products);
    } else {
      res.json([]);
    }
  } catch (error) {
    console.error("Error fetching products:", error);
    res.status(500).json({ error: "Failed to load products" });
  }
});

app.post('/api/admin/upload', authenticateToken, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  
  const fileUrl = `/api/uploads/${req.file.filename}`;
  res.json({ 
    success: true, 
    url: fileUrl,
    filename: req.file.filename,
    originalName: req.file.originalname,
    size: req.file.size
  });
});

app.get('/api/admin/files', authenticateToken, (req, res) => {
  const uploadDir = path.join(__dirname, 'public', 'uploads');
  
  if (!fs.existsSync(uploadDir)) {
    return res.json({ files: [] });
  }
  
  const files = fs.readdirSync(uploadDir).map(filename => {
    const stats = fs.statSync(path.join(uploadDir, filename));
    return {
      filename,
      url: `/api/uploads/${filename}`,
      size: stats.size,
      created: stats.birthtime
    };
  });
  
  res.json({ files });
});

app.delete('/api/admin/files/:filename', authenticateToken, (req, res) => {
  const filePath = path.join(__dirname, 'public', 'uploads', req.params.filename);
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  
  fs.unlinkSync(filePath);
  res.json({ success: true, message: 'File deleted' });
});

app.post("/api/preorder", async (req, res) => {
  const { name, email, message, productId, productName } = req.body;
  
  if (!name || !email) {
    return res.status(400).json({ error: "Name and email are required" });
  }

  try {
    let preorders = [];
    if (fs.existsSync(dataFilePath)) {
      const data = fs.readFileSync(dataFilePath, "utf8");
      preorders = data.trim() ? JSON.parse(data) : [];
    }
    
    const newPreorder = {
      id: Date.now(),
      name,
      email,
      message: message || null,
      productId: productId || null,
      productName: productName || null,
      created_at: new Date().toISOString()
    };
    
    preorders.push(newPreorder);
    fs.writeFileSync(dataFilePath, JSON.stringify(preorders, null, 2));
    
    res.json({ success: true, id: newPreorder.id });
  } catch (error) {
    console.error("Preorder error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/create-checkout-session", (req, res) => {
  res.json({ id: "mock_session_id" });
});

app.get("/api/admin/stats", authenticateToken, (req, res) => {
  try {
    let preorders = [];
    if (fs.existsSync(dataFilePath)) {
      const data = fs.readFileSync(dataFilePath, "utf8");
      preorders = data.trim() ? JSON.parse(data) : [];
    }
    
    const today = new Date().toISOString().split('T')[0];
    const todayPreorders = preorders.filter(p => p.created_at.startsWith(today));
    
    res.json({
      totalProducts: storeProducts.length,
      totalPreorders: preorders.length,
      visitors: {
        total: preorders.length,
        today: todayPreorders.length
      }
    });
  } catch (error) {
    console.error("Error fetching stats:", error);
    res.status(500).json({ error: "Failed to load stats" });
  }
});






app.post("/api/admin/preorder", (req, res) => {
  const { name, email, message, productId, productName } = req.body;

  if (!name || !email) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const sql = `
    INSERT INTO preorders (name, email, message, productId, productName, created_at)
    VALUES (?, ?, ?, ?, ?, NOW())
  `;

  const values = [name, email, message, productId, productName];

  db.query(sql, values, (err, result) => {
    if (err) {
      console.error("? DB INSERT ERROR:", err);
      return res.status(500).json({ error: "Database insert failed" });
    }

    console.log("? DB INSERT SUCCESS:", result);
    res.json({ success: true });
  });
});












app.get('/api/admin/preorders', authenticateToken, (req, res) => {
  const preorders = readJsonFile(dataFilePath);
  
  // Transform to EXACT MySQL RowDataPacket format your admin expects
  const rows = preorders.map(item => ({
    id: parseInt(item.id),
    name: item.name,
    email: item.email,
    message: item.message || null,
    productId: item.productId || null,
    productName: item.productName,
    created_at: item.created_at
  }));
  
  // Your admin's EXACT expected response format
  res.json({
    totalPreorders: rows.length,
    items: rows.map(item => ({
      title: item.productName || "Unknown Product",
      user: item.name || item.email || "Anonymous",
      date: item.created_at,
      email: item.email,
      message: item.message || "",
      productId: item.productId
    }))
  });
});


const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
