# Lecture 10 evidence

## Experiments

Use a new ID for each independent trial. Keep the same ID when inspecting or
retrying the same logical request. Save the full JSON beside these notes.

| Member state | Action | Operation ID | Read/write settings | Prediction | Actual result / saved output |
| --- | --- | --- | --- | --- | --- |
| Three members, mongo1 PRIMARY | write | BASE-MAJ | `w: majority`, `wtimeout 2000` | Acknowledged. A majority of three voters is two, so the primary plus one secondary | `Acknowledged`, `n: 1`, 150 ms, term 1. `docs/t1-write-base-maj.json` |
| Three members, mongo1 PRIMARY | write | BASE-ONE | `w: 1`, `wtimeout 2000` | Acknowledged by the primary alone; no secondary need have seen it | `Acknowledged`, `n: 1`, 122 ms. `docs/t1-write-base-one.json` |
| Three members, mongo1 PRIMARY | read | BASE-MAJ | `readPreference primary`, `readConcern local` | Present, with the four expected fields | `Present`, 120 ms. `docs/t1-read-base-maj-primary.json` |
| Three members, mongo1 PRIMARY | read | BASE-MAJ | `readPreference secondary`, `readConcern local` | Present, the identical document. A few bytes between containers on one host replicate long before the read | `Present`, identical document, 280 ms. `docs/t1-read-base-maj-secondary.json` |
| mongo1 stopped gracefully (3.2 s); mongo2 PRIMARY, mongo3 SECONDARY | read | BASE-MAJ | `readPreference secondary` | Present. At least one secondary always remains | `Present`, 130 ms. `docs/t2-read-base-maj-secondary.json` |
| mongo1 stopped | write | FAILOVER-01 | `w: majority` | Acknowledged, but with a raised duration while the client waits for a new primary | **Prediction wrong on the wait:** `Acknowledged` in 134 ms, no wait at all. `electionId ...0002` and term 2 show the election had already finished inside the 3.2 s shutdown. `docs/t2-write-failover-01.json` |
| mongo1 stopped | status | — | direct connection to mongo2, `nearest` | mongo1 unreachable; one of the other two is now PRIMARY | `StatusRead`: mongo1 `health 0`, `(not reachable/healthy)`, `optimeDate` at the epoch; mongo2 PRIMARY; mongo3 SECONDARY. `docs/t2-status-mongo2.json` |
| mongo1 stopped, mongo2 PRIMARY | write | FAILOVER-02 | `w: majority` | Acknowledged at normal speed; two running members are still a majority | `Acknowledged`, 109 ms, still term 2. `docs/t2-write-failover-02.json` |
| mongo1 stopped, two members running | write | ACK-ALL | `w: 3`, `wtimeout 2000` | UnknownWriteOutcome after roughly 2 100 ms with code 64, but the document is inserted all the same | `UnknownWriteOutcome`, 2134 ms, code 64 `WriteConcernFailed`, `errInfo.wtimeout true`, and **`"n": 1` inside the error response itself**. `docs/t2-write-ack-all.json` |
| mongo1 stopped, two members running | read | ACK-ALL | `readPreference primary`, `readConcern local` | Present. The timeout concerned the acknowledgement, not the insert | `Present`, 135 ms. `docs/t2-read-ack-all-primary.json` |
| mongo1 restarted, three members healthy | status | — | default member mongo1 | mongo2 keeps the primary role; mongo1 returns as a secondary | `StatusRead`: mongo2 PRIMARY, mongo1 and mongo3 SECONDARY. No failback to the original primary. `docs/t2-status-recovered.json` |
| mongo1 and mongo3 stopped; only mongo2 left | status | — | direct connection to mongo2 | mongo2 steps down once it cannot reach a majority. I expected to catch it still PRIMARY for about ten seconds | **Prediction wrong on the timing:** already SECONDARY at the first attempt. The graceful stop let the departing members announce themselves, so no election timeout had to expire. `optimeDate` frozen at 11:23:05. `docs/t3-status-no-primary.json` |
| No primary; only mongo2 running | read | BASE-MAJ | `readPreference primary`, `readConcern local` | UnknownReadFailure after roughly 3 100 ms | `UnknownReadFailure`, 3136 ms. Message `getaddrinfo EAI_AGAIN mongo1`, a Docker name-resolution symptom rather than a topology message. `docs/t3-read-base-maj-primary.json` |
| No primary; only mongo2 running | read | BASE-MAJ | `readPreference secondary`, `readConcern local` | Present. mongo2 holds the data and is an eligible secondary | `Present`, 140 ms, identical document. `docs/t3-read-base-maj-secondary.json` |
| No primary; only mongo2 running | write | NO-MAJ-ONE | `w: 1` | UnknownWriteOutcome. A write needs a primary whatever `w` says | `UnknownWriteOutcome`, 3111 ms, same message. `docs/t3-write-no-maj-one.json` |
| No primary; only mongo2 running | write | NO-MAJ-MAJ | `w: majority` | Identical to the previous row in outcome, error and duration | `UnknownWriteOutcome`, 3108 ms, identical message. `docs/t3-write-no-maj-maj.json` |
| No primary; only mongo2 running | verify | BASE-MAJ | `readPreference primary`, `readConcern majority` | UnknownReadFailure, and `compareChange` is never called, so its untouched TODO never throws | `UnknownReadFailure`, 3087 ms. `docs/t3-verify-base-maj-no-primary.json` |
| All three restored | status | — | default member mongo1 | One primary and two secondaries | `StatusRead`, mongo2 PRIMARY, mongo1 and mongo3 SECONDARY. `docs/t4-status-recovered.json` |
| All three restored | check | — | no database access at all | Seven passes once `compareChange` is implemented | `{"passed":7,"failed":0}` with exit status 0, and the seven test names match the seven cases in `scripts/check.js` with none skipped. `docker compose exec client cat /lab/scripts/verify.js` confirmed that the container reads the edited file rather than the original stub |
| All three restored | write | RECOVERED-01 | `w: majority` | Acknowledged | `Acknowledged`, 126 ms, `electionId ...0003` and **term 3**: a third election ran when the two members rejoined, and mongo2 won it again. `docs/t4-write-recovered-01.json` |

### What the experiments establish

**Both reads returning the same notice establishes that the copy had arrived by the time it was read, and nothing more.** It is one observation at one moment, not a guarantee about the mechanism. `w: "majority"` promises that a majority of the members hold the write, which here means the primary and one secondary. It does not promise that the particular secondary the next read lands on is one of them. With three members a read can be served by the third, and a secondary can therefore still be behind on another occasion. All three members also run on one computer here, with no network latency and a document of a few bytes, so this setup is close to the best case for replication speed.

**A graceful shutdown is not a crash, and that caught me out twice.** `docker compose stop` sends a termination signal and waits, 3.2 seconds in both cases. A primary that is shutting down steps down and asks the others to hold an election at once, and departing members announce themselves rather than falling silent. That is why `FAILOVER-01` saw no wait, and why mongo2 had already stepped down at the first status query instead of waiting ten seconds for an election timeout. An abrupt loss of a member would look different, and nothing in this log measures that case.

**The acknowledgement timeout is not proof that nothing was stored, and the evidence is inside the error.** `ACK-ALL` asked three members for acknowledgement while two were running, so the third acknowledgement could never arrive and the wait expired after 2 000 ms. The response carrying that error also carries `"n": 1`, which records that the primary applied the insert, and only the requirement we attached to it went unmet. The output does not say how many acknowledgements arrived before the deadline, so it does not establish that the document had reached the running secondary at that moment; the later verification with `majority` read concern shows that a majority holds it now, which is a separate observation at a later time. The later read found the document, and so did the verification after recovery. Treating the timeout as a failure would mean refusing a cancellation that is in the database.

**Changing `w` cannot help when there is no primary, and the two writes prove it by being indistinguishable.** `NO-MAJ-ONE` with `w: 1` and `NO-MAJ-MAJ` with `w: majority` produced the same outcome, the same error and durations 3 ms apart. `w` describes how many members must acknowledge a write *after* a primary has accepted it. With no primary to accept it, `w` is never reached, and the client simply fails to find a writable server within its 3 000 ms selection window.

**Reads and writes part company exactly here.** With only mongo2 left, the same document was unreadable with `readPreference primary` and readable in 140 ms with `readPreference secondary`. The data never moved; only the rule about which member may serve it changed. Writes have no such alternative, because there is only ever one member allowed to accept them.

**A note on the error text.** All three no-primary failures reported `getaddrinfo EAI_AGAIN mongo1` rather than anything about topology. Stopping a container removes its name from Docker's internal name resolution, so the client could not even resolve two of its three seeds. The durations, clustered between 3 087 and 3 136 ms, show that the 3 000 ms server-selection window is what actually governed the attempts. In a deployment where the hosts still resolve, the message would read differently; the outcome would not.

## Read-only verification

| Operation ID | Earlier write outcome | Verification result | What this establishes / leaves uncertain |
| --- | --- | --- | --- |
| BASE-MAJ | `Acknowledged`, `w: majority` | `PresentMatches` | Stored with all four fields intact. The uneventful case the others are measured against |
| BASE-ONE | `Acknowledged`, `w: 1` | `PresentMatches` | A write acknowledged by the primary alone also survived. It was never at risk in this run, because no member was lost while the primary held the only copy; that is the case `w: 1` would lose |
| FAILOVER-01 | `Acknowledged`, `w: majority`, written to a primary elected moments earlier | `PresentMatches` | The handover lost nothing. The new primary in term 2 serves the same data as the old one in term 1 |
| FAILOVER-02 | `Acknowledged`, `w: majority` | `PresentMatches` | Two running members out of three remained a working majority |
| ACK-ALL | **`UnknownWriteOutcome`**, code 64 `WriteConcernFailed` after 2 134 ms | **`PresentMatches`** | The write reported an error and the notice is stored anyway, complete and correct. An application that treated the timeout as a failure would be wrong about its own data |
| NO-MAJ-ONE | `UnknownWriteOutcome`, no primary, 3 111 ms | `AbsentAtVerification` | Also unknown at the time, and this one really is absent. The same label on the write covers both this row and ACK-ALL |
| NO-MAJ-MAJ | `UnknownWriteOutcome`, no primary, 3 108 ms | `AbsentAtVerification` | Identical to the row above, including the duration to within 3 ms |
| RECOVERED-01 | `Acknowledged`, `w: majority`, written after recovery | `PresentMatches` | The set accepts writes again, in term 3 |
| NEVER-SENT | Never attempted | `AbsentAtVerification` | The control. Indistinguishable from NO-MAJ-ONE and NO-MAJ-MAJ |

### What the verification shows

**ACK-ALL against NO-MAJ-ONE is the comparison that matters.** Both reported `UnknownWriteOutcome` to the client, and they differ in the only way that counts: one is in the database with all four fields correct, the other is not there at all. The label is honest about this — it says the outcome is unknown, not that the write failed — and only a later read resolves which it was. An application that records "write failed" on that label is recording something it never observed.

**NEVER-SENT against NO-MAJ-ONE shows the opposite limit.** Both verify as `AbsentAtVerification`, yet one was never sent and the other was sent and lost. Verification reports what is in the database now; it cannot reconstruct what was attempted. Knowing that a request was ever made must come from the client's own record of having made it, which is exactly what a request ID is for.

**`UnknownReadFailure` is a third outcome again, and the no-primary run proves it is kept separate.** `verify BASE-MAJ` with no primary returned `UnknownReadFailure` after 3 087 ms, not `AbsentAtVerification`, and `compareChange` was never called — the supplied wrapper invokes it only after a successful read, which is why the untouched TODO never threw. That separation is the most important property of the design: a database that could not answer must never be reported as a database that answered "no". `BASE-MAJ` was present in the database throughout that failed read.

**What verification does not establish.** It is one read at one moment, taken from a primary with `majority` read concern, so it reports what a majority had committed at that instant. An absent result is not a promise that a timed-out write can never appear afterwards, and the README says as much. Nothing here was re-verified after a further delay.

## Application policy

| Operation | Freshness/consistency needed | During an outage | What the user sees | After recovery | Reason / evidence |
| --- | --- | --- | --- | --- | --- |
| Journey search | A recent copy is enough. The answer is advisory and commits nothing, so a notice a few seconds old is far more useful than no answer at all | Keep serving. Read with `secondaryPreferred` rather than `primary`, so any surviving member can answer. No writes are involved | Results, stamped with the time the copy was last updated, and a line saying a departure may have changed since | Nothing to replay. The copy catches up on its own once replication resumes | Measured here: with only mongo2 left, `readPreference primary` failed after 3 136 ms while `readPreference secondary` returned the identical document in 140 ms. The data was available throughout; only the rule about which member may serve it differed. Insisting on the primary would turn a working search into a three-second failure and buy nothing |
| Ticket purchase | The authoritative current state. It decides whether a seat exists and it takes money, so a copy is not an acceptable basis | Refuse. Do not accept a purchase against the copy and do not record a provisional booking that may later conflict. Every attempt carries a request ID so a repeat can be recognised as the same request | A plain refusal saying that purchase is temporarily unavailable — explicitly **not** that the departure is sold out. Only one of those two is known | The client retries the same request ID and the server resolves whether the earlier attempt landed. Nothing is concluded from the timeout itself | ACK-ALL and NO-MAJ-ONE both returned `UnknownWriteOutcome`; one is stored and one is not. A purchase flow that read that label as failure would either refuse a purchase that went through, or retry blindly and create a second one. The request ID is what makes the retry safe |
| Reporting | Internally consistent over a defined period rather than current to the second. Figures that are confirmed matter more than figures that are fresh | Keep running, read-only, with `majority` read concern so only committed data is counted, and `secondaryPreferred` so a missing primary does not stop it. Never write | The report, labelled with the point in time it reflects and a note that figures may be revised | Re-run the affected period rather than patching individual numbers. Nothing to replay | `majority` read concern is what the verification used, and it reports only what a majority has committed, unlike the `local` reads used elsewhere in this log. Pairing it with `secondaryPreferred` is a recommendation rather than a measurement: the supplied `verify` hard-codes `primary` with `majority`, and that combination failed after 3 087 ms with no primary available |

### What backs these choices

Only the journey-search row rests on something measured here, and even that needs one qualification. The two reads of `BASE-MAJ` with no primary available differ in nothing but the read preference, and they differ in outcome completely, which settles the question of whether a search should insist on the primary. What was run was `secondary`, not the `secondaryPreferred` the row recommends. The two differ only in that `secondaryPreferred` falls back to the primary when no secondary is eligible, which would have changed nothing in this run and is the safer default in normal operation, but it was not the mode under test.

The ticket-purchase row borrows its evidence by analogy. PostgreSQL owns the real booking decisions in MobilityTicketing, and nothing here tested a purchase. What the lab does establish is narrower and still decisive for the design: a client that sees an unknown outcome has learned nothing about whether its write landed, because the same label covered a stored notice and an absent one. A purchase flow therefore needs a request ID and a resolution step, not an interpretation of the error.

The reporting row is partly reasoned rather than measured. The pairing of `majority` read concern with `secondaryPreferred` was never run, because `verify` fixes the read preference to `primary`. What was measured is that this fixed combination becomes unavailable the moment the set loses its primary, and that reads which accept a secondary stayed available in the same conditions.

One limit applies to all three rows. Every member here runs on one computer with no network latency and a four-field document, which is close to the best case for replication. A deployment spread across sites would widen the gap between a primary read and a secondary read, and the journey-search row is the one whose trade-off would change most.

## AI second opinion

- **Prompt and model:** ChatGPT, free tier; the interface showed no version number. The prompt is reproduced verbatim below, with the two long JSON blocks replaced by the names of the files that hold them. It supplied the comparison function, the contract it must satisfy, a list of the seven supplied checks with a request not to restate them, the ACK-ALL write and the read that followed it, and my written interpretation of that pair. It asked the model to pick exactly one of two tasks and answer only that one.
- **Suggested claim or experiment:** The model chose task (a), a defect in the function, and argued that this was the more useful choice because it is a deterministic correctness bug independent of replica-set timing. Its case: two separately constructed `ObjectId` instances holding the same value are not strictly equal, because `===` compares object references rather than contents, so `compareChange` returns `PresentConflicts` for two semantically identical documents. It proposed comparing `_id` with `actual._id.equals(expected._id)`.
- **My prediction:** The claim about JavaScript is true and a direct probe would show `sameValue: true`, `strictEqual: false` and `compareChange: PresentConflicts`. But the case cannot arise in this lab, and applying the suggestion literally would break the function for the documents the lab does produce, because a string has no `.equals` method and the call would throw a `TypeError`, which `runner.js` reports as `VerificationCodeError`.
- **Actual output:** Both predictions held exactly. The first probe returned `{"sameValue":true,"strictEqual":false,"compareChange":"PresentConflicts"}`, saved as `docs/t5-ai-objectid-probe.json`. The second built the suggested `.equals()` version inside a one-off command, without touching `scripts/verify.js`, and ran it against both kinds of `_id`: `{"stringId":"threw: actual._id.equals is not a function","objectId":"PresentMatches"}`, saved as `docs/t5-ai-equals-probe.json`.
- **Decision and remaining uncertainty:** The observation is accepted and the change is rejected. `run.sh` validates every operation ID against `^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$` and passes it on as text; `runner.js` builds both the inserted document and the `expected` object from that same string; nothing else writes to `mobility_lab10.trip_changes`; and every document in `docs/t4-verify-all.json` carries a string `_id`. An `ObjectId` cannot reach this function. Meanwhile the literal change would make six of the seven supplied checks throw, since only the `null` case returns before touching `_id`. A type-aware version that tested for an `.equals` method first would work both ways, but it would add code for a case this system cannot produce, and the README asks for a comparison of the four fields and nothing more. `scripts/verify.js` is therefore unchanged, and `bash run.sh check` still reports seven passes. What remains uncertain: the model did not take task (b), so my reading of the ACK-ALL result went unchallenged by it. I found the weak claim in it myself while assembling the prompt — the words "replicated to the running secondary" are not supported by that output — and the sentence above has been corrected. Whether the document had in fact reached the secondary at the moment the deadline expired is still unmeasured, and nothing here tests it.

### The prompt as sent

    Review a small comparison function and one interpretation from a MongoDB 8.0 replica-set lab.

    The replica set has three voting, data-bearing members called mongo1, mongo2 and mongo3, all on one machine. Clients use retryWrites=false, retryReads=false, a 3000 ms server-selection timeout, and wtimeout: 2000 on writes.

    A supplied wrapper performs the database read and then calls my function. The wrapper handles failures itself: if the read does not succeed it reports UnknownReadFailure and never calls my function. My function must not connect, query, retry or write, and must return exactly one of PresentMatches, PresentConflicts or AbsentAtVerification.

    Here is my function:

    [the contents of scripts/verify.js]

    It passes the seven supplied checks. They use the expected document {_id: 'CHECK', tripId: 'T102', status: 'Cancelled', sourceVersion: 2} and cover: a null actual, an exact match, a different _id, a different tripId, a different status, a different sourceVersion, and a document with sourceVersion missing entirely. Please do not restate those seven.

    Here is one experiment. mongo1 had been stopped, so two of the three members were running. The write asked for acknowledgement from all three:

    [the contents of docs/t2-write-ack-all.json]

    Six seconds later, reading the same ID from the primary with local read concern:

    [the contents of docs/t2-read-ack-all-primary.json]

    My written interpretation of that experiment is:

    "The insert succeeded on the primary and replicated to the running secondary; only the requirement we attached to it went unmet. The label UnknownWriteOutcome therefore means the outcome is unknown to the client, not that the write failed, and only a later read can resolve it."

    Choose exactly one of the following and answer only that one:

    (a) Name one case my comparison function gets wrong or fails to distinguish, which the seven supplied checks do not cover. Give the exact actual and expected values to pass in, state what my function returns for them, and state what it should return instead and why.

    (b) Challenge my interpretation of the ACK-ALL result. Name the specific claim you believe is not supported by the output shown, and give an exact experiment with this three-member set that would decide it, including the output you predict.

    Say which one you chose and why that one is more useful here.

