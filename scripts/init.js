// Infrastructure only: initiate a new set once; never force or reconfigure it.
const options = 'directConnection=true&serverSelectionTimeoutMS=3000&connectTimeoutMS=2000&socketTimeoutMS=6000&retryWrites=false&retryReads=false';
try {
  const admin = new Mongo('mongodb://mongo1:27017/?' + options).getDB('admin');
  try {
    const existing = admin.runCommand({replSetGetStatus: 1});
    if (existing.ok !== 1) throw Object.assign(new Error(existing.errmsg), existing);
    if (existing.set !== 'rs0') throw new Error('Unexpected replica set; inspect the existing volumes.');
  } catch (error) {
    if (error.code !== 94) throw error; // NotYetInitialized
    const result = admin.runCommand({replSetInitiate: {
      _id: 'rs0', members: [
        {_id: 0, host: 'mongo1:27017'},
        {_id: 1, host: 'mongo2:27017'},
        {_id: 2, host: 'mongo3:27017'}
      ]
    }});
    if (result.ok !== 1) throw Object.assign(new Error(result.errmsg), result);
  }
  const deadline = Date.now() + 60000;
  let ready = false;
  while (Date.now() < deadline) {
    const status = admin.runCommand({replSetGetStatus: 1});
    if (status.ok !== 1) throw Object.assign(new Error(status.errmsg), status);
    const members = status.members || [];
    ready = members.length === 3 && members.every(m => m.health === 1) &&
      members.filter(m => m.state === 1).length === 1 &&
      members.filter(m => m.state === 2).length === 2;
    if (ready) break;
    sleep(500);
  }
  if (!ready) throw new Error('Set not ready within 60 seconds. Run status and inspect container logs.');
  print(EJSON.stringify({outcome: 'Ready', replicaSet: 'rs0', at: new Date().toISOString()}));
} catch (error) {
  print(EJSON.stringify({outcome: 'SetupFailed', code: error.code ?? null,
    codeName: error.codeName ?? null, message: error.message}));
  quit(1);
}
