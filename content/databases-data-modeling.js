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
CONTENT["read-replicas"] = `
<p class="tldr"><strong>TL;DR</strong>: A read replica is a read-only copy of your primary database that you send <code>SELECT</code>s to, so the primary's CPU and I/O are left for writes. It's like a busy shop adding a few cashiers who can only take payments, while one manager handles returns. The catch is that the copies are always a little behind, so right after a user saves something, a replica may still show the old version. Most of the work is deciding which reads may be stale.</p>

<h2>The problem it solves</h2>
<p>Most applications read far more than they write: product pages, feeds, dashboards, search filters, reports. On a single database, those reads compete with writes for the same cores, memory and disk. When the primary sits at 80% CPU and most of that is <code>SELECT</code>s, you have two options. You can buy a bigger machine, which has a ceiling and a price curve (see <a href="#vertical-scaling">Vertical Scaling</a>). Or you can add copies that serve the reads.</p>
<p>A read replica is that copy. The primary keeps taking every write and streams its changes to one or more replicas (the mechanics, sync vs async and what is shipped, are covered in <a href="#replication">Replication</a>). Each replica can answer read queries. Five replicas give you roughly five more machines' worth of read capacity, without changing your schema or splitting your data. Replicas also have side jobs: running heavy reports away from production traffic, serving reads in another region, and being promoted if the primary dies.</p>

<h2>How it works</h2>
<p>Replication itself is the database's job. Routing is <em>yours</em>: something has to decide, for each query, whether it goes to the primary or to a replica. That can be the application (two connection pools, or a small router type like the one in the example), a driver feature, a proxy (ProxySQL for MySQL, Pgpool-II for Postgres), or a managed endpoint. Amazon Aurora, for example, gives a cluster a writer endpoint and a reader endpoint that spreads <em>connections</em> across up to 15 Aurora Replicas.</p>
<figure class="diagram">
<svg viewBox="0 0 780 320" role="img" aria-label="An app with a router sends writes to the primary, which is at LSN 3, and reads to two replicas. The primary streams WAL asynchronously to both. Replica 1 has replayed up to LSN 2, one change behind. Replica 2 is at LSN 3. The app holds a token LSN 3 from its last write, so a read with that token skips replica 1 and may use replica 2.">
  <defs><marker id="arr-rrep-1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <rect class="box" x="20" y="120" width="170" height="90" rx="8"/>
  <text x="105" y="145" text-anchor="middle" class="title">App + router</text>
  <text x="105" y="168" text-anchor="middle" class="small">token from last write:</text>
  <text x="105" y="190" text-anchor="middle">LSN 3</text>

  <rect class="box accent" x="330" y="30" width="170" height="60" rx="8"/>
  <text x="415" y="55" text-anchor="middle" class="title">Primary</text>
  <text x="415" y="75" text-anchor="middle" class="small">all writes · at LSN 3</text>

  <rect class="box bad" x="330" y="230" width="170" height="60" rx="8"/>
  <text x="415" y="254" text-anchor="middle" class="title">Replica 1</text>
  <text x="415" y="274" text-anchor="middle" class="small">at LSN 2 · lag 1</text>
  <rect class="box ok" x="570" y="230" width="180" height="60" rx="8"/>
  <text x="660" y="254" text-anchor="middle" class="title">Replica 2</text>
  <text x="660" y="274" text-anchor="middle" class="small">at LSN 3 · lag 0</text>

  <path class="line" d="M190 140 H260 V60 H328" marker-end="url(#arr-rrep-1)"/>
  <text x="225" y="132" text-anchor="middle" class="small">writes</text>
  <path class="line" d="M190 190 H260 V260 H328" marker-end="url(#arr-rrep-1)"/>
  <text x="225" y="182" text-anchor="middle" class="small">reads</text>
  <path class="line" d="M105 210 V305 H660 V292" marker-end="url(#arr-rrep-1)"/>
  <text x="535" y="299" text-anchor="middle" class="small">reads</text>

  <path class="line accent dashed" d="M415 90 V228" marker-end="url(#arr-rrep-1)"/>
  <text x="425" y="160" class="small">WAL, async</text>
  <path class="line accent dashed" d="M500 60 H660 V228" marker-end="url(#arr-rrep-1)"/>
  <text x="580" y="52" text-anchor="middle" class="small">WAL, async</text>

  <text x="575" y="130" text-anchor="middle" class="small">read with token LSN 3:</text>
  <text x="575" y="146" text-anchor="middle" class="small">replica 1 is behind, skip it</text>
  <text x="575" y="162" text-anchor="middle" class="small">replica 2 qualifies</text>
</svg>
<figcaption>Writes have one destination. Reads have several, and each replica sits at its own point in the primary's log. The router's job is to pick one that is healthy and recent enough for this particular read.</figcaption>
</figure>

<h3>Replication lag, and how to measure it</h3>
<p>RDS, Aurora, Postgres streaming replication and MySQL replication are asynchronous by default for read replicas: the primary commits, answers the client, and ships the change afterwards. The distance between "committed on the primary" and "visible on the replica" is <strong>replication lag</strong>. It is usually milliseconds. It grows during bulk imports, large <code>UPDATE</code>s or migrations, when the replica's disk or CPU is saturated by its own read load, or when a long query on the replica holds back replay (more on that below).</p>
<p>Measure it two ways, because they fail differently:</p>
<pre><code>-- on the PRIMARY: one row per standby  (not executed here)
SELECT application_name,
       replay_lag,                         -- an interval
       pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn) AS bytes_behind
FROM pg_stat_replication;

-- on a REPLICA
SELECT pg_last_wal_replay_lsn(),
       now() - pg_last_xact_replay_timestamp() AS since_last_replayed_commit;</code></pre>
<ul>
  <li><strong>Bytes (or log position) behind.</strong> <code>pg_wal_lsn_diff</code> on the primary, against <code>replay_lsn</code> in <code>pg_stat_replication</code>. Zero means caught up, regardless of traffic.</li>
  <li><strong>Time.</strong> <code>replay_lag</code> in <code>pg_stat_replication</code> (Postgres 10+) is measured from the primary's side. On the replica, <code>now() - pg_last_xact_replay_timestamp()</code> is popular but misleading: it is the age of the <em>last replayed commit</em>, so on an idle primary it keeps growing even when the replica is fully caught up. Check the LSNs before you page someone.</li>
</ul>
<p>In MySQL, <code>SHOW REPLICA STATUS</code> reports <code>Seconds_Behind_Source</code>. Managed services export lag as a metric (for example <code>ReplicaLag</code> for RDS and <code>AuroraReplicaLag</code> for Aurora in CloudWatch).</p>

<h3>Read-your-writes: the bug everyone ships once</h3>
<p>Async lag is harmless for most reads. Nobody notices that a product's review count is 200 ms old. It becomes a bug when the <em>same user</em> who just wrote something reads it back:</p>
<figure class="diagram">
<svg viewBox="0 0 780 410" role="img" aria-label="Sequence diagram with User, App, Primary and Replica. The user saves the name Annie. The app updates the primary, which commits at LSN 3 and returns OK with the LSN. The user reloads; the app reads from any replica, which is still at LSN 2 and returns the old name Ann. The WAL reaches the replica later. With a token, the app asks the replica whether it has replayed LSN 3; it has not, so the app reads from the primary and gets Annie.">
  <defs><marker id="arr-rrep-2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <rect class="box" x="40" y="14" width="100" height="30" rx="6"/><text x="90" y="34" text-anchor="middle" class="title">User</text>
  <rect class="box" x="230" y="14" width="100" height="30" rx="6"/><text x="280" y="34" text-anchor="middle" class="title">App</text>
  <rect class="box accent" x="430" y="14" width="100" height="30" rx="6"/><text x="480" y="34" text-anchor="middle" class="title">Primary</text>
  <rect class="box" x="630" y="14" width="100" height="30" rx="6"/><text x="680" y="34" text-anchor="middle" class="title">Replica</text>
  <path class="line" d="M90 44 V400" style="stroke: var(--line)"/>
  <path class="line" d="M280 44 V400" style="stroke: var(--line)"/>
  <path class="line" d="M480 44 V400" style="stroke: var(--line)"/>
  <path class="line" d="M680 44 V400" style="stroke: var(--line)"/>

  <path class="line" d="M90 72 H278" marker-end="url(#arr-rrep-2)"/><text x="185" y="65" text-anchor="middle" class="small">save name = "Annie"</text>
  <path class="line" d="M280 97 H478" marker-end="url(#arr-rrep-2)"/><text x="380" y="90" text-anchor="middle" class="small">UPDATE users …</text>
  <path class="line dashed" d="M480 122 H282" marker-end="url(#arr-rrep-2)"/><text x="380" y="115" text-anchor="middle" class="small">committed at LSN 3</text>
  <path class="line dashed" d="M280 147 H92" marker-end="url(#arr-rrep-2)"/><text x="185" y="140" text-anchor="middle" class="small">saved</text>
  <path class="line" d="M90 172 H278" marker-end="url(#arr-rrep-2)"/><text x="185" y="165" text-anchor="middle" class="small">reload profile</text>
  <path class="line" d="M280 197 H678" marker-end="url(#arr-rrep-2)"/><text x="580" y="190" text-anchor="middle" class="small">SELECT name (any replica)</text>
  <path class="line bad dashed" d="M680 222 H282" marker-end="url(#arr-rrep-2)"/><text x="580" y="215" text-anchor="middle" class="small">"Ann" (replica still at LSN 2)</text>
  <path class="line bad dashed" d="M280 247 H92" marker-end="url(#arr-rrep-2)"/><text x="185" y="240" text-anchor="middle" class="small">old name: "did my save fail?"</text>
  <path class="line accent dashed" d="M480 272 H678" marker-end="url(#arr-rrep-2)"/><text x="580" y="265" text-anchor="middle" class="small">WAL for LSN 3 arrives later</text>

  <text x="390" y="297" text-anchor="middle" class="title">Fix: carry the token</text>
  <path class="line" d="M280 322 H678" marker-end="url(#arr-rrep-2)"/><text x="580" y="315" text-anchor="middle" class="small">replayed up to LSN 3?</text>
  <path class="line dashed" d="M680 347 H282" marker-end="url(#arr-rrep-2)"/><text x="580" y="340" text-anchor="middle" class="small">not yet (at LSN 2)</text>
  <path class="line" d="M280 372 H478" marker-end="url(#arr-rrep-2)"/><text x="380" y="365" text-anchor="middle" class="small">read from primary</text>
  <path class="line ok dashed" d="M480 396 H282" marker-end="url(#arr-rrep-2)"/><text x="380" y="390" text-anchor="middle" class="small">"Annie"</text>
</svg>
<figcaption>The top half is the classic support ticket: "the save button doesn't work". The data was saved; the read just went to a copy that hadn't seen it yet. The bottom half is the token fix that the example implements.</figcaption>
</figure>
<p>There is no single fix. Pick per kind of read:</p>
<table>
  <tr><th>Strategy</th><th>How it works</th><th>Good</th><th>Cost / limits</th></tr>
  <tr><td><strong>Primary for a while after a write</strong></td><td>After a user writes, set a flag (cookie, session, cache key) for N seconds; their reads go to the primary until it expires.</td><td>Simple; no database support needed</td><td>N is a guess; a lag spike longer than N still breaks it. Heavy writers put load back on the primary.</td></tr>
  <tr><td><strong>Version token (LSN / GTID)</strong></td><td>After the write, remember its log position. A read goes to a replica that has replayed at least that far; else wait briefly or use the primary.</td><td>Exact: stale only when it is safe to be</td><td>Token has to travel with the user (session, cookie, header). Needs a cheap way to ask each replica where it is.</td></tr>
  <tr><td><strong>Critical reads always on the primary</strong></td><td>Checkout, balances, permissions, "edit" forms read from the primary. Everything else from replicas.</td><td>Easy to reason about</td><td>You must classify reads. Grows primary load as more reads become "critical".</td></tr>
  <tr><td><strong>Sticky replica per session</strong></td><td>Hash the user or session to one replica.</td><td>Gives monotonic reads: time doesn't go backwards between refreshes</td><td>Does <em>not</em> give read-your-writes on its own. Uneven load if sessions are skewed.</td></tr>
  <tr><td><strong>Wait at commit</strong></td><td>Postgres <code>synchronous_commit = remote_apply</code> with the replica as a synchronous standby: commit returns once the change is visible there.</td><td>Replicas current at commit time</td><td>Every commit pays a round trip; a slow standby slows all writes (see <a href="#replication">Replication</a>).</td></tr>
  <tr><td><strong>Accept staleness</strong></td><td>Feeds, search results, counts, analytics, other users' data.</td><td>Free</td><td>Only for reads where "a second old" is truly fine.</td></tr>
</table>
<p>The token approach maps directly to database features:</p>
<pre><code>-- read-your-writes with an LSN token in Postgres  (not executed here)
-- 1. on the primary, right after COMMIT:
SELECT pg_current_wal_lsn();                       -- e.g. 0/3000148, store it in the session

-- 2. on the replica, before the read:
SELECT pg_last_wal_replay_lsn() &gt;= '0/3000148'::pg_lsn;   -- true: safe to read here</code></pre>
<p>MySQL has the same idea with GTIDs: after the write, get the transaction's GTID (the <code>session_track_gtids</code> variable can report it to clients), then run <code>WAIT_FOR_EXECUTED_GTID_SET(gtid_set, timeout)</code> on the replica. It returns 0 once the replica has applied it, and 1 on timeout.</p>

<h3>Health checks and taking replicas out of rotation</h3>
<p>A router should stop sending reads to a replica that is down <em>or</em> too far behind. A replica 10 minutes behind is technically healthy and answers every query, with data that is 10 minutes old. So the check is two-part: can I connect and run a query (see <a href="#health-checks">Health Checks</a>), and is lag under my threshold? When every replica fails the check, fall back to the primary only if it has headroom. Otherwise, a replica outage becomes a primary overload and then a full outage. Shedding or degrading some reads can be the better choice (see <a href="#backpressure">Backpressure</a>).</p>
<p>A replica is also your standby: if the primary dies, one is promoted. After a promotion the topology changes, so connections to the old primary must be dropped, and the remaining replicas must follow the new one. That's <a href="#failover">Failover</a>. Setting <code>SetConnMaxLifetime</code> on your pools (see <a href="#connection-pooling">Connection Pooling</a>) means long-lived connections eventually re-resolve DNS endpoints. It also helps a reader endpoint that balances connections, not queries, spread load onto a newly added replica.</p>

<h3>Replica queries can be cancelled</h3>
<p>A Postgres hot standby must keep replaying the primary's WAL. If replay needs to remove row versions that a long query on the replica still needs (because <code>VACUUM</code> cleaned them up on the primary), or needs a lock the query holds, the two conflict. The standby waits up to <code>max_standby_streaming_delay</code> (default 30 s), then cancels the query. Raising the delay lets lag grow instead. Setting <code>hot_standby_feedback = on</code> tells the primary not to clean up rows the standby still needs, at the price of bloat on the primary. A replica for long analytics queries and a replica for low-lag app reads want opposite settings, so keep them separate.</p>

<h3>When replicas don't help</h3>
<ul>
  <li><strong>The load is writes.</strong> Every replica replays every write, so it doesn't reduce write load at all. If the primary is busy with <code>INSERT</code>s and <code>UPDATE</code>s, look at batching, <a href="#partitioning">Partitioning</a> or <a href="#sharding">Sharding</a>.</li>
  <li><strong>The reads are slow, not numerous.</strong> A query that scans 40 M rows is just as slow on a replica. Fix it first (<a href="#database-indexing">Database Indexing</a>, <a href="#query-optimization">Query Optimization</a>).</li>
  <li><strong>The same hot rows are read over and over.</strong> A cache in front is cheaper than a database server and usually faster (see <a href="#caching">Caching</a>).</li>
</ul>

<h2>Example</h2>
<p><strong>A primary, two replicas and a router, in Go.</strong> To keep lag deterministic, this example simulates replication: each node is an in-memory SQLite database (<code>modernc.org/sqlite</code>), the primary appends every write to a log, and <code>Ship</code> replays log entries on a replica. That's statement-based replication, which real databases avoid for its nondeterminism, but it behaves the same for these statements. The LSN is simply the position in that log. The routing logic is the part that carries over to production.</p>
<pre><code>package readreplicas

import (
	"context"
	"database/sql"
	"fmt"
	"sync"
	"sync/atomic"

	_ "modernc.org/sqlite"
)

// A change in the replication log. LSN = its position in the log.
type change struct {
	query string
	args  []any
}

// Node is one SQLite database playing primary or replica.
type Node struct {
	Name    string
	DB      *sql.DB
	applied int64 // LSN this node has replayed up to
	Down    bool  // set by a health check
}

var clusters atomic.Int64 // keeps in-memory DB names unique per Router

func open(cluster int64, name string) *Node {
	dsn := fmt.Sprintf("file:c%d-%s?mode=memory&amp;cache=shared", cluster, name)
	db, _ := sql.Open("sqlite", dsn)
	db.SetMaxOpenConns(1)
	return &amp;Node{Name: name, DB: db}
}

// Router sends writes to the primary and reads to replicas.
type Router struct {
	mu       sync.Mutex
	primary  *Node
	replicas []*Node
	log      []change
	next     int   // round-robin cursor
	MaxLag   int64 // replicas further behind than this get no reads
}

func NewRouter(replicas ...string) *Router {
	c := clusters.Add(1)
	r := &amp;Router{primary: open(c, "primary"), MaxLag: 100}
	for _, name := range replicas {
		r.replicas = append(r.replicas, open(c, name))
	}
	return r
}

// Write runs on the primary and returns the LSN of the change: the
// "version token" the caller keeps (in its session or a cookie).
func (r *Router) Write(ctx context.Context, query string, args ...any) (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, err := r.primary.DB.ExecContext(ctx, query, args...); err != nil {
		return 0, err
	}
	r.log = append(r.log, change{query, args})
	r.primary.applied = int64(len(r.log))
	return r.primary.applied, nil
}

// Ship replays up to n pending changes on one replica (async replication;
// n is how we control lag in the example).
func (r *Router) Ship(ctx context.Context, name string, n int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, rep := range r.replicas {
		for rep.Name == name &amp;&amp; n &gt; 0 &amp;&amp; rep.applied &lt; int64(len(r.log)) {
			c := r.log[rep.applied]
			rep.DB.ExecContext(ctx, c.query, c.args...)
			rep.applied++
			n--
		}
	}
}

// Lag in log entries. Postgres gives the same in bytes:
// pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn).
func (r *Router) Lag(name string) int64 {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, rep := range r.replicas {
		if rep.Name == name {
			return r.primary.applied - rep.applied
		}
	}
	return -1
}

// pick returns the next healthy replica that has replayed at least minLSN,
// or the primary if none qualifies.
func (r *Router) pick(minLSN int64) *Node {
	r.mu.Lock()
	defer r.mu.Unlock()
	for range r.replicas {
		rep := r.replicas[r.next%len(r.replicas)]
		r.next++
		lag := r.primary.applied - rep.applied
		if !rep.Down &amp;&amp; lag &lt;= r.MaxLag &amp;&amp; rep.applied &gt;= minLSN {
			return rep
		}
	}
	return r.primary
}

// Get reads one row from a replica into dest and says which node served it.
// minLSN = 0 means "any staleness is fine"; pass the token from Write to
// get read-your-writes.
func (r *Router) Get(ctx context.Context, minLSN int64, dest any, query string, args ...any) (string, error) {
	n := r.pick(minLSN)
	return n.Name, n.DB.QueryRowContext(ctx, query, args...).Scan(dest)
}

func (r *Router) SetDown(name string, down bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, rep := range r.replicas {
		if rep.Name == name {
			rep.Down = down
		}
	}
}</code></pre>
<p>The tests are Go <code>Example</code> functions, so <code>go test</code> fails if the printed output differs from the <code>// Output:</code> comment.</p>
<pre><code>package readreplicas

import (
	"context"
	"fmt"
)

func setup(ctx context.Context) *Router {
	r := NewRouter("replica-1", "replica-2")
	r.Write(ctx, "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)")
	r.Write(ctx, "INSERT INTO users VALUES (42, 'Ann')")
	r.Ship(ctx, "replica-1", 2) // both replicas are fully caught up
	r.Ship(ctx, "replica-2", 2)
	return r
}

func ExampleRouter_staleRead() {
	ctx := context.Background()
	r := setup(ctx)

	token, _ := r.Write(ctx, "UPDATE users SET name = 'Annie' WHERE id = 42")
	fmt.Println("write committed on primary, token LSN =", token)
	fmt.Println("lag replica-1:", r.Lag("replica-1"), "replica-2:", r.Lag("replica-2"))

	// The page reloads right after the save and reads "any replica".
	var name string
	from, _ := r.Get(ctx, 0, &amp;name, "SELECT name FROM users WHERE id = 42")
	fmt.Printf("read without token -&gt; %s: %q  (stale)&#92;n", from, name)

	// Same read, but carrying the token from the write.
	from, _ = r.Get(ctx, token, &amp;name, "SELECT name FROM users WHERE id = 42")
	fmt.Printf("read with token    -&gt; %s: %q&#92;n", from, name)

	r.Ship(ctx, "replica-2", 1) // replica-2 catches up
	from, _ = r.Get(ctx, token, &amp;name, "SELECT name FROM users WHERE id = 42")
	fmt.Printf("after replica-2 catches up -&gt; %s: %q&#92;n", from, name)
	// Output:
	// write committed on primary, token LSN = 3
	// lag replica-1: 1 replica-2: 1
	// read without token -&gt; replica-1: "Ann"  (stale)
	// read with token    -&gt; primary: "Annie"
	// after replica-2 catches up -&gt; replica-2: "Annie"
}

func ExampleRouter_health() {
	ctx := context.Background()
	r := setup(ctx)
	r.MaxLag = 100

	// A bulk import: 150 writes. replica-2 keeps up, replica-1 stalls.
	for i := range 150 {
		r.Write(ctx, "INSERT INTO users VALUES (?, ?)", 1000+i, "bulk")
	}
	r.Ship(ctx, "replica-2", 150)
	fmt.Println("lag replica-1:", r.Lag("replica-1"), "replica-2:", r.Lag("replica-2"))

	var n int
	count := map[string]int{}
	for range 4 {
		from, _ := r.Get(ctx, 0, &amp;n, "SELECT count(*) FROM users")
		count[from]++
	}
	fmt.Println("4 reads while replica-1 lags:", count)

	r.SetDown("replica-2", true) // health check fails too
	from, _ := r.Get(ctx, 0, &amp;n, "SELECT count(*) FROM users")
	fmt.Println("no healthy replica left, read goes to:", from)
	// Output:
	// lag replica-1: 150 replica-2: 0
	// 4 reads while replica-1 lags: map[replica-2:4]
	// no healthy replica left, read goes to: primary
}</code></pre>
<p>Real output of <code>go test -v</code>:</p>
<pre><code>=== RUN   ExampleRouter_staleRead
--- PASS: ExampleRouter_staleRead (0.00s)
=== RUN   ExampleRouter_health
--- PASS: ExampleRouter_health (0.00s)
PASS
ok  	example.com/readreplicas	0.362s</code></pre>
<p>In the first example, the write commits on the primary at LSN 3 while both replicas are one entry behind. A read with no token goes to <code>replica-1</code> and returns <code>"Ann"</code>: the stale read from the sequence diagram. The same read with the token finds no replica at LSN 3 and goes to the primary. Once <code>replica-2</code> catches up, token reads go back to a replica. In the second example, a bulk import leaves <code>replica-1</code> 150 entries behind, over the <code>MaxLag</code> of 100, so all four reads skip it. When <code>replica-2</code> is marked down as well, reads fall back to the primary.</p>
<p>In production, the same router keeps <code>applied</code> fresh by polling each replica's <code>pg_last_wal_replay_lsn()</code> every few hundred milliseconds, and the token is the <code>pg_current_wal_lsn()</code> taken after the write, stored in the user's session. Instead of falling straight back to the primary, it can wait up to a short budget (for example 50 ms) for a replica to catch up.</p>

<p><strong>Real-world scenario.</strong> A marketplace's Postgres primary runs at 75% CPU at peak; about 85% of queries are reads from listing and search pages. The team adds two replicas behind a router and moves listing and search reads there. Primary CPU drops to around 30%. Two days later, support tickets arrive: sellers edit a listing's price, and the edit page shows the old price, so they edit again. Writes and the "edit listing" read now run on different machines, and lag is usually 20–80 ms. The page reloads in about 30 ms. The fix is a token: the handler stores the LSN after the write in the seller's session for 60 s, and reads with that token only use a replica that has replayed it. A month later, a nightly bulk price import pushes one replica 4 minutes behind. The lag check (over 5 s is out of rotation) sends its share to the other replica and the primary, and an alert fires on lag instead of on tickets.</p>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>Routing every read to replicas.</strong> Reads right after a write, and reads that decide a write ("is this username taken?", "is the balance enough?"), must see current data. Send them to the primary or use a token. A uniqueness check on a stale replica lets duplicates through.</li>
  <li><strong>Reading in a transaction that writes.</strong> Once a request has opened a transaction on the primary, all its reads belong in that transaction. Mixing in replica reads mid-transaction gives you data from two different points in time.</li>
  <li><strong>No lag limit in the router.</strong> A replica that's down gets removed; one that is 10 minutes behind keeps serving wrong answers. Check lag, not just liveness.</li>
  <li><strong>Trusting <code>now() - pg_last_xact_replay_timestamp()</code> alone.</strong> It reports large "lag" on a quiet primary and pages you at night for nothing. Compare LSNs.</li>
  <li><strong>Falling back to the primary without limits.</strong> When replicas fail, all reads land on the primary at once. Make sure it can take them, or shed and degrade reads instead.</li>
  <li><strong>Long reports on the low-lag replica.</strong> They get cancelled by replay conflicts, or, with <code>hot_standby_feedback</code>, cause bloat on the primary. Give analytics its own replica.</li>
  <li><strong>Adding replicas to fix write load or slow queries.</strong> Replicas copy every write and run the same plans. Index, optimize and cache first.</li>
</ul>

<div class="callout warn"><strong>A replica is a copy, not a backup.</strong> A bad <code>DELETE</code> or migration reaches every replica within milliseconds. Keep point-in-time backups too (see <a href="#backups">Backups</a>).</div>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>Replicas scale reads, not writes: the primary still takes every write, and every replica replays it.</li>
  <li>Replication to replicas is usually async, so every replica read may be stale. Decide per read whether that's acceptable.</li>
  <li>Read-your-writes needs a deliberate fix: primary-after-write, an LSN/GTID token, or routing critical reads to the primary.</li>
  <li>Measure lag in log position as well as time, and take lagging replicas out of rotation, not just dead ones.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#replication">Replication</a> · <a href="#eventual-consistency">Eventual Consistency</a> · <a href="#connection-pooling">Connection Pooling</a> · <a href="#failover">Failover</a> · <a href="#caching">Caching</a> · <a href="#real-world-data-layer">Real-World Data Layer</a></p>
`;
CONTENT["sharding"] = `
<p class="tldr"><strong>TL;DR</strong>: Sharding splits one big dataset across several independent database servers. Each server (a <em>shard</em>) holds only some of the rows, chosen by a <strong>shard key</strong> such as <code>customer_id</code>. You get more write throughput and storage than any single machine can give. The price is that every query, transaction and schema change now has to know which shard it is talking to. Think of a library that outgrew its building: it opens four branches and puts authors A–F in branch 1, G–L in branch 2, and so on. Each branch is small and fast, but "every book published in 2019" now means visiting all four.</p>

<h2>The problem it solves</h2>
<p>Most databases start on one primary server, and that goes a long way. Indexes and query fixes (see <a href="#database-indexing">Database Indexing</a>), a connection pooler and <a href="#read-replicas">Read Replicas</a> push the limit far out. But some limits belong to the single primary itself, and nothing on that list moves them:</p>
<ul>
  <li><strong>Write throughput.</strong> Replicas copy every write, so they scale reads, not writes. All inserts and updates still go through one primary's CPU, disk and write-ahead log.</li>
  <li><strong>Data size.</strong> A multi-terabyte table on one disk means slow backups, hours-long restores, and vacuum or compaction that never catches up.</li>
  <li><strong>Blast radius.</strong> One primary down means every customer is down. With 8 shards, one shard down hurts about 1/8 of customers.</li>
</ul>
<p>Buying a bigger machine (<a href="#vertical-scaling">Vertical Scaling</a>) works until it doesn't: the biggest instance has a ceiling, and the price per core rises steeply near the top. Sharding is <a href="#horizontal-scaling">Horizontal Scaling</a> for the write path. You split the rows so that each shard is an ordinary, small database again.</p>

<div class="callout warn"><strong>Sharding is the last step, not the first.</strong> It adds permanent complexity to every query, migration, backup and on-call shift. Run out of indexes, query fixes, caching, read replicas, partitioning and bigger hardware first. Shard when the <em>write</em> load or the data size of one primary is the real limit, and you can show it with metrics.</div>

<h2>How it works</h2>
<p>Every sharded system has the same three parts. The <strong>shard key</strong> is a column chosen from each row. A <strong>mapping function</strong> turns a key into a shard. A <strong>router</strong> uses that mapping to send each query to the right place. The router can be a library in your app, a proxy (Vitess's VTGate, MongoDB's <code>mongos</code>) or a coordinator node inside the database (Citus).</p>
<figure class="diagram">
<svg viewBox="0 0 780 300" role="img" aria-label="The order service sends a query for customer 42 to a shard router. The router consults a shard map and forwards the query only to shard 2, one of four independent shards, each with its own primary and replica. A query without the shard key would have to go to all four.">
  <defs><marker id="arr-shd-1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <rect class="box" x="20" y="115" width="130" height="60" rx="8"/>
  <text x="85" y="140" text-anchor="middle" class="title">Order service</text>
  <text x="85" y="158" text-anchor="middle" class="small">customer_id = 42</text>
  <path class="line" d="M150 145 H208" marker-end="url(#arr-shd-1)"/>

  <rect class="box accent" x="210" y="105" width="180" height="80" rx="8"/>
  <text x="300" y="130" text-anchor="middle" class="title">Shard router</text>
  <text x="300" y="150" text-anchor="middle" class="small">key = customer_id</text>
  <text x="300" y="168" text-anchor="middle" class="small">42 maps to shard 2</text>
  <path class="line dashed" d="M300 185 V228"/>
  <rect class="box muted" x="220" y="230" width="160" height="50" rx="8"/>
  <text x="300" y="252" text-anchor="middle">Shard map</text>
  <text x="300" y="269" text-anchor="middle" class="small">function or lookup table</text>

  <rect class="box" x="500" y="14" width="260" height="56" rx="8"/>
  <text x="630" y="38" text-anchor="middle" class="title">Shard 0</text>
  <text x="630" y="56" text-anchor="middle" class="small">primary + replica, ~1/4 of customers</text>
  <rect class="box" x="500" y="84" width="260" height="56" rx="8"/>
  <text x="630" y="108" text-anchor="middle" class="title">Shard 1</text>
  <text x="630" y="126" text-anchor="middle" class="small">primary + replica, ~1/4 of customers</text>
  <rect class="box ok" x="500" y="154" width="260" height="56" rx="8"/>
  <text x="630" y="178" text-anchor="middle" class="title">Shard 2</text>
  <text x="630" y="196" text-anchor="middle" class="small">holds every row of customer 42</text>
  <rect class="box" x="500" y="224" width="260" height="56" rx="8"/>
  <text x="630" y="248" text-anchor="middle" class="title">Shard 3</text>
  <text x="630" y="266" text-anchor="middle" class="small">primary + replica, ~1/4 of customers</text>

  <path class="line dashed" d="M390 130 L498 44" style="stroke: var(--line)"/>
  <path class="line dashed" d="M390 140 L498 112" style="stroke: var(--line)"/>
  <path class="line dashed" d="M390 165 L498 250" style="stroke: var(--line)"/>
  <path class="line ok" d="M390 155 L498 181" marker-end="url(#arr-shd-1)"/>
  <text x="445" y="92" text-anchor="middle" class="small">no key:</text>
  <text x="445" y="106" text-anchor="middle" class="small">ask all 4</text>
</svg>
<figcaption>A query that carries the shard key goes to one shard. A query without it has to fan out to all of them (dashed) and merge the answers. Each shard is a normal database with its own replicas and backups.</figcaption>
</figure>

<h3>Mapping strategies</h3>
<ul>
  <li><strong>Range.</strong> Each shard owns a contiguous range of keys (customers 1–1M on shard 0, 1M–2M on shard 1). Range scans stay local and a hot range is easy to split. But if the key grows over time (auto-increment IDs, timestamps), <em>every new row lands on the last shard</em>.</li>
  <li><strong>Hash.</strong> Map <code>hash(key)</code> to a shard. Keys scatter evenly, monotonic IDs included, but range queries on the key hit every shard. The naive form, <code>hash(key) mod N</code>, moves almost every key when <code>N</code> changes.</li>
  <li><strong>Consistent hashing.</strong> Karger et al. (1997) put shards and keys on the same circle of hash values. A key belongs to the first shard point clockwise from it. A new shard only takes over the arcs just before its points, so about <code>1/N</code> of keys move, all <em>to the new shard</em>. Many points per shard ("virtual nodes") even out the arc sizes.</li>
  <li><strong>Directory and geo.</strong> A lookup table (<code>tenant 42 → shard 2</code>) lets you move any tenant on its own, at the cost of a lookup on every request. Geo sharding keeps a region's users in that region for latency and data residency.</li>
</ul>

<figure class="diagram">
<svg viewBox="0 0 780 345" role="img" aria-label="Two consistent-hash rings. Left: four shards s0 to s3, each with two points on the ring; a key belongs to the next point clockwise, here s2. Right: after adding s4 with two points, only the two arcs just before the s4 points change owner, highlighted; the key now belongs to s4. Everything else stays where it was.">
  <text x="190" y="24" text-anchor="middle" class="title">4 shards (2 points each)</text>
  <text x="590" y="24" text-anchor="middle" class="title">Add s4: only 2 arcs move</text>
  <ellipse class="box muted" cx="190" cy="175" rx="105" ry="105"/>
  <ellipse class="box " cx="225.9" cy="76.3" rx="6" ry="6"/>
  <text x="232.8" y="61.5" text-anchor="middle" class="small">s0</text>
  <ellipse class="box " cx="285.2" cy="130.6" rx="6" ry="6"/>
  <text x="303.3" y="126.2" text-anchor="middle" class="small">s1</text>
  <ellipse class="box " cx="288.7" cy="210.9" rx="6" ry="6"/>
  <text x="307.5" y="221.8" text-anchor="middle" class="small">s2</text>
  <ellipse class="box " cx="225.9" cy="273.7" rx="6" ry="6"/>
  <text x="232.8" y="296.5" text-anchor="middle" class="small">s3</text>
  <ellipse class="box " cx="145.6" cy="270.2" rx="6" ry="6"/>
  <text x="137.2" y="292.3" text-anchor="middle" class="small">s0</text>
  <ellipse class="box " cx="91.3" cy="210.9" rx="6" ry="6"/>
  <text x="72.5" y="221.8" text-anchor="middle" class="small">s1</text>
  <ellipse class="box " cx="94.8" cy="130.6" rx="6" ry="6"/>
  <text x="76.7" y="126.2" text-anchor="middle" class="small">s2</text>
  <ellipse class="box " cx="145.6" cy="79.8" rx="6" ry="6"/>
  <text x="137.2" y="65.7" text-anchor="middle" class="small">s3</text>
  <ellipse class="box bad" cx="292.7" cy="153.2" rx="5" ry="5"/>
  <text x="269.2" y="162.2" text-anchor="middle" class="small">key</text>
  <ellipse class="box muted" cx="590" cy="175" rx="105" ry="105"/>
  <path class="line accent" style="stroke-width: 6" d="M685.2 130.6 A105 105 0 0 1 695.0 175.0"/>
  <path class="line accent" style="stroke-width: 6" d="M545.6 270.2 A105 105 0 0 1 509.6 242.5"/>
  <ellipse class="box " cx="625.9" cy="76.3" rx="6" ry="6"/>
  <text x="632.8" y="61.5" text-anchor="middle" class="small">s0</text>
  <ellipse class="box " cx="685.2" cy="130.6" rx="6" ry="6"/>
  <text x="703.3" y="126.2" text-anchor="middle" class="small">s1</text>
  <ellipse class="box " cx="688.7" cy="210.9" rx="6" ry="6"/>
  <text x="707.5" y="221.8" text-anchor="middle" class="small">s2</text>
  <ellipse class="box " cx="625.9" cy="273.7" rx="6" ry="6"/>
  <text x="632.8" y="296.5" text-anchor="middle" class="small">s3</text>
  <ellipse class="box " cx="545.6" cy="270.2" rx="6" ry="6"/>
  <text x="537.2" y="292.3" text-anchor="middle" class="small">s0</text>
  <ellipse class="box " cx="491.3" cy="210.9" rx="6" ry="6"/>
  <text x="472.5" y="221.8" text-anchor="middle" class="small">s1</text>
  <ellipse class="box " cx="494.8" cy="130.6" rx="6" ry="6"/>
  <text x="476.7" y="126.2" text-anchor="middle" class="small">s2</text>
  <ellipse class="box " cx="545.6" cy="79.8" rx="6" ry="6"/>
  <text x="537.2" y="65.7" text-anchor="middle" class="small">s3</text>
  <ellipse class="box accent" cx="695.0" cy="175.0" rx="6" ry="6"/>
  <text x="715.0" y="179.0" text-anchor="middle" class="small">s4</text>
  <ellipse class="box accent" cx="509.6" cy="242.5" rx="6" ry="6"/>
  <text x="494.2" y="259.3" text-anchor="middle" class="small">s4</text>
  <ellipse class="box bad" cx="692.7" cy="153.2" rx="5" ry="5"/>
  <text x="669.2" y="162.2" text-anchor="middle" class="small">key</text>
  <text x="190" y="315" text-anchor="middle" class="small">key's next point clockwise is s2</text>
  <text x="590" y="315" text-anchor="middle" class="small">the highlighted arcs now belong to s4;</text>
  <text x="590" y="331" text-anchor="middle" class="small">the key moves from s2 to s4, nothing else changes</text>
</svg>
<figcaption>Consistent hashing in one picture. With <code>hash mod N</code>, going from 4 to 5 shards moves about 80% of keys (the Go example below measures 79.7%). On the ring it moves about 1/5 (20.3%), and every moved key goes to the new shard, so old shards only send data, never shuffle among themselves.</figcaption>
</figure>

<h3>Logical shards: decouple "how many pieces" from "how many servers"</h3>
<p>Real systems rarely map keys straight to servers. They create many <strong>logical shards</strong> up front and place several on each physical server. Notion, for example, sharded Postgres into 480 logical shards (one Postgres schema each) over 32 physical databases, keyed by workspace ID. Instagram's early design used thousands of logical shards as Postgres schemas on a few machines. Growing then means moving whole logical shards to new servers, with no re-hashing of keys. Vitess does a similar thing with keyspace ID ranges (shards named like <code>-80</code> and <code>80-</code>) that can be split in two. MongoDB splits data into chunks that its balancer moves between shards.</p>

<h3>Choosing the shard key</h3>
<p>This is the decision that's hardest to undo. A good key has:</p>
<ul>
  <li><strong>High cardinality.</strong> Many distinct values. <code>country</code> gives you about 200 buckets and one of them is huge. <code>customer_id</code> gives millions.</li>
  <li><strong>Even load per value.</strong> Not just even row counts, even <em>traffic</em>. One celebrity account or one enterprise tenant can outweigh thousands of others.</li>
  <li><strong>Query locality.</strong> Your hottest queries should contain the key, so they hit one shard. For a multi-tenant SaaS that is almost always <code>tenant_id</code>. For a consumer app it is usually <code>user_id</code>. Shard related tables by the <em>same</em> key (orders, order_items and payments all by <code>customer_id</code>) so their joins and transactions stay on one shard. Citus calls this co-location.</li>
  <li><strong>Stability.</strong> The key value should never change. Changing it means moving the row to another shard.</li>
</ul>

<h3>What gets harder</h3>
<ul>
  <li><strong>Cross-shard queries.</strong> "Top 10 products by sales today" has to ask every shard and merge. It is slower and the slowest shard decides the latency (see <a href="#tail-latency">Tail Latency</a>). Analytics usually moves to a warehouse fed by change data capture instead.</li>
  <li><strong>Cross-shard transactions.</strong> A transfer between two customers on different shards is no longer one <code>BEGIN … COMMIT</code>. You need two-phase commit or a saga (see <a href="#distributed-transactions">Distributed Transactions</a> and <a href="#saga-pattern">Saga Pattern</a>), or a design that avoids it.</li>
  <li><strong>Unique IDs.</strong> Each shard's auto-increment starts at 1, so IDs collide. Options: UUIDs (UUIDv7, standardized in RFC 9562, starts with a 48-bit Unix millisecond timestamp so new IDs sort roughly by time and index well), or Snowflake-style 64-bit IDs (Twitter's layout: 41 bits of milliseconds, 10 bits of machine ID, 12 bits of sequence). Instagram's variant puts the logical shard ID inside the ID (41 bits time, 13 bits shard, 10 bits sequence), so the ID itself tells you where the row lives.</li>
  <li><strong>Unique constraints and foreign keys.</strong> The database can only enforce them within one shard. "Email is unique across all users" needs a separate lookup table or service.</li>
  <li><strong>Operations times N.</strong> Every migration runs N times and can half-succeed. Backups, monitoring and failover all multiply.</li>
</ul>

<h3>Strategies compared</h3>
<table>
  <tr><th>Strategy</th><th>Key → shard</th><th>Good at</th><th>Bad at</th><th>Seen in</th></tr>
  <tr><td>Range</td><td>key falls in [lo, hi)</td><td>range scans, splitting a hot range</td><td>monotonic keys: all new writes hit the last shard</td><td>MongoDB ranged sharding, HBase, Bigtable, Spanner splits</td></tr>
  <tr><td>Hash mod N</td><td><code>hash(key) % N</code></td><td>even spread, trivial to code</td><td>changing N moves ~all keys; range queries fan out</td><td>hand-rolled app sharding</td></tr>
  <tr><td>Consistent hash</td><td>next point clockwise on a ring</td><td>adding a shard moves ~1/N of keys</td><td>needs virtual nodes to balance; range queries fan out</td><td>Cassandra, Dynamo, Riak, cache clients</td></tr>
  <tr><td>Hash into fixed slots</td><td>hash into many logical shards, map those to servers</td><td>even spread and cheap rebalancing</td><td>slot count is fixed up front (pick it big)</td><td>Vitess keyspace IDs, Citus shards, Redis Cluster's 16384 slots</td></tr>
  <tr><td>Directory</td><td>lookup table</td><td>move any tenant, isolate big tenants</td><td>directory is on every request's path</td><td>many multi-tenant SaaS backends</td></tr>
  <tr><td>Geo</td><td>user's region</td><td>latency, data residency</td><td>users who move; uneven regions</td><td>global consumer apps</td></tr>
</table>

<h3>Tools that do the routing for you</h3>
<table>
  <tr><th>System</th><th>What it shards</th><th>Shard key term</th><th>Notes</th></tr>
  <tr><td>Vitess</td><td>MySQL</td><td>primary vindex → keyspace ID</td><td>VTGate routes queries; lookup vindexes avoid scatter queries on secondary columns; resharding splits keyspace ID ranges online.</td></tr>
  <tr><td>Citus</td><td>PostgreSQL (extension)</td><td>distribution column</td><td><code>create_distributed_table</code>; co-located tables join locally; small tables can be reference tables copied to every node.</td></tr>
  <tr><td>MongoDB</td><td>collections</td><td>shard key (ranged or hashed)</td><td><code>mongos</code> routes; queries without the key are broadcast to all shards. The key can be refined (4.4+) or changed with <code>reshardCollection</code> (5.0+).</td></tr>
  <tr><td>DynamoDB</td><td>tables, fully managed</td><td>partition key</td><td>Each partition serves at most 3,000 read units and 1,000 write units per second, so one hot key is throttled no matter how much table capacity you buy.</td></tr>
</table>
<pre><code>-- Citus (not executed here): shard two tables the same way so joins stay local
SELECT create_distributed_table('customers', 'customer_id');
SELECT create_distributed_table('orders', 'customer_id', colocate_with =&gt; 'customers');

-- routed to ONE shard: the shard key is in the WHERE clause
SELECT * FROM orders WHERE customer_id = 42 AND status = 'open';

-- fans out to EVERY shard and merges: no shard key
SELECT * FROM orders WHERE created_at &gt; now() - interval '1 hour';</code></pre>

<figure class="diagram">
<svg viewBox="0 0 780 150" role="img" aria-label="Resharding in five steps: copy existing rows to the new shard, catch up with ongoing writes by double-writing or replaying a change log, verify by comparing rows and dark reads, cut over by flipping the shard map with a short write pause, then clean up by deleting moved rows from the old shard.">
  <defs><marker id="arr-shd-2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <rect class="box" x="10" y="30" width="134" height="90" rx="8"/>
  <text x="77" y="55" text-anchor="middle" class="title">1. Copy</text>
  <text x="77" y="77" text-anchor="middle" class="small">snapshot + backfill</text>
  <text x="77" y="93" text-anchor="middle" class="small">existing rows to</text>
  <text x="77" y="109" text-anchor="middle" class="small">the new shard</text>
  <path class="line" d="M144 75 H164" marker-end="url(#arr-shd-2)"/>
  <rect class="box" x="166" y="30" width="134" height="90" rx="8"/>
  <text x="233" y="55" text-anchor="middle" class="title">2. Catch up</text>
  <text x="233" y="77" text-anchor="middle" class="small">double-write, or</text>
  <text x="233" y="93" text-anchor="middle" class="small">replay the change</text>
  <text x="233" y="109" text-anchor="middle" class="small">log since snapshot</text>
  <path class="line" d="M300 75 H320" marker-end="url(#arr-shd-2)"/>
  <rect class="box" x="322" y="30" width="134" height="90" rx="8"/>
  <text x="389" y="55" text-anchor="middle" class="title">3. Verify</text>
  <text x="389" y="77" text-anchor="middle" class="small">compare row counts</text>
  <text x="389" y="93" text-anchor="middle" class="small">and checksums;</text>
  <text x="389" y="109" text-anchor="middle" class="small">dark reads from both</text>
  <path class="line" d="M456 75 H476" marker-end="url(#arr-shd-2)"/>
  <rect class="box accent" x="478" y="30" width="134" height="90" rx="8"/>
  <text x="545" y="55" text-anchor="middle" class="title">4. Cut over</text>
  <text x="545" y="77" text-anchor="middle" class="small">pause writes briefly,</text>
  <text x="545" y="93" text-anchor="middle" class="small">drain the lag,</text>
  <text x="545" y="109" text-anchor="middle" class="small">flip the shard map</text>
  <path class="line" d="M612 75 H632" marker-end="url(#arr-shd-2)"/>
  <rect class="box ok" x="634" y="30" width="134" height="90" rx="8"/>
  <text x="701" y="55" text-anchor="middle" class="title">5. Clean up</text>
  <text x="701" y="77" text-anchor="middle" class="small">delete moved rows</text>
  <text x="701" y="93" text-anchor="middle" class="small">from the old shard,</text>
  <text x="701" y="109" text-anchor="middle" class="small">keep a rollback path</text>
  <text x="390" y="142" text-anchor="middle" class="small">steps 1 to 3 run while production traffic keeps flowing to the old shard</text>
</svg>
<figcaption>Online resharding. Vitess and MongoDB automate this; with hand-rolled sharding you build it yourself. Notion's migration followed this shape: an audit log for double-writes, a backfill of about three days, verification scripts plus dark reads, then a short planned downtime for the final cutover.</figcaption>
</figure>

<h2>Example</h2>
<p><strong>Why consistent hashing, measured.</strong> The router below is the core of an app-side sharding layer: a naive <code>hash mod N</code> function and a consistent-hash ring with virtual nodes. It uses only the standard library.</p>
<pre><code>package sharding

import (
	"crypto/md5"
	"encoding/binary"
	"slices"
	"strconv"
)

// hash takes the first 4 bytes of MD5, like the classic ketama ring.
// Not for security: it just spreads short, similar keys ("s1#7") evenly.
// xxhash or murmur3 work too. Plain FNV-32 skewed this ring badly in testing.
func hash(s string) uint32 {
	sum := md5.Sum([]byte(s))
	return binary.BigEndian.Uint32(sum[:4])
}

// ModN is the naive router: hash the key, take it modulo the shard count.
func ModN(key string, n int) int {
	return int(hash(key) % uint32(n))
}

// Ring is a consistent-hash ring. Each shard owns many points ("virtual
// nodes"); a key belongs to the first point clockwise from its hash.
type Ring struct {
	vnodes int
	points []uint32          // sorted positions on the ring
	owner  map[uint32]string // position -&gt; shard name
}

func NewRing(vnodes int, shards ...string) *Ring {
	r := &amp;Ring{vnodes: vnodes, owner: map[uint32]string{}}
	for _, s := range shards {
		r.Add(s)
	}
	return r
}

func (r *Ring) Add(shard string) {
	for i := 0; i &lt; r.vnodes; i++ {
		p := hash(shard + "#" + strconv.Itoa(i))
		r.owner[p] = shard
		r.points = append(r.points, p)
	}
	slices.Sort(r.points)
}

func (r *Ring) Get(key string) string {
	h := hash(key)
	i, _ := slices.BinarySearch(r.points, h) // first point &gt;= h
	if i == len(r.points) {
		i = 0 // wrap around the ring
	}
	return r.owner[r.points[i]]
}</code></pre>
<p>Two <code>Example</code> tests with 100,000 keys. <code>go test</code> fails if the printed output stops matching the <code>// Output:</code> comment, so these numbers are real.</p>
<pre><code>package sharding

import "fmt"

const keys = 100_000

func Example_reshard() {
	names := []string{"s0", "s1", "s2", "s3"}

	moved := 0
	for i := 0; i &lt; keys; i++ {
		k := fmt.Sprintf("user:%d", i)
		if ModN(k, 4) != ModN(k, 5) {
			moved++
		}
	}
	fmt.Printf("hash mod N, 4 -&gt; 5 shards: %5.1f%% of keys move&#92;n", 100*float64(moved)/keys)

	ring := NewRing(200, names...)
	before := make([]string, keys)
	for i := range before {
		before[i] = ring.Get(fmt.Sprintf("user:%d", i))
	}
	ring.Add("s4")
	moved, toNew := 0, 0
	for i := range before {
		if now := ring.Get(fmt.Sprintf("user:%d", i)); now != before[i] {
			moved++
			if now == "s4" {
				toNew++
			}
		}
	}
	fmt.Printf("consistent hash, 4 -&gt; 5:   %5.1f%% of keys move (%d of %d to the new shard)&#92;n",
		100*float64(moved)/keys, toNew, moved)
	// Output:
	// hash mod N, 4 -&gt; 5 shards:  79.7% of keys move
	// consistent hash, 4 -&gt; 5:    20.3% of keys move (20311 of 20311 to the new shard)
}

func Example_vnodes() {
	for _, v := range []int{1, 10, 200} {
		ring := NewRing(v, "s0", "s1", "s2", "s3")
		load := map[string]int{}
		for i := 0; i &lt; keys; i++ {
			load[ring.Get(fmt.Sprintf("user:%d", i))]++
		}
		fmt.Printf("%3d vnodes/shard: s0=%5d s1=%5d s2=%5d s3=%5d&#92;n",
			v, load["s0"], load["s1"], load["s2"], load["s3"])
	}
	// Output:
	// 1 vnodes/shard: s0=45069 s1= 1774 s2=26711 s3=26446
	//  10 vnodes/shard: s0=20605 s1=24457 s2=21854 s3=33084
	// 200 vnodes/shard: s0=23281 s1=25311 s2=26967 s3=24441
}</code></pre>
<pre><code>=== RUN   Example_reshard
--- PASS: Example_reshard (0.07s)
=== RUN   Example_vnodes
--- PASS: Example_vnodes (0.06s)
PASS</code></pre>
<p>Read it like this:</p>
<ul>
  <li><strong>mod N: 79.7% moved.</strong> A key stays only if <code>h mod 4 == h mod 5</code>, which is true for 4 out of every 20 hash values. So 80% of rows would have to be copied between servers just to add one. Nobody can do that online.</li>
  <li><strong>Ring: 20.3% moved, and all of them to <code>s4</code>.</strong> That is close to the ideal 1/5. The new shard takes a slice from each old one; the old shards never trade rows with each other.</li>
  <li><strong>Virtual nodes matter.</strong> With 1 point per shard, the arcs are random sizes: one shard got 45,069 keys and another 1,774, a 25× difference. With 200 points per shard, the spread is 23–27k, within about ±8% of the ideal 25,000.</li>
</ul>

<p><strong>Real-world scenario.</strong> A B2B invoicing SaaS runs on one Postgres primary with 2 read replicas. At 9,000 writes per second at month end, the primary's disk is the bottleneck, and the invoices table is 6 TB, so a restore from backup takes most of a day. Reads are fine; writes and size are not. The team picks <code>tenant_id</code> as the shard key: 98% of queries already filter on it, and invoices, line items and payments all belong to one tenant. They create 256 logical shards (hash of <code>tenant_id</code>) spread over 4 physical primaries, so each primary takes roughly a quarter of the writes, and a restore covers 1.5 TB. Two things bite. First, one tenant is a retailer that generates 12% of all invoices. Its logical shard runs hot, so they move that tenant to a dedicated server through a directory override. Second, a "global search across all tenants" admin page now fans out to 4 servers. It moves to a search index fed by change data capture. Global invoice numbers switch from a sequence to UUIDv7.</p>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>Sharding too early.</strong> It is a one-way door. Most apps that think they need it need an index, a cache, a replica or a partitioned table. Get the numbers that prove one primary can't keep up with writes first.</li>
  <li><strong>A key that doesn't match the queries.</strong> Shard <code>orders</code> by <code>order_id</code> and "show customer 42's orders" becomes a scatter query on every page load. Shard by what your hot paths filter on.</li>
  <li><strong>Monotonic key with range sharding.</strong> Timestamps and auto-increment IDs send every insert to the last shard. Hash them, or prefix them with something well spread.</li>
  <li><strong>Hot keys.</strong> Even hashing doesn't help when one key gets 10% of the traffic. Give big tenants their own shard (directory), or split a hot key with a suffix (<code>key#0..key#9</code>) and merge on read; DynamoDB's docs call this write sharding.</li>
  <li><strong><code>hash mod N</code> in production.</strong> It works until you add a shard, then nearly everything moves. Use a ring or a fixed set of logical shards from day one.</li>
  <li><strong>Too few logical shards.</strong> You can't split finer than the slot count you started with without re-hashing. Pick many (hundreds to thousands) and pack them onto a few servers.</li>
  <li><strong>Assuming cross-shard work is rare.</strong> Reports, admin screens, uniqueness checks and transfers appear in every product. Plan where each lives: fan-out, a separate store, a saga.</li>
  <li><strong>Resharding without a rollback path.</strong> Keep the old shard's data and a way to flip the map back until the new layout has run clean for a while.</li>
</ul>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>Sharding spreads <em>writes and data</em> over independent servers. It is the only fix when one primary can't take the write load, and it is costly forever.</li>
  <li>The shard key decides everything: pick high cardinality, even traffic, and the column your hot queries already filter on. Co-locate related tables on it.</li>
  <li>Never use <code>hash mod N</code> directly. Use consistent hashing with virtual nodes, or many logical shards mapped onto few servers, so adding capacity moves ~1/N of data.</li>
  <li>Cross-shard queries, transactions, unique constraints and IDs all need a new design. Decide on them before you split.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#partitioning">Partitioning</a> · <a href="#read-replicas">Read Replicas</a> · <a href="#distributed-transactions">Distributed Transactions</a> · <a href="#saga-pattern">Saga Pattern</a> · <a href="#horizontal-scaling">Horizontal Scaling</a> · <a href="#real-world-data-layer">Real-World Data Layer</a></p>
`;

CONTENT["partitioning"] = `
<p class="tldr"><strong>TL;DR</strong>: Partitioning splits one large table into smaller physical pieces <em>inside the same database</em>, by a partition key such as a month. Queries that filter on the key only touch the pieces they need, and deleting old data becomes dropping a piece instead of deleting billions of rows. It is like a filing cabinet with one drawer per month: you only open March's drawer to find a March invoice, and when last year's records expire you throw the whole drawer out.</p>

<h2>The problem it solves</h2>
<p>Some tables only grow: events, audit logs, orders, metrics, chat messages. At hundreds of millions of rows, three things start to hurt, even with good indexes:</p>
<ul>
  <li><strong>Deleting old data.</strong> "Keep 12 months" means a nightly <code>DELETE … WHERE created_at &lt; now() - interval '12 months'</code>. That touches every expired row, writes WAL for each one, leaves dead rows for vacuum to clean, and can run for hours while it fights live traffic.</li>
  <li><strong>Big, cold indexes.</strong> Most queries ask about the last few days, but the B-tree covers years of data. Index and table pages for old data crowd hot pages out of memory.</li>
  <li><strong>Maintenance on one giant object.</strong> <code>VACUUM</code>, <code>ANALYZE</code>, reindexing and backups all have to process the whole table at once.</li>
</ul>
<p>Partitioning cuts the table into pieces along the key you query and expire by. The application still sees one table called <code>order_events</code>. Under it, each month is its own table with its own indexes. This all happens on one server, which is the key difference from <a href="#sharding">Sharding</a>.</p>

<h2>How it works</h2>
<p>In PostgreSQL's declarative partitioning (version 10 and later), you create a <strong>partitioned table</strong> that holds no rows itself, then attach <strong>partitions</strong> to it, each with a bound. Every <code>INSERT</code> is routed to the partition whose bound contains the row's key. Every query is checked against the bounds: partitions that can't contain matching rows are skipped. That is <strong>partition pruning</strong>.</p>
<figure class="diagram">
<svg viewBox="0 0 780 290" role="img" aria-label="The partitioned table order_events holds no data itself. An INSERT for 14 May is routed to the May partition. A query for March is pruned to the March partition only; January, February, April, May and June are skipped.">
  <defs><marker id="arr-part-1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <rect class="box" x="20" y="20" width="230" height="56" rx="8"/>
  <text x="135" y="43" text-anchor="middle" class="small">SELECT count(*) WHERE created_at</text>
  <text x="135" y="61" text-anchor="middle" class="small">&gt;= '2026-03-01' AND &lt; '2026-04-01'</text>
  <rect class="box" x="530" y="20" width="230" height="56" rx="8"/>
  <text x="645" y="43" text-anchor="middle" class="small">INSERT ... created_at =</text>
  <text x="645" y="61" text-anchor="middle" class="small">'2026-05-14 09:30'</text>

  <rect class="box accent" x="240" y="110" width="300" height="56" rx="8"/>
  <text x="390" y="134" text-anchor="middle" class="title">order_events (partitioned table)</text>
  <text x="390" y="152" text-anchor="middle" class="small">no rows of its own; PARTITION BY RANGE (created_at)</text>
  <path class="line" d="M135 76 L300 108" marker-end="url(#arr-part-1)"/>
  <path class="line" d="M645 76 L480 108" marker-end="url(#arr-part-1)"/>

  <rect class="box muted" x="20" y="200" width="110" height="50" rx="8"/>
  <text x="75" y="222" text-anchor="middle">2026_01</text><text x="75" y="239" text-anchor="middle" class="small">pruned</text>
  <rect class="box muted" x="146" y="200" width="110" height="50" rx="8"/>
  <text x="201" y="222" text-anchor="middle">2026_02</text><text x="201" y="239" text-anchor="middle" class="small">pruned</text>
  <rect class="box ok" x="272" y="200" width="110" height="50" rx="8"/>
  <text x="327" y="222" text-anchor="middle" class="title">2026_03</text><text x="327" y="239" text-anchor="middle" class="small">scanned</text>
  <rect class="box muted" x="398" y="200" width="110" height="50" rx="8"/>
  <text x="453" y="222" text-anchor="middle">2026_04</text><text x="453" y="239" text-anchor="middle" class="small">pruned</text>
  <rect class="box accent" x="524" y="200" width="110" height="50" rx="8"/>
  <text x="579" y="222" text-anchor="middle" class="title">2026_05</text><text x="579" y="239" text-anchor="middle" class="small">row stored here</text>
  <rect class="box muted" x="650" y="200" width="110" height="50" rx="8"/>
  <text x="705" y="222" text-anchor="middle">2026_06</text><text x="705" y="239" text-anchor="middle" class="small">pruned</text>
  <path class="line ok" d="M350 166 L327 198" marker-end="url(#arr-part-1)"/>
  <path class="line accent" d="M450 166 L570 198" marker-end="url(#arr-part-1)"/>
  <text x="390" y="278" text-anchor="middle" class="small">each partition is a real table with its own indexes, files and statistics</text>
</svg>
<figcaption>Routing and pruning. Writes go to the one partition whose range contains the key. A query that filters on the key reads only the matching partitions. A query that doesn't filter on the key still has to visit all of them.</figcaption>
</figure>

<h3>Three ways to split</h3>
<ul>
  <li><strong>RANGE</strong>: each partition covers <code>[from, to)</code>, lower bound included, upper excluded. Time is the classic key: one partition per day, week or month.</li>
  <li><strong>LIST</strong>: each partition lists its key values, such as regions or tenants on different plans.</li>
  <li><strong>HASH</strong> (PostgreSQL 11+): rows go to <code>hash(key) mod MODULUS</code>. Use it to split a huge table into evenly sized pieces when no natural range exists. You lose the easy retention story, since every partition holds data of all ages.</li>
</ul>
<p>A <strong>DEFAULT</strong> partition (also 11+) catches rows that match no other partition. Without one, an insert outside every bound fails, as the example below shows. Partitions can also be partitioned again (say by month, then by region), but every level adds planning work.</p>
<pre><code>-- not executed here; the Go example below runs the same shapes for real
CREATE TABLE order_events (
    order_id   bigint      NOT NULL,
    created_at timestamptz NOT NULL,
    kind       text        NOT NULL,
    PRIMARY KEY (order_id, created_at)        -- must contain created_at
) PARTITION BY RANGE (created_at);

CREATE TABLE order_events_2026_03 PARTITION OF order_events
    FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');   -- upper bound excluded

CREATE INDEX ON order_events (kind);          -- created on every partition

-- LIST: one partition per discrete value
CREATE TABLE accounts (id bigint, region text, ...) PARTITION BY LIST (region);
CREATE TABLE accounts_eu PARTITION OF accounts FOR VALUES IN ('eu-west', 'eu-central');
CREATE TABLE accounts_other PARTITION OF accounts DEFAULT;  -- catches the rest

-- HASH: N even buckets when there is no natural range
CREATE TABLE carts_p0 PARTITION OF carts FOR VALUES WITH (MODULUS 4, REMAINDER 0);</code></pre>

<h3>The rules that surprise people</h3>
<ul>
  <li><strong>Primary keys and unique constraints must include the partition key.</strong> Each partition enforces uniqueness only within itself, so PostgreSQL requires the constraint's columns to contain every partition key column. <code>PRIMARY KEY (order_id)</code> is rejected on a table partitioned by <code>created_at</code>; <code>(order_id, created_at)</code> works. There is no global index spanning partitions. MySQL has the same rule: every unique key must use every column in the partitioning expression.</li>
  <li><strong>Indexes are per partition.</strong> An index created on the parent is created on each partition, including ones attached later. Each is smaller than one giant index, which helps vacuum and cache.</li>
  <li><strong>Pruning needs the key in the query.</strong> <code>WHERE created_at &gt;= $1</code> prunes. <code>WHERE order_id = 42</code> visits every partition: six index lookups instead of one. Pruning also works at execution time, for values only known then (bind parameters, subquery results). <code>EXPLAIN ANALYZE</code> then reports <code>Subplans Removed</code>.</li>
  <li><strong>More partitions isn't free.</strong> PostgreSQL's docs say the planner handles up to a few thousand partitions fairly well <em>if</em> typical queries prune all but a few. Planning time and memory grow with the partitions left after pruning, and each session loads metadata for every partition it touches. Daily partitions for ten years is 3,650 tables. Monthly is 120.</li>
</ul>

<h3>Retention: drop a partition instead of deleting rows</h3>
<p>This is the biggest win for time-series tables. Removing a month is a metadata change: <code>DETACH PARTITION</code> removes it from the parent, and <code>DROP TABLE</code> deletes its files. There's no per-row work, no WAL per row, and no dead rows to vacuum. PostgreSQL's docs call it "far faster than a bulk operation". Plain <code>DETACH</code> takes an <code>ACCESS EXCLUSIVE</code> lock on the parent. It is brief, but it waits behind long queries and blocks everything queued after it, so set a <code>lock_timeout</code> (see <a href="#database-migrations">Database Migrations</a>). <code>DETACH … CONCURRENTLY</code> (PostgreSQL 14+) needs only <code>SHARE UPDATE EXCLUSIVE</code>, but it can't run inside a transaction block or when the parent has a default partition.</p>
<figure class="diagram">
<svg viewBox="0 0 780 170" role="img" aria-label="A sliding window of monthly partitions on a timeline. January is detached and dropped. February to June are live, with June receiving current writes. July is created ahead of time so inserts at midnight on July 1 have somewhere to go. A monthly cron job does both steps.">
  <defs><marker id="arr-part-2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <path class="line" d="M20 110 H760" marker-end="url(#arr-part-2)"/>
  <text x="745" y="132" text-anchor="end" class="small">time</text>
  <rect class="box bad" x="25" y="50" width="90" height="44" rx="6"/>
  <text x="70" y="70" text-anchor="middle">Jan</text><text x="70" y="86" text-anchor="middle" class="small">DROP</text>
  <rect class="box" x="125" y="50" width="90" height="44" rx="6"/><text x="170" y="77" text-anchor="middle">Feb</text>
  <rect class="box" x="225" y="50" width="90" height="44" rx="6"/><text x="270" y="77" text-anchor="middle">Mar</text>
  <rect class="box" x="325" y="50" width="90" height="44" rx="6"/><text x="370" y="77" text-anchor="middle">Apr</text>
  <rect class="box" x="425" y="50" width="90" height="44" rx="6"/><text x="470" y="77" text-anchor="middle">May</text>
  <rect class="box ok" x="525" y="50" width="90" height="44" rx="6"/>
  <text x="570" y="70" text-anchor="middle">Jun</text><text x="570" y="86" text-anchor="middle" class="small">writes now</text>
  <rect class="box accent" x="625" y="50" width="90" height="44" rx="6"/>
  <text x="670" y="70" text-anchor="middle">Jul</text><text x="670" y="86" text-anchor="middle" class="small">pre-created</text>
  <path class="line dashed" d="M125 40 H615" style="stroke: var(--line)"/>
  <text x="370" y="30" text-anchor="middle" class="small">retention window: older data is queryable, read-mostly</text>
  <text x="70" y="140" text-anchor="middle" class="small">detach + drop</text>
  <text x="670" y="140" text-anchor="middle" class="small">create ahead</text>
  <text x="390" y="160" text-anchor="middle" class="small">one scheduled job does both ends, once a month</text>
</svg>
<figcaption>A sliding window. Create next month's partition well before it starts (an insert with no matching partition fails), and drop the oldest one when it leaves the retention window. Tools like the <code>pg_partman</code> extension, or a small <a href="#cron-jobs">cron job</a>, automate both.</figcaption>
</figure>
<pre><code>-- monthly cron (not executed here): create ahead, drop behind
CREATE TABLE IF NOT EXISTS order_events_2026_08 PARTITION OF order_events
    FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');

ALTER TABLE order_events DETACH PARTITION order_events_2026_01 CONCURRENTLY;
-- archive it first if you must keep it (pg_dump, COPY to object storage), then:
DROP TABLE order_events_2026_01;</code></pre>

<h3>Partitioning vs sharding vs vertical partitioning</h3>
<p>The words get mixed up, so here are the three meanings side by side.</p>
<figure class="diagram">
<svg viewBox="0 0 780 230" role="img" aria-label="Three ways to split data. Vertical partitioning splits columns: a users table becomes users with hot columns and user_profiles with a large blob, both on one server. Horizontal partitioning splits rows into monthly partitions on one server. Sharding splits rows across separate servers, each with its own database.">
  <text x="130" y="22" text-anchor="middle" class="title">Vertical partitioning</text>
  <text x="390" y="22" text-anchor="middle" class="title">Horizontal partitioning</text>
  <text x="650" y="22" text-anchor="middle" class="title">Sharding</text>
  <path class="line dashed" d="M260 10 V225" style="stroke: var(--line)"/>
  <path class="line dashed" d="M520 10 V225" style="stroke: var(--line)"/>

  <rect class="box muted" x="20" y="40" width="220" height="140" rx="8"/>
  <text x="130" y="58" text-anchor="middle" class="small">one server</text>
  <rect class="box" x="35" y="70" width="90" height="96" rx="6"/>
  <text x="80" y="92" text-anchor="middle">users</text>
  <text x="80" y="112" text-anchor="middle" class="small">id, email,</text>
  <text x="80" y="127" text-anchor="middle" class="small">name, plan</text>
  <rect class="box accent" x="135" y="70" width="90" height="96" rx="6"/>
  <text x="180" y="92" text-anchor="middle">profiles</text>
  <text x="180" y="112" text-anchor="middle" class="small">user_id,</text>
  <text x="180" y="127" text-anchor="middle" class="small">bio, avatar</text>
  <text x="130" y="200" text-anchor="middle" class="small">split by columns</text>
  <text x="130" y="216" text-anchor="middle" class="small">(hot vs wide or rarely read)</text>

  <rect class="box muted" x="280" y="40" width="220" height="140" rx="8"/>
  <text x="390" y="58" text-anchor="middle" class="small">one server, one table name</text>
  <rect class="box" x="295" y="70" width="190" height="26" rx="5"/><text x="390" y="88" text-anchor="middle" class="small">order_events_2026_04</text>
  <rect class="box" x="295" y="102" width="190" height="26" rx="5"/><text x="390" y="120" text-anchor="middle" class="small">order_events_2026_05</text>
  <rect class="box ok" x="295" y="134" width="190" height="26" rx="5"/><text x="390" y="152" text-anchor="middle" class="small">order_events_2026_06</text>
  <text x="390" y="200" text-anchor="middle" class="small">split by rows; this page</text>
  <text x="390" y="216" text-anchor="middle" class="small">(same CPU, disk, WAL)</text>

  <rect class="box" x="540" y="40" width="100" height="62" rx="8"/>
  <text x="590" y="64" text-anchor="middle">server A</text><text x="590" y="84" text-anchor="middle" class="small">customers 0..</text>
  <rect class="box" x="660" y="40" width="100" height="62" rx="8"/>
  <text x="710" y="64" text-anchor="middle">server B</text><text x="710" y="84" text-anchor="middle" class="small">customers ..</text>
  <rect class="box" x="540" y="118" width="100" height="62" rx="8"/>
  <text x="590" y="142" text-anchor="middle">server C</text><text x="590" y="162" text-anchor="middle" class="small">customers ..</text>
  <rect class="box" x="660" y="118" width="100" height="62" rx="8"/>
  <text x="710" y="142" text-anchor="middle">server D</text><text x="710" y="162" text-anchor="middle" class="small">customers ..</text>
  <text x="650" y="200" text-anchor="middle" class="small">split by rows across servers</text>
  <text x="650" y="216" text-anchor="middle" class="small">(more CPU, disk, WAL)</text>
</svg>
<figcaption>Partitioning makes one table easier to manage and query, but every partition still shares one machine's CPU, disk and write-ahead log. Only <a href="#sharding">sharding</a> adds write capacity. The two combine: Citus shards can be partitioned by time.</figcaption>
</figure>

<table>
  <tr><th>Type</th><th>Bound</th><th>Typical key</th><th>Best for</th><th>Watch out for</th></tr>
  <tr><td>RANGE</td><td><code>FROM (a) TO (b)</code>, b excluded</td><td><code>created_at</code>, date, sequential ID</td><td>time-series, logs, events; drop-a-month retention; queries on recent data</td><td>must create future partitions ahead; the newest partition takes all writes</td></tr>
  <tr><td>LIST</td><td><code>IN ('eu', 'us')</code></td><td>region, tenant tier, status</td><td>known small sets of values; moving one value's data to other storage</td><td>new values need a partition or a DEFAULT; uneven sizes</td></tr>
  <tr><td>HASH</td><td><code>WITH (MODULUS 4, REMAINDER 0)</code></td><td><code>customer_id</code>, UUID</td><td>splitting a huge table evenly when there is no natural range</td><td>no time-based retention; changing the modulus means rewriting data</td></tr>
  <tr><td>DEFAULT</td><td>everything else</td><td>any</td><td>safety net for unexpected keys</td><td>adding a partition must scan it for rows that belong to the new one</td></tr>
  <tr><td>Vertical (manual)</td><td>column sets in separate tables</td><td>primary key in both</td><td>wide rows, rarely read blobs, separating hot columns</td><td>joins to reassemble a row; not a database feature, just schema design</td></tr>
</table>

<h2>Example</h2>
<p><strong>Monthly partitions on a real PostgreSQL.</strong> The test starts an embedded PostgreSQL 18 server with <code>fergusstrange/embedded-postgres</code> (port 15443), connects with <code>pgx</code>, and loads 521,280 order events across January–June 2026, one every 30 seconds. A small <code>TestMain</code> starts and stops the server and isn't shown. Each <code>Example</code> prints real query plans and errors, and <code>go test</code> fails if they stop matching the <code>// Output:</code> block.</p>
<pre><code>package partitioning

import (
	"fmt"
	"strings"
)

// setup creates order_events, one partition per month (Jan..Jun 2026),
// and loads one event every 30 seconds: about 86k-89k rows per month.
func setup() error {
	_, err := conn.Exec(ctx, &#96;
		CREATE TABLE order_events (
			order_id   bigint      NOT NULL,
			created_at timestamptz NOT NULL,
			kind       text        NOT NULL,
			PRIMARY KEY (order_id, created_at)  -- must include the partition key
		) PARTITION BY RANGE (created_at)&#96;)
	if err != nil {
		return err
	}
	for m := 1; m &lt;= 6; m++ {
		_, err = conn.Exec(ctx, fmt.Sprintf(&#96;
			CREATE TABLE order_events_2026_%02d PARTITION OF order_events
			FOR VALUES FROM ('2026-%02d-01') TO ('2026-%02d-01')&#96;, m, m, m+1))
		if err != nil {
			return err
		}
	}
	_, err = conn.Exec(ctx, &#96;
		INSERT INTO order_events
		SELECT n, '2026-01-01'::timestamptz + n * interval '30 seconds', 'paid'
		FROM generate_series(0, 521279) AS n;  -- up to 2026-06-30 23:59:30
		ANALYZE order_events&#96;)
	return err
}

// explain prints a plan without costs, so the output is stable.
func explain(query string) {
	rows, _ := conn.Query(ctx, "EXPLAIN (COSTS OFF) "+query)
	for rows.Next() {
		var line string
		rows.Scan(&amp;line)
		fmt.Println(line)
	}
}

func Example_pruning() {
	fmt.Println("-- filter on the partition key: one partition scanned")
	explain(&#96;SELECT count(*) FROM order_events
	         WHERE created_at &gt;= '2026-03-01' AND created_at &lt; '2026-04-01'&#96;)
	fmt.Println("-- no partition key in WHERE: every partition scanned")
	explain(&#96;SELECT * FROM order_events WHERE order_id = 42&#96;)
	// Output:
	// -- filter on the partition key: one partition scanned
	// Aggregate
	//   -&gt;  Seq Scan on order_events_2026_03 order_events
	//         Filter: ((created_at &gt;= '2026-03-01 00:00:00+00'::timestamp with time zone) AND (created_at &lt; '2026-04-01 00:00:00+00'::timestamp with time zone))
	// -- no partition key in WHERE: every partition scanned
	// Append
	//   -&gt;  Index Scan using order_events_2026_01_pkey on order_events_2026_01 order_events_1
	//         Index Cond: (order_id = 42)
	//   -&gt;  Index Scan using order_events_2026_02_pkey on order_events_2026_02 order_events_2
	//         Index Cond: (order_id = 42)
	//   -&gt;  Index Scan using order_events_2026_03_pkey on order_events_2026_03 order_events_3
	//         Index Cond: (order_id = 42)
	//   -&gt;  Index Scan using order_events_2026_04_pkey on order_events_2026_04 order_events_4
	//         Index Cond: (order_id = 42)
	//   -&gt;  Index Scan using order_events_2026_05_pkey on order_events_2026_05 order_events_5
	//         Index Cond: (order_id = 42)
	//   -&gt;  Index Scan using order_events_2026_06_pkey on order_events_2026_06 order_events_6
	//         Index Cond: (order_id = 42)
}

func Example_rules() {
	_, err := conn.Exec(ctx, &#96;
		CREATE TABLE bad (id bigint PRIMARY KEY, created_at timestamptz NOT NULL)
		PARTITION BY RANGE (created_at)&#96;)
	fmt.Println("PK without partition key:", err)

	_, err = conn.Exec(ctx, &#96;INSERT INTO order_events VALUES (1, '2026-07-02', 'paid')&#96;)
	fmt.Println("row for July:", err)
	// Output:
	// PK without partition key: ERROR: unique constraint on partitioned table must include all partitioning columns (SQLSTATE 0A000)
	// row for July: ERROR: no partition of relation "order_events" found for row (SQLSTATE 23514)
}

func Example_hash() {
	conn.Exec(ctx, &#96;CREATE TABLE carts (customer_id bigint, items int) PARTITION BY HASH (customer_id)&#96;)
	for r := 0; r &lt; 4; r++ {
		conn.Exec(ctx, fmt.Sprintf(&#96;CREATE TABLE carts_p%d PARTITION OF carts
			FOR VALUES WITH (MODULUS 4, REMAINDER %d)&#96;, r, r))
	}
	conn.Exec(ctx, &#96;INSERT INTO carts SELECT n, 1 FROM generate_series(1, 10000) n&#96;)
	rows, _ := conn.Query(ctx, &#96;SELECT tableoid::regclass::text, count(*) FROM carts GROUP BY 1 ORDER BY 1&#96;)
	for rows.Next() {
		var p string
		var n int
		rows.Scan(&amp;p, &amp;n)
		fmt.Printf("%s: %d rows&#92;n", p, n)
	}
	// Output:
	// carts_p0: 2489 rows
	// carts_p1: 2527 rows
	// carts_p2: 2530 rows
	// carts_p3: 2454 rows
}

func Example_retention() {
	size := func(t string) string {
		var s string
		conn.QueryRow(ctx, "SELECT pg_size_pretty(pg_relation_size($1))", t).Scan(&amp;s)
		return s
	}
	// The slow way: DELETE a month row by row.
	before := size("order_events_2026_01")
	tag, _ := conn.Exec(ctx, &#96;DELETE FROM order_events WHERE created_at &lt; '2026-02-01'&#96;)
	fmt.Printf("DELETE: %d rows, table file %s -&gt; %s (dead rows wait for VACUUM)&#92;n",
		tag.RowsAffected(), before, size("order_events_2026_01"))

	// The partition way: detach and drop whole months. No per-row work.
	for _, p := range []string{"order_events_2026_01", "order_events_2026_02"} {
		conn.Exec(ctx, "ALTER TABLE order_events DETACH PARTITION "+p)
		conn.Exec(ctx, "DROP TABLE "+p)
	}
	rows, _ := conn.Query(ctx, &#96;SELECT tableoid::regclass::text FROM order_events GROUP BY 1 ORDER BY 1&#96;)
	var left []string
	for rows.Next() {
		var p string
		rows.Scan(&amp;p)
		left = append(left, p)
	}
	fmt.Println("partitions left:", strings.Join(left, ", "))
	// Output:
	// DELETE: 89280 rows, table file 4552 kB -&gt; 4552 kB (dead rows wait for VACUUM)
	// partitions left: order_events_2026_03, order_events_2026_04, order_events_2026_05, order_events_2026_06
}</code></pre>
<pre><code>=== RUN   Example_pruning
--- PASS: Example_pruning (0.00s)
=== RUN   Example_rules
--- PASS: Example_rules (0.00s)
=== RUN   Example_hash
--- PASS: Example_hash (0.01s)
=== RUN   Example_retention
--- PASS: Example_retention (0.04s)
PASS</code></pre>
<p>What the output shows:</p>
<ul>
  <li><strong>Pruning works.</strong> The March query plans a single <code>Seq Scan on order_events_2026_03</code>. The other five partitions don't appear in the plan at all. The <code>order_id = 42</code> query has no partition key, so it gets an <code>Append</code> over all six partitions' indexes: six lookups where an unpartitioned table needs one.</li>
  <li><strong>The rules are enforced.</strong> A primary key without <code>created_at</code> is rejected, and a July row fails because no partition covers July and there's no DEFAULT.</li>
  <li><strong>HASH spreads evenly.</strong> 10,000 sequential customer IDs land 2,454–2,530 per partition.</li>
  <li><strong>DELETE vs DROP.</strong> Deleting January's 89,280 rows leaves the partition's file at 4,552 kB: the space stays until vacuum, and every row was written to WAL. Detaching and dropping removes whole months and their files at once.</li>
</ul>

<p><strong>Real-world scenario.</strong> A delivery platform writes about 25 M tracking events a day into one <code>tracking_events</code> table and keeps 90 days, about 2.2 B rows. The nightly <code>DELETE</code> of the oldest day runs for 3 hours, generates tens of GB of WAL that makes replicas lag, and leaves bloat that autovacuum never fully clears. Moving to daily RANGE partitions on <code>event_time</code> changes three things. Retention becomes "detach and drop yesterday's 91st day", which takes well under a second. The "last 24 hours for this parcel" query prunes to one or two partitions, and their indexes fit in memory. Vacuum runs per partition, mostly on today's. The migration is the hard part. An existing table can't be turned into a partitioned table in place. One option is to attach the old table as a single big partition (with a matching <code>CHECK</code> constraint so the attach doesn't scan it) and let it age out. This team instead creates the partitioned table, writes to both for a short period, copies history in batches, and switches reads (the expand/contract steps in <a href="#database-migrations">Database Migrations</a>). They also find one query that filtered only on <code>parcel_id</code>. After partitioning it scanned 90 partitions, so they add <code>event_time</code> to it.</p>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>Partitioning on a key your queries don't use.</strong> No pruning means every query visits every partition, which is slower than one table. Pick the column that appears in nearly every hot <code>WHERE</code> clause, and that you expire data by.</li>
  <li><strong>Forgetting to create future partitions.</strong> At midnight on the first of the month, every insert fails with "no partition of relation … found for row". Create partitions weeks ahead and alert when fewer than N future partitions exist. A DEFAULT partition is a safety net, but adding a partition then scans it, and fails if it already holds rows that belong in the new partition. You have to move those rows out first.</li>
  <li><strong>Too many, too small partitions.</strong> Hourly partitions for years means tens of thousands of tables, slow planning and high per-session memory. Size partitions so typical queries hit one or a few, and each holds a meaningful amount of data.</li>
  <li><strong>Expecting global uniqueness.</strong> "<code>order_id</code> is unique" can't be enforced across partitions unless the constraint includes the partition key. Use an ID generator you trust (sequence, UUIDv7), or a separate unique table.</li>
  <li><strong>Functions on the key kill pruning.</strong> <code>WHERE date_trunc('month', created_at) = '2026-03-01'</code> can't be matched against the bounds. Write ranges: <code>created_at &gt;= '2026-03-01' AND created_at &lt; '2026-04-01'</code> (see <a href="#query-optimization">Query Optimization</a>).</li>
  <li><strong>Using partitioning to scale writes.</strong> All partitions share one server. If the primary's CPU or disk is saturated by writes, you need <a href="#sharding">Sharding</a>, not more partitions.</li>
  <li><strong>Plain DETACH during peak traffic.</strong> Its <code>ACCESS EXCLUSIVE</code> lock waits behind long queries and stalls everything queued after it. Use <code>CONCURRENTLY</code> where you can, and <code>lock_timeout</code> always.</li>
</ul>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>Partitioning splits one table into pieces on the same server. The app still sees one table.</li>
  <li>The wins come from pruning (queries filtering on the key read only matching partitions) and from dropping whole partitions for retention instead of mass <code>DELETE</code>s.</li>
  <li>Choose the key that hot queries filter on and data expires by. Usually that's time with RANGE. Primary keys must include it.</li>
  <li>It doesn't add write capacity; that is sharding. Automate partition creation ahead of time, and keep the count in the hundreds to low thousands.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#sharding">Sharding</a> · <a href="#database-indexing">Database Indexing</a> · <a href="#query-optimization">Query Optimization</a> · <a href="#database-migrations">Database Migrations</a> · <a href="#cron-jobs">Cron Jobs</a> · <a href="#real-world-data-layer">Real-World Data Layer</a></p>
`;

CONTENT["database-migrations"] = `
<p class="tldr"><strong>TL;DR</strong>: A database migration is a small, numbered script that changes the schema. Migrations live in git next to the code, run in order, and a table in the database records which ones have run, so every environment ends up with the same schema. The hard part isn't the runner. It's changing a table that live traffic is using: do it in small, backward-compatible steps (<strong>expand, migrate, contract</strong>), and never let a DDL statement wait for a lock without a timeout. Think of renovating a restaurant kitchen while it keeps serving: you add the new stove first, move the cooks over, and only then remove the old one.</p>

<h2>The problem it solves</h2>
<p>The schema is part of your program, but it lives in a different place. The code is rebuilt from git on every deploy. The database is not: it keeps every change ever made to it. Without a system, schema changes go wrong in predictable ways:</p>
<ul>
  <li><strong>Drift.</strong> Someone runs an <code>ALTER TABLE</code> by hand in staging and forgets production, or adds a hotfix index nobody wrote down. Now nobody can say what the "real" schema is.</li>
  <li><strong>No order and no history.</strong> Change B assumes change A already happened. A new developer's laptop, a fresh CI database and a disaster-recovery restore all need to replay every change, in the same order.</li>
  <li><strong>Downtime.</strong> A schema change on a busy table can lock it. Every request that touches the table waits, the connection pool fills up, and the service goes down, even when the change itself is "instant".</li>
  <li><strong>Old and new code at the same time.</strong> During a rolling deploy, the previous release is still serving traffic while the new one starts. Whatever the schema is at that moment, <em>both</em> releases must work with it.</li>
</ul>
<p>Migrations fix the first two problems almost for free. The last two need discipline, and that's most of this page.</p>

<h2>How it works</h2>
<p>Each change is a file with a version number: a timestamp or a counter, such as <code>00003_index_last_name.sql</code>. A migration tool (the <em>runner</em>) compares the files it has with a tracking table in the database, then applies the missing ones in order. After each one it records the version. Running it twice does nothing the second time.</p>
<figure class="diagram">
<svg viewBox="0 0 780 240" role="img" aria-label="Three migration files in the repository, where file 3 is new in this release. A runner takes an advisory lock, reads the version table, sees the database is at version 2, applies only file 3, and records version 3 in the goose_db_version table.">
  <defs><marker id="arr-mig-1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <text x="120" y="22" text-anchor="middle" class="title">Repository (git)</text>
  <text x="390" y="22" text-anchor="middle" class="title">Runner</text>
  <text x="660" y="22" text-anchor="middle" class="title">Database</text>

  <rect class="box" x="20" y="40" width="200" height="34" rx="6"/><text x="120" y="61" text-anchor="middle" class="small">00001_create_customers.sql</text>
  <rect class="box" x="20" y="84" width="200" height="34" rx="6"/><text x="120" y="105" text-anchor="middle" class="small">00002_expand_name_columns.sql</text>
  <rect class="box accent" x="20" y="128" width="200" height="34" rx="6"/><text x="120" y="149" text-anchor="middle" class="small">00003_index_last_name.sql</text>
  <text x="120" y="184" text-anchor="middle" class="small">file 3 is new in this release</text>

  <rect class="box accent" x="300" y="56" width="180" height="104" rx="6"/>
  <text x="390" y="80" text-anchor="middle" class="title">goose up</text>
  <text x="390" y="102" text-anchor="middle" class="small">1. take an advisory lock</text>
  <text x="390" y="120" text-anchor="middle" class="small">2. read the version table</text>
  <text x="390" y="138" text-anchor="middle" class="small">3. apply pending files</text>
  <path class="line" d="M222 108 H298" marker-end="url(#arr-mig-1)"/>
  <text x="260" y="100" text-anchor="middle" class="small">files</text>

  <path class="line accent" d="M482 92 H558" marker-end="url(#arr-mig-1)"/>
  <text x="520" y="84" text-anchor="middle" class="small">apply 3</text>
  <path class="line dashed" d="M558 128 H482" marker-end="url(#arr-mig-1)"/>
  <text x="520" y="146" text-anchor="middle" class="small">at v2</text>

  <rect class="box" x="560" y="40" width="200" height="162" rx="6"/>
  <text x="660" y="60" text-anchor="middle" class="title">goose_db_version</text>
  <rect class="box ok" x="575" y="70" width="170" height="22" rx="4"/><text x="660" y="85" text-anchor="middle" class="small">version 1, applied</text>
  <rect class="box ok" x="575" y="98" width="170" height="22" rx="4"/><text x="660" y="113" text-anchor="middle" class="small">version 2, applied</text>
  <rect class="box accent" x="575" y="126" width="170" height="22" rx="4"/><text x="660" y="141" text-anchor="middle" class="small">version 3, applied now</text>
  <text x="660" y="172" text-anchor="middle" class="small">customers table</text>
  <text x="660" y="188" text-anchor="middle" class="small">now matches the code</text>
  <text x="390" y="228" text-anchor="middle" class="small">A laptop, CI, staging and production all run the same files in the same order, so they end up with the same schema.</text>
</svg>
<figcaption>The version table is the database's memory of which files it has seen. The lock stops two runners (say, two pods starting at once) from applying the same file twice.</figcaption>
</figure>

<h3>The tools</h3>
<p>Every tool does the same core job. They differ in file format, in how much they generate for you, and in what they do when a migration fails halfway.</p>
<table>
  <tr><th>Tool</th><th>Migrations are</th><th>Tracking table</th><th>Rollback</th><th>Notes</th></tr>
  <tr><td><strong>golang-migrate</strong></td><td>pairs of files: <code>{version}_{title}.up.sql</code> and <code>.down.sql</code></td><td><code>schema_migrations</code> (current version + a <code>dirty</code> flag)</td><td>run the <code>.down</code> files</td><td>Go library + CLI. A failed migration marks the database <em>dirty</em>; you fix it by hand and run <code>force VERSION</code>.</td></tr>
  <tr><td><strong>goose</strong></td><td>one SQL file with <code>-- +goose Up</code> / <code>Down</code> sections, or Go functions</td><td><code>goose_db_version</code> (one row per applied version)</td><td><code>down</code> / <code>down-to</code></td><td>Go library + CLI, files can be embedded. <code>-- +goose NO TRANSACTION</code> per file. Used below.</td></tr>
  <tr><td><strong>Atlas</strong></td><td>versioned SQL files, or a desired-state schema (declarative)</td><td>its own revisions table</td><td>generates or plans changes</td><td>Writes the migration by diffing a desired schema (<code>atlas migrate diff</code>), lints risky changes, and an <code>atlas.sum</code> file catches edited history.</td></tr>
  <tr><td><strong>Flyway</strong></td><td><code>V1__name.sql</code> (versioned) and <code>R__name.sql</code> (repeatable)</td><td><code>flyway_schema_history</code> (with a checksum per file)</td><td>undo migrations (<code>U</code> prefix) in some editions; roll forward otherwise</td><td>JVM. Errors if an applied file's checksum changed; <code>repair</code> fixes the history.</td></tr>
  <tr><td><strong>Liquibase</strong></td><td>changelogs in SQL, XML, YAML or JSON</td><td><code>DATABASECHANGELOG</code> + <code>DATABASECHANGELOGLOCK</code></td><td>rollback blocks per change set</td><td>JVM. Database-agnostic change types.</td></tr>
</table>
<p>Pick one and use it everywhere. The choice matters much less than never changing the schema outside it.</p>

<h3>Running migrations in CI/CD</h3>
<ul>
  <li><strong>Before the new code, as its own step.</strong> The usual pipeline is: build, run migrations, then deploy the new release. That only works if the <em>old</em> release still runs on the new schema, which is what expand/contract (below) guarantees.</li>
  <li><strong>One runner at a time.</strong> A dedicated job (a CI step, a Kubernetes Job, a pre-deploy hook) is the simplest. Running migrations at app startup also works, but then ten pods race for it, so the tool must take a lock. goose's Postgres session locker and golang-migrate both use Postgres advisory locks for this.</li>
  <li><strong>Test them.</strong> Run every migration from zero in CI against the same engine and version as production, and run risky ones against production-sized data.</li>
</ul>

<h3>Zero downtime: expand, migrate, contract</h3>
<p>Renaming a column looks like one statement. In production it's a breaking change: the moment it runs, every running instance that still says <code>full_name</code> starts failing. The fix is to split one breaking change into several compatible ones, each shipped as its own deploy. Martin Fowler's site calls this <em>parallel change</em>; most teams call it <strong>expand/contract</strong>.</p>
<figure class="diagram">
<svg viewBox="0 0 780 290" role="img" aria-label="Five deploys in a row: expand, dual write, backfill, switch reads, contract. Below, bars show that the old column exists until the contract step, the new columns exist from the expand step on, and rolling back the application is safe at every step except after the contract step.">
  <defs><marker id="arr-mig-2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <rect class="box accent" x="15" y="30" width="140" height="74" rx="6"/>
  <text x="85" y="54" text-anchor="middle" class="title">1. Expand</text>
  <text x="85" y="74" text-anchor="middle" class="small">add new columns,</text>
  <text x="85" y="90" text-anchor="middle" class="small">nullable, no default</text>
  <rect class="box" x="170" y="30" width="140" height="74" rx="6"/>
  <text x="240" y="54" text-anchor="middle" class="title">2. Dual write</text>
  <text x="240" y="74" text-anchor="middle" class="small">app writes old</text>
  <text x="240" y="90" text-anchor="middle" class="small">and new columns</text>
  <rect class="box" x="325" y="30" width="140" height="74" rx="6"/>
  <text x="395" y="54" text-anchor="middle" class="title">3. Backfill</text>
  <text x="395" y="74" text-anchor="middle" class="small">copy old rows</text>
  <text x="395" y="90" text-anchor="middle" class="small">in small batches</text>
  <rect class="box" x="480" y="30" width="140" height="74" rx="6"/>
  <text x="550" y="54" text-anchor="middle" class="title">4. Switch reads</text>
  <text x="550" y="74" text-anchor="middle" class="small">read new columns,</text>
  <text x="550" y="90" text-anchor="middle" class="small">stop writing old</text>
  <rect class="box bad" x="635" y="30" width="140" height="74" rx="6"/>
  <text x="705" y="54" text-anchor="middle" class="title">5. Contract</text>
  <text x="705" y="74" text-anchor="middle" class="small">drop old column</text>
  <text x="705" y="90" text-anchor="middle" class="small">once N-1 is gone</text>
  <path class="line" d="M156 67 H168" marker-end="url(#arr-mig-2)"/>
  <path class="line" d="M311 67 H323" marker-end="url(#arr-mig-2)"/>
  <path class="line" d="M466 67 H478" marker-end="url(#arr-mig-2)"/>
  <path class="line" d="M621 67 H633" marker-end="url(#arr-mig-2)"/>

  <text x="15" y="138" class="small">old column (full_name)</text>
  <rect class="box ok" x="15" y="146" width="605" height="24" rx="4"/><text x="317" y="162" text-anchor="middle" class="small">exists, so the previous release keeps working</text>
  <rect class="box bad" x="635" y="146" width="140" height="24" rx="4"/><text x="705" y="162" text-anchor="middle" class="small">dropped</text>

  <text x="15" y="194" class="small">new columns (first_name, last_name)</text>
  <rect class="box accent" x="15" y="202" width="760" height="24" rx="4"/><text x="395" y="218" text-anchor="middle" class="small">exist from step 1; filled for new rows from step 2, for all rows after step 3</text>

  <text x="15" y="250" class="small">roll back the app?</text>
  <rect class="box ok" x="15" y="258" width="605" height="24" rx="4"/><text x="317" y="274" text-anchor="middle" class="small">safe: redeploy the previous release, no data lost</text>
  <rect class="box bad" x="635" y="258" width="140" height="24" rx="4"/><text x="705" y="274" text-anchor="middle" class="small">point of no return</text>
</svg>
<figcaption>Each box is a separate deploy, and you can stop between any two. Only the last step destroys anything, so do it last and do it late.</figcaption>
</figure>
<ol>
  <li><strong>Expand.</strong> Add new structure that old code doesn't notice: a nullable column, a new table, an index.</li>
  <li><strong>Dual write.</strong> Release code that writes both old and new columns but still reads the old one. New rows are now complete.</li>
  <li><strong>Backfill.</strong> Copy old rows in small batches (see the example). One giant <code>UPDATE</code> holds row locks for its whole run, floods the replicas with WAL and leaves dead rows for vacuum.</li>
  <li><strong>Switch reads.</strong> Read the new columns, stop writing the old one, and check the two agree. Add constraints (<code>NOT NULL</code>, foreign keys) the safe way shown below.</li>
  <li><strong>Contract.</strong> Drop the old column once no code, report or job uses it, at least one release later, so rolling back still works.</li>
</ol>
<p>The same five steps cover renaming a table, splitting one, changing a column's type and moving data to a new store. The rule underneath is the one from <a href="#schema-versioning">Schema Versioning</a>: at every moment, the schema must work with release N <em>and</em> release N-1.</p>

<h3>The lock that takes production down</h3>
<p>In Postgres, most forms of <code>ALTER TABLE</code> take an <code>ACCESS EXCLUSIVE</code> lock, which conflicts with everything, including plain <code>SELECT</code>s. Many of them are "instant": since PostgreSQL 11, <code>ADD COLUMN</code> with a non-volatile default only writes metadata, with no table rewrite. So people assume they're safe. The danger is not how long the change takes. It's how long it <em>waits</em>.</p>
<figure class="diagram">
<svg viewBox="0 0 780 232" role="img" aria-label="A lock queue on the orders table. A long report transaction holds ACCESS SHARE and is granted. An ALTER TABLE asks for ACCESS EXCLUSIVE and waits behind it. Two ordinary app SELECTs, which only need ACCESS SHARE, wait behind the ALTER. With lock_timeout the ALTER gives up and the app queries run.">
  <defs><marker id="arr-mig-3" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <text x="330" y="22" text-anchor="middle" class="small">lock queue on the table, oldest request on the right</text>
  <rect class="box bad" x="10" y="40" width="130" height="56" rx="6"/><text x="75" y="63" text-anchor="middle" class="title">app SELECT</text><text x="75" y="82" text-anchor="middle" class="small">waits</text>
  <rect class="box bad" x="160" y="40" width="130" height="56" rx="6"/><text x="225" y="63" text-anchor="middle" class="title">app SELECT</text><text x="225" y="82" text-anchor="middle" class="small">waits</text>
  <rect class="box bad" x="310" y="40" width="150" height="56" rx="6"/><text x="385" y="63" text-anchor="middle" class="title">ALTER TABLE</text><text x="385" y="82" text-anchor="middle" class="small">ACCESS EXCLUSIVE, waits</text>
  <rect class="box ok" x="480" y="40" width="150" height="56" rx="6"/><text x="555" y="63" text-anchor="middle" class="title">report tx</text><text x="555" y="82" text-anchor="middle" class="small">ACCESS SHARE, granted</text>
  <rect class="box" x="650" y="40" width="120" height="56" rx="6"/><text x="710" y="73" text-anchor="middle" class="title">orders</text>
  <path class="line" d="M141 68 H158" marker-end="url(#arr-mig-3)"/>
  <path class="line" d="M291 68 H308" marker-end="url(#arr-mig-3)"/>
  <path class="line" d="M461 68 H478" marker-end="url(#arr-mig-3)"/>
  <path class="line ok" d="M631 68 H648" marker-end="url(#arr-mig-3)"/>
  <text x="390" y="126" text-anchor="middle" class="small">A SELECT only needs ACCESS SHARE, which the report already holds, so on its own it would run.</text>
  <text x="390" y="144" text-anchor="middle" class="small">It waits because it conflicts with the ALTER queued ahead of it. Every new query joins the line.</text>
  <rect class="box accent" x="110" y="166" width="560" height="50" rx="6"/>
  <text x="390" y="186" text-anchor="middle">Fix: SET lock_timeout = '2s' for the migration session</text>
  <text x="390" y="204" text-anchor="middle" class="small">the ALTER fails fast, the queue drains, and the runner retries later</text>
</svg>
<figcaption>The "instant" migration never ran a single row of work, yet every query on the table stopped until the report finished. The example below reproduces this on a real Postgres.</figcaption>
</figure>
<p>Set <code>lock_timeout</code> for every migration session, so a blocked DDL statement fails within seconds instead of taking the table hostage. Retry it, ideally when traffic is low. Also watch for the opposite case: a lock you <em>did</em> get, held too long, because the statement rewrites the table.</p>

<h3>Safe and unsafe operations (Postgres)</h3>
<table>
  <tr><th>You want to…</th><th>Risky way</th><th>Safer way</th></tr>
  <tr><td>Add a column</td><td>with a volatile default such as <code>clock_timestamp()</code> or a random value: rewrites the whole table under <code>ACCESS EXCLUSIVE</code></td><td>nullable, or with a constant default (metadata only since PG 11); still set <code>lock_timeout</code></td></tr>
  <tr><td>Add an index</td><td><code>CREATE INDEX</code>: blocks writes (not reads) until it finishes</td><td><code>CREATE INDEX CONCURRENTLY</code>: no write lock, two table scans, can't run in a transaction block, leaves an <code>INVALID</code> index on failure that you must drop and retry</td></tr>
  <tr><td>Make a column <code>NOT NULL</code></td><td><code>SET NOT NULL</code> directly: full scan under <code>ACCESS EXCLUSIVE</code></td><td><code>CHECK (col IS NOT NULL) NOT VALID</code>, then <code>VALIDATE CONSTRAINT</code>, then <code>SET NOT NULL</code> (skips the scan when a valid check proves it)</td></tr>
  <tr><td>Add a foreign key or check</td><td>plain <code>ADD CONSTRAINT</code>: scans the table while holding its lock</td><td>add it <code>NOT VALID</code> (instant), then <code>VALIDATE CONSTRAINT</code>, which takes only <code>SHARE UPDATE EXCLUSIVE</code> and lets reads and writes continue</td></tr>
  <tr><td>Change a column type</td><td><code>ALTER COLUMN TYPE</code>: usually rewrites the table and rebuilds its indexes</td><td>expand/contract with a new column; in-place is fine only for binary-compatible changes, such as raising a <code>varchar</code> limit</td></tr>
</table>
<p>MySQL has its own rules. Many <code>ALTER TABLE</code> forms can run with <code>ALGORITHM=INSTANT</code> or <code>INPLACE</code>, and the ones that can't are usually done with an online schema change tool. <strong>pt-online-schema-change</strong> builds a copy of the table and keeps it in sync with triggers. <strong>gh-ost</strong> (GitHub) builds the same "ghost" table but follows the binary log instead of using triggers, so it can pause and throttle its own load. Both swap tables at the end.</p>

<h3>Rollbacks: down migrations vs roll forward</h3>
<p>Most tools let you pair every <em>up</em> with a <em>down</em>. Handy in development, weaker in production: a down that drops a column also drops everything written to it since the up ran, some changes (dropped data, lossy type changes) can't be reversed at all, and an untested down is a second outage. Teams with zero-downtime deploys usually <strong>roll forward</strong>: fix a bad migration with a new one, and keep the code rollback-safe with expand/contract, so rolling back the <em>app</em> never needs a schema rollback. Your real recovery plan is tested <a href="#backups">backups</a>.</p>

<h2>Example</h2>
<p><strong>goose on a real Postgres, plus a batched backfill and the lock queue.</strong> The test starts a real PostgreSQL 18 server in-process with <code>fergusstrange/embedded-postgres</code>, then uses <code>pressly/goose/v3</code> to apply three migrations: create a table, expand it with two new columns, and index one of them concurrently.</p>
<pre><code>-- migrations/00001_create_customers.sql
-- +goose Up
CREATE TABLE customers (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    full_name  TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE customers;

-- migrations/00002_expand_name_columns.sql
-- Expand step: new nullable columns. Old code ignores them, so this
-- is safe to run while the previous release is still serving traffic.
-- +goose Up
ALTER TABLE customers ADD COLUMN first_name TEXT;
ALTER TABLE customers ADD COLUMN last_name  TEXT;

-- +goose Down
ALTER TABLE customers DROP COLUMN last_name;
ALTER TABLE customers DROP COLUMN first_name;

-- migrations/00003_index_last_name.sql
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction block.
-- +goose NO TRANSACTION
-- +goose Up
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customers_last_name
    ON customers (last_name);

-- +goose Down
DROP INDEX CONCURRENTLY IF EXISTS idx_customers_last_name;</code></pre>
<p>The files are embedded in the binary, so what runs is what was reviewed. The backfill walks the primary key in batches of 1,000 rows (keyset, not <code>OFFSET</code>) and commits each batch on its own.</p>
<pre><code>package migrations

import (
	"context"
	"database/sql"
	"embed"
	"io/fs"
	"time"

	"github.com/pressly/goose/v3"
	"github.com/pressly/goose/v3/lock"
)

//go:embed migrations/*.sql
var embedded embed.FS

// NewMigrator returns a goose provider over the SQL files compiled into
// the binary. The session locker takes a Postgres advisory lock, so if
// several pods start at once only one of them applies migrations.
func NewMigrator(db *sql.DB) (*goose.Provider, error) {
	dir, err := fs.Sub(embedded, "migrations")
	if err != nil {
		return nil, err
	}
	locker, err := lock.NewPostgresSessionLocker()
	if err != nil {
		return nil, err
	}
	return goose.NewProvider(goose.DialectPostgres, db, dir,
		goose.WithSessionLocker(locker))
}

// Backfill fills first_name/last_name in small batches. Each batch is its
// own short transaction, so row locks are held for milliseconds and
// replicas can keep up. It walks the primary key (keyset), never OFFSET.
func Backfill(ctx context.Context, db *sql.DB, batchSize int, pause time.Duration) (batches, rows int, err error) {
	const q = &#96;
WITH batch AS (
    SELECT id FROM customers
    WHERE id &gt; $1 AND first_name IS NULL
    ORDER BY id
    LIMIT $2
), done AS (
    UPDATE customers c
    SET first_name = split_part(c.full_name, ' ', 1),
        last_name  = substr(c.full_name, strpos(c.full_name, ' ') + 1)
    FROM batch WHERE c.id = batch.id
    RETURNING c.id
)
SELECT count(*), coalesce(max(id), 0) FROM done&#96;

	var lastID int64
	for {
		var n int
		var maxID int64
		if err := db.QueryRowContext(ctx, q, lastID, batchSize).Scan(&amp;n, &amp;maxID); err != nil {
			return batches, rows, err
		}
		if n == 0 {
			return batches, rows, nil
		}
		batches++
		rows += n
		lastID = maxID
		select { // throttle: give the primary and the replicas room to breathe
		case &lt;-ctx.Done():
			return batches, rows, ctx.Err()
		case &lt;-time.After(pause):
		}
	}
}</code></pre>
<p>The test applies the migrations, prints the version table, runs <code>Up</code> a second time, then backfills 10,000 rows that the "old release" inserted without the new columns. The <code>// Output:</code> block is checked by <code>go test</code>.</p>
<pre><code>package migrations

import (
	"context"
	"fmt"
	"time"
)

func Example_migrateAndBackfill() {
	ctx := context.Background()
	m, err := NewMigrator(db)
	if err != nil {
		panic(err)
	}
	results, err := m.Up(ctx)
	if err != nil {
		panic(err)
	}
	for _, r := range results {
		fmt.Println("applied", r.Source.Path)
	}

	// The tracking table goose keeps: one row per applied version.
	rows, _ := db.QueryContext(ctx,
		&#96;SELECT version_id, is_applied FROM goose_db_version ORDER BY id&#96;)
	for rows.Next() {
		var v int64
		var ok bool
		rows.Scan(&amp;v, &amp;ok)
		fmt.Printf("goose_db_version: version_id=%d is_applied=%t&#92;n", v, ok)
	}
	rows.Close()

	// Running it again is a no-op: every file is already recorded.
	again, _ := m.Up(ctx)
	fmt.Println("second run applied:", len(again))

	// 10,000 existing rows written by the old release.
	db.ExecContext(ctx, &#96;INSERT INTO customers (full_name)
		SELECT (ARRAY['Ada','Grace','Alan','Edsger'])[1 + g % 4] || ' Example' || g
		FROM generate_series(1, 10000) g&#96;)

	batches, n, err := Backfill(ctx, db, 1000, time.Millisecond)
	if err != nil {
		panic(err)
	}
	fmt.Printf("backfill: %d rows in %d batches&#92;n", n, batches)

	var missing int
	db.QueryRowContext(ctx,
		&#96;SELECT count(*) FROM customers WHERE last_name IS NULL&#96;).Scan(&amp;missing)
	var first, last string
	db.QueryRowContext(ctx,
		&#96;SELECT first_name, last_name FROM customers WHERE id = 42&#96;).Scan(&amp;first, &amp;last)
	fmt.Printf("rows still NULL: %d, id 42 -&gt; %q %q&#92;n", missing, first, last)

	// Output:
	// applied 00001_create_customers.sql
	// applied 00002_expand_name_columns.sql
	// applied 00003_index_last_name.sql
	// goose_db_version: version_id=0 is_applied=true
	// goose_db_version: version_id=1 is_applied=true
	// goose_db_version: version_id=2 is_applied=true
	// goose_db_version: version_id=3 is_applied=true
	// second run applied: 0
	// backfill: 10000 rows in 10 batches
	// rows still NULL: 0, id 42 -&gt; "Alan" "Example42"
}</code></pre>
<p>Version 0 is the row goose writes when it creates its table. The second <code>Up</code> applies nothing, which is what makes "run migrations on every deploy" safe.</p>
<p>The second test reproduces the lock queue from the diagram. A report transaction holds an <code>ACCESS SHARE</code> lock on <code>orders</code>. An <code>ALTER TABLE … ADD COLUMN … DEFAULT 'basic'</code>, which is metadata-only, queues behind it. Then an ordinary <code>SELECT</code> with a 300 ms deadline tries its luck. (Helpers not shown: <code>waitingOnLocks</code> polls <code>pg_stat_activity</code> for <code>wait_event_type = 'Lock'</code>; <code>readWithin</code> runs <code>SELECT count(*)</code> under a deadline.)</p>
<pre><code>func Example_lockQueue() {
	ctx := context.Background()
	db.ExecContext(ctx, &#96;CREATE TABLE orders (id int, total_cents int)&#96;)

	// 1. A long-running report holds ACCESS SHARE on orders until it commits.
	report, _ := db.BeginTx(ctx, nil)
	report.ExecContext(ctx, &#96;SELECT count(*) FROM orders&#96;)

	// 2. A migration without lock_timeout wants ACCESS EXCLUSIVE and queues.
	migration, _ := db.Conn(ctx)
	done := make(chan error, 1)
	go func() {
		_, err := migration.ExecContext(ctx,
			&#96;ALTER TABLE orders ADD COLUMN tier TEXT NOT NULL DEFAULT 'basic'&#96;)
		done &lt;- err
	}()
	fmt.Println("sessions waiting on a lock:", waitingOnLocks(ctx))

	// 3. Now every plain SELECT queues behind the ALTER, not just the report.
	fmt.Println("no lock_timeout:", readWithin(ctx, 300*time.Millisecond))

	report.Rollback()
	fmt.Println("ALTER after report ends:", errText(&lt;-done))
	migration.ExecContext(ctx, &#96;ALTER TABLE orders DROP COLUMN tier&#96;)

	// 4. Same situation, but the migration gives up after 200ms instead.
	report, _ = db.BeginTx(ctx, nil)
	report.ExecContext(ctx, &#96;SELECT count(*) FROM orders&#96;)
	migration.ExecContext(ctx, &#96;SET lock_timeout = '200ms'&#96;)
	_, err := migration.ExecContext(ctx,
		&#96;ALTER TABLE orders ADD COLUMN tier TEXT NOT NULL DEFAULT 'basic'&#96;)
	fmt.Println("ALTER with lock_timeout:", errText(err))
	fmt.Println("with lock_timeout:", readWithin(ctx, 300*time.Millisecond))
	report.Rollback()
	migration.Close()

	// Output:
	// sessions waiting on a lock: 1
	// no lock_timeout: app read BLOCKED (context deadline exceeded)
	// ALTER after report ends: OK
	// ALTER with lock_timeout: ERROR: canceling statement due to lock timeout (SQLSTATE 55P03)
	// with lock_timeout: app read OK
}</code></pre>
<p>Real output of <code>go test -v</code> (timings are from a laptop run; most of the 7 s is starting Postgres):</p>
<pre><code>=== RUN   Example_lockQueue
--- PASS: Example_lockQueue (0.62s)
=== RUN   Example_migrateAndBackfill
--- PASS: Example_migrateAndBackfill (0.11s)
PASS
ok  	example.com/migrations	7.160s</code></pre>
<p>Without <code>lock_timeout</code>, a read that has nothing to do with the migration is blocked until the report ends. With <code>lock_timeout = '200ms'</code>, the migration fails with SQLSTATE <code>55P03</code> and the same read goes straight through. The runner can retry the migration later; a timed-out migration costs you a retry, a queued one costs you an outage.</p>

<p><strong>Real-world scenario.</strong> Picture an orders service with a 60 M-row <code>orders</code> table and about 2,000 queries per second on it. A developer adds <code>ALTER TABLE orders ADD COLUMN source TEXT DEFAULT 'web'</code>. In review it looks instant, and on PG 11+ it is. The deploy runs at 14:00, while a finance export has been reading <code>orders</code> in one transaction for 20 minutes. The <code>ALTER</code> queues, and so does every query behind it. Within a few seconds the app's connection pool is full of waiting queries, health checks time out, and the load balancer starts failing requests. Nothing recovers until someone cancels the export or the migration. The same migration with <code>SET lock_timeout = '2s'</code> fails once, the deploy pipeline retries a few minutes later, and nobody notices. The index on <code>source</code> goes in a separate <code>CONCURRENTLY</code> migration, and the backfill of old rows (if any are needed) runs in batches of 5,000 with a short sleep while someone watches replica lag.</p>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>DDL with no <code>lock_timeout</code>.</strong> The most common way a "trivial" migration causes an outage. One long transaction plus one queued <code>ACCESS EXCLUSIVE</code> request stops every query on the table. Set it in every migration session (and a <code>statement_timeout</code> too).</li>
  <li><strong>Deploying code and a breaking schema change together.</strong> Renames and drops break the release that is still running during a rolling deploy, and they break your rollback. Use expand/contract, and drop things one release later.</li>
  <li><strong>Mixing <code>CREATE INDEX CONCURRENTLY</code> with a transaction.</strong> It fails inside a transaction block, and most runners wrap each file in one. Mark the file (goose: <code>-- +goose NO TRANSACTION</code>) and give it a file of its own. Check for leftover <code>INVALID</code> indexes after a failure.</li>
  <li><strong>One huge backfill <code>UPDATE</code>.</strong> Long row locks, replica lag, bloat, and if it fails after 40 minutes, it all rolls back. Batch it, commit per batch, make it resumable (keyset on the primary key, <code>WHERE new_col IS NULL</code>) and idempotent.</li>
  <li><strong>Editing a migration that already ran.</strong> Production ran the old text, so environments silently diverge. Flyway and Atlas catch it with checksums; with goose and golang-migrate only review does. Write a new migration.</li>
  <li><strong>Testing only on an empty database.</strong> A migration that takes 50 ms in CI can take 30 minutes on production data. Test risky ones against a production-sized copy, and read the lock level of each statement in the docs before you ship it.</li>
</ul>

<div class="callout warn"><strong>"Instant" DDL can still stop the world.</strong> A metadata-only <code>ALTER TABLE</code> needs an <code>ACCESS EXCLUSIVE</code> lock for a moment. If it has to wait for that moment, everything else waits behind it. <code>lock_timeout</code> is not optional.</div>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>Migrations are versioned files in git, applied in order by one runner, and recorded in a table. Never change the schema any other way, and never edit an applied file.</li>
  <li>Every schema state must work with the current and the previous release. Split breaking changes into expand, dual write, backfill, switch reads, contract.</li>
  <li>The danger is lock waits, not just long rewrites: set <code>lock_timeout</code>, use <code>CONCURRENTLY</code> and <code>NOT VALID</code> + <code>VALIDATE</code>, and backfill in small batches.</li>
  <li>Plan to roll forward. Rollback-safe code beats down migrations.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#schema-versioning">Schema Versioning</a> · <a href="#rolling-deployments">Rolling Deployments</a> · <a href="#ci-cd">CI/CD</a> · <a href="#rollbacks">Rollbacks</a> · <a href="#database-indexing">Database Indexing</a> · <a href="#backups">Backups</a></p>
`;
CONTENT["schema-versioning"] = `
<p class="tldr"><strong>TL;DR</strong>: Data outlives the code that wrote it. Rows, JSON documents, cached values and events written by last year's release are still read by this year's, and during every deploy two releases read and write the same data at once. Schema versioning means treating the <em>shape</em> of that data as a versioned contract: tag it with a version, only change it in ways the other side can still read, and upgrade old shapes when you read them. It's how a word processor still opens files saved ten years ago, and why the old version can still open a file saved by the new one, minus the new features.</p>

<h2>The problem it solves</h2>
<p><a href="#database-migrations">Database Migrations</a> change the schema of tables. But the shape of data also lives in places no migration runner touches, and even for tables, the runner doesn't decide what the <em>code</em> can handle:</p>
<ul>
  <li><strong>Rolling deploys.</strong> For a few minutes, or a few hours with a canary, release N and release N-1 both run. N-1 reads rows N wrote, and N reads rows N-1 wrote. If either can't, you get errors or, worse, silent data loss.</li>
  <li><strong>Old data at rest.</strong> A JSONB column, a document store or a blob in object storage holds records in every shape the app ever wrote. Rewriting a billion documents in one migration is slow and risky, so old shapes stay around.</li>
  <li><strong>Events and messages.</strong> A topic may keep events for days, or forever for event sourcing. Consumers are deployed by other teams on their own schedule. A replay after a bug fix reads events written by old producers.</li>
  <li><strong>Caches and clients.</strong> A cache full of serialized structs survives a deploy. Mobile apps stay on old versions for months.</li>
</ul>
<p>In all of these, writers and readers run different versions of the code. The question is always the same: which direction must still work, and for how long?</p>

<h2>How it works</h2>
<p>Two words do most of the work. A change is <strong>backward compatible</strong> when new code can read data written by old code. It is <strong>forward compatible</strong> when old code can read data written by new code. A rolling deploy needs both, because both kinds of pods are running.</p>
<figure class="diagram">
<svg viewBox="0 0 780 270" role="img" aria-label="During a rolling deploy, writers on release N-1 and release N both write to the same shared data: table rows, JSON documents, events and cache entries. Readers on N-1 and N both read it. Reader N must read what N-1 wrote, which is backward compatibility. Reader N-1 must read what N writes, which is forward compatibility.">
  <defs><marker id="arr-schv-1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <text x="115" y="22" text-anchor="middle" class="title">Writers</text>
  <text x="390" y="22" text-anchor="middle" class="title">Shared data</text>
  <text x="665" y="22" text-anchor="middle" class="title">Readers</text>
  <rect class="box" x="20" y="40" width="190" height="50" rx="6"/><text x="115" y="61" text-anchor="middle" class="title">Release N-1</text><text x="115" y="79" text-anchor="middle" class="small">old pods, old shape</text>
  <rect class="box accent" x="20" y="170" width="190" height="50" rx="6"/><text x="115" y="191" text-anchor="middle" class="title">Release N</text><text x="115" y="209" text-anchor="middle" class="small">new pods, new shape</text>
  <rect class="box" x="300" y="90" width="180" height="90" rx="6"/>
  <text x="390" y="114" text-anchor="middle" class="title">same data</text>
  <text x="390" y="136" text-anchor="middle" class="small">table rows, JSON docs,</text>
  <text x="390" y="152" text-anchor="middle" class="small">events, cache entries</text>
  <path class="line" d="M212 72 L298 112" marker-end="url(#arr-schv-1)"/>
  <path class="line accent" d="M212 190 L298 160" marker-end="url(#arr-schv-1)"/>
  <path class="line" d="M482 112 L568 72" marker-end="url(#arr-schv-1)"/>
  <path class="line" d="M482 160 L568 190" marker-end="url(#arr-schv-1)"/>
  <rect class="box" x="570" y="40" width="190" height="50" rx="6"/><text x="665" y="61" text-anchor="middle" class="title">Release N-1</text><text x="665" y="79" text-anchor="middle" class="small">must read what N writes</text>
  <text x="665" y="110" text-anchor="middle" class="small">= forward compatibility</text>
  <rect class="box accent" x="570" y="170" width="190" height="50" rx="6"/><text x="665" y="191" text-anchor="middle" class="title">Release N</text><text x="665" y="209" text-anchor="middle" class="small">must read what N-1 wrote</text>
  <text x="665" y="240" text-anchor="middle" class="small">= backward compatibility</text>
  <text x="390" y="215" text-anchor="middle" class="small">during the rollout, all four</text>
  <text x="390" y="231" text-anchor="middle" class="small">run at the same time</text>
  <text x="390" y="262" text-anchor="middle" class="small">After the rollout only release N is left, but its data at rest still holds every older shape.</text>
</svg>
<figcaption>Backward compatibility protects old data. Forward compatibility protects old code. A rollback swaps the roles: N-1 must read everything N wrote while it ran.</figcaption>
</figure>

<h3>Rule 1: N and N-1 must both work</h3>
<p>Every change to a shared shape has to work with the release before it. For tables, that is the expand/contract sequence from <a href="#database-migrations">Database Migrations</a>: add before you use, stop using before you remove. For any other format it comes down to a few habits:</p>
<ul>
  <li><strong>Add, don't change.</strong> New fields are optional and have a sensible default. Old readers skip them; new readers fill the default when they're missing.</li>
  <li><strong>Never rename, never reuse.</strong> A rename is a remove plus an add, and both sides see a missing field. Never give an old name or Protobuf field number a new meaning; old data still carries the old meaning.</li>
  <li><strong>Readers ship first.</strong> Deploy code that <em>understands</em> the new shape before any code <em>writes</em> it. In the example below, the expand release writes the new <code>phones</code> list next to the old <code>phone</code> field, and only a later release drops <code>phone</code>.</li>
  <li><strong>Units and meaning are part of the schema.</strong> Changing <code>amount</code> from dollars to cents without a new name is a breaking change that no compatibility checker will catch.</li>
</ul>

<h3>Rule 2: tag stored shapes with a version, upgrade on read</h3>
<p>For documents and JSON columns, store a <code>schema_version</code> in each record. The reader keeps a chain of small upgrade steps (v1 to v2, v2 to v3) and runs the ones a record needs, so the rest of the code only ever sees the current shape. This is <strong>upgrade-on-read</strong>. If the reader also saves the upgraded record, it's a <strong>lazy migration</strong>: each record gets rewritten the first time anyone touches it.</p>
<figure class="diagram">
<svg viewBox="0 0 780 240" role="img" aria-label="A stored record goes through upgrade steps. A v1 record runs step 1 to 2 (split name) and step 2 to 3 (phone becomes a list of phones). A v2 record only runs the second step, a v3 record none. The result is the current Customer struct, which is written back as v3. A v4 record from a newer release is rejected instead of guessed at.">
  <defs><marker id="arr-schv-2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <rect class="box" x="20" y="40" width="130" height="56" rx="6"/><text x="85" y="63" text-anchor="middle" class="title">stored record</text><text x="85" y="82" text-anchor="middle" class="small">v1, v2 or v3</text>
  <rect class="box accent" x="200" y="40" width="150" height="56" rx="6"/><text x="275" y="63" text-anchor="middle" class="title">upgrade 1 → 2</text><text x="275" y="82" text-anchor="middle" class="small">split "name"</text>
  <rect class="box accent" x="400" y="40" width="150" height="56" rx="6"/><text x="475" y="63" text-anchor="middle" class="title">upgrade 2 → 3</text><text x="475" y="82" text-anchor="middle" class="small">phone → phones[]</text>
  <rect class="box ok" x="600" y="40" width="160" height="56" rx="6"/><text x="680" y="63" text-anchor="middle" class="title">Customer</text><text x="680" y="82" text-anchor="middle" class="small">current shape (v3)</text>
  <path class="line" d="M152 68 H198" marker-end="url(#arr-schv-2)"/>
  <path class="line" d="M352 68 H398" marker-end="url(#arr-schv-2)"/>
  <path class="line" d="M552 68 H598" marker-end="url(#arr-schv-2)"/>
  <text x="275" y="14" text-anchor="middle" class="small">v1 starts here</text><path class="line dashed" d="M275 20 V38" marker-end="url(#arr-schv-2)"/>
  <text x="475" y="14" text-anchor="middle" class="small">v2 starts here</text><path class="line dashed" d="M475 20 V38" marker-end="url(#arr-schv-2)"/>
  <text x="680" y="14" text-anchor="middle" class="small">v3 needs no steps</text><path class="line dashed" d="M680 20 V38" marker-end="url(#arr-schv-2)"/>
  <path class="line ok" d="M680 98 V128 H85 V100" marker-end="url(#arr-schv-2)"/>
  <text x="390" y="148" text-anchor="middle" class="small">write back as v3 (lazy migration): each record is upgraded once, the first time it's read</text>
  <rect class="box bad" x="20" y="172" width="250" height="50" rx="6"/><text x="145" y="193" text-anchor="middle" class="title">v4 record</text><text x="145" y="211" text-anchor="middle" class="small">from a newer release: reject, don't guess</text>
  <rect class="box muted" x="300" y="172" width="460" height="50" rx="6"/><text x="530" y="193" text-anchor="middle">background sweep</text><text x="530" y="211" text-anchor="middle" class="small">upgrades records nobody reads, so old steps can finally be deleted</text>
</svg>
<figcaption>Upgrade steps are small, ordered and never edited once released, just like migration files. The current code only ever handles one shape.</figcaption>
</figure>
<p>Two details matter. Records written before versioning existed have no version field, so "missing" must mean v1. And a reader that sees a version <em>newer</em> than it knows should fail loudly instead of quietly dropping fields it doesn't understand. That happens during a rollback, and it's the moment silent data loss starts.</p>

<h3>Rule 3: for events, let a registry enforce compatibility</h3>
<p>Producers and consumers of a topic are often different services owned by different teams, so "deploy readers first" needs tooling. With Avro, Protobuf or JSON Schema, a <strong>schema registry</strong> stores each version of a topic's schema and rejects a new version that breaks the configured rule. Confluent Schema Registry defines these modes:</p>
<table>
  <tr><th>Mode</th><th>Guarantee</th><th>Allowed changes (Avro)</th><th>Checked against</th><th>Upgrade first</th></tr>
  <tr><td><code>BACKWARD</code> (the default)</td><td>consumers on the new schema read data written with the previous one</td><td>delete fields; add fields with defaults</td><td>last version</td><td>consumers</td></tr>
  <tr><td><code>BACKWARD_TRANSITIVE</code></td><td>same, for all older data</td><td>same</td><td>all versions</td><td>consumers</td></tr>
  <tr><td><code>FORWARD</code></td><td>consumers on the previous schema read data written with the new one</td><td>add fields; delete fields that had defaults</td><td>last version</td><td>producers</td></tr>
  <tr><td><code>FORWARD_TRANSITIVE</code></td><td>same, for all older consumers</td><td>same</td><td>all versions</td><td>producers</td></tr>
  <tr><td><code>FULL</code> / <code>FULL_TRANSITIVE</code></td><td>both directions</td><td>add or delete optional fields only</td><td>last / all versions</td><td>either, in any order</td></tr>
  <tr><td><code>NONE</code></td><td>nothing is checked</td><td>anything</td><td>nothing</td><td>coordinate by hand</td></tr>
</table>
<p>If a topic is replayed from the beginning, or events are kept forever, you want a <code>_TRANSITIVE</code> mode: "compatible with the last version" says nothing about version 1 from three years ago. Request and response payloads of public APIs are a related problem with their own tools (URL or header versions, deprecation windows), covered in <a href="#api-versioning">API Versioning</a>.</p>

<h3>What each format tolerates</h3>
<table>
  <tr><th>Change</th><th>JSON + Go <code>encoding/json</code></th><th>Protobuf</th><th>Avro</th><th>SQL column</th></tr>
  <tr><td>Add an optional field</td><td>safe: unknown fields are ignored by default (not with <code>DisallowUnknownFields</code>)</td><td>safe: old binaries keep it as an unknown field</td><td>safe when it has a default</td><td>safe if nullable or with a constant default</td></tr>
  <tr><td>Remove a field</td><td>old readers silently get the zero value</td><td>safe if you <code>reserved</code> its number and name</td><td>backward-safe; forward-safe only if it had a default</td><td>only after no running code reads it (contract)</td></tr>
  <tr><td>Rename a field</td><td>breaks both ways, silently</td><td>the wire format uses numbers, so binary is fine; JSON mapping breaks</td><td>breaks, unless the reader schema declares an alias</td><td>expand/contract with a new column</td></tr>
  <tr><td>Reuse a name or number for a new meaning</td><td colspan="4">never: old data and old code still carry the old meaning</td></tr>
</table>
<pre><code>// Protobuf, not executed here. Field 4 (phone) was removed in v3.
message Customer {
  reserved 4;              // the number can never come back with a new meaning
  reserved "phone";        // nor can the name (keeps JSON/text formats parsing)
  int32  schema_version = 1;
  string first_name     = 2;
  string last_name      = 3;
  repeated Phone phones = 5;
  string nickname       = 6;  // new and optional: old binaries ignore it
}</code></pre>

<h2>Example</h2>
<p><strong>Upgrade-on-read for customer documents, in Go.</strong> Customer profiles live as JSON. The shape changed twice: v1 had a single <code>name</code>, v2 split it into first and last name and added <code>schema_version</code>, and v3 replaced one <code>phone</code> with a list of <code>phones</code>. The reader upgrades any stored version to v3, writes it back, and refuses versions from the future. Standard library only.</p>
<pre><code>package schemav

import (
	"encoding/json"
	"fmt"
	"strings"
)

// Current is the shape this release writes:
//
//	v1 {"name": "Ada Lovelace", "phone": "..."}            (no version field)
//	v2 {"schema_version": 2, "first_name", "last_name", "phone"}
//	v3 {"schema_version": 3, "first_name", "last_name", "phones": [...]}
const Current = 3

type Phone struct {
	Kind   string &#96;json:"kind"&#96;
	Number string &#96;json:"number"&#96;
}

type Customer struct {
	SchemaVersion int     &#96;json:"schema_version"&#96;
	FirstName     string  &#96;json:"first_name"&#96;
	LastName      string  &#96;json:"last_name"&#96;
	Phones        []Phone &#96;json:"phones"&#96;
}

// upgrades[v] turns a version-v document into a version v+1 document.
// Each step is small and never changes once released.
var upgrades = map[int]func(doc map[string]any){
	1: func(doc map[string]any) { // split "name"
		name, _ := doc["name"].(string)
		first, last, _ := strings.Cut(name, " ")
		doc["first_name"], doc["last_name"] = first, last
		delete(doc, "name")
	},
	2: func(doc map[string]any) { // one phone -&gt; list of phones
		if _, ok := doc["phones"]; !ok {
			phones := []any{}
			if p, _ := doc["phone"].(string); p != "" {
				phones = append(phones, map[string]any{"kind": "main", "number": p})
			}
			doc["phones"] = phones
		}
		delete(doc, "phone")
	},
}

// Decode reads any known version and returns the current shape.
// from is the version the bytes were stored in.
func Decode(raw []byte) (c Customer, from int, err error) {
	var doc map[string]any
	if err := json.Unmarshal(raw, &amp;doc); err != nil {
		return c, 0, err
	}
	from = 1 // records written before versioning existed have no field
	if v, ok := doc["schema_version"].(float64); ok {
		from = int(v)
	}
	if from &gt; Current {
		// Written by a newer release: refuse rather than drop fields we don't know.
		return c, from, fmt.Errorf("schema_version %d is newer than this reader (max %d)", from, Current)
	}
	for v := from; v &lt; Current; v++ {
		upgrades[v](doc)
		doc["schema_version"] = v + 1
	}
	b, _ := json.Marshal(doc)
	return c, from, json.Unmarshal(b, &amp;c)
}

// Store is a stand-in for a key/value or JSONB column.
type Store map[string][]byte

// Get upgrades on read and writes the new shape back (lazy migration),
// so each old record is converted once, the first time anyone touches it.
func (s Store) Get(id string) (Customer, error) {
	c, from, err := Decode(s[id])
	if err != nil {
		return c, err
	}
	if from &lt; Current {
		s[id], _ = json.Marshal(c)
	}
	return c, nil
}</code></pre>
<p>The upgrade steps work on a generic map, not on structs. That's deliberate: a v1 record has fields the current struct no longer has, so it can't be decoded into it directly. Only the final, current shape is decoded into a type.</p>
<p>The tests check two things. First, the lazy migration over three records in three shapes. Second, a rolling deploy: what a pod still on the previous release (it only knows <code>customerV2</code>) sees when the new release writes. The <code>// Output:</code> blocks are checked by <code>go test</code>.</p>
<pre><code>package schemav

import (
	"encoding/json"
	"fmt"
)

func ExampleStore_Get() {
	s := Store{
		"c1": []byte(&#96;{"name":"Ada Lovelace","phone":"+44 1"}&#96;),
		"c2": []byte(&#96;{"schema_version":2,"first_name":"Alan","last_name":"Turing","phone":"+44 2"}&#96;),
		"c3": []byte(&#96;{"schema_version":3,"first_name":"Grace","last_name":"Hopper","phones":[]}&#96;),
	}
	for _, id := range []string{"c1", "c2", "c3"} {
		_, from, _ := Decode(s[id])
		c, _ := s.Get(id)
		fmt.Printf("%s: stored v%d -&gt; %s %s, %d phone(s)&#92;n",
			id, from, c.FirstName, c.LastName, len(c.Phones))
	}
	fmt.Println("c1 now stored as:", string(s["c1"]))

	_, _, err := Decode([]byte(&#96;{"schema_version":4,"first_name":"Edsger"}&#96;))
	fmt.Println("v4 record:", err)

	// Output:
	// c1: stored v1 -&gt; Ada Lovelace, 1 phone(s)
	// c2: stored v2 -&gt; Alan Turing, 1 phone(s)
	// c3: stored v3 -&gt; Grace Hopper, 0 phone(s)
	// c1 now stored as: {"schema_version":3,"first_name":"Ada","last_name":"Lovelace","phones":[{"kind":"main","number":"+44 1"}]}
	// v4 record: schema_version 4 is newer than this reader (max 3)
}

// customerV2 is the struct the previous release (N-1) compiled in.
type customerV2 struct {
	SchemaVersion int    &#96;json:"schema_version"&#96;
	FirstName     string &#96;json:"first_name"&#96;
	Phone         string &#96;json:"phone"&#96;
}

func Example_rollingDeploy() {
	readOld := func(raw []byte) string {
		var c customerV2
		err := json.Unmarshal(raw, &amp;c)
		return fmt.Sprintf("phone=%q err=%v", c.Phone, err)
	}

	// Release N writes v3 while N-1 pods are still running.
	v3 := []byte(&#96;{"schema_version":3,"first_name":"Ada","phones":[{"kind":"main","number":"+44 1"}]}&#96;)
	fmt.Println("old pod reads v3:      ", readOld(v3))

	// Expand first: keep writing v2, plus the new field next to the old one.
	both := []byte(&#96;{"schema_version":2,"first_name":"Ada","phone":"+44 1","phones":[{"kind":"main","number":"+44 1"}]}&#96;)
	fmt.Println("old pod reads v2+phones:", readOld(both))
	c, _, _ := Decode(both)
	fmt.Println("new pod reads v2+phones:", c.Phones)

	// Output:
	// old pod reads v3:       phone="" err=&lt;nil&gt;
	// old pod reads v2+phones: phone="+44 1" err=&lt;nil&gt;
	// new pod reads v2+phones: [{main +44 1}]
}</code></pre>
<p>Real output of <code>go test -v</code>:</p>
<pre><code>=== RUN   ExampleStore_Get
--- PASS: ExampleStore_Get (0.00s)
=== RUN   Example_rollingDeploy
--- PASS: Example_rollingDeploy (0.00s)
PASS
ok  	example.com/schemav	0.111s</code></pre>
<p>Read the second example carefully. When release N writes v3 straight away, the old pod's <code>json.Unmarshal</code> returns <strong>no error</strong>: it simply doesn't find <code>phone</code> and leaves it empty. If that pod then saves the record, the phone number is gone. The safe path is the expand step: keep writing <code>schema_version: 2</code> with both <code>phone</code> and <code>phones</code> until no N-1 pod is left. Both releases then read what they need. Only the release after that starts writing v3.</p>

<p><strong>Real-world scenario.</strong> A delivery app stores each user's saved addresses as a JSONB document, about 30 M documents written over five years in three shapes. The team wants to add structured geo-coordinates. A one-shot migration that rewrites 30 M documents would keep the database busy for hours and fight live traffic. Instead they ship it in three releases. First, a reader that understands v4 (with a <code>geo</code> object) but still writes v3. Next, a writer that writes v4 and upgrades on read, so the most active users' documents convert within days. Last, a batched background sweep, throttled like any backfill, for the long tail. When a query shows no document below v4, they delete the old upgrade steps. Meanwhile the <code>OrderPlaced</code> events carry an address snapshot, so the event schema gets the same field as an optional, defaulted addition under <code>BACKWARD_TRANSITIVE</code>, and the billing consumer that replays a year of events never notices.</p>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>Writing the new shape before every reader understands it.</strong> The most common cause of silent data loss in rolling deploys, as the example shows. Ship the reader, then the writer.</li>
  <li><strong>Strict decoding in consumers.</strong> <code>DisallowUnknownFields</code>, or a JSON Schema with <code>additionalProperties: false</code>, turns every additive change into an outage. Be strict on input from outside, tolerant between your own services.</li>
  <li><strong>Read-modify-write that drops unknown fields.</strong> An old reader that decodes into a struct and saves it back deletes every field it doesn't know. Either reject newer versions, or keep the unknown fields around (Protobuf does; Go structs don't).</li>
  <li><strong>Upgrade-on-read with no sweep.</strong> Records nobody reads stay at v1 forever, so the upgrade chain can never shrink, and analytics jobs reading the raw data see every shape. Sweep in the background and track how many records are at each version.</li>
  <li><strong>"Compatible with the last version" when data is older.</strong> Non-transitive checks let v3 be compatible with v2 and v2 with v1, while v3 can't read v1. If old data is ever re-read, use transitive modes.</li>
  <li><strong>New enum values.</strong> Adding <code>"status": "on_hold"</code> is additive on paper, but an old <code>switch</code> without a default branch mishandles it. Old readers need a safe default for unknown values.</li>
  <li><strong>Forgetting caches.</strong> Serialized objects in a cache are stored data too. Put a version in the key or the value, or a deploy will read shapes it can't handle.</li>
</ul>

<div class="callout warn"><strong>No error is not the same as compatible.</strong> Go's <code>encoding/json</code>, Protobuf and most JSON libraries happily decode data with missing or extra fields. A broken schema change usually shows up as empty values and quietly lost data, not as an exception.</div>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>During every deploy, release N and N-1 share the same data. Every shape change must be readable in both directions until N-1 is gone.</li>
  <li>Add optional fields with defaults; never rename, never reuse a name or number; ship readers before writers.</li>
  <li>Tag stored documents with a version, upgrade on read, write back, sweep the long tail, and reject versions newer than you know.</li>
  <li>For events, let a schema registry enforce the rule, transitively if old events are ever replayed.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#database-migrations">Database Migrations</a> · <a href="#api-versioning">API Versioning</a> · <a href="#rolling-deployments">Rolling Deployments</a> · <a href="#event-driven-architecture">Event-Driven Architecture</a> · <a href="#message-queues">Message Queues</a> · <a href="#semantic-versioning">Semantic Versioning</a></p>
`;
CONTENT["real-world-data-layer"] = `
<p class="tldr"><strong>TL;DR</strong>: A data layer grows in steps, and each step has a signal that tells you it's time. First make queries cheap (indexes, query fixes, no N+1). Then share connections well (pool sizing, PgBouncer). Then spread reads (replicas that respect read-your-writes). Then split the biggest table by time (partitions). Only then split the data across servers (shards). Schema changes go expand/contract the whole way, and event schemas carry versions. Think of a restaurant kitchen: you fix the recipes before you hire more cooks, and you hire cooks before you open a second kitchen.</p>

<h2>The problem it solves</h2>
<p>The nine pages before this one each describe one tool. This page puts them in one system and in the order you usually need them. The order matters as much as the tools. Sharding a database that is slow because of a missing index buys you N slow databases. Adding replicas to fix a pool that leaks connections buys you more connections to leak.</p>
<p>The system is an <strong>orders service</strong> for an online shop, written in Go on Postgres. It has three kinds of data:</p>
<ul>
  <li><code>orders</code> and <code>order_items</code>: the current state of each order. Read by the "order history" page, written by checkout.</li>
  <li><code>order_events</code>: an append-only log (<code>OrderPlaced</code>, <code>OrderShipped</code>, …) that other services consume and that support uses for audits. It grows forever.</li>
  <li><code>customers</code>: small and read often.</li>
</ul>
<p>It starts as one Go service and one Postgres. It ends, years later, with several shards. The goal of this page is to show what each stage looks like, which signal moved it to the next one, and what breaks if you skip ahead.</p>

<h2>How it works: the end state</h2>
<figure class="diagram">
<svg viewBox="0 0 780 400" role="img" aria-label="The orders service in Go holds a shard map keyed by customer_id, a replica router with version tokens and a connection pool. It talks through PgBouncer in transaction mode to two shards. Each shard has a primary that streams WAL to an async replica, and the order_events table is split into monthly partitions. A migration runner applies expand and contract migrations to every shard, and the service publishes versioned OrderPlaced events to an event bus.">
  <defs><marker id="arr-rwdl-1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <rect class="box accent" x="20" y="40" width="220" height="110" rx="10"/>
  <text x="130" y="64" text-anchor="middle" class="title">Orders service (Go)</text>
  <text x="130" y="86" text-anchor="middle" class="small">shard map: customer_id → shard</text>
  <text x="130" y="106" text-anchor="middle" class="small">replica router + version token</text>
  <text x="130" y="126" text-anchor="middle" class="small">pool: SetMaxOpenConns per shard</text>
  <path class="line" d="M240 95 H288" marker-end="url(#arr-rwdl-1)"/>
  <rect class="box" x="290" y="70" width="150" height="50" rx="10"/>
  <text x="365" y="92" text-anchor="middle" class="title">PgBouncer</text>
  <text x="365" y="110" text-anchor="middle" class="small">transaction mode</text>
  <path class="line" d="M440 88 H465 V77 H493" marker-end="url(#arr-rwdl-1)"/>
  <path class="line" d="M440 102 H465 V257 H493" marker-end="url(#arr-rwdl-1)"/>
  <rect class="box muted" x="480" y="20" width="280" height="165" rx="12"/>
  <text x="494" y="40" class="title">Shard 1</text>
  <rect class="box" x="495" y="52" width="120" height="50" rx="8"/>
  <text x="555" y="74" text-anchor="middle" class="title">Primary</text>
  <text x="555" y="92" text-anchor="middle" class="small">all writes</text>
  <path class="line accent dashed" d="M615 77 H633" marker-end="url(#arr-rwdl-1)"/>
  <rect class="box" x="635" y="52" width="110" height="50" rx="8"/>
  <text x="690" y="74" text-anchor="middle" class="title">Replica</text>
  <text x="690" y="92" text-anchor="middle" class="small">reads, lag watched</text>
  <text x="494" y="124" class="small">order_events: monthly partitions</text>
  <rect class="box muted" x="495" y="134" width="78" height="28" rx="5"/>
  <text x="534" y="152" text-anchor="middle" class="small">2026-09</text>
  <rect class="box muted" x="583" y="134" width="78" height="28" rx="5"/>
  <text x="622" y="152" text-anchor="middle" class="small">2026-10</text>
  <rect class="box ok" x="671" y="134" width="74" height="28" rx="5"/>
  <text x="708" y="152" text-anchor="middle" class="small">2026-11</text>
  <rect class="box muted" x="480" y="200" width="280" height="165" rx="12"/>
  <text x="494" y="220" class="title">Shard 2</text>
  <rect class="box" x="495" y="232" width="120" height="50" rx="8"/>
  <text x="555" y="254" text-anchor="middle" class="title">Primary</text>
  <text x="555" y="272" text-anchor="middle" class="small">all writes</text>
  <path class="line accent dashed" d="M615 257 H633" marker-end="url(#arr-rwdl-1)"/>
  <rect class="box" x="635" y="232" width="110" height="50" rx="8"/>
  <text x="690" y="254" text-anchor="middle" class="title">Replica</text>
  <text x="690" y="272" text-anchor="middle" class="small">reads, lag watched</text>
  <text x="494" y="304" class="small">order_events: monthly partitions</text>
  <rect class="box muted" x="495" y="314" width="78" height="28" rx="5"/>
  <text x="534" y="332" text-anchor="middle" class="small">2026-09</text>
  <rect class="box muted" x="583" y="314" width="78" height="28" rx="5"/>
  <text x="622" y="332" text-anchor="middle" class="small">2026-10</text>
  <rect class="box ok" x="671" y="314" width="74" height="28" rx="5"/>
  <text x="708" y="332" text-anchor="middle" class="small">2026-11</text>
  <path class="line" d="M130 150 V198" marker-end="url(#arr-rwdl-1)"/>
  <rect class="box" x="20" y="200" width="220" height="60" rx="10"/>
  <text x="130" y="224" text-anchor="middle" class="title">Event bus</text>
  <text x="130" y="244" text-anchor="middle" class="small">OrderPlaced v2, compat checked</text>
  <rect class="box" x="20" y="300" width="220" height="60" rx="10"/>
  <text x="130" y="324" text-anchor="middle" class="title">Migration runner (CI)</text>
  <text x="130" y="344" text-anchor="middle" class="small">expand/contract, lock_timeout</text>
  <path class="line dashed" d="M240 330 H478" marker-end="url(#arr-rwdl-1)"/>
  <text x="360" y="320" text-anchor="middle" class="small">same versions on every shard</text>
  <text x="290" y="150" class="small">Reads go through the same pooler</text>
  <text x="290" y="166" class="small">to the replicas (arrows omitted).</text>
</svg>
<figcaption>The end state after five growth stages. Most systems stop earlier, and that is fine: each box exists only because a signal showed up that the stage before it couldn't handle.</figcaption>
</figure>

<p>Each piece has its own page. Here is the job each one does in this system:</p>
<ol>
  <li><strong>Indexes on the access paths</strong>: <a href="#database-indexing">Database Indexing</a>. <code>orders(customer_id, id)</code> and <code>order_items(order_id)</code>.</li>
  <li><strong>Read plans, fix the query</strong>: <a href="#query-optimization">Query Optimization</a>. Keyset pagination instead of <code>OFFSET</code>.</li>
  <li><strong>One query per list, not per row</strong>: <a href="#n-1-queries">N+1 Queries</a>. The history page loads items for 20 orders with one <code>IN (…)</code>, not 20 queries.</li>
  <li><strong>Bounded pools, external pooler</strong>: <a href="#connection-pooling">Connection Pooling</a>. A fixed pool per instance; PgBouncer multiplexes onto few backends.</li>
  <li><strong>Replicas for reads</strong>: <a href="#read-replicas">Read Replicas</a>. Browsing reads go to replicas; reads right after checkout carry a version token.</li>
  <li><strong>Partition the log by month</strong>: <a href="#partitioning">Partitioning</a>. Retention is <code>DROP</code> of an old partition, not a huge <code>DELETE</code>.</li>
  <li><strong>Shard by customer</strong>: <a href="#sharding">Sharding</a>. Every hot-path query has <code>customer_id</code>, so it hits one shard.</li>
  <li><strong>Change schemas without downtime</strong>: <a href="#database-migrations">Database Migrations</a>. Expand/contract, with <code>lock_timeout</code>.</li>
  <li><strong>Version the data's shape</strong>: <a href="#schema-versioning">Schema Versioning</a>. Old code and old consumers must read what new code writes.</li>
</ol>

<h2>The growth timeline</h2>
<figure class="diagram">
<svg viewBox="0 0 780 290" role="img" aria-label="Five stages from left to right as load and data grow: fix queries, pool connections, add replicas, partition order_events, shard by customer_id. Each stage lists the signal that triggers it and what to do.">
  <defs><marker id="arr-rwdl-2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <path class="line" d="M15 22 H762" marker-end="url(#arr-rwdl-2)"/>
  <text x="390" y="14" text-anchor="middle" class="small">traffic and data grow →</text>
  <rect class="box ok" x="15" y="36" width="140" height="44" rx="8"/>
  <text x="85" y="63" text-anchor="middle" class="title">1. Fix queries</text>
  <rect class="box ok" x="165" y="36" width="140" height="44" rx="8"/>
  <text x="235" y="63" text-anchor="middle" class="title">2. Pool</text>
  <rect class="box accent" x="315" y="36" width="140" height="44" rx="8"/>
  <text x="385" y="63" text-anchor="middle" class="title">3. Replicas</text>
  <rect class="box accent" x="465" y="36" width="140" height="44" rx="8"/>
  <text x="535" y="63" text-anchor="middle" class="title">4. Partition</text>
  <rect class="box bad" x="615" y="36" width="150" height="44" rx="8"/>
  <text x="690" y="63" text-anchor="middle" class="title">5. Shard</text>
  <text x="15" y="106" class="title">Signal</text>
  <text x="15" y="126" class="small">slow pages, seq scans</text>
  <text x="15" y="142" class="small">in pg_stat_statements</text>
  <text x="165" y="126" class="small">connections near</text>
  <text x="165" y="142" class="small">max_connections, waits</text>
  <text x="315" y="126" class="small">primary busy with reads</text>
  <text x="315" y="142" class="small">after stage 1 is done</text>
  <text x="465" y="126" class="small">order_events huge,</text>
  <text x="465" y="142" class="small">slow retention DELETE</text>
  <text x="615" y="126" class="small">writes or size outgrow</text>
  <text x="615" y="142" class="small">the biggest primary</text>
  <text x="15" y="176" class="title">Do</text>
  <text x="15" y="196" class="small">indexes, EXPLAIN,</text>
  <text x="15" y="212" class="small">keyset, kill N+1</text>
  <text x="165" y="196" class="small">size pools per instance,</text>
  <text x="165" y="212" class="small">PgBouncer (transaction)</text>
  <text x="315" y="196" class="small">replicas + version-</text>
  <text x="315" y="212" class="small">token routing</text>
  <text x="465" y="196" class="small">monthly RANGE parts,</text>
  <text x="465" y="212" class="small">DROP old months</text>
  <text x="615" y="196" class="small">shard by customer_id,</text>
  <text x="615" y="212" class="small">move tenants online</text>
  <path class="line dashed" d="M15 236 H765"/>
  <text x="15" y="262" class="small">Cost to undo: low on the left, very high on the right. A sharded system stays sharded.</text>
  <text x="15" y="280" class="small">Migrations (expand/contract) and versioned event schemas run through every stage.</text>
</svg>
<figcaption>The stages in the usual order. Move right only when the signal shows and the stages to the left are done; a replica doesn't fix a missing index, and a shard doesn't fix an N+1.</figcaption>
</figure>

<h3>What to do at each scale</h3>
<p>There are no honest universal thresholds like "shard at X rows". Hardware, row size and query shape change the answer by orders of magnitude. Use signals you can measure on your own system.</p>
<table>
  <tr><th>Stage</th><th>Move on when you see</th><th>What you add</th><th>What it costs you</th></tr>
  <tr><td>1. Fix queries</td><td>A few queries dominate total time in <code>pg_stat_statements</code>; plans show seq scans on big tables; query count per request grows with page size</td><td>Indexes, rewritten queries, batched loading</td><td>Write cost and storage per index; nothing else</td></tr>
  <tr><td>2. Pool</td><td>Total connections across instances approach Postgres <code>max_connections</code> (default 100); <code>DB.Stats().WaitCount</code> climbing; many idle backends</td><td>Explicit <code>SetMaxOpenConns</code> per instance; PgBouncer in transaction mode</td><td>No session state across transactions: <code>SET</code>, <code>LISTEN</code>, session advisory locks, SQL-level <code>PREPARE</code></td></tr>
  <tr><td>3. Replicas</td><td>Primary CPU or I/O is mostly reads, after stage 1; a cache doesn't fit because reads are too varied or must be fresh-ish</td><td>Async replicas; a router; lag metrics</td><td>Stale reads; read-your-writes logic; more servers to run</td></tr>
  <tr><td>4. Partition</td><td>One table is far larger than the rest; queries mostly hit recent data; retention <code>DELETE</code>s cause bloat and long vacuums</td><td>Declarative RANGE partitions by month; automatic creation of next month</td><td>The partition key must be in the primary key; queries without it scan every partition</td></tr>
  <tr><td>5. Shard</td><td>Write volume or data size exceeds what the largest primary you can buy handles, and stages 1–4 are done</td><td>Shard key, shard map, routing, resharding tooling (or Citus / Vitess)</td><td>Cross-shard queries and transactions, per-shard migrations, global IDs, operations ×N</td></tr>
</table>

<h2>The incident: a Black Friday slowdown</h2>
<p>This is a made-up but typical story, and the Go example below replays its mechanics. The shop is at stage 2: one primary, a pool per instance. On the morning of the sale, a deploy ran a migration that rebuilt <code>order_items</code> to add a <code>currency</code> column. The rebuild copied the rows into a new table, dropped the old one and renamed. The index on <code>order_id</code> belonged to the old table, so it was dropped with it. Nobody noticed, because traffic was low and the history page was only a bit slower.</p>
<figure class="diagram">
<svg viewBox="0 0 780 390" role="img" aria-label="Incident timeline. 09:00 a migration drops the order_items index. Until 10:00 traffic is low. At 10:00 the sale starts. 10:03 the pool is empty, held by N+1 history requests. 10:05 checkout times out too because it shares the pool. 10:12 EXPLAIN shows a seq scan and the index is re-created concurrently. 10:20 errors drop. Next week the item lookups are batched and checkout gets its own pool.">
  <text x="20" y="24" class="title">Time</text>
  <text x="110" y="24" class="title">What happened</text>
  <text x="545" y="24" class="title">Where you see it</text>
  <text x="20" y="62" >09:00</text>
  <rect class="box muted" x="110" y="40" width="420" height="36" rx="6"/>
  <text x="320" y="62" text-anchor="middle">Deploy: migration 3 rebuilds order_items, index lost</text>
  <text x="555" y="62" class="small">schema_migrations: version 3</text>
  <text x="20" y="104">09:00–10:00</text>
  <rect class="box muted" x="110" y="82" width="420" height="36" rx="6"/>
  <text x="320" y="104" text-anchor="middle">History page slower, but traffic is low</text>
  <text x="555" y="104" class="small">p99 of one endpoint creeps up</text>
  <text x="20" y="146">10:00</text>
  <rect class="box accent" x="110" y="124" width="420" height="36" rx="6"/>
  <text x="320" y="146" text-anchor="middle">Sale starts; requests per second jump</text>
  <text x="555" y="146" class="small">throughput graph</text>
  <text x="20" y="188">10:03</text>
  <rect class="box bad" x="110" y="166" width="420" height="36" rx="6"/>
  <text x="320" y="188" text-anchor="middle">Pool empty: N+1 history requests hold every conn</text>
  <text x="555" y="188" class="small">DB.Stats(): InUse = max, WaitCount ↑</text>
  <text x="20" y="230">10:05</text>
  <rect class="box bad" x="110" y="208" width="420" height="36" rx="6"/>
  <text x="320" y="230" text-anchor="middle">Checkout times out too: it shares the same pool</text>
  <text x="555" y="230" class="small">"context deadline exceeded" in logs</text>
  <text x="20" y="272">10:12</text>
  <rect class="box accent" x="110" y="250" width="420" height="36" rx="6"/>
  <text x="320" y="272" text-anchor="middle">EXPLAIN shows Seq Scan on order_items; index re-added</text>
  <text x="555" y="272" class="small">CREATE INDEX CONCURRENTLY</text>
  <text x="20" y="314">10:20</text>
  <rect class="box ok" x="110" y="292" width="420" height="36" rx="6"/>
  <text x="320" y="314" text-anchor="middle">Errors drop; history still holds conns for 21 queries</text>
  <text x="555" y="314" class="small">traces: 21 DB spans per request</text>
  <text x="20" y="356">next week</text>
  <rect class="box ok" x="110" y="334" width="420" height="36" rx="6"/>
  <text x="320" y="356" text-anchor="middle">Batch the item lookups; checkout gets its own pool</text>
  <text x="555" y="356" class="small">traces: 2 DB spans per request</text>
</svg>
<figcaption>Two small problems that were harmless alone (a lost index, an N+1) became an outage together, through a third shared thing: the connection pool. The user-facing symptom was in checkout, which had neither problem.</figcaption>
</figure>
<p>The chain is worth spelling out, because it's how most data-layer incidents go:</p>
<ul>
  <li>The history page runs inside a transaction, so it keeps <strong>one connection for its whole life</strong>.</li>
  <li>Its life is <strong>21 queries</strong> (1 for the orders, 1 per order for the items), so it holds that connection for 21 round trips.</li>
  <li>Without the index, each of those item queries <strong>scans the whole table</strong>, so each round trip gets longer too.</li>
  <li>The pool has a fixed size. Once every connection is held by a slow history page, <strong>every other request waits</strong>, including checkout, and their contexts expire while waiting.</li>
</ul>
<div class="callout warn"><strong>Re-adding the index on a live Postgres needs <code>CREATE INDEX CONCURRENTLY</code>.</strong> A plain <code>CREATE INDEX</code> blocks writes to the table until it finishes, which during a sale means checkout stops. <code>CONCURRENTLY</code> doesn't block writes, takes longer, and can't run inside a transaction block, so migration tools need to run it outside one. The other lesson is in the migration: a table rebuild must recreate every index, and a check in CI that compares the index list before and after would have caught it.</div>

<h3>Symptom → tool</h3>
<table>
  <tr><th>Symptom</th><th>First thing to check</th><th>Likely fix</th><th>Page</th></tr>
  <tr><td>One endpoint slow, others fine</td><td><code>EXPLAIN (ANALYZE, BUFFERS)</code> of its top query</td><td>Index, sargable rewrite, keyset pagination</td><td><a href="#query-optimization">Query Optimization</a>, <a href="#database-indexing">Indexing</a></td></tr>
  <tr><td>Query count per request grows with the list size</td><td>DB spans per trace; a query counter in tests</td><td>Batch with <code>IN</code> / <code>ANY</code>, JOIN, preload</td><td><a href="#n-1-queries">N+1 Queries</a></td></tr>
  <tr><td>Timeouts everywhere, DB CPU not maxed</td><td><code>DB.Stats()</code>: <code>InUse</code>, <code>WaitCount</code>, <code>WaitDuration</code></td><td>Find who holds connections long; separate pools; right-size</td><td><a href="#connection-pooling">Connection Pooling</a></td></tr>
  <tr><td>"too many clients already" from Postgres</td><td>Pool size × instances vs <code>max_connections</code></td><td>Cap pools; PgBouncer</td><td><a href="#connection-pooling">Connection Pooling</a></td></tr>
  <tr><td>"My order disappeared" right after checkout</td><td>Which DB served the read; replica lag</td><td>Version token or primary-after-write</td><td><a href="#read-replicas">Read Replicas</a></td></tr>
  <tr><td>Deleting old events takes hours and bloats the table</td><td>Table size, vacuum activity</td><td>Monthly partitions, drop old ones</td><td><a href="#partitioning">Partitioning</a></td></tr>
  <tr><td>Everything piles up during a deploy</td><td><code>pg_locks</code> / <code>pg_stat_activity</code>: an <code>ALTER</code> waiting on a lock</td><td><code>lock_timeout</code>, expand/contract, retry</td><td><a href="#database-migrations">Database Migrations</a></td></tr>
  <tr><td>A consumer crashes on a new event</td><td>Event version vs consumer's known versions</td><td>Additive changes only; compatibility check in CI</td><td><a href="#schema-versioning">Schema Versioning</a></td></tr>
  <tr><td>One shard much busier than the others</td><td>Load per shard key</td><td>Split the hot tenant, better key</td><td><a href="#sharding">Sharding</a></td></tr>
</table>

<h2>Example</h2>
<p><strong>The incident and two fixes, then a replica router, in one Go package.</strong> It uses <code>database/sql</code> with <code>modernc.org/sqlite</code> (pure Go), so it runs anywhere with no server. SQLite stands in for Postgres: its <code>EXPLAIN QUERY PLAN</code> output differs, but scans, indexes, pools and transactions are real. Every query also waits 5 ms first, to simulate the network round trip to a database server. The seed is 1,000 customers × 20 orders × 6 items = 120,000 <code>order_items</code> rows.</p>
<p>The store: a pool of fixed size, the migrations (number 3 is the one that loses the index), and the round-trip wrapper. <code>HistoryNPlus1</code> (not shown) opens a transaction, so it holds one connection, then runs 1 query for the 20 orders and 1 per order for its items. <code>Load</code> (not shown) starts n page requests at the same instant, each with its own deadline, and counts successes, timeouts and <code>DB.Stats().WaitCount</code>. <code>HistoryBatched</code> (same file, not shown) loads the items for all 20 orders with one <code>IN (…)</code> query; the <a href="#n-1-queries">N+1 page</a> covers that pattern.</p>
<pre><code>// Store is the orders database as the app sees it: a fixed-size pool, and a
// simulated network round trip (RTT) paid by every query.
type Store struct {
	DB      *sql.DB
	RTT     time.Duration
	Queries atomic.Int64
}

func Open(path string, pool int, rtt time.Duration) (*Store, error) {
	db, err := sql.Open("sqlite", "file:"+path+
		"?_pragma=journal_mode(WAL)&amp;_pragma=busy_timeout(5000)")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(pool) // the pool: at most &#96;pool&#96; connections, others wait
	db.SetMaxIdleConns(pool)
	return &amp;Store{DB: db, RTT: rtt}, nil
}

// Migrations run in order; schema_migrations records which ones are applied.
var Migrations = []string{
	1: &#96;CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INT, created_at INT);
	    CREATE TABLE order_items (id INTEGER PRIMARY KEY, order_id INT, price_cents INT);&#96;,
	2: &#96;CREATE INDEX idx_orders_customer ON orders(customer_id, id);
	    CREATE INDEX idx_items_order ON order_items(order_id);&#96;,
	// 3 rebuilds the table to add a column (copy, drop, rename).
	// Dropping the old table silently drops idx_items_order with it.
	3: &#96;CREATE TABLE order_items_new (id INTEGER PRIMARY KEY, order_id INT,
	      price_cents INT, currency TEXT NOT NULL DEFAULT 'USD');
	    INSERT INTO order_items_new (id, order_id, price_cents)
	      SELECT id, order_id, price_cents FROM order_items;
	    DROP TABLE order_items;
	    ALTER TABLE order_items_new RENAME TO order_items;&#96;,
	4: &#96;CREATE INDEX idx_items_order ON order_items(order_id);&#96;, // the fix
}

// query pays one round trip on the request's transaction (so the
// connection stays checked out for the whole request).
func (s *Store) query(ctx context.Context, tx *sql.Tx, q string, args ...any) (*sql.Rows, error) {
	s.Queries.Add(1)
	select {
	case &lt;-time.After(s.RTT):
	case &lt;-ctx.Done():
		return nil, ctx.Err()
	}
	return tx.QueryContext(ctx, q, args...)
}</code></pre>
<p>The replica router. A write returns the primary's new version as a token. A read that carries a token goes to the replica only if the replica has applied at least that version. In Postgres the version would be a WAL position: <code>pg_current_wal_lsn()</code> on the primary after the write, compared with <code>pg_last_wal_replay_lsn()</code> on the replica.</p>
<pre><code>// Router sends writes to the primary and reads to a replica, unless the
// caller carries a version token the replica hasn't applied yet.
// The replica is fed from a log by Replicate, so lag is under test control.
// Not safe for concurrent use; a real router guards the versions with a mutex.
type Router struct {
	Primary, Replica *sql.DB
	pending          []logEntry
	primaryVer       int64 // last version committed on the primary
	replicaVer       int64 // last version the replica has applied
}

type logEntry struct {
	q    string
	args []any
}

// Write commits on the primary and returns the new version as a token.
func (r *Router) Write(ctx context.Context, q string, args ...any) (int64, error) {
	if _, err := r.Primary.ExecContext(ctx, q, args...); err != nil {
		return 0, err
	}
	r.primaryVer++
	r.pending = append(r.pending, logEntry{q, args})
	return r.primaryVer, nil
}

// Replicate applies up to n log entries to the replica (n &lt; 0: all).
func (r *Router) Replicate(ctx context.Context, n int) error {
	for ; n != 0 &amp;&amp; len(r.pending) &gt; 0; n-- {
		e := r.pending[0]
		if _, err := r.Replica.ExecContext(ctx, e.q, e.args...); err != nil {
			return err
		}
		r.pending = r.pending[1:]
		r.replicaVer++
	}
	return nil
}

// Reader picks the database for a read that must see at least minVersion
// (0 = any staleness is fine).
func (r *Router) Reader(minVersion int64) (*sql.DB, string) {
	if r.replicaVer &gt;= minVersion {
		return r.Replica, "replica"
	}
	return r.Primary, "primary"
}

func (r *Router) Lag() int64 { return r.primaryVer - r.replicaVer }</code></pre>
<p>The scenario: 12 history requests arrive at once, each with a 300 ms deadline, against a pool of 4. (<code>seed</code> just inserts the rows.)</p>
<pre><code>const itemsQuery = &#96;SELECT count(*), sum(price_cents) FROM order_items WHERE order_id = 42&#96;

func Example() {
	dir, _ := os.MkdirTemp("", "orders")
	defer os.RemoveAll(dir)
	ctx := context.Background()

	// Stage 1-2: one primary, pool of 4, 5 ms per round trip, 12 concurrent
	// "order history" requests, each with a 300 ms deadline.
	s, _ := Open(filepath.Join(dir, "orders.db"), 4, 5*time.Millisecond)
	s.Migrate(1)
	seed(s)
	s.Migrate(3) // the Black Friday deploy: rebuilds order_items
	fmt.Println("after migration 3:", s.Plan(itemsQuery))
	s.Queries.Store(0)
	s.HistoryNPlus1(ctx, 7)
	fmt.Println("N+1 page issues", s.Queries.Load(), "queries")
	fmt.Printf("incident:     %+v&#92;n", s.Load(12, 300*time.Millisecond, s.HistoryNPlus1))

	s.Migrate(4) // fix 1: put the index back
	fmt.Println("after migration 4:", s.Plan(itemsQuery))
	fmt.Printf("index only:   %+v&#92;n", s.Load(12, 300*time.Millisecond, s.HistoryNPlus1))

	s.Queries.Store(0) // fix 2: batch the item lookups
	a, _ := s.HistoryNPlus1(ctx, 7)
	n1 := s.Queries.Load()
	b, _ := s.HistoryBatched(ctx, 7)
	fmt.Println("batched page issues", s.Queries.Load()-n1, "queries; same result:",
		fmt.Sprint(a) == fmt.Sprint(b))
	fmt.Printf("index+batch:  %+v&#92;n", s.Load(12, 300*time.Millisecond, s.HistoryBatched))

	var versions []int
	rows, _ := s.DB.Query(&#96;SELECT version FROM schema_migrations ORDER BY version&#96;)
	for rows.Next() {
		var v int
		rows.Scan(&amp;v)
		versions = append(versions, v)
	}
	rows.Close()
	fmt.Println("schema_migrations:", versions)

	// Stage 3: a read replica, with the replica's apply step under our control.
	open := func(name string) *sql.DB {
		db, _ := sql.Open("sqlite", filepath.Join(dir, name))
		db.Exec(Migrations[1])
		return db
	}
	r := &amp;Router{Primary: open("primary.db"), Replica: open("replica.db")}
	count := func(minVersion int64) string {
		db, name := r.Reader(minVersion)
		var n int
		db.QueryRow(&#96;SELECT count(*) FROM orders WHERE customer_id = 7&#96;).Scan(&amp;n)
		return fmt.Sprintf("%d order(s), read from %s", n, name)
	}
	r.Write(ctx, &#96;INSERT INTO orders VALUES (1, 7, 100)&#96;)
	r.Replicate(ctx, -1)
	token, _ := r.Write(ctx, &#96;INSERT INTO orders VALUES (2, 7, 200)&#96;) // customer 7 checks out
	fmt.Println("replica lag:", r.Lag(), "write(s); token =", token)
	fmt.Println("my orders, no token: ", count(0))
	fmt.Println("my orders, with token:", count(token))
	r.Replicate(ctx, -1)
	fmt.Println("after catch-up, token:", count(token))
}</code></pre>
<p>Real output of <code>go test</code> (the <code>// Output:</code> block is pinned, so the test fails if any line changes; it passed on 5 consecutive runs on a laptop):</p>
<pre><code>after migration 3: SCAN order_items
N+1 page issues 21 queries
incident:     {OK:4 TimedOut:8 Other:0 PoolWaits:8}
after migration 4: SEARCH order_items USING INDEX idx_items_order (order_id=?)
index only:   {OK:8 TimedOut:4 Other:0 PoolWaits:8}
batched page issues 2 queries; same result: true
index+batch:  {OK:12 TimedOut:0 Other:0 PoolWaits:8}
schema_migrations: [1 2 3 4]
replica lag: 1 write(s); token = 2
my orders, no token:  1 order(s), read from replica
my orders, with token: 2 order(s), read from primary
after catch-up, token: 2 order(s), read from replica</code></pre>
<p>Things to notice:</p>
<ul>
  <li><strong>The plan tells you the migration's mistake.</strong> After migration 3, the item lookup is <code>SCAN order_items</code>: every one of 120,000 rows, 20 times per page. After migration 4 it's <code>SEARCH … USING INDEX</code>.</li>
  <li><strong>Only 4 of 12 requests survived the incident.</strong> Four got connections and finished. The other eight waited for a connection and hit their deadline: the pool turned slow queries into errors for requests that were just queued.</li>
  <li><strong>The index alone was not enough at this load.</strong> 8 of 12 succeeded. Each request still made 21 round trips while holding its connection, so the third group of four ran out of time. Fixing round trips (2 queries instead of 21) let all 12 finish.</li>
  <li><strong><code>WaitCount</code> is 8 in every run.</strong> With 12 requests and 4 connections, 8 always have to wait. The count says the pool is full; <code>WaitDuration</code> says whether that hurts. Alert on both.</li>
  <li><strong>The replica read without a token missed the customer's new order.</strong> With the token, the router saw the replica was one write behind and used the primary. After catch-up, the same token was served by the replica again.</li>
</ul>
<p>What the example leaves out: real network latency varies (here it's a fixed sleep); PgBouncer, partitions and shards appear only in the diagrams (see their pages for runnable code); and the router isn't safe for concurrent use.</p>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>Sharding too early.</strong> Every cross-customer query (admin reports, "top products") becomes a scatter-gather, every migration runs N times, and IDs must be globally unique. If stages 1–4 aren't done, sharding multiplies the problem instead of fixing it.</li>
  <li><strong>Replicas before indexes or caching.</strong> A replica runs the same bad plan. A missing index costs the same on every copy. Check plans first, then consider a <a href="#caching">cache</a> for hot, repeated reads, then replicas.</li>
  <li><strong>Migrations without <code>lock_timeout</code>.</strong> An <code>ALTER TABLE</code> waits for its lock behind one long query, and every query that arrives after it waits behind the <code>ALTER</code>. Set a short <code>lock_timeout</code> in the migration and retry, rather than freeze the table.</li>
  <li><strong>One pool for everything.</strong> In the incident, checkout died because of the history page. Give critical paths their own pool (or a reserved share), and give every request a <a href="#timeouts">deadline</a>.</li>
  <li><strong>Pools that add up past the server.</strong> Each instance sizes its pool alone, then <a href="#autoscaling">autoscaling</a> adds instances. Total = pool size × instances, and it must stay under <code>max_connections</code> (or under PgBouncer's backend pool).</li>
  <li><strong>Assuming transaction-mode PgBouncer is transparent.</strong> Session state doesn't survive between transactions: <code>SET</code>, <code>LISTEN</code>, session advisory locks, SQL <code>PREPARE</code>. Protocol-level prepared statements work only when <code>max_prepared_statements</code> is set to a non-zero value.</li>
  <li><strong>Picking a shard key the hot path doesn't have.</strong> If the history page doesn't know <code>customer_id</code>, every request goes to every shard. Pick the key from the queries, not from the data.</li>
  <li><strong>Breaking old readers.</strong> During a rolling deploy, old code reads rows written by new code, and old consumers read new events. Add optional fields; don't rename or reuse them.</li>
</ul>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>Grow in order: fix queries, pool, replicas, partitions, shards. Move on only when a measured signal shows up.</li>
  <li>Data-layer incidents chain through shared resources: a slow query plus an N+1 becomes an empty pool, and the error shows up somewhere else.</li>
  <li>Plans, query counts per request and <code>DB.Stats()</code> are the three numbers that find most problems.</li>
  <li>Change schemas with expand/contract and <code>lock_timeout</code>, route reads with version tokens, and keep every schema readable by the previous version of the code.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#connection-pooling">Connection Pooling</a> · <a href="#n-1-queries">N+1 Queries</a> · <a href="#read-replicas">Read Replicas</a> · <a href="#sharding">Sharding</a> · <a href="#database-migrations">Database Migrations</a> · <a href="#real-world-distributed-design">Real-World Distributed Design</a></p>
`;

