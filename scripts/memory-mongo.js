// Boots an in-memory MongoDB for local verification of the Mongo code path.
// Prints the URI and keeps running until killed; used with the second dev
// instance (MONGODB_URI=... next dev -p 3200).
const { MongoMemoryServer } = require('mongodb-memory-server');

(async () => {
  const mongod = await MongoMemoryServer.create({
    instance: { port: 4310, dbName: 'rootchain' },
  });
  const uri = mongod.getUri('rootchain');
  console.log('MONGO_URI=' + uri);
  console.log('ready — press Ctrl+C or kill to stop');
  setInterval(() => {}, 60000);
})().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
