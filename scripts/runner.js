const action = process.env.LAB_ACTION;
const ids = (process.env.LAB_IDS || '').split(',');
const setting = process.env.LAB_SETTING;
const member = process.env.LAB_MEMBER;
const timeouts = 'serverSelectionTimeoutMS=3000&connectTimeoutMS=2000&socketTimeoutMS=6000&retryWrites=false&retryReads=false';
const expectedChange = id => ({_id: id, tripId: 'T102', status: 'Cancelled', sourceVersion: 2});
const errorDetails = error => ({code: error.code ?? null, codeName: error.codeName ?? null,
  message: error.message, errorLabels: error.errorLabels || [],
  response: error.errorResponse || error.result || null});
let failed = false;
if (action === 'verify') load('/lab/scripts/verify.js');
for (const id of action === 'status' ? [null] : ids) {
  const started = Date.now();
  const readPreference = action === 'read' ? setting : action === 'status' ? 'nearest' : 'primary';
  const writeConcern = action === 'write' ? {w: setting === 'majority' ? 'majority' : Number(setting), wtimeout: 2000} : null;
  const readConcern = action === 'read' ? 'local' : action === 'verify' ? 'majority' : null;
  const record = {action, operationId: id, startedAt: new Date(started).toISOString(),
    readPreference, readConcern, writeConcern, retryWrites: false, retryReads: false};
  try {
    const uri = action === 'status'
      ? `mongodb://${member}:27017/?directConnection=true&readPreference=nearest&${timeouts}`
      : `mongodb://mongo1:27017,mongo2:27017,mongo3:27017/mobility_lab10?replicaSet=rs0&readPreference=${readPreference}&${timeouts}`;
    const connection = new Mongo(uri); // Inside try: connection failures also become JSON.
    if (action === 'status') {
      const result = connection.getDB('admin').runCommand({replSetGetStatus: 1});
      if (result.ok !== 1) throw Object.assign(new Error(result.errmsg), result);
      record.contactedMember = member;
      record.outcome = 'StatusRead';
      record.members = result.members.map(m => ({name: m.name, state: m.stateStr,
        health: m.health, self: m.self || false, optimeDate: m.optimeDate}));
    } else {
      const database = connection.getDB('mobility_lab10');
      if (action === 'write') {
        const result = database.runCommand({insert: 'trip_changes', documents: [expectedChange(id)],
          ordered: true, writeConcern});
        record.result = result;
        if (result.writeConcernError) {
          record.outcome = 'UnknownWriteOutcome'; failed = true;
        } else if (result.writeErrors && result.writeErrors.length) {
          record.outcome = 'RejectedWrite'; failed = true;
        } else if (result.ok === 1 && result.n === 1) {
          record.outcome = 'Acknowledged';
        } else {
          record.outcome = 'UnknownWriteOutcome'; failed = true;
        }
      } else {
        const rows = database.trip_changes.find({_id: id}).readConcern(readConcern)
          .maxTimeMS(2000).limit(1).toArray();
        const actual = rows.length ? rows[0] : null;
        record.actual = actual;
        if (action === 'verify') {
          try {
            record.outcome = compareChange(actual, expectedChange(id));
            if (!['PresentMatches', 'PresentConflicts', 'AbsentAtVerification'].includes(record.outcome)) {
              throw new Error('compareChange returned an unsupported result.');
            }
            if (record.outcome === 'PresentConflicts') failed = true;
          } catch (error) {
            record.outcome = 'VerificationCodeError'; record.error = errorDetails(error); failed = true;
          }
        } else record.outcome = actual === null ? 'AbsentAtRead' : 'Present';
      }
    }
  } catch (error) {
    record.outcome = action === 'write' ? 'UnknownWriteOutcome' :
      action === 'status' ? 'StatusReadFailed' : 'UnknownReadFailure';
    record.error = errorDetails(error); failed = true;
  }
  record.finishedAt = new Date().toISOString();
  record.durationMs = Date.now() - started;
  print(EJSON.stringify(record));
}
if (failed) quit(1);
