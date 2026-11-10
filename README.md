# MobilityTicketing: Lecture 10 starter

A local MongoDB 8.0 replica set with three voting, data-bearing members. The
lecture page contains the tasks. This README supplies setup, commands and the
student editing surface. No earlier lecture implementation is needed.

## Start

Install Docker with Docker Compose v2. Use a Bash terminal: Terminal on macOS or
Linux, or WSL with Docker Desktop on Windows. Run commands from this
directory. Check that Docker is running before starting:

```sh
docker compose version
docker info
bash run.sh up
bash run.sh status
```

`up` starts the services, initializes `rs0` only if needed, and waits for one
primary and two secondaries. Existing data is preserved. Initial image download
and first startup can take a little time.

| Service | Purpose |
| --- | --- |
| `mongo1`, `mongo2`, `mongo3` | Replica-set members, each with its own data volume |
| `client` | Runs the supplied `mongosh` scripts inside the Docker network |

The project is named `mobility-lecture10`. Member addresses such as
`mongo2:27017` resolve **inside the Docker network**. No database ports are
published to your computer. This isolated teaching setup has no authentication;
do not expose its services. All members run on one computer, so the experiments
do not demonstrate survival of a host failure or realistic network latency.

## Commands

```sh
bash run.sh write BASE-MAJ majority
bash run.sh read BASE-MAJ primary
bash run.sh read BASE-MAJ secondary
bash run.sh status mongo2
```

| Command | Effect |
| --- | --- |
| `bash run.sh up` | Start all services and wait for a healthy three-member set |
| `bash run.sh status [member]` | Contact that member directly; defaults to `mongo1` |
| `bash run.sh write ID majority` | Insert one notice and request majority acknowledgement |
| `bash run.sh write ID 1` | Insert one notice and request acknowledgement from the primary |
| `bash run.sh write ID 3` | Insert one notice and request acknowledgement from all three members |
| `bash run.sh read ID primary` | Read from the selected primary, with `local` read concern |
| `bash run.sh read ID secondary` | Read from an eligible secondary, with `local` read concern; no primary fallback |
| `bash run.sh verify ID [ID...]` | Read each ID from a primary with `majority` read concern, then call your comparison function |
| `bash run.sh check` | Run pure-function checks against your comparison function; no database access |
| `bash run.sh down` | Stop/remove the containers and network, preserving database volumes |

Each write inserts this immutable synthetic cancellation notice in
`mobility_lab10.trip_changes`, substituting your ID:

```js
{ _id: 'BASE-MAJ', tripId: 'T102', status: 'Cancelled', sourceVersion: 2 }
```

The notice is test data. It does not cancel a trip in another database, create a
booking or take payment. `_id` is unique. Use a fresh ID for each independent
trial, such as `BASE-MAJ-02`. Reuse an ID only when inspecting or retrying the
same logical request. An insert with an existing ID returns a duplicate-key
error; that error alone does not compare the stored contents with your intent.

## Output and timing

Commands print JSON with the operation ID, read preference/concern, write
concern, timestamps, duration and actual outcome or error. Save the output and
your prediction in `docs/evidence.md`, for example:

```sh
bash run.sh write BASE-MAJ-02 majority > docs/base-majority.json
bash run.sh read BASE-MAJ-02 secondary > docs/base-secondary.json
```

The client uses three seeds, `retryWrites=false`, `retryReads=false`, a 3,000 ms
server-selection timeout, a 2,000 ms connection timeout and a 6,000 ms socket
timeout. Writes use `wtimeout: 2000`; reads use `maxTimeMS: 2000`. These limits
cover different parts of an attempt. Their values are not an exact deadline for
the complete shell command, and JSON duration excludes starting `mongosh`.
Retries are disabled so you can observe individual application attempts.

- `Acknowledged`: the requested write acknowledgement was received.
- `UnknownWriteOutcome`: an error or acknowledgement timeout left the requested
  outcome unconfirmed. Inspect the error and verify the same ID later.
- `RejectedWrite`: MongoDB reported a write error, such as a duplicate key.
- `Present` / `AbsentAtRead`: a normal read succeeded and did/did not return a document.
- `UnknownReadFailure`: no successful read result was obtained. This is not evidence of absence.

The raw write response includes `writeErrors` or `writeConcernError` when
returned by MongoDB. Error objects retain available codes, code names and
messages. Write errors, read failures and comparison-code errors exit nonzero.
Matching, conflicting and absent verification results are successful observations;
read their outcome labels. The output reports the requested
read preference, not an independently guessed serving member.

### An acknowledgement timeout

In the lecture's primary-outage experiment, keep the original primary stopped
after a replacement has been elected. Query a running member with `status` to
confirm that the two remaining members have a primary, then run:

```sh
bash run.sh write ACK-ALL 3
bash run.sh read ACK-ALL primary
```

Two running members cannot supply three acknowledgements, so the write should
report a write concern timeout. The document may still have been inserted. Keep
both the actual write error and the read result. After implementing the
comparison function, inspect the same operation without writing again:

```sh
bash run.sh verify ACK-ALL
```

Restart the member you actually stopped using `docker compose start` followed
by its service name, then run `bash run.sh up` to wait for recovery. Do not infer
“nothing was written” from the timeout. Use a new ID if repeating this as a
separate experiment.

## Your file

Implement `compareChange(actual, expected)` in `scripts/verify.js`. `actual` is
either a document from a successful query or `null`. Compare `_id`, `tripId`,
`status` and `sourceVersion`, returning exactly one of:

| Return value | Meaning |
| --- | --- |
| `PresentMatches` | All four expected fields match |
| `PresentConflicts` | A document was found, but at least one field differs or is missing |
| `AbsentAtVerification` | This successful query returned no document |

Do not connect to MongoDB, retry or write inside this function. The supplied
wrapper handles read failures separately as `UnknownReadFailure`; it calls your
function only after a successful read. A failed query remains unknown even
while your function contains its initial TODO. Verification is read-only, and
absence at this observation is not proof that a timed-out write can never appear.

In the no-primary experiment, run `bash run.sh verify BASE-MAJ` **before**
restoring the stopped members. Once the set has no primary, this should report
`UnknownReadFailure` and exit nonzero, even with your comparison function's TODO
untouched. Save that failed-read result separately from a later successful
verification.

```sh
bash run.sh check
bash run.sh verify BASE-MAJ ACK-ALL
```

The seven supplied checks use synthetic values and fail until you implement the
function. They test absence, a match, differences in each of the four fields and
a missing version. Passing them does not test replication or prove an
application's retry policy is correct. `VerificationCodeError` means your
function threw an error or returned an unsupported label.

Keep `compose.yaml`, `run.sh` and the other supplied scripts unchanged. Put
observations and your application policy in `docs/evidence.md`.

## Stop and recover

Control the member named in your experiment using its actual service name:

```sh
docker compose stop mongo2
docker compose start mongo2
bash run.sh status mongo1
```

When the default `mongo1` is stopped, query a running member directly:

```sh
bash run.sh status mongo2
```

This works without a primary and reports that member's view of the set. Wait
for state changes before interpreting the next experiment. One surviving
member cannot elect a primary in this three-voter configuration. Restore stopped
members and wait for the set to recover:

```sh
docker compose start mongo1 mongo2 mongo3
bash run.sh up
```

If startup fails, inspect `docker compose ps` and `docker compose logs mongo1
mongo2 mongo3`. Do not force a reconfiguration or delete volumes to make an
outage experiment pass. Finish with `bash run.sh down`. Run `bash run.sh up` to
continue later with the same data. Do not add `-v` to `docker compose down` unless
you deliberately intend to erase the lab's data.
