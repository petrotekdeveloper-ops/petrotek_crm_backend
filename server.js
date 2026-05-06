const dns = require('dns');
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const http = require('http');
const { Server } = require('socket.io');
const app = express();
const server = http.createServer(app);

require('dotenv').config();

// Windows: Node's DNS often fails mongodb+srv SRV lookups (querySrv ECONNREFUSED) while nslookup works.
// Optional override: MONGODB_DNS_SERVERS=8.8.8.8,1.1.1.1  |  set USE_PUBLIC_DNS_FOR_MONGODB=false to skip.
if (process.env.USE_PUBLIC_DNS_FOR_MONGODB !== 'false') {
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
const User = require('./models/users');
const { initializeChatSocket } = require('./sockets/chatSocket');

app.use('/api/admin', adminRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/users', userRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/manager', managerTeamRoutes);
app.use('/api/trips', tripRoutes);
app.use('/api/service', serviceRoutes);
app.use('/api/chat', chatRoutes);

const io = new Server(server, {
  cors: {
    origin: true,
    credentials: true,
  },
});
app.set('io', io);
initializeChatSocket(io);

async function connectDB() {
    try {
      await mongoose.connect(process.env.MONGODB_URI);
      await User.updateMany(
        {
          designation: { $in: ['manager', 'sales'] },
          $or: [{ company: { $exists: false } }, { company: null }, { company: '' }],
        },
        { $set: { company: 'Petrotek' } }
      );
      console.log("MongoDB Connected");
    } catch (err) {
      console.log("Mongo Error:", err);
    }
  }
  
  connectDB();



const PORT = process.env.PORT;
server.listen(PORT, () => {
    console.log(`Server is running on port http://localhost:${PORT}`);
});