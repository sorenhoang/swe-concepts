CONTENT["optimistic-locking"] = `
<p class="tldr"><strong>TL;DR</strong>: Optimistic locking takes no lock while you work. You remember which version of the data you read, and when you write you say "only if it is still that version". If someone else got there first, your write changes nothing, you find out, and you retry or tell the user. It is <code>git push</code> being rejected because the remote moved on: nobody stopped you from editing, but you can't overwrite work you never saw.</p>

<h2>The problem it solves</h2>
<p>Most application writes are <strong>read-modify-write</strong>: load a row, change it in Go, save it back. Two requests doing this at once can both read the same old value, and the second save silently overwrites the first. This is the <strong>lost update</strong> anomaly. Nothing errors; both requests return 200.</p>
<ul>
  <li>Two checkout requests read <code>stock = 10</code> in the same millisecond, each sells 3, each writes <code>7</code>. Six items left the warehouse and the database says only three did.</li>
  <li>Two admins open the same product page. One changes the price, the other fixes a typo in the description. Whoever clicks Save second puts the old price back.</li>
</ul>
<p>PostgreSQL's default isolation level, READ COMMITTED, does not prevent this. The bug lives in the gap between the <code>SELECT</code> and the <code>UPDATE</code>, while the app holds a copy that may already be stale.</p>
<p>There are two families of fixes. <a href="#pessimistic-locking">Pessimistic locking</a> locks the row when you read it, so nobody else can change it until you commit. <strong>Optimistic locking</strong> (optimistic concurrency control) assumes conflicts are rare: it takes no lock, lets everyone work in parallel, and <em>detects</em> the conflict at write time.</p>

<h2>How it works</h2>
<p>Give the row a <strong>version</strong>: an integer that every write increments. Read it along with the data. Put it in the <code>WHERE</code> clause of the update, and check how many rows the update changed:</p>
<pre><code>-- 1. read (no lock taken)
SELECT stock, version FROM items WHERE id = 1;          -- stock 10, version 1

-- 2. work in the app: 10 - 3 = 7

-- 3. write only if the row is still the one we read
UPDATE items SET stock = 7, version = version + 1
 WHERE id = 1 AND version = 1;                          -- UPDATE 1 → we won
                                                        -- UPDATE 0 → conflict</code></pre>
<p>Check and write are <strong>one atomic statement</strong>. The <code>UPDATE</code> row-locks the row (in autocommit, just for that statement), so two writers can't both match <code>version = 1</code>: the first makes it 2, and the second's <code>WHERE</code> no longer matches. "0 rows affected" is the conflict signal.</p>
<figure class="diagram">
<svg viewBox="0 0 780 390" role="img" aria-label="Sequence diagram. Buyer A and Buyer B both read stock 10 at version 1. A updates where version equals 1, one row changes, stock is now 7 at version 2. B updates where version equals 1, zero rows change, which is a conflict. B re-reads stock 7 at version 2 and updates where version equals 2, which succeeds and leaves stock 4 at version 3.">
  <defs><marker id="arr-ol-1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <rect class="box accent" x="50" y="16" width="120" height="36" rx="6"/><text x="110" y="39" text-anchor="middle" class="title">Buyer A</text>
  <rect class="box" x="320" y="16" width="140" height="36" rx="6"/><text x="390" y="39" text-anchor="middle" class="title">PostgreSQL</text>
  <rect class="box accent" x="610" y="16" width="120" height="36" rx="6"/><text x="670" y="39" text-anchor="middle" class="title">Buyer B</text>
  <path d="M110 52 V380" style="stroke: var(--line)"/>
  <path d="M390 52 V380" style="stroke: var(--line)"/>
  <path d="M670 52 V380" style="stroke: var(--line)"/>

  <path class="line" d="M110 92 H386" marker-end="url(#arr-ol-1)"/>
  <text x="250" y="84" text-anchor="middle" class="small">SELECT → stock 10, version 1</text>
  <path class="line" d="M670 122 H394" marker-end="url(#arr-ol-1)"/>
  <text x="530" y="114" text-anchor="middle" class="small">SELECT → stock 10, version 1</text>

  <text x="250" y="132" text-anchor="middle" class="small">compute 10 − 3 = 7</text>
  <path class="line" d="M110 172 H386" marker-end="url(#arr-ol-1)"/>
  <text x="250" y="164" text-anchor="middle" class="small">UPDATE stock=7 … WHERE version = 1</text>
  <path class="line ok" d="M390 200 H114" marker-end="url(#arr-ol-1)"/>
  <text x="250" y="192" text-anchor="middle" class="small">UPDATE 1 ✓ (row is now 7, v2)</text>

  <path class="line" d="M670 238 H394" marker-end="url(#arr-ol-1)"/>
  <text x="530" y="230" text-anchor="middle" class="small">UPDATE stock=7 … WHERE version = 1</text>
  <path class="line bad" d="M390 266 H666" marker-end="url(#arr-ol-1)"/>
  <text x="530" y="258" text-anchor="middle" class="small">UPDATE 0 ✗ conflict: no row matched</text>

  <path class="line dashed" d="M670 304 H394" marker-end="url(#arr-ol-1)"/>
  <text x="530" y="296" text-anchor="middle" class="small">retry: SELECT → stock 7, version 2</text>
  <path class="line" d="M670 342 H394" marker-end="url(#arr-ol-1)"/>
  <text x="530" y="334" text-anchor="middle" class="small">UPDATE stock=4 … WHERE version = 2</text>
  <path class="line ok" d="M390 368 H666" marker-end="url(#arr-ol-1)"/>
  <text x="530" y="360" text-anchor="middle" class="small">UPDATE 1 ✓ (row is now 4, v3)</text>
  <text x="250" y="300" text-anchor="middle" class="small">nobody held a lock</text>
  <text x="250" y="316" text-anchor="middle" class="small">while A and B were working</text>
</svg>
<figcaption>The exact run of <code>ExampleSell</code> below. Without the <code>WHERE version = 1</code>, B's first update would succeed and the row would end at 7: A's sale is lost.</figcaption>
</figure>

<h3>What the loser does</h3>
<p>A conflict is not an error in the system. It means "your input is out of date". The right reaction depends on who made the decision:</p>
<ul>
  <li><strong>The code decided</strong> (sell 3 if there are at least 3): re-run the <em>whole</em> read → decide → write. Re-sending the same <code>UPDATE</code> with the old version fails forever. Cap attempts (see <a href="#retries">Retries</a>).</li>
  <li><strong>A human decided</strong> (an edit form): don't auto-retry; they chose their changes looking at old data. Return a conflict (409, or 412 with ETags), show the current version, let them merge.</li>
</ul>
<p>"0 rows" can also mean the row was deleted. Re-read if the caller needs to know which.</p>

<h3>The same idea at four layers</h3>
<figure class="diagram">
<svg viewBox="0 0 780 300" role="img" aria-label="Mindmap. Center: optimistic concurrency, read then work then write if unchanged. Four branches: SQL row with a version column and rows affected zero meaning conflict; HTTP API with ETag and If-Match returning 412 Precondition Failed; in memory with atomic CompareAndSwap in a loop; database isolation with REPEATABLE READ or SERIALIZABLE returning SQLSTATE 40001. Bottom: on conflict, retry the whole read to write, or ask the user.">
  <ellipse class="box accent" cx="390" cy="150" rx="120" ry="34"/>
  <text x="390" y="146" text-anchor="middle" class="title">Optimistic CC</text>
  <text x="390" y="164" text-anchor="middle" class="small">read → work → write if unchanged</text>

  <rect class="box" x="20" y="20" width="230" height="74" rx="8"/>
  <text x="135" y="44" text-anchor="middle" class="title">SQL row</text>
  <text x="135" y="64" text-anchor="middle" class="small">UPDATE … WHERE version = $n</text>
  <text x="135" y="80" text-anchor="middle" class="small">rows affected 0 → conflict</text>

  <rect class="box" x="530" y="20" width="230" height="74" rx="8"/>
  <text x="645" y="44" text-anchor="middle" class="title">HTTP API</text>
  <text x="645" y="64" text-anchor="middle" class="small">GET returns ETag; PUT sends If-Match</text>
  <text x="645" y="80" text-anchor="middle" class="small">stale → 412 Precondition Failed</text>

  <rect class="box" x="20" y="206" width="230" height="74" rx="8"/>
  <text x="135" y="230" text-anchor="middle" class="title">In memory</text>
  <text x="135" y="250" text-anchor="middle" class="small">atomic CompareAndSwap(old, new)</text>
  <text x="135" y="266" text-anchor="middle" class="small">false → re-load and loop</text>

  <rect class="box" x="530" y="206" width="230" height="74" rx="8"/>
  <text x="645" y="230" text-anchor="middle" class="title">DB isolation level</text>
  <text x="645" y="250" text-anchor="middle" class="small">REPEATABLE READ / SERIALIZABLE</text>
  <text x="645" y="266" text-anchor="middle" class="small">SQLSTATE 40001 → retry the tx</text>

  <rect class="box bad" x="280" y="232" width="220" height="48" rx="8"/>
  <text x="390" y="252" text-anchor="middle" class="title">On conflict</text>
  <text x="390" y="270" text-anchor="middle" class="small">retry the whole thing, or ask the user</text>

  <path class="line" d="M300 128 L250 72"/>
  <path class="line" d="M480 128 L530 72"/>
  <path class="line" d="M300 172 L250 236"/>
  <path class="line" d="M480 172 L530 236"/>
  <path class="line bad" d="M390 184 V232"/>
</svg>
<figcaption>One pattern, four places you will meet it. In each, the "version" is something that is guaranteed to change on every write.</figcaption>
</figure>

<h3>HTTP: ETag and If-Match</h3>
<p>A user can keep an edit form open for an hour, so HTTP has optimistic locking built in. The server sends an <code>ETag</code> header (an opaque version token) with <code>GET</code>. The client sends it back in <code>If-Match</code> on <code>PUT</code> or <code>PATCH</code>. RFC 9110 says <code>If-Match</code> is most often used with state-changing methods to prevent the "lost update" problem, that the server must use the <em>strong</em> comparison (so weak <code>W/"…"</code> tags never match), and that when the condition is false the server must not perform the change and can answer <strong>412 Precondition Failed</strong>. To force clients to send it, reply <strong>428 Precondition Required</strong> (RFC 6585) when it is missing. Behind the API, the ETag is usually the row's version.</p>

<h3>In memory: compare-and-swap</h3>
<p>Inside one Go process, the same loop is built on a CPU instruction. <code>atomic.Int64.CompareAndSwap(old, new)</code> stores <code>new</code> only if the value is still <code>old</code>, and reports whether it did. Read with <code>Load</code>, compute, CAS; if it returns false, someone changed the value in between, so loop. No goroutine ever blocks. CAS compares values, not history: A → B → A still succeeds (the "ABA problem"). Fine for counters; otherwise swap an <code>atomic.Pointer</code> to a new immutable struct.</p>

<h3>In the database: REPEATABLE READ and SERIALIZABLE</h3>
<p>PostgreSQL's stronger isolation levels are optimistic concurrency control done for you. A REPEATABLE READ transaction works on one snapshot. If it updates a row that another transaction changed and committed after that snapshot, Postgres refuses: <code>could not serialize access due to concurrent update</code>. SERIALIZABLE also catches read/write dependency cycles that no single-row check would. Both report <strong>SQLSTATE 40001</strong>, and the docs say to abort and retry the <em>whole transaction</em>. No version column needed, but every write path must handle 40001.</p>

<h3>Optimistic or pessimistic?</h3>
<table>
  <tr><th></th><th>Optimistic (detect at write)</th><th>Pessimistic (lock at read)</th></tr>
  <tr><td>Mechanism</td><td>version column, ETag, CAS, 40001</td><td><code>SELECT … FOR UPDATE</code>, mutex</td></tr>
  <tr><td>While you work</td><td>nothing is held; others read and write freely</td><td>the row is locked; other writers wait</td></tr>
  <tr><td>Cost when there is no conflict</td><td>almost zero (one extra <code>WHERE</code> term)</td><td>lock bookkeeping, a transaction held open</td></tr>
  <tr><td>Cost when there is a conflict</td><td>the loser's work is thrown away and redone</td><td>the second caller waits, then runs once</td></tr>
  <tr><td>Long "think time" (forms, HTTP clients)</td><td>works: the version travels with the client</td><td>impossible: you can't hold a DB lock across requests</td></tr>
  <tr><td>Hot row, many writers</td><td>retry storms; most attempts fail</td><td>an orderly queue; throughput is one writer at a time</td></tr>
  <tr><td>Side effects that can't be undone</td><td>dangerous if done before the write fails</td><td>safe: you own the row before you act</td></tr>
  <tr><td>Failure mode</td><td>livelock-ish retries, user sees "changed by someone else"</td><td>waits, lock timeouts, <a href="#deadlocks">deadlocks</a></td></tr>
</table>

<h3>When it loses: hot rows</h3>
<p>Optimistic locking bets that conflicts are rare. If <em>n</em> callers read the same version at once, only one can win. In the worst case (lockstep retries), 5 buyers cost 5 + 4 + 3 + 2 + 1 = 15 update attempts; <em>n</em> buyers cost <em>n</em>(<em>n</em>+1)/2, each with a re-read.</p>
<figure class="diagram">
<svg viewBox="0 0 780 214" role="img" aria-label="Worst case for five buyers on one row. Round 1: five attempts, buyer 1 wins. Round 2: four attempts, buyer 2 wins. And so on until round 5. Fifteen update attempts for five sales. With a row lock: five updates and the others wait in a queue.">
  <text x="70" y="34" text-anchor="middle" class="small">attempt by</text>
  <text x="180" y="34" text-anchor="middle" class="small">round 1</text>
  <text x="270" y="34" text-anchor="middle" class="small">round 2</text>
  <text x="360" y="34" text-anchor="middle" class="small">round 3</text>
  <text x="450" y="34" text-anchor="middle" class="small">round 4</text>
  <text x="540" y="34" text-anchor="middle" class="small">round 5</text>

  <text x="70" y="60" text-anchor="middle">buyer 1</text>
  <text x="70" y="90" text-anchor="middle">buyer 2</text>
  <text x="70" y="120" text-anchor="middle">buyer 3</text>
  <text x="70" y="150" text-anchor="middle">buyer 4</text>
  <text x="70" y="180" text-anchor="middle">buyer 5</text>

  <rect class="box ok" x="140" y="44" width="80" height="22" rx="4"/><text x="180" y="60" text-anchor="middle" class="small">✓ wins</text>
  <rect class="box bad" x="140" y="74" width="80" height="22" rx="4"/> <rect class="box bad" x="140" y="104" width="80" height="22" rx="4"/> <rect class="box bad" x="140" y="134" width="80" height="22" rx="4"/> <rect class="box bad" x="140" y="164" width="80" height="22" rx="4"/>

  <rect class="box ok" x="230" y="74" width="80" height="22" rx="4"/><text x="270" y="90" text-anchor="middle" class="small">✓ wins</text>
  <rect class="box bad" x="230" y="104" width="80" height="22" rx="4"/> <rect class="box bad" x="230" y="134" width="80" height="22" rx="4"/> <rect class="box bad" x="230" y="164" width="80" height="22" rx="4"/>

  <rect class="box ok" x="320" y="104" width="80" height="22" rx="4"/><text x="360" y="120" text-anchor="middle" class="small">✓ wins</text>
  <rect class="box bad" x="320" y="134" width="80" height="22" rx="4"/> <rect class="box bad" x="320" y="164" width="80" height="22" rx="4"/>

  <rect class="box ok" x="410" y="134" width="80" height="22" rx="4"/><text x="450" y="150" text-anchor="middle" class="small">✓ wins</text>
  <rect class="box bad" x="410" y="164" width="80" height="22" rx="4"/>

  <rect class="box ok" x="500" y="164" width="80" height="22" rx="4"/><text x="540" y="180" text-anchor="middle" class="small">✓ wins</text>

  <rect class="box bad" x="610" y="50" width="155" height="56" rx="8"/>
  <text x="687" y="74" text-anchor="middle" class="title">Optimistic</text>
  <text x="687" y="94" text-anchor="middle" class="small">15 attempts, 5 sales</text>
  <rect class="box ok" x="610" y="124" width="155" height="56" rx="8"/>
  <text x="687" y="148" text-anchor="middle" class="title">Row lock</text>
  <text x="687" y="168" text-anchor="middle" class="small">5 updates, others wait</text>
</svg>
<figcaption>Worst case, five buyers, one row. Real traffic is less synchronized, but the shape holds: the more writers per row, the more wasted work per sale. Past a few concurrent writers per row, switch that path to a lock or to an atomic <code>UPDATE</code>.</figcaption>
</figure>
<p>Often you need neither kind of lock. If the new value can be computed <em>by the database</em> from the old one, let it. One statement, no stale copy, no retry:</p>
<pre><code>-- No read-modify-write at all: the database does the arithmetic under its own row lock.
UPDATE items SET stock = stock - 3 WHERE id = 1 AND stock &gt;= 3;   -- UPDATE 0 → sold out</code></pre>
<p>Optimistic locking earns its keep when the new value is computed in the app from many fields, or decided by a person.</p>

<h2>Example</h2>
<p>The tests run a real PostgreSQL 18 (<code>embedded-postgres</code>, <code>pgx</code>). Table <code>items(id, stock, version)</code> has one row with stock 10. Two goroutines each sell 3, and a test hook makes <em>both read before either writes</em>: the production race when two requests land together.</p>
<p><code>SaveBlind</code> is the usual naive code: <code>UPDATE items SET stock = $1 WHERE id = $2</code>. <code>Save</code> adds the version check, and <code>Sell</code> wraps it in a bounded retry loop:</p>
<pre><code>// Save writes only if nobody changed the row since we read it.
func Save(ctx context.Context, db *pgxpool.Pool, it Item) error {
	tag, err := db.Exec(ctx,
		&#96;UPDATE items SET stock = $1, version = version + 1
		 WHERE id = $2 AND version = $3&#96;, it.Stock, it.ID, it.Version)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrConflict // someone else won (or the row is gone)
	}
	return nil
}

// Sell is read → decide → conditional write, retried on conflict.
// afterRead is a test hook that lets both buyers read before either writes.
func Sell(ctx context.Context, db *pgxpool.Pool, id, qty int, afterRead func()) (attempts int, err error) {
	for attempts = 1; attempts &lt;= 3; attempts++ {
		it, err := Get(ctx, db, id)
		if err != nil {
			return attempts, err
		}
		if it.Stock &lt; qty {
			return attempts, ErrSoldOut
		}
		afterRead()
		it.Stock -= qty
		if err = Save(ctx, db, it); !errors.Is(err, ErrConflict) {
			return attempts, err // nil or a real error
		}
	}
	return attempts - 1, ErrConflict // still losing: give up, report upward
}</code></pre>
<p>The tests are <code>Example</code> functions, so <code>go test</code> fails unless the printed lines match the <code>// Output:</code> block. All outputs on this page are real, and stable across <code>-count=5</code>. First the naive version, same setup with <code>SaveBlind</code>:</p>
<pre><code>// ExampleSaveBlind: no version check, both buyers read stock=10
sold 2×3 from 10, stock now: 7</code></pre>
<p>Then the version-checked one:</p>
<pre><code>func ExampleSell() {
	ctx := context.Background()
	db := fresh()
	defer db.Close()
	hook := bothRead(2)
	var wg sync.WaitGroup
	var mu sync.Mutex
	attempts := map[int]int{}
	for range 2 {
		wait := hook()
		wg.Go(func() {
			n, err := Sell(ctx, db, 1, 3, wait)
			mu.Lock()
			attempts[n]++
			mu.Unlock()
			if err != nil {
				fmt.Println("error:", err)
			}
		})
	}
	wg.Wait()
	it, _ := Get(ctx, db, 1)
	fmt.Println("won on 1st try:", attempts[1], "| needed a retry:", attempts[2])
	fmt.Println("stock:", it.Stock, "version:", it.Version)
	// Output:
	// won on 1st try: 1 | needed a retry: 1
	// stock: 4 version: 3
}</code></pre>
<p>Without the check, two sales of 3 took stock from 10 to 7: three items vanished from the books. With it, one buyer won at once, the other got 0 rows affected, re-read stock 7 at version 2, and sold from there. Final stock 4, version 3 (two successful writes).</p>
<p><strong>Letting the database detect it.</strong> Same race, no version column, two REPEATABLE READ transactions interleaved by hand:</p>
<pre><code>// Two REPEATABLE READ transactions, interleaved by hand in one goroutine.
func ExampleIsSerializationFailure() {
	ctx := context.Background()
	db := fresh()
	defer db.Close()
	rr := pgx.TxOptions{IsoLevel: pgx.RepeatableRead}
	var a, b int
	t1, _ := db.BeginTx(ctx, rr)
	t2, _ := db.BeginTx(ctx, rr)
	t1.QueryRow(ctx, &#96;SELECT stock FROM items WHERE id = 1&#96;).Scan(&amp;a)
	t2.QueryRow(ctx, &#96;SELECT stock FROM items WHERE id = 1&#96;).Scan(&amp;b)
	fmt.Println("t1 read", a, "| t2 read", b)
	_, err := t1.Exec(ctx, &#96;UPDATE items SET stock = $1 WHERE id = 1&#96;, a-3)
	fmt.Println("t1 update:", err, "| commit:", t1.Commit(ctx))
	_, err = t2.Exec(ctx, &#96;UPDATE items SET stock = $1 WHERE id = 1&#96;, b-3)
	fmt.Println("t2 update:", err)
	fmt.Println("retry it?", IsSerializationFailure(err))
	t2.Rollback(ctx)
	// Output:
	// t1 read 10 | t2 read 10
	// t1 update: &lt;nil&gt; | commit: &lt;nil&gt;
	// t2 update: ERROR: could not serialize access due to concurrent update (SQLSTATE 40001)
	// retry it? true
}</code></pre>
<p>Under the default READ COMMITTED, <code>t2</code>'s update would have succeeded and written 7. Under REPEATABLE READ, Postgres sees that the row changed after <code>t2</code>'s snapshot and refuses. <code>t2</code> must roll back and start over with a new snapshot.</p>
<p>(<code>IsSerializationFailure</code> is <code>errors.As</code> to <code>*pgconn.PgError</code> plus <code>Code == "40001"</code>.)</p>
<p><strong>In memory and over HTTP.</strong> A CAS loop hands out 50 seats to 200 goroutines without a mutex. A small <code>http.Handler</code> serves a document with <code>ETag: "v&lt;version&gt;"</code> and, on <code>PUT</code>, answers 428 if <code>If-Match</code> is missing, 412 if it isn't the current ETag, and otherwise saves and bumps the version:</p>
<pre><code>// TryTake is optimistic locking in memory: read, compute, compare-and-swap.
func TryTake(seats *atomic.Int64, n int64) bool {
	for {
		cur := seats.Load()
		if cur &lt; n {
			return false
		}
		if seats.CompareAndSwap(cur, cur-n) {
			return true
		}
		// another goroutine changed it between Load and CAS: loop and re-read
	}
}</code></pre>
<pre><code>// ExampleTryTake
buyers: 200, got a seat: 50 seats left: 0

// ExampleDoc
GET → ETag "v0"
alice PUT If-Match: "v0" → 204 No Content "v1"
bob PUT If-Match: "v0" → 412 Precondition Failed
carol PUT If-Match:  → 428 Precondition Required</code></pre>
<p>Alice and Bob both loaded version <code>"v0"</code>. Alice saved first. Bob's <code>If-Match: "v0"</code> no longer matches, so his edit is refused instead of erasing Alice's. Carol sent no <code>If-Match</code>, and this server insists on one.</p>

<p><strong>Real-world scenario.</strong> At 10:00 two staff open product 42 in the admin panel (price $25, version 8). One sets the price to $19 and saves at 10:02 (version 9). The other fixes a typo and saves at 10:05, sending the whole form, which still says $25: the sale price silently disappears. With <code>WHERE id = 42 AND version = 8</code>, the 10:05 save hits 0 rows and the API returns 409 with the current product. The checkout path doesn't use this: hundreds of requests hit the same stock row during a sale, so it uses an atomic <code>stock = stock - $1 WHERE stock &gt;= $1</code>.</p>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>Checking the version in a separate <code>SELECT</code>.</strong> "Read the version, compare in Go, then update" has the same gap you were trying to close. The comparison must be in the <code>UPDATE</code>'s <code>WHERE</code>, and you must look at rows affected.</li>
  <li><strong>Ignoring rows affected.</strong> An <code>UPDATE</code> that matches nothing is not an error in SQL. If you only check <code>err</code>, the conflict passes silently and you have built a lost update with extra steps.</li>
  <li><strong>Writers that skip the version.</strong> A batch job or another service that updates without <code>version = version + 1</code> is invisible to every check. Bump it on every write path, or in a trigger.</li>
  <li><strong>Using <code>updated_at</code> as the version.</strong> Two writes can get the same timestamp, server clocks differ (<a href="#clock-skew">Clock Skew</a>), and Postgres keeps microseconds while Go's <code>time.Time</code> has nanoseconds, so a Go-built value may never compare equal. Use an integer.</li>
  <li><strong>Retrying forever.</strong> Cap attempts and add jitter (<a href="#exponential-backoff">Exponential Backoff</a>). A conflict storm on a hot row is a design signal, not a reason to retry harder.</li>
  <li><strong>Side effects before the write.</strong> If you charge a card, send an email or publish an event and <em>then</em> lose the version check, you can't take it back. Write first, or make the side effect idempotent (<a href="#idempotency">Idempotency</a>), or lock pessimistically.</li>
  <li><strong>SERIALIZABLE without a retry wrapper.</strong> 40001 can come from any statement, or from <code>COMMIT</code>. Wrap the whole transaction function, not one query.</li>
</ul>

<div class="callout warn"><strong>Atomic statement, not atomic intention.</strong> Optimistic locking only works because <code>UPDATE … WHERE version = $n</code> checks and writes in one step. Any version of it that splits the check from the write is broken.</div>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>Lost updates happen whenever an app reads, computes and writes back. Default READ COMMITTED won't stop them.</li>
  <li>Optimistic locking takes no lock: write <code>WHERE version = $read</code>, bump the version, and treat 0 rows affected as a conflict.</li>
  <li>It is the same idea as ETag + <code>If-Match</code> (412), <code>CompareAndSwap</code>, and REPEATABLE READ / SERIALIZABLE (40001): on conflict, redo the whole unit or ask the user.</li>
  <li>It wins with low contention and long think time; on hot rows use an atomic <code>UPDATE</code> or a pessimistic lock.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#pessimistic-locking">Pessimistic Locking</a> · <a href="#race-conditions">Race Conditions</a> · <a href="#idempotency">Idempotency</a> · <a href="#retries">Retries</a> · <a href="#thread-safety">Thread Safety</a> · <a href="#real-world-concurrent-service">Real-World Concurrent Service</a></p>
`;
CONTENT["pessimistic-locking"] = `
<p class="tldr"><strong>TL;DR</strong>: Pessimistic locking assumes someone <em>will</em> fight you for the data, so it locks the data before reading it and holds the lock until it commits. Everyone else who wants to change it waits their turn. It's the single key to a petrol-station bathroom: whoever holds the key goes in, everyone else queues at the counter.</p>

<h2>The problem it solves</h2>
<p>Read-modify-write code has a gap between reading a value and writing the new one. In that gap, another request can read the same old value, and one of the two writes gets lost (the <em>lost update</em>, see <a href="#optimistic-locking">Optimistic Locking</a>). Optimistic locking detects that at write time and throws the loser's work away. That is a poor fit when:</p>
<ul>
  <li><strong>Conflicts are the normal case.</strong> 300 people try to book the last seats of a concert. With optimistic locking most attempts fail and retry, again and again.</li>
  <li><strong>The work can't be thrown away.</strong> You call a payment provider or send a shipment request between reading and writing. If the write then fails, you can't take the side effect back.</li>
  <li><strong>The decision needs a stable view.</strong> "Withdraw 80 if the balance is at least 80" must not be decided on a balance that changes while you look at it.</li>
</ul>
<p>Pessimistic locking closes the gap from the other side: take the lock <em>first</em>, so nobody else can change the row until you are done. The second request doesn't fail; it waits, then reads the new value and decides correctly.</p>

<h2>How it works</h2>
<p>In PostgreSQL the tool is a <strong>row lock</strong>, taken by <code>SELECT … FOR UPDATE</code> inside a transaction. The lock lasts until <code>COMMIT</code> or <code>ROLLBACK</code>. Plain <code>SELECT</code>s are not blocked (MVCC gives them a snapshot); other <code>FOR UPDATE</code>s, <code>UPDATE</code>s and <code>DELETE</code>s of that row wait.</p>
<pre><code>BEGIN;
SELECT holder FROM seats WHERE id = 7 FOR UPDATE;   -- lock first (others now wait)
-- decide in the app: holder is '' → free
UPDATE seats SET holder = 'alice' WHERE id = 7;
COMMIT;                                             -- lock released here</code></pre>
<figure class="diagram">
<svg viewBox="0 0 780 360" role="img" aria-label="Sequence diagram. Transaction A runs SELECT FOR UPDATE on seat 7 and gets the row with an empty holder; the row is now locked by A. Transaction B runs SELECT FOR UPDATE on the same row and blocks; pg_stat_activity shows it waiting on a Lock. A updates holder to alice and commits, releasing the lock. B's SELECT now returns the row with holder alice, so B reports seat taken and rolls back.">
  <defs><marker id="arr-pl-1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <rect class="box accent" x="50" y="16" width="120" height="36" rx="6"/><text x="110" y="39" text-anchor="middle" class="title">Tx A (alice)</text>
  <rect class="box" x="310" y="16" width="160" height="36" rx="6"/><text x="390" y="39" text-anchor="middle" class="title">seats row id=7</text>
  <rect class="box accent" x="610" y="16" width="120" height="36" rx="6"/><text x="670" y="39" text-anchor="middle" class="title">Tx B (bob)</text>
  <path d="M110 52 V350" style="stroke: var(--line)"/>
  <path d="M390 52 V350" style="stroke: var(--line)"/>
  <path d="M670 52 V350" style="stroke: var(--line)"/>

  <path class="line" d="M110 88 H386" marker-end="url(#arr-pl-1)"/>
  <text x="250" y="80" text-anchor="middle" class="small">BEGIN; SELECT … FOR UPDATE</text>
  <path class="line ok" d="M390 118 H114" marker-end="url(#arr-pl-1)"/>
  <text x="250" y="110" text-anchor="middle" class="small">holder '' · row locked by A</text>
  <rect class="box accent" x="382" y="120" width="16" height="122" rx="3"/>

  <path class="line" d="M670 150 H402" marker-end="url(#arr-pl-1)"/>
  <text x="530" y="142" text-anchor="middle" class="small">BEGIN; SELECT … FOR UPDATE</text>
  <rect class="box bad" x="662" y="156" width="16" height="122" rx="3"/>
  <text x="560" y="200" text-anchor="middle" class="small">B blocks: waits for A</text>
  <text x="560" y="216" text-anchor="middle" class="small">wait_event_type = Lock</text>

  <path class="line" d="M110 190 H378" marker-end="url(#arr-pl-1)"/>
  <text x="250" y="182" text-anchor="middle" class="small">UPDATE holder = 'alice'</text>
  <path class="line accent" d="M110 236 H378" marker-end="url(#arr-pl-1)"/>
  <text x="250" y="228" text-anchor="middle" class="small">COMMIT → lock released</text>

  <path class="line ok" d="M398 272 H658" marker-end="url(#arr-pl-1)"/>
  <text x="530" y="264" text-anchor="middle" class="small">holder 'alice' · now locked by B</text>
  <path class="line" d="M670 316 H394" marker-end="url(#arr-pl-1)"/>
  <text x="530" y="308" text-anchor="middle" class="small">taken → ROLLBACK</text>
  <text x="250" y="290" text-anchor="middle" class="small">B decided on the committed value,</text>
  <text x="250" y="306" text-anchor="middle" class="small">not on a stale copy</text>
</svg>
<figcaption>The exact run of <code>ExampleReserve</code> below. The orange bar is A holding the row lock, the red bar is B waiting. B is never wrong; it is only late.</figcaption>
</figure>

<h3>The four row lock modes</h3>
<p><code>FOR UPDATE</code> is the strongest of four row-level lock modes. Postgres also takes them implicitly: a <code>DELETE</code>, or an <code>UPDATE</code> that changes certain columns (such as a key column), takes <code>FOR UPDATE</code>; any other <code>UPDATE</code> takes <code>FOR NO KEY UPDATE</code>. Foreign-key checks lock the referenced parent row with <code>FOR KEY SHARE</code>, which is why the weaker modes matter:</p>
<table>
  <tr><th>Mode</th><th>Meaning</th><th>Conflicts with (held by another tx)</th></tr>
  <tr><td><code>FOR UPDATE</code></td><td>exclusive; "I may delete it or change its key"</td><td>all four modes</td></tr>
  <tr><td><code>FOR NO KEY UPDATE</code></td><td>exclusive, but lets FK checks through; what a normal <code>UPDATE</code> takes</td><td><code>FOR SHARE</code>, <code>FOR NO KEY UPDATE</code>, <code>FOR UPDATE</code></td></tr>
  <tr><td><code>FOR SHARE</code></td><td>shared: many readers may hold it; nobody may change the row</td><td><code>FOR NO KEY UPDATE</code>, <code>FOR UPDATE</code></td></tr>
  <tr><td><code>FOR KEY SHARE</code></td><td>weakest: "don't delete it or change its key"</td><td><code>FOR UPDATE</code> only</td></tr>
</table>
<p>The practical rule: if you lock a row only to update non-key columns, <code>FOR NO KEY UPDATE</code> is enough, and it won't block other transactions inserting child rows that reference it (<code>orders</code> rows pointing at a locked <code>customers</code> row, say). <code>FOR UPDATE</code> would make those inserts wait.</p>

<h3>When the row is already locked</h3>
<p>By default, a transaction that wants a conflicting lock waits <em>indefinitely</em> (the docs' word) unless a deadlock is detected. You can choose differently, per statement or per session:</p>
<table>
  <tr><th>Option</th><th>If the row is locked</th><th>Error</th><th>Use it for</th></tr>
  <tr><td>(plain) <code>FOR UPDATE</code></td><td>wait until the holder commits or rolls back</td><td>none; just latency</td><td>short critical sections where waiting is the right answer</td></tr>
  <tr><td><code>FOR UPDATE NOWAIT</code></td><td>fail at once</td><td><code>could not obtain lock on row in relation "…"</code>, SQLSTATE 55P03</td><td>"someone else is editing this" in a UI; don't queue behind them</td></tr>
  <tr><td><code>SET lock_timeout = '200ms'</code></td><td>wait up to the limit, then fail</td><td><code>canceling statement due to lock timeout</code>, 55P03</td><td>an upper bound on waiting; also for migrations (see <a href="#database-migrations">Database Migrations</a>)</td></tr>
  <tr><td><code>FOR UPDATE SKIP LOCKED</code></td><td>pretend the row isn't there</td><td>none</td><td>work queues: each worker takes a different row</td></tr>
</table>
<p><code>lock_timeout</code> applies separately to each lock acquisition, and 0 (the default) means no limit. Both errors share SQLSTATE 55P03, <code>lock_not_available</code>. Waiting forever is rarely what an HTTP request wants; set a bound on the request path, either <code>lock_timeout</code> or a context deadline (see <a href="#timeouts">Timeouts</a>).</p>

<h3>SKIP LOCKED: a job queue in a table</h3>
<p>Several workers draining a <code>jobs</code> table is the classic pessimistic-locking problem. With no lock, two workers read the same pending job and both run it. With plain <code>FOR UPDATE</code>, they all try to lock the <em>same</em> first pending row, so they queue behind each other and work one at a time. <code>SKIP LOCKED</code> makes each worker skip rows that others hold, so worker 4 takes job 4 while 1–3 are busy. The Postgres docs warn that skipping gives an inconsistent view of the data, "not suitable for general purpose work", but fine for "multiple consumers accessing a queue-like table".</p>
<figure class="diagram">
<svg viewBox="0 0 780 290" role="img" aria-label="Four workers and a jobs table with eight pending jobs. Workers 1 to 3 hold row locks on jobs 1 to 3. Worker 4 runs SELECT FOR UPDATE SKIP LOCKED with LIMIT 1, skips the locked rows 1 to 3, and locks job 4. On the right: with no lock, worker 4 also takes job 1 and it runs twice; with plain FOR UPDATE, worker 4 waits on job 1; with SKIP LOCKED, worker 4 takes job 4 and all four work in parallel.">
  <defs><marker id="arr-pl-2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <rect class="box" x="20" y="30" width="110" height="30" rx="6"/><text x="75" y="50" text-anchor="middle">worker 1</text>
  <rect class="box" x="20" y="72" width="110" height="30" rx="6"/><text x="75" y="92" text-anchor="middle">worker 2</text>
  <rect class="box" x="20" y="114" width="110" height="30" rx="6"/><text x="75" y="134" text-anchor="middle">worker 3</text>
  <rect class="box ok" x="20" y="156" width="110" height="30" rx="6"/><text x="75" y="176" text-anchor="middle">worker 4</text>
  <text x="75" y="206" text-anchor="middle" class="small">SKIP LOCKED LIMIT 1</text>
  <text x="75" y="222" text-anchor="middle" class="small">skips 1–3, locks 4</text>

  <text x="345" y="22" text-anchor="middle" class="title">jobs (status = 'pending')</text>
  <rect class="box accent" x="250" y="32" width="190" height="24" rx="4"/><text x="345" y="49" text-anchor="middle" class="small">job 1 · locked by W1</text>
  <rect class="box accent" x="250" y="60" width="190" height="24" rx="4"/><text x="345" y="77" text-anchor="middle" class="small">job 2 · locked by W2</text>
  <rect class="box accent" x="250" y="88" width="190" height="24" rx="4"/><text x="345" y="105" text-anchor="middle" class="small">job 3 · locked by W3</text>
  <rect class="box ok" x="250" y="116" width="190" height="24" rx="4"/><text x="345" y="133" text-anchor="middle" class="small">job 4 · locked by W4</text>
  <rect class="box muted" x="250" y="144" width="190" height="24" rx="4"/><text x="345" y="161" text-anchor="middle" class="small">job 5 · free</text>
  <rect class="box muted" x="250" y="172" width="190" height="24" rx="4"/><text x="345" y="189" text-anchor="middle" class="small">job 6 · free</text>
  <rect class="box muted" x="250" y="200" width="190" height="24" rx="4"/><text x="345" y="217" text-anchor="middle" class="small">… job 100 · free</text>

  <path class="line" d="M130 45 H248" marker-end="url(#arr-pl-2)"/>
  <path class="line" d="M130 87 L248 72" marker-end="url(#arr-pl-2)"/>
  <path class="line" d="M130 129 L248 100" marker-end="url(#arr-pl-2)"/>
  <path class="line ok" d="M130 171 L248 128" marker-end="url(#arr-pl-2)"/>

  <rect class="box bad" x="500" y="30" width="260" height="60" rx="8"/>
  <text x="630" y="52" text-anchor="middle" class="title">No lock</text>
  <text x="630" y="72" text-anchor="middle" class="small">W4 reads job 1 too → it runs twice</text>
  <rect class="box bad" x="500" y="108" width="260" height="60" rx="8"/>
  <text x="630" y="130" text-anchor="middle" class="title">FOR UPDATE</text>
  <text x="630" y="150" text-anchor="middle" class="small">W4 waits on job 1 → one at a time</text>
  <rect class="box ok" x="500" y="186" width="260" height="60" rx="8"/>
  <text x="630" y="208" text-anchor="middle" class="title">FOR UPDATE SKIP LOCKED</text>
  <text x="630" y="228" text-anchor="middle" class="small">W4 takes job 4 → all run in parallel</text>
  <text x="390" y="276" text-anchor="middle" class="small">each job's row lock is held until its worker commits status = 'done'</text>
</svg>
<figcaption>The three variants measured in the example: same 100 jobs, same 4 workers, very different results.</figcaption>
</figure>
<p>This is a solid queue for modest volumes when the jobs already live in Postgres: enqueueing is a plain <code>INSERT</code> in the same transaction as the business write, so there's no dual-write problem. For high fan-out, replay or cross-service delivery, use a broker (see <a href="#message-queues">Message Queues</a>). Scheduled work often lands in such a table too (see <a href="#cron-jobs">Cron Jobs</a>).</p>

<h3>Other lock types</h3>
<p><strong>Advisory locks</strong> lock a number your app chooses, not a row. Use them when there is nothing to lock yet ("only one invoice run per customer") or the thing isn't a row at all. Prefer the transaction-level functions: they release at <code>COMMIT</code>/<code>ROLLBACK</code>. Session-level <code>pg_advisory_lock</code> survives a rollback and stays until you unlock or disconnect, and it breaks behind a transaction-mode pooler (see <a href="#connection-pooling">Connection Pooling</a>).</p>
<pre><code>-- Illustration (not run on this page): one invoice run per customer at a time,
-- even though there is no row to lock yet. 1001 is an app-chosen "namespace".
BEGIN;
SELECT pg_advisory_xact_lock(1001, $1);       -- waits if another tx holds (1001, customer)
-- … read usage, insert invoices …
COMMIT;                                       -- released automatically

SELECT pg_try_advisory_xact_lock(1001, $1);   -- non-blocking variant: returns true/false</code></pre>
<p><strong>Table locks</strong> (<code>LOCK TABLE … IN … MODE</code>, eight modes from <code>ACCESS SHARE</code> to <code>ACCESS EXCLUSIVE</code>) are rarely what app code wants: they serialize every writer of the table. You meet them mostly through DDL: most forms of <code>ALTER TABLE</code> take <code>ACCESS EXCLUSIVE</code>, which blocks even plain reads.</p>
<p><strong>In process</strong>, a Go <code>sync.Mutex</code> is the same idea: <code>Lock</code>, work, <code>Unlock</code>; <code>sync.RWMutex</code> is the <code>FOR SHARE</code> / <code>FOR UPDATE</code> split for memory. It protects one process only; with three replicas you have three mutexes (see <a href="#thread-safety">Thread Safety</a>). Across services with no shared database row, you need a <a href="#distributed-locks">distributed lock</a>.</p>
<table>
  <tr><th>Tool</th><th>Scope</th><th>Released</th><th>Good for</th></tr>
  <tr><td>Row lock (<code>FOR UPDATE</code> / <code>NO KEY UPDATE</code>)</td><td>specific rows</td><td>end of transaction</td><td>balances, seats, stock: the row you're about to change</td></tr>
  <tr><td>Advisory lock (<code>pg_advisory_xact_lock</code>)</td><td>an app-chosen key</td><td>end of tx (xact variant)</td><td>serializing a job or a process that has no single row</td></tr>
  <tr><td>Table lock (<code>LOCK TABLE</code>)</td><td>whole table</td><td>end of transaction</td><td>bulk rewrites, migrations; rarely app code</td></tr>
  <tr><td><code>sync.Mutex</code> / <code>RWMutex</code></td><td>one Go process</td><td><code>Unlock</code></td><td>in-memory state</td></tr>
  <tr><td>Distributed lock (lease)</td><td>many processes, any resource</td><td>unlock or lease expiry</td><td>coordination without a shared DB row</td></tr>
</table>

<h2>Example</h2>
<p>The tests run a real PostgreSQL 18 (<code>embedded-postgres</code>, <code>pgx</code>). <code>Reserve</code> books a seat: lock the row, check it is free, write, commit. The <code>lock</code> argument picks the locking clause, and a test hook lets us pause while the lock is held.</p>
<pre><code>// Reserve locks the seat row first, then checks and writes.
// lock is the locking clause, e.g. "FOR UPDATE" or "FOR UPDATE NOWAIT".
// whileLocked is a test hook that runs while we hold the row lock.
func Reserve(ctx context.Context, db *pgxpool.Pool, seat int, user, lock string, whileLocked func()) error {
	tx, err := db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) // no-op after Commit

	var holder string
	err = tx.QueryRow(ctx, &#96;SELECT holder FROM seats WHERE id = $1 &#96;+lock, seat).Scan(&amp;holder)
	if err != nil {
		return err // includes "could not obtain lock" from NOWAIT / lock_timeout
	}
	whileLocked()
	if holder != "" {
		return ErrTaken // safe: nobody can change the row until we finish
	}
	if _, err = tx.Exec(ctx, &#96;UPDATE seats SET holder = $1 WHERE id = $2&#96;, user, seat); err != nil {
		return err
	}
	return tx.Commit(ctx)
}</code></pre>
<p><strong>1. Blocking.</strong> Alice locks seat 7 and pauses. Bob tries to book the same seat. While he waits, we ask Postgres who is waiting on a lock:</p>
<pre><code>func ExampleReserve() {
	ctx := context.Background()
	db := open(nil)
	defer db.Close()
	setup(db, 0)
	locked, release := make(chan struct{}), make(chan struct{})
	var wg sync.WaitGroup

	wg.Go(func() {
		err := Reserve(ctx, db, 7, "alice", "FOR UPDATE", func() {
			fmt.Println("A: locked seat 7")
			close(locked)
			&lt;-release
			fmt.Println("A: writing alice, committing")
		})
		fmt.Println("A: done, err =", err)
	})
	&lt;-locked
	start := time.Now()
	wg.Go(func() {
		fmt.Println("B: SELECT … FOR UPDATE (blocks)")
		err := Reserve(ctx, db, 7, "bob", "FOR UPDATE", func() {
			fmt.Println("B: got the lock after A committed, waited ≥300ms:",
				time.Since(start) &gt;= 300*time.Millisecond)
		})
		fmt.Println("B: done, err =", err)
	})
	time.Sleep(300 * time.Millisecond)
	var waiting int
	db.QueryRow(ctx, &#96;SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock'&#96;).Scan(&amp;waiting)
	fmt.Println("sessions waiting on a lock:", waiting)
	close(release)
	wg.Wait()
	// Output:
	// A: locked seat 7
	// B: SELECT … FOR UPDATE (blocks)
	// sessions waiting on a lock: 1
	// A: writing alice, committing
	// A: done, err = &lt;nil&gt;
	// B: got the lock after A committed, waited ≥300ms: true
	// B: done, err = seat already taken
}</code></pre>
<p>All outputs on this page are pinned <code>// Output:</code> blocks of <code>Example</code> tests, so they are real (and stable across <code>-count=3</code>). Bob's session sat in <code>wait_event_type = 'Lock'</code> for 300 ms, then read the committed row and refused correctly. Nobody got an error, and the seat was not double-booked.</p>
<p><strong>2. Failing fast.</strong> Same situation, but Bob uses <code>NOWAIT</code>, then a pool whose sessions all have <code>lock_timeout = 200ms</code> (set through pgx's <code>RuntimeParams</code>):</p>
<pre><code>func Example_failFast() {
	ctx := context.Background()
	db := open(map[string]string{"lock_timeout": "200ms"}) // every session in this pool
	defer db.Close()
	setup(db, 0)
	locked, release := make(chan struct{}), make(chan struct{})
	go Reserve(ctx, db, 7, "alice", "FOR UPDATE", func() { close(locked); &lt;-release })
	&lt;-locked

	start := time.Now()
	err := Reserve(ctx, db, 7, "bob", "FOR UPDATE NOWAIT", func() {})
	fmt.Printf("NOWAIT after %v: %v&#92;n", time.Since(start).Round(time.Second), err)

	start = time.Now()
	err = Reserve(ctx, db, 7, "bob", "FOR UPDATE", func() {})
	fmt.Println("lock_timeout, gave up after ~200ms:",
		time.Since(start).Round(100*time.Millisecond) == 200*time.Millisecond)
	fmt.Println(err)
	close(release)
	// Output:
	// NOWAIT after 0s: ERROR: could not obtain lock on row in relation "seats" (SQLSTATE 55P03)
	// lock_timeout, gave up after ~200ms: true
	// ERROR: canceling statement due to lock timeout (SQLSTATE 55P03)
}</code></pre>
<p><strong>3. A job queue.</strong> 100 jobs, 4 workers, each job "takes" 10 ms. <code>WorkOne</code> claims one job, runs it while holding the row lock, and marks it done. The test runs it with no lock clause, with <code>FOR UPDATE</code>, and with <code>FOR UPDATE SKIP LOCKED</code>:</p>
<pre><code>// WorkOne claims and runs one pending job. It returns false if it found none.
// lock is "FOR UPDATE SKIP LOCKED" (the queue pattern), "FOR UPDATE", or "".
func WorkOne(ctx context.Context, db *pgxpool.Pool, worker int, lock string, process func(id int)) (bool, error) {
	tx, err := db.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)

	var id int
	err = tx.QueryRow(ctx, &#96;SELECT id FROM jobs WHERE status = 'pending'
		ORDER BY id LIMIT 1 &#96;+lock).Scan(&amp;id)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	process(id) // the row stays locked while we work: keep this short
	_, err = tx.Exec(ctx, &#96;UPDATE jobs SET status = 'done', runs = runs + 1, worker = $2
		WHERE id = $1&#96;, id, worker)
	if err != nil {
		return false, err
	}
	return true, tx.Commit(ctx)
}</code></pre>
<p>Output of one run (<code>go test -v -run TestQueue</code>, laptop). The locked variants always give exactly 100; the no-lock count moves a little between runs (394–397 here), and times vary:</p>
<pre><code>""                       executions=397 ranTwice=99 leftPending=0 workersUsed=4 took=1.17s
"FOR UPDATE"             executions=100 ranTwice=0 leftPending=0 workersUsed=4 took=1.13s
"FOR UPDATE SKIP LOCKED" executions=100 ranTwice=0 leftPending=0 workersUsed=4 took=300ms</code></pre>
<ul>
  <li><strong>No lock:</strong> about 4 executions per job. All four workers saw the same "first pending" job each time, so nearly every job ran four times, and it took as long as one worker would.</li>
  <li><strong><code>FOR UPDATE</code>:</strong> correct (100 executions), but the workers queued on the same row, so 4 workers took about 1 s, the time of 100 × 10 ms in a row.</li>
  <li><strong><code>SKIP LOCKED</code>:</strong> correct <em>and</em> parallel: 300 ms, about a quarter of the time.</li>
</ul>

<p><strong>Real-world scenario.</strong> A wallet has a balance of 100. The user double-taps "withdraw 80", and two requests arrive 5 ms apart. With <code>SELECT balance</code> then <code>UPDATE</code>, both see 100, both approve, and the balance ends at 20 after paying out 160 (or at −60, if the update subtracts). With <code>SELECT balance FROM wallets WHERE id = $1 FOR NO KEY UPDATE</code>, the second request waits about as long as the first transaction takes (a few ms), sees 20, and declines. Two more rules keep it healthy: the payment-provider call happens <em>after</em> commit, driven by an outbox row, so no lock is held across the network; and the handler sets <code>lock_timeout = '2s'</code>, so a stuck transaction gives callers a fast 503 instead of a pile-up. A double-tap is also a job for an <a href="#idempotency">idempotency key</a>; the lock protects the balance from <em>different</em> requests too.</p>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>Holding locks across slow work.</strong> A transaction that calls an HTTP API, waits on a user, or sleeps holds its row locks, and every waiter holds a pooled connection too. One slow call can exhaust the pool (see <a href="#connection-pooling">Connection Pooling</a>). Do network calls before or after the transaction.</li>
  <li><strong>Locking outside a transaction.</strong> In autocommit mode, <code>SELECT … FOR UPDATE</code> is its own transaction: the lock is released the moment the statement returns. Begin a transaction, and run every statement on that <code>tx</code>, not on the pool.</li>
  <li><strong>Inconsistent lock order.</strong> Transfer A→B locks account A then B; transfer B→A locks B then A. Under load they deadlock, and Postgres aborts one. Lock in a fixed order (by id), or in one statement with <code>ORDER BY id FOR UPDATE</code> (see <a href="#deadlocks">Deadlocks</a>).</li>
  <li><strong>Locking more than you need.</strong> <code>FOR UPDATE</code> on a range or a join locks every matching row; <code>FOR UPDATE</code> where <code>FOR NO KEY UPDATE</code> would do blocks foreign-key inserts. Lock exactly the rows you'll change, with the weakest mode that works.</li>
  <li><strong>Waiting without a bound.</strong> The default wait is unlimited. Use <code>NOWAIT</code>, <code>lock_timeout</code> or a context deadline, and treat 55P03 as "busy, try later", not as a bug.</li>
  <li><strong>Long jobs inside a SKIP LOCKED transaction.</strong> Fine for seconds. For minutes, claim the job instead (<code>UPDATE … SET status = 'running', locked_until = now() + interval '5 minutes' … RETURNING</code>), commit, and run it outside any transaction; a sweeper requeues expired claims. That is a lease, and the job must be idempotent.</li>
  <li><strong>A mutex is not a database lock.</strong> <code>sync.Mutex</code> around a read-modify-write only serializes goroutines of one process. The second replica races right past it.</li>
</ul>

<div class="callout warn"><strong>Lock duration is throughput.</strong> A hot row can handle about 1 / (time the lock is held) writes per second. A 2 ms transaction allows roughly 500 per second on that row; put a 200 ms API call inside it and the ceiling drops to about 5.</div>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>Pessimistic locking locks first, then reads and writes; contenders wait instead of failing, so it fits hot rows and work you can't redo.</li>
  <li>In Postgres: <code>SELECT … FOR UPDATE</code> (or the lighter <code>FOR NO KEY UPDATE</code>) inside a transaction; the lock lasts until commit.</li>
  <li>Bound every wait with <code>NOWAIT</code> or <code>lock_timeout</code> (55P03), and use <code>SKIP LOCKED</code> to let many workers drain a table queue in parallel.</li>
  <li>Keep transactions short, lock in a consistent order, and never hold a lock across a network call.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#optimistic-locking">Optimistic Locking</a> · <a href="#deadlocks">Deadlocks</a> · <a href="#thread-safety">Thread Safety</a> · <a href="#distributed-locks">Distributed Locks</a> · <a href="#message-queues">Message Queues</a> · <a href="#connection-pooling">Connection Pooling</a></p>
`;
CONTENT["race-conditions"] = `
<p class="tldr"><strong>TL;DR</strong>: A race is a bug whose result depends on who gets there first. Two people take the last coffee cup from a shelf at the same moment: both saw one cup, both reached for it, and the shop's count is now wrong. In Go there are two kinds: a <em>data race</em> (two goroutines touch the same memory without synchronisation, and the race detector can find it) and a <em>race condition</em> (correctly synchronised steps that still interleave badly, like check-then-act, which no tool will catch for you).</p>

<h2>The problem it solves</h2>
<p>Code that is correct when one thing runs at a time can be wrong when two run at once. Your HTTP server runs each request in its own goroutine, the database serves many connections, and you run several pods, so "at once" is the normal case. These bugs are <strong>intermittent</strong>: the test passes 999 times, then production double-charges a customer during a sale. This page is about recognising the two kinds of race, finding them, and picking the fix; the fixes themselves have their own pages.</p>
<table>
  <tr><th></th><th>Data race</th><th>Race condition</th></tr>
  <tr><td>Definition</td><td>Two goroutines access the same memory location at the same time, at least one writes, and nothing orders them (no lock, channel or atomic).</td><td>The program's result depends on the timing or order of events, and some orders give a wrong result.</td></tr>
  <tr><td>Level</td><td>Memory (one variable, map, slice)</td><td>Logic (a sequence of steps, often across processes or a database)</td></tr>
  <tr><td>Typical shape</td><td><code>x++</code> on a shared int; a map written from two goroutines</td><td>check-then-act, read-modify-write, TOCTOU</td></tr>
  <tr><td>Found by <code>go test -race</code>?</td><td>Yes, if the racy path actually runs during the test</td><td>No. Every access can be properly locked and the logic still be wrong</td></tr>
  <tr><td>Can be undefined behaviour?</td><td>Yes: torn values, memory corruption, crashes</td><td>No; each step is well defined, the <em>combination</em> is wrong</td></tr>
</table>
<p>A data race usually causes a race condition, but a program with zero data races can still have one. The database example below is exactly that.</p>

<h2>How it works</h2>
<h3>Why <code>x++</code> loses updates</h3>
<p><code>x++</code> looks like one step. The CPU does three: load <code>x</code> into a register, add one, store it back. If two goroutines interleave those steps, both load the same old value and both store the same new value. Two increments happened; the counter moved by one.</p>
<figure class="diagram">
<svg viewBox="0 0 780 320" role="img" aria-label="Timeline of a lost update. Goroutine A reads x equal to 5. Goroutine B reads x equal to 5. Both compute 5 plus 1 equals 6 in a register. A writes 6. B writes 6. Two increments ran but x only went from 5 to 6.">
  <defs><marker id="arr-race-1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <rect class="box accent" x="70" y="16" width="160" height="36" rx="6"/><text x="150" y="39" text-anchor="middle" class="title">goroutine A</text>
  <rect class="box" x="310" y="16" width="160" height="36" rx="6"/><text x="390" y="39" text-anchor="middle" class="title">x in memory</text>
  <rect class="box accent" x="550" y="16" width="160" height="36" rx="6"/><text x="630" y="39" text-anchor="middle" class="title">goroutine B</text>
  <path class="line dashed" d="M150 52 V286" style="stroke: var(--line)"/>
  <path class="line dashed" d="M390 52 V286" style="stroke: var(--line)"/>
  <path class="line dashed" d="M630 52 V286" style="stroke: var(--line)"/>

  <rect class="box" x="350" y="78" width="80" height="24" rx="4"/><text x="390" y="95" text-anchor="middle">x = 5</text>
  <path class="line" d="M350 90 H154" marker-end="url(#arr-race-1)"/><text x="252" y="82" text-anchor="middle" class="small">load: 5</text>

  <rect class="box" x="350" y="118" width="80" height="24" rx="4"/><text x="390" y="135" text-anchor="middle">x = 5</text>
  <path class="line" d="M430 130 H626" marker-end="url(#arr-race-1)"/><text x="528" y="122" text-anchor="middle" class="small">load: 5</text>

  <rect class="box" x="95" y="158" width="110" height="24" rx="4"/><text x="150" y="175" text-anchor="middle">5 + 1 = 6</text>
  <rect class="box" x="575" y="158" width="110" height="24" rx="4"/><text x="630" y="175" text-anchor="middle">5 + 1 = 6</text>

  <path class="line" d="M154 214 H348" marker-end="url(#arr-race-1)"/><text x="252" y="206" text-anchor="middle" class="small">store: 6</text>
  <rect class="box ok" x="350" y="202" width="80" height="24" rx="4"/><text x="390" y="219" text-anchor="middle">x = 6</text>

  <path class="line bad" d="M626 254 H432" marker-end="url(#arr-race-1)"/><text x="528" y="246" text-anchor="middle" class="small">store: 6</text>
  <rect class="box bad" x="350" y="242" width="80" height="24" rx="4"/><text x="390" y="259" text-anchor="middle">x = 6</text>

  <text x="390" y="308" text-anchor="middle">Two increments ran; x went from 5 to 6. A's update was overwritten.</text>
</svg>
<figcaption>The lost update, in memory. The same shape appears in a database when two requests <code>SELECT</code> a value, change it in code, and <code>UPDATE</code> it back.</figcaption>
</figure>

<h3>The Go memory model in plain words</h3>
<p>The <a href="https://go.dev/ref/mem">Go memory model</a> defines a data race as "a write to a memory location happening concurrently with another read or write to that same location, unless all the accesses involved are atomic data accesses as provided by the <code>sync/atomic</code> package." The practical rules:</p>
<ul>
  <li><strong>Without synchronisation, there is no "before".</strong> If goroutine A writes <code>x</code> and B reads it, B is not guaranteed to see the write (or see writes in A's order) unless something links them. Compilers and CPUs reorder freely.</li>
  <li><strong>Synchronisation creates "happens before" edges.</strong> The spec lists them: a send on a channel is synchronised before the matching receive completes; the n'th <code>Unlock</code> of a mutex before the next <code>Lock</code>; the function run by <code>once.Do(f)</code> completes before any <code>once.Do(f)</code> returns; atomic operations are ordered too.</li>
  <li><strong>Race-free programs are easy to reason about.</strong> "Data-race-free programs execute in a sequentially consistent manner" (DRF-SC): as if the goroutines took turns on one processor. Racy programs get no such promise. Races on multi-word values (strings, slices, interfaces, maps) can produce values that no goroutine ever wrote, which "can in turn lead to arbitrary memory corruption".</li>
</ul>
<p>The memory model page's own advice: "If you must read the rest of this document to understand the behavior of your program, you are being too clever. Don't be clever."</p>

<h3>Race conditions: the shapes to recognise</h3>
<p>Most logical races are one of three patterns. Learn to spot them in code review:</p>
<ul>
  <li><strong>Check-then-act.</strong> <code>if !exists(email) { insert(email) }</code>, <code>if balance &gt;= amount { debit(amount) }</code>, <code>if cache[k] == nil { cache[k] = load() }</code>. Between the check and the act, another goroutine or request can make the check false.</li>
  <li><strong>Read-modify-write.</strong> Read a value, compute a new one in code, write it back: <code>x++</code>, or <code>SELECT stock</code> then <code>UPDATE stock = $new</code>. Concurrent writers overwrite each other (the lost update).</li>
  <li><strong>TOCTOU (time of check to time of use).</strong> The check-then-act pattern against something outside your process: a file, a permission, a URL you validated and then fetch. The world can change between the two.</li>
</ul>
<pre><code>// CreateNaive is TOCTOU: another process can create path between Stat and
// Create, and Create would then truncate that file.
func CreateNaive(path string) (*os.File, error) {
	if _, err := os.Stat(path); err == nil { // time of check
		return nil, fs.ErrExist
	}
	return os.Create(path) // time of use
}

// CreateExclusive asks the OS to check and create in one step.
// If the file exists, the error matches fs.ErrExist.
func CreateExclusive(path string) (*os.File, error) {
	return os.OpenFile(path, os.O_RDWR|os.O_CREATE|os.O_EXCL, 0o644)
}</code></pre>
<p>The fix is the same every time: make the check and the act <strong>one indivisible step</strong>, by putting them under one lock, into one atomic operation, into one SQL statement, or behind a constraint the database enforces.</p>

<h3>Finding races</h3>
<ul>
  <li><strong>The race detector.</strong> Add <code>-race</code> to <code>go test</code>, <code>go run</code> or <code>go build</code>. It instruments every memory access and reports two conflicting accesses with no "happens before" between them, with both stack traces. It is built on ThreadSanitizer. The Go docs put its cost at "memory usage may increase by 5-10x and execution time by 2-20x" for a typical program, so run it in CI and in a canary, not on your whole fleet. It "only finds races that happen at runtime": an untested path stays unchecked.</li>
  <li><strong>Make races likely to happen.</strong> Tests that hit shared state from many goroutines at once (<code>t.Parallel()</code>, a loop of goroutines), run repeatedly: <code>go test -race -count=50 -run TestCheckout</code>.</li>
  <li><strong>Force the bad interleaving.</strong> For logical races, don't wait for luck. Put a hook between the check and the act and make both callers wait there (the <code>meet</code> helper below). The test then fails every time, and passes every time once fixed.</li>
  <li><strong>Read the data.</strong> In production, a race condition usually shows up first as data that "can't happen": duplicate rows, negative stock.</li>
</ul>

<h3>Fixes: pick by where the shared state lives</h3>
<table>
  <tr><th>Fix</th><th>What it makes indivisible</th><th>Use it for</th><th>More</th></tr>
  <tr><td><code>sync.Mutex</code> / <code>RWMutex</code></td><td>Any block of code (the critical section)</td><td>In-process state with several fields or invariants</td><td><a href="#thread-safety">Thread Safety</a></td></tr>
  <tr><td><code>sync/atomic</code> (<code>atomic.Int64</code>, <code>CompareAndSwap</code>)</td><td>One read-modify-write on one word</td><td>Counters, flags, swapping a pointer to an immutable snapshot</td><td><a href="#thread-safety">Thread Safety</a></td></tr>
  <tr><td>Channels / one owner goroutine</td><td>Everything, because only one goroutine touches the data</td><td>Pipelines, state owned by a worker</td><td><a href="#thread-safety">Thread Safety</a></td></tr>
  <tr><td>Conditional SQL (<code>UPDATE … WHERE balance &gt;= $1</code>), check rows affected</td><td>Check and write, in one statement</td><td>Counters, balances, stock in the database</td><td>Example below</td></tr>
  <tr><td>Unique constraint / <code>INSERT … ON CONFLICT</code></td><td>"Doesn't exist yet" and the insert</td><td>Sign-ups, one-per-user rules, dedup tables</td><td>Example below</td></tr>
  <tr><td>Version column (<code>WHERE version = $n</code>)</td><td>Read and later write, by detecting interference</td><td>Edits with user think-time; low contention</td><td><a href="#optimistic-locking">Optimistic Locking</a></td></tr>
  <tr><td><code>SELECT … FOR UPDATE</code></td><td>Read and later write, by blocking others</td><td>Hot rows; multi-step logic in one transaction</td><td><a href="#pessimistic-locking">Pessimistic Locking</a></td></tr>
  <tr><td>Idempotency key</td><td>"Has this request already been done?" and doing it</td><td>Retries and double-clicks on payments</td><td><a href="#idempotency">Idempotency</a></td></tr>
  <tr><td>Distributed lock / leader</td><td>Work across processes and machines</td><td>Cron jobs on several pods, singleton workers</td><td><a href="#distributed-locks">Distributed Locks</a></td></tr>
</table>
<p>Order of preference: don't share the state at all; else push the check into whatever owns the data (an atomic, one SQL statement, a constraint); use explicit locks when the logic is too big for one step.</p>

<h2>Example</h2>
<p><strong>1. A data race, caught.</strong> Eight goroutines each increment a counter 100,000 times, three ways. <code>run</code> is just the fan-out; the three closures are what differ.</p>
<pre><code>package race

import (
	"sync"
	"sync/atomic"
)

// run starts workers goroutines; each calls inc perWorker times.
func run(workers, perWorker int, inc func()) {
	var wg sync.WaitGroup
	for range workers {
		wg.Go(func() {
			for range perWorker {
				inc()
			}
		})
	}
	wg.Wait()
}

// RacyCount has a data race: x++ is a load, an add and a store,
// and nothing stops two goroutines from interleaving those steps.
func RacyCount(workers, perWorker int) int {
	x := 0
	run(workers, perWorker, func() { x++ })
	return x
}

// AtomicCount makes the read-modify-write one indivisible step.
func AtomicCount(workers, perWorker int) int64 {
	var x atomic.Int64
	run(workers, perWorker, func() { x.Add(1) })
	return x.Load()
}

// MutexCount lets one goroutine at a time run the critical section.
func MutexCount(workers, perWorker int) int {
	x := 0
	var mu sync.Mutex
	run(workers, perWorker, func() {
		mu.Lock()
		x++
		mu.Unlock()
	})
	return x
}</code></pre>
<p>The racy version, run three times on a 12-core laptop without <code>-race</code>. The test "passes" because nothing checks the value:</p>
<pre><code>    race_test.go:18: RacyCount(8, 100000) = 202709, want 800000
    race_test.go:18: RacyCount(8, 100000) = 105952, want 800000
    race_test.go:18: RacyCount(8, 100000) = 196032, want 800000
ok  	example.com/race	7.160s</code></pre>
<p>Between 75% and 87% of the increments vanished, and the number changes on every run. The same test with <code>-race</code> (one real run, paths shortened, the second report cut):</p>
<pre><code>$ RACE_DEMO=1 go test -race -run TestRacyCount .
==================
WARNING: DATA RACE
Read at 0x00c000b7f178 by goroutine 32:
  example.com/race.RacyCount.func1()
      …/counter.go:25 +0x2c
  example.com/race.run.func1()
      …/counter.go:14 +0x40

Previous write at 0x00c000b7f178 by goroutine 31:
  example.com/race.RacyCount.func1()
      …/counter.go:25 +0x3c
  example.com/race.run.func1()
      …/counter.go:14 +0x40

Goroutine 32 (running) created at:
  sync.(*WaitGroup).Go()
      $GOROOT/src/sync/waitgroup.go:238 +0x6c
  example.com/race.RacyCount()
      …/counter.go:25 +0xa8
  example.com/race.TestRacyCount()
  …
==================
--- FAIL: TestRacyCount (0.08s)
    race_test.go:18: RacyCount(8, 100000) = 287049, want 800000
    race_test.go:18: RacyCount(8, 100000) = 300464, want 800000
    race_test.go:18: RacyCount(8, 100000) = 356861, want 800000
    testing.go:1865: race detected during execution of test
FAIL</code></pre>
<p>Read it top down: <em>what</em> raced (a read and a write at the same address, both at <code>counter.go:25</code>, the <code>x++</code> inside the closure), then <em>where each goroutine was started</em>. The lost counts differ from run to run and between modes; never trust one green run. The fixed versions are exact every time, and clean under <code>-race</code>:</p>
<pre><code>func ExampleAtomicCount() {
	fmt.Println("atomic:", AtomicCount(8, 100_000))
	fmt.Println("mutex: ", MutexCount(8, 100_000))
	// Output:
	// atomic: 800000
	// mutex:  800000
}</code></pre>

<p><strong>2. A race condition with no data race: double spend.</strong> An account has 100. Two requests each withdraw 80. The naive code checks the balance in Go, then writes the new balance. Every statement is fine and there is no shared memory, so <code>-race</code> has nothing to report.</p>
<figure class="diagram">
<svg viewBox="0 0 780 290" role="img" aria-label="Left: check then act. Request A and B both SELECT balance 100, both check 100 is at least 80, both run UPDATE SET balance equals 20. Both succeed and 160 is paid from an account of 100. Right: one conditional UPDATE. Request A's UPDATE WHERE balance at least 80 matches one row, balance becomes 20. Request B's UPDATE waits for A's row lock, re-checks the WHERE clause on the new row, 20 is less than 80, so zero rows are updated and B gets insufficient funds.">
  <defs><marker id="arr-race-2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <text x="195" y="20" text-anchor="middle" class="title">Check, then act (2 statements)</text>
  <text x="590" y="20" text-anchor="middle" class="title">One conditional UPDATE</text>
  <path class="line dashed" d="M395 8 V282" style="stroke: var(--line)"/>

  <rect class="box accent" x="20" y="34" width="80" height="28" rx="5"/><text x="60" y="53" text-anchor="middle">request A</text>
  <rect class="box" x="155" y="34" width="80" height="28" rx="5"/><text x="195" y="53" text-anchor="middle">accounts</text>
  <rect class="box accent" x="290" y="34" width="80" height="28" rx="5"/><text x="330" y="53" text-anchor="middle">request B</text>
  <path class="line dashed" d="M60 62 V232" style="stroke: var(--line)"/>
  <path class="line dashed" d="M195 62 V232" style="stroke: var(--line)"/>
  <path class="line dashed" d="M330 62 V232" style="stroke: var(--line)"/>
  <path class="line" d="M193 92 H64" marker-end="url(#arr-race-2)"/><text x="128" y="85" text-anchor="middle" class="small">SELECT → 100</text>
  <path class="line" d="M197 120 H326" marker-end="url(#arr-race-2)"/><text x="262" y="113" text-anchor="middle" class="small">SELECT → 100</text>
  <rect class="box" x="22" y="138" width="76" height="24" rx="4"/><text x="60" y="154" text-anchor="middle" class="small">100 ≥ 80 ✓</text>
  <rect class="box" x="292" y="138" width="76" height="24" rx="4"/><text x="330" y="154" text-anchor="middle" class="small">100 ≥ 80 ✓</text>
  <path class="line" d="M64 192 H191" marker-end="url(#arr-race-2)"/><text x="128" y="185" text-anchor="middle" class="small">SET balance = 20</text>
  <path class="line bad" d="M326 220 H199" marker-end="url(#arr-race-2)"/><text x="262" y="213" text-anchor="middle" class="small">SET balance = 20</text>
  <rect class="box bad" x="30" y="242" width="330" height="34" rx="6"/><text x="195" y="264" text-anchor="middle">both succeed: 160 paid out of 100</text>

  <rect class="box accent" x="420" y="34" width="80" height="28" rx="5"/><text x="460" y="53" text-anchor="middle">request A</text>
  <rect class="box" x="550" y="34" width="80" height="28" rx="5"/><text x="590" y="53" text-anchor="middle">accounts</text>
  <rect class="box accent" x="680" y="34" width="80" height="28" rx="5"/><text x="720" y="53" text-anchor="middle">request B</text>
  <path class="line dashed" d="M460 62 V232" style="stroke: var(--line)"/>
  <path class="line dashed" d="M590 62 V232" style="stroke: var(--line)"/>
  <path class="line dashed" d="M720 62 V232" style="stroke: var(--line)"/>
  <path class="line" d="M464 92 H586" marker-end="url(#arr-race-2)"/><text x="525" y="85" text-anchor="middle" class="small">UPDATE … ≥ 80</text>
  <path class="line" d="M716 120 H594" marker-end="url(#arr-race-2)"/><text x="655" y="113" text-anchor="middle" class="small">UPDATE … ≥ 80</text>
  <rect class="box muted" x="530" y="136" width="120" height="24" rx="4"/><text x="590" y="152" text-anchor="middle" class="small">B waits: row locked</text>
  <path class="line ok" d="M586 192 H464" marker-end="url(#arr-race-2)"/><text x="525" y="185" text-anchor="middle" class="small">1 row · now 20</text>
  <path class="line" d="M594 220 H716" marker-end="url(#arr-race-2)"/><text x="655" y="213" text-anchor="middle" class="small">0 rows: 20 &lt; 80</text>
  <rect class="box ok" x="425" y="242" width="330" height="34" rx="6"/><text x="590" y="264" text-anchor="middle">A paid 80; B gets "insufficient funds"</text>
</svg>
<figcaption>The same two requests. On the left, the check uses a value that is already stale when the write lands. On the right, the database does the check at write time, on the latest row.</figcaption>
</figure>
<pre><code>package race

import (
	"context"
	"database/sql"
	"errors"

	_ "github.com/jackc/pgx/v5/stdlib"
)

var ErrInsufficient = errors.New("insufficient funds")

// WithdrawNaive is check-then-act across two statements. pause() is a
// test hook that holds the goroutine between the check and the act.
func WithdrawNaive(ctx context.Context, db *sql.DB, id, amount int, pause func()) error {
	var balance int
	err := db.QueryRowContext(ctx, "SELECT balance FROM accounts WHERE id = $1", id).Scan(&amp;balance)
	if err != nil {
		return err
	}
	if balance &lt; amount { // check
		return ErrInsufficient
	}
	pause()
	_, err = db.ExecContext(ctx, "UPDATE accounts SET balance = $1 WHERE id = $2", // act
		balance-amount, id)
	return err
}

// Withdraw puts the check and the act in one statement. If another UPDATE
// holds the row, Postgres waits for it, then re-checks the WHERE clause
// against the new version of the row (READ COMMITTED behaviour).
func Withdraw(ctx context.Context, db *sql.DB, id, amount int) error {
	res, err := db.ExecContext(ctx,
		"UPDATE accounts SET balance = balance - $1 WHERE id = $2 AND balance &gt;= $1", amount, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrInsufficient
	}
	return nil
}</code></pre>
<p>The test uses a real PostgreSQL (<code>embedded-postgres</code>, pgx driver). <code>twice</code> runs a function in two goroutines and returns both outcomes, sorted; <code>meet</code> makes both goroutines finish their check before either one acts, so the bad interleaving happens on every run instead of once in a while. It is an <code>Example</code> test, so the output is checked by <code>go test</code>; the whole package also passes under <code>-race</code>.</p>
<pre><code>func meet(n int) func() {
	var wg sync.WaitGroup
	wg.Add(n)
	return func() { wg.Done(); wg.Wait() }
}

func ExampleWithdraw() {
	ctx := context.Background()
	db, _ := sql.Open("pgx", dsn)
	defer db.Close()
	db.Exec("DROP TABLE IF EXISTS accounts")
	db.Exec("CREATE TABLE accounts (id int PRIMARY KEY, balance int NOT NULL)")
	var balance int

	db.Exec("INSERT INTO accounts VALUES (1, 100)")
	pause := meet(2)
	errs := twice(func() error { return WithdrawNaive(ctx, db, 1, 80, pause) })
	db.QueryRow("SELECT balance FROM accounts WHERE id = 1").Scan(&amp;balance)
	fmt.Println("naive:", errs, "balance:", balance)

	db.Exec("UPDATE accounts SET balance = 100 WHERE id = 1")
	errs = twice(func() error { return Withdraw(ctx, db, 1, 80) })
	db.QueryRow("SELECT balance FROM accounts WHERE id = 1").Scan(&amp;balance)
	fmt.Println("atomic:", errs, "balance:", balance)
	// Output:
	// naive: [ok ok] balance: 20
	// atomic: [insufficient funds ok] balance: 20
}</code></pre>
<p>Read the naive line carefully: both withdrawals report success, 160 left the account, and the balance says 20. No error, no crash, no race report. The conditional <code>UPDATE</code> gives one success and one clean "insufficient funds". <code>ExampleSignup</code> in the same package does check-then-insert (<code>SELECT EXISTS</code>, then <code>INSERT</code>): two concurrent sign-ups for <code>ana@example.com</code> both pass <code>SELECT EXISTS</code>. Without a constraint the real output is <code>[ok ok] rows: 2</code>; after <code>ADD CONSTRAINT users_email_key UNIQUE (email)</code>, the same code gives <code>[email already registered ok] rows: 1</code>, because the loser's <code>INSERT</code> fails with SQLSTATE <code>23505</code> (unique_violation). Keep the <code>SELECT</code> for a friendly fast path; the constraint is what makes it correct.</p>

<p><strong>Real-world scenario.</strong> A ticketing API sells seats with "read remaining, if &gt; 0 then decrement"; 300 requests arrive in the first second for 50 seats. Under burst, many requests read <code>remaining = 1</code> within the same milliseconds and each sells "the last seat"; tests and <code>-race</code> stay green because the race lives between two SQL statements. The fix is one statement: <code>UPDATE events SET remaining = remaining - 1 WHERE id = $1 AND remaining &gt; 0</code>, treat 0 rows affected as "sold out", and a <code>UNIQUE (event_id, seat_no)</code> constraint on tickets as a second line of defence.</p>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>"The race detector is clean, so we have no races."</strong> It only sees data races, and only on executed paths. Check-then-act across SQL statements, files or services is invisible to it.</li>
  <li><strong>"It's only a counter / a flag / a debug stat."</strong> A data race in Go is not just a wrong number. On strings, slices, interfaces and maps it can corrupt memory. Concurrent map writes crash the process with a fatal error. Use <code>atomic</code> even for "harmless" counters.</li>
  <li><strong>Fixing a race with <code>time.Sleep</code>.</strong> A sleep changes the odds, not the logic.</li>
  <li><strong>Locking each step separately.</strong> <code>if c.Has(k) { c.Set(k, v) }</code> on a thread-safe cache is still check-then-act: each call is locked, the pair is not. Offer a compound method (<code>SetIfAbsent</code>, <code>LoadOrStore</code>) instead.</li>
  <li><strong>Read-modify-write in SQL.</strong> <code>SELECT</code> then <code>UPDATE … SET x = $computed</code> loses updates at the default READ COMMITTED level. Write <code>SET x = x - $1</code> with a guard in <code>WHERE</code>, or use a version check or <code>FOR UPDATE</code>.</li>
  <li><strong>Trusting an in-process mutex across pods.</strong> A <code>sync.Mutex</code> protects one process. With three replicas you have three mutexes. Shared state across instances needs the database (constraints, row locks) or a <a href="#distributed-locks">distributed lock</a>.</li>
</ul>

<div class="callout warn"><strong>Constraints are the last line of defence.</strong> If a rule must never be broken (one account per email, one ticket per seat, stock never negative), state it as a database constraint (<code>UNIQUE</code>, <code>CHECK (stock &gt;= 0)</code>). Application checks can race; the constraint can't be bypassed by timing.</div>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>A data race is unsynchronised access to the same memory; a race condition is a timing-dependent wrong result. You can have the second without the first.</li>
  <li>Watch for check-then-act, read-modify-write and TOCTOU. The fix is always to make the check and the act one indivisible step.</li>
  <li>Run <code>go test -race</code> in CI with concurrent tests; for logical races, force the interleaving in a test instead of hoping for it.</li>
  <li>For shared data in a database, prefer conditional <code>UPDATE</code>s and constraints over checks in Go code.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#thread-safety">Thread Safety</a> · <a href="#optimistic-locking">Optimistic Locking</a> · <a href="#pessimistic-locking">Pessimistic Locking</a> · <a href="#idempotency">Idempotency</a> · <a href="#distributed-locks">Distributed Locks</a> · <a href="#real-world-concurrent-service">Real-World Concurrent Service</a></p>
`;

CONTENT["deadlocks"] = `
<p class="tldr"><strong>TL;DR</strong>: A deadlock is two (or more) workers each holding something the other needs, and each waiting for the other to let go first. Picture two cars nose to nose on a one-lane bridge: neither can move forward, and neither will back up. Nothing crashes and no error is logged. The work just stops. The cure is almost always to make everyone take locks in <strong>the same order</strong>.</p>

<h2>The problem it solves</h2>
<p>Locks fix <a href="#race-conditions">race conditions</a>, and the moment you hold more than one lock at a time, you can build a deadlock. The classic case is a bank transfer. To move money from A to B safely you lock both accounts. Request 1 transfers A→B and locks A first. At the same millisecond, request 2 transfers B→A and locks B first. Now request 1 waits for B, request 2 waits for A, and both wait forever.</p>
<p>Deadlocks are <strong>silent</strong> (a stuck goroutine uses no CPU and logs nothing; you see timeouts and a drained connection pool instead), <strong>timing-dependent</strong> (the code passes thousands of tests and hangs only when two opposite transfers overlap under load) and <strong>contagious</strong> (anything that needs one of the stuck locks stops too).</p>

<h2>How it works</h2>
<p>Draw who is waiting for whom. Each worker is a node; an arrow "G1 → G2" means "G1 is waiting for something G2 holds". This is the <strong>wait-for graph</strong>. A deadlock is exactly a <strong>cycle</strong> in it: follow the arrows and you come back where you started, so nobody in the cycle can ever proceed.</p>
<figure class="diagram">
<svg viewBox="0 0 780 300" role="img" aria-label="Left: goroutine 1 holds lock A and wants lock B; goroutine 2 holds lock B and wants lock A; the arrows form a cycle, which is a deadlock. Right: both goroutines take lock A first. Goroutine 1 holds A and takes B next, which is free. Goroutine 2 waits for A. There is no cycle, so goroutine 1 finishes and releases A.">
  <defs><marker id="arr-dlk-1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <text x="195" y="30" text-anchor="middle" class="title">Opposite order: a cycle</text>
  <text x="595" y="30" text-anchor="middle" class="title">Same order (A before B): no cycle</text>
  <path class="line dashed" d="M390 12 V290" style="stroke: var(--line)"/>

  <rect class="box accent" x="40" y="70" width="120" height="44" rx="6"/><text x="100" y="89" text-anchor="middle">goroutine 1</text><text x="100" y="105" text-anchor="middle" class="small">transfer A→B</text>
  <rect class="box" x="230" y="70" width="120" height="44" rx="6"/><text x="290" y="97" text-anchor="middle">lock A</text>
  <rect class="box" x="40" y="190" width="120" height="44" rx="6"/><text x="100" y="217" text-anchor="middle">lock B</text>
  <rect class="box accent" x="230" y="190" width="120" height="44" rx="6"/><text x="290" y="209" text-anchor="middle">goroutine 2</text><text x="290" y="225" text-anchor="middle" class="small">transfer B→A</text>
  <path class="line" d="M230 92 H162" marker-end="url(#arr-dlk-1)"/><text x="195" y="84" text-anchor="middle" class="small">held by</text>
  <path class="line" d="M160 212 H228" marker-end="url(#arr-dlk-1)"/><text x="195" y="204" text-anchor="middle" class="small">held by</text>
  <path class="line bad dashed" d="M100 114 V188" marker-end="url(#arr-dlk-1)"/><text x="94" y="155" text-anchor="end" class="small">wants</text>
  <path class="line bad dashed" d="M290 190 V116" marker-end="url(#arr-dlk-1)"/><text x="296" y="155" class="small">wants</text>
  <text x="195" y="155" text-anchor="middle" class="small">cycle = deadlock</text>
  <text x="195" y="266" text-anchor="middle" class="small">each waits for a lock the other holds</text>

  <rect class="box accent" x="410" y="70" width="120" height="44" rx="6"/><text x="470" y="89" text-anchor="middle">goroutine 1</text><text x="470" y="105" text-anchor="middle" class="small">transfer A→B</text>
  <rect class="box" x="640" y="70" width="120" height="44" rx="6"/><text x="700" y="97" text-anchor="middle">lock A</text>
  <rect class="box ok" x="410" y="190" width="120" height="44" rx="6"/><text x="470" y="209" text-anchor="middle">lock B</text><text x="470" y="225" text-anchor="middle" class="small">free</text>
  <rect class="box accent" x="640" y="190" width="120" height="44" rx="6"/><text x="700" y="209" text-anchor="middle">goroutine 2</text><text x="700" y="225" text-anchor="middle" class="small">transfer B→A</text>
  <path class="line" d="M640 92 H532" marker-end="url(#arr-dlk-1)"/><text x="585" y="84" text-anchor="middle" class="small">held by</text>
  <path class="line ok" d="M470 114 V188" marker-end="url(#arr-dlk-1)"/><text x="476" y="155" class="small">takes B next</text>
  <path class="line dashed" d="M700 190 V116" marker-end="url(#arr-dlk-1)"/><text x="694" y="155" text-anchor="end" class="small">waits</text>
  <text x="595" y="266" text-anchor="middle" class="small">goroutine 2 waits, but goroutine 1 can finish and release A</text>
</svg>
<figcaption>Left: the transfer bug. Right: the fix. If every goroutine takes locks in one global order (here: lower account ID first), an arrow can only point "forward" in that order, so the arrows can never close into a cycle.</figcaption>
</figure>

<h3>The four conditions (Coffman)</h3>
<p>In 1971 Coffman, Elphick and Shoshani described four conditions that must <em>all</em> hold for a deadlock. Break any one and deadlock is impossible:</p>
<ol>
  <li><strong>Mutual exclusion</strong>: only one holder at a time. Break it with immutable data or atomics.</li>
  <li><strong>Hold and wait</strong>: a worker holds one resource and asks for another. Break it by taking one lock, or all locks at once.</li>
  <li><strong>No preemption</strong>: nobody can take a lock away. Break it with timeouts and <code>TryLock</code>; databases break it by aborting a transaction.</li>
  <li><strong>Circular wait</strong>: a cycle in the wait-for graph. Break it with one global lock order. This is the usual fix, and it costs nothing at runtime.</li>
</ol>

<h3>Deadlocks in Go</h3>
<p>Go gives you several ways to build one. Mutexes are the obvious one, but channels and <code>WaitGroup</code>s are just as good at it:</p>
<ul>
  <li><strong>Lock-order inversion.</strong> Two goroutines take the same two mutexes in opposite order (the transfer above).</li>
  <li><strong>Re-locking in the same goroutine.</strong> Go mutexes are not reentrant: a method holding <code>mu</code> that calls another method locking <code>mu</code> blocks forever. The <code>sync</code> docs also forbid recursive <code>RLock</code>: a waiting writer blocks your second <code>RLock</code>.</li>
  <li><strong>A channel nobody serves.</strong> A send on an unbuffered channel waits for a receiver. If the receiver has returned (an error path, a timeout), the sender waits forever.</li>
  <li><strong><code>WaitGroup</code> misuse.</strong> <code>Add(n)</code> but fewer than <code>n</code> calls to <code>Done</code>, usually because an early <code>return</code> skipped it. <code>Wait</code> never returns.</li>
  <li><strong>Mixed resources.</strong> A goroutine holds <code>mu</code> and sends on a channel whose receiver needs <code>mu</code> first. Same cycle.</li>
</ul>
<p><strong>What the runtime catches.</strong> If <em>every</em> goroutine is blocked, the runtime stops the program with <code>fatal error: all goroutines are asleep - deadlock!</code> and prints all stacks. That check is global: if any goroutine can still wake up, nothing is reported. The runtime source (<code>checkdead</code> in <code>runtime/proc.go</code>) also gives up if any timer is pending. A real service always has a ticker, a timer or another goroutine alive, so in production a deadlock almost always looks like a hang, not like this error. The example below shows both cases.</p>
<p><strong>How you find it: a goroutine dump.</strong> Every goroutine's stack, with what it is blocked on in brackets: <code>[sync.Mutex.Lock]</code>, <code>[chan send]</code>, <code>[sync.WaitGroup.Wait]</code>. After a minute the runtime adds how long, e.g. <code>[chan send, 12 minutes]</code>. Ways to get one:</p>
<ul>
  <li><code>kill -QUIT &lt;pid&gt;</code>: prints all stacks to stderr and exits (status 2).</li>
  <li><code>net/http/pprof</code>: <code>/debug/pprof/goroutine?debug=2</code>, same text, process keeps running. <code>?debug=1</code> groups identical stacks with a count.</li>
  <li>In code or tests: <code>pprof.Lookup("goroutine").WriteTo(w, 2)</code>.</li>
</ul>

<h3>Deadlocks in PostgreSQL</h3>
<p>Row locks behave like mutexes. An <code>UPDATE</code> locks the row until the transaction ends. Two transactions updating the same two rows in opposite order build the same cycle. The difference: Postgres breaks it for you.</p>
<figure class="diagram">
<svg viewBox="0 0 780 340" role="img" aria-label="Timeline of a Postgres deadlock. At 0 ms, tx1 updates row 1 and tx2 updates row 2; each now holds a row lock. At 200 ms, tx1 tries to update row 2 and waits for tx2; tx2 tries to update row 1 and waits for tx1. At about 1.2 seconds deadlock_timeout of 1 second expires, the detector finds the cycle, and one transaction, the victim, gets ERROR deadlock detected SQLSTATE 40P01 and is rolled back. The other transaction's update proceeds and it commits.">
  <defs><marker id="arr-dlk-2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <path class="line" d="M230 56 V330" style="stroke: var(--line)"/>
  <path class="line" d="M550 56 V330" style="stroke: var(--line)"/>
  <rect class="box accent" x="150" y="18" width="160" height="38" rx="6"/><text x="230" y="42" text-anchor="middle" class="title">tx1: 1→2</text>
  <rect class="box accent" x="470" y="18" width="160" height="38" rx="6"/><text x="550" y="42" text-anchor="middle" class="title">tx2: 2→1</text>

  <text x="20" y="94" class="small">0 ms</text>
  <rect class="box" x="140" y="72" width="180" height="40" rx="6"/><text x="230" y="89" text-anchor="middle">UPDATE id=1</text><text x="230" y="104" text-anchor="middle" class="small">now holds row 1</text>
  <rect class="box" x="460" y="72" width="180" height="40" rx="6"/><text x="550" y="89" text-anchor="middle">UPDATE id=2</text><text x="550" y="104" text-anchor="middle" class="small">now holds row 2</text>

  <text x="20" y="146" class="small">200 ms</text>
  <rect class="box muted" x="140" y="124" width="180" height="40" rx="6"/><text x="230" y="141" text-anchor="middle">UPDATE id=2</text><text x="230" y="156" text-anchor="middle" class="small">blocked</text>
  <rect class="box muted" x="460" y="124" width="180" height="40" rx="6"/><text x="550" y="141" text-anchor="middle">UPDATE id=1</text><text x="550" y="156" text-anchor="middle" class="small">blocked</text>
  <path class="line bad dashed" d="M320 184 H548" marker-end="url(#arr-dlk-2)"/><text x="435" y="176" text-anchor="middle" class="small">tx1 waits for tx2 (row 2)</text>
  <path class="line bad dashed" d="M460 212 H232" marker-end="url(#arr-dlk-2)"/><text x="345" y="204" text-anchor="middle" class="small">tx2 waits for tx1 (row 1)</text>

  <text x="20" y="252" class="small">≈1.2 s</text>
  <rect class="box bad" x="140" y="230" width="500" height="34" rx="6"/><text x="390" y="252" text-anchor="middle">deadlock_timeout (1s) expires → detector finds the cycle</text>

  <rect class="box bad" x="130" y="280" width="200" height="44" rx="6"/><text x="230" y="298" text-anchor="middle">ERROR 40P01</text><text x="230" y="314" text-anchor="middle" class="small">victim: rolled back → retry</text>
  <rect class="box ok" x="450" y="280" width="200" height="44" rx="6"/><text x="550" y="298" text-anchor="middle">UPDATE id=1 runs</text><text x="550" y="314" text-anchor="middle" class="small">COMMIT</text>
</svg>
<figcaption>The exact run in the example below. Which transaction is the victim is up to Postgres; the docs say not to rely on it. The other one simply continues, about a second late.</figcaption>
</figure>
<p>The deadlock check is "relatively expensive" (the docs' words), so a waiting backend first waits <code>deadlock_timeout</code> (default <strong>1s</strong>), then searches for a cycle. If it finds one, one transaction gets <code>ERROR: deadlock detected</code> (SQLSTATE <code>40P01</code>) and is rolled back, releasing its locks. Two consequences:</p>
<ul>
  <li><strong>A deadlock costs at least a second</strong> for every transaction in the cycle.</li>
  <li><strong>The victim must retry the whole transaction</strong>, from <code>BEGIN</code>, not just the last statement. The transaction is already aborted. Treat 40P01 like a serialization failure (40001): retry with backoff, a few times. See <a href="#retries">Retries</a>.</li>
</ul>
<p>Without a cycle, Postgres doesn't intervene: a transaction waiting on a lock held by a slow (not deadlocked) transaction waits indefinitely. That's what <code>lock_timeout</code> and <code>statement_timeout</code> are for (see <a href="#pessimistic-locking">Pessimistic Locking</a>).</p>

<h3>Prevention strategies</h3>
<table>
  <tr><th>Strategy</th><th>Breaks condition</th><th>In Go</th><th>In the database</th><th>Cost / catch</th></tr>
  <tr><td><strong>Global lock order</strong></td><td>circular wait</td><td>lock the lower ID (or address, or name) first</td><td>update rows in primary-key order; <code>SELECT … ORDER BY id FOR UPDATE</code> to lock a set up front</td><td>Free at runtime. Every code path must follow it, including ones written next year</td></tr>
  <tr><td><strong>One lock, or all at once</strong></td><td>hold and wait</td><td>one mutex for the whole structure</td><td>lock every row you will touch at the start; or one advisory lock per aggregate</td><td>Less concurrency; you must know the full set up front</td></tr>
  <tr><td><strong>Timeouts / try-lock</strong></td><td>no preemption</td><td><code>TryLock</code> (the docs call correct uses "rare"), <code>select</code> with <code>ctx.Done()</code> on channels</td><td><code>lock_timeout</code>, <code>NOWAIT</code></td><td>Turns a hang into an error you must handle; back off or you get livelock</td></tr>
  <tr><td><strong>Detect and retry</strong></td><td>no preemption</td><td>a watchdog that dumps stacks and alerts</td><td>built in: 40P01 → retry the transaction</td><td>The deadlock still happens and costs ≥ <code>deadlock_timeout</code></td></tr>
  <tr><td><strong>Don't hold locks across waits</strong></td><td>hold and wait</td><td>no channel ops, I/O or callbacks under a mutex</td><td>no network calls inside a transaction</td><td>Shrinks the window; needs discipline, not code</td></tr>
</table>

<h3>Livelock and starvation</h3>
<p><strong>Livelock</strong> is a deadlock where everyone is busy: two goroutines <code>TryLock</code> the second lock, fail, release the first and retry, in lockstep, forever, like two people in a corridor stepping aside to the same side. Fix it with jittered backoff (see <a href="#exponential-backoff">Exponential Backoff</a>) or, better, a lock order.</p>
<p><strong>Starvation</strong> is one worker that never gets its turn while others keep going. Go's <code>sync.Mutex</code> guards against it: per its source, once a waiter has waited more than 1 ms the mutex enters <em>starvation mode</em> and hands ownership straight to the waiter at the front of the queue, instead of letting newly arriving goroutines barge in. In <code>RWMutex</code>, a waiting writer makes new readers queue behind it.</p>

<h2>Example</h2>
<p><strong>Scenario.</strong> A wallet service moves money between accounts. Alice sends Bob 10 while Bob sends Alice 20, both at the same moment. Each request locks the sender's account, writes an audit record (10 ms of I/O while holding the lock), then locks the receiver. When the two overlap, both goroutines hang forever, and every later request touching those accounts piles up behind them.</p>

<h3>1. In memory: a lock-order deadlock, caught by a watchdog</h3>
<pre><code>// TransferUnordered locks "from" then "to". Two opposite transfers
// (A→B and B→A) can each hold their first lock and wait for the other's.
func TransferUnordered(from, to *Account, amount int) {
	from.mu.Lock()
	defer from.mu.Unlock()
	audit()
	to.mu.Lock()
	defer to.mu.Unlock()
	from.Balance -= amount
	to.Balance += amount
}

// TransferOrdered always locks the lower ID first, whatever the direction.
// A global order means no cycle in the wait-for graph, so no deadlock.
func TransferOrdered(from, to *Account, amount int) {
	first, second := from, to
	if to.ID &lt; from.ID {
		first, second = to, from
	}
	first.mu.Lock()
	defer first.mu.Unlock()
	audit()
	second.mu.Lock()
	defer second.mu.Unlock()
	from.Balance -= amount
	to.Balance += amount
}

// Watchdog runs fn and reports false if it hasn't finished within d.
// The runtime won't flag a deadlock while other goroutines (or timers)
// are alive, so long-running services need their own detector like this.
func Watchdog(d time.Duration, fn func()) bool {
	done := make(chan struct{})
	go func() { fn(); close(done) }()
	select {
	case &lt;-done:
		return true
	case &lt;-time.After(d):
		return false
	}
}</code></pre>
<p>The test runs the two opposite transfers at once, first with the buggy version, then with the ordered one. It is an <code>Example</code> test, so <code>go test</code> fails if the output changes:</p>
<pre><code>func ExampleTransferUnordered() {
	finished := run(TransferUnordered)
	fmt.Println("unordered finished within 1s:", finished)
	dump := GoroutineDump()
	fmt.Println("goroutines blocked in sync.Mutex.Lock:", CountWaiting(dump, "sync.Mutex.Lock"))

	fmt.Println("ordered finished within 1s:", run(TransferOrdered))
}</code></pre>
<pre><code>unordered finished within 1s: false
goroutines blocked in sync.Mutex.Lock: 2
ordered finished within 1s: true</code></pre>
<p>No fatal error: the test binary still had live goroutines, so only the watchdog noticed. Part of the goroutine dump at that moment (real laptop run, trimmed): both goroutines sit in <code>TransferUnordered</code> line 26 (<code>to.mu.Lock()</code>), with the same two account pointers in swapped order. That is the inversion in plain sight.</p>
<pre><code>goroutine 19 [sync.Mutex.Lock]:
…
example.com/deadlocks.TransferUnordered(0x48d51f6d4000, 0x48d51f6d4018, 0xa)
	…/deadlocks/bank.go:26 +0x10c

goroutine … [sync.Mutex.Lock]:
…
example.com/deadlocks.TransferUnordered(0x48d51f6d4018, 0x48d51f6d4000, 0x14)
…</code></pre>

<h3>2. What the runtime does and doesn't catch</h3>
<p>A <code>WaitGroup</code> bug where every goroutine ends up blocked. The runtime catches this one:</p>
<pre><code>func main() {
	var wg sync.WaitGroup
	wg.Add(3)
	for id := 1; id &lt;= 3; id++ {
		go func() {
			if err := fetch(id); err != nil {
				return // BUG: returns without wg.Done(); use defer wg.Done() or wg.Go
			}
			wg.Done()
		}()
	}
	wg.Wait() // waits for a Done that never comes
	fmt.Println("all fetched")
}</code></pre>
<pre><code>$ go run ./cmd/asleep
fatal error: all goroutines are asleep - deadlock!

goroutine 1 [sync.WaitGroup.Wait]:
sync.runtime_SemacquireWaitGroup(0x1048e8200?, 0x30?)
	$GOROOT/src/runtime/sema.go:114 +0x38
sync.(*WaitGroup).Wait(0x7454ab416020)
	$GOROOT/src/sync/waitgroup.go:206 +0xa4
main.main()
	…/deadlocks/cmd/asleep/main.go:27 +0xb8
exit status 2</code></pre>
<p>Now a send with no receiver, in a program that also has one innocent background goroutine. The runtime reports nothing; the process just hangs. After 3 seconds we sent <code>SIGQUIT</code> to get the dump (real run, trimmed):</p>
<pre><code>func main() {
	go func() { // stands in for a metrics flusher, a cache janitor, ...
		for range time.Tick(time.Second) {
		}
	}()
	results := make(chan int) // unbuffered: a send waits for a receiver
	results &lt;- 42             // BUG: nobody ever receives
	fmt.Println(&lt;-results)
}</code></pre>
<pre><code>$ ./hang &amp; sleep 3; kill -QUIT $!
SIGQUIT: quit
…
goroutine 1 gp=0x4c3ba5541e0 m=nil [chan send]:
main.main()
	…/deadlocks/cmd/hang/main.go:14 +0x44
…
goroutine 34 gp=0x4c3ba6841e0 m=nil [chan receive]:
main.main.func1()
	…/deadlocks/cmd/hang/main.go:10 +0x4c
created by main.main in goroutine 1
	…/deadlocks/cmd/hang/main.go:9 +0x24
…
exit status 2</code></pre>
<p>Goroutine 1 is stuck in <code>[chan send]</code> at <code>main.go:14</code>, which is the bug. In a real service you would read the same thing from <code>/debug/pprof/goroutine?debug=2</code> without killing it.</p>

<h3>3. In PostgreSQL: a real "deadlock detected"</h3>
<p>The same transfer against an embedded PostgreSQL 18: each transaction updates the sender row, does 200 ms of work, then updates the receiver row.</p>
<pre><code>// Transfer debits "from" first, then credits "to". Two opposite transfers
// lock the two rows in opposite order: a deadlock waiting to happen.
func Transfer(ctx context.Context, db *pgxpool.Pool, from, to, amount int) error {
	return pgx.BeginFunc(ctx, db, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, addSQL, -amount, from); err != nil {
			return err
		}
		audit()
		_, err := tx.Exec(ctx, addSQL, amount, to)
		return err
	})
}

// IsRetryable reports whether Postgres aborted the transaction so that a
// retry of the whole transaction can succeed: deadlock or serialization failure.
func IsRetryable(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &amp;pgErr) &amp;&amp; (pgErr.Code == "40P01" || pgErr.Code == "40001")
}

// WithRetry re-runs the whole transaction when Postgres picked it as the victim.
func WithRetry(ctx context.Context, attempts int, fn func() error) error {
	var err error
	for i := range attempts {
		if err = fn(); !IsRetryable(err) {
			return err
		}
		time.Sleep(time.Duration(10&lt;&lt;i) * time.Millisecond) // see exponential backoff
	}
	return err
}</code></pre>
<p><code>TransferOrdered</code> (not shown) is the same function with the two <code>UPDATE</code>s swapped when <code>to &lt; from</code>, so rows are always touched in id order. The test helper <code>race</code> (not shown) resets both balances to 100 and runs 1→2 (10) and 2→1 (20) at the same moment; the example runs that pair three ways.</p>
<pre><code>func ExampleTransfer() {
	ctx := context.Background()
	db, _ := pgxpool.New(ctx, dsn)
	defer db.Close()
	var timeout string
	db.QueryRow(ctx, "SHOW deadlock_timeout").Scan(&amp;timeout)
	fmt.Println("deadlock_timeout:", timeout)

	errs, took := race(ctx, db, Transfer)
	fmt.Println("opposite order:", summary(errs), "took&gt;=1s:", took &gt;= time.Second)
	fmt.Println("victim got:", errors.Join(errs[:]...))

	retrying := func(ctx context.Context, db *pgxpool.Pool, from, to, amount int) error {
		return WithRetry(ctx, 3, func() error { return Transfer(ctx, db, from, to, amount) })
	}
	errs, _ = race(ctx, db, retrying)
	fmt.Println("with retry:    ", summary(errs), "balances:", balances(ctx, db))

	errs, took = race(ctx, db, TransferOrdered)
	fmt.Println("id order:      ", summary(errs), "took&gt;=1s:", took &gt;= time.Second)
}</code></pre>
<pre><code>deadlock_timeout: 1s
opposite order: committed=1 deadlocks=1 took&gt;=1s: true
victim got: ERROR: deadlock detected (SQLSTATE 40P01)
with retry:     committed=2 deadlocks=0 balances: 110,90
id order:       committed=2 deadlocks=0 took&gt;=1s: false</code></pre>
<p>The plain version deadlocked, waited out <code>deadlock_timeout</code>, and lost one transaction to 40P01. With retry, both commit and the balances are right (100 − 10 + 20 = 110, 100 + 10 − 20 = 90), but the deadlock still cost a second. In id order: no deadlock, no stall. The full error from one run, with the DETAIL Postgres attaches (PIDs and transaction IDs vary):</p>
<pre><code>ERROR: deadlock detected (SQLSTATE 40P01)
DETAIL: Process 83229 waits for ShareLock on transaction 810; blocked by process 83230.
Process 83230 waits for ShareLock on transaction 809; blocked by process 83229.
HINT: See server log for query details.
WHERE: while updating tuple (0,94) in relation "accounts"</code></pre>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>Lock order that depends on the arguments.</strong> <code>lock(from); lock(to)</code> looks ordered but isn't: the order flips with the direction of the transfer. Order by something stable: ID, primary key, name.</li>
  <li><strong>Holding a lock across I/O, channel sends or callbacks.</strong> It widens the deadlock window from nanoseconds to milliseconds (the 10 ms audit write above is what made the bug reliable) and hides lock acquisitions inside code you don't see. Copy the data out, unlock, then do the slow part.</li>
  <li><strong>Waiting for the runtime to tell you.</strong> "all goroutines are asleep" only fires when the <em>whole program</em> is stuck. In a service, partial deadlocks show up as timeouts and a rising <code>runtime.NumGoroutine()</code>. Alert on that, and keep <code>net/http/pprof</code> reachable on an internal port so you can pull a dump.</li>
  <li><strong>Retrying only the failed statement after 40P01.</strong> The transaction is aborted; every later statement fails until rollback. Retry the whole transaction, and make it safe to re-run (see <a href="#idempotency">Idempotency</a>).</li>
  <li><strong>Treating retry as the fix.</strong> Each deadlock still costs <code>deadlock_timeout</code> plus the redo. If <code>pg_stat_database.deadlocks</code> keeps growing, fix the access order.</li>
  <li><strong>Hidden lock order in the database.</strong> Foreign-key checks, triggers and <code>UPDATE … WHERE status = 'x'</code> over many rows also take row locks, in an order you didn't write. Bulk updates from two workers over overlapping row sets deadlock this way; sort the IDs and lock them up front.</li>
</ul>

<div class="callout warn"><strong>A production deadlock is a hang, not an error.</strong> Go only reports one when every goroutine is blocked, which a server with live tickers and other goroutines will rarely, if ever, hit. Plan for detection: timeouts on every wait, a goroutine-count metric, and a way to get a goroutine dump from a running process.</div>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>A deadlock is a cycle in the wait-for graph. It needs mutual exclusion, hold-and-wait, no preemption and circular wait, all at once.</li>
  <li>The standard fix is one global lock order (lower ID first), in Go and in SQL. Don't hold locks across I/O or channel operations.</li>
  <li>Go's runtime only catches whole-program deadlocks; find partial ones with timeouts, goroutine counts and goroutine dumps (<code>SIGQUIT</code>, <code>/debug/pprof/goroutine?debug=2</code>).</li>
  <li>Postgres detects cycles after <code>deadlock_timeout</code> (1s) and aborts one transaction with 40P01: retry the whole transaction, then fix the order.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#pessimistic-locking">Pessimistic Locking</a> · <a href="#race-conditions">Race Conditions</a> · <a href="#thread-safety">Thread Safety</a> · <a href="#timeouts">Timeouts</a> · <a href="#retries">Retries</a> · <a href="#real-world-concurrent-service">Real-World Concurrent Service</a></p>
`;
CONTENT["thread-safety"] = `
<p class="tldr"><strong>TL;DR</strong>: A type is <em>safe for concurrent use</em> when any number of goroutines can call its methods at the same time, with no locking on their side, and it still behaves as documented. A shared notebook that anyone scribbles in is not; a bank teller who serves one customer at a time is. You get there in a few ways: give the data one owner, never mutate it, guard it with a lock, or use atomics. In Go, a type is not safe unless its documentation says it is.</p>

<h2>The problem it solves</h2>
<p>Every Go server shares state between goroutines: a cache, a config, a metrics counter, a connection pool, a rate limiter. Each request runs in its own goroutine, so those objects are used concurrently all the time. If a type isn't built for that, you get the bugs from <a href="#race-conditions">Race Conditions</a>: lost updates, torn reads, and for maps a crashed process.</p>
<p>Thread safety is a <strong>property you design into a type and then promise in its docs</strong>, so callers don't need to know how it works. The Go standard library writes that promise down in one phrase: "safe for concurrent use by multiple goroutines". If the docs don't say it, assume it isn't.</p>
<table>
  <tr><th>Type</th><th>Safe for concurrent use?</th><th>What the docs say</th></tr>
  <tr><td>built-in <code>map</code></td><td><strong>No</strong></td><td>Concurrent writes (or a write during a read) are a data race. The runtime often detects it and stops the process with <code>fatal error: concurrent map writes</code>.</td></tr>
  <tr><td><code>sync.Map</code></td><td>Yes</td><td>"safe for concurrent use by multiple goroutines without additional locking or coordination". Specialised, see below.</td></tr>
  <tr><td><code>*sql.DB</code></td><td>Yes</td><td>"It's safe for concurrent use by multiple goroutines." It's a pool; create one and share it.</td></tr>
  <tr><td><code>*http.Client</code>, <code>*http.Transport</code></td><td>Yes</td><td>"Clients are safe for concurrent use by multiple goroutines", and should be reused because the Transport caches connections.</td></tr>
  <tr><td><code>*regexp.Regexp</code></td><td>Yes, mostly</td><td>Safe "except for configuration methods, such as <code>Regexp.Longest</code>".</td></tr>
  <tr><td><code>math/rand</code></td><td>Top-level funcs: yes. <code>rand.New(src)</code>: no</td><td>"Top-level functions, such as Float64 and Int, are safe for concurrent use"; a source from <code>NewSource</code> "is not safe for concurrent use".</td></tr>
  <tr><td><code>bytes.Buffer</code>, <code>strings.Builder</code></td><td><strong>No</strong></td><td>No such statement in the docs, so treat them as unsafe. Writing logs from several goroutines into one <code>bytes.Buffer</code> in a test is a classic race.</td></tr>
</table>

<h2>How it works</h2>
<p>There are four basic ways to make shared state safe. Most real types use one, and some combine two.</p>
<figure class="diagram">
<svg viewBox="0 0 780 330" role="img" aria-label="Four strategies. Confinement: goroutines G1 and G2 send ops to an owner goroutine, which is the only one touching the map. Mutex-guarded: G1 holds sync.RWMutex while G2 waits; every access to the map holds the lock. Immutable snapshot: G1 and G2 Load an atomic.Pointer without a lock and read a frozen map; writers copy the map and store a new pointer. Atomics: G1 and G2 call Add, Load or CompareAndSwap on an atomic.Int64, which only covers a single value.">
  <defs><marker id="arr-tsafe-1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>

  <rect class="box muted" x="10" y="10" width="180" height="310" rx="10"/>
  <text x="100" y="34" text-anchor="middle" class="title">Confinement</text>
  <rect class="box accent" x="25" y="50" width="65" height="28" rx="5"/><text x="57" y="69" text-anchor="middle">G1</text>
  <rect class="box accent" x="110" y="50" width="65" height="28" rx="5"/><text x="142" y="69" text-anchor="middle">G2</text>
  <path class="line" d="M57 78 L80 123" marker-end="url(#arr-tsafe-1)"/>
  <path class="line" d="M142 78 L120 123" marker-end="url(#arr-tsafe-1)"/>
  <rect class="box" x="30" y="125" width="140" height="44" rx="6"/><text x="100" y="145" text-anchor="middle">owner goroutine</text><text x="100" y="161" text-anchor="middle" class="small">receives ops on a chan</text>
  <path class="line" d="M100 169 V213" marker-end="url(#arr-tsafe-1)"/>
  <rect class="box ok" x="40" y="215" width="120" height="40" rx="6"/><text x="100" y="240" text-anchor="middle">map</text>
  <text x="100" y="282" text-anchor="middle" class="small">only one goroutine</text>
  <text x="100" y="298" text-anchor="middle" class="small">ever touches the data</text>

  <rect class="box muted" x="205" y="10" width="180" height="310" rx="10"/>
  <text x="295" y="34" text-anchor="middle" class="title">Mutex-guarded</text>
  <rect class="box accent" x="220" y="50" width="65" height="28" rx="5"/><text x="252" y="69" text-anchor="middle">G1</text>
  <rect class="box bad" x="305" y="50" width="65" height="28" rx="5"/><text x="337" y="69" text-anchor="middle">G2</text>
  <path class="line" d="M252 78 L275 123" marker-end="url(#arr-tsafe-1)"/>
  <path class="line bad dashed" d="M337 78 L315 123" marker-end="url(#arr-tsafe-1)"/>
  <text x="352" y="104" text-anchor="middle" class="small">waits</text>
  <rect class="box" x="225" y="125" width="140" height="44" rx="6"/><text x="295" y="145" text-anchor="middle">sync.RWMutex</text><text x="295" y="161" text-anchor="middle" class="small">1 writer or N readers</text>
  <path class="line" d="M295 169 V213" marker-end="url(#arr-tsafe-1)"/>
  <rect class="box ok" x="235" y="215" width="120" height="40" rx="6"/><text x="295" y="240" text-anchor="middle">map</text>
  <text x="295" y="282" text-anchor="middle" class="small">every access, read or</text>
  <text x="295" y="298" text-anchor="middle" class="small">write, holds the lock</text>

  <rect class="box muted" x="400" y="10" width="180" height="310" rx="10"/>
  <text x="490" y="34" text-anchor="middle" class="title">Immutable snapshot</text>
  <rect class="box accent" x="415" y="50" width="65" height="28" rx="5"/><text x="447" y="69" text-anchor="middle">G1</text>
  <rect class="box accent" x="500" y="50" width="65" height="28" rx="5"/><text x="532" y="69" text-anchor="middle">G2</text>
  <path class="line" d="M447 78 L470 123" marker-end="url(#arr-tsafe-1)"/>
  <path class="line" d="M532 78 L510 123" marker-end="url(#arr-tsafe-1)"/>
  <rect class="box" x="420" y="125" width="140" height="44" rx="6"/><text x="490" y="145" text-anchor="middle">atomic.Pointer</text><text x="490" y="161" text-anchor="middle" class="small">Load: no lock</text>
  <path class="line" d="M490 169 V213" marker-end="url(#arr-tsafe-1)"/>
  <rect class="box ok" x="430" y="215" width="120" height="40" rx="6"/><text x="490" y="233" text-anchor="middle">map v2</text><text x="490" y="248" text-anchor="middle" class="small">frozen</text>
  <text x="490" y="282" text-anchor="middle" class="small">writers copy the map,</text>
  <text x="490" y="298" text-anchor="middle" class="small">then Store a new pointer</text>

  <rect class="box muted" x="595" y="10" width="175" height="310" rx="10"/>
  <text x="682" y="34" text-anchor="middle" class="title">Atomics</text>
  <rect class="box accent" x="608" y="50" width="65" height="28" rx="5"/><text x="640" y="69" text-anchor="middle">G1</text>
  <rect class="box accent" x="692" y="50" width="65" height="28" rx="5"/><text x="724" y="69" text-anchor="middle">G2</text>
  <path class="line" d="M640 78 L662 123" marker-end="url(#arr-tsafe-1)"/>
  <path class="line" d="M724 78 L702 123" marker-end="url(#arr-tsafe-1)"/>
  <rect class="box" x="612" y="125" width="140" height="44" rx="6"/><text x="682" y="145" text-anchor="middle">atomic.Int64</text><text x="682" y="161" text-anchor="middle" class="small">Add · Load · CAS</text>
  <path class="line" d="M682 169 V213" marker-end="url(#arr-tsafe-1)"/>
  <rect class="box ok" x="622" y="215" width="120" height="40" rx="6"/><text x="682" y="240" text-anchor="middle">one value</text>
  <text x="682" y="282" text-anchor="middle" class="small">indivisible ops on a</text>
  <text x="682" y="298" text-anchor="middle" class="small">single word: counters, flags</text>
</svg>
<figcaption>Confinement and immutability avoid sharing mutable data at all. Locks and atomics share it, but make each access an indivisible step.</figcaption>
</figure>
<table>
  <tr><th>Strategy</th><th>How it's safe</th><th>Good for</th><th>Costs and traps</th></tr>
  <tr><td><strong>Confinement</strong> (one owner, actor style)</td><td>Only one goroutine reads or writes the data; others send it messages over a channel</td><td>State with complex rules, pipelines, a worker that owns a connection</td><td>Every call is a channel round trip and a context switch; the owner is a goroutine you must stop (or it leaks)</td></tr>
  <tr><td><strong>Immutability / copy-on-write</strong> (<code>atomic.Pointer</code>)</td><td>Readers get a pointer to data nobody changes; writers build a new copy and swap the pointer</td><td>Read-mostly data replaced as a whole: config, routing tables, feature flags</td><td>Every write copies everything; concurrent writers still need a lock between them</td></tr>
  <tr><td><strong>Mutex-guarded struct</strong> (<code>sync.Mutex</code> / <code>RWMutex</code>)</td><td>Every access to the fields holds the lock</td><td>The default for most shared state, especially with invariants across fields</td><td>Contention on one hot lock; forgetting the lock on one path; copying the struct</td></tr>
  <tr><td><strong>Atomics</strong> (<code>atomic.Int64</code>, <code>atomic.Bool</code>, <code>CompareAndSwap</code>)</td><td>The hardware makes the single read-modify-write indivisible</td><td>Counters, flags, one pointer</td><td>Only one value at a time: two atomics updated "together" are not atomic together</td></tr>
  <tr><td><strong><code>sync.Map</code></strong></td><td>Internally synchronised map</td><td>The two cases its docs name: "the entry for a given key is only ever written once but read many times, as in caches that only grow", or goroutines working on "disjoint sets of keys"</td><td>Untyped (<code>any</code>); the docs say "most code should use a plain Go map instead, with separate locking"</td></tr>
</table>
<p>Channels deserve a note. The <code>sync/atomic</code> docs repeat the Go proverb "Share memory by communicating; don't communicate by sharing memory." Channels shine when data <em>moves</em>: a job passes from a producer to a worker, and ownership moves with it. For a shared structure that many goroutines query, a mutex is usually simpler and faster than wrapping it in an actor. Use whichever makes the code obviously correct.</p>

<h3>Choosing a strategy</h3>
<figure class="diagram">
<svg viewBox="0 0 780 380" role="img" aria-label="Decision flow. Must several goroutines share it? No: confine it to one owner goroutine. Yes: is it just one value such as a counter, flag or pointer? Yes: sync/atomic. No: is it read-mostly and replaced as a whole? Yes: atomic.Pointer to an immutable copy. No: are keys written once, or disjoint per goroutine? Yes: sync.Map. No: a struct with sync.Mutex, the default.">
  <defs><marker id="arr-tsafe-2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <rect class="box" x="40" y="20" width="360" height="46" rx="23"/><text x="220" y="48" text-anchor="middle">Must several goroutines share it?</text>
  <rect class="box" x="40" y="95" width="360" height="46" rx="23"/><text x="220" y="123" text-anchor="middle">Just one value: counter, flag, pointer?</text>
  <rect class="box" x="40" y="170" width="360" height="46" rx="23"/><text x="220" y="198" text-anchor="middle">Read-mostly and replaced as a whole?</text>
  <rect class="box" x="40" y="245" width="360" height="46" rx="23"/><text x="220" y="273" text-anchor="middle">Keys written once, or disjoint per goroutine?</text>
  <rect class="box accent" x="40" y="320" width="360" height="46" rx="8"/><text x="220" y="348" text-anchor="middle" class="title">struct + sync.Mutex (the default)</text>

  <rect class="box ok" x="470" y="20" width="290" height="46" rx="8"/><text x="615" y="48" text-anchor="middle">Confine it: one goroutine owns it</text>
  <rect class="box ok" x="470" y="95" width="290" height="46" rx="8"/><text x="615" y="123" text-anchor="middle">sync/atomic (atomic.Int64, …)</text>
  <rect class="box ok" x="470" y="170" width="290" height="46" rx="8"/><text x="615" y="198" text-anchor="middle">atomic.Pointer to an immutable copy</text>
  <rect class="box ok" x="470" y="245" width="290" height="46" rx="8"/><text x="615" y="273" text-anchor="middle">sync.Map</text>

  <path class="line" d="M400 43 H468" marker-end="url(#arr-tsafe-2)"/><text x="434" y="36" text-anchor="middle" class="small">no</text>
  <path class="line" d="M400 118 H468" marker-end="url(#arr-tsafe-2)"/><text x="434" y="111" text-anchor="middle" class="small">yes</text>
  <path class="line" d="M400 193 H468" marker-end="url(#arr-tsafe-2)"/><text x="434" y="186" text-anchor="middle" class="small">yes</text>
  <path class="line" d="M400 268 H468" marker-end="url(#arr-tsafe-2)"/><text x="434" y="261" text-anchor="middle" class="small">yes</text>

  <path class="line" d="M220 66 V93" marker-end="url(#arr-tsafe-2)"/><text x="230" y="84" class="small">yes</text>
  <path class="line" d="M220 141 V168" marker-end="url(#arr-tsafe-2)"/><text x="230" y="159" class="small">no</text>
  <path class="line" d="M220 216 V243" marker-end="url(#arr-tsafe-2)"/><text x="230" y="234" class="small">no</text>
  <path class="line" d="M220 291 V318" marker-end="url(#arr-tsafe-2)"/><text x="230" y="309" class="small">no</text>
</svg>
<figcaption>Start at the top. Most shared state ends at the bottom box, and that's fine: a mutex is simple, fast enough, and easy to review.</figcaption>
</figure>

<h2>Example</h2>
<p><strong>A string cache made safe three ways.</strong> Same <code>Get</code>/<code>Set</code> API, three of the strategies above.</p>
<pre><code>package tsafe

import (
	"context"
	"sync"
	"sync/atomic"
)

// 1. Lock-guarded: every access to m holds mu. Readers share an RLock.
type MutexCache struct {
	mu sync.RWMutex
	m  map[string]string
}

func NewMutexCache() *MutexCache { return &amp;MutexCache{m: map[string]string{}} }

func (c *MutexCache) Get(k string) (string, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	v, ok := c.m[k]
	return v, ok
}

func (c *MutexCache) Set(k, v string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.m[k] = v
}

// 2. Confinement (actor): only the owner goroutine ever touches m.
// Callers send it closures to run.
type ActorCache struct{ ops chan func(map[string]string) }

func NewActorCache(ctx context.Context) *ActorCache {
	c := &amp;ActorCache{ops: make(chan func(map[string]string))}
	go func() {
		m := map[string]string{}
		for {
			select {
			case op := &lt;-c.ops:
				op(m)
			case &lt;-ctx.Done():
				return
			}
		}
	}()
	return c
}

func (c *ActorCache) Get(k string) (v string, ok bool) {
	done := make(chan struct{})
	c.ops &lt;- func(m map[string]string) { v, ok = m[k]; close(done) }
	&lt;-done
	return v, ok
}

func (c *ActorCache) Set(k, v string) {
	c.ops &lt;- func(m map[string]string) { m[k] = v }
}

// 3. Immutable snapshot: readers load a pointer to a map nobody mutates.
// Writers copy the map, change the copy, and swap the pointer.
type SnapshotCache struct {
	mu   sync.Mutex // serialises writers only
	snap atomic.Pointer[map[string]string]
}

func NewSnapshotCache() *SnapshotCache {
	c := &amp;SnapshotCache{}
	c.snap.Store(&amp;map[string]string{})
	return c
}

func (c *SnapshotCache) Get(k string) (string, bool) {
	v, ok := (*c.snap.Load())[k] // no lock: the map behind the pointer never changes
	return v, ok
}

// Each write copies the whole map: fine for read-mostly config or routing
// tables, wrong for write-heavy or large maps (use MutexCache there).
func (c *SnapshotCache) Set(k, v string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	old := *c.snap.Load()
	next := make(map[string]string, len(old)+1)
	for key, val := range old {
		next[key] = val
	}
	next[k] = v
	c.snap.Store(&amp;next)
}</code></pre>
<p>A test drives all of them, plus <code>sync.Map</code> and a plain <code>sync.Mutex</code> version, from eight goroutines at once. It is an <code>Example</code>, so <code>go test</code> checks the output, and <code>go test -race</code> on the package reports nothing:</p>
<pre><code>// Eight goroutines write 100 keys each, then read them back.
func Example_caches() {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	for _, im := range impls(ctx) {
		var found atomic.Int64
		var wg sync.WaitGroup
		for g := range 8 {
			wg.Go(func() {
				for i := range 100 {
					k := fmt.Sprintf("g%d-k%d", g, i)
					im.c.Set(k, k)
					if v, ok := im.c.Get(k); ok &amp;&amp; v == k {
						found.Add(1)
					}
				}
			})
		}
		wg.Wait()
		fmt.Printf("%-8s found %d of 800&#92;n", im.name, found.Load())
	}
	// Output:
	// rwmutex  found 800 of 800
	// mutex    found 800 of 800
	// actor    found 800 of 800
	// snapshot found 800 of 800
	// sync.Map found 800 of 800
}</code></pre>
<p>All five are correct. They are not equally fast. A parallel benchmark over 1,000 keys from 12 goroutines, either reads only or one write in ten (laptop numbers, one run, Apple M4 Pro):</p>
<pre><code>$ go test -run '^$' -bench . .
cpu: Apple M4 Pro
BenchmarkReadOnly/rwmutex-12         	10256230	       120.8 ns/op
BenchmarkReadOnly/mutex-12           	 9605804	       123.1 ns/op
BenchmarkReadOnly/actor-12           	 1910014	       719.0 ns/op
BenchmarkReadOnly/snapshot-12        	235540761	         5.982 ns/op
BenchmarkReadOnly/sync.Map-12        	172478689	         5.855 ns/op
BenchmarkWrite1in10/rwmutex-12       	19925913	        60.01 ns/op
BenchmarkWrite1in10/mutex-12         	10332790	       132.9 ns/op
BenchmarkWrite1in10/actor-12         	 1942447	       633.9 ns/op
BenchmarkWrite1in10/snapshot-12      	  436070	      2683 ns/op
BenchmarkWrite1in10/sync.Map-12      	82104850	        16.29 ns/op</code></pre>
<ul>
  <li><strong>Snapshot reads are nearly free</strong> (an atomic load and a map lookup), but each write copies all 1,000 entries, so at 10% writes it is the slowest by far. It's for data that changes rarely.</li>
  <li><strong><code>sync.Map</code> wins here</strong> because this workload is exactly its documented case: a fixed set of keys, read again and again. With a constantly changing key set, the picture changes. Measure your own workload before switching.</li>
  <li><strong><code>RWMutex</code> barely beat <code>Mutex</code> on pure reads</strong> (121 vs 123 ns). With a critical section this short, every <code>RLock</code> still updates one shared reader count, and the goroutines queue on that cache line. Read locks pay off when the work under the lock is long.</li>
  <li><strong>The actor was slowest</strong>: each call is a channel round trip to another goroutine. Confinement buys clarity, not speed.</li>
</ul>

<p><strong>Safe parts, unsafe whole.</strong> Every <code>sync.Map</code> method is safe. That doesn't make a <em>sequence</em> of calls safe:</p>
<pre><code>// HitBroken uses only safe operations, but Load and Store are two steps:
// another goroutine can store between them, and its hit is lost.
func HitBroken(m *sync.Map, page string) {
	v, _ := m.LoadOrStore(page, 0)
	m.Store(page, v.(int)+1)
}

// Hit stores a pointer to an atomic counter once, then increments it.
func Hit(m *sync.Map, page string) {
	v, _ := m.LoadOrStore(page, new(atomic.Int64))
	v.(*atomic.Int64).Add(1)
}</code></pre>
<p>Eight goroutines each record 1,000 hits on one page, three runs. This output is from <code>-race</code>, and it reports nothing: there is no data race, only a lost-update race condition.</p>
<pre><code>$ DEMO=1 go test -race -run TestHitBroken -v .
    cache_test.go:106: HitBroken: 1282 hits recorded, want 8000
    cache_test.go:106: HitBroken: 1559 hits recorded, want 8000
    cache_test.go:106: HitBroken: 1173 hits recorded, want 8000
ok  	example.com/tsafe	1.177s</code></pre>
<p>Over 80% of the hits vanished. <code>Hit</code> stores the counter once with <code>LoadOrStore</code> and then increments it atomically; <code>ExampleHit</code> pins its result at exactly <code>hits: 8000</code>.</p>

<p><strong>An unguarded map.</strong> Two goroutines write to one plain map:</p>
<pre><code>func main() {
	m := map[int]int{}
	var wg sync.WaitGroup
	for g := range 2 {
		wg.Go(func() {
			for i := range 1_000_000 {
				m[i] = g // two goroutines write the same map
			}
		})
	}
	wg.Wait()
}</code></pre>
<pre><code>$ go run ./mapcrash
fatal error: concurrent map writes

goroutine 18 [running]:
internal/runtime/maps.fatal({0x1045eba20?, 0x0?})
	$GOROOT/src/runtime/panic.go:1195 +0x20
main.main.func1()
…
exit status 2</code></pre>
<p>This is a <code>fatal error</code>, not a panic: <code>recover</code> can't catch it, and the whole process exits. The runtime checks for it on a best-effort basis. In one of about a dozen runs on the same laptop it died differently, with <code>fatal error: fault</code> and <code>SIGSEGV</code>: the memory corruption the Go memory model warns about.</p>

<p><strong>Real-world scenario.</strong> Picture a pricing service that keeps exchange rates in a <code>map[string]float64</code>. A background goroutine refreshes it every 30 s; 400 requests per second read it. In production a pod occasionally dies with <code>concurrent map writes</code>, and with 3 replicas it gets filed as "flaky". The fix is a few lines with an <code>atomic.Pointer[map[string]float64]</code>: the refresher builds a new map and calls <code>rates.Store(&amp;next)</code>, and readers call <code>rates.Load()</code>. Reads take no lock, and refreshes are atomic: no request ever sees half-updated rates.</p>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>Copying a mutex.</strong> "A Mutex must not be copied after first use" (the same rule applies to <code>RWMutex</code>, <code>WaitGroup</code>, <code>sync.Map</code>, <code>atomic.Pointer</code>). A value receiver or passing the struct by value copies the lock, and each copy guards nothing. <code>go vet</code>'s copylocks check catches it:
<pre><code>type Stats struct {
	mu   sync.Mutex
	hits int
}

// Value receiver: every call locks a fresh copy of mu and bumps a copy of hits.
func (s Stats) Hit() {
	s.mu.Lock()
	s.hits++
	s.mu.Unlock()
}

func Snapshot(s Stats) int { return s.hits } // copies the lock too</code></pre>
<pre><code>$ go vet ./copylock
copylock/stats.go:11:9: Hit passes lock by value: example.com/tsafe/copylock.Stats contains sync.Mutex
copylock/stats.go:17:17: Snapshot passes lock by value: example.com/tsafe/copylock.Stats contains sync.Mutex</code></pre>
  Use pointer receivers for any type that contains a lock, and run <code>go vet</code> in CI.</li>
  <li><strong>Leaking internals.</strong> A method that returns the internal map or slice hands out an unguarded reference. The lock protected the field, not the data it points to:
<pre><code>// AllLeaky leaks the internal map: callers can now read and write it
// with no lock held.
func (c *MutexCache) AllLeaky() map[string]string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.m
}

// All returns a copy the caller owns.
func (c *MutexCache) All() map[string]string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return maps.Clone(c.m)
}</code></pre></li>
  <li><strong>Check-then-act on a safe type.</strong> <code>if _, ok := c.Get(k); !ok { c.Set(k, v) }</code> is two locked calls with a gap between them. Add compound methods (<code>GetOrSet</code>, <code>LoadOrStore</code>, <code>CompareAndSwap</code>) that hold the lock for the whole operation.</li>
  <li><strong>Holding a lock across slow work.</strong> Calling the network, a database or a user callback while holding a lock stalls everyone else, and can cause <a href="#deadlocks">deadlocks</a>. Copy what you need, unlock, then do the slow part.</li>
  <li><strong>Expecting <code>RWMutex</code> to scale reads.</strong> With a short critical section, readers still contend on the shared reader count (121 vs 123 ns above); it pays off when read-side work is long. It also forbids recursive read locking: per the docs, once a writer calls <code>Lock</code>, new <code>RLock</code> calls block until the writer is done, so a goroutine that re-enters <code>RLock</code> can deadlock.</li>
  <li><strong>Unusable zero values.</strong> A struct with a nil map field panics on the first <code>Set</code>. Either make the zero value work (lazily create the map under the lock) or provide a constructor and say so.</li>
  <li><strong>Forgotten owner goroutines.</strong> An actor or background refresher needs a way to stop (a <code>context</code> or <code>Close</code>), or it leaks. See <a href="#memory-leaks">Memory Leaks</a>.</li>
</ul>

<div class="callout warn"><strong>Document the promise.</strong> If your type is safe for concurrent use, write "safe for concurrent use by multiple goroutines" in its doc comment, as the standard library does. If it isn't, say that too. Callers can't see your locks.</div>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>Unless the docs say "safe for concurrent use", assume a type isn't. Plain maps, slices and <code>bytes.Buffer</code> aren't; <code>*sql.DB</code>, <code>*http.Client</code> and <code>sync.Map</code> are.</li>
  <li>Four strategies: confine the data to one goroutine, make it immutable and swap pointers, guard it with a mutex, or use atomics for single values. A mutex-guarded struct is the right default.</li>
  <li>Safe methods don't make a sequence of calls safe; provide compound operations instead.</li>
  <li>Don't copy locks (<code>go vet</code> catches it), don't return internal maps or slices, and measure before reaching for <code>RWMutex</code> or <code>sync.Map</code>.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#race-conditions">Race Conditions</a> · <a href="#deadlocks">Deadlocks</a> · <a href="#pessimistic-locking">Pessimistic Locking</a> · <a href="#caching">Caching</a> · <a href="#memory-leaks">Memory Leaks</a> · <a href="#real-world-concurrent-service">Real-World Concurrent Service</a></p>
`;

CONTENT["memory-leaks"] = `
<p class="tldr"><strong>TL;DR</strong>: A garbage collector frees memory nobody can reach any more. It can't free memory you can still reach but will never use again, and that is what a memory leak is in Go. Think of a coat check: the attendant only throws a coat away when no ticket for it exists. Keep every ticket "just in case" and the room fills up, however good the attendant is.</p>

<h2>The problem it solves</h2>
<p>In C a leak is a <code>malloc</code> without a <code>free</code>. In Go, Java or Python the GC does the freeing, so a leak is different: some <em>reference</em> keeps data alive. A global map that only grows. A goroutine blocked forever, holding its stack and everything its stack points to. A 16-byte slice that still points into a 10 MiB array. The GC is working correctly in every case. It sees a path from a root to the data, so it must keep it.</p>
<p>A leak rarely crashes anything right away. It shows up as a slow trend:</p>
<ul>
  <li><strong>Memory (RSS) climbs</strong> over hours or days and never comes back down after traffic drops.</li>
  <li><strong>The container gets OOMKilled.</strong> When a container goes over its memory limit, the kernel's OOM killer sends <code>SIGKILL</code>. Kubernetes reports the reason <code>OOMKilled</code> and exit code 137 (128 + 9), and restarts the pod. A pod that restarts every few days on a schedule is a classic leak signature.</li>
  <li><strong>GC CPU goes up.</strong> Each GC cycle has to mark the whole live heap, and leaked data is live. A bigger live heap means more marking work per cycle and higher latency during the mark phase (see <a href="#garbage-collection">Garbage Collection</a>).</li>
  <li><strong>Goroutine count climbs.</strong> Each leaked goroutine holds at least a few KiB of stack, plus whatever it references: request bodies, buffers, DB connections.</li>
</ul>

<h2>How it works</h2>
<p>A tracing GC starts from the <strong>roots</strong>: global variables and every goroutine's stack. It follows pointers and marks everything it reaches. Anything not marked is freed. So for each object there are three cases, and only one of them is a leak:</p>
<figure class="diagram">
<svg viewBox="0 0 780 300" role="img" aria-label="Reachability. Roots are globals and goroutine stacks. From globals, a config object is reachable and used. A global cache map is reachable; its fresh entries are used, but entries for old URLs are reachable and never read again: a leak. From goroutine stacks, a running handler uses its request. A blocked worker goroutine stuck on a channel send keeps its 64 KiB buffer reachable: a leak. An object no root points to is unreachable and the GC frees it.">
  <defs><marker id="arr-mleak-1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <text x="90" y="26" text-anchor="middle" class="title">GC roots</text>
  <text x="340" y="26" text-anchor="middle" class="title">Reachable</text>
  <text x="660" y="26" text-anchor="middle" class="title">Unreachable</text>

  <rect class="box accent" x="20" y="50" width="140" height="90" rx="8"/>
  <text x="90" y="88" text-anchor="middle" class="title">globals</text>
  <text x="90" y="106" text-anchor="middle" class="small">package-level vars</text>
  <rect class="box accent" x="20" y="170" width="140" height="90" rx="8"/>
  <text x="90" y="208" text-anchor="middle" class="title">goroutine stacks</text>
  <text x="90" y="226" text-anchor="middle" class="small">locals of every goroutine</text>

  <rect class="box ok" x="230" y="44" width="130" height="34" rx="6"/><text x="295" y="66" text-anchor="middle">config</text>
  <rect class="box" x="230" y="96" width="130" height="44" rx="6"/><text x="295" y="115" text-anchor="middle">cache map</text><text x="295" y="131" text-anchor="middle" class="small">var Cache = map[…]</text>
  <rect class="box ok" x="420" y="78" width="160" height="30" rx="6"/><text x="500" y="98" text-anchor="middle">entry: hot URL</text>
  <rect class="box bad" x="420" y="118" width="160" height="40" rx="6"/><text x="500" y="135" text-anchor="middle">entries: old URLs</text><text x="500" y="150" text-anchor="middle" class="small">never read again</text>

  <rect class="box ok" x="230" y="166" width="130" height="34" rx="6"/><text x="295" y="188" text-anchor="middle">running handler</text>
  <rect class="box bad" x="230" y="214" width="130" height="44" rx="6"/><text x="295" y="233" text-anchor="middle">blocked worker</text><text x="295" y="249" text-anchor="middle" class="small">stuck on ch &lt;- v</text>
  <rect class="box bad" x="420" y="218" width="160" height="36" rx="6"/><text x="500" y="241" text-anchor="middle">its 64 KiB buffer</text>

  <path class="line" d="M160 80 H228" marker-end="url(#arr-mleak-1)"/>
  <path class="line" d="M160 112 H228" marker-end="url(#arr-mleak-1)"/>
  <path class="line" d="M360 110 L418 95" marker-end="url(#arr-mleak-1)"/>
  <path class="line bad" d="M360 126 L418 136" marker-end="url(#arr-mleak-1)"/>
  <path class="line" d="M160 196 L228 184" marker-end="url(#arr-mleak-1)"/>
  <path class="line bad" d="M160 226 L228 234" marker-end="url(#arr-mleak-1)"/>
  <path class="line bad" d="M360 236 H418" marker-end="url(#arr-mleak-1)"/>

  <rect class="box muted" x="600" y="120" width="120" height="60" rx="6"/>
  <text x="660" y="146" text-anchor="middle">old request</text>
  <text x="660" y="164" text-anchor="middle" class="small">no path from a root</text>
  <text x="660" y="204" text-anchor="middle" class="small">GC frees it</text>
  <text x="390" y="288" text-anchor="middle" class="small">green: reachable and used · red: reachable but never used again (the leak) · grey: garbage</text>
</svg>
<figcaption>The GC only knows the arrows, not your intent. The red boxes are "live" as far as it can tell, so it keeps them forever. Fixing a leak means removing an arrow: evict the entry, or let the goroutine exit.</figcaption>
</figure>

<h3>The goroutine leak, step by step</h3>
<p>The most common Go leak is a goroutine that can never finish. A goroutine is not garbage collected while it is blocked: its stack is a root. Here a handler starts a worker, then gives up when the request deadline passes. The worker finishes later and tries to send on an unbuffered channel that nobody will ever read again.</p>
<figure class="diagram">
<svg viewBox="0 0 780 250" role="img" aria-label="Sequence. The handler starts a worker and waits in a select. At 1 ms the context deadline fires and the handler returns an error. At 20 ms the worker finishes and tries to send on the unbuffered channel. No one receives, so it blocks forever: one leaked goroutine per timed-out request. With a buffer of one, the send succeeds, the worker exits, and the channel becomes garbage.">
  <defs><marker id="arr-mleak-2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <rect class="box accent" x="60" y="14" width="140" height="30" rx="6"/><text x="130" y="34" text-anchor="middle">handler</text>
  <rect class="box" x="320" y="14" width="140" height="30" rx="6"/><text x="390" y="34" text-anchor="middle">ch (unbuffered)</text>
  <rect class="box" x="580" y="14" width="140" height="30" rx="6"/><text x="650" y="34" text-anchor="middle">worker</text>
  <path class="line dashed" d="M130 44 V240" style="stroke: var(--line)"/>
  <path class="line dashed" d="M390 44 V240" style="stroke: var(--line)"/>
  <path class="line dashed" d="M650 44 V240" style="stroke: var(--line)"/>

  <path class="line" d="M130 70 H648" marker-end="url(#arr-mleak-2)"/>
  <text x="520" y="64" text-anchor="middle" class="small">go func() { ch &lt;- slowLookup() }()</text>
  <text x="250" y="96" text-anchor="middle" class="small">select { &lt;-ch · &lt;-ctx.Done() }</text>
  <rect class="box bad" x="40" y="114" width="180" height="40" rx="6"/>
  <text x="130" y="131" text-anchor="middle">t = 1 ms: deadline</text>
  <text x="130" y="147" text-anchor="middle" class="small">returns error, stops reading</text>
  <path class="line bad" d="M650 186 H394" marker-end="url(#arr-mleak-2)"/>
  <text x="520" y="178" text-anchor="middle" class="small">t = 20 ms: ch &lt;- "price=42"</text>
  <rect class="box bad" x="560" y="200" width="200" height="40" rx="6"/>
  <text x="660" y="217" text-anchor="middle">blocked forever</text>
  <text x="660" y="233" text-anchor="middle" class="small">no receiver will ever come</text>
  <text x="260" y="220" text-anchor="middle" class="small">fix: make(chan string, 1)</text>
  <text x="260" y="236" text-anchor="middle" class="small">the send lands in the buffer, worker exits</text>
</svg>
<figcaption>Every request that times out leaves one goroutine behind. At 50 timeouts per second, that's 180,000 goroutines an hour, each pinning its stack and whatever it captured.</figcaption>
</figure>

<h3>The usual suspects</h3>
<table>
  <tr><th>Leak</th><th>What keeps it reachable</th><th>Fix</th></tr>
  <tr><td><strong>Goroutine blocked forever</strong> (send/receive with no partner, <code>select</code> without <code>ctx.Done()</code>, waiting on a lock never released)</td><td>The goroutine's stack is a GC root</td><td>Buffered channel of the right size, <code>select</code> on <code>ctx.Done()</code>, always give a goroutine a way to exit. See <a href="#timeouts">Timeouts</a>.</td></tr>
  <tr><td><strong>Unbounded map or cache</strong></td><td>A global or long-lived struct holds every key ever seen</td><td>Size limit + eviction (LRU), TTL, or a bounded cache library. See <a href="#caching">Caching</a>.</td></tr>
  <tr><td><strong>Ticker loop with no exit</strong></td><td>The goroutine running <code>for range t.C</code> never returns</td><td>Exit on <code>ctx.Done()</code> and <code>defer t.Stop()</code></td></tr>
  <tr><td><strong>Sub-slice / substring pinning</strong></td><td>A small slice still points into the big backing array</td><td><code>bytes.Clone</code>, <code>strings.Clone</code>, or <code>copy</code> into a new slice</td></tr>
  <tr><td><strong>Global slice of pointers</strong> (listeners, subscribers, "recent requests")</td><td>Append without remove; or <code>s = s[1:]</code> as a queue, which leaves popped items in the array</td><td>Unregister functions, set removed elements to <code>nil</code>, use a ring buffer</td></tr>
  <tr><td><strong><code>defer</code> inside a long loop</strong></td><td>Deferred calls (and the files, rows, locks they close) wait until the <em>function</em> returns</td><td>Move the loop body into its own function</td></tr>
  <tr><td><strong>Never-closed resources</strong> (<code>resp.Body</code>, <code>rows</code>, files)</td><td>Buffers, connections and file descriptors stay checked out</td><td><code>defer x.Close()</code> right after the error check. See <a href="#connection-pooling">Connection Pooling</a>.</td></tr>
  <tr><td><strong>cgo and finalizers</strong> (brief)</td><td>C memory is invisible to the GC; a cycle that contains an object with a finalizer is not guaranteed to be collected</td><td>Free C memory explicitly; prefer <code>runtime.AddCleanup</code> (Go 1.24+) over <code>SetFinalizer</code>, and never rely on either for prompt cleanup</td></tr>
</table>
<p><strong>About tickers and timers.</strong> Before Go 1.23, a <code>time.Ticker</code> that was never stopped could never be collected, so <code>defer t.Stop()</code> was mandatory, and <code>time.After</code> in a hot loop piled up timers. The <code>time</code> package docs say that as of Go 1.23 the GC can recover unreferenced tickers and timers even if they were never stopped. That only fixes the timer itself. A goroutine looping <code>for range t.C</code> with no exit still leaks in every version. Give it one:</p>
<pre><code>// Poll: the caller's ctx ends the goroutine (and Stop ends the ticks).
func Poll(ctx context.Context, url string) {
	t := time.NewTicker(time.Second)
	go func() {
		defer t.Stop()
		for {
			select {
			case &lt;-ctx.Done():
				return
			case &lt;-t.C:
				check(url)
			}
		}
	}()
}</code></pre>

<h3>What a leak looks like on a dashboard</h3>
<figure class="diagram">
<svg viewBox="0 0 780 300" role="img" aria-label="Chart of process memory over 12 hours. A healthy service shows a sawtooth that rises between GC cycles and drops back to the same floor. A leaking service shows the same sawtooth, but the floor rises every hour, until memory reaches the container limit around hour 9; the pod is OOMKilled and restarts, and the climb starts again.">
  <defs><marker id="arr-mleak-3" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <path class="line" d="M70 250 H750" marker-end="url(#arr-mleak-3)"/>
  <path class="line" d="M70 250 V30" marker-end="url(#arr-mleak-3)"/>
  <text x="740" y="272" text-anchor="end" class="small">time (hours)</text>
  <text x="62" y="40" text-anchor="end" class="small">memory</text>
  <path class="line bad dashed" d="M70 60 H740"/>
  <text x="80" y="54" class="small">container memory limit</text>
  <path class="line ok" d="M70 205 L97 170 L125 205 L153 170 L181 205 L209 170 L237 205 L265 170 L293 205 L321 170 L349 205 L377 170 L405 205 L432 170 L460 205 L488 170 L516 205 L544 170 L572 205 L600 170 L628 205 L656 170 L684 205 L712 170"/>
  <path class="line bad" d="M70 205 L97 170 L125 188 L153 153 L181 171 L209 136 L237 154 L265 119 L293 137 L321 102 L349 120 L377 85 L405 103 L432 68 L460 86 L488 60 L516 69 L544 60 L572 205 L600 170 L628 188 L656 153 L684 171 L712 136"/>
  <path class="line bad dashed" d="M572 60 V205"/>
  <text x="572" y="222" text-anchor="middle">OOMKilled</text>
  <text x="572" y="238" text-anchor="middle" class="small">exit 137, restart</text>
  <text x="200" y="96" text-anchor="middle" class="small">leak: the floor after each GC keeps rising</text>
  <text x="300" y="232" text-anchor="middle" class="small">healthy: GC brings it back to the same floor</text>
</svg>
<figcaption>Look at the <em>floor</em> (memory right after a GC), not the peaks. A rising floor means the live heap is growing. A restart "fixes" it, which is why leaks hide behind deploys: a team that ships daily may never notice one that takes three days to fill the limit.</figcaption>
</figure>

<h3>Finding it</h3>
<table>
  <tr><th>Tool</th><th>Answers</th><th>Notes</th></tr>
  <tr><td><code>runtime.NumGoroutine()</code> / metric <code>/sched/goroutines:goroutines</code></td><td>Is the goroutine count growing?</td><td>Export it as a gauge (see <a href="#metrics">Metrics</a>). Steady traffic, flat line.</td></tr>
  <tr><td><code>pprof</code> goroutine profile (<code>/debug/pprof/goroutine?debug=1</code>)</td><td>Where are all goroutines parked?</td><td>Groups identical stacks with a count. "4,000 goroutines at <code>leak.go:20</code> in chan send" names the line.</td></tr>
  <tr><td><code>goroutineleak</code> profile</td><td>Which goroutines can <em>never</em> wake up?</td><td>New: an experiment in Go 1.26 (<code>GOEXPERIMENT=goroutineleakprofile</code>); in the Go 1.27 used here it is a built-in profile. It uses the GC to find goroutines blocked on a channel or lock that no runnable goroutine can reach. It can't see leaks through globals.</td></tr>
  <tr><td><code>pprof</code> heap, <code>inuse_space</code> (the default)</td><td>What is live right now, by allocation site?</td><td>Live as of the last GC. Use this for leaks.</td></tr>
  <tr><td><code>pprof</code> heap, <code>-sample_index=alloc_space</code></td><td>What allocated the most, freed or not?</td><td>For GC pressure, not leaks.</td></tr>
  <tr><td><code>go tool pprof -base old new</code></td><td>What grew between two snapshots?</td><td>Take one profile, wait, take another. The diff hides the steady state and shows the growth.</td></tr>
  <tr><td><code>go.uber.org/goleak</code></td><td>Did this test leave goroutines behind?</td><td><code>defer goleak.VerifyNone(t)</code> per test, or <code>goleak.VerifyTestMain(m)</code> for a package. Catches leaks in CI, before production.</td></tr>
</table>
<p>To get these profiles from a running service, import <code>net/http/pprof</code> and serve it on a private port (never on the public listener):</p>
<pre><code>import _ "net/http/pprof" // registers /debug/pprof/* on http.DefaultServeMux
go func() { log.Println(http.ListenAndServe("localhost:6060", nil)) }()

// then, from your laptop (port-forward first):
//   curl -s localhost:6060/debug/pprof/goroutine?debug=1 | head -30
//   curl -s localhost:6060/debug/pprof/goroutineleak?debug=1
//   curl -s -o heap1.pb.gz localhost:6060/debug/pprof/heap   (an hour later: heap2.pb.gz)
//   go tool pprof -top -base heap1.pb.gz heap2.pb.gz</code></pre>

<h2>Example</h2>
<p><strong>A leaking handler, a growing cache and a pinned slice.</strong> <code>HandleLeaky</code> is the sequence diagram above. <code>HandleFixed</code> is identical except for the buffer. <code>HandleCached</code> is a "cache" with no eviction.</p>
<pre><code>package leak

import (
	"bytes"
	"context"
	"time"
)

// slowLookup stands in for a call to another service.
func slowLookup() string {
	time.Sleep(20 * time.Millisecond)
	return "price=42"
}

// HandleLeaky gives up after the request deadline, but the worker it
// started is stuck forever on "ch &lt;- ...": nobody will ever receive.
func HandleLeaky(ctx context.Context) (string, error) {
	ch := make(chan string) // unbuffered
	go func() {
		ch &lt;- slowLookup() // blocks forever once the handler has returned
	}()
	select {
	case v := &lt;-ch:
		return v, nil
	case &lt;-ctx.Done():
		return "", ctx.Err()
	}
}

// HandleFixed: a buffer of 1 lets the worker finish its send and exit
// even if nobody is listening any more.
func HandleFixed(ctx context.Context) (string, error) {
	ch := make(chan string, 1)
	go func() {
		ch &lt;- slowLookup()
	}()
	select {
	case v := &lt;-ch:
		return v, nil
	case &lt;-ctx.Done():
		return "", ctx.Err()
	}
}

// Cache grows forever: one entry per distinct key, never evicted.
var Cache = map[string][]byte{}

func HandleCached(key string) []byte {
	if v, ok := Cache[key]; ok {
		return v
	}
	v := make([]byte, 64&lt;&lt;10) // 64 KiB rendered page
	Cache[key] = v
	return v
}</code></pre>
<p>The tests run 1,000 requests with a 1 ms deadline against a 20 ms lookup, so every request times out. <code>Example</code> tests fail if the printed output differs from the <code>// Output:</code> block, so those lines are real:</p>
<pre><code>func run(n int, h func(context.Context) (string, error)) {
	for range n {
		ctx, cancel := context.WithTimeout(context.Background(), time.Millisecond)
		h(ctx) // times out: the lookup takes 20 ms
		cancel()
	}
	time.Sleep(500 * time.Millisecond) // let every lookup finish
}

func Example_leak() {
	before := runtime.NumGoroutine()
	run(1000, HandleLeaky)
	fmt.Println("leaky: goroutines added:", runtime.NumGoroutine()-before)
	var prof strings.Builder
	pprof.Lookup("goroutineleak").WriteTo(&amp;prof, 1) // runs a leak-detecting GC
	fmt.Println(strings.SplitN(prof.String(), "&#92;n", 2)[0])

	before = runtime.NumGoroutine()
	run(1000, HandleFixed)
	fmt.Println("fixed: goroutines added:", runtime.NumGoroutine()-before)
	// Output:
	// leaky: goroutines added: 1000
	// goroutineleak profile: total 1000
	// fixed: goroutines added: 0
}

// Run with LEAKDEMO=1 to see goleak fail the test.
func TestHandlerNoLeak(t *testing.T) {
	if os.Getenv("LEAKDEMO") == "" {
		t.Skip("set LEAKDEMO=1")
	}
	defer goleak.VerifyNone(t)
	ctx, cancel := context.WithTimeout(context.Background(), time.Millisecond)
	defer cancel()
	if _, err := HandleLeaky(ctx); err != nil {
		t.Log("handler:", err)
	}
}</code></pre>
<p>The goroutine count grows by exactly one per timed-out request, and the <code>goroutineleak</code> profile finds all 1,000 of them. The fixed handler leaves nothing behind. Here is the leak profile's text form (3 requests, so it's short), and <code>goleak</code> failing the test with <code>LEAKDEMO=1</code>; both are real runs, with the absolute path shortened:</p>
<pre><code>goroutineleak profile: total 3
3 @ 0x1023a8428 0x10233b7e4 0x10233b3f8 0x10244fcb8 0x1023aecc4
#	0x10244fcb7	example.com/leak.HandleLeaky.func1+0x47	.../memory-leaks/leak.go:20</code></pre>
<pre><code>--- FAIL: TestHandlerNoLeak (0.44s)
    leak_test.go:51: handler: context deadline exceeded
    leak_test.go:53: found unexpected goroutines:
        [Goroutine 36 in state chan send, with example.com/leak.HandleLeaky.func1 on top of the stack:
        example.com/leak.HandleLeaky.func1()
        	.../memory-leaks/leak.go:20 +0x48
        created by example.com/leak.HandleLeaky in goroutine 35
        	.../memory-leaks/leak.go:19 +0x7c
        ]
FAIL
FAIL	example.com/leak	0.595s
FAIL</code></pre>
<p>Both point to the exact line: <code>leak.go:20</code> is <code>ch &lt;- slowLookup()</code>, and goleak even reports the state, <code>chan send</code>.</p>
<p><strong>The cache.</strong> A test calls <code>HandleCached</code> for 500 URLs, writes a heap profile, calls it for 1,000 more URLs and writes a second one. Real <code>pprof</code> output (heap profiles are sampled, so the MB figures are estimates: 1,500 × 64 KiB is really 93.75 MiB):</p>
<pre><code>$ go tool pprof -top -base heap1.pb.gz heap2.pb.gz
Showing nodes accounting for 65.46MB, 98.49% of 66.46MB total
      flat  flat%   sum%        cum   cum%
   65.96MB 99.25% 99.25%    65.96MB 99.25%  example.com/leak.HandleCached (inline)
   -0.50MB  0.75% 98.49%    -0.50MB  0.75%  fmt.init.func1
         0     0% 98.49%    65.46MB 98.49%  example.com/leak.TestHeapProfile</code></pre>
<p>A plain <code>go tool pprof -top heap2.pb.gz</code> shows what is live (99.47 MB in <code>HandleCached</code>); the <code>-base</code> diff shows what <em>grew</em>: about 64 MB more, all from <code>HandleCached</code>. In production, the diff between two snapshots an hour apart is the fastest way to a leak.</p>
<p><strong>The pinned slice.</strong> Keeping 16 bytes of an upload keeps the whole upload:</p>
<pre><code>// HeaderOf keeps 16 bytes of a 10 MiB upload, but the slice still points
// into the big array, so all 10 MiB stay reachable.
func HeaderOf(upload []byte) []byte { return upload[:16] }

// HeaderCopy copies the 16 bytes; the big array can be collected.
func HeaderCopy(upload []byte) []byte { return bytes.Clone(upload[:16]) }</code></pre>
<pre><code>func Example_pin() {
	base := liveMiB()
	for range 5 { // five uploads, keep only their headers
		kept = append(kept, HeaderOf(make([]byte, 10&lt;&lt;20)))
	}
	fmt.Println("sub-slice: live heap grew by", liveMiB()-base, "MiB")

	kept = nil
	base = liveMiB()
	for range 5 {
		kept = append(kept, HeaderCopy(make([]byte, 10&lt;&lt;20)))
	}
	fmt.Println("copy:      live heap grew by", liveMiB()-base, "MiB")
	// Output:
	// sub-slice: live heap grew by 50 MiB
	// copy:      live heap grew by 0 MiB
}</code></pre>
<p>Five 16-byte headers held 50 MiB, because each slice header still points into its 10 MiB array. Substrings of a big string behave the same way.</p>
<p><strong>Real-world scenario.</strong> A pricing API runs pods with a 512 MiB memory limit. A downstream service gets slow for an afternoon, and 5% of 1,000 requests/s hit the 200 ms deadline: 50 leaked goroutines per second. Say each holds its stack plus a 32 KiB response buffer, about 40 KiB in all. That is 2 MiB per second, 7 GiB an hour if it kept going. Pods get OOMKilled about every 4 minutes. The goroutine panel climbs in a straight line instead of tracking traffic. One buffered channel fixes it, and a <code>goleak.VerifyNone</code> in the handler's timeout test stops it from coming back.</p>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>Reading RSS as "live heap".</strong> After a spike, the Go runtime returns freed memory to the OS gradually, so RSS lags. A high but flat RSS is not a leak. Compare <code>inuse_space</code> or the post-GC heap (the third number in a <code>gctrace</code> line) over time.</li>
  <li><strong>Raising the memory limit.</strong> Doubling the container limit doubles the time between OOMKills. It doesn't fix the leak, and it hides it for longer.</li>
  <li><strong>Starting goroutines with no exit path.</strong> Before writing <code>go func()</code>, answer "how does this goroutine end?" If the answer depends on someone else reading a channel, make sure they always will, or buffer it.</li>
  <li><strong>"It's a cache" with no bound.</strong> Any map keyed by user input (URL, user ID, query text) grows with the number of distinct inputs, not with traffic. Bound it by count or bytes, and add a TTL.</li>
  <li><strong>Profiling only in staging.</strong> Leaks need real traffic and real time. Keep <code>pprof</code> on a private port in production and take two heap profiles an hour apart.</li>
</ul>

<div class="callout warn"><strong>A blocked goroutine is never collected.</strong> Its stack is a GC root, so it keeps everything it references alive: request bodies, buffers, even database connections. Only the goroutine itself returning frees it.</div>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>In a GC'd language a leak is memory that is still reachable but never used again. The GC is working correctly; the bug is a reference you forgot.</li>
  <li>The big Go leaks are goroutines that can never exit and caches with no bound. Give every goroutine an exit path (<code>ctx.Done()</code>, buffered channels) and every cache a size limit.</li>
  <li>Watch the goroutine count and the heap floor after GC. Diagnose with the goroutine and goroutineleak profiles and <code>pprof -base</code> on two heap snapshots.</li>
  <li>Stop leaks in CI with <code>goleak.VerifyNone</code> on tests that cover timeouts and cancellation.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#garbage-collection">Garbage Collection</a> · <a href="#timeouts">Timeouts</a> · <a href="#caching">Caching</a> · <a href="#kubernetes">Kubernetes</a> · <a href="#metrics">Metrics</a> · <a href="#real-world-concurrent-service">Real-World Concurrent Service</a></p>
`;
CONTENT["garbage-collection"] = `
<p class="tldr"><strong>TL;DR</strong>: A garbage collector (GC) finds memory your program can no longer reach and reuses it, so you never call <code>free</code>. Go's GC is like a cleaner who walks the office <em>while people keep working</em>, tagging every desk someone still uses, then clears the rest. You pay in CPU and extra memory instead of in crashes, and you control the bill mainly by <strong>allocating less</strong>.</p>

<h2>The problem it solves</h2>
<p>Every program allocates memory for values whose lifetime the compiler can't predict: a request body, a cache entry, a node in a tree. Someone has to give that memory back. There are three ways to do it:</p>
<ul>
  <li><strong>Manual</strong> (C <code>malloc</code>/<code>free</code>). Fast and predictable, but free too early and you get use-after-free; free twice and you corrupt the heap; forget and you leak.</li>
  <li><strong>Reference counting</strong> (CPython, Swift, Rust's <code>Rc</code>/<code>Arc</code>). Each object counts who points to it and is freed when the count hits zero. Memory comes back immediately, but every pointer copy updates a counter, and a cycle (A points to B, B points to A) never reaches zero on its own.</li>
  <li><strong>Tracing GC</strong> (Go, Java, .NET, JavaScript). Every so often, start from the <em>roots</em> (globals, goroutine stacks, registers), follow every pointer, and mark what you reach. Whatever isn't marked is garbage. Cycles are not a problem: an unreachable cycle is just unreachable.</li>
</ul>
<p>Tracing GC costs CPU (the marking work), memory (garbage waits around until the next cycle) and sometimes latency (pauses). Go chose short pauses and simple tuning.</p>

<h2>How it works</h2>
<p>Go uses a <strong>concurrent tri-color mark-and-sweep</strong> collector. In the runtime's own words (<code>runtime/mgc.go</code>): concurrent with the program, type-precise, parallel, using a write barrier, and <strong>non-generational and non-compacting</strong>. Objects never move, so a pointer stays valid for an object's whole life.</p>
<p>Marking uses three colors. <strong>White</strong>: not reached yet. <strong>Grey</strong>: reached, but its pointers haven't been scanned. <strong>Black</strong>: reached and fully scanned. Marking is just "take a grey object, shade its children grey, turn it black" until no grey is left.</p>
<figure class="diagram">
<svg viewBox="0 0 780 290" role="img" aria-label="Tri-color marking in three snapshots. Objects A to E start white. 1: roots point to A, which turns grey. 2: A is scanned and turns black; its children B and C turn grey. 3: B and C are scanned and turn black. D and E, which only point to each other, are never reached, stay white and are freed by the sweep.">
  <defs><marker id="arr-gcol-1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <text x="130" y="30" text-anchor="middle" class="title">1. Start</text>
  <rect class="box muted" x="20" y="56" width="56" height="30" rx="6"/><text x="48" y="76" text-anchor="middle">roots</text>
  <rect class="box accent" x="100" y="56" width="44" height="30" rx="6"/><text x="122" y="76" text-anchor="middle">A</text>
  <rect class="box" x="180" y="56" width="44" height="30" rx="6"/><text x="202" y="76" text-anchor="middle">B</text>
  <rect class="box" x="100" y="126" width="44" height="30" rx="6"/><text x="122" y="146" text-anchor="middle">C</text>
  <rect class="box" x="100" y="196" width="44" height="30" rx="6"/><text x="122" y="216" text-anchor="middle">D</text>
  <rect class="box" x="180" y="196" width="44" height="30" rx="6"/><text x="202" y="216" text-anchor="middle">E</text>
  <path class="line" d="M76 71 H98" marker-end="url(#arr-gcol-1)"/>
  <path class="line" d="M144 71 H178" marker-end="url(#arr-gcol-1)"/>
  <path class="line" d="M122 86 V124" marker-end="url(#arr-gcol-1)"/>
  <path class="line" d="M144 211 H178" marker-end="url(#arr-gcol-1)"/>
  <text x="130" y="252" text-anchor="middle" class="small">roots shade what they</text>
  <text x="130" y="267" text-anchor="middle" class="small">point to grey</text>
  <text x="390" y="30" text-anchor="middle" class="title">2. Marking</text>
  <rect class="box muted" x="280" y="56" width="56" height="30" rx="6"/><text x="308" y="76" text-anchor="middle">roots</text>
  <rect class="box ok" x="360" y="56" width="44" height="30" rx="6"/><text x="382" y="76" text-anchor="middle">A</text>
  <rect class="box accent" x="440" y="56" width="44" height="30" rx="6"/><text x="462" y="76" text-anchor="middle">B</text>
  <rect class="box accent" x="360" y="126" width="44" height="30" rx="6"/><text x="382" y="146" text-anchor="middle">C</text>
  <rect class="box" x="360" y="196" width="44" height="30" rx="6"/><text x="382" y="216" text-anchor="middle">D</text>
  <rect class="box" x="440" y="196" width="44" height="30" rx="6"/><text x="462" y="216" text-anchor="middle">E</text>
  <path class="line" d="M336 71 H358" marker-end="url(#arr-gcol-1)"/>
  <path class="line" d="M404 71 H438" marker-end="url(#arr-gcol-1)"/>
  <path class="line" d="M382 86 V124" marker-end="url(#arr-gcol-1)"/>
  <path class="line" d="M404 211 H438" marker-end="url(#arr-gcol-1)"/>
  <text x="390" y="252" text-anchor="middle" class="small">scan a grey object: its</text>
  <text x="390" y="267" text-anchor="middle" class="small">children go grey, it goes black</text>
  <text x="650" y="30" text-anchor="middle" class="title">3. Mark done</text>
  <rect class="box muted" x="540" y="56" width="56" height="30" rx="6"/><text x="568" y="76" text-anchor="middle">roots</text>
  <rect class="box ok" x="620" y="56" width="44" height="30" rx="6"/><text x="642" y="76" text-anchor="middle">A</text>
  <rect class="box ok" x="700" y="56" width="44" height="30" rx="6"/><text x="722" y="76" text-anchor="middle">B</text>
  <rect class="box ok" x="620" y="126" width="44" height="30" rx="6"/><text x="642" y="146" text-anchor="middle">C</text>
  <rect class="box bad" x="620" y="196" width="44" height="30" rx="6"/><text x="642" y="216" text-anchor="middle">D</text>
  <rect class="box bad" x="700" y="196" width="44" height="30" rx="6"/><text x="722" y="216" text-anchor="middle">E</text>
  <path class="line" d="M596 71 H618" marker-end="url(#arr-gcol-1)"/>
  <path class="line" d="M664 71 H698" marker-end="url(#arr-gcol-1)"/>
  <path class="line" d="M642 86 V124" marker-end="url(#arr-gcol-1)"/>
  <path class="line" d="M664 211 H698" marker-end="url(#arr-gcol-1)"/>
  <text x="650" y="252" text-anchor="middle" class="small">no grey left: anything still</text>
  <text x="650" y="267" text-anchor="middle" class="small">white is garbage, sweep frees it</text>
  <path class="line dashed" d="M265 20 V240" style="stroke: var(--line)"/>
  <path class="line dashed" d="M525 20 V240" style="stroke: var(--line)"/>
</svg>
<figcaption>Plain boxes are white, orange are grey, green are black, red are white objects left at the end: garbage. D and E point to each other, which would fool reference counting, but nothing reaches them, so tracing frees them.</figcaption>
</figure>
<p><strong>The write barrier.</strong> Marking runs while your goroutines keep changing pointers. Picture this: the GC has already scanned A (black). Your code stores a pointer to white object W into A, then deletes the only other pointer to W, from a grey object. The GC won't rescan A, never sees W, and frees memory still in use. To prevent this, while marking is on, the compiler-inserted <strong>write barrier</strong> runs on every pointer write in the heap and shades the objects involved grey. Go's is a hybrid barrier: it shades both the object whose reference is being overwritten (Yuasa-style) and the object being written (Dijkstra-style). It costs a little on each pointer write, only during marking.</p>

<h3>One GC cycle</h3>
<figure class="diagram">
<svg viewBox="0 0 780 290" role="img" aria-label="Timeline of one GC cycle with the heap size above it. The program allocates and the heap grows from the live heap toward the goal. Before the goal, a short stop-the-world sweep termination starts the cycle. Concurrent marking follows, with the write barrier on, about 25 percent of CPU for background workers, and mark assists from goroutines that allocate. A short stop-the-world mark termination ends marking. Sweeping then runs lazily and concurrently, the in-use heap falls back to the live heap, and the program keeps allocating.">
  <defs><marker id="arr-gcol-2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <path class="line" d="M60 170 V30" marker-end="url(#arr-gcol-2)"/>
  <text x="52" y="40" text-anchor="end" class="small">heap</text>
  <path class="line bad dashed" d="M60 62 H740"/>
  <text x="70" y="55" class="small">goal = live + (live + roots) × GOGC/100</text>
  <path class="line ok dashed" d="M60 150 H740"/>
  <text x="70" y="166" class="small">live heap (what marking found reachable last cycle)</text>
  <path class="line accent" d="M60 150 L330 84 L520 70 L640 150 L740 112"/>
  <text x="430" y="54" text-anchor="middle" class="small">allocation keeps going during marking</text>

  <rect class="box" x="60" y="190" width="270" height="40" rx="4"/><text x="195" y="215" text-anchor="middle">program runs and allocates</text>
  <rect class="box bad" x="330" y="190" width="10" height="40"/>
  <rect class="box accent" x="340" y="190" width="180" height="40" rx="4"/><text x="430" y="207" text-anchor="middle">concurrent mark</text><text x="430" y="223" text-anchor="middle" class="small">write barrier · assists</text>
  <rect class="box bad" x="520" y="190" width="10" height="40"/>
  <rect class="box ok" x="530" y="190" width="110" height="40" rx="4"/><text x="585" y="215" text-anchor="middle">sweep</text>
  <rect class="box" x="640" y="190" width="100" height="40" rx="4"/><text x="690" y="215" text-anchor="middle">allocates</text>
  <path class="line bad" d="M335 232 V246"/><text x="335" y="260" text-anchor="middle" class="small">STW: sweep termination</text>
  <path class="line bad" d="M525 232 V262"/><text x="525" y="276" text-anchor="middle" class="small">STW: mark termination</text>
</svg>
<figcaption>Only the two thin red slices stop the world; the Go GC guide calls them brief pauses at the transitions between mark and sweep. Marking starts <em>before</em> the heap reaches the goal, so that it can finish around the goal while the program keeps allocating.</figcaption>
</figure>
<ul>
  <li><strong>The pacer</strong> decides when to start. It aims to finish marking just as the heap reaches the goal, based on how fast the program allocated and how long marking took last time.</li>
  <li><strong>Background workers</strong> get about 25% of the CPU (of <code>GOMAXPROCS</code>) during marking. The GC guide lists this as a latency source: the GC takes 25% of CPU during the mark phase.</li>
  <li><strong>Mark assists</strong>: a goroutine that allocates fast during marking is made to do some marking itself, in proportion to what it allocates. That is why allocation-heavy requests slow down during a GC.</li>
  <li><strong>Sweeping</strong> is lazy: spans are swept in the background or when the allocator needs them. Memory is reused within the process first and returned to the OS gradually.</li>
  <li><strong>Green Tea.</strong> Go 1.25 shipped a new marking implementation, the Green Tea GC, as an experiment; Go 1.26 made it the default. Per the release notes it marks and scans small objects with better locality and CPU scalability (they expect 10–40% less GC overhead in GC-heavy programs). The model above is unchanged.</li>
</ul>

<h3>The two knobs: GOGC and GOMEMLIMIT</h3>
<p><strong><code>GOGC</code></strong> (default 100) sets how much the heap may grow past the live heap before the next cycle. The GC guide's formula: <em>target heap = live heap + (live heap + GC roots) × GOGC / 100</em>. With 50 MiB live and GOGC=100, the next GC targets about 100 MiB. GOGC=200 lets it reach about 150 MiB: half as many GCs, more memory. Fewer GCs means less GC CPU; the price is memory. <code>GOGC=off</code> disables the GC.</p>
<p><strong><code>GOMEMLIMIT</code></strong> (Go 1.19) sets a <em>soft</em> limit on all memory the Go runtime manages (heap, stacks, runtime metadata; not cgo memory or the binary itself). When total memory nears the limit, the GC runs more often regardless of GOGC. The limit is soft for a reason: if the live heap itself is close to the limit, the GC would run back to back and the program would make no progress. The GC guide calls this <strong>thrashing</strong>, and caps GC CPU at roughly 50% (over a <code>2 × GOMAXPROCS</code> CPU-second window), so a too-low limit slows the program by at most about 2× instead of freezing it. Past that, memory grows over the limit, and the container may OOM.</p>
<table>
  <tr><th>Setting</th><th>Behaviour</th><th>Use when</th></tr>
  <tr><td><code>GOGC=100</code> (default), no limit</td><td>Heap peaks around 2× live</td><td>You don't know the memory budget (CLIs, libraries, shared hosts)</td></tr>
  <tr><td><code>GOGC=200…400</code></td><td>Fewer GCs, higher peak</td><td>GC CPU is a real cost and there is spare memory</td></tr>
  <tr><td><code>GOGC=100</code> + <code>GOMEMLIMIT</code></td><td>Normal, but GCs harder near the limit</td><td>Containers: a safety net against OOMKill during spikes</td></tr>
  <tr><td><code>GOGC=off</code> + <code>GOMEMLIMIT</code></td><td>GC runs only when near the limit</td><td>Memory is reserved for this process alone and you want the fewest GCs; risky if the live heap can approach the limit</td></tr>
  <tr><td><code>GOGC=off</code>, no limit</td><td>No GC at all</td><td>Short-lived batch tools only; heap grows without bound</td></tr>
</table>
<p>The GC guide's advice: <strong>do</strong> set a memory limit when the program owns its environment, like a container with a fixed memory limit, and leave 5–10% headroom for memory the runtime doesn't know about. <strong>Don't</strong> use it for CLI tools or anything whose memory depends on its input, and don't use it to rescue a program that is already close to its environment's limit: it will thrash. Both are also settable at runtime with <code>debug.SetGCPercent</code> and <code>debug.SetMemoryLimit</code>.</p>

<h3>How Go compares</h3>
<table>
  <tr><th>Runtime</th><th>Approach</th><th>Moves objects?</th><th>Generational?</th><th>Main knobs</th></tr>
  <tr><td><strong>Go</strong></td><td>Concurrent tri-color mark-sweep, short STW pauses</td><td>No</td><td>No</td><td><code>GOGC</code>, <code>GOMEMLIMIT</code></td></tr>
  <tr><td><strong>JVM G1</strong></td><td>Region-based, mostly-concurrent marking, copying (evacuating) collection of regions; the default collector since JDK 9</td><td>Yes (compacts)</td><td>Yes</td><td>Heap size (<code>-Xmx</code>), pause-time goal, many more</td></tr>
  <tr><td><strong>JVM ZGC</strong></td><td>Concurrent marking <em>and</em> relocation, very short pauses largely independent of heap size</td><td>Yes, concurrently</td><td>Yes (since JDK 21; the only mode since JDK 24)</td><td>Heap size</td></tr>
  <tr><td><strong>.NET</strong></td><td>Generational (gen 0/1/2 plus a large object heap), workstation and server modes, background GC</td><td>Yes (compacts)</td><td>Yes</td><td>GC mode, heap limits</td></tr>
  <tr><td><strong>CPython</strong></td><td>Reference counting frees most objects immediately; a separate cycle collector finds reference cycles</td><td>No</td><td>Cycle collector only</td><td><code>gc</code> module thresholds</td></tr>
  <tr><td><strong>Rust</strong></td><td>No GC: ownership frees values when their owner goes out of scope; <code>Rc</code>/<code>Arc</code> are opt-in refcounting (cycles leak unless broken with <code>Weak</code>)</td><td>No</td><td>n/a</td><td>None: the compiler decides</td></tr>
</table>
<p>Why no generations or compaction? Objects that never move keep cgo, <code>unsafe</code> and interior pointers simple, and escape analysis already keeps many short-lived values on the stack, which is part of what a young generation is for. The trade: no compaction of a fragmented heap, and every cycle marks the whole live heap.</p>

<h2>Example</h2>
<p><strong>1. The same workload under four settings.</strong> <code>gcload</code> keeps 50 MiB alive and churns through 2 GiB of short-lived 1 MiB buffers, sampling the heap through <code>runtime/metrics</code> (cheap, unlike <code>ReadMemStats</code>, which stops the world).</p>
<pre><code>// imports: fmt, math, runtime, runtime/debug, runtime/metrics
var live [][]byte // long-lived data: 50 MiB

func main() {
	for range 50 {
		live = append(live, make([]byte, 1&lt;&lt;20))
	}
	sample := []metrics.Sample{{Name: "/memory/classes/heap/objects:bytes"}}
	var peak uint64
	var sink []byte
	for i := range 2 &lt;&lt; 10 { // 2048 x 1 MiB of garbage
		sink = make([]byte, 1&lt;&lt;20)
		sink[0] = byte(i)
		metrics.Read(sample) // cheap, no stop-the-world (unlike ReadMemStats)
		peak = max(peak, sample[0].Value.Uint64())
	}
	var m runtime.MemStats
	runtime.ReadMemStats(&amp;m)
	fmt.Printf("GCs=%-3d peak heap=%3dMiB  GC CPU=%.1f%%  (GOGC=%d, limit set: %v)&#92;n",
		m.NumGC, peak&gt;&gt;20, m.GCCPUFraction*100,
		debug.SetGCPercent(-1), debug.SetMemoryLimit(-1) != math.MaxInt64)
}</code></pre>
<p>Laptop run (Apple M4 Pro, 12 P). GC counts are stable across runs; peak heap and GC CPU vary by about ±20%:</p>
<pre><code>$ GOGC=100 ./gcload
$ GOGC=400 ./gcload
$ GOGC=off GOMEMLIMIT=120MiB ./gcload
$ GOGC=off ./gcload
GCs=43  peak heap=136MiB  GC CPU=4.7%  (GOGC=100, limit set: false)
GCs=10  peak heap=364MiB  GC CPU=0.9%  (GOGC=400, limit set: false)
GCs=36  peak heap=115MiB  GC CPU=5.7%  (GOGC=-1, limit set: true)
GCs=0   peak heap=2098MiB  GC CPU=0.0%  (GOGC=-1, limit set: false)</code></pre>
<ul>
  <li><strong>GOGC=100</strong>: 43 cycles. The goal is about 2× the 50 MiB live set; the peak lands above it because the program keeps allocating while marking runs.</li>
  <li><strong>GOGC=400</strong>: a quarter of the cycles and a fraction of the GC CPU, for 2.5–3× the peak memory. That is the whole trade in one line.</li>
  <li><strong>GOGC=off + 120 MiB limit</strong>: the GC only runs near the limit, and the peak stays around it. (It can overshoot slightly; the limit is soft and the sample counts heap objects only.)</li>
  <li><strong>GOGC=off, no limit</strong>: zero GCs and a 2 GiB heap for a 50 MiB live set. In a 512 MiB container this process gets OOMKilled.</li>
</ul>
<p><strong>2. Reading <code>gctrace</code>.</strong> <code>GODEBUG=gctrace=1</code> prints one line per cycle to stderr. One real line from the GOGC=100 run:</p>
<pre><code>$ GODEBUG=gctrace=1 ./gcload     (one line, wrapped here)
gc 21 @0.008s 3%: 0.013+0.068+0.008 ms clock,
    0.16+0.012/0.056/0.010+0.10 ms cpu,
    104-&gt;111-&gt;57 MB, 108 MB goal,
    0 MB stacks, 0 MB globals, 12 P</code></pre>
<table>
  <tr><th>Field</th><th>Meaning (from the <code>runtime</code> package docs)</th></tr>
  <tr><td><code>gc 21</code></td><td>The 21st GC since the program started</td></tr>
  <tr><td><code>@0.008s</code></td><td>Seconds since program start</td></tr>
  <tr><td><code>3%</code></td><td>Share of time spent in GC since program start</td></tr>
  <tr><td><code>0.013+0.068+0.008 ms clock</code></td><td>Wall time of STW sweep termination + concurrent mark and scan + STW mark termination. The two pauses here are 13 µs and 8 µs.</td></tr>
  <tr><td><code>0.16+0.012/0.056/0.010+0.10 ms cpu</code></td><td>CPU time of the same phases; the middle is split into assist / background / idle GC time</td></tr>
  <tr><td><code>104-&gt;111-&gt;57 MB</code></td><td>Heap at GC start, heap at GC end, and live heap. The heap grew 7 MB <em>during</em> marking; 57 MB survived.</td></tr>
  <tr><td><code>108 MB goal</code></td><td>The heap goal for this cycle (from the previous cycle's live heap)</td></tr>
  <tr><td><code>0 MB stacks, 0 MB globals</code></td><td>Scannable stack and global sizes, also counted in the goal</td></tr>
  <tr><td><code>12 P</code></td><td>Processors used (<code>GOMAXPROCS</code>)</td></tr>
</table>
<p>The docs say the format may change between releases. The <em>live heap</em> number (the third one) is the one to watch for leaks: if it climbs cycle after cycle under steady load, see <a href="#memory-leaks">Memory Leaks</a>.</p>

<p><strong>3. Allocate less: the knob you own.</strong> GC cost is driven by how much you allocate (how often cycles run) and how much is live and full of pointers (how long marking takes). The compiler's <em>escape analysis</em> decides what goes on the heap: a value whose address outlives the function, or whose size isn't known at compile time, escapes.</p>
<pre><code>type Point struct{ X, Y int }

// NewPoint returns a pointer that outlives the call: the Point must live on the heap.
func NewPoint(x, y int) *Point { return &amp;Point{X: x, Y: y} }

// Dist keeps its Point local: it stays on the stack, zero GC work.
func Dist(x, y int) int {
	p := Point{X: x, Y: y}
	return p.X*p.X + p.Y*p.Y
}

// IDsGrow appends to a nil slice: it reallocates each time capacity runs out.
func IDsGrow(n int) []int {
	var ids []int
	for i := range n {
		ids = append(ids, i)
	}
	return ids
}

// IDsPrealloc sizes the slice once.
func IDsPrealloc(n int) []int {
	ids := make([]int, 0, n)
	for i := range n {
		ids = append(ids, i)
	}
	return ids
}

var bufPool = sync.Pool{New: func() any { return new(bytes.Buffer) }}

// RenderPooled reuses buffers across calls instead of allocating one per call.
func RenderPooled(ids []int) int {
	buf := bufPool.Get().(*bytes.Buffer)
	defer func() { buf.Reset(); bufPool.Put(buf) }()
	for _, id := range ids {
		buf.Write(strconv.AppendInt(buf.AvailableBuffer(), int64(id), 10))
		buf.WriteByte(',')
	}
	return buf.Len()
}

// RenderFresh (not shown) is the same loop with a fresh bytes.Buffer per call.</code></pre>
<pre><code>$ go build -gcflags=-m .   (inlining lines removed; line numbers are in the full alloc.go)
./alloc.go:38:53: new(bytes.Buffer) escapes to heap
./alloc.go:12:41: &amp;Point{...} escapes to heap
./alloc.go:24:15: append escapes to heap
./alloc.go:31:13: make([]int, 0, n) escapes to heap
./alloc.go:33:15: append escapes to heap
./alloc.go:41:19: ids does not escape
./alloc.go:52:18: ids does not escape</code></pre>
<p><code>NewPoint</code>'s <code>&amp;Point{…}</code> escapes because the pointer is returned. <code>Dist</code> has no line at all: its <code>Point</code> lives on the stack and the GC never sees it. Both <code>IDs</code> functions escape because they return the slice. The difference is <em>how many times</em>:</p>
<pre><code>package gcdemo

import (
	"fmt"
	"testing"
)

var sink []int // keeps results alive so the compiler can't drop them

func Example_allocs() {
	grow := testing.AllocsPerRun(100, func() { sink = IDsGrow(1000) })
	pre := testing.AllocsPerRun(100, func() { sink = IDsPrealloc(1000) })
	fmt.Println("append to nil slice:", grow, "allocs per call")
	fmt.Println("make(.., 0, n):     ", pre, "allocs per call")
	// Output:
	// append to nil slice: 9 allocs per call
	// make(.., 0, n):      1 allocs per call
}</code></pre>
<pre><code>$ go test -bench Render -benchmem
cpu: Apple M4 Pro
BenchmarkRenderFresh-12     	  157954	      7753 ns/op	    8168 B/op	      12 allocs/op
BenchmarkRenderPooled-12    	  176229	      6811 ns/op	       0 B/op	       0 allocs/op</code></pre>
<p>Growing a slice from nil reallocated 9 times for 1,000 elements; preallocating needed one allocation. <code>sync.Pool</code> took the buffer allocation and its regrowth out of the hot path: 12 allocations and 8 KB per call went to zero (laptop benchmark numbers). A pool is a cache the runtime may drop at any GC, not a free list: only put objects in it that are cheap to recreate, and <code>Reset</code> them before reuse.</p>
<p><strong>Real-world scenario.</strong> A JSON API pod has a 1 GiB container limit and a 300 MiB live heap. With the default GOGC=100 the heap peaks near 600 MiB, and profiling shows 18% of CPU in GC because each request allocates about 2 MB. Setting <code>GOMEMLIMIT=920MiB</code> (about 10% headroom) and <code>GOGC=200</code> cuts GC cycles roughly in half while the limit protects against spikes. Then a <code>-benchmem</code> pass on the hot handler (preallocated slices, a pooled encoder buffer) halves allocations per request again.</p>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>Treating GC as free.</strong> It isn't: 25% of CPU during marking, assists that slow allocating goroutines, and a heap that peaks at about 2× live by default. Profile allocations (<code>pprof -sample_index=alloc_space</code>) before blaming the GC.</li>
  <li><strong>Calling <code>runtime.GC()</code> to "help".</strong> It forces a full, blocking cycle. Outside tests and benchmarks it almost always makes things worse.</li>
  <li><strong>A memory limit far above the container limit, or none at all.</strong> Without <code>GOMEMLIMIT</code>, the GC doesn't know about the container's limit and can let a spike's garbage push the pod over it. Set it at 90–95% of the container limit.</li>
  <li><strong>A memory limit too close to the live heap.</strong> The GC thrashes (up to about 50% CPU) and latency goes up for everyone. If the live heap really needs the memory, give the container more.</li>
  <li><strong>Pointer-heavy data structures.</strong> A map with millions of entries of <code>*Item</code> makes every cycle chase millions of pointers. Values instead of pointers, slices of structs, or IDs instead of pointers make marking cheaper.</li>
</ul>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>A tracing GC frees what is unreachable from the roots. Go's is concurrent tri-color mark-sweep, non-moving and non-generational, with two short stop-the-world pauses per cycle and a write barrier during marking.</li>
  <li><code>GOGC</code> trades memory for CPU (default 100: heap peaks around 2× live). <code>GOMEMLIMIT</code> is a soft ceiling for containers; leave 5–10% headroom.</li>
  <li>The biggest lever is allocating less: check escapes with <code>-gcflags=-m</code>, preallocate, pool hot buffers, and measure with <code>-benchmem</code>.</li>
  <li>Watch the live heap in <code>gctrace</code> or metrics: if it climbs under steady load, you have a leak, not a GC problem.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#memory-leaks">Memory Leaks</a> · <a href="#latency">Latency</a> · <a href="#p99-latency">P99 Latency</a> · <a href="#kubernetes">Kubernetes</a> · <a href="#metrics">Metrics</a> · <a href="#real-world-concurrent-service">Real-World Concurrent Service</a></p>
`;
