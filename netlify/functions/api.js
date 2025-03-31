const express = require('express');
const serverless = require('serverless-http');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');

// MongoDB Connection
const mongoUri = process.env.MONGODB_URI;

// Initialize Express app
const app = express();
app.use(cors());
app.use(bodyParser.json());

// Add a health check route to verify connection
app.get('/healthcheck', async (req, res) => {
  try {
    const status = mongoose.connection.readyState === 1 
      ? 'Connected to MongoDB' 
      : 'MongoDB connection not established';
    res.json({ 
      status: 'ok', 
      mongoStatus: status, 
      connectionString: mongoUri ? 'Configured' : 'Missing'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Define schemas
const clientSchema = new mongoose.Schema({
  name: String,
  address: String,
  phone: String,
  email: String,
  notes: String,
  created_at: { type: Date, default: Date.now },
});

const serveAttemptSchema = new mongoose.Schema({
  client_id: String,
  date: Date,
  time: String,
  status: String,
  notes: String,
  location: String,
  created_at: { type: Date, default: Date.now },
});

const caseSchema = new mongoose.Schema({
  client_id: String,
  case_number: String,
  court: String,
  status: String,
  notes: String,
  created_at: { type: Date, default: Date.now },
});

const documentSchema = new mongoose.Schema({
  case_id: String,
  name: String,
  url: String,
  type: String,
  created_at: { type: Date, default: Date.now },
});

// Create models
const Client = mongoose.model('Client', clientSchema);
const ServeAttempt = mongoose.model('ServeAttempt', serveAttemptSchema);
const Case = mongoose.model('Case', caseSchema);
const Document = mongoose.model('Document', documentSchema);

// Client routes
app.get('/clients', async (req, res) => {
  try {
    const clients = await Client.find().sort({ created_at: -1 });
    res.json(clients);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/clients', async (req, res) => {
  try {
    const client = new Client(req.body);
    await client.save();
    res.status(201).json(client);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/clients/:id', async (req, res) => {
  try {
    const client = await Client.findById(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    res.json(client);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/clients/:id', async (req, res) => {
  try {
    const client = await Client.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!client) return res.status(404).json({ error: 'Client not found' });
    res.json(client);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/clients/:id', async (req, res) => {
  try {
    const client = await Client.findByIdAndDelete(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    res.json({ message: 'Client deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Serve Attempts routes
app.get('/serve-attempts', async (req, res) => {
  try {
    const serveAttempts = await ServeAttempt.find().sort({ created_at: -1 });
    res.json(serveAttempts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/serve-attempts/client/:clientId', async (req, res) => {
  try {
    const serveAttempts = await ServeAttempt.find({ client_id: req.params.clientId }).sort({ date: -1 });
    res.json(serveAttempts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/serve-attempts', async (req, res) => {
  try {
    const serveAttempt = new ServeAttempt(req.body);
    await serveAttempt.save();
    res.status(201).json(serveAttempt);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Cases routes
app.get('/cases', async (req, res) => {
  try {
    const cases = await Case.find().sort({ created_at: -1 });
    res.json(cases);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/cases/client/:clientId', async (req, res) => {
  try {
    const cases = await Case.find({ client_id: req.params.clientId });
    res.json(cases);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/cases', async (req, res) => {
  try {
    const newCase = new Case(req.body);
    await newCase.save();
    res.status(201).json(newCase);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Documents routes
app.get('/documents/case/:caseId', async (req, res) => {
  try {
    const documents = await Document.find({ case_id: req.params.caseId });
    res.json(documents);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/documents', async (req, res) => {
  try {
    const document = new Document(req.body);
    await document.save();
    res.status(201).json(document);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Connect to MongoDB with better error handling
const connectDB = async () => {
  if (mongoose.connection.readyState === 0) {
    try {
      if (!mongoUri) {
        console.error('MONGODB_URI environment variable is not set');
        throw new Error('MongoDB connection string not provided');
      }
      console.log('Connecting to MongoDB...');
      await mongoose.connect(mongoUri, {
        serverSelectionTimeoutMS: 10000,
        socketTimeoutMS: 60000,
      });
      console.log('MongoDB connected successfully');
    } catch (error) {
      console.error('MongoDB connection error:', error);
      throw error;
    }
  }
};

// Serverless handler with better error handling
exports.handler = async (event, context) => {
  try {
    context.callbackWaitsForEmptyEventLoop = false;
    await connectDB();
    return serverless(app)(event, context);
  } catch (error) {
    console.error('Function error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server error', details: error.message }),
    };
  }
};
