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

CONTENT["saga-pattern"] = `
<p class="tldr"><strong>TL;DR</strong>: A saga replaces one big distributed transaction with a <strong>sequence of local transactions</strong>, one per service. Each step commits on its own. If a later step fails, the saga runs <strong>compensating transactions</strong> that semantically undo the earlier steps, in reverse order. It's like booking a trip yourself: you book the flight, then the hotel, and if no car is available you cancel the hotel and the flight. You don't get "it never happened", you get "it was undone", with a refund on your statement.</p>

<h2>The problem it solves</h2>
<p>Placing an order touches three services: inventory reserves stock, payments charges the card, shipping books a carrier. Each one owns its database. You want all three or none.</p>
<p><a href="#distributed-transactions">Two-phase commit</a> would hold locks in all three databases until every one has voted, and it blocks if the coordinator dies in the middle. That is a poor fit here. The payment provider is a third-party HTTP API that can't "prepare". The carrier booking might take seconds. And you don't want the inventory database to be unavailable because the shipping service is being deployed.</p>
<p>The problem is older than microservices. Hector Garcia-Molina and Kenneth Salem's 1987 SIGMOD paper "Sagas" was about <strong>long-lived transactions</strong> in a single database: transactions that hold locks for so long that they delay all the short ones. Their answer was to split the long transaction into a sequence of short ones, T1, T2, ... Tn, that can interleave with other work, and to pair each Ti with a compensating transaction Ci. The guarantee is that either T1 ... Tn all run, or T1 ... Tj run followed by Cj ... C1. Microservices adopted the same idea because every service boundary has exactly that problem.</p>

<h2>How it works</h2>
<figure class="diagram">
<svg viewBox="0 0 780 270" role="img" aria-label="A saga with three steps. T1 reserve stock commits in the inventory DB, T2 charge card commits in the payments DB, T3 create shipment is rejected. The saga then runs C2 refund card, then C1 release stock, in reverse order.">
  <defs><marker id="arr-sg-1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <text x="12" y="24" class="small">forward: each step is a local transaction that commits immediately</text>
  <rect class="box ok" x="30" y="40" width="200" height="50" rx="8"/><text x="130" y="61" text-anchor="middle" class="title">T1 reserve stock</text><text x="130" y="79" text-anchor="middle" class="small">inventory DB, committed</text>
  <rect class="box ok" x="290" y="40" width="200" height="50" rx="8"/><text x="390" y="61" text-anchor="middle" class="title">T2 charge card</text><text x="390" y="79" text-anchor="middle" class="small">payments, committed</text>
  <rect class="box bad" x="550" y="40" width="200" height="50" rx="8"/><text x="650" y="61" text-anchor="middle" class="title">T3 create shipment</text><text x="650" y="79" text-anchor="middle" class="small">rejected: no carrier</text>
  <path class="line ok" d="M230 65 H288" marker-end="url(#arr-sg-1)"/>
  <path class="line ok" d="M490 65 H548" marker-end="url(#arr-sg-1)"/>

  <path class="line bad" d="M650 90 V205 H492" marker-end="url(#arr-sg-1)"/>
  <text x="660" y="150" class="small">start compensating</text>
  <rect class="box accent" x="290" y="180" width="200" height="50" rx="8"/><text x="390" y="201" text-anchor="middle" class="title">C2 refund card</text><text x="390" y="219" text-anchor="middle" class="small">semantic undo of T2</text>
  <rect class="box accent" x="30" y="180" width="200" height="50" rx="8"/><text x="130" y="201" text-anchor="middle" class="title">C1 release stock</text><text x="130" y="219" text-anchor="middle" class="small">semantic undo of T1</text>
  <path class="line accent" d="M290 205 H232" marker-end="url(#arr-sg-1)"/>
  <text x="12" y="256" class="small">backward: compensations run in reverse order, only for steps that completed (T3 never did)</text>
</svg>
<figcaption>Between T1 and C1, other transactions can see the reserved stock and the charge. A saga is atomic in the end, but it is never isolated.</figcaption>
</figure>

<h3>Orchestration vs choreography</h3>
<p>Someone has to decide what runs next. There are two styles:</p>
<ul>
  <li><strong>Orchestration</strong>: a central orchestrator (a workflow engine, or a service with a state table) sends each service a command and waits for the reply. It holds the saga's state, so "where is order 42?" has one answer, and the flow is readable in one place.</li>
  <li><strong>Choreography</strong>: there is no coordinator. Each service listens for events and publishes its own (see <a href="#event-driven-architecture">Event-Driven Architecture</a>). Inventory hears <code>OrderPlaced</code> and emits <code>StockReserved</code>; payments hears that and emits <code>PaymentCharged</code>, and so on. Failures travel back the same way as events.</li>
</ul>

<figure class="diagram">
<svg viewBox="0 0 780 320" role="img" aria-label="Left: orchestration. An orchestrator holding the saga state sends commands to inventory (reserve or release), payment (charge or refund) and shipping (ship or cancel). Right: choreography. Order emits OrderPlaced, inventory emits StockReserved, payment emits PaymentCharged to shipping. On failure, shipping emits ShipmentFailed, payment emits PaymentRefunded, inventory emits StockReleased, flowing back up.">
  <defs><marker id="arr-sg-2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <text x="195" y="20" text-anchor="middle" class="title">Orchestration</text>
  <text x="590" y="20" text-anchor="middle" class="title">Choreography</text>
  <path class="line dashed" d="M395 10 V310" style="stroke: var(--line)"/>

  <rect class="box accent" x="110" y="40" width="170" height="48" rx="8"/><text x="195" y="61" text-anchor="middle" class="title">Orchestrator</text><text x="195" y="78" text-anchor="middle" class="small">saga state in its own DB</text>
  <rect class="box" x="15" y="200" width="115" height="36" rx="6"/><text x="72" y="223" text-anchor="middle">Inventory</text>
  <rect class="box" x="140" y="200" width="110" height="36" rx="6"/><text x="195" y="223" text-anchor="middle">Payment</text>
  <rect class="box" x="260" y="200" width="115" height="36" rx="6"/><text x="317" y="223" text-anchor="middle">Shipping</text>
  <path class="line" d="M150 88 L80 198" marker-start="url(#arr-sg-2)" marker-end="url(#arr-sg-2)"/>
  <path class="line" d="M195 88 V198" marker-start="url(#arr-sg-2)" marker-end="url(#arr-sg-2)"/>
  <path class="line" d="M240 88 L310 198" marker-start="url(#arr-sg-2)" marker-end="url(#arr-sg-2)"/>
  <text x="203" y="150" class="small">command</text>
  <text x="203" y="164" class="small">+ reply</text>
  <text x="72" y="254" text-anchor="middle" class="small">reserve / release</text>
  <text x="195" y="254" text-anchor="middle" class="small">charge / refund</text>
  <text x="317" y="254" text-anchor="middle" class="small">ship / cancel</text>
  <text x="195" y="290" text-anchor="middle" class="small">one place knows the whole flow</text>

  <rect class="box" x="420" y="40" width="120" height="32" rx="6"/><text x="480" y="61" text-anchor="middle">Order</text>
  <rect class="box" x="420" y="110" width="120" height="32" rx="6"/><text x="480" y="131" text-anchor="middle">Inventory</text>
  <rect class="box" x="420" y="180" width="120" height="32" rx="6"/><text x="480" y="201" text-anchor="middle">Payment</text>
  <rect class="box" x="420" y="250" width="120" height="32" rx="6"/><text x="480" y="271" text-anchor="middle">Shipping</text>
  <path class="line ok" d="M460 72 V108" marker-end="url(#arr-sg-2)"/>
  <path class="line ok" d="M460 142 V178" marker-end="url(#arr-sg-2)"/>
  <path class="line ok" d="M460 212 V248" marker-end="url(#arr-sg-2)"/>
  <path class="line bad dashed" d="M500 108 V74" marker-end="url(#arr-sg-2)"/>
  <path class="line bad dashed" d="M500 178 V144" marker-end="url(#arr-sg-2)"/>
  <path class="line bad dashed" d="M500 248 V214" marker-end="url(#arr-sg-2)"/>
  <text x="555" y="88" class="small">OrderPlaced</text><text x="555" y="102" class="small">fail: StockReleased</text>
  <text x="555" y="158" class="small">StockReserved</text><text x="555" y="172" class="small">fail: PaymentRefunded</text>
  <text x="555" y="228" class="small">PaymentCharged</text><text x="555" y="242" class="small">fail: ShipmentFailed</text>
  <text x="590" y="304" text-anchor="middle" class="small">the flow exists only as who listens to what</text>
</svg>
<figcaption>Same saga, two control styles. Solid arrows are the happy path; dashed arrows are the compensation path.</figcaption>
</figure>

<p>Choreography is attractive for two or three steps: no extra component, and services stay decoupled. As the flow grows it gets hard to answer "what happens after X?" without reading every service, cyclic event dependencies creep in, and there's no single place to see stuck sagas. Most teams with four or more steps, or with timeouts and human approvals in the flow, use orchestration.</p>

<h3>Rules for compensations</h3>
<ul>
  <li><strong>Semantic undo, not rollback.</strong> T2 committed, and other people may have seen it: the customer got a "payment received" email, the ledger has an entry. C2 doesn't erase it; it adds a <em>refund</em>. Some steps can't be undone at all (an email is sent, a parcel has left). Their "compensation" is another forward action, like sending a correction email.</li>
  <li><strong>Idempotent.</strong> The orchestrator will retry a compensation after a timeout or a crash, so running C2 twice must refund once. Key it by saga ID and step (see <a href="#idempotency">Idempotency</a>). It must also be safe to run when T2 <em>never actually happened</em>: a timed-out charge may or may not have gone through.</li>
  <li><strong>It must eventually succeed.</strong> A saga with a failed compensation is stuck halfway: money taken, no order. So a compensation is retried (with <a href="#exponential-backoff">backoff</a>) until it works, and if it keeps failing, a human gets paged. It never returns a business "no".</li>
  <li><strong>Commutative where possible.</strong> A compensation can arrive after a later, unrelated update. "Add 1 back to stock" works in any order; "set stock to 10" does not.</li>
</ul>

<h3>Pivot transaction: where the saga stops being reversible</h3>
<p>Chris Richardson's <em>Microservices Patterns</em> classifies saga steps into three kinds:</p>
<ul>
  <li><strong>Compensatable</strong> steps come first. They can be undone.</li>
  <li>The <strong>pivot</strong> is the go/no-go point. If it succeeds, the saga will run to completion; if it fails, the saga compensates. It is often a step that can't be undone and isn't worth retrying, like capturing a payment.</li>
  <li><strong>Retriable</strong> steps come after the pivot. They are guaranteed to succeed eventually, so they're just retried (idempotently) until they do.</li>
</ul>
<p>Design rule: <strong>put the steps most likely to fail early</strong>, and the irreversible ones as late as possible. Check the address with the carrier <em>before</em> charging the card, and you rarely need a refund. In the example below the carrier check is deliberately last, to show compensation running.</p>

<h3>No isolation, and the countermeasures</h3>
<p>Each step commits immediately, so other transactions see intermediate states. Three classic anomalies: <strong>lost updates</strong> (one saga overwrites another's change), <strong>dirty reads</strong> (someone reads stock that a saga is about to release), and <strong>non-repeatable reads</strong> (a saga reads a value twice and gets two answers). Richardson lists countermeasures; the common ones:</p>
<ul>
  <li><strong>Semantic lock</strong>: a compensatable step marks what it touched with a status such as <code>PENDING</code>. Other code treats pending records specially: excludes them from "available", refuses to modify them, or waits. A later step clears the flag, or the compensation removes the record.</li>
  <li><strong>Commutative updates</strong>: design updates so their order doesn't matter (credits and debits, increments instead of absolute values).</li>
  <li><strong>Pessimistic view</strong>: reorder the steps so a dirty read hurts less. Increase available credit in a late, retriable step, not an early compensatable one.</li>
  <li><strong>Reread value</strong>: before overwriting, re-read the record and check it hasn't changed (essentially <a href="#optimistic-locking">optimistic locking</a>).</li>
</ul>

<figure class="diagram">
<svg viewBox="0 0 780 300" role="img" aria-label="Saga state machine. Running goes to completed when every step commits, or to compensating when a step is rejected. Compensating goes to compensated when every completed step is undone. Running loops on itself on transient errors or crashes (retry, resume). Compensating loops on itself when an undo fails: retry with backoff and alert, never give up.">
  <defs><marker id="arr-sg-3" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <rect class="box accent" x="40" y="70" width="160" height="44" rx="22"/><text x="120" y="97" text-anchor="middle" class="title">running</text>
  <rect class="box ok" x="560" y="70" width="180" height="44" rx="22"/><text x="650" y="97" text-anchor="middle" class="title">completed</text>
  <rect class="box bad" x="40" y="200" width="160" height="44" rx="22"/><text x="120" y="227" text-anchor="middle" class="title">compensating</text>
  <rect class="box ok" x="560" y="200" width="180" height="44" rx="22"/><text x="650" y="227" text-anchor="middle" class="title">compensated</text>

  <path class="line ok" d="M200 92 H558" marker-end="url(#arr-sg-3)"/><text x="380" y="84" text-anchor="middle" class="small">every step committed</text>
  <path class="line bad" d="M120 114 V198" marker-end="url(#arr-sg-3)"/><text x="130" y="160" class="small">a step is rejected (business "no")</text>
  <path class="line ok" d="M200 222 H558" marker-end="url(#arr-sg-3)"/><text x="380" y="214" text-anchor="middle" class="small">every completed step undone</text>

  <path class="line" d="M90 70 C 90 30, 150 30, 150 68" marker-end="url(#arr-sg-3)"/>
  <text x="170" y="38" class="small">transient error: retry · crash: resume from saved state</text>
  <path class="line bad" d="M90 244 C 90 284, 150 284, 150 246" marker-end="url(#arr-sg-3)"/>
  <text x="170" y="282" class="small">undo fails: retry with backoff, alert a human, never give up</text>
</svg>
<figcaption>The saga's state lives in a database, not in memory, so any process can resume it. There is no "failed" state: a saga ends completed or compensated.</figcaption>
</figure>

<h3>Tools</h3>
<table>
  <tr><th>Option</th><th>How you write the saga</th><th>Compensation support</th><th>Good fit</th><th>Watch out for</th></tr>
  <tr><td><strong>Temporal</strong></td><td>workflow as ordinary code (Go, Java, TypeScript, Python, ...); the engine persists its history and replays it after a crash</td><td>you write it: e.g. collect an undo function after each step and run them in reverse on failure</td><td>long flows, timers, human steps; teams that prefer code to diagrams</td><td>workflow code must be deterministic; activities retry forever by default (initial interval 1 s, coefficient 2.0, max interval 100 × initial), so set a policy for business errors</td></tr>
  <tr><td><strong>AWS Step Functions</strong></td><td>a JSON state machine (Amazon States Language)</td><td><code>Retry</code> for transient errors; <code>Catch</code> routes a failed state to compensation states</td><td>AWS-native flows calling Lambda, SQS, DynamoDB; AWS Prescriptive Guidance documents the saga pattern on it</td><td>logic split between JSON and code; per-transition pricing on Standard workflows</td></tr>
  <tr><td><strong>Camunda</strong></td><td>BPMN process diagrams, executed by the engine</td><td>BPMN compensation events and compensation handlers on tasks</td><td>flows business people read and change; approvals</td><td>check which BPMN compensation features your engine version supports</td></tr>
  <tr><td><strong>Hand-rolled state machine</strong></td><td>a <code>sagas</code> table + a worker that resumes non-final sagas (like the example below)</td><td>whatever you build</td><td>2–4 steps, one team, no new infrastructure</td><td>you own retries, timeouts, visibility, and recovery of stuck sagas</td></tr>
  <tr><td><strong>Choreography over a broker</strong></td><td>services react to each other's events</td><td>each service listens for failure events and compensates its own step</td><td>2–3 steps, highly decoupled teams</td><td>no single view of a saga's state; flow logic spread across services</td></tr>
</table>

<h2>Example</h2>
<p><strong>An orchestrated saga in Go.</strong> Three steps: reserve stock, charge card, create shipment. The saga's status and progress are stored in SQLite after every step, so a crashed orchestrator resumes from the database. Business rejections (<code>ErrRejected</code>) trigger compensation; anything else is treated as transient and retried.</p>
<pre><code>package saga

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

// ErrRejected is a business "no": retrying won't help, so the saga must
// compensate. Any other error is treated as transient and retried.
var ErrRejected = errors.New("rejected")

type Step struct {
	Name string
	Do   func(ctx context.Context, sagaID string) error
	Undo func(ctx context.Context, sagaID string) error // semantic undo, must be idempotent
}

const Schema = &#96;
CREATE TABLE sagas (
	id     TEXT PRIMARY KEY,
	status TEXT NOT NULL,    -- running | compensating | completed | compensated
	done   INTEGER NOT NULL  -- how many steps have completed (forward)
);
CREATE TABLE saga_log (seq INTEGER PRIMARY KEY AUTOINCREMENT, saga_id TEXT, entry TEXT);&#96;

// Orchestrator drives one saga at a time from its persisted state, so a
// restarted process picks up where the last one stopped.
type Orchestrator struct {
	DB         *sql.DB
	Steps      []Step
	MaxRetries int                    // per call; a real system retries with backoff, forever
	CrashAfter func(step string) bool // test hook: simulate a process crash
}

var ErrCrashed = errors.New("orchestrator crashed")

func (o *Orchestrator) Run(ctx context.Context, sagaID string) (string, error) {
	var status string
	var done int
	err := o.DB.QueryRowContext(ctx, &#96;SELECT status, done FROM sagas WHERE id = ?&#96;, sagaID).Scan(&amp;status, &amp;done)
	if errors.Is(err, sql.ErrNoRows) {
		status, done = "running", 0
		if _, err := o.DB.ExecContext(ctx, &#96;INSERT INTO sagas VALUES (?, ?, 0)&#96;, sagaID, status); err != nil {
			return "", err
		}
	} else if err != nil {
		return "", err
	} else {
		o.log(ctx, sagaID, fmt.Sprintf("resume: status=%s done=%d", status, done))
	}

	for status == "running" &amp;&amp; done &lt; len(o.Steps) {
		step := o.Steps[done]
		err := o.retry(ctx, sagaID, func() error { return step.Do(ctx, sagaID) })
		if errors.Is(err, ErrRejected) {
			o.log(ctx, sagaID, step.Name+" failed: "+err.Error())
			status = "compensating"
			if err := o.save(ctx, sagaID, status, done); err != nil {
				return "", err
			}
			break
		}
		if err != nil {
			return "", err // still transient after retries: stay "running", resume later
		}
		if o.CrashAfter != nil &amp;&amp; o.CrashAfter(step.Name) {
			return "", ErrCrashed // the step ran, but its progress was never saved
		}
		done++
		o.log(ctx, sagaID, step.Name+" ok")
		if err := o.save(ctx, sagaID, status, done); err != nil {
			return "", err
		}
	}

	// Compensate completed steps in reverse order. A compensation may not
	// give up: if it keeps failing, the saga stays "compensating" and is
	// resumed later (and paged on), never silently dropped.
	for status == "compensating" &amp;&amp; done &gt; 0 {
		step := o.Steps[done-1]
		if err := o.retry(ctx, sagaID, func() error { return step.Undo(ctx, sagaID) }); err != nil {
			return "", fmt.Errorf("undo %s: %w", step.Name, err)
		}
		done--
		o.log(ctx, sagaID, "undo "+step.Name+" ok")
		if err := o.save(ctx, sagaID, status, done); err != nil {
			return "", err
		}
	}

	switch status {
	case "running":
		status = "completed"
	case "compensating":
		status = "compensated"
	}
	return status, o.save(ctx, sagaID, status, done)
}

func (o *Orchestrator) retry(ctx context.Context, sagaID string, f func() error) error {
	var err error
	for range o.MaxRetries {
		if err = f(); err == nil || errors.Is(err, ErrRejected) {
			return err
		}
		o.log(ctx, sagaID, "transient error, retrying: "+err.Error())
	}
	return err
}

func (o *Orchestrator) save(ctx context.Context, id, status string, done int) error {
	_, err := o.DB.ExecContext(ctx, &#96;UPDATE sagas SET status = ?, done = ? WHERE id = ?&#96;, status, done, id)
	return err
}

func (o *Orchestrator) log(ctx context.Context, id, entry string) {
	o.DB.ExecContext(ctx, &#96;INSERT INTO saga_log (saga_id, entry) VALUES (?, ?)&#96;, id, entry)
}</code></pre>

<p>Each downstream service keys its work by saga ID, so repeats are harmless. The payment service, with its refund as the semantic undo:</p>
<pre><code>type Payments struct {
	Calls            int // every Charge call, including repeats
	Charges, Refunds int
	FailRefunds      int               // next N refunds time out
	charged          map[string]string // saga ID -&gt; "charged" | "refunded"
}

func (p *Payments) Charge(_ context.Context, id string) error {
	p.Calls++
	if p.charged == nil {
		p.charged = map[string]string{}
	}
	if p.charged[id] != "" {
		return nil // idempotent: same saga ID, same charge
	}
	p.Charges++
	p.charged[id] = "charged"
	return nil
}

// Refund is the semantic undo of Charge: the charge stays on the
// statement, a refund is added next to it.
func (p *Payments) Refund(_ context.Context, id string) error {
	if p.charged[id] != "charged" {
		return nil
	}
	if p.FailRefunds &gt; 0 {
		p.FailRefunds--
		return errors.New("payment gateway timeout")
	}
	p.Refunds++
	p.charged[id] = "refunded"
	return nil
}</code></pre>

<p>The test runs three orders: one succeeds; one is rejected at shipping and compensates (with the first refund attempt timing out); one crashes the orchestrator right after charging the card, before that progress was saved.</p>
<pre><code>func Example() {
	ctx := context.Background()
	db, _ := sql.Open("sqlite", ":memory:")
	db.SetMaxOpenConns(1) // one connection = one in-memory database
	db.Exec(Schema)

	inv := &amp;Inventory{Stock: 10}
	pay := &amp;Payments{}
	ship := &amp;Shipping{Addresses: map[string]string{
		"order-1": "Lisbon", "order-2": "Atlantis", "order-3": "Osaka",
	}}
	o := &amp;Orchestrator{DB: db, MaxRetries: 3, Steps: []Step{
		{"reserve-stock", inv.Reserve, inv.Release},
		{"charge-card", pay.Charge, pay.Refund},
		{"create-shipment", ship.Create, ship.Cancel},
	}}

	status, err := o.Run(ctx, "order-1")
	fmt.Println("order-1:", status, err)

	pay.FailRefunds = 1 // the first refund attempt will time out
	status, err = o.Run(ctx, "order-2")
	fmt.Println("order-2:", status, err)

	o.CrashAfter = func(step string) bool { return step == "charge-card" }
	_, err = o.Run(ctx, "order-3")
	fmt.Println("order-3:", err)
	o.CrashAfter = nil
	status, err = o.Run(ctx, "order-3") // a new process resumes from the DB
	fmt.Println("order-3 after restart:", status, err)

	fmt.Println("--- saga_log")
	rows, _ := db.Query(&#96;SELECT saga_id, entry FROM saga_log ORDER BY seq&#96;)
	for rows.Next() {
		var id, entry string
		rows.Scan(&amp;id, &amp;entry)
		fmt.Println(id, entry)
	}
	rows.Close()
	fmt.Printf("--- stock=%d charge calls=%d charges=%d refunds=%d shipments=%d&#92;n",
		inv.Stock, pay.Calls, pay.Charges, pay.Refunds, ship.Created)
}</code></pre>

<p>Real output, pinned as the example's <code>// Output:</code> (passes <code>go test -race</code>):</p>
<pre><code>order-1: completed &lt;nil&gt;
order-2: compensated &lt;nil&gt;
order-3: orchestrator crashed
order-3 after restart: completed &lt;nil&gt;
--- saga_log
order-1 reserve-stock ok
order-1 charge-card ok
order-1 create-shipment ok
order-2 reserve-stock ok
order-2 charge-card ok
order-2 create-shipment failed: no carrier delivers to Atlantis: rejected
order-2 transient error, retrying: payment gateway timeout
order-2 undo charge-card ok
order-2 undo reserve-stock ok
order-3 reserve-stock ok
order-3 resume: status=running done=1
order-3 charge-card ok
order-3 create-shipment ok
--- stock=8 charge calls=4 charges=3 refunds=1 shipments=2</code></pre>
<ul>
  <li><strong>order-2</strong>: shipping rejects the address, so the saga refunds and then releases stock, in reverse order. The first refund times out and is retried; the compensation does not give up.</li>
  <li><strong>order-3</strong>: the card was charged, but the crash happened before <code>done=2</code> was saved. The new process reads <code>done=1</code> and runs <code>charge-card</code> again. The payment service sees the same saga ID and does nothing: <strong>4 charge calls, 3 charges</strong>. Without idempotent steps, every orchestrator crash could double-charge.</li>
  <li>Final stock is 8: order-1 and order-3 hold one unit each, order-2's unit was released.</li>
</ul>

<p><strong>Real-world scenario.</strong> Picture a shop taking 50,000 orders an hour during a sale. The carrier rejects about 2% of addresses, so roughly 1,000 sagas an hour run compensations: 1,000 refunds and stock releases, all automatic. Then the payment provider has a 10-minute outage. Refunds start failing, and about 170 sagas pile up in <code>compensating</code>. They aren't lost; the worker keeps retrying with backoff, and when the provider recovers they drain within a minute. What makes this safe is the boring part: state in a table, an alert on "sagas in <code>compensating</code> for more than 15 minutes", and idempotency keys on every refund. The better fix comes next sprint: move the address check before the charge, and the refunds mostly disappear.</p>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>Treating it like a database rollback.</strong> Users see intermediate states: a charge that's later refunded, stock that disappears and comes back. Design the UX and the emails for that ("payment pending", "order cancelled, refund issued").</li>
  <li><strong>Saga state only in memory.</strong> If the orchestrator holds progress in a variable, a deploy in the middle forgets which steps ran. Persist after every step, and have a recovery loop that resumes non-final sagas.</li>
  <li><strong>Non-idempotent steps.</strong> At-least-once is the only delivery you get. A resume after a crash re-runs the last step. Every step and every compensation needs a dedup key.</li>
  <li><strong>Compensations that can fail for business reasons.</strong> "Refund rejected: card closed" can't be a dead end. Plan the fallback (store credit, manual review) up front.</li>
  <li><strong>Mixing up "rejected" and "timed out".</strong> A timeout doesn't mean the step failed. Compensating after a timeout is fine only if the compensation also handles "it actually succeeded" and "it never happened".</li>
  <li><strong>Ignoring isolation.</strong> Two sagas booking the last seat both see it as available. Use a semantic lock (a <code>PENDING</code> reservation), or a real lock on the scarce resource (see <a href="#distributed-locks">Distributed Locks</a>).</li>
  <li><strong>Choreography sprawl.</strong> Ten services reacting to each other's events is a flow nobody can draw. When you can't answer "what state is order 42 in?", switch to orchestration.</li>
</ul>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>A saga is a sequence of local transactions; on failure, compensations semantically undo the completed ones in reverse order.</li>
  <li>Orchestration keeps the flow and its state in one place; choreography spreads it across event handlers. Prefer orchestration beyond a few steps.</li>
  <li>Every step and compensation must be idempotent, compensations must eventually succeed, and the saga state must be persisted.</li>
  <li>Sagas have no isolation: order steps so failures happen early, and use semantic locks or commutative updates for the gaps.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#distributed-transactions">Distributed Transactions</a> · <a href="#event-driven-architecture">Event-Driven Architecture</a> · <a href="#idempotency">Idempotency</a> · <a href="#retries">Retries</a> · <a href="#dead-letter-queues">Dead Letter Queues</a> · <a href="#real-world-distributed-design">Real-World Distributed Design</a></p>
`;

CONTENT["replication"] = `
<p class="tldr"><strong>TL;DR</strong>: Replication keeps copies of the same data on several machines, so one dead disk doesn't lose data, reads can be spread out, and users can read from a nearby copy. The hard part isn't copying. It is deciding <em>when</em> a write counts as done, and what a reader sees while the copies disagree. Think of a notary who keeps the original register and sends photocopies to branch offices by courier: the branches can serve visitors, but they're always a few pages behind.</p>

<h2>The problem it solves</h2>
<p>A database on one machine has three limits that more hardware can't fully fix:</p>
<ul>
  <li><strong>Durability and availability.</strong> When that machine's disk, power supply or whole zone fails, the data is offline. If the disk is gone, the data is gone too, back to the last backup (see <a href="#backups">Backups</a>).</li>
  <li><strong>Read throughput.</strong> Most apps read far more than they write. One machine has a fixed number of cores and IOPS for all those reads.</li>
  <li><strong>Latency.</strong> A user 150 ms of round trip away pays that on every query. A copy in their region removes it for reads.</li>
</ul>
<p>Replication answers all three by keeping the same data on several nodes, called <strong>replicas</strong>. If data never changed, that would be easy: copy it once. All the difficulty comes from <em>changes</em>. Every write has to reach every copy, and networks are slow, nodes crash mid-way, and links drop. Each design below is a different answer to "who accepts writes, and how do the others find out?"</p>

<h2>How it works</h2>
<p>There are three families. Almost every database you'll use picks one of them, and some let you choose.</p>
<figure class="diagram">
<svg viewBox="0 0 780 295" role="img" aria-label="Three replication topologies. Single leader: all writes go to one leader, which ships its log to two followers that serve reads. Multi-leader: two leaders in two regions both accept writes and replicate to each other asynchronously, so conflicts must be resolved. Leaderless: the client sends the write to all three nodes, the write succeeds when W=2 acknowledge, reads ask R=2 nodes, and since W plus R is greater than N the sets overlap; node C missed the write and is stale.">
  <defs><marker id="arr-rep-1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <text x="130" y="22" text-anchor="middle" class="title">Single leader</text>
  <text x="390" y="22" text-anchor="middle" class="title">Multi-leader</text>
  <text x="650" y="22" text-anchor="middle" class="title">Leaderless</text>
  <path class="line dashed" d="M260 10 V290" style="stroke: var(--line)"/>
  <path class="line dashed" d="M520 10 V290" style="stroke: var(--line)"/>

  <text x="130" y="46" text-anchor="middle" class="small">all writes</text>
  <path class="line" d="M130 52 V88" marker-end="url(#arr-rep-1)"/>
  <rect class="box accent" x="75" y="90" width="110" height="40" rx="6"/><text x="130" y="108" text-anchor="middle" class="title">Leader</text><text x="130" y="123" text-anchor="middle" class="small">reads + writes</text>
  <path class="line" d="M110 130 L75 198" marker-end="url(#arr-rep-1)"/>
  <path class="line" d="M150 130 L185 198" marker-end="url(#arr-rep-1)"/>
  <rect class="box" x="20" y="200" width="100" height="40" rx="6"/><text x="70" y="225" text-anchor="middle">Follower 1</text>
  <rect class="box" x="140" y="200" width="100" height="40" rx="6"/><text x="190" y="225" text-anchor="middle">Follower 2</text>
  <text x="130" y="262" text-anchor="middle" class="small">followers replay the leader's log</text>
  <text x="130" y="280" text-anchor="middle" class="small">reads can go to followers</text>

  <text x="325" y="46" text-anchor="middle" class="small">region 1 writes</text>
  <text x="455" y="46" text-anchor="middle" class="small">region 2 writes</text>
  <path class="line" d="M325 52 V88" marker-end="url(#arr-rep-1)"/>
  <path class="line" d="M455 52 V88" marker-end="url(#arr-rep-1)"/>
  <rect class="box accent" x="280" y="90" width="90" height="40" rx="6"/><text x="325" y="115" text-anchor="middle" class="title">Leader A</text>
  <rect class="box accent" x="410" y="90" width="90" height="40" rx="6"/><text x="455" y="115" text-anchor="middle" class="title">Leader B</text>
  <path class="line accent" d="M373 110 H407" marker-start="url(#arr-rep-1)" marker-end="url(#arr-rep-1)"/>
  <text x="390" y="155" text-anchor="middle" class="small">async, both ways</text>
  <path class="line" d="M325 130 V198" marker-end="url(#arr-rep-1)"/>
  <path class="line" d="M455 130 V198" marker-end="url(#arr-rep-1)"/>
  <rect class="box" x="280" y="200" width="90" height="40" rx="6"/><text x="325" y="225" text-anchor="middle">Follower</text>
  <rect class="box" x="410" y="200" width="90" height="40" rx="6"/><text x="455" y="225" text-anchor="middle">Follower</text>
  <text x="390" y="262" text-anchor="middle" class="small">both accept writes, so conflicts</text>
  <text x="390" y="280" text-anchor="middle" class="small">must be resolved (LWW, merge)</text>

  <rect class="box" x="600" y="36" width="100" height="34" rx="6"/><text x="650" y="58" text-anchor="middle">Client</text>
  <path class="line" d="M630 70 L572 148" marker-end="url(#arr-rep-1)"/>
  <path class="line" d="M650 70 V148" marker-end="url(#arr-rep-1)"/>
  <path class="line dashed" d="M670 70 L728 148" marker-end="url(#arr-rep-1)"/>
  <rect class="box ok" x="535" y="150" width="66" height="40" rx="6"/><text x="568" y="175" text-anchor="middle">Node A</text>
  <rect class="box ok" x="617" y="150" width="66" height="40" rx="6"/><text x="650" y="175" text-anchor="middle">Node B</text>
  <rect class="box bad" x="699" y="150" width="66" height="40" rx="6"/><text x="732" y="168" text-anchor="middle">Node C</text><text x="732" y="183" text-anchor="middle" class="small">stale</text>
  <text x="650" y="214" text-anchor="middle" class="small">N=3 copies, W=2 acks = write OK</text>
  <text x="650" y="232" text-anchor="middle" class="small">R=2 replies = read</text>
  <text x="650" y="262" text-anchor="middle" class="small">W + R &gt; N: the sets overlap</text>
  <text x="650" y="280" text-anchor="middle" class="small">read repair fixes stale copies</text>
</svg>
<figcaption>Single leader is the default for relational databases. Multi-leader shows up across regions and in offline-first apps. Leaderless comes from Amazon's Dynamo paper and lives on in Cassandra and its relatives.</figcaption>
</figure>

<h3>Single leader (leader-follower, primary-replica)</h3>
<p>One node, the <strong>leader</strong>, accepts every write. It records each change in a log, applies it locally, and streams the log to its <strong>followers</strong>. Each follower replays the log in the same order, so it ends up in the same state, just a little later. Reads can go to the leader or to any follower (see <a href="#read-replicas">Read Replicas</a> for routing reads in practice).</p>
<p>This is the model behind PostgreSQL streaming replication, MySQL replication, MongoDB replica sets and Kafka partitions. It is popular because there are no write conflicts: one node decides the order of all writes. The costs are that write throughput is capped by one machine, and that someone has to pick a new leader when the leader dies (see <a href="#leader-election">Leader Election</a> and <a href="#failover">Failover</a>).</p>

<h3>What exactly gets shipped</h3>
<ul>
  <li><strong>Statements.</strong> Send the SQL text (<code>UPDATE … SET seen_at = NOW()</code>) and re-run it on each follower. It's compact, but anything nondeterministic breaks it: <code>NOW()</code>, <code>RAND()</code>, auto-increment under concurrency, triggers. MySQL's old <code>STATEMENT</code> binlog format works this way.</li>
  <li><strong>Physical log (WAL shipping).</strong> Send the storage engine's own write-ahead log: "these bytes changed in this page". PostgreSQL streaming replication does this. It is exact, but tied to the storage format, so primary and standby must run the same major version and architecture.</li>
  <li><strong>Logical (row-based) log.</strong> Send "row with id 42 in <code>orders</code> now has status=paid". It is independent of the storage format, so you can replicate across versions, into a different database, or into a stream for change data capture. MySQL's <code>ROW</code> binlog format and PostgreSQL logical replication (publications and subscriptions) work this way.</li>
</ul>

<h3>Sync, async and semi-sync: when is a write "done"?</h3>
<p>This is the most important knob, because it decides what you lose when the leader dies.</p>
<figure class="diagram">
<svg viewBox="0 0 780 320" role="img" aria-label="Three timelines, one per mode. Async: the client gets OK right after the leader commits; until follower 1 has the change, a leader crash loses an acknowledged write. Semi-sync: the client gets OK after follower 1 has it; follower 2 may still lag, and MySQL falls back to async on timeout. Sync: the client gets OK only after every follower has it, so one slow follower stalls every commit.">
  <text x="20" y="58" class="title">Async</text><text x="20" y="76" class="small">the usual default</text>
  <path class="line" d="M190 60 H760"/>
  <path class="line" d="M230 54 V66"/><path class="line" d="M420 54 V66"/><path class="line" d="M620 54 V66"/>
  <text x="230" y="46" text-anchor="middle" class="small">leader commit</text>
  <text x="420" y="46" text-anchor="middle" class="small">follower 1 has it</text>
  <text x="620" y="46" text-anchor="middle" class="small">follower 2 has it</text>
  <rect class="box bad" x="250" y="56" width="168" height="8"/>
  <rect class="box ok" x="200" y="72" width="100" height="24" rx="5"/><text x="250" y="88" text-anchor="middle" class="small">client gets OK</text>
  <text x="312" y="88" class="small">acked, but lost if the leader dies here</text>

  <text x="20" y="153" class="title">Semi-sync</text><text x="20" y="171" class="small">e.g. MySQL semisync</text>
  <path class="line" d="M190 155 H760"/>
  <path class="line" d="M230 149 V161"/><path class="line" d="M420 149 V161"/><path class="line" d="M620 149 V161"/>
  <text x="230" y="141" text-anchor="middle" class="small">leader commit</text>
  <text x="420" y="141" text-anchor="middle" class="small">follower 1 has it</text>
  <text x="620" y="141" text-anchor="middle" class="small">follower 2 has it</text>
  <rect class="box ok" x="420" y="167" width="100" height="24" rx="5"/><text x="470" y="183" text-anchor="middle" class="small">client gets OK</text>
  <text x="470" y="210" text-anchor="middle" class="small">one copy elsewhere is enough; on timeout MySQL falls back to async</text>

  <text x="20" y="253" class="title">Sync</text><text x="20" y="271" class="small">e.g. Postgres sync standby</text>
  <path class="line" d="M190 255 H760"/>
  <path class="line" d="M230 249 V261"/><path class="line" d="M420 249 V261"/><path class="line" d="M620 249 V261"/>
  <text x="230" y="241" text-anchor="middle" class="small">leader commit</text>
  <text x="420" y="241" text-anchor="middle" class="small">follower 1 has it</text>
  <text x="620" y="241" text-anchor="middle" class="small">follower 2 has it</text>
  <rect class="box ok" x="620" y="267" width="100" height="24" rx="5"/><text x="670" y="283" text-anchor="middle" class="small">client gets OK</text>
  <text x="560" y="310" text-anchor="middle" class="small">nothing acked is lost, but one slow or dead follower stalls every commit</text>
</svg>
<figcaption>Moving the "OK" to the right buys durability with latency. The red bar is the window in which a leader crash loses a write the client was already told succeeded.</figcaption>
</figure>
<ul>
  <li><strong>Asynchronous.</strong> The leader commits locally and answers. Followers catch up when they can. Writes are fast and a slow follower can't hurt the leader, but if the leader dies, every write the followers hadn't received yet is lost, even though clients were told "OK". This is the default in PostgreSQL (no <code>synchronous_standby_names</code>), MySQL and most managed read replicas.</li>
  <li><strong>Synchronous.</strong> The leader waits for followers before answering. In PostgreSQL, <code>synchronous_commit</code> picks how far "has it" goes: <code>remote_write</code> (written to the standby's OS), <code>on</code> (flushed to the standby's disk, the default) or <code>remote_apply</code> (applied, so it is visible to queries there). Waiting for <em>all</em> followers means one sick follower stops all writes, so in practice you wait for some of them: <code>synchronous_standby_names = 'ANY 1 (a, b)'</code> waits for any one of two.</li>
  <li><strong>Semi-synchronous.</strong> Wait for at least one follower, not all. In MySQL, the source blocks the commit until a replica confirms it has written the transaction to its relay log and flushed it to disk. The replica doesn't have to apply it first. By default (<code>rpl_semi_sync_source_wait_point = AFTER_SYNC</code>) the source waits after syncing its binary log and before committing in the storage engine, so other clients can't see a write that no replica has. If no replica answers within <code>rpl_semi_sync_source_timeout</code> (default 10,000 ms), the source silently falls back to async. Alert on that.</li>
</ul>
<pre><code># primary: postgresql.conf  (not executed here)
wal_level = replica
synchronous_standby_names = 'ANY 1 (replica_a, replica_b)'
synchronous_commit = on        # wait until 1 of the 2 has flushed the WAL

-- one transaction that may be lost on failover, by choice:
BEGIN;
SET LOCAL synchronous_commit TO off;
INSERT INTO page_views (page, at) VALUES ('/home', now());
COMMIT;</code></pre>
<p>In PostgreSQL the setting is per transaction: pay for durability on payments, skip it for page-view counters.</p>

<h3>Replication lag and what it does to readers</h3>
<p>With async replication, a follower is always some distance behind: usually milliseconds, sometimes minutes during a bulk import, a long transaction, or a follower under heavy read load. Reading from followers then breaks guarantees that users assume without thinking:</p>
<ul>
  <li><strong>Read-your-writes.</strong> A user saves their profile, the page reloads from a follower, and the old profile comes back. They think the save failed, and they save again.</li>
  <li><strong>Monotonic reads.</strong> Two refreshes hit two followers at different lag. The second shows <em>older</em> data than the first, so a new comment appears and then disappears.</li>
</ul>
<p>The fixes (send a user's reads to the leader for a while after they write, carry a log position token, pin a session to one replica) belong to <a href="#eventual-consistency">Eventual Consistency</a>. The example below shows both anomalies happening.</p>

<h3>Failover: where async loses data</h3>
<p>When the leader dies, a follower is promoted. With async replication the new leader may be missing the last few writes, and they are gone. Clients were told those writes succeeded. Worse, if the old leader comes back and still has them, they now conflict with whatever the new leader accepted. Systems handle that by throwing them away. MongoDB's docs say it plainly: data can be rolled back if the primary steps down before its writes reach a secondary. Its implicit default write concern is <code>w: "majority"</code>, so the write is acknowledged only once a majority has it, which is what survives an election. (Some arbiter setups fall back to <code>w: 1</code>.)</p>
<p>Kafka makes the same trade explicit. Each partition has a leader and an <strong>in-sync replica set</strong> (ISR). A follower that hasn't caught up within <code>replica.lag.time.max.ms</code> (default 30 s) drops out of the ISR. A producer with <code>acks=all</code> waits for every ISR member, and <code>min.insync.replicas</code> (default 1, commonly set to 2) refuses writes when too few replicas are in sync. If every in-sync replica dies, <code>unclean.leader.election.enable</code> (default <code>false</code>) decides whether an out-of-sync replica may take over and lose data, or the partition stays unavailable. That is the durability-vs-availability choice as a single flag.</p>

<h3>Multi-leader</h3>
<p>Several nodes accept writes, usually one per region (or one per device, for offline-first apps and collaborative editors), and replicate to each other asynchronously. Users write to a nearby leader with low latency, and each region keeps working when the link between them is down. The price is <strong>write conflicts</strong>: two leaders can change the same row at the same time, and neither knew about the other. You need a rule for every conflict: last-writer-wins (which silently drops one write), merging, or keeping both versions for the app to resolve. Those rules are covered in <a href="#eventual-consistency">Eventual Consistency</a>. Auto-increment keys, unique constraints and triggers all break in surprising ways, so prefer to route each record's writes to one "home" region. If you only need failover, single leader with automatic election is much simpler.</p>

<h3>Leaderless (Dynamo-style)</h3>
<p>Amazon's Dynamo paper (DeCandia et al., SOSP 2007) dropped the leader altogether. The client, or a coordinator node acting for it, sends each write to all <strong>N</strong> replicas of a key and treats it as successful once <strong>W</strong> of them acknowledge. A read asks <strong>R</strong> replicas and keeps the newest version. When <strong>W + R &gt; N</strong>, every read set overlaps every write set, so at least one replica in any read has the latest acknowledged write. A common setting is N=3, W=2, R=2. Lowering W or R makes operations faster and more available, and lets reads miss writes.</p>
<p>Replicas that missed a write are repaired three ways:</p>
<ul>
  <li><strong>Read repair</strong>: when a read sees an older version on one replica, it writes the newer one back.</li>
  <li><strong>Hinted handoff</strong>: if a target replica is down, another node stores the write with a "hint" naming the intended owner, and hands it over when the owner returns. Dynamo combines this with a <em>sloppy quorum</em>: it uses the first N <em>healthy</em> nodes rather than a strict fixed set.</li>
  <li><strong>Anti-entropy</strong>: a background process compares replicas (Dynamo and Cassandra use Merkle trees) and copies over what's missing. Cassandra's docs call read repair and hints best-effort; regular repair is what guarantees convergence.</li>
</ul>
<p>Cassandra exposes this per query as a <strong>consistency level</strong>: <code>ONE</code>, <code>TWO</code>, <code>THREE</code>, <code>QUORUM</code>, <code>ALL</code>, <code>LOCAL_QUORUM</code>, <code>EACH_QUORUM</code>, <code>LOCAL_ONE</code> and <code>ANY</code> (writes only). Concurrent writes to the same column are resolved by last-write-wins on timestamps, which is why clock quality matters there (see <a href="#clock-skew">Clock Skew</a>).</p>

<h3>Comparison of real systems</h3>
<table>
  <tr><th>System</th><th>Topology</th><th>What is shipped</th><th>Default ack</th><th>Durability knob</th></tr>
  <tr><td>PostgreSQL streaming</td><td>single leader</td><td>physical WAL</td><td>async</td><td><code>synchronous_standby_names</code> (<code>FIRST n</code> / <code>ANY n</code>) + <code>synchronous_commit</code> per transaction</td></tr>
  <tr><td>MySQL / MariaDB</td><td>single leader (multi-source and group replication exist)</td><td>binlog: <code>ROW</code>, <code>STATEMENT</code> or <code>MIXED</code></td><td>async</td><td>semi-sync plugin: wait for N replica receipts, fall back to async on timeout</td></tr>
  <tr><td>MongoDB replica set</td><td>single leader (primary), automatic election</td><td>oplog (logical)</td><td><code>w: "majority"</code> (implicit default; arbiters can change it)</td><td>write concern per operation; read concern and read preference for reads</td></tr>
  <tr><td>Cassandra / ScyllaDB</td><td>leaderless</td><td>the write itself, to N replicas</td><td>set per query (each driver has its own default; check yours)</td><td>consistency level per query; LWW per column</td></tr>
  <tr><td>Kafka</td><td>single leader per partition</td><td>log segments (followers fetch)</td><td>producer <code>acks=all</code> (the default since Kafka 3.0)</td><td><code>min.insync.replicas</code>, <code>unclean.leader.election.enable</code></td></tr>
</table>

<h2>Example</h2>
<p><strong>A leader with async followers, in Go.</strong> A real database is too big to show, so this is a small in-process model with the same moving parts: a replication log, followers that apply it in order, and a <code>Ship</code> call whose <code>n</code> argument plays the role of lag. It also contains a Dynamo-style quorum read. It uses only the standard library.</p>
<pre><code>package replication

import "fmt"

// Mode is when the leader acknowledges a write to the client.
type Mode int

const (
	Async    Mode = iota // ack after the leader's own write
	SemiSync             // ack after at least one follower has it
	Sync                 // ack after every follower has it
)

type Op struct {
	Index    int
	Key, Val string
}

type Replica struct {
	Name    string
	Data    map[string]string
	Applied int // index of the last log entry applied
}

func newReplica(name string) *Replica {
	return &amp;Replica{Name: name, Data: map[string]string{}}
}

func (r *Replica) apply(op Op) {
	r.Data[op.Key] = op.Val
	r.Applied = op.Index
}

// Cluster is a single-leader setup: all writes go to the leader, which
// appends them to its replication log and ships the log to followers.
type Cluster struct {
	Mode      Mode
	Leader    *Replica
	Followers []*Replica
	log       []Op
}

func NewCluster(mode Mode, followers ...string) *Cluster {
	c := &amp;Cluster{Mode: mode, Leader: newReplica("leader")}
	for _, f := range followers {
		c.Followers = append(c.Followers, newReplica(f))
	}
	return c
}

func (c *Cluster) Write(key, val string) {
	op := Op{Index: len(c.log) + 1, Key: key, Val: val}
	c.log = append(c.log, op)
	c.Leader.apply(op)
	switch c.Mode {
	case Sync:
		for _, f := range c.Followers {
			c.Ship(f, len(c.log))
		}
	case SemiSync:
		c.Ship(c.Followers[0], len(c.log))
	}
	// Async: the client is told "OK" now; followers catch up later.
}

// Ship sends up to n pending log entries to follower f (n models lag).
func (c *Cluster) Ship(f *Replica, n int) {
	for n &gt; 0 &amp;&amp; f.Applied &lt; len(c.log) {
		f.apply(c.log[f.Applied])
		n--
	}
}

// Failover promotes the most up-to-date follower after the leader dies and
// returns the acknowledged writes that never reached it: they are gone.
func (c *Cluster) Failover() (promoted *Replica, lost []Op) {
	promoted = c.Followers[0]
	for _, f := range c.Followers[1:] {
		if f.Applied &gt; promoted.Applied {
			promoted = f
		}
	}
	return promoted, c.log[promoted.Applied:]
}

// Versioned is a value in a leaderless (Dynamo-style) store.
type Versioned struct {
	Val     string
	Version int
}

// QuorumRead asks the given replicas and keeps the highest version. With
// W + R &gt; N, at least one of them is guaranteed to hold the latest write.
func QuorumRead(replicas []map[string]Versioned, key string) Versioned {
	var best Versioned
	for _, r := range replicas {
		if v, ok := r[key]; ok &amp;&amp; v.Version &gt; best.Version {
			best = v
		}
	}
	return best
}

func (op Op) String() string { return fmt.Sprintf("#%d %s=%s", op.Index, op.Key, op.Val) }</code></pre>
<p>The tests are Go <code>Example</code> functions, so <code>go test</code> fails if the printed output doesn't match the <code>// Output:</code> comment exactly. Every output below is real.</p>
<pre><code>package replication

import "fmt"

func ExampleCluster_lagAnomalies() {
	c := NewCluster(Async, "f1", "f2")
	c.Write("bio", "v1")
	c.Ship(c.Followers[0], 10)
	c.Ship(c.Followers[1], 10)

	c.Write("bio", "v2") // the user edits their profile
	c.Ship(c.Followers[0], 1)
	// f2 is behind (busy, far away, or replaying a big transaction)

	f1, f2 := c.Followers[0], c.Followers[1]
	fmt.Println("leader:", c.Leader.Data["bio"])
	fmt.Println("read 1 via f1:", f1.Data["bio"])
	fmt.Println("read 2 via f2:", f2.Data["bio"], "&lt;- went back in time (monotonic reads)")
	fmt.Printf("lag: f1=%d f2=%d entries&#92;n", c.Leader.Applied-f1.Applied, c.Leader.Applied-f2.Applied)
	// Output:
	// leader: v2
	// read 1 via f1: v2
	// read 2 via f2: v1 &lt;- went back in time (monotonic reads)
	// lag: f1=0 f2=1 entries
}

func ExampleCluster_Failover() {
	for _, mode := range []Mode{Async, SemiSync} {
		c := NewCluster(mode, "f1", "f2")
		for i := 1; i &lt;= 5; i++ {
			c.Write(fmt.Sprintf("order-%d", i), "paid")
		}
		c.Ship(c.Followers[1], 2) // background shipping got this far...
		// ...and then the leader's disk dies. Every write above was acked.
		promoted, lost := c.Failover()
		fmt.Printf("%-8s promoted %s at #%d, lost %d acked writes %v&#92;n",
			[]string{"async", "semisync"}[mode], promoted.Name, promoted.Applied, len(lost), lost)
	}
	// Output:
	// async    promoted f2 at #2, lost 3 acked writes [#3 order-3=paid #4 order-4=paid #5 order-5=paid]
	// semisync promoted f1 at #5, lost 0 acked writes []
}

func ExampleQuorumRead() {
	// N=3 replicas. A write with W=2 reached A and B; C missed it.
	a := map[string]Versioned{"cart": {"[book, pen]", 2}}
	b := map[string]Versioned{"cart": {"[book, pen]", 2}}
	cc := map[string]Versioned{"cart": {"[book]", 1}}

	fmt.Println("R=1 from C:   ", QuorumRead([]map[string]Versioned{cc}, "cart"))
	fmt.Println("R=2 from B, C:", QuorumRead([]map[string]Versioned{b, cc}, "cart"))
	fmt.Println("R=2 from A, C:", QuorumRead([]map[string]Versioned{a, cc}, "cart"))
	// Output:
	// R=1 from C:    {[book] 1}
	// R=2 from B, C: {[book, pen] 2}
	// R=2 from A, C: {[book, pen] 2}
}</code></pre>
<p>Real output of <code>go test -v</code>:</p>
<pre><code>=== RUN   ExampleCluster_lagAnomalies
--- PASS: ExampleCluster_lagAnomalies (0.00s)
=== RUN   ExampleCluster_Failover
--- PASS: ExampleCluster_Failover (0.00s)
=== RUN   ExampleQuorumRead
--- PASS: ExampleQuorumRead (0.00s)
PASS</code></pre>
<p>Read the results in order. The first example breaks monotonic reads: two reads in a row went from <code>v2</code> back to <code>v1</code>, just because they hit different followers. The second is the important one: the same five acknowledged payments, the same crash. In async mode, three of them vanish on failover. In semi-sync mode none do, because the leader didn't answer until a follower had each write. The third shows the quorum rule: R=1 can land on the stale node, while any R=2 overlaps the W=2 write set and finds version 2.</p>

<p><strong>Real-world scenario.</strong> A ticketing service runs PostgreSQL with a primary in one zone and two async standbys in other zones. Normal lag is under 50 ms. At 20:00 a concert goes on sale and writes jump to 3,000 transactions per second. A standby that is also serving heavy read traffic falls 4 s behind. Two things go wrong. First, buyers who just paid reload "My tickets" from that standby and see nothing, and some pay again. Routing each user's reads to the primary for a short while after a write, or using a log position token, fixes that. Second, at 20:07 the primary's host dies. The automation promotes the standby with the least lag, which is still about 0.3 s behind: roughly 900 acknowledged transactions at that rate, now gone, for tickets people believe they own. The team's fix is <code>synchronous_standby_names = 'ANY 1 (standby_a, standby_b)'</code>. Commits now wait for one of two standbys to flush, which costs a cross-zone round trip of a millisecond or two, and losing one standby doesn't block writes. They also add an alert on replication lag, and on the number of synchronous standbys dropping to zero.</p>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>Thinking a replica is a backup.</strong> Replication copies mistakes instantly. A <code>DELETE</code> without a <code>WHERE</code>, or a bad migration, reaches every follower within milliseconds. You still need point-in-time backups (see <a href="#backups">Backups</a>).</li>
  <li><strong>Forgetting that async failover loses acknowledged writes.</strong> "We have three replicas" doesn't mean "no data loss". With async replication, promotion throws away whatever the new leader hadn't received. Decide per operation which writes must wait for a replica.</li>
  <li><strong>Synchronous to all followers.</strong> One slow disk or one network blip on any follower now stalls every write in the system. Use quorum-style sync (<code>ANY 1</code>, <code>w: "majority"</code>, <code>min.insync.replicas=2</code> with 3 replicas).</li>
  <li><strong>Semi-sync that quietly isn't.</strong> MySQL semi-sync falls back to async after the timeout and keeps running. Without an alert on that state, you believe you have a guarantee you lost weeks ago.</li>
  <li><strong>Reading from followers on every request.</strong> Read-after-write and monotonic read bugs then show up as "the save button doesn't work" tickets. Decide which reads may be stale, and route the rest to the leader or use session guarantees.</li>
  <li><strong>Not watching lag.</strong> Lag grows silently during bulk jobs and long transactions. Track it (in seconds and in bytes or log position) on every follower, and take lagging replicas out of the read pool. Big lag also makes failover lose more.</li>
  <li><strong>Assuming W + R &gt; N means linearizable.</strong> Sloppy quorums, concurrent writes resolved by timestamps, and partial write failures still let a reader see an old value after a newer one. Quorums reduce staleness; they don't remove it.</li>
</ul>

<div class="callout warn"><strong>"OK" from an async leader means "written on one machine".</strong> If that machine dies before shipping the change, the write is gone, and the client was told it succeeded. Know which of your writes are in that state, and make the ones that matter wait for a second copy.</div>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>Replication buys durability, read scale and locality. All the complexity comes from changes and from deciding when a write is "done".</li>
  <li>Single leader avoids conflicts; multi-leader and leaderless trade conflicts for write availability and latency.</li>
  <li>Async is fast and loses acknowledged writes on failover. Semi-sync or quorum-sync (wait for some, not all) is the usual middle ground.</li>
  <li>Reading from lagging followers breaks read-your-writes and monotonic reads. Plan which reads tolerate that, and monitor lag.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#read-replicas">Read Replicas</a> · <a href="#leader-election">Leader Election</a> · <a href="#eventual-consistency">Eventual Consistency</a> · <a href="#failover">Failover</a> · <a href="#cap-theorem">CAP Theorem</a> · <a href="#network-partitions">Network Partitions</a></p>
`;
CONTENT["leader-election"] = `
<p class="tldr"><strong>TL;DR</strong>: Leader election makes a group of nodes agree that exactly one of them does a job: accepts writes, runs the scheduler, owns a partition. When that node dies, the rest pick a new one. Agreeing is the easy part. The hard part is the <em>old</em> leader that doesn't know it was replaced. So every leader carries a number that only goes up (a term, an epoch, a fencing token), and whatever it writes to checks that number. It's like a club chair with a numbered mandate: once mandate #3 is issued, letters signed under #2 are ignored.</p>

<h2>The problem it solves</h2>
<p>Many jobs must be done by one node at a time, while several copies run for availability:</p>
<ul>
  <li><strong>A single writer.</strong> A replicated database with one leader (see <a href="#replication">Replication</a>) needs exactly one node deciding the order of writes. Two leaders means two diverging histories.</li>
  <li><strong>A singleton worker.</strong> A job that expires unpaid reservations, sends the daily invoice email or compacts a table. Run it on all three pods and customers get three emails (see <a href="#cron-jobs">Cron Jobs</a>).</li>
  <li><strong>An owner per shard.</strong> One consumer per partition, one controller per resource.</li>
</ul>
<p>Running exactly one instance by hand is easy, until that machine dies at 3 a.m. Leader election automates the hand-over. It must give two properties:</p>
<ul>
  <li><strong>Safety</strong>: at most one leader acts at any moment.</li>
  <li><strong>Liveness</strong>: if the leader fails, a new one appears within a bounded time.</li>
</ul>
<p>The catch is that a node can't tell "the leader is dead" from "the leader is slow" or "the link to the leader is down" (see <a href="#network-partitions">Network Partitions</a>). Any election based on timeouts will sometimes elect a new leader while the old one is still alive. A correct design accepts that and makes the old leader harmless.</p>

<h2>How it works</h2>
<p>Every approach has the same three parts: a way to <strong>claim</strong> leadership that only one candidate can win (a majority vote, or an atomic create in a consensus store), a way to <strong>keep</strong> it that needs regular proof of life (heartbeats, lease renewals), and a <strong>number</strong> that increases with each new leader. Raft, the consensus algorithm inside etcd, Consul and many databases, shows all three clearly.</p>

<figure class="diagram">
<svg viewBox="0 0 780 255" role="img" aria-label="Raft server states. A server starts as Follower. If the election timeout fires, it becomes Candidate, increments the term and votes for itself. A Candidate that receives votes from a majority becomes Leader. On a split vote it times out and starts a new election in a new term. A Candidate that finds a current leader or a higher term goes back to Follower. A Leader that sees a higher term steps down to Follower.">
  <defs><marker id="arr-le-1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <text x="30" y="126" text-anchor="middle" class="small">start</text>
  <path class="line" d="M10 135 H58" marker-end="url(#arr-le-1)"/>
  <rect class="box" x="60" y="110" width="140" height="50" rx="8"/><text x="130" y="140" text-anchor="middle" class="title">Follower</text>
  <rect class="box" x="320" y="110" width="140" height="50" rx="8"/><text x="390" y="140" text-anchor="middle" class="title">Candidate</text>
  <rect class="box accent" x="580" y="110" width="140" height="50" rx="8"/><text x="650" y="140" text-anchor="middle" class="title">Leader</text>

  <path class="line" d="M200 128 H318" marker-end="url(#arr-le-1)"/>
  <text x="260" y="104" text-anchor="middle" class="small">election timeout:</text>
  <text x="260" y="119" text-anchor="middle" class="small">term + 1, vote self</text>

  <path class="line" d="M370 110 C 350 60, 430 60, 410 108" marker-end="url(#arr-le-1)"/>
  <text x="390" y="50" text-anchor="middle" class="small">split vote: time out, new term</text>

  <path class="line accent" d="M460 135 H578" marker-end="url(#arr-le-1)"/>
  <text x="520" y="126" text-anchor="middle" class="small">majority votes</text>

  <path class="line" d="M390 160 V195 H160 V162" marker-end="url(#arr-le-1)"/>
  <text x="275" y="188" text-anchor="middle" class="small">finds a leader or a higher term</text>

  <path class="line bad" d="M650 160 V235 H130 V162" marker-end="url(#arr-le-1)"/>
  <text x="390" y="228" text-anchor="middle" class="small">sees a higher term: steps down</text>

  <text x="650" y="90" text-anchor="middle" class="small">sends heartbeats to keep</text>
  <text x="650" y="104" text-anchor="middle" class="small">followers from timing out</text>
</svg>
<figcaption>Raft's three states. The term number is the logical clock of the whole cluster: any message carrying a higher term makes the receiver update its own term and step down to follower.</figcaption>
</figure>

<h3>Raft's election, step by step</h3>
<p>From the Raft paper (Ongaro &amp; Ousterhout, "In Search of an Understandable Consensus Algorithm", 2014):</p>
<ol>
  <li><strong>Terms.</strong> Time is divided into numbered terms. Each term begins with an election, and at most one leader can win a given term. Every message carries the sender's term. A server that sees a higher term adopts it and becomes a follower. A request with a stale term is rejected.</li>
  <li><strong>Heartbeats.</strong> The leader sends regular (possibly empty) AppendEntries messages. A follower that hears nothing for its <strong>election timeout</strong> assumes the leader is gone.</li>
  <li><strong>Campaign.</strong> It increments its term, votes for itself, and asks every other server for a vote.</li>
  <li><strong>Voting.</strong> Each server votes for at most one candidate per term, first come first served. It also refuses if its own log is more up to date than the candidate's (the <em>election restriction</em>), so a leader always has every committed entry.</li>
  <li><strong>Winning.</strong> A candidate with votes from a <strong>majority</strong> becomes leader. Two majorities of the same cluster always share a member, and that member votes only once per term, so two leaders can't win the same term.</li>
  <li><strong>Split votes.</strong> If nobody wins, candidates time out and try again in a new term. Raft makes this rare by choosing each timeout <strong>randomly</strong> from a range; the paper's example is 150–300 ms. Usually one server times out first and wins before anyone else starts.</li>
</ol>
<p>The paper states the timing requirement as <code>broadcastTime ≪ electionTimeout ≪ MTBF</code>: the timeout must be much longer than a round of messages (or healthy leaders get deposed), and much shorter than the average time between server failures (or the cluster is often leaderless). It gives 0.5–20 ms for broadcast time, so election timeouts land between 10 ms and 500 ms. Across data centers, real deployments use longer timeouts. Some implementations, including the <code>hashicorp/raft</code> library used below, add a <strong>pre-vote</strong> phase: a node first asks whether it <em>could</em> win before raising its term, so a node that was cut off can't disrupt a healthy cluster when it rejoins.</p>
<p>Because a majority is needed, a 3-node cluster survives 1 failure and a 5-node cluster survives 2. A 4-node cluster also survives only 1, which is why clusters have odd sizes.</p>

<h3>Leader election as a service: leases in a consensus store</h3>
<p>Your application usually shouldn't implement Raft. It borrows an election from a store that already runs one, by creating a key that is tied to a <strong>lease</strong> or <strong>session</strong> that expires unless renewed.</p>
<ul>
  <li><strong>etcd.</strong> The Go client's <code>concurrency</code> package has <code>NewSession</code> (a lease kept alive in the background, TTL 60 s by default, set with <code>WithTTL</code>) and <code>NewElection(session, prefix)</code>. <code>Campaign</code> blocks until you are leader; <code>Resign</code> gives it up; <code>Leader</code> and <code>Observe</code> let others see who leads. <code>Rev()</code> returns the creation revision of your leader key. etcd revisions increase for every write in the cluster, so a newer leader always has a bigger <code>Rev()</code>: a ready-made fencing token.</li>
  <li><strong>ZooKeeper.</strong> The official recipe: each candidate creates an <code>EPHEMERAL</code> + <code>SEQUENCE</code> znode under <code>/election</code>. The one with the smallest sequence number is leader. Each other candidate watches only the next smaller znode, not the leader's, to avoid a "herd effect" of every node waking at once. Ephemeral znodes disappear when their session dies, which triggers the hand-over.</li>
  <li><strong>Consul</strong> does the same with sessions and a KV "acquire".</li>
</ul>
<pre><code>// Not executed here: needs a running etcd cluster.
cli, _ := clientv3.New(clientv3.Config{Endpoints: []string{"etcd-0:2379"}})
sess, _ := concurrency.NewSession(cli, concurrency.WithTTL(10)) // lease, kept alive in the background
e := concurrency.NewElection(sess, "/jobs/expirer")

if err := e.Campaign(ctx, hostname); err != nil { // blocks until we are leader
	return err
}
token := e.Rev() // creation revision of our leader key: grows with every new leader

for {
	select {
	case &lt;-sess.Done(): // lease lost (partition, long pause): stop at once
		return errors.New("lost leadership")
	case &lt;-tick.C:
		expireReservations(ctx, token) // the store rejects tokens older than the newest seen
	}
}</code></pre>
<p>Note the <code>sess.Done()</code> branch. Losing the lease is the normal way leadership ends, and the code must stop doing leader work immediately when it happens.</p>

<h3>Kubernetes Lease objects</h3>
<p>On Kubernetes, controllers and operators use <code>k8s.io/client-go/tools/leaderelection</code> with a <code>Lease</code> object (<code>coordination.k8s.io/v1</code>) as the lock. The leader writes its identity and a renew time into the Lease. Others take over once the lease is older than <code>LeaseDuration</code>. The config has <code>LeaseDuration</code>, <code>RenewDeadline</code>, <code>RetryPeriod</code> and the callbacks <code>OnStartedLeading</code>, <code>OnStoppedLeading</code> and <code>OnNewLeader</code>. The package docs mention core clients defaulting to 15 s, 10 s and 2 s. They are also honest about the limits: the implementation "does not guarantee that only one client is acting as a leader (a.k.a. fencing)". It tolerates clocks that are <em>offset</em> from each other but not clocks that run at different <em>rates</em>.</p>

<h3>Database advisory locks</h3>
<p>If every instance already talks to one PostgreSQL, <code>SELECT pg_try_advisory_lock(42)</code> is the cheapest election there is: whoever gets the lock leads until their session ends. It's fine for a cron-like job that also writes to that same database. Remember the lock lives on one connection: a connection pool can hand you a different connection, and when the connection drops, leadership is gone. See <a href="#pessimistic-locking">Pessimistic Locking</a> and <a href="#distributed-locks">Distributed Locks</a>.</p>

<h3>Split brain and the stale leader</h3>
<p>Every lease-based scheme has the same hole. A leader checks "I still hold the lease", then pauses: a stop-the-world GC, a VM migration, a swap storm, a network cut. While it is frozen, its lease expires and another node is elected. Then it wakes up and finishes its write, still believing it leads. Nothing in the election can prevent this, because the old leader isn't running any code during the pause.</p>
<figure class="diagram">
<svg viewBox="0 0 780 300" role="img" aria-label="Timeline with three rows. Node A is leader in term 2, then is paused or cut off, then wakes still believing it is leader and writes with token 2. Node B is a follower until it sees no heartbeat, wins term 3 and writes with token 3, which the storage accepts and records as max 3. Node A's late write with token 2 is rejected by the storage because 2 is less than 3.">
  <defs><marker id="arr-le-2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <text x="20" y="75" class="title">Node A</text>
  <text x="20" y="165" class="title">Storage</text>
  <text x="20" y="255" class="title">Node B</text>
  <path class="line" d="M100 70 H760" style="stroke: var(--line)"/>
  <path class="line" d="M100 160 H760" style="stroke: var(--line)"/>
  <path class="line" d="M100 250 H760" style="stroke: var(--line)"/>

  <rect class="box ok" x="100" y="58" width="150" height="24" rx="5"/><text x="175" y="75" text-anchor="middle">leader, term 2</text>
  <rect class="box bad" x="250" y="58" width="270" height="24" rx="5"/><text x="385" y="75" text-anchor="middle">paused (GC) or cut off</text>
  <rect class="box" x="520" y="58" width="200" height="24" rx="5"/><text x="620" y="75" text-anchor="middle">wakes, still "leader"</text>

  <rect class="box muted" x="100" y="238" width="300" height="24" rx="5"/><text x="250" y="255" text-anchor="middle">follower</text>
  <rect class="box accent" x="400" y="238" width="360" height="24" rx="5"/><text x="580" y="255" text-anchor="middle">leader, term 3</text>
  <text x="330" y="228" text-anchor="middle" class="small">no heartbeat: election</text>

  <path class="line accent" d="M460 238 V174" marker-end="url(#arr-le-2)"/>
  <text x="466" y="210" class="small">write, token 3</text>
  <rect class="box ok" x="405" y="148" width="110" height="24" rx="5"/><text x="460" y="164" text-anchor="middle" class="small">accepted, max = 3</text>

  <path class="line bad dashed" d="M610 82 V146" marker-end="url(#arr-le-2)"/>
  <text x="616" y="118" class="small">write, token 2</text>
  <rect class="box bad" x="545" y="148" width="130" height="24" rx="5"/><text x="610" y="164" text-anchor="middle" class="small">rejected: 2 &lt; 3</text>

  <text x="760" y="292" text-anchor="end" class="small">time →</text>
</svg>
<figcaption>The election can't stop node A from waking up and writing. Only the resource can, by remembering the highest token it has seen. This is the same idea as fencing in <a href="#distributed-locks">Distributed Locks</a>.</figcaption>
</figure>
<p>The fix is a <strong>fencing token</strong>: a number that is larger for every new leader (Raft's term, etcd's leader key revision, a counter you increment on takeover). The leader attaches it to every write, and the resource rejects any token lower than the highest it has seen. For a database, that can be a <code>WHERE fencing_token &lt;= $1</code> condition, or a column the update compares against. Raft does this internally: followers reject AppendEntries from a leader with a stale term. Your own singleton workers need it explicitly. Old-school clusters solve the same problem with <strong>STONITH</strong> ("shoot the other node in the head"): power off the old leader before the new one starts.</p>

<h3>Choosing an approach</h3>
<table>
  <tr><th>Approach</th><th>Held by</th><th>Failure detected by</th><th>Fencing token</th><th>Good for</th></tr>
  <tr><td>Raft / Paxos inside the system</td><td>majority vote per term</td><td>missing heartbeats, randomized election timeout</td><td>the term, checked on every message</td><td>databases, coordination stores, anything replicating a log</td></tr>
  <tr><td>etcd <code>concurrency.Election</code></td><td>a key bound to a lease</td><td>lease TTL not renewed</td><td><code>Election.Rev()</code></td><td>Go services that need a singleton worker</td></tr>
  <tr><td>ZooKeeper recipe</td><td>smallest ephemeral sequential znode</td><td>session timeout</td><td>sequence number or the znode's zxid</td><td>JVM ecosystems already running ZooKeeper</td></tr>
  <tr><td>Kubernetes <code>Lease</code> + client-go</td><td>holder identity + renew time in a Lease object</td><td>renew time older than <code>LeaseDuration</code></td><td>none built in; the docs say so</td><td>controllers and operators; add your own fencing for side effects</td></tr>
  <tr><td>DB advisory lock</td><td>a lock on one DB connection</td><td>the connection closes</td><td>none; fine when the work is in that same DB</td><td>simple jobs in apps that already share one database</td></tr>
</table>

<h2>Example</h2>
<p><strong>A real Raft election in Go, in one process.</strong> This uses <a href="https://github.com/hashicorp/raft">hashicorp/raft</a> (the library behind Consul and Nomad) with its in-memory transport and store, so there's no network and no disk. Three nodes start; we cut the leader off, watch the others elect a new one in a higher term, and use the term as a fencing token on a tiny "store".</p>
<pre><code>package election

import (
	"fmt"
	"io"
	"sync"
	"time"

	"github.com/hashicorp/raft"
)

// Node is one member of an in-memory Raft cluster.
type Node struct {
	ID   string
	Raft *raft.Raft
	tr   *raft.InmemTransport
}

type noopFSM struct{}

func (noopFSM) Apply(*raft.Log) any                  { return nil }
func (noopFSM) Snapshot() (raft.FSMSnapshot, error) { return nil, fmt.Errorf("not needed") }
func (noopFSM) Restore(io.ReadCloser) error         { return nil }

// NewCluster starts n Raft nodes wired by in-memory transports.
// Only node-0 is bootstrapped; the others learn the config from it.
func NewCluster(n int) ([]*Node, error) {
	nodes := make([]*Node, n)
	var servers []raft.Server
	for i := range nodes {
		id := fmt.Sprintf("node-%d", i)
		addr, tr := raft.NewInmemTransport(raft.ServerAddress(id))
		nodes[i] = &amp;Node{ID: id, tr: tr}
		servers = append(servers, raft.Server{ID: raft.ServerID(id), Address: addr})
	}
	for _, a := range nodes {
		for _, b := range nodes {
			if a != b {
				a.tr.Connect(b.tr.LocalAddr(), b.tr)
			}
		}
	}
	for i, nd := range nodes {
		cfg := raft.DefaultConfig()
		cfg.LocalID = raft.ServerID(nd.ID)
		cfg.HeartbeatTimeout = 100 * time.Millisecond // follower waits this long before campaigning
		cfg.ElectionTimeout = 100 * time.Millisecond
		cfg.LeaderLeaseTimeout = 50 * time.Millisecond // leader steps down if it can't reach a majority
		cfg.CommitTimeout = 10 * time.Millisecond
		cfg.LogOutput = io.Discard
		store := raft.NewInmemStore()
		if i == 0 {
			if err := raft.BootstrapCluster(cfg, store, store, raft.NewInmemSnapshotStore(),
				nd.tr, raft.Configuration{Servers: servers}); err != nil {
				return nil, err
			}
		}
		r, err := raft.NewRaft(cfg, noopFSM{}, store, store, raft.NewInmemSnapshotStore(), nd.tr)
		if err != nil {
			return nil, err
		}
		nd.Raft = r
	}
	return nodes, nil
}

// WaitLeader polls until exactly one reachable node (not in skip) is Leader.
func WaitLeader(nodes []*Node, skip *Node, timeout time.Duration) *Node {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		for _, nd := range nodes {
			if nd != skip &amp;&amp; nd.Raft.State() == raft.Leader {
				return nd
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	return nil
}

// WaitCaughtUp waits until every node has the leader's log (and so the
// cluster config). Nodes that were never told who their peers are can't vote.
func WaitCaughtUp(nodes []*Node, leader *Node) {
	want := leader.Raft.LastIndex()
	for _, nd := range nodes {
		for nd.Raft.LastIndex() &lt; want {
			time.Sleep(5 * time.Millisecond)
		}
	}
}

// Isolate cuts every link to and from nd: a crash, as far as peers can tell.
func Isolate(nd *Node, nodes []*Node) {
	for _, o := range nodes {
		if o != nd {
			nd.tr.Disconnect(o.tr.LocalAddr())
			o.tr.Disconnect(nd.tr.LocalAddr())
		}
	}
}

// Heal reconnects nd to every peer.
func Heal(nd *Node, nodes []*Node) {
	for _, o := range nodes {
		if o != nd {
			nd.tr.Connect(o.tr.LocalAddr(), o.tr)
			o.tr.Connect(nd.tr.LocalAddr(), nd.tr)
		}
	}
}

// FencedStore is an external resource (say, a job table) that remembers
// the highest term it has seen and rejects writes carrying an older one.
type FencedStore struct {
	mu      sync.Mutex
	maxTerm uint64
	Writes  []string
}

func (s *FencedStore) Write(term uint64, what string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if term &lt; s.maxTerm {
		return fmt.Errorf("rejected: term %d &lt; %d", term, s.maxTerm)
	}
	s.maxTerm = term
	s.Writes = append(s.Writes, fmt.Sprintf("term %d: %s", term, what))
	return nil
}</code></pre>
<p>The test plays out the scenario from the timeline above:</p>
<pre><code>package election

import (
	"fmt"
	"testing"
	"time"

	"github.com/hashicorp/raft"
)

func TestFailover(t *testing.T) {
	nodes, err := NewCluster(3)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		for _, nd := range nodes {
			nd.Raft.Shutdown().Error()
		}
	}()

	old := WaitLeader(nodes, nil, 5*time.Second)
	if old == nil {
		t.Fatal("no leader")
	}
	WaitCaughtUp(nodes, old)
	oldTerm := old.Raft.CurrentTerm()
	fmt.Printf("leader: %s, term %d&#92;n", old.ID, oldTerm)

	store := &amp;FencedStore{}
	fmt.Println("old leader writes:", store.Write(oldTerm, "expire reservations"))

	Isolate(old, nodes) // crash, GC pause or partition: peers just stop hearing heartbeats
	start := time.Now()
	nw := WaitLeader(nodes, old, 5*time.Second)
	if nw == nil {
		t.Fatal("no new leader")
	}
	newTerm := nw.Raft.CurrentTerm()
	fmt.Printf("new leader is a different node: %v&#92;n", nw != old)
	fmt.Printf("new term &gt; old term: %v&#92;n", newTerm &gt; oldTerm)
	fmt.Printf("failover under 1s: %v&#92;n", time.Since(start) &lt; time.Second)
	fmt.Println("new leader writes:", store.Write(newTerm, "expire reservations"))

	// The isolated node wakes up still holding its old term and tries again.
	fmt.Println("stale leader writes:", store.Write(oldTerm, "expire reservations"))

	// It cannot reach a majority, so its lease runs out and it steps down.
	for old.Raft.State() == raft.Leader {
		time.Sleep(5 * time.Millisecond)
	}
	fmt.Println("isolated node still leader:", old.Raft.State() == raft.Leader)
	err = old.Raft.Apply([]byte("x"), 100*time.Millisecond).Error()
	fmt.Println("Apply on isolated node:", err)

	Heal(old, nodes)
	for old.Raft.CurrentTerm() &lt; newTerm || old.Raft.State() != raft.Follower {
		time.Sleep(5 * time.Millisecond)
	}
	_, leaderID := old.Raft.LeaderWithID()
	fmt.Printf("after heal: rejoined as %v, follows the new leader: %v&#92;n",
		old.Raft.State(), string(leaderID) == nw.ID)
	fmt.Println("store kept:", store.Writes)
}</code></pre>
<p>Real output of <code>go test -run TestFailover -v</code>. Which of node-1 and node-2 wins term 3 depends on which random timeout fires first, so the test prints facts that hold every time; it passed 40 runs in a row with this exact output:</p>
<pre><code>=== RUN   TestFailover
leader: node-0, term 2
old leader writes: &lt;nil&gt;
new leader is a different node: true
new term &gt; old term: true
failover under 1s: true
new leader writes: &lt;nil&gt;
stale leader writes: rejected: term 2 &lt; 3
isolated node still leader: false
Apply on isolated node: node is not the leader
after heal: rejoined as Follower, follows the new leader: true
store kept: [term 2: expire reservations term 3: expire reservations]
--- PASS: TestFailover (0.97s)
PASS</code></pre>
<p>What happened: node-0 won term 2 and wrote. Once isolated, the other two stopped hearing heartbeats, one of them timed out first and won term 3 with two of three votes. The store then had seen term 3, so node-0's late write with term 2 was rejected even though node-0 had no idea it had been replaced. Shortly after, node-0's own leader lease ran out (it couldn't reach a majority), so it stepped down and refused new writes. After the heal, it saw the higher term and rejoined as a follower.</p>

<p><strong>Real-world scenario.</strong> A booking service runs three replicas of a "reservation expirer" that releases seats held for more than 10 minutes without payment. It uses an etcd election with a 10 s session TTL. One replica becomes leader and scans every 5 s. At 14:02:00 the leader's node is overloaded, its process gets swapped out, and it freezes for 25 s. At 14:02:10 the lease expires; at about 14:02:11 replica 2 wins and starts its own scans. One customer paid for their held seat at 14:02:05, so replica 2 correctly leaves that seat alone. At 14:02:25 the old leader wakes up mid-scan, holding a list it read at 14:01:59, when that seat was still unpaid, and tries to release it. Without fencing, the seat is resold. With the token check (<code>UPDATE seats SET held_by = NULL WHERE id = $1 AND $2 &gt;= last_token</code>), the stale write matches zero rows, the old leader sees <code>sess.Done()</code>, and it stops. Total cost: about 11 s with no expirer running, which nobody noticed.</p>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>Treating "I am leader" as a fact.</strong> It's a belief that was true at some recent moment. Check leadership before each unit of work, stop as soon as the session or lease is lost, and fence every side effect that matters.</li>
  <li><strong>Lease timeouts that are too short.</strong> A 1 s lease on a service with 2 s GC pauses or slow cross-zone links means constant leader churn, each change pausing the work. Size timeouts from measured pause and round-trip times, not hopes.</li>
  <li><strong>…or too long.</strong> A 60 s lease means up to a minute with no leader after a crash. Pick based on how long the job can safely stop.</li>
  <li><strong>Even-sized quorums.</strong> Four nodes tolerate one failure, the same as three, and a 2/2 network split leaves neither side with a majority. Use 3 or 5 voters.</li>
  <li><strong>Rolling your own election on a database row with timestamps.</strong> "Leader if <code>heartbeat_at &gt; now() - 10s</code>" depends on clocks that disagree (see <a href="#clock-skew">Clock Skew</a>) and has races between read and update. Use a consensus store, or at least an atomic compare-and-set with a version column.</li>
  <li><strong>Forgetting the side effects outside the store.</strong> Fencing protects resources that check the token. An email provider or a payment API doesn't. Make those calls idempotent instead (see <a href="#idempotency">Idempotency</a>).</li>
  <li><strong>Leader as a bottleneck.</strong> If all work goes through one leader, you've built a single-node system with failover. Split work by key (one leader per shard) when one node isn't enough.</li>
</ul>

<div class="callout warn"><strong>Two leaders will happen.</strong> Timeouts can't tell a dead leader from a paused one, so for a short window the old and new leader both believe they lead. Design so that this window is harmless: fencing tokens on writes, idempotent side effects, and immediate stop on lost lease.</div>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>An election needs an exclusive claim (majority vote or atomic create), proof of life (heartbeats or leases), and a number that grows with each leader.</li>
  <li>Raft: random election timeouts, one vote per term, majority wins, any higher term makes a leader step down.</li>
  <li>For your own services, borrow an election from etcd, ZooKeeper or a Kubernetes Lease rather than inventing one.</li>
  <li>Fence every write with the term or revision, because a stale leader can always wake up and act.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#distributed-locks">Distributed Locks</a> · <a href="#network-partitions">Network Partitions</a> · <a href="#replication">Replication</a> · <a href="#failover">Failover</a> · <a href="#clock-skew">Clock Skew</a> · <a href="#cron-jobs">Cron Jobs</a></p>
`;
CONTENT["cap-theorem"] = `
<p class="tldr"><strong>TL;DR</strong>: The CAP theorem says that when the network splits your replicas into groups that can't talk, each replica that gets a request must choose: answer now, possibly with stale data (<strong>A</strong>vailable), or refuse or wait until it can be sure it has the latest value (<strong>C</strong>onsistent). You don't get to skip the <strong>P</strong>: partitions happen whether you plan for them or not. It's like two bank branches whose phone line is cut. Each can keep paying out cash and risk an overdraft, or stop paying out until the line is back.</p>

<h2>The problem it solves</h2>
<p>Any system with more than one copy of its data has to decide what happens when those copies can't reach each other. Before CAP, vendors could promise "always consistent, always up, and fault tolerant" at once. CAP shows that this promise can't be kept for the strong meaning of "consistent". It gives you a precise question to ask of every database and every operation you design: <em>during a partition, does this request get an answer, or does it get a guaranteed-fresh answer?</em></p>
<p>The theorem started as a conjecture in Eric Brewer's PODC keynote in 2000. Seth Gilbert and Nancy Lynch proved a formal version in 2002 ("Brewer's conjecture and the feasibility of consistent, available, partition-tolerant web services"). The proof uses narrow definitions, and most confusion about CAP comes from using the letters with looser meanings.</p>

<h2>How it works</h2>
<h3>The three letters, precisely</h3>
<ul>
  <li><strong>C, consistency, means linearizability.</strong> The system behaves as if there were one copy of the data, and every operation takes effect at a single instant between its start and its end. Once a write has completed, every later read, from any client and any node, sees that write or a newer one. This is much stronger than the "C" in ACID, which is about keeping invariants.</li>
  <li><strong>A, availability, means every request to a non-failing node gets a non-error response.</strong> Not "most requests" and not "the service is up". Every node that hasn't crashed must answer. CAP puts no limit on how long the answer takes, which is one reason it says little about real latency.</li>
  <li><strong>P, partition tolerance, means the system keeps its guarantees even when the network drops or delays messages between nodes.</strong> In the proof's model, any number of messages can be lost. A real network does this: see <a href="#network-partitions">Network Partitions</a>.</li>
</ul>

<h3>Why you can't have both C and A during a partition</h3>
<p>The proof needs only two nodes and one value. Both nodes start with <code>x = 0</code>. The link between them is down. A client writes <code>x = 1</code> to N1, and N1 acknowledges it. Now another client asks N2 for <code>x</code>.</p>
<figure class="diagram">
<svg viewBox="0 0 780 300" role="img" aria-label="Two nodes, N1 and N2, with the link between them cut. Client 1 writes x equals 1 to N1. Client 2 reads x from N2, which still has x equals 0. N2 has two options: reply with the stale value 0, which breaks consistency, or refuse or wait, which breaks availability.">
  <defs><marker id="arr-cap-1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <rect class="box" x="60" y="20" width="120" height="36" rx="6"/><text x="120" y="43" text-anchor="middle">Client 1</text>
  <rect class="box" x="600" y="20" width="120" height="36" rx="6"/><text x="660" y="43" text-anchor="middle">Client 2</text>

  <rect class="box ok" x="130" y="110" width="180" height="60" rx="8"/><text x="220" y="134" text-anchor="middle" class="title">N1</text><text x="220" y="154" text-anchor="middle" class="small">x = 1 (new)</text>
  <rect class="box" x="470" y="110" width="180" height="60" rx="8"/><text x="560" y="134" text-anchor="middle" class="title">N2</text><text x="560" y="154" text-anchor="middle" class="small">x = 0 (old)</text>

  <path class="line" d="M120 56 L190 108" marker-end="url(#arr-cap-1)"/>
  <text x="105" y="88" text-anchor="middle" class="small">write x = 1</text>
  <text x="105" y="102" text-anchor="middle" class="small">(acknowledged)</text>
  <path class="line" d="M660 56 L590 108" marker-end="url(#arr-cap-1)"/>
  <text x="685" y="88" text-anchor="middle" class="small">read x</text>

  <path class="line bad dashed" d="M312 140 H468"/>
  <path class="line bad" d="M380 128 L400 152 M400 128 L380 152"/>
  <text x="390" y="118" text-anchor="middle" class="small">partition: x = 1</text>
  <text x="390" y="172" text-anchor="middle" class="small">can't reach N2</text>

  <rect class="box bad" x="320" y="215" width="200" height="50" rx="6"/><text x="420" y="236" text-anchor="middle">Option 1: reply x = 0</text><text x="420" y="254" text-anchor="middle" class="small">stale answer, gives up C</text>
  <rect class="box bad" x="560" y="215" width="200" height="50" rx="6"/><text x="660" y="236" text-anchor="middle">Option 2: refuse or wait</text><text x="660" y="254" text-anchor="middle" class="small">no answer, gives up A</text>
  <path class="line" d="M530 170 L450 213" marker-end="url(#arr-cap-1)"/>
  <path class="line" d="M590 170 L640 213" marker-end="url(#arr-cap-1)"/>
  <text x="150" y="232" text-anchor="middle" class="small">N2 has no way to learn</text>
  <text x="150" y="248" text-anchor="middle" class="small">about x = 1 until the link heals.</text>
  <text x="150" y="264" text-anchor="middle" class="small">There is no third option.</text>
</svg>
<figcaption>The whole proof in one picture. If N2 answers, the answer may be stale. If it must be fresh, N2 can't answer. Gilbert and Lynch formalize exactly this argument.</figcaption>
</figure>
<p>N2 can't tell "nobody wrote anything" apart from "someone wrote, and the message was lost". So it has two choices. It can answer <code>0</code>, which is available but not linearizable, because a completed write is invisible. Or it can refuse, or wait until the link is back, which keeps the guarantee but means a working node gave no answer. That's the whole theorem.</p>

<h3>Why "pick 2 of 3" is misleading</h3>
<p>The popular version, "consistency, availability, partition tolerance: pick two", suggests three equal options: CP, AP or CA. It isn't like that:</p>
<ul>
  <li><strong>P isn't a choice.</strong> A system that spans more than one machine will see messages dropped or delayed. "CA" only describes a system that never has a partition, which in practice means a single node. If a "CA" cluster does get partitioned, it has to give up C or A anyway; it just never decided which.</li>
  <li><strong>The choice only applies during a partition.</strong> When the network is healthy, a system can be both linearizable and available. Brewer made this point himself in "CAP Twelve Years Later" (IEEE Computer, 2012): the "2 of 3" framing is misleading because partitions are rare, and the real design work is in detecting them, deciding what to allow during one, and recovering afterwards.</li>
  <li><strong>Most systems are neither C nor A in the CAP sense.</strong> Martin Kleppmann's 2015 post "Please stop calling databases CP or AP" points out that a single-leader database isn't CAP-available (a client cut off from the leader can't write), and its reads from asynchronous followers aren't linearizable either. Snapshot isolation isn't linearizable by design. ZooKeeper is usually called CP, but its default reads are served locally and aren't linearizable unless you call <code>sync</code> first. Labels hide these details.</li>
  <li><strong>It's per operation, not per database.</strong> Many stores let you choose for each read or write. One table can serve a CP-style "book this seat" write and an AP-style "show me roughly how many seats are left" read.</li>
</ul>

<h3>What a CP system does, and what an AP system does</h3>
<p>A system that keeps C usually requires a <strong>majority quorum</strong>: an operation succeeds only if more than half of the replicas take part. Any two majorities share at least one node, so a read quorum always overlaps the last write quorum. During a partition, the side holding a majority keeps working, and the minority side refuses. That's what Raft-based stores such as etcd and Consul do (see <a href="#leader-election">Leader Election</a>).</p>
<p>A system that keeps A lets every side keep accepting reads and writes on whatever replicas it can reach. The copies diverge. When the partition heals, the system has to merge them: last-writer-wins (and lose a write), keep both as siblings for the application to resolve, or use data types that merge automatically (CRDTs). That's the territory of <a href="#eventual-consistency">Eventual Consistency</a>.</p>

<h3>PACELC: the part CAP leaves out</h3>
<p>Partitions are rare. Latency is constant. Daniel Abadi's 2012 paper "Consistency Tradeoffs in Modern Distributed Database System Design: CAP is Only Part of the Story" (IEEE Computer) extends CAP into <strong>PACELC</strong>: if there is a <strong>P</strong>artition, choose <strong>A</strong> or <strong>C</strong>; <strong>E</strong>lse, in normal operation, choose <strong>L</strong>atency or <strong>C</strong>onsistency. Waiting for remote replicas to confirm every write costs a network round trip on every request, even when nothing is broken. Abadi argues that this everyday trade-off shaped real systems more than partition behavior did.</p>
<figure class="diagram">
<svg viewBox="0 0 780 330" role="img" aria-label="PACELC decision tree. Is there a partition? If yes, choose availability (answer anyway, PA) or consistency (minority refuses, PC). If no, choose latency (reply from a local replica, EL) or consistency (wait for replicas, EC). Examples from Abadi's 2012 paper: PA/EL Dynamo, Cassandra, Riak. PC/EC VoltDB/H-Store, Megastore. PA/EC MongoDB. PC/EL PNUTS.">
  <defs><marker id="arr-cap-2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <rect class="box accent" x="280" y="15" width="220" height="40" rx="6"/><text x="390" y="40" text-anchor="middle" class="title">Is there a partition?</text>
  <rect class="box" x="60" y="100" width="250" height="40" rx="6"/><text x="185" y="125" text-anchor="middle">Availability or Consistency?</text>
  <rect class="box" x="470" y="100" width="250" height="40" rx="6"/><text x="595" y="125" text-anchor="middle">Latency or Consistency?</text>
  <path class="line" d="M330 55 L200 98" marker-end="url(#arr-cap-2)"/><text x="245" y="70" text-anchor="middle" class="small">yes (P)</text>
  <path class="line" d="M450 55 L580 98" marker-end="url(#arr-cap-2)"/><text x="545" y="70" text-anchor="middle" class="small">no (E = else)</text>

  <rect class="box ok" x="30" y="180" width="145" height="50" rx="6"/><text x="102" y="201" text-anchor="middle" class="title">PA</text><text x="102" y="219" text-anchor="middle" class="small">answer, may be stale</text>
  <rect class="box bad" x="195" y="180" width="145" height="50" rx="6"/><text x="267" y="201" text-anchor="middle" class="title">PC</text><text x="267" y="219" text-anchor="middle" class="small">minority refuses</text>
  <rect class="box ok" x="440" y="180" width="145" height="50" rx="6"/><text x="512" y="201" text-anchor="middle" class="title">EL</text><text x="512" y="219" text-anchor="middle" class="small">reply from nearest</text>
  <rect class="box bad" x="605" y="180" width="145" height="50" rx="6"/><text x="677" y="201" text-anchor="middle" class="title">EC</text><text x="677" y="219" text-anchor="middle" class="small">wait for replicas</text>
  <path class="line" d="M150 140 L110 178" marker-end="url(#arr-cap-2)"/>
  <path class="line" d="M220 140 L260 178" marker-end="url(#arr-cap-2)"/>
  <path class="line" d="M560 140 L520 178" marker-end="url(#arr-cap-2)"/>
  <path class="line" d="M630 140 L670 178" marker-end="url(#arr-cap-2)"/>

  <rect class="box muted" x="30" y="250" width="720" height="70" rx="8"/>
  <text x="390" y="270" text-anchor="middle" class="small">Abadi's 2012 examples (default settings at the time):</text>
  <text x="210" y="292" text-anchor="middle">PA/EL: Dynamo, Cassandra, Riak</text>
  <text x="570" y="292" text-anchor="middle">PC/EC: VoltDB/H-Store, Megastore</text>
  <text x="210" y="312" text-anchor="middle">PA/EC: MongoDB</text>
  <text x="570" y="312" text-anchor="middle">PC/EL: PNUTS</text>
</svg>
<figcaption>CAP only covers the left branch. Most of the time you're on the right branch, paying (or not paying) a round trip for consistency on every request.</figcaption>
</figure>

<h3>Real systems let you choose per operation</h3>
<p>Because the trade-off is per request, modern stores expose it as a setting. A few examples:</p>
<ul>
  <li><strong>Cassandra</strong> takes a consistency level on every query. With replication factor N, reading and writing at <code>QUORUM</code> makes R + W &gt; N, so a read overlaps the last quorum write. <code>ONE</code> keeps answering as long as a single replica is reachable. Conflicting writes are still resolved by timestamp (last-writer-wins), so clock skew matters (see <a href="#clock-skew">Clock Skew</a>). For compare-and-set, lightweight transactions (<code>IF NOT EXISTS</code>) run Paxos.</li>
  <li><strong>DynamoDB</strong> reads are eventually consistent by default. Setting <code>ConsistentRead</code> to true on <code>GetItem</code>, <code>Query</code> or <code>Scan</code> returns the latest successful write, but only on tables and local secondary indexes, not global secondary indexes or streams. Global tables default to multi-Region eventual consistency (MREC), resolving conflicts with last-writer-wins. They can instead be created with multi-Region strong consistency (MRSC), which replicates each write synchronously to another Region before it returns, at the cost of higher write latency. The mode can't be changed after creation.</li>
  <li><strong>MongoDB</strong> uses one primary per replica set. Write concern <code>w: "majority"</code> acknowledges a write only once a majority has it. Read concern <code>"majority"</code> returns only majority-acknowledged data, and <code>"linearizable"</code> (primary only) also confirms the node is still the primary, because during a partition an old primary can briefly believe it still leads. Writes accepted by that old primary with a weaker write concern are rolled back later.</li>
</ul>
<pre><code>-- Cassandra (CQL shell). RF = 3 per data center.
CONSISTENCY ONE;           -- any single replica answers: stays up, may be stale
CONSISTENCY QUORUM;        -- 2 of 3 replicas: R + W &gt; N, read sees the last quorum write
CONSISTENCY LOCAL_QUORUM;  -- quorum inside the local data center only
-- Lightweight transactions use Paxos; their reads use SERIAL / LOCAL_SERIAL.
INSERT INTO seats (show_id, seat, holder) VALUES (7, 'A12', 'ana') IF NOT EXISTS;</code></pre>
<pre><code>// MongoDB driver options (not executed here).
writeConcern: { w: "majority" }   // ack only after a majority of the replica set has it
readConcern:  { level: "majority" }      // only data a majority has acknowledged
readConcern:  { level: "linearizable" }  // primary only; checks it is still primary</code></pre>

<h3>How real systems behave under a partition</h3>
<table>
  <tr><th>System</th><th>Minority side during a partition</th><th>Reads</th><th>Knob</th></tr>
  <tr><td>Single-leader SQL (Postgres, MySQL) with async replicas</td><td>Can't write if cut off from the leader. Promoting a replica there risks two leaders and lost writes.</td><td>Leader reads are fresh; replica reads can lag.</td><td>Synchronous replication trades write latency (and availability) for no data loss on failover.</td></tr>
  <tr><td>etcd, Consul (Raft); ZooKeeper (Zab)</td><td>Refuses writes. Only the majority side can elect a leader and commit.</td><td>etcd: linearizable by default, serializable (local, maybe stale) on request. ZooKeeper: local by default, <code>sync</code> first for fresh.</td><td>Read mode per request.</td></tr>
  <tr><td>Cassandra (Dynamo-style)</td><td>Keeps serving if enough replicas for the chosen level are reachable.</td><td>Depends on level; <code>ONE</code> can be stale.</td><td>Consistency level per query; LWT for compare-and-set.</td></tr>
  <tr><td>DynamoDB</td><td>Managed by AWS inside a Region; global tables (MREC) keep accepting writes in every Region.</td><td>Eventual by default; <code>ConsistentRead</code> for latest.</td><td>Per read; per global table (MREC vs MRSC).</td></tr>
  <tr><td>MongoDB replica set</td><td>A primary that loses the majority steps down; the majority elects a new one.</td><td>Primary by default; secondaries can lag.</td><td>Write concern, read concern, read preference.</td></tr>
  <tr><td>Spanner</td><td>Paxos groups need a majority; a minority can't commit.</td><td>Strong reads, or stale reads at a past timestamp.</td><td>Strong vs bounded/exact staleness reads.</td></tr>
</table>
<p>Notice the pattern. "CP" or "AP" isn't a property of the product. It's a property of the operation you run, at the settings you chose.</p>

<h2>Example</h2>
<p><strong>A 3-replica register in Go, in CP mode and in AP mode.</strong> The simulated network can split the replicas into groups. In CP mode, an operation needs a majority (2 of 3) of reachable nodes. In AP mode, every node answers from what its side knows. On heal, both modes run anti-entropy with last-writer-wins and report any acknowledged write that disappeared. Each copy keeps the history of writes it has seen, only so the simulation can report what was lost.</p>
<pre><code>// Package capsim simulates 3 replicas of one register behind a network that
// can partition, in either CP mode (majority quorum) or AP mode (local writes).
package capsim

import (
	"fmt"
	"sort"
)

type Mode string

const (
	CP Mode = "CP"
	AP Mode = "AP"
)

type version struct {
	n    int    // logical counter
	node string // tie-breaker: the node that took the write
}

func (a version) less(b version) bool {
	return a.n &lt; b.n || (a.n == b.n &amp;&amp; a.node &lt; b.node)
}

type replica struct {
	val  string
	ver  version
	hist []string // every write this copy has seen, oldest first
}

type Cluster struct {
	mode  Mode
	nodes map[string]*replica
	side  map[string]int // nodes on the same side can talk
}

func NewCluster(mode Mode, names ...string) *Cluster {
	c := &amp;Cluster{mode: mode, nodes: map[string]*replica{}, side: map[string]int{}}
	for _, n := range names {
		c.nodes[n] = &amp;replica{}
	}
	return c
}

// Partition splits the network. Nodes in different groups can't exchange messages.
func (c *Cluster) Partition(groups ...[]string) {
	for i, g := range groups {
		for _, n := range g {
			c.side[n] = i
		}
	}
}

func (c *Cluster) reachable(from string) []string {
	var out []string
	for n := range c.nodes {
		if c.side[n] == c.side[from] {
			out = append(out, n)
		}
	}
	sort.Strings(out)
	return out
}

func (c *Cluster) quorum() int { return len(c.nodes)/2 + 1 }

// newest returns the highest-versioned replica among the given nodes.
func (c *Cluster) newest(names []string) *replica {
	best := c.nodes[names[0]]
	for _, n := range names[1:] {
		if best.ver.less(c.nodes[n].ver) {
			best = c.nodes[n]
		}
	}
	return best
}

// Write stores value through node via.
func (c *Cluster) Write(via, value string) error {
	peers := c.reachable(via)
	if c.mode == CP &amp;&amp; len(peers) &lt; c.quorum() {
		return fmt.Errorf("unavailable: %s reaches %d of %d nodes, needs %d",
			via, len(peers), len(c.nodes), c.quorum())
	}
	// CP: any two majorities overlap, so the max version seen here is the latest.
	// AP: only this side's versions are visible, so both sides can mint the same n.
	base := c.newest(peers)
	r := replica{
		val:  value,
		ver:  version{n: base.ver.n + 1, node: via},
		hist: append(append([]string{}, base.hist...), value),
	}
	for _, p := range peers {
		*c.nodes[p] = r
	}
	return nil
}

// Read returns the value as seen through node via.
func (c *Cluster) Read(via string) (string, error) {
	peers := c.reachable(via)
	if c.mode == CP &amp;&amp; len(peers) &lt; c.quorum() {
		return "", fmt.Errorf("unavailable: %s reaches %d of %d nodes, needs %d",
			via, len(peers), len(c.nodes), c.quorum())
	}
	if c.mode == CP {
		return c.newest(peers).val, nil
	}
	return c.nodes[via].val, nil // AP: answer locally, possibly stale
}

// Heal reconnects everyone and runs anti-entropy: the highest version wins
// everywhere (last-writer-wins). It returns acknowledged writes that the
// winner never saw, i.e. writes that are now silently gone.
func (c *Cluster) Heal() (lost []string) {
	c.side = map[string]int{}
	all := c.reachable("")
	win := *c.newest(all)
	kept := map[string]bool{}
	for _, v := range win.hist {
		kept[v] = true
	}
	for _, n := range all {
		for _, v := range c.nodes[n].hist {
			if !kept[v] {
				kept[v] = true // report once
				lost = append(lost, v)
			}
		}
		*c.nodes[n] = win
	}
	return lost
}</code></pre>

<p>Both runs follow the same script: write <code>v1</code>, split <code>{A B} | {C}</code>, write <code>v2</code> via A and <code>v3</code> via C, read from both sides, heal.</p>
<pre><code>func show(err error) string {
	if err != nil {
		return err.Error()
	}
	return "ok"
}

func run(mode Mode) {
	c := NewCluster(mode, "A", "B", "C")
	fmt.Printf("== %s ==&#92;n", mode)
	fmt.Println(&#96;write "v1" via A:&#96;, show(c.Write("A", "v1")))

	c.Partition([]string{"A", "B"}, []string{"C"})
	fmt.Println("partition: {A B} | {C}")
	fmt.Println(&#96;write "v2" via A:&#96;, show(c.Write("A", "v2")))
	fmt.Println(&#96;write "v3" via C:&#96;, show(c.Write("C", "v3")))
	for _, n := range []string{"A", "C"} {
		v, err := c.Read(n)
		if err != nil {
			fmt.Printf("read via %s: %v&#92;n", n, err)
		} else {
			fmt.Printf("read via %s: %s&#92;n", n, v)
		}
	}

	lost := c.Heal()
	v, _ := c.Read("C")
	fmt.Printf("heal: every node now holds %s, lost: %v&#92;n", v, lost)
}

func Example_cp() {
	run(CP)
}

func Example_ap() {
	run(AP)
}</code></pre>

<p>Output of <code>Example_cp</code>, checked exactly by <code>go test</code>:</p>
<pre><code>== CP ==
write "v1" via A: ok
partition: {A B} | {C}
write "v2" via A: ok
write "v3" via C: unavailable: C reaches 1 of 3 nodes, needs 2
read via A: v2
read via C: unavailable: C reaches 1 of 3 nodes, needs 2
heal: every node now holds v2, lost: []</code></pre>
<p>Output of <code>Example_ap</code>:</p>
<pre><code>== AP ==
write "v1" via A: ok
partition: {A B} | {C}
write "v2" via A: ok
write "v3" via C: ok
read via A: v2
read via C: v3
heal: every node now holds v3, lost: [v2]</code></pre>
<p>In CP mode, C said no to both its client's write and its client's read: it was up, but it couldn't prove its data was current. Nothing was lost. In AP mode, every request succeeded, and the two sides diverged. When the network healed, last-writer-wins picked <code>v3</code> (same counter, and node <code>C</code> wins the tie), so <code>v2</code> vanished even though two replicas had acknowledged it. Neither run is wrong. They're different promises.</p>

<p><strong>Real-world scenario.</strong> A ticketing service runs replicas in us-east and eu-west. The link between the regions drops for 90 s during a sale, while both sides keep getting about 200 requests per second. Two operations behave very differently:</p>
<ul>
  <li><strong>"Book seat A12"</strong> must never sell one seat twice. It runs as a CP operation against a majority quorum whose replicas mostly live in us-east. For 90 s, buyers routed to eu-west get "try again in a moment" for bookings. That's maybe a few thousand failed attempts, which are retried after the heal. No seat is sold twice.</li>
  <li><strong>"How many seats are left?"</strong> runs as an AP read from the local replica. Both regions keep showing a number for 90 s; the eu-west number grows stale and may say 40 when the true number is 12. Users see a slightly wrong count. That's acceptable, because booking re-checks.</li>
</ul>
<p>If the team had marked the whole database "AP", the 90 s split would have produced double-sold seats to reconcile by hand. If they had marked the whole thing "CP", the seat counter would have shown errors to every eu-west visitor. Choosing per operation is the point.</p>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>Calling a database "CP" or "AP".</strong> The label depends on the operation and its settings: Cassandra at <code>ONE</code> and at <code>QUORUM</code> behaves differently, and a "CP" store with follower reads returns stale data. Name the guarantee you need (linearizable, read-your-writes, bounded staleness) and check that the specific call provides it.</li>
  <li><strong>Thinking you chose "CA".</strong> If data lives on two machines, partitions will happen. A design without a plan for them still makes a choice; it just finds out during an incident which one.</li>
  <li><strong>Assuming quorums mean linearizable.</strong> R + W &gt; N gives overlap, but with last-writer-wins timestamps, sloppy quorums and no rollback of partially applied writes, Dynamo-style quorum reads can still return results that aren't linearizable. If you need compare-and-set, use the store's consensus path (Cassandra LWT, a Raft store).</li>
  <li><strong>Forgetting latency (the "ELC" part).</strong> A strongly consistent cross-region write pays at least one inter-region round trip every time, not just during partitions. That's often the cost that hurts, and the one PACELC makes visible.</li>
  <li><strong>Choosing AP without a merge plan.</strong> Availability during a partition creates conflicting versions. Last-writer-wins silently drops one; that's fine for a "last seen" timestamp and wrong for a shopping cart or a balance. Decide the merge rule before the first partition (see <a href="#eventual-consistency">Eventual Consistency</a>).</li>
  <li><strong>Treating "available" as "fast" or "up".</strong> CAP-available allows an answer after ten minutes, and a CP system with a healthy majority is up for most users. Measure what users see: error rates and latency per region (see <a href="#slos">SLOs</a>).</li>
</ul>

<div class="callout warn"><strong>"Unavailable" is a feature on the minority side.</strong> A node that can't reach a majority and still accepts a write isn't being helpful. It's creating a conflict someone has to resolve later, or a write that will be silently lost. If an operation must not be lost or doubled, let it fail fast and retry (see <a href="#retries">Retries</a>).</div>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>CAP: during a partition, a replica asked for data must either answer (possibly stale) or refuse. C means linearizable, A means every working node answers.</li>
  <li>P isn't optional, and the choice only matters during a partition. PACELC adds the everyday choice between latency and consistency.</li>
  <li>CP and AP describe operations at given settings, not products. Choose per operation: CP for "must not double", AP for "stale is fine".</li>
  <li>Majority quorums keep the larger side working and stop the smaller side. AP needs a merge rule decided in advance.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#network-partitions">Network Partitions</a> · <a href="#eventual-consistency">Eventual Consistency</a> · <a href="#replication">Replication</a> · <a href="#leader-election">Leader Election</a> · <a href="#clock-skew">Clock Skew</a> · <a href="#real-world-distributed-design">Real-World Distributed Design</a></p>
`;
CONTENT["eventual-consistency"] = `
<p class="tldr"><strong>TL;DR</strong>: Eventual consistency means replicas are allowed to disagree for a while, and promise only this: if writes stop, they all end up with the same value. It is how news spreads in a group of friends: not everyone hears at once, some hear it in a different order, but in the end everyone knows. In return you get writes that don't wait for other machines. You pay with stale reads, and with conflicts you must merge on purpose, or lose data by accident.</p>

<h2>The problem it solves</h2>
<p>Keeping every copy identical at every moment needs coordination on every write: the write has to reach a majority, or every copy, before anyone can read it (see <a href="#replication">Replication</a>). That coordination costs:</p>
<ul>
  <li><strong>Latency.</strong> A write that must be confirmed in another region pays a cross-region round trip, often 50–150 ms, every time.</li>
  <li><strong>Availability.</strong> When replicas can't talk to each other, a strongly consistent system has to refuse some requests, because it can't confirm them. That's the CAP trade-off (see <a href="#cap-theorem">CAP Theorem</a>).</li>
  <li><strong>Throughput.</strong> Every coordinated write involves several machines.</li>
</ul>
<p>For a lot of data, that price buys little. A like counter that is 2 s behind, a shopping cart that shows up on your phone a moment after you add to it on your laptop, a DNS record that updates within its TTL (see <a href="#dns">DNS</a>), a cached product page (see <a href="#caching">Caching</a>): all fine. Eventual consistency lets each replica accept reads and writes on its own, and reconcile later.</p>

<h2>How it works</h2>
<p>Werner Vogels, Amazon's CTO, gave the definition most people use in "Eventually Consistent" (ACM Queue, 2008): it is a form of weak consistency where, if no new updates are made to an object, eventually all accesses return the last updated value. Notice what it doesn't say. It doesn't say how long "eventually" is, and it promises nothing about a read <em>while</em> updates are flowing.</p>
<figure class="diagram">
<svg viewBox="0 0 780 275" role="img" aria-label="Three replicas over time. Replica A accepts write x=1. It gossips the change to replica B, which later gossips it to replica C. Until each replica receives it, readers there see the stale value x=0. The span from the write until C has it is the inconsistency window; after that all three agree.">
  <defs><marker id="arr-evc-1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <text x="20" y="75" class="title">Replica A</text>
  <text x="20" y="145" class="title">Replica B</text>
  <text x="20" y="215" class="title">Replica C</text>

  <rect class="box muted" x="100" y="58" width="50" height="24" rx="5"/><text x="125" y="75" text-anchor="middle" class="small">x = 0</text>
  <rect class="box accent" x="150" y="58" width="100" height="24" rx="5"/><text x="200" y="75" text-anchor="middle">write x=1</text>
  <rect class="box ok" x="250" y="58" width="510" height="24" rx="5"/><text x="505" y="75" text-anchor="middle">x = 1</text>

  <rect class="box muted" x="100" y="128" width="280" height="24" rx="5"/><text x="240" y="145" text-anchor="middle">x = 0 (stale)</text>
  <rect class="box ok" x="380" y="128" width="380" height="24" rx="5"/><text x="570" y="145" text-anchor="middle">x = 1</text>

  <rect class="box muted" x="100" y="198" width="500" height="24" rx="5"/><text x="350" y="215" text-anchor="middle">x = 0 (stale)</text>
  <rect class="box ok" x="600" y="198" width="160" height="24" rx="5"/><text x="680" y="215" text-anchor="middle">x = 1</text>

  <path class="line accent dashed" d="M260 82 L383 126" marker-end="url(#arr-evc-1)"/>
  <text x="300" y="112" text-anchor="middle" class="small">gossip</text>
  <path class="line accent dashed" d="M480 152 L603 196" marker-end="url(#arr-evc-1)"/>
  <text x="520" y="182" text-anchor="middle" class="small">gossip</text>

  <path class="line" d="M150 240 H600" style="stroke: var(--line)"/>
  <path class="line" d="M150 234 V246"/><path class="line" d="M600 234 V246"/>
  <text x="375" y="262" text-anchor="middle" class="small">inconsistency window: readers on B or C may still see x = 0</text>
  <text x="690" y="262" text-anchor="middle" class="small">converged</text>
</svg>
<figcaption>Replication is asynchronous. A read is only as fresh as the replica that serves it. The window is usually milliseconds, but nothing bounds it: a partition or a backlog can stretch it to minutes.</figcaption>
</figure>
<p>Convergence needs two things:</p>
<ol>
  <li><strong>Every update reaches every replica.</strong> Async replication streams, gossip between peers, read repair, hinted handoff, and periodic anti-entropy (comparing replicas, often with Merkle trees, and copying what's missing). One mechanism alone usually leaves gaps.</li>
  <li><strong>Every replica merges updates to the same result</strong>, whatever order they arrive in, and even if some arrive twice. If replica A applies "x=1 then x=2" and replica B applies "x=2 then x=1", a naive "apply as received" leaves them different forever. That's the job of conflict resolution, below.</li>
</ol>

<h3>The consistency spectrum</h3>
<p>"Eventual" is the weakest point on a scale. Between it and "acts like a single machine" there are useful levels, and you can often buy just the one you need.</p>
<figure class="diagram">
<svg viewBox="0 0 780 320" role="img" aria-label="Consistency models from strongest to weakest: linearizable, sequential, causal, session guarantees, eventual. Stronger models need more coordination and are less available during partitions; weaker ones are faster and more available.">
  <defs><marker id="arr-evc-2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <path class="line" d="M70 298 V28" marker-end="url(#arr-evc-2)"/>
  <text x="70" y="16" text-anchor="middle" class="small">stronger</text>
  <text x="70" y="314" text-anchor="middle" class="small">weaker</text>

  <rect class="box accent" x="100" y="24" width="200" height="44" rx="6"/><text x="200" y="51" text-anchor="middle" class="title">Linearizable</text>
  <text x="320" y="42" class="small">behaves like one copy: a read sees every write that finished before it began</text>
  <text x="320" y="58" class="small">e.g. etcd, Spanner; the "C" in CAP</text>

  <rect class="box" x="100" y="82" width="200" height="44" rx="6"/><text x="200" y="109" text-anchor="middle" class="title">Sequential</text>
  <text x="320" y="100" class="small">everyone sees all operations in the same order, each client's order kept,</text>
  <text x="320" y="116" class="small">but that order may lag real time</text>

  <rect class="box" x="100" y="140" width="200" height="44" rx="6"/><text x="200" y="167" text-anchor="middle" class="title">Causal</text>
  <text x="320" y="158" class="small">if write A could have influenced write B, everyone sees A before B;</text>
  <text x="320" y="174" class="small">unrelated writes may appear in any order. e.g. MongoDB causal sessions</text>

  <rect class="box ok" x="100" y="198" width="200" height="44" rx="6"/><text x="200" y="225" text-anchor="middle" class="title">Session guarantees</text>
  <text x="320" y="216" class="small">per client: read-your-writes, monotonic reads, monotonic writes,</text>
  <text x="320" y="232" class="small">writes-follow-reads. e.g. sticky sessions, log-position tokens</text>

  <rect class="box muted" x="100" y="256" width="200" height="44" rx="6"/><text x="200" y="283" text-anchor="middle" class="title">Eventual</text>
  <text x="320" y="274" class="small">replicas converge if writes stop; no promise about any single read</text>
  <text x="320" y="290" class="small">e.g. DNS, DynamoDB default reads, Cassandra at ONE</text>
</svg>
<figcaption>Going up costs more coordination; going down buys latency and availability. Each level forbids anomalies the one below allows. Session guarantees are the cheap upgrade most user-facing apps need: they only constrain what one client sees.</figcaption>
</figure>
<ul>
  <li><strong>Linearizable</strong>: once a write completes, every later read, anywhere, returns it or something newer. This is what people mean by "strongly consistent".</li>
  <li><strong>Causal</strong>: writes that are causally related are seen in order by everyone. A reply never appears before the comment it answers. Concurrent, unrelated writes can still appear in different orders on different replicas. Mahajan, Alvisi &amp; Dahlin (2011) showed that no consistency model stronger than (a variant of) causal can stay available and converge during a partition.</li>
  <li><strong>Session guarantees</strong>, from Terry et al., "Session Guarantees for Weakly Consistent Replicated Data" (1994), and listed by Vogels:
    <ul>
      <li><em>Read-your-writes</em>: after you write, your reads see that write or a newer one.</li>
      <li><em>Monotonic reads</em>: once you've seen a value, you never see an older one.</li>
      <li><em>Monotonic writes</em>: your writes are applied in the order you made them.</li>
      <li><em>Writes-follow-reads</em>: a write you make after reading something is ordered after what you read.</li>
    </ul></li>
  <li><strong>Eventual</strong>: only convergence. Two reads in a row may go backwards.</li>
</ul>
<p>Products expose these as knobs. DynamoDB reads are eventually consistent by default and cost half as much as reads with <code>ConsistentRead: true</code>, which are strongly consistent on tables and local secondary indexes; global secondary index reads are always eventually consistent. Cassandra lets you pick a consistency level per query. MongoDB offers causally consistent client sessions.</p>

<h3>Conflict resolution</h3>
<p>When two replicas accept different writes to the same key concurrently (neither knew about the other), convergence needs a rule that every replica applies the same way.</p>
<ul>
  <li><strong>Last-writer-wins (LWW).</strong> Every write carries a timestamp; on merge, the highest wins, with a node ID to break ties. It's simple and it converges. But "concurrent" means neither write saw the other, so LWW keeps one and <em>silently throws the other away</em>. It also trusts wall clocks: a node whose clock runs 40 ms fast wins every tie it shouldn't (see <a href="#clock-skew">Clock Skew</a>). Cassandra resolves concurrent writes per column this way. LWW is fine when writes replace a value wholesale and losing a concurrent one is acceptable (a "last seen" timestamp). It is wrong for counters, sets and anything built by read-modify-write.</li>
  <li><strong>Version vectors and siblings.</strong> Each replica keeps a counter per node. Comparing two vectors tells you whether one version descends from the other (keep the newer) or they are concurrent (a real conflict). Instead of guessing, the store keeps both <em>siblings</em> and the next reader merges them. Amazon's Dynamo merged shopping carts this way, so an "add to cart" was never lost. The Dynamo paper notes the cost: a deleted item could reappear, because a union merge can't tell "removed" from "never added".</li>
  <li><strong>CRDTs</strong> (conflict-free replicated data types; Shapiro et al., 2011). Data types whose merge is commutative, associative and idempotent, so replicas converge whatever the order, and however often they exchange state. A <strong>G-Counter</strong> keeps one count per replica; each replica increments only its own slot; merge takes the per-slot maximum; the value is the sum. A <strong>PN-Counter</strong> pairs two G-Counters to allow decrements. An <strong>OR-Set</strong> (observed-remove set) tags each add with a unique ID, and a remove deletes only the tags it has seen, so a concurrent add survives. CRDTs power collaborative editors and multi-region active-active stores, at the price of extra metadata and a limited menu of types.</li>
</ul>
<table>
  <tr><th>Strategy</th><th>On concurrent writes</th><th>Loses data?</th><th>Cost</th><th>Seen in</th></tr>
  <tr><td>Last-writer-wins</td><td>highest timestamp kept</td><td>yes, silently</td><td>trivial; depends on clocks</td><td>Cassandra (per column), many caches and multi-region setups</td></tr>
  <tr><td>Version vectors + siblings</td><td>both versions kept, app merges on read</td><td>no, but deletes can resurface</td><td>every reader must handle siblings</td><td>Dynamo (vector clocks), Riak</td></tr>
  <tr><td>CRDT</td><td>merged by the type's rules</td><td>no, within the type's meaning</td><td>metadata per replica or element; only certain types</td><td>Riak data types, collaborative editors (Automerge, Yjs)</td></tr>
  <tr><td>Avoid conflicts</td><td>can't happen: each key has one home leader</td><td>no</td><td>writes go to the home region, with its latency</td><td>single-leader databases, "home region" routing</td></tr>
</table>

<h3>Designing APIs and UIs for it</h3>
<p>Most complaints about eventual consistency are really missing session guarantees. Users don't mind that someone else's change takes a second. They mind not seeing their own.</p>
<ul>
  <li><strong>Read-your-writes with a token.</strong> The write returns the log position it was committed at (a PostgreSQL LSN, a MySQL GTID, a MongoDB <code>operationTime</code>). The client sends it back on reads, as a header or cookie. The server reads from any replica that has applied that position (in PostgreSQL, compare with <code>pg_last_wal_replay_lsn()</code> on the replica), else from the leader. The second example below does exactly this.</li>
  <li><strong>Read-your-writes, simpler.</strong> Send a user's reads to the leader for a few seconds after they write, or pin a session to one replica (which also gives monotonic reads, until that replica fails).</li>
  <li><strong>Show the user what they did.</strong> Optimistic UI: after a successful <code>POST</code>, render the new item from the response instead of re-fetching a list from a replica that may not have it.</li>
  <li><strong>Make operations merge-friendly.</strong> Send "add 1 like" or "add item X", not "set likes to 42" or "set cart to [...]". Commutative operations converge; read-modify-write overwrites. Make them idempotent too, because replication and retries deliver twice (see <a href="#idempotency">Idempotency</a>).</li>
  <li><strong>Be honest about pending states.</strong> "Payment processing", "Syncing…", "Updated a few seconds ago" are better than a value that silently changes later.</li>
</ul>

<h2>Example</h2>
<p><strong>LWW losing likes vs a G-Counter converging, in Go.</strong> Three replicas can't reach each other while users like a post: 3 likes land on A, 2 on B, 1 on C. Each replica stores the count twice: once as an LWW register (read the local value, add one, stamp it with the local clock), and once as a G-Counter CRDT. Then they run anti-entropy, pairwise. B's clock runs 40 ms ahead. Standard library only.</p>
<pre><code>package converge

import (
	"fmt"
	"sort"
	"strings"
)

// LWW is a last-writer-wins register: on merge, the higher timestamp wins
// (node name breaks ties so every replica picks the same winner).
type LWW struct {
	Val  int
	TS   int64
	Node string
}

func (a LWW) Merge(b LWW) LWW {
	if b.TS &gt; a.TS || (b.TS == a.TS &amp;&amp; b.Node &gt; a.Node) {
		return b
	}
	return a
}

// GCounter is a grow-only counter CRDT: one slot per replica, each replica
// only bumps its own slot, merge takes the max per slot, value is the sum.
type GCounter map[string]int

func (g GCounter) Inc(node string) { g[node]++ }

func (g GCounter) Merge(o GCounter) {
	for n, v := range o {
		g[n] = max(g[n], v)
	}
}

func (g GCounter) Value() int {
	sum := 0
	for _, v := range g {
		sum += v
	}
	return sum
}

func (g GCounter) String() string {
	var parts []string
	for n, v := range g {
		parts = append(parts, fmt.Sprintf("%s:%d", n, v))
	}
	sort.Strings(parts)
	return "{" + strings.Join(parts, " ") + "}"
}

// Replica stores the same "likes" counter two ways.
type Replica struct {
	Name  string
	clock int64 // this node's wall clock, in ms; each node's is a bit off
	Naive LWW
	CRDT  GCounter
}

func NewReplica(name string, clock int64) *Replica {
	return &amp;Replica{Name: name, clock: clock, Naive: LWW{Node: name}, CRDT: GCounter{}}
}

// Like is a local write: it succeeds without talking to any other replica.
func (r *Replica) Like() {
	r.clock++
	r.Naive = LWW{Val: r.Naive.Val + 1, TS: r.clock, Node: r.Name} // read-modify-write
	r.CRDT.Inc(r.Name)
}

// Gossip is one anti-entropy exchange: both sides merge each other's state.
func Gossip(a, b *Replica) {
	n := a.Naive.Merge(b.Naive)
	a.Naive, b.Naive = n, n
	a.CRDT.Merge(b.CRDT)
	b.CRDT.Merge(a.CRDT)
}</code></pre>
<pre><code>package converge

import "fmt"

func show(label string, rs []*Replica) {
	fmt.Println(label)
	for _, r := range rs {
		fmt.Printf("  %s  lww=%d  gcounter=%d %v&#92;n", r.Name, r.Naive.Val, r.CRDT.Value(), r.CRDT)
	}
}

func Example() {
	a := NewReplica("A", 1_000)
	b := NewReplica("B", 1_040) // B's clock runs 40 ms ahead
	c := NewReplica("C", 980)
	rs := []*Replica{a, b, c}

	// The replicas can't reach each other; users keep liking the post.
	for range 3 {
		a.Like()
	}
	for range 2 {
		b.Like()
	}
	c.Like()
	show("before gossip (6 likes in total):", rs)

	Gossip(a, b)
	show("after A&lt;-&gt;B:", rs)
	Gossip(b, c)
	Gossip(c, a)
	show("after B&lt;-&gt;C, C&lt;-&gt;A:", rs)
	// Output:
	// before gossip (6 likes in total):
	//   A  lww=3  gcounter=3 {A:3}
	//   B  lww=2  gcounter=2 {B:2}
	//   C  lww=1  gcounter=1 {C:1}
	// after A&lt;-&gt;B:
	//   A  lww=2  gcounter=5 {A:3 B:2}
	//   B  lww=2  gcounter=5 {A:3 B:2}
	//   C  lww=1  gcounter=1 {C:1}
	// after B&lt;-&gt;C, C&lt;-&gt;A:
	//   A  lww=2  gcounter=6 {A:3 B:2 C:1}
	//   B  lww=2  gcounter=6 {A:3 B:2 C:1}
	//   C  lww=2  gcounter=6 {A:3 B:2 C:1}
}</code></pre>
<p>Both representations converge: after the gossip rounds, all three replicas agree. But the LWW counter agreed on <strong>2</strong>, B's value, because B's clock ran ahead, and 4 of the 6 likes are gone with no error anywhere. The G-Counter agreed on <strong>6</strong>, because merging takes the maximum of each replica's own slot, so no increment can overwrite another. Run the gossip in any order, or twice, and the CRDT gives the same answer. Converging is not the same as being right.</p>

<p><strong>Read-your-writes with a session token.</strong> The write returns the log position. A read with that token goes to a replica that has caught up to it, and falls back to the leader otherwise.</p>
<pre><code>package converge

// Node is a copy of the data plus the position in the write log it has
// applied (a Postgres LSN, a MySQL GTID set, a MongoDB operationTime...).
type Node struct {
	Name    string
	Applied uint64
	Data    map[string]string
}

type Store struct {
	Leader   *Node
	Replicas []*Node
}

// Write goes to the leader and returns a session token: the log position
// the client must see from now on.
func (s *Store) Write(key, val string) (token uint64) {
	s.Leader.Applied++
	s.Leader.Data[key] = val
	return s.Leader.Applied
}

// Read serves from the first replica that has caught up to token and
// falls back to the leader. That gives read-your-writes without pinning
// every read to the leader.
func (s *Store) Read(key string, token uint64) (val, from string) {
	for _, r := range s.Replicas {
		if r.Applied &gt;= token {
			return r.Data[key], r.Name
		}
	}
	return s.Leader.Data[key], s.Leader.Name
}</code></pre>
<pre><code>package converge

import "fmt"

func ExampleStore_Read() {
	leader := &amp;Node{Name: "leader", Applied: 41, Data: map[string]string{"name": "Ana"}}
	r1 := &amp;Node{Name: "replica-1", Applied: 41, Data: map[string]string{"name": "Ana"}}
	r2 := &amp;Node{Name: "replica-2", Applied: 40, Data: map[string]string{"name": "Ana"}}
	s := &amp;Store{Leader: leader, Replicas: []*Node{r1, r2}}

	tok := s.Write("name", "Ana Lima") // the user saves their profile
	fmt.Println("token:", tok)
	fmt.Println(s.Read("name", 0))   // no token: any replica will do -&gt; stale
	fmt.Println(s.Read("name", tok)) // no replica at 42 yet -&gt; leader

	r2.Applied, r2.Data["name"] = 42, "Ana Lima" // replication catches up
	fmt.Println(s.Read("name", tok))
	// Output:
	// token: 42
	// Ana replica-1
	// Ana Lima leader
	// Ana Lima replica-2
}</code></pre>
<p>Without a token, the read happily returns the old name from replica-1. With it, the read goes to the leader until a replica reaches position 42, then moves back to replicas. Real output of <code>go test -v</code> (each <code>Example</code> passes only if its printed lines match its <code>// Output:</code> block exactly):</p>
<pre><code>=== RUN   Example
--- PASS: Example (0.00s)
=== RUN   ExampleStore_Read
--- PASS: ExampleStore_Read (0.00s)
PASS</code></pre>

<p><strong>Real-world scenario.</strong> A social app runs active-active in two regions with async replication between them, typically under 1 s. Post like counts were stored as a plain integer column, updated with read-modify-write in whichever region the user hit, and replicated with last-writer-wins. A celebrity post gets about 2,000 likes per second, split evenly between the regions. Each region overwrites the other's count every time a change replicates, so the stored count lags far behind the real number, and the gap grows with traffic. Nothing errors. The team noticed when the count went <em>down</em> during a 90 s link outage between the regions. The fix: store likes as a per-region counter (a G-Counter with one slot per region; a PN-Counter if unlikes count), keep the set of who liked as the source of truth for "did I like this?", and use a version token so a user's own like shows up instantly in their region even before the other region hears about it.</p>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>"Eventually" with no number.</strong> Measure the window: replication lag percentiles, time to converge after a partition. If you can't say "99% of reads are less than 1 s stale", you can't tell users or product owners what to expect.</li>
  <li><strong>LWW on read-modify-write data.</strong> Counters, balances, sets and JSON documents edited by several writers lose updates under LWW, with no error. Use CRDT-style types, commutative operations, or route those writes to one leader.</li>
  <li><strong>Trusting timestamps to order events.</strong> Clocks on different machines disagree by milliseconds or more and can jump. LWW with skewed clocks keeps the <em>older</em> write. Use logical clocks or version vectors when order matters.</li>
  <li><strong>Forgetting deletes.</strong> In a merge-by-union world, a delete must be recorded as a tombstone, or old copies bring the data back. Tombstones must also be kept long enough for every replica to see them before they are purged.</li>
  <li><strong>Invariants that need coordination.</strong> "Never sell more seats than exist" or "balance never below zero" can't be checked by one replica alone. Those operations need a strongly consistent path (a single leader, a quorum, or a reservation scheme). Everything else can stay eventual.</li>
  <li><strong>Reading back from a replica right after writing.</strong> The classic "save, reload, it's gone" bug. Use a version token, leader reads for a short time, or return the written object in the response.</li>
  <li><strong>Assuming idempotent delivery.</strong> Anti-entropy and retries apply the same update more than once. A merge that isn't idempotent (like "add the other replica's count to mine") double-counts. The G-Counter uses <code>max</code> for exactly this reason.</li>
</ul>

<div class="callout warn"><strong>Converged does not mean correct.</strong> Last-writer-wins always converges, and it can converge on a value that drops most of your writes. Choose the merge rule for each piece of data on purpose.</div>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>Eventual consistency promises convergence once writes stop, nothing about any single read, and no bound on time.</li>
  <li>Convergence needs every update to reach every replica and a deterministic merge that tolerates reordering and duplicates.</li>
  <li>LWW loses concurrent writes; version vectors surface conflicts; CRDTs merge them by design.</li>
  <li>Give users session guarantees (read-your-writes, monotonic reads) with tokens or sticky reads, and keep strong consistency for the few invariants that need it.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#replication">Replication</a> · <a href="#cap-theorem">CAP Theorem</a> · <a href="#clock-skew">Clock Skew</a> · <a href="#network-partitions">Network Partitions</a> · <a href="#idempotency">Idempotency</a> · <a href="#cache-invalidation">Cache Invalidation</a></p>
`;
CONTENT["distributed-locks"] = `
<p class="tldr"><strong>TL;DR</strong>: A distributed lock lets one process, out of many on different machines, work on a shared resource at a time. The hard part is that a lock in a distributed system is really a <strong>lease</strong>: it expires, so a crashed holder can't block everyone forever. And a holder that is paused (GC, a stalled VM, a slow network) can wake up after its lease expired, still believing it holds the lock. If correctness depends on the lock, the resource itself must reject stale holders using a <strong>fencing token</strong>. Think of a hotel key card: when the next guest checks in, the door must stop accepting your old card, even if you still have it in your pocket.</p>

<h2>The problem it solves</h2>
<p>Inside one process, a <code>sync.Mutex</code> is enough. Across machines, several replicas of a service may all want to do something only one should do at a time:</p>
<ul>
  <li>Generate and send invoice #42, once.</li>
  <li>Run a scheduled job on one of five replicas (see <a href="#cron-jobs">Cron Jobs</a>).</li>
  <li>Rebuild a cache entry or a report that's expensive to compute.</li>
  <li>Update a file in object storage, which has no transactions of its own.</li>
</ul>
<p>So you put the lock somewhere every process can reach: Redis, etcd, ZooKeeper, or a database. That raises the question every distributed lock design must answer: <strong>what happens when the holder stops responding?</strong> If the lock never expires, one crashed process blocks the job forever. If it expires, a holder that was merely <em>slow</em> loses the lock without knowing it.</p>

<h3>First question: efficiency or correctness?</h3>
<p>Martin Kleppmann's 2016 post "How to do distributed locking" draws the line that matters most:</p>
<ul>
  <li><strong>Efficiency lock</strong>: it saves you from doing the same work twice. If it fails now and then, the cost is small: an extra computation, a duplicate email. A simple single-node lock is fine.</li>
  <li><strong>Correctness lock</strong>: it prevents two processes from corrupting shared state. If it fails, you lose data or end up inconsistent. Here "it works most of the time" isn't enough, and you need the resource to enforce safety too.</li>
</ul>

<h2>How it works</h2>
<h3>The basic Redis lock</h3>
<p>The single-instance recipe from the Redis docs:</p>
<pre><code>SET lock:invoice-42 &lt;random-token&gt; NX PX 30000   # acquire: only if absent, 30 s TTL

# release: delete only if the value is still my token (Lua, atomic on the server)
if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
else
    return 0
end
# Redis 8.4+ has this as one command:  DELEX lock:invoice-42 IFEQ &lt;random-token&gt;</code></pre>
<ul>
  <li><strong><code>NX</code></strong> makes acquiring atomic: only one client can create the key.</li>
  <li><strong><code>PX</code></strong> (the TTL) is the lease: if the holder crashes, the key disappears and someone else can take over.</li>
  <li><strong>The random value</strong> proves ownership. A plain <code>DEL</code> could delete a lock that already expired and now belongs to someone else. The compare-and-delete only removes <em>your</em> lock.</li>
</ul>

<h3>Why a TTL can't guarantee mutual exclusion</h3>
<p>The lease runs out on the lock server's clock, while the holder is busy. Nothing stops the holder in the middle of its work when the lease ends. Kleppmann's example:</p>
<figure class="diagram">
<svg viewBox="0 0 780 420" role="img" aria-label="Sequence: client A acquires the lock with token 33, then pauses for a long GC pause. The lock's TTL expires. Client B acquires the lock with token 34 and writes to storage with token 34; storage records 34 as the highest token seen. Client A wakes up and writes with token 33; storage rejects it because 33 is less than 34.">
  <defs><marker id="arr-dl-1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <rect class="box" x="40" y="10" width="120" height="34" rx="6"/><text x="100" y="32" text-anchor="middle" class="title">Client A</text>
  <rect class="box accent" x="240" y="10" width="120" height="34" rx="6"/><text x="300" y="32" text-anchor="middle" class="title">Lock service</text>
  <rect class="box" x="440" y="10" width="120" height="34" rx="6"/><text x="500" y="32" text-anchor="middle" class="title">Client B</text>
  <rect class="box" x="630" y="10" width="120" height="34" rx="6"/><text x="690" y="32" text-anchor="middle" class="title">Storage</text>
  <path class="line dashed" d="M100 44 V385" style="stroke: var(--line)"/>
  <path class="line dashed" d="M300 44 V385" style="stroke: var(--line)"/>
  <path class="line dashed" d="M500 44 V385" style="stroke: var(--line)"/>
  <path class="line dashed" d="M690 44 V385" style="stroke: var(--line)"/>

  <path class="line" d="M100 80 H298" marker-end="url(#arr-dl-1)"/><text x="200" y="72" text-anchor="middle" class="small">acquire, TTL 10 s</text>
  <path class="line ok dashed" d="M300 106 H102" marker-end="url(#arr-dl-1)"/><text x="200" y="98" text-anchor="middle" class="small">ok, token 33</text>

  <rect class="box bad" x="90" y="120" width="20" height="196" rx="4"/>
  <text x="48" y="212" text-anchor="middle" class="small">GC</text>
  <text x="48" y="226" text-anchor="middle" class="small">pause</text>

  <rect class="box muted" x="245" y="140" width="110" height="26" rx="6"/><text x="300" y="158" text-anchor="middle" class="small">TTL expires</text>

  <path class="line" d="M500 196 H302" marker-end="url(#arr-dl-1)"/><text x="400" y="188" text-anchor="middle" class="small">acquire</text>
  <path class="line ok dashed" d="M300 222 H498" marker-end="url(#arr-dl-1)"/><text x="400" y="214" text-anchor="middle" class="small">ok, token 34</text>
  <path class="line ok" d="M500 256 H688" marker-end="url(#arr-dl-1)"/><text x="595" y="248" text-anchor="middle" class="small">write, token 34</text>
  <path class="line dashed" d="M690 282 H502" marker-end="url(#arr-dl-1)"/><text x="595" y="274" text-anchor="middle" class="small">ok, max seen = 34</text>

  <path class="line" d="M100 330 H688" marker-end="url(#arr-dl-1)"/><text x="400" y="322" text-anchor="middle" class="small">A wakes up, still "holds" the lock: write, token 33</text>
  <path class="line bad dashed" d="M690 360 H102" marker-end="url(#arr-dl-1)"/><text x="400" y="352" text-anchor="middle" class="small">rejected: 33 &lt; 34</text>
  <text x="390" y="408" text-anchor="middle" class="small">without the token check, A's write silently overwrites B's</text>
</svg>
<figcaption>The lock service did its job: only one lease existed at any instant. The bug is that A <em>acted</em> on an expired lease. Only the resource sees both writes, so only the resource can reject the stale one.</figcaption>
</figure>
<p>Checking "is my lease still valid?" right before writing doesn't help: the pause can happen between the check and the write. And GC is only one source of pauses. A VM being live-migrated, a container hitting its CPU quota, swapping, a <code>SIGSTOP</code>, or a write sitting in a network buffer for seconds all do the same thing. Clocks are the other half: the Redis docs warn that Redis does not use a monotonic clock for TTL expiry, so a wall-clock jump on the server can expire a lock early (see <a href="#clock-skew">Clock Skew</a>).</p>

<h3>Fencing tokens</h3>
<p>The fix is to have the lock service hand out a number that increases with every acquisition: the <strong>fencing token</strong>. The holder sends it with every write. The resource remembers the highest token it has accepted and rejects anything lower. Now a stale holder is harmless: its writes bounce.</p>
<p>This only works if the resource takes part. A database can do it with a conditional write:</p>
<pre><code>-- Fencing check inside the resource: the write only lands if no newer
-- lock holder has written already.
UPDATE invoices
SET    total = $1, fence = $2
WHERE  id = $3 AND fence &lt;= $2;      -- 0 rows updated = stale token, reject</code></pre>
<p>If the resource can't check tokens (a third-party API, an email provider), a lock can't make the operation safe. Use the resource's own protection instead, such as an <a href="#idempotency">idempotency key</a>, or accept the occasional duplicate.</p>

<h3>Redlock and the debate</h3>
<p>A single Redis instance is a single point of failure, and adding a replica doesn't fix it: replication is asynchronous, so the Redis docs describe the race themselves. Client A locks on the primary, the primary crashes before the key reaches the replica, the replica is promoted, client B locks the same resource. To avoid this, the Redis docs propose <strong>Redlock</strong>: N independent Redis primaries (5 in their example). A client tries to <code>SET NX PX</code> on all of them with a short per-node timeout; it holds the lock if it got a majority (at least 3) and the time spent acquiring is less than the TTL. The remaining validity is the TTL minus the time spent.</p>
<p>Kleppmann's critique: Redlock's safety depends on timing assumptions (bounded network delay, bounded process pauses, bounded clock error), and it produces no fencing token, so it can't stop a paused client from writing after its lease expired. His advice: for efficiency, a single Redis node is simpler and good enough; for correctness, use a consensus system (ZooKeeper, etcd) and fencing tokens. Redis's author, Salvatore Sanfilippo, published a rebuttal, and the Redis docs link to both. The Redis docs now add their own consistency disclaimer: implement fencing tokens for long-running work, and don't assume a lock is held just because the process that acquired it is alive.</p>

<h3>Consensus-based locks: etcd and ZooKeeper</h3>
<ul>
  <li><strong>etcd</strong> (Go client, <code>go.etcd.io/etcd/client/v3/concurrency</code>): a <code>Session</code> holds a lease that the client keeps alive with heartbeats (default TTL 60 s). <code>NewMutex(session, "/locks/invoice-42")</code> creates a key under that prefix, attached to the lease. The key with the lowest create revision owns the lock; the others wait for the keys before them to be deleted. If the client dies, the lease expires and its key is deleted. Every write in etcd gets a revision from one cluster-wide counter that only increases, so the lock key's create revision works as a fencing token.</li>
  <li><strong>ZooKeeper</strong>: each client creates an <em>ephemeral sequential</em> node under the lock path. The lowest sequence number holds the lock. Every other client watches only the node just before its own, so a release wakes one waiter, not all of them (no herd effect). Ephemeral nodes disappear when the session expires. Kleppmann suggests the <code>zxid</code> or the znode version number as a fencing token. In Java, Apache Curator's lock recipe implements this.</li>
</ul>
<p>Both are replicated with consensus (Raft in etcd, Zab in ZooKeeper), so losing a minority of nodes doesn't lose the lock state. They still issue leases, so the pause problem remains; the difference is that they give you a reliable token to fence with.</p>

<h3>Database locks</h3>
<p>If the protected data is in one relational database, often the simplest correct lock is the database itself. <code>SELECT ... FOR UPDATE</code> locks rows until the transaction ends (see <a href="#pessimistic-locking">Pessimistic Locking</a>). Postgres advisory locks (<code>pg_advisory_lock</code>, <code>pg_try_advisory_lock</code>, <code>pg_advisory_xact_lock</code>) lock an application-chosen number, and are released when the session or transaction ends. Better still, when the work <em>is</em> a write to that database, a conditional update or a version column (<a href="#optimistic-locking">optimistic locking</a>) needs no separate lock at all.</p>

<figure class="diagram">
<svg viewBox="0 0 780 300" role="img" aria-label="Decision tree. Why do you need the lock? For efficiency (duplicates only waste work): a single Redis SET NX PX is enough. For correctness (duplicates corrupt data): can the resource check a fencing token? Yes: use an etcd or ZooKeeper lock and pass the token on every write. No: if the data is in one database, use its transactions or conditional writes; otherwise make the operation idempotent or redesign.">
  <defs><marker id="arr-dl-2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <rect class="box accent" x="275" y="12" width="230" height="40" rx="8"/><text x="390" y="37" text-anchor="middle" class="title">Why do you need the lock?</text>

  <rect class="box" x="20" y="100" width="250" height="44" rx="8"/><text x="145" y="119" text-anchor="middle">efficiency</text><text x="145" y="136" text-anchor="middle" class="small">a duplicate only wastes work</text>
  <rect class="box" x="450" y="100" width="300" height="44" rx="8"/><text x="600" y="119" text-anchor="middle">correctness</text><text x="600" y="136" text-anchor="middle" class="small">a duplicate corrupts data</text>
  <path class="line" d="M330 52 L160 98" marker-end="url(#arr-dl-2)"/>
  <path class="line" d="M450 52 L590 98" marker-end="url(#arr-dl-2)"/>

  <rect class="box ok" x="20" y="200" width="250" height="56" rx="8"/><text x="145" y="222" text-anchor="middle">single Redis SET NX PX</text><text x="145" y="241" text-anchor="middle" class="small">document it as "approximate"</text>
  <path class="line" d="M145 144 V198" marker-end="url(#arr-dl-2)"/>

  <rect class="box accent" x="450" y="170" width="300" height="34" rx="8"/><text x="600" y="192" text-anchor="middle">Can the resource check a token?</text>
  <path class="line" d="M600 144 V168" marker-end="url(#arr-dl-2)"/>

  <rect class="box ok" x="300" y="240" width="220" height="52" rx="8"/><text x="410" y="261" text-anchor="middle">etcd / ZooKeeper lock</text><text x="410" y="279" text-anchor="middle" class="small">+ fencing token on every write</text>
  <rect class="box ok" x="540" y="240" width="230" height="52" rx="8"/><text x="655" y="261" text-anchor="middle">DB transaction / conditional</text><text x="655" y="279" text-anchor="middle" class="small">write, or idempotency + redesign</text>
  <path class="line ok" d="M530 204 L440 238" marker-end="url(#arr-dl-2)"/><text x="505" y="238" text-anchor="middle" class="small">yes</text>
  <path class="line bad" d="M640 204 L652 238" marker-end="url(#arr-dl-2)"/><text x="672" y="226" class="small">no</text>
</svg>
<figcaption>Following Kleppmann's split. Note that "a lock with fencing" and "a database with transactions" are both ways of letting the resource, not the lock, have the final say.</figcaption>
</figure>

<table>
  <tr><th>Option</th><th>Holder crashes</th><th>Fencing token</th><th>Safe for correctness?</th><th>Notes</th></tr>
  <tr><td><strong>Redis, single node</strong> (<code>SET NX PX</code>)</td><td>TTL expires</td><td>none built in (an <code>INCR</code> counter, as in the example, is lost if a failover loses recent writes)</td><td>no: failover and clock jumps can admit two holders</td><td>fast, simple; the right tool for efficiency locks</td></tr>
  <tr><td><strong>Redlock</strong> (N independent Redis nodes)</td><td>TTL expires on each node</td><td>none</td><td>disputed: depends on timing assumptions</td><td>more machines than a single node, without giving you fencing</td></tr>
  <tr><td><strong>etcd</strong> (<code>concurrency.Mutex</code>)</td><td>session lease expires (default 60 s)</td><td>yes: the lock key's create revision</td><td>yes, with fencing at the resource</td><td>Raft-replicated; a natural choice if you run Kubernetes or etcd already</td></tr>
  <tr><td><strong>ZooKeeper</strong> (ephemeral sequential nodes, Curator)</td><td>session expires, node deleted</td><td>yes: <code>zxid</code> or znode version</td><td>yes, with fencing at the resource</td><td>mature; mostly used from the JVM</td></tr>
  <tr><td><strong>Postgres</strong> (<code>FOR UPDATE</code>, advisory locks)</td><td>connection closes, lock released</td><td>not needed when the work is in the same DB transaction</td><td>yes, for data in that database</td><td>no extra system; holds a connection while locked (see <a href="#connection-pooling">Connection Pooling</a>)</td></tr>
</table>

<h2>Example</h2>
<p><strong>A Redis lock with a fencing token, and a resource that checks it.</strong> Acquiring is one Lua script: <code>SET NX PX</code>, and only if that succeeds, <code>INCR</code> a counter to get the next token. Releasing is the compare-and-delete script. The <code>Storage</code> type stands in for the protected resource.</p>
<pre><code>package dlock

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

var ErrNotAcquired = errors.New("lock held by someone else")

// acquire: SET key token NX PX ttl, and only if that worked, take the next
// fencing number. One script, so both happen atomically on the server.
var acquire = redis.NewScript(&#96;
if redis.call("SET", KEYS[1], ARGV[1], "NX", "PX", ARGV[2]) then
	return redis.call("INCR", KEYS[2])
end
return false&#96;)

// release: delete the key only if it still holds OUR token.
var release = redis.NewScript(&#96;
if redis.call("GET", KEYS[1]) == ARGV[1] then
	return redis.call("DEL", KEYS[1])
end
return 0&#96;)

type Lock struct {
	rdb   *redis.Client
	key   string
	token string // random, proves ownership on release
	Fence int64  // increases with every acquisition; send it with every write
}

func Acquire(ctx context.Context, rdb *redis.Client, key string, ttl time.Duration) (*Lock, error) {
	b := make([]byte, 16)
	rand.Read(b)
	token := hex.EncodeToString(b)
	fence, err := acquire.Run(ctx, rdb, []string{key, key + ":fence"}, token, ttl.Milliseconds()).Int64()
	if errors.Is(err, redis.Nil) {
		return nil, ErrNotAcquired
	}
	if err != nil {
		return nil, err
	}
	return &amp;Lock{rdb: rdb, key: key, token: token, Fence: fence}, nil
}

// Release reports whether we still owned the lock. False means it expired
// and someone else may have taken it: whatever we did after that is suspect.
func (l *Lock) Release(ctx context.Context) (bool, error) {
	n, err := release.Run(ctx, l.rdb, []string{l.key}, l.token).Int64()
	return n == 1, err
}

// Storage is the protected resource. With fencing on, it remembers the
// highest token it has seen and refuses writes that carry an older one.
type Storage struct {
	mu      sync.Mutex
	Fencing bool
	maxSeen int64
	Value   string
}

var ErrStaleToken = errors.New("stale fencing token")

func (s *Storage) Write(fence int64, value string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.Fencing &amp;&amp; fence &lt; s.maxSeen {
		return ErrStaleToken
	}
	s.maxSeen = max(s.maxSeen, fence)
	s.Value = value
	return nil
}</code></pre>

<p>The test uses miniredis (an in-memory Redis server for Go tests). <code>FastForward</code> moves miniredis's clock, which plays the part of client A's 15 s pause. The scenario runs twice: without fencing, then with it.</p>
<pre><code>func Example() {
	ctx := context.Background()
	for _, fencing := range []bool{false, true} {
		mr := miniredis.NewMiniRedis()
		mr.Start()
		rdb := redis.NewClient(&amp;redis.Options{Addr: mr.Addr()})
		store := &amp;Storage{Fencing: fencing}
		fmt.Printf("=== fencing=%v&#92;n", fencing)

		a, _ := Acquire(ctx, rdb, "lock:invoice-42", 10*time.Second)
		fmt.Println("A acquires, fence", a.Fence)
		_, err := Acquire(ctx, rdb, "lock:invoice-42", 10*time.Second)
		fmt.Println("B tries:", err)

		mr.FastForward(15 * time.Second) // A is stuck in a 15 s GC pause; the TTL runs out

		b, _ := Acquire(ctx, rdb, "lock:invoice-42", 10*time.Second)
		fmt.Println("B acquires, fence", b.Fence)
		fmt.Println("B writes:", store.Write(b.Fence, "total=120 (by B)"))

		// A wakes up, still believing it holds the lock, and writes.
		fmt.Println("A writes:", store.Write(a.Fence, "total=100 (by A)"))
		ok, _ := a.Release(ctx)
		fmt.Println("A release, still owner?", ok)
		fmt.Println("stored:", store.Value)
		ok, _ = b.Release(ctx)
		fmt.Println("B release, still owner?", ok)

		rdb.Close()
		mr.Close()
	}
}</code></pre>

<p>Real output, pinned as the example's <code>// Output:</code> (passes <code>go test -race</code>):</p>
<pre><code>=== fencing=false
A acquires, fence 1
B tries: lock held by someone else
B acquires, fence 2
B writes: &lt;nil&gt;
A writes: &lt;nil&gt;
A release, still owner? false
stored: total=100 (by A)
B release, still owner? true
=== fencing=true
A acquires, fence 1
B tries: lock held by someone else
B acquires, fence 2
B writes: &lt;nil&gt;
A writes: stale fencing token
A release, still owner? false
stored: total=120 (by B)
B release, still owner? true</code></pre>
<ul>
  <li>In both runs, the lock behaves "correctly": B can't acquire while A's lease is live, and A's late release doesn't delete B's lock (<code>still owner? false</code>).</li>
  <li>Without fencing, A's write lands after B's, and the stored value is A's stale <code>total=100</code>. Nothing errored. That silent lost update is the real danger.</li>
  <li>With fencing, storage has seen token 2, so A's token 1 is rejected and B's value stays.</li>
</ul>
<p>The token here comes from Redis <code>INCR</code>, which is fine for showing the mechanism. For a correctness lock in production, take the token from a consensus store (etcd's revision, ZooKeeper's <code>zxid</code>) or a database sequence, so a failover can't hand out the same number twice.</p>

<p><strong>Real-world scenario.</strong> Picture a billing service with 4 replicas. Each night, a worker takes a Redis lock with a 30 s TTL per customer, recomputes the invoice and writes the PDF to object storage. One night, the node running replica 2 is overloaded and its container is CPU-throttled: the worker freezes for 45 s in the middle of writing invoice #42. At second 30 the lock expires, replica 3 takes it and writes the corrected invoice. At second 45 replica 2 wakes up and uploads its older version on top. The customer gets the wrong invoice, and every log line says "lock acquired". The fix had nothing to do with Redis: store a <code>fence</code> number in the invoice row, and make the final "publish invoice" step a conditional <code>UPDATE ... WHERE fence &lt;= $token</code>.</p>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>Deleting without checking ownership.</strong> <code>DEL lock</code> after your lease expired deletes someone else's lock and lets a third process in. Always compare-and-delete with your random token.</li>
  <li><strong>TTL shorter than the work.</strong> If the job sometimes takes 40 s and the TTL is 30 s, two holders are routine, not rare. Renewing the lease on a heartbeat while working helps, but a paused process can't renew either, so it narrows the window without closing it.</li>
  <li><strong>"I'll check the lock right before writing."</strong> A pause can happen between the check and the write. Only a check done by the resource, atomically with the write, is safe.</li>
  <li><strong>Trusting Redis replication for correctness.</strong> Asynchronous replication plus failover can admit two holders. That's fine for efficiency locks and not fine for correctness locks.</li>
  <li><strong>Locking when the resource has its own concurrency control.</strong> If the data is in a database, a transaction, a unique constraint or a conditional update is usually simpler and safer than any external lock.</li>
  <li><strong>No timeout on acquire.</strong> A client waiting forever for a lock turns one stuck holder into a pile-up. Use <code>TryLock</code> or a context deadline, and decide what to do when you can't get it (skip, retry later, fail).</li>
  <li><strong>Forgetting partitions.</strong> A holder cut off from the lock service may keep working while the lease expires on the other side (see <a href="#network-partitions">Network Partitions</a>). Fencing handles this case too.</li>
</ul>

<div class="callout warn"><strong>A distributed lock without fencing is advisory.</strong> It makes collisions rare, not impossible. If a collision would corrupt data, the resource must reject stale writers, or the lock must live inside the same transactional system as the data.</div>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>Distributed locks are leases: they expire, and the holder can't tell when that happened during a pause.</li>
  <li>Decide first: efficiency lock (single Redis <code>SET NX PX</code> is fine) or correctness lock (needs fencing).</li>
  <li>Fencing tokens increase with every acquisition; the resource rejects writes with an older token.</li>
  <li>For correctness, use a consensus store (etcd revision, ZooKeeper zxid) or the database's own transactions, not Redlock.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#leader-election">Leader Election</a> · <a href="#pessimistic-locking">Pessimistic Locking</a> · <a href="#optimistic-locking">Optimistic Locking</a> · <a href="#clock-skew">Clock Skew</a> · <a href="#network-partitions">Network Partitions</a> · <a href="#cron-jobs">Cron Jobs</a></p>
`;

