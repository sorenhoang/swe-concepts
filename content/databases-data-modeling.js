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
