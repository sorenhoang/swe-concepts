CONTENT["caching"] = `
<p class="tldr"><strong>TL;DR</strong>: A cache keeps a copy of data somewhere faster or closer than where it really lives, so most reads never reach the slow source. It works because reads repeat: the same product, profile or config is asked for thousands of times between changes. A cache is the notebook on your desk; the database is the library across town.</p>

<h2>The problem it solves</h2>
<p>Most backends read far more than they write, and they read the same things over and over. Without a cache, every one of those reads pays the full price:</p>
<ul>
  <li><strong>Latency</strong>: a database query with a network hop, a parse, a plan and disk or buffer reads takes milliseconds. A lookup in process memory takes well under a microsecond.</li>
  <li><strong>Load</strong>: the database, or a third-party API with a rate limit, has to absorb every request. It is usually the hardest and most expensive part of the system to scale (see <a href="#read-replicas">Read Replicas</a> and <a href="#sharding">Sharding</a>).</li>
  <li><strong>Distance</strong>: a user far from your region pays a long round trip for every byte, even for files that never change.</li>
</ul>
<p>A cache trades <strong>freshness</strong> and <strong>memory</strong> for speed. Every cached copy can be out of date, and you must decide how out of date is acceptable. That decision is the subject of <a href="#cache-invalidation">Cache Invalidation</a>.</p>

<h2>How it works</h2>
<h3>Where caches live</h3>
<p>A single request can pass through many caches. Each layer that answers stops the request from going further:</p>

<figure class="diagram">
<svg viewBox="0 0 780 250" role="img" aria-label="Six cache layers from the user to the data: browser cache, CDN edge, reverse proxy, app in-memory cache, Redis, and the database buffer pool. The first three cache HTTP responses, the next two cache data objects, and the last is managed by the database itself.">
  <defs><marker id="arr-ca-1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <text x="20" y="24" class="small">closer to the user</text>
  <text x="760" y="24" text-anchor="end" class="small">closer to the data</text>
  <path class="line dashed" d="M130 20 H640" marker-end="url(#arr-ca-1)"/>

  <rect class="box accent" x="14" y="44" width="112" height="48" rx="8"/><text x="70" y="73" text-anchor="middle" class="title">Browser</text>
  <rect class="box accent" x="142" y="44" width="112" height="48" rx="8"/><text x="198" y="73" text-anchor="middle" class="title">CDN edge</text>
  <rect class="box accent" x="270" y="44" width="112" height="48" rx="8"/><text x="326" y="73" text-anchor="middle" class="title">Reverse proxy</text>
  <rect class="box ok" x="398" y="44" width="112" height="48" rx="8"/><text x="454" y="73" text-anchor="middle" class="title">App memory</text>
  <rect class="box ok" x="526" y="44" width="112" height="48" rx="8"/><text x="582" y="73" text-anchor="middle" class="title">Redis</text>
  <rect class="box muted" x="654" y="44" width="112" height="48" rx="8"/><text x="710" y="73" text-anchor="middle" class="title">DB buffer pool</text>
  <path class="line" d="M126 68 H140" marker-end="url(#arr-ca-1)"/>
  <path class="line" d="M254 68 H268" marker-end="url(#arr-ca-1)"/>
  <path class="line" d="M382 68 H396" marker-end="url(#arr-ca-1)"/>
  <path class="line" d="M510 68 H524" marker-end="url(#arr-ca-1)"/>
  <path class="line" d="M638 68 H652" marker-end="url(#arr-ca-1)"/>

  <text x="70" y="114" text-anchor="middle" class="small">assets, GET responses</text>
  <text x="70" y="130" text-anchor="middle" class="small">no network at all</text>
  <text x="198" y="114" text-anchor="middle" class="small">public responses</text>
  <text x="198" y="130" text-anchor="middle" class="small">near the user</text>
  <text x="326" y="114" text-anchor="middle" class="small">whole responses</text>
  <text x="326" y="130" text-anchor="middle" class="small">in your datacenter</text>
  <text x="454" y="114" text-anchor="middle" class="small">hot objects</text>
  <text x="454" y="130" text-anchor="middle" class="small">~100 ns, per pod</text>
  <text x="582" y="114" text-anchor="middle" class="small">objects, sessions</text>
  <text x="582" y="130" text-anchor="middle" class="small">~1 ms, shared</text>
  <text x="710" y="114" text-anchor="middle" class="small">data pages in RAM</text>
  <text x="710" y="130" text-anchor="middle" class="small">automatic</text>

  <path class="line accent" d="M18 160 V170 H378 V160"/>
  <text x="198" y="190" text-anchor="middle">HTTP caches</text>
  <text x="198" y="206" text-anchor="middle" class="small">controlled by Cache-Control headers</text>
  <path class="line ok" d="M402 160 V170 H634 V160"/>
  <text x="518" y="190" text-anchor="middle">data caches</text>
  <text x="518" y="206" text-anchor="middle" class="small">controlled by your code</text>
  <path class="line" d="M658 160 V170 H762 V160"/>
  <text x="710" y="190" text-anchor="middle">DB-managed</text>
  <text x="710" y="206" text-anchor="middle" class="small">you only size it</text>
  <text x="390" y="238" text-anchor="middle" class="small">Latencies are rough orders of magnitude; measure your own.</text>
</svg>
<figcaption>The left half caches whole HTTP responses and is driven by headers (see <a href="#cdn">CDN</a> and <a href="#edge-caching">Edge Caching</a>). The right half caches data objects inside your backend, which is what the code on this page does. The database's buffer pool (Postgres <code>shared_buffers</code>, InnoDB buffer pool) is a cache too; you only choose its size.</figcaption>
</figure>

<h3>Cache-aside, the default pattern</h3>
<p>In <strong>cache-aside</strong> (also called look-aside or lazy loading), the application talks to both the cache and the database. The cache knows nothing about the database:</p>

<figure class="diagram">
<svg viewBox="0 0 780 330" role="img" aria-label="Cache-aside sequence. Read: the app asks the cache, misses, queries the database, writes the value into the cache with a TTL, and returns it. The next read is a hit. Write: the app updates the database, then deletes the cache key.">
  <defs><marker id="arr-ca-2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <rect class="box" x="90" y="10" width="120" height="34" rx="6"/><text x="150" y="32" text-anchor="middle" class="title">App</text>
  <rect class="box ok" x="330" y="10" width="120" height="34" rx="6"/><text x="390" y="32" text-anchor="middle" class="title">Cache</text>
  <rect class="box muted" x="570" y="10" width="120" height="34" rx="6"/><text x="630" y="32" text-anchor="middle" class="title">Database</text>
  <path class="line dashed" d="M150 44 V320"/><path class="line dashed" d="M390 44 V320"/><path class="line dashed" d="M630 44 V320"/>

  <text x="20" y="74" class="small">read #1</text>
  <path class="line" d="M150 70 H388" marker-end="url(#arr-ca-2)"/><text x="270" y="64" text-anchor="middle" class="small">1 GET product:42</text>
  <path class="line bad dashed" d="M390 96 H152" marker-end="url(#arr-ca-2)"/><text x="270" y="90" text-anchor="middle" class="small">2 miss (nil)</text>
  <path class="line" d="M150 122 H628" marker-end="url(#arr-ca-2)"/><text x="510" y="116" text-anchor="middle" class="small">3 SELECT ... WHERE id = 42</text>
  <path class="line dashed" d="M630 148 H152" marker-end="url(#arr-ca-2)"/><text x="510" y="142" text-anchor="middle" class="small">4 row</text>
  <path class="line accent" d="M150 174 H388" marker-end="url(#arr-ca-2)"/><text x="270" y="168" text-anchor="middle" class="small">5 SET product:42 EX 600</text>

  <text x="20" y="214" class="small">read #2</text>
  <path class="line" d="M150 210 H388" marker-end="url(#arr-ca-2)"/><text x="270" y="204" text-anchor="middle" class="small">GET product:42</text>
  <path class="line ok dashed" d="M390 236 H152" marker-end="url(#arr-ca-2)"/><text x="270" y="230" text-anchor="middle" class="small">hit: no DB work</text>

  <text x="20" y="276" class="small">write</text>
  <path class="line" d="M150 272 H628" marker-end="url(#arr-ca-2)"/><text x="510" y="266" text-anchor="middle" class="small">UPDATE products SET ...</text>
  <path class="line bad" d="M150 304 H388" marker-end="url(#arr-ca-2)"/><text x="270" y="298" text-anchor="middle" class="small">DEL product:42</text>
</svg>
<figcaption>Reads fill the cache on demand, so only data someone asked for takes memory. Writes go to the database and then <em>delete</em> the key rather than overwrite it; <a href="#cache-invalidation">Cache Invalidation</a> explains why.</figcaption>
</figure>

<h3>Other patterns</h3>
<table>
  <tr><th>Pattern</th><th>Read path</th><th>Write path</th><th>Good for</th><th>Main risk</th></tr>
  <tr><td><strong>Cache-aside</strong></td><td>app checks cache, loads from DB on miss, fills cache</td><td>app writes DB, deletes key</td><td>the general default; cache can fail without breaking reads</td><td>first read after a miss is slow; stale window on races</td></tr>
  <tr><td><strong>Read-through</strong></td><td>app asks the cache only; the cache library loads from the DB</td><td>usually combined with one of the write patterns</td><td>keeping loading logic in one place</td><td>same as cache-aside; loader is hidden from callers</td></tr>
  <tr><td><strong>Write-through</strong></td><td>always a hit for recently written data</td><td>write goes to cache and DB together, synchronously</td><td>read-after-write data such as profiles</td><td>slower writes; caches data nobody reads; two writes can still race</td></tr>
  <tr><td><strong>Write-behind</strong> (write-back)</td><td>from cache</td><td>write to cache, flush to DB later in batches</td><td>very high write rates: counters, metrics, view counts</td><td><strong>data loss</strong> if the cache dies before the flush</td></tr>
  <tr><td><strong>Refresh-ahead</strong></td><td>from cache; entries close to expiry are reloaded in the background</td><td>any</td><td>hot keys whose miss would be expensive</td><td>refreshing keys nobody will read again</td></tr>
</table>

<h3>Eviction: what to drop when memory is full</h3>
<p>A cache is smaller than the data behind it, so something must go.</p>
<table>
  <tr><th>Policy</th><th>Drops</th><th>Fits</th><th>Weakness</th></tr>
  <tr><td><strong>LRU</strong> (least recently used)</td><td>the entry not touched for the longest time</td><td>most workloads: recent things get asked for again</td><td>one big scan (a report, a crawler) flushes the hot set</td></tr>
  <tr><td><strong>LFU</strong> (least frequently used)</td><td>the entry with the fewest hits</td><td>stable popularity: a top-1,000 product list</td><td>yesterday's popular items linger unless counts decay</td></tr>
  <tr><td><strong>TTL</strong> (time to live)</td><td>anything older than its expiry, regardless of memory</td><td>bounding staleness; used together with LRU or LFU</td><td>alone it doesn't bound memory</td></tr>
  <tr><td>FIFO / random</td><td>oldest inserted / any entry</td><td>very cheap bookkeeping</td><td>may drop the hottest key</td></tr>
</table>
<p>In Redis this is <code>maxmemory-policy</code>: for example <code>allkeys-lru</code>, <code>allkeys-lfu</code> or <code>volatile-ttl</code>. The default is <code>noeviction</code>, which rejects writes when memory is full. That is right for a primary datastore and wrong for a cache, so set the policy explicitly. Redis's LRU and LFU are approximations: it samples a few keys and evicts the best candidate among them instead of keeping a perfect ordering. In Go, <code>github.com/hashicorp/golang-lru/v2</code> provides a size-bounded LRU, and its <code>expirable</code> package adds TTLs.</p>

<h3>Hit ratio: the number that matters</h3>
<p>Hit ratio <em>h</em> = hits / (hits + misses). The average read costs:</p>
<pre><code>effective latency = h × t_hit + (1 − h) × (t_hit + t_miss)</code></pre>
<p>With <code>t_hit</code> = 1 ms (Redis) and <code>t_miss</code> = 50 ms (database), a 90% hit ratio gives 0.9 × 1 + 0.1 × 51 = <strong>6 ms</strong>; 99% gives <strong>1.5 ms</strong>. The load on the database is even more striking. It only sees the misses, so going from 90% to 99% cuts database traffic by <strong>10×</strong> (10% of requests down to 1%). Small changes near the top of the hit ratio have big effects, in both directions.</p>

<h3>Stampedes, hot keys and penetration</h3>
<figure class="diagram">
<svg viewBox="0 0 780 250" role="img" aria-label="Cache stampede. Left: a hot key expires and 1,000 concurrent requests all miss and send 1,000 identical queries to the database. Right: with singleflight, the requests for the same key wait on one in-flight load, and the database gets one query.">
  <defs><marker id="arr-ca-3" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <text x="195" y="22" text-anchor="middle" class="title">Without singleflight</text>
  <text x="590" y="22" text-anchor="middle" class="title">With singleflight</text>
  <path class="line" d="M390 10 V242" style="stroke: var(--line)"/>

  <rect class="box" x="20" y="90" width="110" height="56" rx="8"/><text x="75" y="114" text-anchor="middle" class="title">1,000 reqs</text><text x="75" y="132" text-anchor="middle" class="small">key just expired</text>
  <path class="line bad" d="M130 100 L258 70" marker-end="url(#arr-ca-3)"/>
  <path class="line bad" d="M130 110 L258 96" marker-end="url(#arr-ca-3)"/>
  <path class="line bad" d="M130 118 L258 118" marker-end="url(#arr-ca-3)"/>
  <path class="line bad" d="M130 126 L258 140" marker-end="url(#arr-ca-3)"/>
  <path class="line bad" d="M130 136 L258 166" marker-end="url(#arr-ca-3)"/>
  <rect class="box bad" x="260" y="56" width="110" height="124" rx="8"/><text x="315" y="112" text-anchor="middle" class="title">Database</text><text x="315" y="130" text-anchor="middle" class="small">CPU 100%</text>
  <text x="195" y="210" text-anchor="middle" class="small">1,000 identical queries at once;</text>
  <text x="195" y="226" text-anchor="middle" class="small">slow queries time out, clients retry, it gets worse</text>

  <rect class="box" x="410" y="90" width="110" height="56" rx="8"/><text x="465" y="114" text-anchor="middle" class="title">1,000 reqs</text><text x="465" y="132" text-anchor="middle" class="small">key just expired</text>
  <path class="line" d="M520 104 H556" marker-end="url(#arr-ca-3)"/>
  <path class="line" d="M520 118 H556" marker-end="url(#arr-ca-3)"/>
  <path class="line" d="M520 132 H556" marker-end="url(#arr-ca-3)"/>
  <rect class="box accent" x="558" y="90" width="96" height="56" rx="8"/><text x="606" y="114" text-anchor="middle" class="title">one load</text><text x="606" y="132" text-anchor="middle" class="small">999 wait</text>
  <path class="line ok" d="M654 118 H676" marker-end="url(#arr-ca-3)"/>
  <rect class="box ok" x="678" y="90" width="88" height="56" rx="8"/><text x="722" y="114" text-anchor="middle" class="title">Database</text><text x="722" y="132" text-anchor="middle" class="small">1 query</text>
  <text x="590" y="210" text-anchor="middle" class="small">all 1,000 get the same result;</text>
  <text x="590" y="226" text-anchor="middle" class="small">per process: 50 pods still send up to 50 queries</text>
</svg>
<figcaption>A <strong>cache stampede</strong> (thundering herd, dog-piling) happens when a popular key expires or the cache restarts. <code>singleflight</code> collapses concurrent loads of the same key inside one process. Across processes, use a short lock or lease in the shared cache, refresh-ahead, or serve stale while one caller refreshes.</figcaption>
</figure>
<ul>
  <li><strong>Hot keys.</strong> One key (a viral product, a global config) gets a large share of all reads. In Redis Cluster a key lives on one shard, so one node saturates while the others are idle. Fixes: a tiny in-process cache in front of Redis with a TTL of a few seconds, or copies of the key under several names (<code>product:42#1</code> … <code>#8</code>) with reads picking one at random.</li>
  <li><strong>Penetration.</strong> Requests for keys that don't exist (<code>/product/999999999</code>, often from a bot) miss the cache every time and always reach the database. Cache the "not found" result for a short TTL, or check a Bloom filter of valid IDs first.</li>
  <li><strong>Avalanche.</strong> Many keys written at the same moment (a warm-up job, a deploy) expire at the same moment too. Add random jitter to TTLs.</li>
</ul>

<h2>Example</h2>
<p><strong>An in-process cache-aside helper</strong> with TTLs, <code>singleflight</code> for stampedes, and negative caching for penetration. Generic over the value type:</p>
<pre><code>package caching

import (
	"context"
	"errors"
	"sync"
	"time"

	"golang.org/x/sync/singleflight"
)

var ErrNotFound = errors.New("not found")

type entry[V any] struct {
	val     V
	err     error // cached ErrNotFound: negative caching
	expires time.Time
}

// Cache is an in-process cache-aside helper: TTL per entry, one loader per
// key at a time (singleflight), and short-lived negative entries.
type Cache[V any] struct {
	mu      sync.RWMutex
	items   map[string]entry[V]
	group   singleflight.Group
	ttl     time.Duration
	negTTL  time.Duration
	maxSize int
}

func New[V any](ttl, negTTL time.Duration, maxSize int) *Cache[V] {
	return &amp;Cache[V]{items: map[string]entry[V]{}, ttl: ttl, negTTL: negTTL, maxSize: maxSize}
}

func (c *Cache[V]) Get(ctx context.Context, key string, load func(context.Context) (V, error)) (V, error) {
	c.mu.RLock()
	e, ok := c.items[key]
	c.mu.RUnlock()
	if ok &amp;&amp; time.Now().Before(e.expires) {
		return e.val, e.err // hit (possibly a cached "not found")
	}

	// Miss: concurrent callers for the same key share ONE load.
	v, err, _ := c.group.Do(key, func() (any, error) {
		val, err := load(ctx)
		switch {
		case err == nil:
			c.set(key, entry[V]{val: val, expires: time.Now().Add(c.ttl)})
		case errors.Is(err, ErrNotFound):
			c.set(key, entry[V]{err: err, expires: time.Now().Add(c.negTTL)})
		} // other errors (DB down) are NOT cached
		return val, err
	})
	val, _ := v.(V)
	return val, err
}

func (c *Cache[V]) set(key string, e entry[V]) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.items) &gt;= c.maxSize {
		// ponytail: random eviction (map order); use golang-lru/v2 for real LRU
		for k := range c.items {
			delete(c.items, k)
			break
		}
	}
	c.items[key] = e
}

func (c *Cache[V]) Delete(key string) {
	c.mu.Lock()
	delete(c.items, key)
	c.mu.Unlock()
}</code></pre>
<p>A test fires 1,000 goroutines at an empty key with a 50 ms loader, then asks for a missing ID three times. Real output:</p>
<pre><code>1000 concurrent misses -&gt; DB calls: 1
after warm-up, one more Get -&gt; DB calls: 1
missing key: not found | DB calls: 2
missing key: not found | DB calls: 2
missing key: not found | DB calls: 2</code></pre>

<p><strong>The same pattern on Redis</strong>, shared by every pod, with <code>github.com/redis/go-redis/v9</code>. A Redis error is treated as a miss, so a cache outage makes the service slower instead of down:</p>
<pre><code>package caching

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand/v2"
	"time"

	"github.com/redis/go-redis/v9"
)

type Product struct {
	ID    string &#96;json:"id"&#96;
	Name  string &#96;json:"name"&#96;
	Price int    &#96;json:"price_cents"&#96;
}

type ProductStore interface {
	ProductByID(ctx context.Context, id string) (Product, error)
}

type ProductCache struct {
	rdb *redis.Client
	db  ProductStore
	ttl time.Duration
}

func (pc *ProductCache) Get(ctx context.Context, id string) (Product, error) {
	key := "product:v1:" + id

	// 1. Try the cache.
	b, err := pc.rdb.Get(ctx, key).Bytes()
	if err == nil {
		var p Product
		if json.Unmarshal(b, &amp;p) == nil {
			return p, nil
		}
	} else if !errors.Is(err, redis.Nil) {
		// Redis is down or slow: fall through to the DB instead of failing.
		fmt.Println("redis error, reading DB:", err)
	}

	// 2. Miss: read the source of truth.
	p, err := pc.db.ProductByID(ctx, id)
	if err != nil {
		return Product{}, err
	}

	// 3. Populate with TTL + jitter so keys written together don't expire together.
	jitter := time.Duration(rand.Int64N(int64(pc.ttl / 10)))
	if b, err := json.Marshal(p); err == nil {
		pc.rdb.Set(ctx, key, b, pc.ttl+jitter)
	}
	return p, nil
}</code></pre>
<p>Three requests for product 42 against a test Redis (<code>miniredis</code>). Real output:</p>
<pre><code>request 1: {ID:42 Name:Desk lamp Price:2999}  db calls=1
request 2: {ID:42 Name:Desk lamp Price:2999}  db calls=1
request 3: {ID:42 Name:Desk lamp Price:2999}  db calls=1
redis keys: [product:v1:42]  ttl between 10m and 11m: true
stored value: {"id":"42","name":"Desk lamp","price_cents":2999}</code></pre>
<p>The <code>v1</code> in the key is deliberate. When the <code>Product</code> struct changes shape, bump it to <code>v2</code> and old entries are simply never read again. Combine the two layers (a local cache with a few seconds of TTL in front of Redis) when a few keys are very hot.</p>

<p><strong>Real-world scenario: the cold cache.</strong> A product API serves 10,000 reads/s with a 95% hit ratio, so Postgres sees about 500 queries/s and is comfortable up to around 2,000. At 09:00 the Redis node is replaced during maintenance and comes back empty. For the next minute the hit ratio is near 0%, and Postgres receives close to 10,000 queries/s, five times its capacity. Queries slow down, requests time out, clients retry, and the cache can't fill because the loads keep failing. The fix has several parts: <code>singleflight</code> so each pod loads a key once, a replica or failover so the cache isn't lost on maintenance, a warm-up of the top keys before taking traffic, and <a href="#rate-limiting">load shedding</a> at the database. Size the database for the moment the cache is empty, or protect it from that moment.</p>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>Caching before measuring.</strong> A cache adds a second copy of the data, a staleness window and a new failure mode. Fix the slow query or add an index first (see <a href="#query-optimization">Query Optimization</a>); cache what stays expensive.</li>
  <li><strong>Treating the cache as the source of truth.</strong> Caches evict and restart. Anything that must survive belongs in the database; write-behind is the exception you choose knowingly.</li>
  <li><strong>Caching errors.</strong> A DB timeout cached for 10 minutes turns a 2-second blip into a 10-minute outage. Cache "not found" briefly; never cache transient failures.</li>
  <li><strong>The context trap in <code>singleflight</code>.</strong> All waiters share the first caller's load. If that caller's context is cancelled, everyone gets the error. Use a detached context with its own timeout for the load, or <code>DoChan</code> so each waiter can stop waiting on its own deadline.</li>
  <li><strong>Unbounded in-process caches.</strong> A <code>map</code> with no size limit is a <a href="#memory-leaks">memory leak</a> with a hit ratio. Bound by entries or bytes.</li>
  <li><strong>Per-pod caches disagree.</strong> With 30 pods, each local cache expires at a different time, so two requests can see different prices. Keep local TTLs short, or use them only for data where that is fine.</li>
  <li><strong>Caching per-user data under a shared key.</strong> Include every input that changes the result (user, locale, currency, permissions) in the key, or one user sees another's data.</li>
  <li><strong>Not watching the hit ratio.</strong> Export hits and misses as <a href="#metrics">metrics</a>. A falling hit ratio is an early warning that the database will be next.</li>
</ul>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>Cache where reads repeat and staleness is acceptable; every layer from browser to buffer pool is a cache.</li>
  <li>Cache-aside with TTLs and delete-on-write is the default; reach for write-through, write-behind or refresh-ahead for specific needs.</li>
  <li>Hit ratio drives everything: from 90% to 99% means 10× less database load.</li>
  <li>Plan for misses: <code>singleflight</code> against stampedes, negative caching against penetration, jitter against avalanches, and a database that survives a cold cache.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#cdn">CDN</a> · <a href="#edge-caching">Edge Caching</a> · <a href="#cache-invalidation">Cache Invalidation</a> · <a href="#latency">Latency</a> · <a href="#reverse-proxies">Reverse Proxies</a> · <a href="#real-world-caching-stack">Real-World Caching Stack</a></p>
`;
