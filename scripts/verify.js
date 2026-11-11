// Your implementation. This function receives only successful query results.
// actual is a document or null; expected contains the four fields below.
// Return exactly: PresentMatches, PresentConflicts, or AbsentAtVerification.
// Compare _id, tripId, status and sourceVersion. Do not query or write here.
function compareChange(actual, expected) {
  // A successful query that returned nothing. This is not the same as a query
  // that failed: the supplied wrapper reports that case as UnknownReadFailure
  // and never calls this function.
  if (actual === null || actual === undefined) {
    return 'AbsentAtVerification';
  }

  // A field that is absent from the document reads as undefined and therefore
  // differs from the expected value, which is what the supplied check for a
  // missing sourceVersion requires.
  for (const field of ['_id', 'tripId', 'status', 'sourceVersion']) {
    if (actual[field] !== expected[field]) {
      return 'PresentConflicts';
    }
  }

  return 'PresentMatches';
}
