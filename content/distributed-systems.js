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
