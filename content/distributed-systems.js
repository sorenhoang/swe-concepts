CONTENT["distributed-transactions"] = `
<p class="tldr"><strong>TL;DR</strong>: A distributed transaction makes changes in several databases or services commit together or not at all. The classic protocol is <strong>two-phase commit (2PC)</strong>: a coordinator asks every participant "can you commit?", and only if all say yes does it tell them "commit". It's like a wedding: both people say "I do" before the officiant pronounces them married. If the officiant faints between the vows and the pronouncement, nobody can leave the room. That "stuck until the coordinator comes back" property is why 2PC is used carefully, and why most microservice systems use a <a href="#saga-pattern">saga</a> instead.</p>

<h2>The problem it solves</h2>
<p>Inside one database, a transaction is easy. <code>BEGIN</code>, two <code>UPDATE</code>s, <code>COMMIT</code>, and the database guarantees both updates happen or neither does. That guarantee is tied to <strong>one</strong> database connection, one write-ahead log and one lock manager. It stops at the edge of that database.</p>
<p>Real systems cross that edge all the time:</p>
<ul>
  <li><strong>Money moves between two databases.</strong> Bank A debits Alice, bank B credits Bob. Two databases, two logs.</li>
  <li><strong>A sharded database.</strong> Alice's row is on shard 3, Bob's on shard 11. One <code>UPDATE</code> per shard.</li>
  <li><strong>A service writes to its DB and to a broker.</strong> "Save the order, publish <code>OrderPlaced</code>." That is two systems (the dual-write problem; see <a href="#event-driven-architecture">Event-Driven Architecture</a>).</li>
  <li><strong>Microservices.</strong> Orders, payments and inventory each own their database. Placing an order touches all three.</li>
</ul>
<p>Now do it without coordination and something fails halfway. The debit commits, then the process crashes before the credit. Or the credit fails a constraint check after the debit is already committed. You end up with money that left one account and never arrived. Running the two commits "quickly, one after the other" doesn't help: the gap between them is exactly where a crash, a timeout or a deploy lands.</p>
<p>The goal of a distributed transaction is <strong>atomic commit</strong>: every participant commits, or every participant aborts, even if some of them crash during the process.</p>

<h2>How it works</h2>
<h3>Two-phase commit</h3>
<p>There is one <strong>coordinator</strong> (also called the transaction manager) and several <strong>participants</strong> (resource managers: databases, sometimes queues). The protocol has two rounds:</p>
<ol>
  <li><strong>Prepare (voting).</strong> The coordinator sends <code>PREPARE</code> to every participant. Each one does all the work of the transaction: checks constraints, takes locks, and writes everything it needs to its log and flushes it to disk. Then it votes. <strong>YES</strong> is a promise: "I can commit this later, even if I crash and restart in between." <strong>NO</strong> means it aborts locally.</li>
  <li><strong>Commit (decision).</strong> If every vote is YES, the coordinator decides COMMIT; if any vote is NO or doesn't arrive in time, it decides ABORT. It writes the decision to <strong>its own durable log first</strong>, then sends it to every participant. Participants apply it, release their locks, and acknowledge.</li>
</ol>

<figure class="diagram">
<svg viewBox="0 0 780 400" role="img" aria-label="Sequence diagram of two-phase commit. Phase 1: the coordinator sends PREPARE to bank A and bank B; each locks rows, writes its log and votes YES. The coordinator writes COMMIT to its own log. Phase 2: the coordinator sends COMMIT to both banks, which commit, release locks and acknowledge.">
  <defs><marker id="arr-dt-1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <rect class="box accent" x="60" y="10" width="140" height="34" rx="6"/><text x="130" y="32" text-anchor="middle" class="title">Coordinator</text>
  <rect class="box" x="350" y="10" width="140" height="34" rx="6"/><text x="420" y="32" text-anchor="middle" class="title">Bank A</text>
  <rect class="box" x="610" y="10" width="140" height="34" rx="6"/><text x="680" y="32" text-anchor="middle" class="title">Bank B</text>
  <path class="line dashed" d="M130 44 V395" style="stroke: var(--line)"/>
  <path class="line dashed" d="M420 44 V395" style="stroke: var(--line)"/>
  <path class="line dashed" d="M680 44 V395" style="stroke: var(--line)"/>

  <text x="12" y="70" class="title">Phase 1</text>
  <text x="12" y="86" class="small">prepare</text>
  <path class="line" d="M130 80 H418" marker-end="url(#arr-dt-1)"/><text x="275" y="72" text-anchor="middle" class="small">PREPARE tx1 (debit alice 30)</text>
  <path class="line" d="M130 108 H678" marker-end="url(#arr-dt-1)"/><text x="560" y="100" text-anchor="middle" class="small">PREPARE tx1 (credit bob 30)</text>
  <path class="line ok dashed" d="M420 140 H132" marker-end="url(#arr-dt-1)"/><text x="275" y="132" text-anchor="middle" class="small">YES (locked, logged, fsynced)</text>
  <path class="line ok dashed" d="M680 168 H132" marker-end="url(#arr-dt-1)"/><text x="560" y="160" text-anchor="middle" class="small">YES</text>

  <rect class="box accent" x="40" y="184" width="180" height="32" rx="6"/><text x="130" y="204" text-anchor="middle" class="small">write COMMIT to own log</text>
  <path class="line dashed" d="M20 228 H760" style="stroke: var(--line)"/>
  <text x="440" y="222" class="small">decision is final once logged</text>

  <text x="12" y="256" class="title">Phase 2</text>
  <text x="12" y="272" class="small">commit</text>
  <path class="line accent" d="M130 262 H418" marker-end="url(#arr-dt-1)"/><text x="275" y="254" text-anchor="middle" class="small">COMMIT tx1</text>
  <path class="line accent" d="M130 290 H678" marker-end="url(#arr-dt-1)"/><text x="560" y="282" text-anchor="middle" class="small">COMMIT tx1</text>
  <path class="line dashed" d="M420 322 H132" marker-end="url(#arr-dt-1)"/><text x="275" y="314" text-anchor="middle" class="small">ACK</text>
  <path class="line dashed" d="M680 350 H132" marker-end="url(#arr-dt-1)"/><text x="560" y="342" text-anchor="middle" class="small">ACK</text>
  <rect class="box ok" x="345" y="362" width="150" height="28" rx="6"/><text x="420" y="381" text-anchor="middle" class="small">commit, release locks</text>
  <rect class="box ok" x="605" y="362" width="150" height="28" rx="6"/><text x="680" y="381" text-anchor="middle" class="small">commit, release locks</text>
</svg>
<figcaption>Two round trips and several forced disk writes per transaction. Locks are held from the moment a participant prepares until the decision reaches it.</figcaption>
</figure>

<p>Three rules make it correct, and each one is a common source of bugs when people build it themselves:</p>
<ul>
  <li><strong>A YES vote is irrevocable.</strong> After voting YES, a participant may not abort on its own, even if the coordinator goes silent. Another participant might already have been told COMMIT.</li>
  <li><strong>Before voting, a participant may abort freely.</strong> If it never received <code>PREPARE</code>, or it voted NO, it can roll back on a timeout. Nobody can have committed without its YES.</li>
  <li><strong>The coordinator logs the decision before telling anyone.</strong> If it crashes after sending COMMIT to bank A but before bank B, its log on restart says COMMIT, and it re-sends COMMIT to B. Without that log it might "recover" by aborting, and the banks would disagree forever.</li>
</ul>

<h3>The blocking problem</h3>
<p>The weak spot is the window between a participant's YES and the decision arriving. In that window the participant is <strong>in doubt</strong>: it can't commit (the coordinator may have decided ABORT because someone else voted NO) and it can't abort (the coordinator may have decided COMMIT and told the others). It must keep its locks and wait. If the coordinator crashes in that window, every in-doubt participant blocks until the coordinator comes back.</p>

<figure class="diagram">
<svg viewBox="0 0 780 340" role="img" aria-label="Timeline of a coordinator crash during 2PC. The coordinator collects two YES votes, then crashes and stays down. Bank A and bank B are in doubt for the whole outage: rows locked, unable to commit or abort. Other clients writing those rows wait and time out. When the coordinator restarts and reads its log, it sends the decision and the participants finish and release locks.">
  <defs><marker id="arr-dt-2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <text x="12" y="64" class="title">Coordinator</text>
  <text x="12" y="134" class="title">Bank A</text>
  <text x="12" y="204" class="title">Bank B</text>
  <text x="12" y="268" class="title">Other clients</text>
  <text x="12" y="284" class="small">writing alice/bob</text>

  <path class="line dashed" d="M300 30 V300" style="stroke: var(--line)"/>
  <path class="line dashed" d="M630 30 V300" style="stroke: var(--line)"/>
  <text x="300" y="22" text-anchor="middle" class="small">crash</text>
  <text x="630" y="22" text-anchor="middle" class="small">restart</text>

  <rect class="box ok" x="140" y="44" width="150" height="32" rx="6"/><text x="215" y="64" text-anchor="middle" class="small">prepare, get 2 YES</text>
  <path class="line bad" d="M294 52 L310 68 M310 52 L294 68"/>
  <path class="line bad dashed" d="M318 60 H622"/><text x="470" y="52" text-anchor="middle" class="small">down: no decision in its log</text>
  <rect class="box ok" x="640" y="44" width="125" height="32" rx="6"/><text x="702" y="64" text-anchor="middle" class="small">read log, decide</text>

  <rect class="box" x="140" y="114" width="150" height="32" rx="6"/><text x="215" y="134" text-anchor="middle" class="small">prepare, vote YES</text>
  <rect class="box bad" x="306" y="114" width="318" height="32" rx="6"/><text x="465" y="134" text-anchor="middle">IN DOUBT: rows locked, must wait</text>
  <rect class="box ok" x="640" y="114" width="125" height="32" rx="6"/><text x="702" y="134" text-anchor="middle" class="small">finish, unlock</text>

  <rect class="box" x="140" y="184" width="150" height="32" rx="6"/><text x="215" y="204" text-anchor="middle" class="small">prepare, vote YES</text>
  <rect class="box bad" x="306" y="184" width="318" height="32" rx="6"/><text x="465" y="204" text-anchor="middle">IN DOUBT: rows locked, must wait</text>
  <rect class="box ok" x="640" y="184" width="125" height="32" rx="6"/><text x="702" y="204" text-anchor="middle" class="small">finish, unlock</text>

  <rect class="box bad" x="306" y="254" width="318" height="32" rx="6"/><text x="465" y="274" text-anchor="middle" class="small">UPDATE alice: waits on the lock, then times out</text>
  <rect class="box ok" x="640" y="254" width="125" height="32" rx="6"/><text x="702" y="274" text-anchor="middle" class="small">writes succeed</text>

  <path class="line" d="M140 318 H762" marker-end="url(#arr-dt-2)"/><text x="450" y="334" text-anchor="middle" class="small">time</text>
</svg>
<figcaption>The outage of one process (the coordinator) becomes an outage of every row the in-doubt transactions touched. The participants are healthy, but they are not allowed to decide.</figcaption>
</figure>

<p>Participants can reduce the damage by asking each other (the "cooperative termination" idea): if any participant already received the decision, or any participant never voted YES, the others can safely finish. But when <strong>every</strong> participant voted YES and none heard the decision, only the coordinator knows, and they must wait. Recovery after a restart follows the log:</p>
<ul>
  <li><strong>Decision in the log</strong>: re-send it. Participants must treat a repeated COMMIT or ABORT as a no-op (the decision messages are idempotent).</li>
  <li><strong>No decision in the log</strong>: no participant can have been told COMMIT, so the coordinator decides ABORT. This rule is called <strong>presumed abort</strong>, and it lets the coordinator skip logging aborts entirely.</li>
</ul>

<h3>Three-phase commit (briefly)</h3>
<p>Three-phase commit (Skeen, "Nonblocking Commit Protocols", SIGMOD 1981) inserts a <em>pre-commit</em> round between voting and committing, so that no participant can commit while another is still uncertain. With that extra state, surviving participants can finish without the coordinator. The catch is its assumptions: it is non-blocking only if crashed nodes simply stop and message delays are bounded. With real networks, where a slow node looks exactly like a dead one and <a href="#network-partitions">partitions</a> happen, the two sides of a partition can reach different decisions. It also adds a third round trip. In practice almost nobody ships 3PC. Systems that need non-blocking commit instead make the coordinator itself fault-tolerant by replicating its log with a consensus protocol (Paxos or Raft), as Spanner does.</p>

<h3>XA: 2PC as a standard interface</h3>
<p>The X/Open <strong>XA</strong> standard defines the interface between a transaction manager and resource managers: start a branch, end it, prepare, commit, roll back, and <code>recover</code> (list in-doubt branches after a crash). Databases expose it as SQL:</p>
<pre><code>-- Postgres: needs max_prepared_transactions &gt; 0 (the default is 0).
BEGIN;
UPDATE accounts SET balance = balance - 30 WHERE id = 'alice';
PREPARE TRANSACTION 'transfer-7';   -- phase 1: durable, locks still held
-- ... the transaction manager collects the other votes ...
COMMIT PREPARED 'transfer-7';       -- phase 2 (or ROLLBACK PREPARED)

SELECT gid, prepared FROM pg_prepared_xacts;  -- in-doubt transactions

-- MySQL / InnoDB, same idea:
XA START 'transfer-7';
UPDATE accounts SET balance = balance - 30 WHERE id = 'alice';
XA END 'transfer-7';
XA PREPARE 'transfer-7';
XA COMMIT 'transfer-7';
XA RECOVER;                          -- lists PREPARED transactions</code></pre>
<p>The Postgres docs are blunt: <code>PREPARE TRANSACTION</code> "is not intended for use in applications or interactive sessions"; it exists for an external transaction manager. A forgotten prepared transaction keeps its locks and stops <code>VACUUM</code> from reclaiming storage, which "in extreme cases could cause the database to shut down to prevent transaction ID wraparound". That's why it ships disabled (<code>max_prepared_transactions = 0</code>). Java has had XA support through JTA for a long time; Go's <code>database/sql</code> has no XA API, so in Go you'd issue these statements yourself or, more often, choose a different design.</p>

<h3>How real distributed databases do it</h3>
<ul>
  <li><strong>Google Spanner</strong> runs 2PC across Paxos groups. One participant group's leader acts as the coordinator leader, and "the state of each transaction manager is stored in the underlying Paxos group", so a crashed coordinator is replaced by a new Paxos leader instead of blocking everyone. Timestamps come from <strong>TrueTime</strong>: <code>TT.now()</code> returns an interval <code>[earliest, latest]</code> guaranteed to contain the true time. The coordinator picks a commit timestamp no less than <code>TT.now().latest</code> and then <strong>commit-waits</strong> until that timestamp has definitely passed before making the result visible. That gives external consistency (if T1 commits before T2 starts, T2's timestamp is larger). The 2012 paper reports the uncertainty as a sawtooth "varying from about 1 to 7 ms", so commit wait costs a few milliseconds. See <a href="#clock-skew">Clock Skew</a> for why the interval matters.</li>
  <li><strong>CockroachDB</strong> keeps a <em>transaction record</em> (PENDING, STAGING, COMMITTED or ABORTED) and writes provisional values called <em>write intents</em>, replicated through Raft. Any transaction that runs into an intent looks up the record to learn whether it committed. Its "parallel commits" protocol (the STAGING state) lets a transaction commit in one round of consensus instead of two.</li>
  <li><strong>Percolator</strong> (Peng &amp; Dabek, OSDI 2010) added cross-row transactions on top of Bigtable, which only had single-row atomicity. A central timestamp oracle hands out start and commit timestamps, transactions get snapshot isolation, and one write is the <em>primary</em>: committing the primary lock is the single commit point, and anyone who finds a stale secondary lock checks the primary to roll it forward or back. TiKV uses the same model.</li>
</ul>
<p>The common thread: these systems keep 2PC but make every role replicated, so "the coordinator died" is a leader election, not an outage. They also own every participant. 2PC works well <em>inside</em> one database product; it works badly across independently run services.</p>

<h3>The alternatives</h3>
<table>
  <tr><th>Approach</th><th>Atomicity</th><th>Isolation</th><th>Availability cost</th><th>Use it when</th></tr>
  <tr><td><strong>2PC / XA</strong></td><td>all-or-nothing, at commit time</td><td>full: locks held until the decision</td><td>blocks if the coordinator dies in doubt; slowest participant sets the pace</td><td>a few databases you run, in one datacenter, with an XA-capable transaction manager; or inside a distributed SQL database that does it for you</td></tr>
  <tr><td><strong><a href="#saga-pattern">Saga</a></strong></td><td>eventually: each step commits; failures run compensations</td><td>none between steps (intermediate states are visible)</td><td>no global locks; each service stays independent</td><td>long-running business flows across microservices: order, payment, shipment</td></tr>
  <tr><td><strong>Outbox + events</strong></td><td>local tx writes data + event; consumers apply later</td><td>none; readers may see old data for a while</td><td>producer never waits for consumers</td><td>"this happened, others should react": search indexes, notifications, read models (see <a href="#event-driven-architecture">Event-Driven Architecture</a>)</td></tr>
  <tr><td><strong>Avoid it: redesign the boundary</strong></td><td>a single local transaction</td><td>full</td><td>none</td><td>data that must change together lives in one service and one database; often the best answer</td></tr>
</table>

<h2>Example</h2>
<p><strong>A 2PC coordinator in Go, with two real databases.</strong> Each bank is its own SQLite file. "Prepared" is a real SQLite transaction that stays open after the work is done, so its locks are really held while the participant is in doubt. The coordinator logs its decision before phase 2 and recovers from that log. (Simplification: a real participant also persists its prepared state so it survives its <em>own</em> crash; Postgres does that with <code>PREPARE TRANSACTION</code>. Here only the coordinator crashes.)</p>
<pre><code>package twopc

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sync"
)

// Participant is one resource manager: here, one bank's own database.
// A prepared transaction is a real SQLite transaction left open, so its
// write lock (SQLite locks the whole file) is really held until the
// coordinator says commit or abort.
type Participant struct {
	Name    string
	db      *sql.DB
	mu      sync.Mutex
	inDoubt map[string]*sql.Tx // txID -&gt; prepared, not yet decided
}

func NewParticipant(name string, db *sql.DB) *Participant {
	return &amp;Participant{Name: name, db: db, inDoubt: map[string]*sql.Tx{}}
}

// Prepare does the work and votes. YES is a promise: "I can commit this
// later, whatever happens to me." After voting YES the participant may not
// decide on its own any more; it must wait for the coordinator.
func (p *Participant) Prepare(ctx context.Context, txID, account string, delta int64) (yes bool, err error) {
	tx, err := p.db.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	res, err := tx.ExecContext(ctx,
		&#96;UPDATE accounts SET balance = balance + ? WHERE id = ? AND balance + ? &gt;= 0&#96;,
		delta, account, delta)
	if err != nil {
		tx.Rollback()
		return false, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		tx.Rollback() // a NO vote: this participant can abort unilaterally
		return false, nil
	}
	p.mu.Lock()
	p.inDoubt[txID] = tx
	p.mu.Unlock()
	return true, nil
}

// Finish applies the coordinator's decision to a prepared transaction.
func (p *Participant) Finish(txID string, commit bool) error {
	p.mu.Lock()
	tx, ok := p.inDoubt[txID]
	delete(p.inDoubt, txID)
	p.mu.Unlock()
	if !ok {
		return nil // already finished: decisions must be idempotent
	}
	if commit {
		return tx.Commit()
	}
	return tx.Rollback()
}

func (p *Participant) InDoubt() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return len(p.inDoubt)
}

type Op struct {
	P       *Participant
	Account string
	Delta   int64
}

var ErrCrashed = errors.New("coordinator crashed")

// Coordinator runs two-phase commit. Its decision log must be durable
// (fsynced) in real systems; a map stands in for that disk here.
type Coordinator struct {
	mu      sync.Mutex
	log     map[string]string // txID -&gt; "commit" | "abort"
	CrashAt string            // "", "after-prepare", "after-log"
}

func NewCoordinator() *Coordinator { return &amp;Coordinator{log: map[string]string{}} }

func (c *Coordinator) Run(ctx context.Context, txID string, ops []Op) (string, error) {
	// Phase 1: prepare. Any NO (or error) means abort.
	decision := "commit"
	var prepared []Op
	for _, op := range ops {
		yes, err := op.P.Prepare(ctx, txID, op.Account, op.Delta)
		if err != nil || !yes {
			decision = "abort"
			break
		}
		prepared = append(prepared, op)
	}
	if c.CrashAt == "after-prepare" {
		return "", ErrCrashed // everyone voted YES, nobody heard the outcome
	}
	// The decision is final once it is in the log, before anyone is told.
	c.mu.Lock()
	c.log[txID] = decision
	c.mu.Unlock()
	if c.CrashAt == "after-log" {
		return "", ErrCrashed
	}
	// Phase 2: tell every prepared participant.
	for _, op := range prepared {
		if err := op.P.Finish(txID, decision == "commit"); err != nil {
			return "", fmt.Errorf("%s: %w", op.P.Name, err)
		}
	}
	return decision, nil
}

// Recover is what a restarted coordinator does for a transaction it
// started: re-send the logged decision, or abort if it never logged one
// (presumed abort: no participant can have been told "commit").
func (c *Coordinator) Recover(txID string, ps ...*Participant) (string, error) {
	c.mu.Lock()
	decision, ok := c.log[txID]
	if !ok {
		decision = "abort"
		c.log[txID] = decision
	}
	c.mu.Unlock()
	for _, p := range ps {
		if err := p.Finish(txID, decision == "commit"); err != nil {
			return "", err
		}
	}
	return decision, nil
}</code></pre>

<p>The test runs four transfers: a normal commit, a NO vote, a coordinator crash after both participants voted YES, and a crash after the decision was logged but before anyone was told.</p>
<pre><code>func TestTwoPhaseCommit(t *testing.T) {
	ctx := context.Background()
	dbA, dbB := openBank(t, "bank-a", "alice", 100), openBank(t, "bank-b", "bob", 0)
	a, b := NewParticipant("bank-a", dbA), NewParticipant("bank-b", dbB)
	transfer := func(amount int64) []Op {
		return []Op{{a, "alice", -amount}, {b, "bob", +amount}}
	}
	show := func(label string) {
		fmt.Printf("%-34s alice=%-3d bob=%-3d in-doubt: a=%d b=%d&#92;n",
			label, balance(dbA, "alice"), balance(dbB, "bob"), a.InDoubt(), b.InDoubt())
	}
	co := NewCoordinator()

	d, err := co.Run(ctx, "tx1", transfer(30))
	fmt.Println("tx1 transfer 30:", d, err)
	show("after tx1")

	d, err = co.Run(ctx, "tx2", transfer(500))
	fmt.Println("tx2 transfer 500:", d, err)
	show("after tx2 (alice voted NO)")

	co.CrashAt = "after-prepare"
	_, err = co.Run(ctx, "tx3", transfer(20))
	fmt.Println("tx3 transfer 20:", err)
	show("after tx3 crash")
	_, err = dbA.Exec(&#96;UPDATE accounts SET balance = balance + 5 WHERE id = 'alice'&#96;)
	fmt.Println("other write to alice while in doubt:", err)

	co.CrashAt = ""
	d, _ = co.Recover("tx3", a, b)
	fmt.Println("coordinator restarts, tx3 decision:", d)
	_, err = dbA.Exec(&#96;UPDATE accounts SET balance = balance + 5 WHERE id = 'alice'&#96;)
	fmt.Println("other write to alice after recovery:", err)
	show("after tx3 recovery")

	co.CrashAt = "after-log"
	_, err = co.Run(ctx, "tx4", transfer(10))
	fmt.Println("tx4 transfer 10:", err)
	show("after tx4 crash")
	co.CrashAt = ""
	d, _ = co.Recover("tx4", a, b)
	fmt.Println("coordinator restarts, tx4 decision:", d)
	show("after tx4 recovery")
}</code></pre>

<p>Real output from <code>go test -v</code>:</p>
<pre><code>tx1 transfer 30: commit &lt;nil&gt;
after tx1                          alice=70  bob=30  in-doubt: a=0 b=0
tx2 transfer 500: abort &lt;nil&gt;
after tx2 (alice voted NO)         alice=70  bob=30  in-doubt: a=0 b=0
tx3 transfer 20: coordinator crashed
after tx3 crash                    alice=70  bob=30  in-doubt: a=1 b=1
other write to alice while in doubt: database is locked (5) (SQLITE_BUSY)
coordinator restarts, tx3 decision: abort
other write to alice after recovery: &lt;nil&gt;
after tx3 recovery                 alice=75  bob=30  in-doubt: a=0 b=0
tx4 transfer 10: coordinator crashed
after tx4 crash                    alice=75  bob=30  in-doubt: a=1 b=1
coordinator restarts, tx4 decision: commit
after tx4 recovery                 alice=65  bob=40  in-doubt: a=0 b=0</code></pre>
<ul>
  <li><strong>tx2</strong>: Alice has 70, so the debit of 500 fails its check, bank A votes NO, and bank B is never asked to commit. Nothing changes.</li>
  <li><strong>tx3</strong>: both banks voted YES and then heard nothing. A plain write to Alice's account fails with <code>SQLITE_BUSY</code> after waiting 100 ms: that is the blocking problem, measured. On restart the log has no decision, so presumed abort releases the locks and the write goes through.</li>
  <li><strong>tx4</strong>: the decision COMMIT was logged, then the coordinator died. On restart it must commit, and it does: Alice 75 → 65, Bob 30 → 40. Aborting here would have been wrong if bank A had already received COMMIT.</li>
</ul>

<p><strong>Real-world scenario.</strong> Picture a payments ledger and an inventory database joined by an XA transaction manager running as one pod. At 10:02 that pod is evicted during a node drain, right after 400 transactions have prepared. The replacement needs 90 s to be scheduled, start, and read its log. For those 90 s, the 400 in-doubt transactions hold row locks on popular SKUs and on merchant balance rows. Every checkout touching those rows waits on locks, hits its 5 s timeout, and is retried by the client, which adds more load. A 90 s restart of a component that does no "real" work becomes a 90 s checkout outage. The fixes are the usual ones: run the transaction manager highly available with a replicated log, keep the transactions tiny, and alert on <code>pg_prepared_xacts</code> / <code>XA RECOVER</code> entries older than a minute. Or move that flow to a saga.</p>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>Calling an HTTP API "a participant".</strong> 2PC needs participants that can prepare: durably promise to commit later while holding locks. A REST endpoint, an email provider or a payment gateway can't do that. If one step of your "transaction" is an HTTP call, you don't have 2PC, you have a saga without compensations.</li>
  <li><strong>Forgetting the latency and lock cost.</strong> Every transaction pays two round trips plus forced log writes on every node, and holds locks across the network for that whole time. Throughput on hot rows drops accordingly, and the slowest participant sets the pace for all.</li>
  <li><strong>A single, unreplicated coordinator.</strong> It is a single point of failure for every in-flight transaction. Its log must be on durable storage that survives the pod or VM being replaced, not on an ephemeral disk.</li>
  <li><strong>Participants that "time out" after voting YES.</strong> Aborting an in-doubt transaction on a timer breaks atomicity. Only the coordinator (or the cooperative termination check) may decide. Some XA products allow manual "heuristic" commit/abort by an operator; treat any heuristic outcome as an incident, because it can leave participants disagreeing.</li>
  <li><strong>Orphaned prepared transactions.</strong> A crashed transaction manager that never comes back leaves prepared transactions holding locks indefinitely. Monitor for them and have a runbook.</li>
  <li><strong>Reaching for 2PC when the boundary is wrong.</strong> If two services always need to change together atomically, they may really be one service, or the data may belong in one database. Fixing the boundary beats any protocol.</li>
</ul>

<div class="callout warn"><strong>"Exactly once across services" is not something 2PC gives you for free.</strong> Many brokers and SaaS APIs don't support XA at all. When a flow crosses something that can't prepare, design it as a saga with idempotent steps from the start rather than discovering the gap in an incident.</div>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>A local ACID transaction stops at the edge of one database. Atomic commit across several needs a protocol.</li>
  <li>2PC: prepare (everyone votes; YES is a durable promise), then the coordinator logs the decision and tells everyone.</li>
  <li>If the coordinator dies after the votes, participants are in doubt and keep their locks until it returns. Distributed databases fix this by replicating the coordinator with Paxos/Raft.</li>
  <li>Across microservices and third-party APIs, prefer sagas, the outbox pattern, or moving the data into one service.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#saga-pattern">Saga Pattern</a> · <a href="#event-driven-architecture">Event-Driven Architecture</a> · <a href="#idempotency">Idempotency</a> · <a href="#replication">Replication</a> · <a href="#clock-skew">Clock Skew</a> · <a href="#pessimistic-locking">Pessimistic Locking</a></p>
`;

