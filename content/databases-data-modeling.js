CONTENT["database-indexing"] = `
<p class="tldr"><strong>TL;DR</strong>: An index is a separate, sorted copy of one or more columns, with a pointer from each entry back to its row. It lets the database jump to the rows it needs instead of reading the whole table, like the index at the back of a book. The cost: every write must update every index, and an index helps only if the query's <code>WHERE</code> and <code>ORDER BY</code> match how it is sorted.</p>

<h2>The problem it solves</h2>
<p>A table is stored as a heap: rows sit in 8 KB pages (in PostgreSQL) in roughly the order they were inserted. To answer <code>WHERE customer_id = 4242</code> without help, the database must read every page and test every row. That is a <strong>sequential scan</strong>, and its cost grows linearly with the table. At 100,000 rows it takes a couple of milliseconds. At 100 million rows it takes seconds, uses disk bandwidth, and pushes useful pages out of the cache.</p>
<p>Most queries want a tiny fraction of the rows: one user, one order, the latest 20 events. An index stores the column values in sorted order in a tree, so finding a value costs a few page reads (O(log n)) instead of all of them (O(n)). It can also hand back rows already sorted, which removes a sort step from <code>ORDER BY … LIMIT</code> queries.</p>

<h2>How it works</h2>
<p>The default index in PostgreSQL, MySQL and most relational databases is a <strong>B-tree</strong> (strictly, a B+tree variant). Each node is one disk page holding many sorted keys, so the tree is wide and shallow: a few levels cover millions of rows.</p>
<figure class="diagram">
<svg viewBox="0 0 780 330" role="img" aria-label="A B-tree index on customer_id. The root page points to three internal pages by key range. The internal page for 3334 to 5000 points to the leaf page containing 4242. The leaf holds the 20 row pointers for customer 4242, and arrows go from it to the heap pages that hold those rows. Leaves are linked to their neighbours for range scans.">
  <defs><marker id="arr-idx-1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <rect class="box accent" x="310" y="20" width="160" height="44" rx="6"/>
  <text x="390" y="38" text-anchor="middle" class="title">root page</text>
  <text x="390" y="55" text-anchor="middle" class="small">&lt;1667 | &lt;3334 | rest</text>

  <path class="line" d="M350 64 L160 98" marker-end="url(#arr-idx-1)"/>
  <path class="line" d="M390 64 V98" marker-end="url(#arr-idx-1)"/>
  <path class="line accent" d="M430 64 L620 98" marker-end="url(#arr-idx-1)"/>
  <rect class="box" x="80" y="100" width="160" height="40" rx="6"/><text x="160" y="118" text-anchor="middle">internal</text><text x="160" y="133" text-anchor="middle" class="small">keys 1 – 1666</text>
  <rect class="box" x="310" y="100" width="160" height="40" rx="6"/><text x="390" y="118" text-anchor="middle">internal</text><text x="390" y="133" text-anchor="middle" class="small">keys 1667 – 3333</text>
  <rect class="box accent" x="540" y="100" width="160" height="40" rx="6"/><text x="620" y="118" text-anchor="middle">internal</text><text x="620" y="133" text-anchor="middle" class="small">keys 3334 – 5000</text>

  <path class="line" d="M130 140 L85 178" marker-end="url(#arr-idx-1)"/>
  <path class="line" d="M190 140 L235 178" marker-end="url(#arr-idx-1)"/>
  <path class="line" d="M390 140 V178" marker-end="url(#arr-idx-1)"/>
  <path class="line accent" d="M600 140 L545 178" marker-end="url(#arr-idx-1)"/>
  <path class="line" d="M650 140 L700 178" marker-end="url(#arr-idx-1)"/>
  <rect class="box" x="25" y="180" width="120" height="40" rx="6"/><text x="85" y="198" text-anchor="middle">leaf</text><text x="85" y="213" text-anchor="middle" class="small">1 … 830</text>
  <rect class="box" x="175" y="180" width="120" height="40" rx="6"/><text x="235" y="198" text-anchor="middle">leaf</text><text x="235" y="213" text-anchor="middle" class="small">831 … 1666</text>
  <rect class="box" x="330" y="180" width="120" height="40" rx="6"/><text x="390" y="198" text-anchor="middle">leaf</text><text x="390" y="213" text-anchor="middle" class="small">1667 … 3333</text>
  <rect class="box accent" x="485" y="180" width="120" height="40" rx="6"/><text x="545" y="198" text-anchor="middle" class="title">leaf: 4242</text><text x="545" y="213" text-anchor="middle" class="small">20 row pointers</text>
  <rect class="box" x="640" y="180" width="120" height="40" rx="6"/><text x="700" y="198" text-anchor="middle">leaf</text><text x="700" y="213" text-anchor="middle" class="small">4300 … 5000</text>
  <path class="line dashed" d="M147 200 H173" marker-end="url(#arr-idx-1)"/>
  <path class="line dashed" d="M297 200 H328" marker-end="url(#arr-idx-1)"/>
  <path class="line dashed" d="M452 200 H483" marker-end="url(#arr-idx-1)"/>
  <path class="line dashed" d="M607 200 H638" marker-end="url(#arr-idx-1)"/>

  <path class="line accent" d="M515 220 L160 268" marker-end="url(#arr-idx-1)"/>
  <path class="line accent" d="M545 220 L445 268" marker-end="url(#arr-idx-1)"/>
  <path class="line accent" d="M575 220 L630 268" marker-end="url(#arr-idx-1)"/>
  <rect class="box muted" x="20" y="270" width="80" height="30" rx="4"/><text x="60" y="290" text-anchor="middle" class="small">heap p.0</text>
  <rect class="box ok" x="115" y="270" width="80" height="30" rx="4"/><text x="155" y="290" text-anchor="middle" class="small">heap p.31</text>
  <rect class="box muted" x="210" y="270" width="80" height="30" rx="4"/><text x="250" y="290" text-anchor="middle" class="small">heap p.32</text>
  <rect class="box muted" x="305" y="270" width="80" height="30" rx="4"/><text x="345" y="290" text-anchor="middle" class="small">…</text>
  <rect class="box ok" x="400" y="270" width="80" height="30" rx="4"/><text x="440" y="290" text-anchor="middle" class="small">heap p.68</text>
  <rect class="box muted" x="495" y="270" width="80" height="30" rx="4"/><text x="535" y="290" text-anchor="middle" class="small">…</text>
  <rect class="box ok" x="590" y="270" width="80" height="30" rx="4"/><text x="630" y="290" text-anchor="middle" class="small">heap p.105</text>
  <rect class="box muted" x="685" y="270" width="80" height="30" rx="4"/><text x="725" y="290" text-anchor="middle" class="small">… p.740</text>
  <text x="390" y="322" text-anchor="middle" class="small">table heap: rows in insertion order, so customer 4242's rows are spread over many pages</text>
</svg>
<figcaption>Looking up customer 4242: root, internal, leaf (3 page reads), then one heap page per matching row. Leaves are linked, so a range like <code>BETWEEN 4242 AND 4250</code> walks sideways. A sequential scan would read all 741 heap pages.</figcaption>
</figure>
<p>The lookup descends from the root, binary-searching the keys in each page (one page read per level, usually from cache). The leaf holds each key with a pointer to its row; in PostgreSQL that is a TID, (heap page, item number). Leaves link to their neighbours, so ranges and <code>ORDER BY</code> just walk sideways. Then each matching row is fetched from the heap and checked for visibility. That last step is often the expensive part: 20 matching rows can mean 20 different pages.</p>
<p>When many rows match, PostgreSQL switches to a <strong>bitmap scan</strong>: it first collects all matching TIDs from the index, sorts them by page, then reads each heap page once, in physical order. That is what the <code>Bitmap Index Scan</code> / <code>Bitmap Heap Scan</code> pair in the example output means.</p>

<h3>Clustered vs heap tables</h3>
<p>MySQL's InnoDB is organised differently. The table <em>is</em> a B-tree on the primary key (the <strong>clustered index</strong>): the full rows live in its leaves. Every secondary index stores the primary-key value instead of a page pointer, so a secondary lookup is two tree walks: find the PK in the secondary index, then find the row in the clustered index. Two consequences follow from the MySQL docs: a long primary key makes every secondary index bigger, and random PKs (like UUIDv4) insert all over the clustered tree instead of at its end. If you define no primary key, InnoDB uses the first <code>UNIQUE</code> index whose columns are all <code>NOT NULL</code>, or else a hidden 6-byte row ID.</p>

<h3>Composite indexes: column order matters</h3>
<p>An index on <code>(customer_id, created_at)</code> is sorted by <code>customer_id</code> first, and by <code>created_at</code> only within each customer, like a phone book sorted by last name, then first name. The PostgreSQL docs state the rule: equality conditions on the leading columns, plus a range condition on the first column without an equality condition, limit the part of the index that is scanned. Conditions on later columns are still checked in the index, but don't narrow the scan.</p>
<figure class="diagram">
<svg viewBox="0 0 780 300" role="img" aria-label="Two indexes with the same columns in different orders. In the index on customer_id then created_at, the three entries for customer 4242 sit next to each other in date order, so the query reads three adjacent entries backwards and stops. In the index on created_at then customer_id, the entries for 4242 are scattered between other customers, so the query must walk the whole index or fall back to a table scan.">
  <defs><marker id="arr-idx-2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <text x="190" y="22" text-anchor="middle" class="title">(customer_id, created_at)</text>
  <text x="590" y="22" text-anchor="middle" class="title">(created_at, customer_id)</text>
  <path class="line dashed" d="M390 10 V290" style="stroke: var(--line)"/>

  <rect class="box muted" x="90" y="40" width="200" height="26" rx="4"/><text x="190" y="58" text-anchor="middle">4241 · Feb 07</text>
  <rect class="box muted" x="90" y="70" width="200" height="26" rx="4"/><text x="190" y="88" text-anchor="middle">4241 · Mar 10</text>
  <rect class="box ok" x="90" y="100" width="200" height="26" rx="4"/><text x="190" y="118" text-anchor="middle">4242 · Jan 03</text>
  <rect class="box ok" x="90" y="130" width="200" height="26" rx="4"/><text x="190" y="148" text-anchor="middle">4242 · Feb 02</text>
  <rect class="box ok" x="90" y="160" width="200" height="26" rx="4"/><text x="190" y="178" text-anchor="middle">4242 · Mar 05</text>
  <rect class="box muted" x="90" y="190" width="200" height="26" rx="4"/><text x="190" y="208" text-anchor="middle">4243 · Jan 04</text>
  <path class="line ok" d="M310 186 V104" marker-end="url(#arr-idx-2)"/>
  <text x="330" y="140" class="small">read</text><text x="330" y="154" class="small">up</text>
  <text x="190" y="246" text-anchor="middle" class="small">one contiguous run, already sorted by date:</text>
  <text x="190" y="262" text-anchor="middle" class="small">ORDER BY created_at DESC LIMIT 3 reads 3 entries,</text>
  <text x="190" y="278" text-anchor="middle" class="small">no Sort node</text>

  <rect class="box muted" x="490" y="40" width="200" height="26" rx="4"/><text x="590" y="58" text-anchor="middle">Jan 03 · 1187</text>
  <rect class="box bad" x="490" y="70" width="200" height="26" rx="4"/><text x="590" y="88" text-anchor="middle">Jan 03 · 4242</text>
  <rect class="box muted" x="490" y="100" width="200" height="26" rx="4"/><text x="590" y="118" text-anchor="middle">Jan 04 · 4243</text>
  <rect class="box muted" x="490" y="130" width="200" height="26" rx="4"/><text x="590" y="148" text-anchor="middle">… thousands …</text>
  <rect class="box bad" x="490" y="160" width="200" height="26" rx="4"/><text x="590" y="178" text-anchor="middle">Feb 02 · 4242</text>
  <rect class="box muted" x="490" y="190" width="200" height="26" rx="4"/><text x="590" y="208" text-anchor="middle">… thousands …</text>
  <text x="590" y="246" text-anchor="middle" class="small">4242 is scattered across the whole index:</text>
  <text x="590" y="262" text-anchor="middle" class="small">walk all of it (or PG 18 skip scan, if few dates)</text>
  <text x="590" y="278" text-anchor="middle" class="small">usually the planner picks a Seq Scan instead</text>
</svg>
<figcaption>Same columns, different order, very different work. Put equality columns first, then the column you range over or sort by.</figcaption>
</figure>
<p>Practical rules for choosing the order:</p>
<ul>
  <li><strong>Equality columns first, then one range or sort column.</strong> <code>WHERE tenant_id = ? AND created_at &gt; ? ORDER BY created_at</code> wants <code>(tenant_id, created_at)</code>. With <code>(created_at, tenant_id)</code>, the range on the first column reads every tenant's rows in that window.</li>
  <li><strong>Leftmost prefix.</strong> <code>(a, b, c)</code> serves <code>WHERE a = ?</code> and <code>WHERE a = ? AND b = ?</code> well. It usually can't help <code>WHERE b = ?</code> alone, so don't also create a separate index on <code>(a)</code>: it's redundant. PostgreSQL 18 added <strong>B-tree skip scan</strong>, which can use <code>(a, b)</code> for <code>WHERE b = ?</code> by probing each distinct <code>a</code>, but only pays off when <code>a</code> has few distinct values. Don't design around it.</li>
  <li><strong>Sort direction.</strong> A B-tree can be read backwards, so <code>(customer_id, created_at)</code> serves both <code>ASC</code> and <code>DESC</code>. Mixed orders like <code>ORDER BY a ASC, b DESC</code> need an index declared that way.</li>
</ul>

<h3>Covering indexes and index-only scans</h3>
<p>If every column a query needs is in the index, PostgreSQL can answer from the index alone, an <strong>index-only scan</strong>. <code>INCLUDE</code> (PostgreSQL 11+; B-tree, GiST and SP-GiST) adds payload columns to the leaves without making them part of the search key. There's one catch specific to PostgreSQL: the index doesn't know if a row version is visible to your transaction. The scan checks the table's <strong>visibility map</strong>, one bit per heap page that says "every row here is visible to everyone". If the bit is set, the heap is skipped. If not, the row is fetched anyway and counted as a <code>Heap Fetch</code>. <code>VACUUM</code> sets those bits, so a freshly loaded or heavily updated table gets little benefit until autovacuum catches up. In InnoDB, any secondary index that contains the needed columns (plus the PK, which is always there) is covering.</p>

<h3>Partial, expression and unique indexes</h3>
<pre><code>-- partial: only the rows a hot query cares about
CREATE INDEX orders_pending_idx ON orders (created_at) WHERE status = 'pending';

-- expression: the query must use the same expression
CREATE INDEX users_email_lower_idx ON users (lower(email));

-- unique: an index that is also a constraint
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

-- on a live table: no long write lock (slower, cannot run inside a transaction)
CREATE INDEX CONCURRENTLY orders_customer_idx ON orders (customer_id);</code></pre>
<ul>
  <li><strong>Partial</strong> indexes store only rows matching a <code>WHERE</code>. An index on 2% of the table is 50× smaller and cheaper to maintain. The planner uses it only when the query's condition implies the index's condition.</li>
  <li><strong>Expression</strong> indexes store a computed value. <code>WHERE lower(email) = $1</code> can't use a plain index on <code>email</code>, but can use one on <code>lower(email)</code>. See <a href="#query-optimization">Query Optimization</a> for that fix measured.</li>
  <li><strong>Unique</strong> indexes enforce a constraint: two concurrent inserts of the same email can't both succeed, which no application-side "check then insert" can guarantee (see <a href="#race-conditions">Race Conditions</a>). <code>PRIMARY KEY</code> and <code>UNIQUE</code> constraints create one automatically. In PostgreSQL only B-tree indexes can be unique.</li>
</ul>

<h2>Index types</h2>
<p>PostgreSQL offers six built-in index types, chosen with <code>CREATE INDEX … USING &lt;type&gt;</code>. B-tree is the default and the right answer most of the time.</p>
<table>
  <tr><th>Type</th><th>Good for</th><th>Operators</th><th>Notes</th></tr>
  <tr><td><strong>B-tree</strong></td><td>Almost everything: equality, ranges, sorting, prefixes</td><td><code>&lt; &lt;= = &gt;= &gt;</code>, <code>BETWEEN</code>, <code>IN</code>, <code>IS NULL</code>, anchored <code>LIKE 'foo%'</code></td><td>Default. Supports multicolumn, <code>UNIQUE</code>, <code>INCLUDE</code>, index-only scans, <code>ORDER BY</code>. <code>LIKE 'foo%'</code> needs the C collation or a <code>text_pattern_ops</code> index.</td></tr>
  <tr><td><strong>Hash</strong></td><td>Equality only on large values</td><td><code>=</code></td><td>Stores a 32-bit hash. No ranges, no sorting, single column, not unique. Rarely beats a B-tree.</td></tr>
  <tr><td><strong>GIN</strong></td><td>Values with many parts: <code>jsonb</code>, arrays, full-text <code>tsvector</code>, trigrams (<code>pg_trgm</code>)</td><td><code>@&gt; &lt;@ &amp;&amp;</code>, <code>&#64;&#64;</code>, <code>?</code></td><td>Inverted index: one entry per element. Fast lookups, slower writes. No index-only scans.</td></tr>
  <tr><td><strong>GiST</strong></td><td>Geometry, ranges, PostGIS, nearest-neighbour</td><td><code>&amp;&amp; @&gt; &lt;@</code>, distance <code>&lt;-&gt;</code></td><td>A framework for balanced trees over custom types. Powers exclusion constraints (no overlapping bookings).</td></tr>
  <tr><td><strong>SP-GiST</strong></td><td>Non-balanced partitioning: quadtrees, k-d trees, tries</td><td>depends on operator class</td><td>For data with natural clustering, such as points or IP prefixes.</td></tr>
  <tr><td><strong>BRIN</strong></td><td>Huge append-only tables where the value follows physical order (timestamps, serial IDs)</td><td><code>&lt; &lt;= = &gt;= &gt;</code></td><td>Stores only a min/max summary per block range, so it is tiny. Useless if the values are randomly spread over the table.</td></tr>
</table>

<h2>Example</h2>
<p><strong>Real plans, before and after.</strong> The test starts a real PostgreSQL 18 (via <code>embedded-postgres</code>), loads 100,000 orders for 5,000 customers (20 orders each, spread across the table), and prints <code>EXPLAIN ANALYZE</code> for each step. <code>COSTS OFF</code> and <code>TIMING OFF</code> keep the printed plans identical between runs, so they are pinned as <code>// Output:</code> blocks and <code>go test</code> fails if a plan changes. The setup file (start Postgres, load data) is omitted.</p>
<pre><code>package indexing

import (
	"fmt"
	"strings"
	"testing"
	"time"
)

// plan prints the EXPLAIN ANALYZE output of query. COSTS and TIMING are
// off so the printed plan is identical on every run.
func plan(query string) {
	rows, err := db.Query(ctx, "EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF, SUMMARY OFF) "+query)
	if err != nil {
		panic(err)
	}
	defer rows.Close()
	for rows.Next() {
		var line string
		rows.Scan(&amp;line)
		if strings.HasPrefix(line, "Planning") {
			break // skip planner buffer stats
		}
		fmt.Println(line)
	}
}

// 1. One customer's orders: full scan vs B-tree lookup.
func Example_beforeAndAfterIndex() {
	q := &#96;SELECT id, total_cents FROM orders WHERE customer_id = 4242&#96;
	fmt.Println("-- no index on customer_id")
	plan(q)

	must(&#96;CREATE INDEX orders_customer_idx ON orders (customer_id)&#96;)
	fmt.Println("-- after CREATE INDEX")
	plan(q)
	must(&#96;DROP INDEX orders_customer_idx&#96;)
}

// 2. Latest 3 orders of a customer: the column order decides
// whether Postgres must sort.
func Example_compositeOrder() {
	q := &#96;SELECT id, created_at FROM orders
	      WHERE customer_id = 4242 ORDER BY created_at DESC LIMIT 3&#96;

	must(&#96;CREATE INDEX orders_customer_idx ON orders (customer_id)&#96;)
	fmt.Println("-- index (customer_id)")
	plan(q)
	must(&#96;DROP INDEX orders_customer_idx&#96;)

	must(&#96;CREATE INDEX orders_customer_created_idx ON orders (customer_id, created_at)&#96;)
	fmt.Println("-- index (customer_id, created_at)")
	plan(q)
	must(&#96;DROP INDEX orders_customer_created_idx&#96;)
}

// 3. INCLUDE puts total_cents in the index leaf, so the heap is never read.
func Example_indexOnlyScan() {
	must(&#96;CREATE INDEX orders_cover_idx ON orders (customer_id, created_at) INCLUDE (total_cents)&#96;)
	must(&#96;VACUUM orders&#96;) // sets the visibility map bits
	plan(&#96;SELECT created_at, total_cents FROM orders WHERE customer_id = 4242&#96;)
	must(&#96;DROP INDEX orders_cover_idx&#96;)
}

// 4. 95% of rows are 'paid': the planner ignores an index that would
// touch almost every page anyway. A partial index fits the rare value.
func Example_lowSelectivity() {
	must(&#96;CREATE INDEX orders_status_idx ON orders (status)&#96;)
	must(&#96;ANALYZE orders&#96;)
	fmt.Println("-- status = 'paid' (95% of rows)")
	plan(&#96;SELECT count(*) FROM orders WHERE status = 'paid'&#96;)
	must(&#96;DROP INDEX orders_status_idx&#96;)

	must(&#96;CREATE INDEX orders_refunded_idx ON orders (created_at) WHERE status = 'refunded'&#96;)
	fmt.Println("-- partial index, refunds in one day")
	plan(&#96;SELECT id FROM orders WHERE status = 'refunded'
	      AND created_at &gt;= '2026-01-10Z' AND created_at &lt; '2026-01-11Z'&#96;)
	must(&#96;DROP INDEX orders_refunded_idx&#96;)
}

// Wall-clock cost of the query in example 1 (laptop run, rounded).
func TestTiming(t *testing.T) {
	avg := func() time.Duration {
		const n = 500
		var start time.Time
		for i := range n + 50 { // first 50 are warm-up
			if i == 50 {
				start = time.Now()
			}
			must(&#96;SELECT id, total_cents FROM orders WHERE customer_id = 4242&#96;)
		}
		return time.Since(start) / n
	}
	seq := avg()
	must(&#96;CREATE INDEX orders_customer_idx ON orders (customer_id)&#96;)
	defer must(&#96;DROP INDEX orders_customer_idx&#96;)
	idx := avg()
	t.Logf("seq scan %v, index %v per query, %.0fx faster",
		seq.Round(time.Microsecond), idx.Round(time.Microsecond), float64(seq)/float64(idx))
}</code></pre>
<p>Real output, example 1. <code>Rows Removed by Filter: 99980</code> is the waste: every row was read to keep 20. The index cuts the work from 741 buffers to 22. <code>Buffers</code> counts 8 KB pages touched; <code>hit</code> means found in PostgreSQL's cache, <code>read</code> means requested from the OS. <code>Index Searches</code> is new in PostgreSQL 18.</p>
<pre><code>-- no index on customer_id
Seq Scan on orders (actual rows=20.00 loops=1)
  Filter: (customer_id = 4242)
  Rows Removed by Filter: 99980
  Buffers: shared hit=741
-- after CREATE INDEX
Bitmap Heap Scan on orders (actual rows=20.00 loops=1)
  Recheck Cond: (customer_id = 4242)
  Heap Blocks: exact=20
  Buffers: shared hit=20 read=2
  -&gt;  Bitmap Index Scan on orders_customer_idx (actual rows=20.00 loops=1)
        Index Cond: (customer_id = 4242)
        Index Searches: 1
        Buffers: shared read=2</code></pre>
<p>Example 2. With only <code>(customer_id)</code>, Postgres finds the 20 rows and then sorts them to keep 3. With <code>(customer_id, created_at)</code>, it walks the index backwards and stops after 3 entries: no <code>Sort</code> node.</p>
<pre><code>-- index (customer_id)
Limit (actual rows=3.00 loops=1)
  Buffers: shared hit=20 read=2
  -&gt;  Sort (actual rows=3.00 loops=1)
        Sort Key: created_at DESC
        Sort Method: top-N heapsort  Memory: 25kB
        Buffers: shared hit=20 read=2
        -&gt;  Bitmap Heap Scan on orders (actual rows=20.00 loops=1)
              Recheck Cond: (customer_id = 4242)
              Heap Blocks: exact=20
              Buffers: shared hit=20 read=2
              -&gt;  Bitmap Index Scan on orders_customer_idx (actual rows=20.00 loops=1)
                    Index Cond: (customer_id = 4242)
                    Index Searches: 1
                    Buffers: shared read=2
-- index (customer_id, created_at)
Limit (actual rows=3.00 loops=1)
  Buffers: shared hit=3 read=3
  -&gt;  Index Scan Backward using orders_customer_created_idx on orders (actual rows=3.00 loops=1)
        Index Cond: (customer_id = 4242)
        Index Searches: 1
        Buffers: shared hit=3 read=3</code></pre>
<p>Example 3. Every column the query needs is in the index, and <code>VACUUM</code> has set the visibility map, so <code>Heap Fetches: 0</code>: the table was never read. Four buffers in total.</p>
<pre><code>Index Only Scan using orders_cover_idx on orders (actual rows=20.00 loops=1)
  Index Cond: (customer_id = 4242)
  Heap Fetches: 0
  Index Searches: 1
  Buffers: shared hit=1 read=3</code></pre>
<p>Example 4. An index on <code>status</code> exists, but 95% of rows are <code>'paid'</code>. Reading the index and then nearly every heap page would cost more than one sequential pass, so the planner uses a <code>Seq Scan</code>. That is the correct decision, not a bug. The partial index covers only the 5% of refunded rows, and serves "refunds in one day" in 14 buffers.</p>
<pre><code>-- status = 'paid' (95% of rows)
Aggregate (actual rows=1.00 loops=1)
  Buffers: shared hit=741
  -&gt;  Seq Scan on orders (actual rows=95000.00 loops=1)
        Filter: (status = 'paid'::text)
        Rows Removed by Filter: 5000
        Buffers: shared hit=741
-- partial index, refunds in one day
Index Scan using orders_refunded_idx on orders (actual rows=72.00 loops=1)
  Index Cond: ((created_at &gt;= '2026-01-10 00:00:00+00'::timestamp with time zone) AND (created_at &lt; '2026-01-11 00:00:00+00'::timestamp with time zone))
  Index Searches: 1
  Buffers: shared hit=12 read=2</code></pre>
<p>And the wall clock for example 1, measured from Go over a local connection (one laptop run, rounded; this includes the round trip, so the gap inside the database is larger):</p>
<pre><code>--- PASS: TestTiming
    seq scan 1.914ms, index 61µs per query, 31x faster</code></pre>

<p><strong>Real-world scenario.</strong> An orders table reaches 40 M rows. The "order history" page runs <code>WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 20</code> and drifts from 30 ms to 2.4 s as the table grows. The only usable index is on <code>created_at</code>, so Postgres walks the newest orders backwards and filters for the customer; for someone whose last order was months ago, that is millions of entries. <code>EXPLAIN (ANALYZE, BUFFERS)</code> shows <code>Index Scan Backward using orders_created_at_idx</code> with a huge <code>Rows Removed by Filter</code>. <code>CREATE INDEX CONCURRENTLY … (customer_id, created_at)</code> brings the page to a few milliseconds, since each lookup now reads about 20 entries. An old index on <code>customer_id</code> alone is now a redundant prefix and gets dropped, saving a write on every insert.</p>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>Every index taxes every write.</strong> An <code>INSERT</code> into a table with 8 indexes does 9 tree updates and writes WAL for each. Updates that change an indexed column do the same. (PostgreSQL's HOT updates can skip index work only when no indexed column changes and the new row version fits on the same page.) Index what queries need, not every column "just in case".</li>
  <li><strong>Unused and duplicate indexes.</strong> They cost writes, disk, cache memory and vacuum time for nothing. Check <code>pg_stat_user_indexes.idx_scan</code> across a full business cycle (month-end jobs!) and on replicas too, since stats are per server. Drop indexes that are a leftmost prefix of another one.</li>
  <li><strong>Wrong column order.</strong> <code>(created_at, customer_id)</code> doesn't serve "one customer's recent orders". Write the query first, then build the index for its equality and sort columns.</li>
  <li><strong>Low selectivity.</strong> An index on a boolean or a status with 3 values is skipped for the common values, correctly. Use a partial index for the rare value, or put the column second in a composite index.</li>
  <li><strong>Functions and casts hide the index.</strong> <code>WHERE lower(email) = …</code>, <code>WHERE created_at::date = …</code>, <code>WHERE name LIKE '%son'</code> can't use a plain B-tree. See <a href="#query-optimization">Query Optimization</a>.</li>
  <li><strong>Creating an index locks writes.</strong> A plain <code>CREATE INDEX</code> blocks inserts, updates and deletes on the table until it finishes, which can be many minutes on a big table. On live tables use <code>CREATE INDEX CONCURRENTLY</code>, and check it succeeded: a failed run leaves an <code>INVALID</code> index behind. See <a href="#database-migrations">Database Migrations</a>.</li>
  <li><strong>Bloat and stale visibility maps.</strong> Heavy updates leave dead index entries, and keep the visibility map unset, so "index-only" scans show high <code>Heap Fetches</code>. Tune autovacuum for that table; a badly bloated index may need <code>REINDEX CONCURRENTLY</code>.</li>
</ul>
<pre><code>-- indexes never used for a scan since stats were last reset
SELECT s.relname AS table, s.indexrelname AS index,
       pg_size_pretty(pg_relation_size(s.indexrelid)) AS size, s.idx_scan
FROM pg_stat_user_indexes s
JOIN pg_index i ON i.indexrelid = s.indexrelid
WHERE s.idx_scan = 0 AND NOT i.indisunique
ORDER BY pg_relation_size(s.indexrelid) DESC;</code></pre>

<div class="callout warn"><strong>Test on production-sized data.</strong> On a 500-row dev table every query is a fast seq scan and the planner ignores your index. Plans change with table size and data distribution, so check <code>EXPLAIN</code> on a copy with realistic volume, or on a replica.</div>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>An index is a sorted tree of column values pointing at rows. It turns a full scan into a few page reads and can return rows pre-sorted.</li>
  <li>Design composite indexes from the query: equality columns first, then the range or <code>ORDER BY</code> column. Covering indexes (<code>INCLUDE</code>) can skip the table entirely.</li>
  <li>Partial, expression and unique indexes solve specific problems: rare values, computed lookups, and constraints that must hold under concurrency.</li>
  <li>Indexes cost writes, storage and vacuum. Measure with <code>EXPLAIN (ANALYZE, BUFFERS)</code> and drop what <code>pg_stat_user_indexes</code> says is unused.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#query-optimization">Query Optimization</a> · <a href="#n-1-queries">N+1 Queries</a> · <a href="#partitioning">Partitioning</a> · <a href="#database-migrations">Database Migrations</a> · <a href="#race-conditions">Race Conditions</a> · <a href="#real-world-data-layer">Real-World Data Layer</a></p>
`;
CONTENT["query-optimization"] = `
<p class="tldr"><strong>TL;DR</strong>: Query optimization is a loop: find the queries that cost the most in total, read their execution plan, change one thing (an index, a rewrite, fresh statistics), and measure again. Most wins come from a few repeat offenders: predicates the database can't match to an index, deep <code>OFFSET</code> pagination, fetching too much, and planner estimates that are far from reality. Think of the plan as the database's receipt: it shows exactly where the work went.</p>

<h2>The problem it solves</h2>
<p>SQL says <em>what</em> you want, not <em>how</em> to get it. The <strong>planner</strong> picks the how: which index, which join order, which join algorithm. It does that from statistics about your data, and it is usually right. When it's wrong, or when the query is written so that no good plan exists, one endpoint goes from 5 ms to 5 s, the database CPU sits at 90%, and every other query slows down with it.</p>
<p>Guessing doesn't work here. Adding indexes at random costs writes and often changes nothing. "Rewrite it in a faster way" often produces the same plan. The cure is a disciplined workflow that always starts from measured data and ends with a re-measurement.</p>

<h2>How it works</h2>
<figure class="diagram">
<svg viewBox="0 0 780 150" role="img" aria-label="The optimization loop. Step 1, find the expensive queries with pg_stat_statements or the slow query log. Step 2, read the plan with EXPLAIN ANALYZE and BUFFERS. Step 3, fix one thing: an index, a rewrite, or ANALYZE. Step 4, re-measure the plan and p99 in production. Then loop back to the next most expensive query.">
  <defs><marker id="arr-qo-1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <rect class="box accent" x="20" y="20" width="165" height="64" rx="8"/>
  <text x="102" y="42" text-anchor="middle" class="title">1. Find</text>
  <text x="102" y="60" text-anchor="middle" class="small">pg_stat_statements,</text>
  <text x="102" y="75" text-anchor="middle" class="small">slow query log</text>
  <rect class="box" x="215" y="20" width="165" height="64" rx="8"/>
  <text x="297" y="42" text-anchor="middle" class="title">2. Read the plan</text>
  <text x="297" y="60" text-anchor="middle" class="small">EXPLAIN (ANALYZE,</text>
  <text x="297" y="75" text-anchor="middle" class="small">BUFFERS) on real data</text>
  <rect class="box" x="410" y="20" width="165" height="64" rx="8"/>
  <text x="492" y="42" text-anchor="middle" class="title">3. Fix one thing</text>
  <text x="492" y="60" text-anchor="middle" class="small">index, rewrite,</text>
  <text x="492" y="75" text-anchor="middle" class="small">ANALYZE, less data</text>
  <rect class="box ok" x="605" y="20" width="155" height="64" rx="8"/>
  <text x="682" y="42" text-anchor="middle" class="title">4. Re-measure</text>
  <text x="682" y="60" text-anchor="middle" class="small">same plan check, then</text>
  <text x="682" y="75" text-anchor="middle" class="small">p99 in production</text>
  <path class="line" d="M187 52 H213" marker-end="url(#arr-qo-1)"/>
  <path class="line" d="M382 52 H408" marker-end="url(#arr-qo-1)"/>
  <path class="line" d="M577 52 H603" marker-end="url(#arr-qo-1)"/>
  <path class="line dashed" d="M682 86 V118 H102 V88" marker-end="url(#arr-qo-1)"/>
  <text x="390" y="136" text-anchor="middle" class="small">next most expensive query (total time, not just the slowest single call)</text>
</svg>
<figcaption>Change one thing at a time. If you add an index and rewrite the query together, you won't know which one helped, or which one made the other query slower.</figcaption>
</figure>

<h3>Step 1: find the queries that matter</h3>
<p>Rank by <strong>total</strong> time, not by the slowest single call. A 2 ms query that runs 50,000 times a minute costs more than a 3 s report that runs once an hour. In PostgreSQL the <code>pg_stat_statements</code> extension groups queries by shape (constants are replaced with <code>$1</code>, <code>$2</code>) and tracks <code>calls</code>, <code>total_exec_time</code>, <code>mean_exec_time</code>, <code>rows</code> and buffer counts per shape:</p>
<pre><code>-- needs shared_preload_libraries = 'pg_stat_statements' and CREATE EXTENSION
SELECT calls,
       round(total_exec_time) AS total_ms,
       round(mean_exec_time::numeric, 2) AS mean_ms,
       rows,
       left(query, 80) AS query
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 10;</code></pre>
<p>Other sources: <code>log_min_duration_statement</code> logs every statement slower than a threshold (it is off, <code>-1</code>, by default), the <code>auto_explain</code> module logs the plan of slow statements, and MySQL has the slow query log (off by default; <code>long_query_time</code> defaults to 10 s, far too high for a web app). APM and <a href="#distributed-tracing">tracing</a> show which endpoint the query belongs to.</p>

<h3>Step 2: read the plan</h3>
<p><code>EXPLAIN</code> shows the plan the planner chose, with its estimates. <code>EXPLAIN ANALYZE</code> also <em>runs</em> the query and adds what actually happened. (It really executes: wrap an <code>UPDATE</code> or <code>DELETE</code> in <code>BEGIN … ROLLBACK</code>.) Add <code>BUFFERS</code> to see pages touched; since PostgreSQL 18 it is on by default with <code>ANALYZE</code>. A plan is a tree. Each node pulls rows from its children, so read it from the most indented node outwards.</p>
<figure class="diagram">
<svg viewBox="0 0 780 150" role="img" aria-label="One plan line taken apart. Seq Scan on users is the node type. cost equals 0.00 to 2334.00 is the planner's estimate in arbitrary units, startup then total. rows equals 500 is the estimated row count. width equals 8 is the average row size in bytes. actual rows equals 1.00 is the measured row count per loop. loops equals 1 is how many times the node ran. A red bracket links rows 500 and actual rows 1: a 500 times misestimate.">
  <path class="line bad" d="M365 42 V28 H575 V42"/>
  <text x="470" y="20" text-anchor="middle" class="small">estimate 500 vs actual 1: big gaps here lead to bad plan choices</text>
  <rect class="box" x="10" y="44" width="140" height="32" rx="5"/><text x="80" y="65" text-anchor="middle">Seq Scan on users</text>
  <rect class="box" x="160" y="44" width="150" height="32" rx="5"/><text x="235" y="65" text-anchor="middle">cost=0.00..2334.00</text>
  <rect class="box bad" x="320" y="44" width="90" height="32" rx="5"/><text x="365" y="65" text-anchor="middle">rows=500</text>
  <rect class="box" x="420" y="44" width="80" height="32" rx="5"/><text x="460" y="65" text-anchor="middle">width=8</text>
  <rect class="box bad" x="510" y="44" width="130" height="32" rx="5"/><text x="575" y="65" text-anchor="middle">actual rows=1.00</text>
  <rect class="box" x="650" y="44" width="80" height="32" rx="5"/><text x="690" y="65" text-anchor="middle">loops=1</text>
  <path class="line" d="M80 76 V96"/><path class="line" d="M235 76 V96"/><path class="line" d="M365 76 V96"/>
  <path class="line" d="M460 76 V96"/><path class="line" d="M575 76 V96"/><path class="line" d="M690 76 V96"/>
  <text x="80" y="110" text-anchor="middle" class="small">node type: how</text><text x="80" y="124" text-anchor="middle" class="small">rows are produced</text>
  <text x="235" y="110" text-anchor="middle" class="small">estimated cost,</text><text x="235" y="124" text-anchor="middle" class="small">startup..total</text>
  <text x="365" y="110" text-anchor="middle" class="small">estimated</text><text x="365" y="124" text-anchor="middle" class="small">rows</text>
  <text x="460" y="110" text-anchor="middle" class="small">avg bytes</text><text x="460" y="124" text-anchor="middle" class="small">per row</text>
  <text x="575" y="110" text-anchor="middle" class="small">measured rows</text><text x="575" y="124" text-anchor="middle" class="small">per loop</text>
  <text x="690" y="110" text-anchor="middle" class="small">times run;</text><text x="690" y="124" text-anchor="middle" class="small">total = rows × loops</text>
</svg>
<figcaption>The first line of the real plan from the example below. Cost is in arbitrary planner units, not milliseconds. With timing on, you also get <code>actual time=startup..total</code> in ms, per loop.</figcaption>
</figure>
<p>What to look for, in order:</p>
<ol>
  <li><strong>Where the time or buffers go.</strong> Find the node with the largest actual time or <code>Buffers</code>. Times include children, so subtract to find the node's own work. Remember to multiply by <code>loops</code>.</li>
  <li><strong>Estimated vs actual rows.</strong> A 10× or larger gap means the planner was working from wrong numbers. It may have chosen a nested loop for what it thought was 1 row and got 200,000. Fix the estimate (statistics) before you fight the plan.</li>
  <li><strong>Wasted work.</strong> <code>Rows Removed by Filter</code> in the hundreds of thousands, an <code>Index Scan</code> whose actual rows dwarf the <code>Limit</code>, or a <code>Sort</code> with <code>Sort Method: external merge  Disk: …</code> (it spilled past <code>work_mem</code>).</li>
</ol>
<table>
  <tr><th>Node</th><th>What it does</th><th>Good when</th><th>Warning sign</th></tr>
  <tr><td><code>Seq Scan</code></td><td>Reads every page of the table</td><td>Small tables, or the query needs a large fraction of rows</td><td>Big table, few rows returned, large <code>Rows Removed by Filter</code></td></tr>
  <tr><td><code>Index Scan</code></td><td>Walks the index, fetches each row from the table</td><td>Few rows, or rows wanted in index order</td><td>Many rows: random page reads add up</td></tr>
  <tr><td><code>Index Only Scan</code></td><td>Answers from the index alone</td><td>All needed columns are in the index</td><td>High <code>Heap Fetches</code> (visibility map not set)</td></tr>
  <tr><td><code>Bitmap Heap Scan</code></td><td>Collects matching row locations, then reads pages in physical order</td><td>A medium number of rows; combining indexes (<code>BitmapOr</code>/<code>BitmapAnd</code>)</td><td><code>Heap Blocks: lossy</code> (bitmap outgrew <code>work_mem</code>)</td></tr>
  <tr><td><code>Nested Loop</code></td><td>For each outer row, look up matching inner rows</td><td>Small outer side and an index on the inner join key</td><td>Outer side much bigger than estimated; inner side is a seq scan</td></tr>
  <tr><td><code>Hash Join</code></td><td>Builds a hash table from one side, probes with the other</td><td>Large unsorted inputs, equality joins</td><td><code>Batches</code> &gt; 1: the hash table spilled to disk</td></tr>
  <tr><td><code>Merge Join</code></td><td>Walks two inputs sorted on the join key</td><td>Both sides already sorted (e.g. from indexes)</td><td>An expensive explicit <code>Sort</code> beneath it</td></tr>
</table>

<h3>Step 3: the usual fixes</h3>
<p>Most slow queries fall into a handful of patterns. A predicate is <strong>sargable</strong> (from "Search ARGument ABLE") when the database can turn it into an index range, which needs the bare column on one side of a comparison. Index design itself (column order, covering, partial indexes) is covered in <a href="#database-indexing">Database Indexing</a>.</p>
<table>
  <tr><th>Pattern</th><th>Why it's slow</th><th>Fix</th></tr>
  <tr><td>Function on the column: <code>lower(email) = $1</code>, <code>date(created_at) = $1</code></td><td>The index stores <code>email</code>, not <code>lower(email)</code>. Seq scan, and no statistics for the expression, so estimates are guesses.</td><td>Expression index on <code>lower(email)</code>, a <code>citext</code> column, or rewrite as a range on the bare column.</td></tr>
  <tr><td>Leading wildcard: <code>name LIKE '%son'</code></td><td>A B-tree is sorted by prefix; an unknown prefix means scanning everything.</td><td>Trigram GIN index (<code>pg_trgm</code>) or full-text search. <code>LIKE 'son%'</code> can use a B-tree (C collation or <code>text_pattern_ops</code>).</td></tr>
  <tr><td>Type mismatch: string column vs number, <code>int</code> column vs <code>numeric</code> literal</td><td>The column gets cast, which is the function case again. MySQL's docs say a string column compared to a number can't use its index.</td><td>Send parameters of the column's type. Watch ORMs and drivers that bind everything as one type.</td></tr>
  <tr><td><code>OFFSET 50000 LIMIT 20</code></td><td>The database produces and discards 50,000 rows to return 20. Deeper pages get linearly slower.</td><td>Keyset pagination: <code>WHERE (created_at, id) &lt; ($1, $2) ORDER BY created_at DESC, id DESC LIMIT 20</code>.</td></tr>
  <tr><td><code>SELECT *</code></td><td>Reads and ships columns nobody uses (large <code>text</code>/<code>jsonb</code> values are stored out of line and must be fetched), and blocks index-only scans.</td><td>Select the columns you need.</td></tr>
  <tr><td>Stale or missing statistics</td><td>After a bulk load or a big delete, estimates are far off and the planner picks the wrong join or scan.</td><td>Run <code>ANALYZE table</code> after bulk changes; raise the column's statistics target for skewed data; extended statistics (<code>CREATE STATISTICS</code>) for correlated columns.</td></tr>
  <tr><td><code>OR</code> across different columns</td><td>One index can't serve <code>a = $1 OR b = $2</code>. PostgreSQL can combine two indexes with <code>BitmapOr</code>; MySQL and complex cases often fall back to a scan.</td><td>Index each column; if the plan still scans, rewrite as <code>UNION</code> (or <code>UNION ALL</code> if duplicates are impossible) of two indexed queries.</td></tr>
  <tr><td>Correlated subquery per row</td><td>Runs the inner query once per outer row (watch <code>loops=</code>).</td><td>Rewrite as a <code>JOIN</code>, <code>EXISTS</code>, or a <code>LATERAL</code> join with an index on the inner key.</td></tr>
  <tr><td>Many small queries instead of one</td><td>Not slow per query; slow per request. Round trips add up.</td><td>See <a href="#n-1-queries">N+1 Queries</a>.</td></tr>
</table>
<pre><code>-- function on the column: the index on created_at can't be used
WHERE date(created_at) = '2026-03-01'
-- sargable: a range on the bare column
WHERE created_at &gt;= '2026-03-01' AND created_at &lt; '2026-03-02'

-- OFFSET: reads and throws away 50,000 rows
ORDER BY created_at DESC, id DESC LIMIT 20 OFFSET 50000
-- keyset: continue after the last row the client saw (tie-break on id)
WHERE (created_at, id) &lt; ($1, $2)
ORDER BY created_at DESC, id DESC LIMIT 20</code></pre>
<p>Keyset pagination has trade-offs: the client can't jump to "page 2,501", only to "next" and "previous", and the sort key must be unique (add <code>id</code> as a tie-breaker), with an index matching the <code>ORDER BY</code>. For infinite scroll and APIs, that is what you want anyway.</p>

<h2>Example</h2>
<p><strong>Two fixes, measured on a real PostgreSQL 18.</strong> The test starts PostgreSQL with <code>embedded-postgres</code> and loads 100,000 users with mixed-case emails (<code>User4242@Example.com</code>), with a plain index on <code>email</code>. Actual timings are switched off so the plans print the same on every run; they are pinned as <code>// Output:</code> blocks and checked by <code>go test</code>. The setup file is omitted.</p>
<pre><code>package queryopt

import (
	"fmt"
	"strings"
	"testing"
	"time"
)

// plan prints EXPLAIN ANALYZE. Estimated costs stay on (they are stable
// here); actual timings are off so the output is the same on every run.
func plan(query string, args ...any) {
	rows, err := db.Query(ctx, "EXPLAIN (ANALYZE, BUFFERS, TIMING OFF, SUMMARY OFF) "+query, args...)
	if err != nil {
		panic(err)
	}
	defer rows.Close()
	for rows.Next() {
		var line string
		rows.Scan(&amp;line)
		if strings.HasPrefix(line, "Planning") {
			break
		}
		fmt.Println(line)
	}
}

// Fix 1: a function on the column hides the index on email.
func Example_nonSargable() {
	q := &#96;SELECT id FROM users WHERE lower(email) = 'user4242@example.com'&#96;
	fmt.Println("-- index on email, query on lower(email)")
	plan(q)

	must(&#96;CREATE INDEX users_email_lower_idx ON users (lower(email))&#96;)
	must(&#96;ANALYZE users&#96;) // collects statistics for the expression too
	fmt.Println("-- after an expression index on lower(email)")
	plan(q)
}

// Fix 2: page 2,501 of a list, 20 rows per page.
func Example_offsetVsKeyset() {
	fmt.Println("-- OFFSET 50000")
	plan(&#96;SELECT id, email FROM users ORDER BY id LIMIT 20 OFFSET 50000&#96;)

	fmt.Println("-- keyset: id after the last row of the previous page")
	plan(&#96;SELECT id, email FROM users WHERE id &gt; $1 ORDER BY id LIMIT 20&#96;, 50000)
}

// buffers returns the pages the whole query touched (top plan node).
func buffers(query string, args ...any) int {
	var line string
	rows, _ := db.Query(ctx, "EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) "+query, args...)
	defer rows.Close()
	for rows.Next() {
		rows.Scan(&amp;line)
		if _, after, ok := strings.Cut(line, "Buffers: shared hit="); ok {
			var n int
			fmt.Sscan(after, &amp;n)
			return n
		}
	}
	return -1
}

// How the cost of one page grows with depth.
func Example_pageDepth() {
	fmt.Println("depth   OFFSET  keyset   (8 KB pages touched)")
	for _, depth := range []int{0, 20000, 40000, 60000, 80000} {
		off := buffers(&#96;SELECT id, email FROM users ORDER BY id LIMIT 20 OFFSET $1&#96;, depth)
		key := buffers(&#96;SELECT id, email FROM users WHERE id &gt; $1 ORDER BY id LIMIT 20&#96;, depth)
		fmt.Printf("%5d  %7d  %6d&#92;n", depth, off, key)
	}
}

// Wall clock for page depth 80,000 (laptop run, rounded).
func TestTiming(t *testing.T) {
	avg := func(q string) time.Duration {
		const n = 300
		var start time.Time
		for i := range n + 30 { // first 30 are warm-up
			if i == 30 {
				start = time.Now()
			}
			must2(q, 80000)
		}
		return time.Since(start) / n
	}
	off := avg(&#96;SELECT id, email FROM users ORDER BY id LIMIT 20 OFFSET $1&#96;)
	key := avg(&#96;SELECT id, email FROM users WHERE id &gt; $1 ORDER BY id LIMIT 20&#96;)
	t.Logf("OFFSET %v, keyset %v per page", off.Round(10*time.Microsecond), key.Round(10*time.Microsecond))
}</code></pre>
<p>Real output of fix 1. Before: a seq scan over 834 pages to find 1 row. Note <code>rows=500</code>: the planner has no statistics for <code>lower(email)</code>, so it falls back to a default guess. After the expression index and <code>ANALYZE</code>, the estimate is exactly 1 and the query reads 4 pages.</p>
<pre><code>-- index on email, query on lower(email)
Seq Scan on users  (cost=0.00..2334.00 rows=500 width=8) (actual rows=1.00 loops=1)
  Filter: (lower(email) = 'user4242@example.com'::text)
  Rows Removed by Filter: 99999
  Buffers: shared hit=834
-- after an expression index on lower(email)
Index Scan using users_email_lower_idx on users  (cost=0.42..8.44 rows=1 width=8) (actual rows=1.00 loops=1)
  Index Cond: (lower(email) = 'user4242@example.com'::text)
  Index Searches: 1
  Buffers: shared hit=1 read=3</code></pre>
<p>Fix 2. Both queries return the same 20 rows. <code>OFFSET</code> walks 50,020 index entries (<code>actual rows=50020.00</code> under the <code>Limit</code>) and touches 555 pages. Keyset jumps straight to <code>id &gt; 50000</code> and touches 3.</p>
<pre><code>-- OFFSET 50000
Limit  (cost=1720.79..1721.48 rows=20 width=29) (actual rows=20.00 loops=1)
  Buffers: shared hit=555
  -&gt;  Index Scan using users_pkey on users  (cost=0.29..3441.29 rows=100000 width=29) (actual rows=50020.00 loops=1)
        Index Searches: 1
        Buffers: shared hit=555
-- keyset: id after the last row of the previous page
Limit  (cost=0.29..1.03 rows=20 width=29) (actual rows=20.00 loops=1)
  Buffers: shared hit=3
  -&gt;  Index Scan using users_pkey on users  (cost=0.29..1847.29 rows=50000 width=29) (actual rows=20.00 loops=1)
        Index Cond: (id &gt; '50000'::bigint)
        Index Searches: 1
        Buffers: shared hit=3</code></pre>
<p>Repeating that at different depths shows the shape of the problem:</p>
<pre><code>depth   OFFSET  keyset   (8 KB pages touched)
    0        3       3
20000      223       3
40000      445       3
60000      666       3
80000      887       3</code></pre>
<figure class="diagram">
<svg viewBox="0 0 780 300" role="img" aria-label="Chart of pages touched against page depth, from the real output. OFFSET grows in a straight line from 3 pages at depth 0 to 887 pages at depth 80,000. Keyset stays at 3 pages at every depth.">
  <text x="80" y="22" class="small">8 KB pages touched per request</text>
  <path class="line" d="M80 30 V240 H745"/>
  <text x="70" y="244" text-anchor="end" class="small">0</text>
  <text x="70" y="177" text-anchor="end" class="small">300</text>
  <text x="70" y="111" text-anchor="end" class="small">600</text>
  <text x="70" y="44" text-anchor="end" class="small">900</text>
  <path class="line dashed" d="M80 173 H745 M80 107 H745 M80 40 H745" style="stroke: var(--line)"/>
  <text x="80" y="258" text-anchor="middle" class="small">0</text>
  <text x="245" y="258" text-anchor="middle" class="small">20,000</text>
  <text x="410" y="258" text-anchor="middle" class="small">40,000</text>
  <text x="575" y="258" text-anchor="middle" class="small">60,000</text>
  <text x="740" y="258" text-anchor="middle" class="small">80,000</text>
  <text x="410" y="284" text-anchor="middle" class="small">page depth (rows skipped before the 20 you want)</text>
  <path class="line bad" d="M80 239 L245 190 L410 141 L575 92 L740 43"/>
  <circle class="box bad" cx="80" cy="239" r="4"/><circle class="box bad" cx="245" cy="190" r="4"/><circle class="box bad" cx="410" cy="141" r="4"/><circle class="box bad" cx="575" cy="92" r="4"/><circle class="box bad" cx="740" cy="43" r="4"/>
  <text x="560" y="62" text-anchor="end">OFFSET: 887 pages at depth 80,000</text>
  <path class="line ok" d="M80 239 H740"/>
  <text x="740" y="228" text-anchor="end">keyset: 3 pages at every depth</text>
</svg>
<figcaption>Real numbers from <code>Example_pageDepth</code>. OFFSET cost is linear in depth; keyset cost is the depth of the B-tree plus one leaf.</figcaption>
</figure>
<p>Wall clock at depth 80,000, measured from Go over a local connection (one laptop run, rounded):</p>
<pre><code>--- PASS: TestTiming
    OFFSET 3.4ms, keyset 60µs per page</code></pre>

<p><strong>Real-world scenario.</strong> A support dashboard lists tickets with <code>ORDER BY created_at DESC LIMIT 50 OFFSET $1</code> and a lookup that runs <code>WHERE lower(requester_email) = lower($1)</code>. With 3 M tickets, <code>pg_stat_statements</code> puts the list query at the top by total time, not because one call is slow but because an export job pages through all 60,000 pages, each deeper than the last. Its mean time is 400 ms and rising. <code>EXPLAIN ANALYZE</code> on a deep page shows an index scan returning hundreds of thousands of rows under a <code>Limit</code> of 50. Switching the export job to keyset pagination (continue after the last <code>(created_at, id)</code>) makes every page cost the same few milliseconds. The lookup shows a <code>Seq Scan</code> with an estimate of thousands of rows and an actual of 12; an expression index on <code>lower(requester_email)</code> turns it into an index scan. Re-checking <code>pg_stat_statements</code> a day later (after <code>pg_stat_statements_reset()</code>) confirms both left the top 10.</p>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>Optimizing on a toy database.</strong> On 1,000 rows every plan is a seq scan and every query takes 1 ms. Plans depend on table size and data distribution, so test on production-like volume, or run <code>EXPLAIN</code> on a replica.</li>
  <li><strong>Trusting plain <code>EXPLAIN</code>.</strong> It shows estimates only. If the estimate is wrong, the plan you are reading is not what's slow. Use <code>ANALYZE</code> and compare estimated with actual rows.</li>
  <li><strong>Reading cost as time.</strong> Cost is in arbitrary planner units and only compares plans for the same query. Look at actual time and buffers.</li>
  <li><strong>Measuring a warm cache only.</strong> The second run is served from memory. <code>Buffers: shared read=</code> tells you how much came from outside PostgreSQL's cache; production may be colder than your laptop.</li>
  <li><strong>Fighting the planner instead of fixing its inputs.</strong> PostgreSQL has no built-in query hints by design. Disabling plan types with <code>enable_seqscan = off</code> is a diagnostic, not a fix. Fix statistics, the predicate or the index.</li>
  <li><strong>Prepared statements and generic plans.</strong> After five executions, PostgreSQL may switch a prepared statement to a generic plan that ignores the actual parameter values. With very skewed data (one tenant owns half the rows) that plan can be bad for some values. <code>plan_cache_mode</code> controls it.</li>
  <li><strong>Fixing the slowest query instead of the most expensive.</strong> Rank by total time and by p99 of the endpoint, not by the single worst call.</li>
</ul>

<div class="callout warn"><strong><code>EXPLAIN ANALYZE</code> executes the statement.</strong> On an <code>UPDATE</code>, <code>DELETE</code> or <code>INSERT</code> it changes data for real. Wrap it in <code>BEGIN; EXPLAIN ANALYZE …; ROLLBACK;</code>, and be careful running heavy queries on the primary during peak traffic.</div>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>Work in a loop: find by total time, read the plan, change one thing, re-measure.</li>
  <li>In a plan, look for where buffers and time go, for big gaps between estimated and actual rows, and for rows read and then thrown away.</li>
  <li>Keep predicates sargable: bare column, matching types, no leading wildcard. Use expression indexes when you must match on a computed value.</li>
  <li>Replace deep <code>OFFSET</code> with keyset pagination, select only the columns you need, and keep statistics fresh after bulk changes.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#database-indexing">Database Indexing</a> · <a href="#n-1-queries">N+1 Queries</a> · <a href="#connection-pooling">Connection Pooling</a> · <a href="#p99-latency">p99 Latency</a> · <a href="#distributed-tracing">Distributed Tracing</a> · <a href="#real-world-data-layer">Real-World Data Layer</a></p>
`;
CONTENT["n-1-queries"] = `
<p class="tldr"><strong>TL;DR</strong>: An N+1 query problem is one query to load a list, then one more query <em>per item</em> to load something related: 1 + N round trips where 1 or 2 would do. Each query is fast, so nothing looks slow in isolation, but 100 rows means 101 round trips. It is like a waiter who walks to the kitchen once per dish instead of carrying the whole order on one tray.</p>

<h2>The problem it solves</h2>
<p>Here's the shape of the bug. A page shows a customer's last 100 orders with their line items. The code loads the orders, then loops over them and loads each order's items:</p>
<ul>
  <li>1 query: <code>SELECT … FROM orders WHERE customer_id = 7</code> returns 100 rows.</li>
  <li>N queries: <code>SELECT … FROM items WHERE order_id = ?</code>, once per order. That's 100 more.</li>
</ul>
<p>Each item query takes well under a millisecond inside the database. The cost is everything around it: a network round trip, driver and protocol overhead, parsing and planning on the server, and a connection held from the pool for the whole loop. If one round trip costs 1 ms (a database in another availability zone, or a busy proxy in between), the page spends at least 101 ms on the wire before the database does any real work. The batched version spends 2 ms.</p>
<p>It is easy to miss because it scales with data, not with code. In development a customer has 3 orders: 4 queries, nobody notices. In production a big customer has 500, and the same endpoint makes 501 queries, holds a connection for half a second, and starves the pool for everyone else (see <a href="#connection-pooling">Connection Pooling</a>).</p>

<h2>How it works</h2>
<figure class="diagram">
<svg viewBox="0 0 780 340" role="img" aria-label="Two sequence diagrams. On the left, N+1: the app sends one query for the orders, then a separate query for the items of order 1, order 2, order 3 and so on up to order 100, each waiting for its own round trip: 101 round trips. On the right, batched: the app sends one query for the orders and one query for all items with order_id in the list of 100 ids: 2 round trips.">
  <defs><marker id="arr-n1-1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <text x="200" y="20" text-anchor="middle" class="title">N+1: 1 + 100 queries</text>
  <text x="580" y="20" text-anchor="middle" class="title">Batched: 2 queries</text>
  <path class="line dashed" d="M390 8 V330" style="stroke: var(--line)"/>

  <rect class="box" x="40" y="32" width="80" height="26" rx="5"/><text x="80" y="50" text-anchor="middle">app</text>
  <rect class="box" x="280" y="32" width="80" height="26" rx="5"/><text x="320" y="50" text-anchor="middle">database</text>
  <path class="line" d="M80 58 V290" style="stroke: var(--line)"/>
  <path class="line" d="M320 58 V290" style="stroke: var(--line)"/>
  <text x="200" y="78" text-anchor="middle" class="small">SELECT orders: 100 rows</text>
  <path class="line accent" d="M82 84 H316" marker-end="url(#arr-n1-1)"/>
  <path class="line dashed" d="M318 94 H84" marker-end="url(#arr-n1-1)"/>
  <text x="200" y="122" text-anchor="middle" class="small">items WHERE order_id = 1</text>
  <path class="line bad" d="M82 128 H316" marker-end="url(#arr-n1-1)"/>
  <path class="line dashed" d="M318 138 H84" marker-end="url(#arr-n1-1)"/>
  <text x="200" y="160" text-anchor="middle" class="small">items WHERE order_id = 2</text>
  <path class="line bad" d="M82 166 H316" marker-end="url(#arr-n1-1)"/>
  <path class="line dashed" d="M318 176 H84" marker-end="url(#arr-n1-1)"/>
  <text x="200" y="198" text-anchor="middle" class="small">items WHERE order_id = 3</text>
  <path class="line bad" d="M82 204 H316" marker-end="url(#arr-n1-1)"/>
  <path class="line dashed" d="M318 214 H84" marker-end="url(#arr-n1-1)"/>
  <text x="200" y="236" text-anchor="middle" class="small">… 96 more …</text>
  <text x="200" y="262" text-anchor="middle" class="small">items WHERE order_id = 100</text>
  <path class="line bad" d="M82 268 H316" marker-end="url(#arr-n1-1)"/>
  <path class="line dashed" d="M318 278 H84" marker-end="url(#arr-n1-1)"/>
  <rect class="box bad" x="70" y="300" width="260" height="30" rx="5"/>
  <text x="200" y="320" text-anchor="middle">101 round trips, grows with N</text>

  <rect class="box" x="420" y="32" width="80" height="26" rx="5"/><text x="460" y="50" text-anchor="middle">app</text>
  <rect class="box" x="660" y="32" width="80" height="26" rx="5"/><text x="700" y="50" text-anchor="middle">database</text>
  <path class="line" d="M460 58 V290" style="stroke: var(--line)"/>
  <path class="line" d="M700 58 V290" style="stroke: var(--line)"/>
  <text x="580" y="78" text-anchor="middle" class="small">SELECT orders: 100 rows</text>
  <path class="line accent" d="M462 84 H696" marker-end="url(#arr-n1-1)"/>
  <path class="line dashed" d="M698 94 H464" marker-end="url(#arr-n1-1)"/>
  <text x="580" y="122" text-anchor="middle" class="small">items WHERE order_id IN (1 … 100)</text>
  <path class="line ok" d="M462 128 H696" marker-end="url(#arr-n1-1)"/>
  <path class="line dashed" d="M698 138 H464" marker-end="url(#arr-n1-1)"/>
  <text x="580" y="170" text-anchor="middle" class="small">app groups the 300 items</text>
  <text x="580" y="186" text-anchor="middle" class="small">by order_id in a map</text>
  <rect class="box ok" x="450" y="300" width="260" height="30" rx="5"/>
  <text x="580" y="320" text-anchor="middle">2 round trips, whatever N is</text>
</svg>
<figcaption>Both versions return the same 100 orders and 300 items. The work inside the database is similar; the difference is 99 extra round trips, each one waiting for the previous to finish.</figcaption>
</figure>

<h3>How ORMs cause it</h3>
<p>Hand-written loops cause N+1, but ORMs are the classic source, because of <strong>lazy loading</strong>: a relation like <code>order.Items</code> isn't loaded until code touches it, and then the ORM quietly runs a query. A template or serializer that walks a list and reads a relation on each element produces N+1 with no visible query in the code at all. The fix is <strong>eager loading</strong>: tell the ORM up front which relations you need.</p>
<ul>
  <li><strong>GORM</strong>: <code>Preload("Items")</code> runs one extra query per association with <code>WHERE order_id IN (…)</code>. <code>Joins("Customer")</code> loads a has-one or belongs-to relation with a SQL join in the same query; the GORM docs limit join preloading to one-to-one relations.</li>
  <li><strong>ent</strong>: <code>WithItems()</code> on a query eager-loads the <code>items</code> edge. The ent docs explain it runs an extra query per edge rather than one big join, because several edges are often loaded together.</li>
  <li><strong>Other ecosystems</strong>: Rails <code>includes</code>, Django <code>select_related</code> (join) and <code>prefetch_related</code> (separate query), Hibernate/JPA <code>JOIN FETCH</code> and entity graphs. Same idea, different names.</li>
</ul>
<pre><code>// (illustration, not executed here)
// GORM: Preload runs one extra query per association, with an IN list
db.Preload("Items").Where("customer_id = ?", 7).Find(&amp;orders)
//   SELECT * FROM orders WHERE customer_id = 7;
//   SELECT * FROM items WHERE order_id IN (1,2,3,...);

// ent: one eager-load call per edge
orders, err := client.Order.Query().
    Where(order.CustomerID(7)).
    WithItems().
    All(ctx)</code></pre>

<h3>GraphQL and the dataloader pattern</h3>
<p>GraphQL makes N+1 the default: each field has its own resolver, so resolving <code>orders { customer { name } }</code> calls the <code>customer</code> resolver once per order. Resolvers don't know about each other, so you can't simply write a join. The <strong>dataloader</strong> pattern (from Facebook's JavaScript <code>dataloader</code> library) fixes this: each resolver calls <code>loader.Load(customerID)</code>, which only records the key and returns a pending result. The loader collects all keys requested in the same tick of execution (Go ports such as <code>graph-gophers/dataloader</code> use a short wait window), calls one batch function with all of them (<code>WHERE id = ANY($1)</code>), and hands each caller its result. The batch function must return results in the same order and count as the keys. The loader also caches by key, and it is meant to be created <strong>per request</strong>, so one user's cached data never leaks to another and nothing goes stale across requests.</p>

<h3>Detecting it</h3>
<p>N+1 is easy to fix and hard to see. Ways to catch it:</p>
<ul>
  <li><strong>Count queries per request.</strong> Wrap the driver (as in the example) or use your ORM's logger, and log or export "queries per request" as a metric. A list endpoint whose query count grows with page size is N+1.</li>
  <li><strong>Read traces.</strong> In <a href="#distributed-tracing">distributed tracing</a>, N+1 has an unmistakable shape: a staircase of dozens of identical short database spans under one request span.</li>
  <li><strong>Look at the statistics.</strong> In <code>pg_stat_statements</code>, a cheap <code>WHERE order_id = $1</code> query with far more <code>calls</code> than the endpoint has requests, near the top by total time.</li>
  <li><strong>Assert in tests.</strong> A test that runs the endpoint with realistic data (say 50 rows, not 2) and fails if it issues more than a fixed number of queries. That catches regressions when someone adds a field to a serializer six months later.</li>
</ul>

<figure class="diagram">
<svg viewBox="0 0 780 330" role="img" aria-label="Mind map of N+1 queries. Where it hides: ORM lazy loading, loops calling a repository, GraphQL field resolvers, templates and serializers. How to see it: query count per request, a staircase of spans in traces, pg_stat_statements calls far above requests, a query-budget test. Fixes: JOIN, batch with IN or ANY, ORM eager loading, dataloader per request, denormalize or cache. Watch out for: row explosion from joining several children, huge IN lists, loading children nobody displays.">
  <ellipse class="box accent" cx="390" cy="165" rx="78" ry="28"/>
  <text x="390" y="170" text-anchor="middle" class="title">N+1 queries</text>
  <path class="line" d="M330 148 L300 120"/><path class="line" d="M450 148 L480 120"/>
  <path class="line" d="M330 182 L300 210"/><path class="line" d="M450 182 L480 210"/>
  <rect class="box bad" x="20" y="20" width="280" height="130" rx="8"/>
  <text x="160" y="44" text-anchor="middle" class="title">Where it hides</text>
  <text x="160" y="68" text-anchor="middle" class="small">ORM lazy loading of relations</text>
  <text x="160" y="88" text-anchor="middle" class="small">a loop that calls repo.ByID(id)</text>
  <text x="160" y="108" text-anchor="middle" class="small">GraphQL resolvers, one per field</text>
  <text x="160" y="128" text-anchor="middle" class="small">templates and serializers</text>
  <rect class="box accent" x="480" y="20" width="280" height="130" rx="8"/>
  <text x="620" y="44" text-anchor="middle" class="title">How to see it</text>
  <text x="620" y="68" text-anchor="middle" class="small">query count per request (metric, log)</text>
  <text x="620" y="88" text-anchor="middle" class="small">trace: a staircase of short DB spans</text>
  <text x="620" y="108" text-anchor="middle" class="small">pg_stat_statements: calls far above requests</text>
  <text x="620" y="128" text-anchor="middle" class="small">a test with a query budget</text>
  <rect class="box ok" x="20" y="180" width="280" height="130" rx="8"/>
  <text x="160" y="204" text-anchor="middle" class="title">Fixes</text>
  <text x="160" y="228" text-anchor="middle" class="small">JOIN for to-one relations</text>
  <text x="160" y="248" text-anchor="middle" class="small">batch: WHERE id = ANY($1) / IN (…)</text>
  <text x="160" y="268" text-anchor="middle" class="small">ORM eager loading, dataloader</text>
  <text x="160" y="288" text-anchor="middle" class="small">denormalize or cache hot lookups</text>
  <rect class="box" x="480" y="180" width="280" height="130" rx="8"/>
  <text x="620" y="204" text-anchor="middle" class="title">Watch out for</text>
  <text x="620" y="228" text-anchor="middle" class="small">row explosion joining 2+ child lists</text>
  <text x="620" y="248" text-anchor="middle" class="small">IN lists with thousands of ids</text>
  <text x="620" y="268" text-anchor="middle" class="small">eager-loading what nobody displays</text>
  <text x="620" y="288" text-anchor="middle" class="small">a loader shared across requests</text>
</svg>
<figcaption>The fix is rarely hard. The work is in noticing the problem, and in not overcorrecting into one giant join.</figcaption>
</figure>

<h2>Fixes compared</h2>
<table>
  <tr><th>Fix</th><th>Queries</th><th>Best for</th><th>Watch out for</th></tr>
  <tr><td><strong>JOIN</strong></td><td>1</td><td>To-one relations (order → customer): one extra column set per row, no duplication</td><td>To-many relations repeat the parent columns on every child row; two child lists multiply (row explosion)</td></tr>
  <tr><td><strong>Batch by key</strong> (<code>IN (…)</code>, <code>= ANY($1)</code>)</td><td>1 per relation</td><td>To-many relations, any database, hand-written SQL; stitch results in a map</td><td>Very long lists: SQLite caps bound parameters, MySQL caps packet size. Chunk them, or pass one array parameter in PostgreSQL</td></tr>
  <tr><td><strong>ORM eager loading</strong> (<code>Preload</code>, <code>With…</code>)</td><td>1 per relation (or 1 with join preloading)</td><td>Code already on an ORM; the same batch-by-key underneath</td><td>Loading relations "just in case"; nested preloads that pull far more than the page shows</td></tr>
  <tr><td><strong>Dataloader</strong></td><td>1 per relation per tick</td><td>GraphQL and any code where callers don't know about each other</td><td>Must be per request; batch function must keep key order; adds a small wait</td></tr>
  <tr><td><strong>Denormalize or cache</strong></td><td>0 extra</td><td>Hot, rarely changing lookups (customer name on every order row, product titles)</td><td>Now you have to keep copies in sync (see <a href="#cache-invalidation">Cache Invalidation</a>)</td></tr>
  <tr><td><strong>Aggregate in SQL</strong></td><td>1</td><td>You only need counts or sums per parent (<code>GROUP BY order_id</code>), not the children themselves</td><td>Don't load 10,000 rows to count them in Go</td></tr>
</table>

<h3>The counter-pitfall: row explosion</h3>
<p>A JOIN returns one row per combination. Join 100 orders to their items (3 each) and you get 300 rows, each carrying the order's columns again. That is usually fine. Join orders to items <em>and</em> to payments (2 each) in the same query and you get 100 × 3 × 2 = 600 rows, where each item appears twice and each payment three times; the app must de-duplicate, and the database ships far more bytes than with two separate batched queries. For to-many relations, prefer one batched query per relation over a single wide join. GORM's join preloading only covers one-to-one relations, and ent loads each edge with its own query, so neither runs into this.</p>

<h2>Example</h2>
<p><strong>Counting queries with a driver wrapper.</strong> To see N+1, you need a query count. This wraps the real SQLite driver (<code>modernc.org/sqlite</code>, pure Go) with a <code>driver.Connector</code> that counts every statement and sleeps for a configurable round trip, so the test can simulate a database 1 ms away. Because it sits under <code>database/sql</code>, it counts queries from hand-written SQL and from ORMs alike.</p>
<pre><code>package nplus1

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"sync/atomic"
	"time"

	"modernc.org/sqlite"
)

// Counter wraps a real driver: every statement that reaches the database
// is counted and pays a simulated network round trip.
type Counter struct {
	Queries   atomic.Int64
	RoundTrip time.Duration
}

func (c *Counter) hit() {
	c.Queries.Add(1)
	time.Sleep(c.RoundTrip)
}

type connector struct {
	dsn string
	c   *Counter
}

func (k connector) Connect(context.Context) (driver.Conn, error) {
	inner, err := (&amp;sqlite.Driver{}).Open(k.dsn)
	return conn{inner, k.c}, err
}
func (k connector) Driver() driver.Driver { return &amp;sqlite.Driver{} }

type conn struct {
	driver.Conn
	c *Counter
}

func (cn conn) QueryContext(ctx context.Context, q string, args []driver.NamedValue) (driver.Rows, error) {
	cn.c.hit()
	return cn.Conn.(driver.QueryerContext).QueryContext(ctx, q, args)
}

func (cn conn) ExecContext(ctx context.Context, q string, args []driver.NamedValue) (driver.Result, error) {
	cn.c.hit()
	return cn.Conn.(driver.ExecerContext).ExecContext(ctx, q, args)
}

// Open returns a *sql.DB whose statements are counted by c.
func Open(dsn string, c *Counter) *sql.DB {
	return sql.OpenDB(connector{dsn, c})
}</code></pre>
<p>The two ways to load a customer's orders with their items. <code>ListNPlus1</code> is the loop that lazy loading produces; <code>ListBatched</code> fetches all items in one <code>IN</code> query and groups them by <code>order_id</code> in a map.</p>
<pre><code>package nplus1

import (
	"context"
	"database/sql"
	"strings"
)

type Item struct {
	SKU string
	Qty int
}

type Order struct {
	ID    int64
	Total int
	Items []Item
}

// ListNPlus1 is what lazy loading does: 1 query for the orders,
// then 1 more query per order for its items.
func ListNPlus1(ctx context.Context, db *sql.DB, customer int) ([]Order, error) {
	orders, err := listOrders(ctx, db, customer)
	if err != nil {
		return nil, err
	}
	for i := range orders {
		rows, err := db.QueryContext(ctx,
			&#96;SELECT sku, qty FROM items WHERE order_id = ?&#96;, orders[i].ID)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var it Item
			rows.Scan(&amp;it.SKU, &amp;it.Qty)
			orders[i].Items = append(orders[i].Items, it)
		}
		if err := rows.Close(); err != nil {
			return nil, err
		}
	}
	return orders, nil
}

// ListBatched loads all items for all orders in one query and
// stitches them together in memory: always 2 queries.
func ListBatched(ctx context.Context, db *sql.DB, customer int) ([]Order, error) {
	orders, err := listOrders(ctx, db, customer)
	if err != nil || len(orders) == 0 {
		return orders, err
	}
	byID := make(map[int64]*Order, len(orders))
	ids := make([]any, len(orders))
	for i := range orders {
		byID[orders[i].ID] = &amp;orders[i]
		ids[i] = orders[i].ID
	}
	marks := strings.Repeat(",?", len(ids))[1:] // "?,?,?…"
	rows, err := db.QueryContext(ctx,
		&#96;SELECT order_id, sku, qty FROM items WHERE order_id IN (&#96;+marks+&#96;)&#96;, ids...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var it Item
		rows.Scan(&amp;id, &amp;it.SKU, &amp;it.Qty)
		byID[id].Items = append(byID[id].Items, it)
	}
	return orders, rows.Err()
}

func listOrders(ctx context.Context, db *sql.DB, customer int) ([]Order, error) {
	rows, err := db.QueryContext(ctx,
		&#96;SELECT id, total FROM orders WHERE customer_id = ? ORDER BY id&#96;, customer)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Order
	for rows.Next() {
		var o Order
		rows.Scan(&amp;o.ID, &amp;o.Total)
		out = append(out, o)
	}
	return out, rows.Err()
}</code></pre>
<p>In PostgreSQL, pass one array parameter instead of building placeholders:</p>
<pre><code>// PostgreSQL with pgx: one parameter, however many ids (not executed here)
rows, err := pool.Query(ctx,
    &#96;SELECT order_id, sku, qty FROM items WHERE order_id = ANY($1)&#96;, ids) // ids is []int64</code></pre>
<p>The tests. The setup file (create a SQLite database with 100 orders × 3 items for customer 7) is omitted. <code>Example_queryCount</code> pins its output, so <code>go test</code> fails if the counts change. <code>TestOrderListQueryBudget</code> is the kind of regression test worth keeping in a real codebase.</p>
<pre><code>package nplus1

import (
	"context"
	"database/sql"
	"fmt"
	"testing"
	"time"
)

type lister func(context.Context, *sql.DB, int) ([]Order, error)

// Each statement pays a simulated 1 ms round trip, like a database in
// another availability zone.
func Example_queryCount() {
	db, c, done := setup(time.Millisecond)
	defer done()
	for _, v := range []struct {
		name string
		list lister
	}{{"N+1", ListNPlus1}, {"batched", ListBatched}} {
		c.Queries.Store(0)
		orders, err := v.list(ctx, db, 7)
		if err != nil {
			panic(err)
		}
		items := 0
		for _, o := range orders {
			items += len(o.Items)
		}
		n := c.Queries.Load()
		fmt.Printf("%-7s orders=%d items=%d queries=%d time on the wire &gt;= %v&#92;n",
			v.name, len(orders), items, n, time.Duration(n)*c.RoundTrip)
	}
}

// queryBudget runs fn and fails if it issued more than max statements.
func queryBudget(c *Counter, max int64, fn func() error) error {
	c.Queries.Store(0)
	if err := fn(); err != nil {
		return err
	}
	if n := c.Queries.Load(); n &gt; max {
		return fmt.Errorf("%d queries, budget is %d", n, max)
	}
	return nil
}

// A regression test: it fails the build the day someone reintroduces N+1.
func TestOrderListQueryBudget(t *testing.T) {
	db, c, done := setup(0)
	defer done()
	err := queryBudget(c, 2, func() error {
		_, err := ListBatched(ctx, db, 7)
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	// What the same test says about the N+1 version:
	t.Log("N+1:", queryBudget(c, 2, func() error {
		_, err := ListNPlus1(ctx, db, 7)
		return err
	}))
}

// Real wall clock (laptop run, rounded) with the same 1 ms round trip.
func TestWallTime(t *testing.T) {
	db, _, done := setup(time.Millisecond)
	defer done()
	for _, v := range []struct {
		name string
		list lister
	}{{"N+1", ListNPlus1}, {"batched", ListBatched}} {
		start := time.Now()
		v.list(ctx, db, 7)
		t.Logf("%-7s %v", v.name, time.Since(start).Round(time.Millisecond))
	}
}</code></pre>
<p>Real output of <code>Example_queryCount</code>. Same data, same result; 101 queries vs 2:</p>
<pre><code>N+1     orders=100 items=300 queries=101 time on the wire &gt;= 101ms
batched orders=100 items=300 queries=2 time on the wire &gt;= 2ms</code></pre>
<p>Real output of <code>go test -v</code> for the other two tests. The budget test passes for the batched version and reports what it would say about the N+1 one. Wall times are from one laptop run with the simulated 1 ms round trip, rounded; the N+1 version is above its 101 ms floor because <code>time.Sleep</code> overshoots slightly on each of 101 calls:</p>
<pre><code>    nplus1_test.go:64: N+1: 101 queries, budget is 2
--- PASS: TestOrderListQueryBudget (0.02s)
    nplus1_test.go:80: N+1     132ms
    nplus1_test.go:80: batched 3ms
--- PASS: TestWallTime (0.14s)
--- PASS: Example_queryCount (0.13s)</code></pre>

<p><strong>Real-world scenario.</strong> An internal admin API lists invoices, 50 per page. In the first release each invoice row also shows the customer's name, and the code calls <code>customers.ByID</code> inside the loop: 51 queries per page. Nobody notices; the database is in the same zone and the page takes 40 ms. A year later the team moves the database behind a connection proxy in another zone, and each round trip grows to about 1.5 ms. The page now takes around 120 ms, and an export job that walks 20,000 invoices issues 20,000 extra queries and holds a pooled connection for its whole run. The trace shows a staircase of 50 identical <code>SELECT … FROM customers WHERE id = $1</code> spans per page. The fix collects the 50 customer ids, runs one <code>WHERE id = ANY($1)</code>, and builds a map: 2 queries per page whatever the latency is. A query-budget test (at most 3 queries for a 50-row page) keeps it fixed.</p>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>Testing with tiny data.</strong> With 2 rows, N+1 means 3 queries and looks harmless. Seed tests and dev databases with realistic list sizes so the query count shows the pattern.</li>
  <li><strong>Fixing it with one giant JOIN.</strong> Joining several to-many relations multiplies rows (row explosion). Join for to-one relations; batch per relation for to-many ones.</li>
  <li><strong>Unbounded <code>IN</code> lists.</strong> Thousands of placeholders hit driver and database limits, and each different list length is a different statement for the plan cache. Paginate the parent list, chunk the ids, or use one array parameter (<code>= ANY($1)</code>).</li>
  <li><strong>Eager loading everything.</strong> Preloading every relation "to be safe" swaps N+1 for over-fetching: large queries for data the page never shows. Load what the response needs.</li>
  <li><strong>A dataloader that outlives the request.</strong> Its cache then serves stale data, or another user's data. Create loaders per request.</li>
  <li><strong>Forgetting the index on the foreign key.</strong> The batched query <code>WHERE order_id IN (…)</code> still needs an index on <code>items(order_id)</code>, or it becomes one large scan instead of 100 small lookups (see <a href="#database-indexing">Database Indexing</a>).</li>
  <li><strong>Parallelizing the N queries instead.</strong> Firing the 100 queries concurrently hides the latency but takes up to 100 pool connections at once and hammers the database. Batch them instead.</li>
</ul>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>N+1 is 1 query for a list plus 1 per item. Each query is cheap; the round trips add up and hold pool connections.</li>
  <li>ORM lazy loading and GraphQL resolvers cause it silently. Eager loading and per-request dataloaders fix it.</li>
  <li>Fix with a JOIN for to-one relations and one batched <code>IN</code>/<code>ANY</code> query per to-many relation, stitched together in a map.</li>
  <li>Make it visible: count queries per request, read traces, and keep a test that fails when the query count grows with the data.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#query-optimization">Query Optimization</a> · <a href="#connection-pooling">Connection Pooling</a> · <a href="#database-indexing">Database Indexing</a> · <a href="#distributed-tracing">Distributed Tracing</a> · <a href="#caching">Caching</a> · <a href="#real-world-data-layer">Real-World Data Layer</a></p>
`;
CONTENT["connection-pooling"] = `
<p class="tldr"><strong>TL;DR</strong>: Opening a database connection is slow and each one costs the server real memory, so you open a few, keep them, and lend them out query by query. A pool is a taxi rank: cars wait at the stand, passengers take one for a trip and give it back, and when every car is out, the next passenger queues. The pool size is also a <em>limit</em> that protects the database from your own app.</p>

<h2>The problem it solves</h2>
<p>A database connection is not a cheap function call. Before the first query can run, the client and server go through several round trips:</p>
<ul>
  <li><strong>TCP handshake</strong>, then usually a <strong>TLS handshake</strong> (one or two more round trips, plus crypto on both sides).</li>
  <li><strong>Startup and authentication.</strong> Postgres's SCRAM password auth alone is a challenge-response exchange.</li>
  <li><strong>A new server process.</strong> PostgreSQL uses a process-per-connection model: the postmaster forks one backend process for every client connection. That process holds its own memory (caches, sort buffers, catalog cache), whether it is busy or idle.</li>
</ul>
<p>Without a pool, every request pays that setup. In the example below, 200 tiny queries took about 3 s when each opened its own connection, and 26 ms when connections were reused (laptop, localhost, no TLS; a real network makes the gap bigger). The server also has a hard ceiling, <code>max_connections</code>, which defaults to <strong>100</strong> in PostgreSQL. Past it, clients get <code>FATAL: sorry, too many clients already</code>. Raising it doesn't buy throughput: 8 cores run about 8 queries at once, and the rest wait inside the database holding memory and locks.</p>
<p>A connection pool fixes both. It opens connections once, keeps them open, lends one out per query or transaction, and caps the total. When the cap is reached, extra callers wait <em>in your app</em>, where waiting is cheap and has a timeout.</p>

<h2>How it works</h2>
<p>In Go, <code>*sql.DB</code> <em>is</em> the pool. <code>sql.Open</code> doesn't connect to anything; it creates the pool. Each <code>Query</code>, <code>Exec</code> or <code>Begin</code> takes a connection out, and gives it back when the work is done: after <code>Exec</code> returns, after <code>rows.Close()</code> (or the last <code>rows.Next()</code>), after <code>tx.Commit()</code> or <code>tx.Rollback()</code>. That's why you create one <code>*sql.DB</code> per database at startup and share it. Never open one per request.</p>
<figure class="diagram">
<svg viewBox="0 0 780 320" role="img" aria-label="Twenty handler goroutines share a database/sql pool capped at five connections. Handlers 1 to 5 each hold one connection, and each connection maps to one PostgreSQL backend process. Handlers 6 to 20 wait in the pool's wait queue, which increments WaitCount. PostgreSQL's max_connections defaults to 100.">
  <defs><marker id="arr-pool-1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <text x="85" y="62" text-anchor="middle" class="title">Goroutines</text>
  <text x="85" y="78" text-anchor="middle" class="small">HTTP handlers</text>
  <rect class="box" x="20" y="92" width="130" height="162" rx="6"/><text x="85" y="168" text-anchor="middle">handlers 1–5</text><text x="85" y="184" text-anchor="middle" class="small">running a query</text>
  <rect class="box bad" x="20" y="266" width="130" height="32" rx="5"/><text x="85" y="287" text-anchor="middle">handlers 6–20</text>

  <rect class="box muted" x="200" y="40" width="290" height="270" rx="10"/>
  <text x="345" y="62" text-anchor="middle" class="title">*sql.DB pool</text>
  <text x="345" y="78" text-anchor="middle" class="small">SetMaxOpenConns(5)</text>
  <rect class="box accent" x="230" y="92" width="230" height="26" rx="5"/><text x="345" y="110" text-anchor="middle">conn 1 · in use</text>
  <rect class="box accent" x="230" y="126" width="230" height="26" rx="5"/><text x="345" y="144" text-anchor="middle">conn 2 · in use</text>
  <rect class="box accent" x="230" y="160" width="230" height="26" rx="5"/><text x="345" y="178" text-anchor="middle">conn 3 · in use</text>
  <rect class="box accent" x="230" y="194" width="230" height="26" rx="5"/><text x="345" y="212" text-anchor="middle">conn 4 · in use</text>
  <rect class="box accent" x="230" y="228" width="230" height="26" rx="5"/><text x="345" y="246" text-anchor="middle">conn 5 · in use</text>
  <rect class="box bad" x="230" y="266" width="230" height="32" rx="5"/><text x="345" y="287" text-anchor="middle">wait queue (WaitCount += 15)</text>

  <path class="line" d="M150 105 H228" marker-end="url(#arr-pool-1)"/>
  <path class="line" d="M150 139 H228" marker-end="url(#arr-pool-1)"/>
  <path class="line" d="M150 173 H228" marker-end="url(#arr-pool-1)"/>
  <path class="line" d="M150 207 H228" marker-end="url(#arr-pool-1)"/>
  <path class="line" d="M150 241 H228" marker-end="url(#arr-pool-1)"/>
  <path class="line bad dashed" d="M150 282 H228" marker-end="url(#arr-pool-1)"/>

  <rect class="box" x="560" y="40" width="200" height="270" rx="10"/>
  <text x="660" y="62" text-anchor="middle" class="title">PostgreSQL</text>
  <text x="660" y="78" text-anchor="middle" class="small">one OS process per connection</text>
  <rect class="box ok" x="590" y="92" width="140" height="26" rx="5"/><text x="660" y="110" text-anchor="middle">backend 1</text>
  <rect class="box ok" x="590" y="126" width="140" height="26" rx="5"/><text x="660" y="144" text-anchor="middle">backend 2</text>
  <rect class="box ok" x="590" y="160" width="140" height="26" rx="5"/><text x="660" y="178" text-anchor="middle">backend 3</text>
  <rect class="box ok" x="590" y="194" width="140" height="26" rx="5"/><text x="660" y="212" text-anchor="middle">backend 4</text>
  <rect class="box ok" x="590" y="228" width="140" height="26" rx="5"/><text x="660" y="246" text-anchor="middle">backend 5</text>
  <text x="660" y="280" text-anchor="middle" class="small">max_connections = 100</text>
  <text x="660" y="296" text-anchor="middle" class="small">(the default)</text>
  <path class="line" d="M460 105 H588"/>
  <path class="line" d="M460 139 H588"/>
  <path class="line" d="M460 173 H588"/>
  <path class="line" d="M460 207 H588"/>
  <path class="line" d="M460 241 H588"/>
</svg>
<figcaption>The exact situation of the first example below: 20 goroutines, a cap of 5. Five run, fifteen queue inside the app, and the database never sees more than five connections.</figcaption>
</figure>

<h3>The life of a pooled connection</h3>
<p>Each connection moves between a few states, and each of the four knobs controls one transition:</p>
<figure class="diagram">
<svg viewBox="0 0 780 262" role="img" aria-label="Connection lifecycle. A new connection is dialed (TCP, TLS, auth) when no idle connection exists and the pool is under its cap; at the cap, callers wait. It is then in use. Closing rows, committing or closing the conn returns it to idle. An idle connection is reused without a handshake. An idle connection is closed if it sits idle too long or there are too many idle. On release, a connection older than ConnMaxLifetime or broken is closed.">
  <defs><marker id="arr-pool-2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <rect class="box" x="20" y="100" width="120" height="56" rx="8"/><text x="80" y="124" text-anchor="middle" class="title">dial</text><text x="80" y="142" text-anchor="middle" class="small">TCP + TLS + auth</text>
  <text x="80" y="176" text-anchor="middle" class="small">at MaxOpenConns:</text>
  <text x="80" y="190" text-anchor="middle" class="small">wait (WaitCount++)</text>

  <rect class="box accent" x="210" y="100" width="110" height="56" rx="8"/><text x="265" y="124" text-anchor="middle" class="title">in use</text><text x="265" y="142" text-anchor="middle" class="small">Stats().InUse</text>
  <rect class="box ok" x="420" y="100" width="110" height="56" rx="8"/><text x="475" y="124" text-anchor="middle" class="title">idle</text><text x="475" y="142" text-anchor="middle" class="small">Stats().Idle</text>
  <rect class="box bad" x="670" y="100" width="90" height="56" rx="8"/><text x="715" y="133" text-anchor="middle" class="title">closed</text>

  <text x="175" y="96" text-anchor="middle" class="small">none idle,</text>
  <text x="175" y="110" text-anchor="middle" class="small">under cap</text>
  <path class="line" d="M140 128 H208" marker-end="url(#arr-pool-2)"/>

  <path class="line" d="M285 100 Q370 40 455 100" marker-end="url(#arr-pool-2)"/>
  <text x="370" y="60" text-anchor="middle" class="small">rows.Close · tx.Commit · Exec returns</text>
  <path class="line ok" d="M455 156 Q370 216 285 156" marker-end="url(#arr-pool-2)"/>
  <text x="370" y="206" text-anchor="middle" class="small">reused: no handshake</text>

  <text x="599" y="96" text-anchor="middle" class="small">ConnMaxIdleTime or</text>
  <text x="599" y="110" text-anchor="middle" class="small">over MaxIdleConns</text>
  <path class="line" d="M530 128 H668" marker-end="url(#arr-pool-2)"/>

  <path class="line dashed" d="M250 156 V232 H715 V158" marker-end="url(#arr-pool-2)"/>
  <text x="560" y="250" text-anchor="middle" class="small">on release: older than ConnMaxLifetime, or the conn is broken</text>
</svg>
<figcaption>The green arrow is the whole point of pooling. Every other arrow either costs a handshake (dial) or exists to stop old, idle or broken connections from piling up.</figcaption>
</figure>

<h3>The four knobs (and pgxpool's equivalents)</h3>
<table>
  <tr><th>What it limits</th><th><code>database/sql</code></th><th>Default</th><th><code>pgxpool</code></th><th>Default</th></tr>
  <tr><td>Total connections (the cap)</td><td><code>SetMaxOpenConns</code></td><td>0 = unlimited</td><td><code>MaxConns</code></td><td>greater of 4 and <code>runtime.NumCPU()</code></td></tr>
  <tr><td>Warm connections kept</td><td><code>SetMaxIdleConns</code> (an upper bound on idle)</td><td>2</td><td><code>MinConns</code> (a lower bound kept open)</td><td>0</td></tr>
  <tr><td>Age of a connection</td><td><code>SetConnMaxLifetime</code></td><td>0 = forever</td><td><code>MaxConnLifetime</code></td><td>1 hour</td></tr>
  <tr><td>Idle time before closing</td><td><code>SetConnMaxIdleTime</code></td><td>0 = forever</td><td><code>MaxConnIdleTime</code></td><td>30 minutes</td></tr>
  <tr><td>Where to look</td><td><code>db.Stats()</code>: <code>InUse</code>, <code>Idle</code>, <code>WaitCount</code>, <code>WaitDuration</code>, <code>MaxIdleClosed</code>…</td><td></td><td><code>pool.Stat()</code>: <code>AcquiredConns</code>, <code>EmptyAcquireCount</code>, <code>AcquireDuration</code>…</td><td></td></tr>
</table>
<p>Both <code>database/sql</code> defaults bite. <strong>Unlimited open connections</strong> lets a spike open one connection per concurrent request until Postgres refuses them. <strong>Only 2 idle</strong> means that at a steady concurrency of 20, the pool keeps closing connections and re-dialing them a millisecond later. If <code>MaxIdleClosed</code> climbs steadily, set <code>SetMaxIdleConns</code> equal to the cap.</p>
<p><code>SetConnMaxLifetime</code> exists for the world outside your process: after a failover the DNS name points to a new primary, a load balancer wants to rebalance, a firewall silently drops long-idle TCP flows. Minutes (5–30) is the usual range. Connections are closed when they're released, so a lifetime doesn't kill a running query.</p>

<h3>How big should the pool be?</h3>
<p>Start from <strong>Little's law</strong>: busy connections = queries per second × average time a connection is held. At 2,000 queries/s and 5 ms per query, about 10 connections are busy on average. Allow headroom for bursts, and that's your per-instance cap. If the number comes out huge, the fix is usually shorter hold times (faster queries, no network calls inside transactions), not a bigger pool.</p>
<p>Then do the fleet math, which is where most outages come from: <strong>cap per instance × number of instances (at the autoscaler's maximum) + cron jobs + migrations + admin sessions must stay under <code>max_connections</code></strong>. Each app instance has its own pool and knows nothing of the others.</p>
<p>For the database side, the HikariCP wiki ("About Pool Sizing") quotes a starting point from the PostgreSQL project: <code>connections = (core_count × 2) + effective_spindle_count</code>, with spindles = 0 when the data is cached. It is a starting point for load tests, not a law. The idea holds, though: 16 cores don't go faster with 500 active connections than with 40. They usually go slower, from context switching and lock contention.</p>

<h3>External poolers: PgBouncer and friends</h3>
<p>An in-app pool limits connections per process. With dozens of pods, serverless functions or several services on one database, the total is still too high. An external pooler sits between all of them and Postgres and multiplexes thousands of cheap client connections onto a few real server connections.</p>
<figure class="diagram">
<svg viewBox="0 0 780 300" role="img" aria-label="Left: without a pooler, 30 pods with pools of 10 open 300 connections to PostgreSQL whose max_connections is 100, and new clients get FATAL sorry, too many clients already. Right: with PgBouncer in transaction mode, the same 300 client connections go to PgBouncer, which uses 20 server connections to PostgreSQL. A client holds a server connection only for the length of one transaction.">
  <defs><marker id="arr-pool-3" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <text x="195" y="24" text-anchor="middle" class="title">Without a pooler</text>
  <text x="595" y="24" text-anchor="middle" class="title">With PgBouncer (transaction mode)</text>
  <path class="line dashed" d="M390 10 V290" style="stroke: var(--line)"/>

  <rect class="box" x="30" y="50" width="110" height="40" rx="6"/><text x="85" y="67" text-anchor="middle">pod 1</text><text x="85" y="82" text-anchor="middle" class="small">pool of 10</text>
  <rect class="box" x="30" y="100" width="110" height="40" rx="6"/><text x="85" y="117" text-anchor="middle">pod 2</text><text x="85" y="132" text-anchor="middle" class="small">pool of 10</text>
  <text x="85" y="160" text-anchor="middle">⋮</text>
  <rect class="box" x="30" y="170" width="110" height="40" rx="6"/><text x="85" y="187" text-anchor="middle">pod 30</text><text x="85" y="202" text-anchor="middle" class="small">pool of 10</text>
  <path class="line bad" d="M140 70 L238 112" marker-end="url(#arr-pool-3)"/>
  <path class="line bad" d="M140 120 L238 128" marker-end="url(#arr-pool-3)"/>
  <path class="line bad" d="M140 190 L238 146" marker-end="url(#arr-pool-3)"/>
  <rect class="box bad" x="240" y="90" width="130" height="76" rx="8"/>
  <text x="305" y="114" text-anchor="middle" class="title">PostgreSQL</text>
  <text x="305" y="134" text-anchor="middle">300 wanted</text>
  <text x="305" y="152" text-anchor="middle" class="small">max_connections 100</text>
  <text x="195" y="244" text-anchor="middle" class="small">connection 101 gets:</text>
  <text x="195" y="262" text-anchor="middle" class="small">FATAL: sorry, too many clients already</text>

  <rect class="box" x="420" y="50" width="100" height="40" rx="6"/><text x="470" y="67" text-anchor="middle">pod 1</text><text x="470" y="82" text-anchor="middle" class="small">pool of 10</text>
  <rect class="box" x="420" y="100" width="100" height="40" rx="6"/><text x="470" y="117" text-anchor="middle">pod 2</text><text x="470" y="132" text-anchor="middle" class="small">pool of 10</text>
  <text x="470" y="160" text-anchor="middle">⋮</text>
  <rect class="box" x="420" y="170" width="100" height="40" rx="6"/><text x="470" y="187" text-anchor="middle">pod 30</text><text x="470" y="202" text-anchor="middle" class="small">pool of 10</text>
  <path class="line" d="M520 70 L568 112" marker-end="url(#arr-pool-3)"/>
  <path class="line" d="M520 120 L568 128" marker-end="url(#arr-pool-3)"/>
  <path class="line" d="M520 190 L568 146" marker-end="url(#arr-pool-3)"/>
  <rect class="box accent" x="570" y="90" width="90" height="76" rx="8"/>
  <text x="615" y="114" text-anchor="middle" class="title">PgBouncer</text>
  <text x="615" y="134" text-anchor="middle" class="small">300 clients</text>
  <text x="615" y="152" text-anchor="middle" class="small">→ 20 servers</text>
  <path class="line ok" d="M660 128 H688" marker-end="url(#arr-pool-3)"/>
  <rect class="box ok" x="690" y="90" width="76" height="76" rx="8"/>
  <text x="728" y="124" text-anchor="middle" class="title">Postgres</text>
  <text x="728" y="142" text-anchor="middle" class="small">20 conns</text>
  <text x="595" y="244" text-anchor="middle" class="small">a client gets a server connection only</text>
  <text x="595" y="262" text-anchor="middle" class="small">for the length of one transaction</text>
</svg>
<figcaption>Same fleet, same per-pod pools. The pooler turns "300 connections that are mostly idle" into "20 connections that are mostly busy". It works because most app connections sit idle between transactions.</figcaption>
</figure>
<p>The price: in PgBouncer's two aggressive modes, your next transaction may run on a different server connection, so anything stored in the <em>session</em> doesn't follow you.</p>
<table>
  <tr><th>Mode</th><th>Server connection is held for</th><th>Works</th><th>Breaks</th><th>Use when</th></tr>
  <tr><td><strong>session</strong></td><td>the whole client connection</td><td>every Postgres feature</td><td>nothing, but there is little multiplexing: idle clients still hold a server connection</td><td>you need session features; you mainly want to cap and queue connections</td></tr>
  <tr><td><strong>transaction</strong></td><td>one transaction</td><td>normal queries and transactions, <code>NOTIFY</code>, <code>SET LOCAL</code>, <code>ON COMMIT DROP</code> temp tables, protocol-level prepared statements once <code>max_prepared_statements</code> is non-zero (PgBouncer 1.21+)</td><td>session <code>SET</code>/<code>RESET</code>, <code>LISTEN</code>, SQL-level <code>PREPARE</code>/<code>DEALLOCATE</code>, <code>WITH HOLD</code> cursors, session advisory locks (<code>pg_advisory_lock</code>), temp tables that outlive a transaction, <code>LOAD</code></td><td>the usual choice for many app instances or serverless</td></tr>
  <tr><td><strong>statement</strong></td><td>one statement</td><td>autocommit single statements</td><td>everything above, plus multi-statement transactions (they are refused)</td><td>rare; built for PL/Proxy-style setups</td></tr>
</table>
<pre><code>; pgbouncer.ini  (illustration, not executed here)
[databases]
orders = host=10.0.0.5 port=5432 dbname=orders

[pgbouncer]
listen_port = 6432
pool_mode = transaction        ; server conn is held only for one transaction
default_pool_size = 20         ; server conns per (database, user) pair
max_client_conn = 2000         ; app-side conns PgBouncer will accept
max_prepared_statements = 200  ; &gt;0 enables prepared statements in transaction mode (1.21+)</code></pre>
<p>Keep the app's own pool in front of PgBouncer; it saves the TCP/TLS setup to PgBouncer. One Go trap: pgx's default mode prepares and caches named statements per server connection. Behind PgBouncer in transaction mode without prepared statement support (before 1.21, or <code>max_prepared_statements = 0</code>), you get errors about prepared statements that don't exist or already exist. Enable the support, or pick a pgx mode without named statements:</p>
<pre><code>// Behind an old PgBouncer (&lt; 1.21) in transaction mode, stop pgx from
// using named prepared statements, which live on one server connection:
dsn := "postgres://app@pgbouncer:6432/orders?default_query_exec_mode=exec"
// or in code: cfg.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeExec</code></pre>
<p><strong>Amazon RDS Proxy</strong> also multiplexes at transaction boundaries. When it sees session state, it <strong>pins</strong> the client to one database connection until disconnect. For PostgreSQL, AWS lists session <code>SET</code> (not <code>SET LOCAL</code> in a transaction), <code>PREPARE</code>, temp tables, cursors, <code>LISTEN</code> and session advisory locks. Watch the <code>DatabaseConnectionsCurrentlySessionPinned</code> metric.</p>

<h2>Example</h2>
<p><strong>Saturating and leaking a real pool.</strong> These tests start a real PostgreSQL with <code>embedded-postgres</code> and talk to it through <code>database/sql</code> with the pgx driver. <code>Burst</code> runs 20 goroutines through a pool of 5. <code>FirstOrderLeaky</code> has the most common pool bug in Go: it returns without closing <code>rows</code>.</p>
<pre><code>package connpool

import (
	"context"
	"database/sql"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib" // registers the "pgx" driver for database/sql
)

// Open returns a database/sql pool with all four knobs set explicitly.
func Open(dsn string, maxOpen int) (*sql.DB, error) {
	db, err := sql.Open("pgx", dsn) // no connection is made yet
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(maxOpen)             // hard cap: callers queue beyond this
	db.SetMaxIdleConns(maxOpen)             // keep them warm (default is only 2)
	db.SetConnMaxLifetime(30 * time.Minute) // recycle: DNS changes, failover, LB rebalancing
	db.SetConnMaxIdleTime(5 * time.Minute)  // shrink after a burst
	return db, nil
}

// Burst runs &#96;workers&#96; goroutines that each hold a connection for &#96;hold&#96;.
// It returns the highest number of queries that ran at the same time.
func Burst(ctx context.Context, db *sql.DB, workers int, hold time.Duration) int {
	var mu sync.Mutex
	running, peak := 0, 0
	var wg sync.WaitGroup
	for range workers {
		wg.Go(func() {
			conn, err := db.Conn(ctx) // waits here when the pool is empty
			if err != nil {
				return
			}
			defer conn.Close() // returns it to the pool
			mu.Lock()
			running++
			peak = max(peak, running)
			mu.Unlock()
			conn.ExecContext(ctx, "SELECT pg_sleep($1)", hold.Seconds())
			mu.Lock()
			running--
			mu.Unlock()
		})
	}
	wg.Wait()
	return peak
}

// FirstOrderLeaky has the classic bug: it returns early without rows.Close(),
// so the connection never goes back to the pool.
func FirstOrderLeaky(ctx context.Context, db *sql.DB) (int, error) {
	rows, err := db.QueryContext(ctx, "SELECT id FROM orders ORDER BY id")
	if err != nil {
		return 0, err
	}
	var id int
	if rows.Next() {
		err = rows.Scan(&amp;id)
		return id, err // BUG: rows still open, connection still checked out
	}
	return 0, rows.Err()
}

// FirstOrder is the fix: defer rows.Close() right after the error check.
func FirstOrder(ctx context.Context, db *sql.DB) (int, error) {
	rows, err := db.QueryContext(ctx, "SELECT id FROM orders ORDER BY id")
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	var id int
	if rows.Next() {
		err = rows.Scan(&amp;id)
		return id, err // deferred Close runs here: connection goes back
	}
	return 0, rows.Err()
}

// NewPgxPool is the pgx-native pool; same ideas, different knob names.
func NewPgxPool(ctx context.Context, dsn string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, err
	}
	cfg.MaxConns = 10 // default: max(4, runtime.NumCPU())
	cfg.MinConns = 2
	cfg.MaxConnLifetime = 30 * time.Minute
	cfg.MaxConnIdleTime = 5 * time.Minute
	return pgxpool.NewWithConfig(ctx, cfg)
}</code></pre>
<p>The tests are <code>Example</code> functions: <code>go test</code> fails if the printed output differs from the <code>// Output:</code> block, so those lines are real.</p>
<pre><code>func ExampleBurst() {
	ctx := context.Background()
	db, _ := Open(dsn, 5)
	defer db.Close()
	var maxConns int
	db.QueryRow("SHOW max_connections").Scan(&amp;maxConns)
	fmt.Println("server max_connections:", maxConns)

	peak := Burst(ctx, db, 20, 100*time.Millisecond)
	s := db.Stats()
	fmt.Println("workers: 20, pool cap:", s.MaxOpenConnections)
	fmt.Println("peak concurrent queries:", peak)
	fmt.Println("open connections:", s.OpenConnections, "idle:", s.Idle)
	fmt.Println("WaitCount:", s.WaitCount)
	fmt.Println("waited &gt; 1s in total:", s.WaitDuration &gt; time.Second)
	// Output:
	// server max_connections: 100
	// workers: 20, pool cap: 5
	// peak concurrent queries: 5
	// open connections: 5 idle: 5
	// WaitCount: 15
	// waited &gt; 1s in total: true
}

func ExampleFirstOrderLeaky() {
	ctx := context.Background()
	db, _ := Open(dsn, 2)
	defer db.Close()
	db.Exec("CREATE TABLE IF NOT EXISTS orders (id int PRIMARY KEY)")
	db.Exec("INSERT INTO orders SELECT g FROM generate_series(1, 10) g ON CONFLICT DO NOTHING")

	for i := 1; i &lt;= 2; i++ {
		id, err := FirstOrderLeaky(ctx, db) // e.g. a background job: ctx never ends
		fmt.Printf("leaky call %d: id=%d err=%v inUse=%d&#92;n", i, id, err, db.Stats().InUse)
	}
	c, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
	_, err := FirstOrderLeaky(c, db) // a request with a 500 ms budget
	cancel()
	fmt.Printf("leaky call 3: err=%v waits=%d&#92;n", err, db.Stats().WaitCount)

	db2, _ := Open(dsn, 2)
	defer db2.Close()
	for i := 1; i &lt;= 3; i++ {
		id, err := FirstOrder(ctx, db2)
		fmt.Printf("fixed call %d: id=%d err=%v inUse=%d&#92;n", i, id, err, db2.Stats().InUse)
	}
	// Output:
	// leaky call 1: id=1 err=&lt;nil&gt; inUse=1
	// leaky call 2: id=1 err=&lt;nil&gt; inUse=2
	// leaky call 3: err=context deadline exceeded waits=1
	// fixed call 1: id=1 err=&lt;nil&gt; inUse=0
	// fixed call 2: id=1 err=&lt;nil&gt; inUse=0
	// fixed call 3: id=1 err=&lt;nil&gt; inUse=0
}</code></pre>
<p>A third test, <code>TestReuse</code>, runs <code>SELECT 1</code> 200 times through a pool with <code>SetMaxIdleConns(0)</code>, then with 5, and logs the time (laptop, Postgres on localhost, no TLS):</p>
<pre><code>    pool_test.go:74: maxIdle=0: 2.942s, connections thrown away: 200
    pool_test.go:74: maxIdle=5: 26ms, connections thrown away: 0
ok  	example.com/connpool	11.549s</code></pre>
<ul>
  <li><strong>Reuse.</strong> With <code>maxIdle=0</code>, every query dialed, authenticated and got a freshly forked backend: about 15 ms each, even on localhost. Reusing connections took about 1% of the time.</li>
  <li><strong>Saturation.</strong> Never more than 5 queries ran at once, and exactly 15 goroutines waited (<code>WaitCount: 15</code>). That queue is the pool working. In production, watch <code>WaitCount</code> and <code>WaitDuration</code> <em>growing</em> between scrapes.</li>
  <li><strong>Leak.</strong> Each leaky call left a connection checked out. The third call never got one: <code>context deadline exceeded</code> while the database sat idle. The fixed version always ends at <code>inUse=0</code>.</li>
</ul>
<p><code>database/sql</code> does close a <code>Rows</code> when the context given to <code>QueryContext</code> is cancelled, so in an HTTP handler a forgotten <code>rows.Close()</code> leaks only until the request ends. With <code>context.Background()</code> it leaks for good, as above. Always <code>defer rows.Close()</code>.</p>

<p><strong>Real-world scenario.</strong> An orders API runs 8 pods with <code>SetMaxOpenConns(20)</code>: 160 connections against <code>max_connections = 200</code>. On a sale day the autoscaler goes to 24 pods, 480 potential connections. Once about ten pods are up, new ones fail readiness with <code>too many clients already</code>, and the old ones slow down because Postgres is juggling ~190 backends on 16 cores. The fix: PgBouncer in transaction mode with <code>default_pool_size = 40</code>, each pod capped at 10 with <code>SetMaxIdleConns(10)</code>, and a dashboard panel for <code>WaitDuration</code>. Postgres now sees at most 40 busy connections; the waiting moves into PgBouncer and the pods' pools, where it is visible and bounded by request timeouts.</p>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>Forgetting the fleet math.</strong> A pool size is per process. Multiply by the maximum replica count, add workers, cron jobs and migrations, and compare with <code>max_connections</code>. Autoscaling app pods can take the database down.</li>
  <li><strong>Leaking connections.</strong> Missing <code>rows.Close()</code>, a <code>tx</code> that is never committed or rolled back on an error path, a <code>*sql.Conn</code> never closed. The symptom is timeouts waiting for a connection while the database looks idle. <code>InUse</code> stuck near the cap with low database CPU is the tell.</li>
  <li><strong>Holding a connection across slow work.</strong> A transaction that calls a payment API or another service holds a connection (and its locks) for the whole call. Do the network call outside the transaction, then open a short one to write the result.</li>
  <li><strong>"Just make the pool bigger."</strong> If queries are slow because the database is saturated, more connections add contention and make each query slower. Fix the queries (see <a href="#query-optimization">Query Optimization</a>, <a href="#n-1-queries">N+1 Queries</a>) or add capacity.</li>
  <li><strong>No deadline on getting a connection.</strong> Without one, a caller can wait in the pool's queue forever. Pass a request context with a deadline to every query (see <a href="#timeouts">Timeouts</a>).</li>
</ul>

<div class="callout warn"><strong>A pool timeout is not a database timeout.</strong> "context deadline exceeded" on a query can mean the query ran too long, or that it never got a connection. Check <code>db.Stats().WaitDuration</code> before you go hunting for a slow query.</div>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>Connections are expensive to open and cost server memory; a pool reuses them and caps how many exist.</li>
  <li>In Go, <code>*sql.DB</code> is the pool: create one, share it, and set all four knobs. The defaults are unlimited open connections and only 2 idle.</li>
  <li>Size with Little's law and the fleet sum: cap × instances must fit under <code>max_connections</code>. Smaller and busy beats bigger and contended.</li>
  <li>With many instances, put PgBouncer (transaction mode) or RDS Proxy in front, and stop relying on session state.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#read-replicas">Read Replicas</a> · <a href="#query-optimization">Query Optimization</a> · <a href="#n-1-queries">N+1 Queries</a> · <a href="#timeouts">Timeouts</a> · <a href="#backpressure">Backpressure</a> · <a href="#real-world-data-layer">Real-World Data Layer</a></p>
`;
