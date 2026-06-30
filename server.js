const dns = require('dns');
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const http = require('http');
const { Server } = require('socket.io');
const app = express();
const server = http.createServer(app);

require('dotenv').config();

// Windows: Node's DNS can fail mongodb+srv SRV lookups while nslookup works.
// Keep this override Windows-only so Linux production environments use platform DNS.
if (process.platform === 'win32' && process.env.USE_PUBLIC_DNS_FOR_MONGODB !== 'false') {
  const servers = process.env.MONGODB_DNS_SERVERS
    ? process.env.MONGODB_DNS_SERVERS.split(',').map((s) => s.trim()).filter(Boolean)
    : ['8.8.8.8', '1.1.1.1'];
  if (servers.length) dns.setServers(servers);
}

app.use(cors());
app.use(express.json());

const adminRoutes = require('./routes/admin');
const userRoutes = require('./routes/users');
const salesRoutes = require('./routes/sales');
const managerTeamRoutes = require('./routes/managerTeam');
const tripRoutes = require('./routes/trips');
const serviceRoutes = require('./routes/service');
const financeRoutes = require('./routes/finance');
const chatRoutes = require('./routes/chat');
const reportRoutes = require('./routes/report');
const {
  salesQuotationRoutes,
  managerQuotationRoutes,
  serviceQuotationRoutes,
} = require('./routes/quotations');
const { salesEnquiryRoutes, managerEnquiryRoutes } = require('./routes/enquiries');
const User = require('./models/users');
const { initializeChatSocket } = require('./sockets/chatSocket');

app.use('/api/admin', adminRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/users', userRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/sales/quotations', salesQuotationRoutes);
app.use('/api/sales/enquiries', salesEnquiryRoutes);
app.use('/api/manager', managerTeamRoutes);
app.use('/api/manager/quotations', managerQuotationRoutes);
app.use('/api/manager/enquiries', managerEnquiryRoutes);
app.use('/api/trips', tripRoutes);
app.use('/api/service/quotations', serviceQuotationRoutes);
app.use('/api/service', serviceRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/reports', reportRoutes);

const io = new Server(server, {
  cors: {
    origin: true,
    credentials: true,
  },
});
app.set('io', io);
initializeChatSocket(io);

async function connectDB() {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is not set');
  }

  await mongoose.connect(process.env.MONGODB_URI);
  await User.updateMany(
    {
      designation: { $in: ['manager', 'sales'] },
      $or: [{ company: { $exists: false } }, { company: null }, { company: '' }],
    },
    { $set: { company: 'Petrotek' } }
  );
  console.log('MongoDB Connected');
}

async function startServer() {
  const PORT = process.env.PORT || 5000;
  try {
    await connectDB();
    server.listen(PORT, () => {
      console.log(`Server is running on port http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Startup failed:', err);
    process.exit(1);
  }
}

startServer();