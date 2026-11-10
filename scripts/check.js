// Pure-function checks only: no connection, database query or write.
load('/lab/scripts/verify.js');
const expected = {_id: 'CHECK', tripId: 'T102', status: 'Cancelled', sourceVersion: 2};
const cases = [
  ['no document', null, 'AbsentAtVerification'],
  ['matching document', {...expected}, 'PresentMatches'],
  ['different ID', {...expected, _id: 'OTHER'}, 'PresentConflicts'],
  ['different trip', {...expected, tripId: 'T999'}, 'PresentConflicts'],
  ['different status', {...expected, status: 'Scheduled'}, 'PresentConflicts'],
  ['different version', {...expected, sourceVersion: 3}, 'PresentConflicts'],
  ['missing version', {_id: 'CHECK', tripId: 'T102', status: 'Cancelled'}, 'PresentConflicts']
];
let failures = 0;
for (const [name, actual, wanted] of cases) {
  try {
    const got = compareChange(actual, expected);
    if (got !== wanted) throw new Error(`Expected ${wanted}, got ${got}`);
    print(JSON.stringify({test: name, outcome: 'Pass'}));
  } catch (error) {
    failures++;
    print(JSON.stringify({test: name, outcome: 'Fail', message: error.message}));
  }
}
print(JSON.stringify({passed: cases.length - failures, failed: failures}));
if (failures) quit(1);
