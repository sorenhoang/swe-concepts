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
