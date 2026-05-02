const dns = require('dns');
const mongoose = require('mongoose');

require('dotenv').config();

const DAILY_SALES_COLLECTION = 'dailysales';

if (process.env.USE_PUBLIC_DNS_FOR_MONGODB !== 'false') {
  const servers = process.env.MONGODB_DNS_SERVERS
    ? process.env.MONGODB_DNS_SERVERS.split(',').map((s) => s.trim()).filter(Boolean)
    : ['8.8.8.8', '1.1.1.1'];
  if (servers.length) dns.setServers(servers);
}

function isOldDailySaleUniqueIndex(index) {
  const key = index?.key || {};
  return (
    index?.unique === true &&
    key.salesUserId === 1 &&
    key.saleDate === 1 &&
    Object.keys(key).length === 2
  );
}

async function main() {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is required');
  }

  await mongoose.connect(process.env.MONGODB_URI);
  const collection = mongoose.connection.collection(DAILY_SALES_COLLECTION);
  const indexes = await collection.indexes();
  const oldIndexes = indexes.filter(isOldDailySaleUniqueIndex);

  if (oldIndexes.length === 0) {
    console.log('No old unique DailySale index found.');
  } else {
    for (const index of oldIndexes) {
      console.log(`Dropping old unique DailySale index: ${index.name}`);
      await collection.dropIndex(index.name);
    }
  }

  await collection.createIndex(
    { salesUserId: 1, saleDate: -1 },
    { name: 'salesUserId_1_saleDate_-1' }
  );
  await collection.createIndex(
    { salesUserId: 1, saleDate: 1, entryKind: 1 },
    {
      unique: true,
      partialFilterExpression: { entryKind: 'manager' },
      name: 'manager_daily_sale_unique',
    }
  );
  console.log('DailySale now allows multiple sales logs per user per date.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
