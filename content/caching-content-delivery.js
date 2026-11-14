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
CONTENT["cdn"] = `
<p class="tldr"><strong>TL;DR</strong>: A CDN (Content Delivery Network) is a worldwide network of cache servers, grouped in <strong>Points of Presence (PoPs)</strong>, that keeps copies of your content close to your users. A nearby edge answers most requests, so pages load faster, and your origin only sees the misses. It's a chain of local warehouses in front of one central factory.</p>

<h2>The problem it solves</h2>
<p>Say your app runs in one cloud region. A user far from that region pays for the physical distance on <em>every</em> round trip: the TCP handshake, the TLS handshake, then each request for HTML, JS, CSS and images. Light in fiber covers roughly 200 km per millisecond, so a path of 20,000 km costs about 100 ms one way, or 200 ms per round trip, before any server does any work. Real network paths are longer than a straight line, so it's usually worse.</p>
<p>At the same time your origin serves the same <code>logo.png</code> and <code>app.js</code> millions of times. That's wasted CPU and bandwidth, and bandwidth leaving a cloud (<strong>egress</strong>) is billed per GB. A traffic spike (a launch, a viral post, a DDoS) can knock the origin over.</p>
<p>A CDN fixes both: <strong>move the bytes closer to the user</strong>, and <strong>answer repeated requests from cache</strong> so the origin handles a small fraction of the traffic.</p>

<h2>How it works</h2>
<p>The CDN runs servers in many PoPs around the world. You point a hostname (e.g. <code>cdn.example.com</code>, or your whole domain) at the CDN, and the CDN gets each user to a nearby PoP. That edge server checks its cache:</p>
<ul>
  <li><strong>Cache hit</strong>: it has a fresh copy and answers immediately. The origin never sees the request.</li>
  <li><strong>Cache miss</strong>: it fetches the object from upstream, stores it if it's cacheable, and returns it. Upstream is either your origin or, better, an <strong>origin shield</strong>: one regional cache that all PoPs ask first, so a miss in 50 PoPs becomes one origin fetch instead of 50.</li>
</ul>

<figure class="diagram">
<svg viewBox="0 0 780 330" role="img" aria-label="CDN architecture: users connect to nearby edge PoPs; only cache misses travel to the origin shield, and only shield misses reach the origin.">
  <defs><marker id="arr-cdn-1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <text x="95" y="30" text-anchor="middle" class="title">Users</text>
  <text x="335" y="30" text-anchor="middle" class="title">Edge PoPs (cache)</text>
  <text x="550" y="30" text-anchor="middle" class="title">Origin shield</text>
  <text x="715" y="30" text-anchor="middle" class="title">Origin</text>

  <rect class="box" x="20" y="60" width="150" height="44" rx="8"/><text x="95" y="87" text-anchor="middle">Users, region A</text>
  <rect class="box" x="20" y="160" width="150" height="44" rx="8"/><text x="95" y="187" text-anchor="middle">Users, region B</text>
  <rect class="box" x="20" y="260" width="150" height="44" rx="8"/><text x="95" y="287" text-anchor="middle">Users, region C</text>

  <rect class="box accent" x="250" y="60" width="170" height="44" rx="8"/><text x="335" y="87" text-anchor="middle">PoP A</text>
  <rect class="box accent" x="250" y="160" width="170" height="44" rx="8"/><text x="335" y="187" text-anchor="middle">PoP B</text>
  <rect class="box accent" x="250" y="260" width="170" height="44" rx="8"/><text x="335" y="287" text-anchor="middle">PoP C</text>

  <rect class="box" x="490" y="157" width="120" height="50" rx="8"/><text x="550" y="179" text-anchor="middle">Regional cache</text><text x="550" y="196" text-anchor="middle" class="small">near the origin</text>
  <rect class="box ok" x="660" y="157" width="110" height="50" rx="8"/><text x="715" y="179" text-anchor="middle">Your app</text><text x="715" y="196" text-anchor="middle" class="small">one region</text>

  <path class="line ok" d="M170 82 H248" marker-end="url(#arr-cdn-1)"/><text x="209" y="75" text-anchor="middle" class="small">nearby</text>
  <path class="line ok" d="M170 182 H248" marker-end="url(#arr-cdn-1)"/><text x="209" y="175" text-anchor="middle" class="small">nearby</text>
  <path class="line ok" d="M170 282 H248" marker-end="url(#arr-cdn-1)"/><text x="209" y="275" text-anchor="middle" class="small">nearby</text>

  <path class="line dashed" d="M420 82 L488 168" marker-end="url(#arr-cdn-1)"/>
  <path class="line dashed" d="M420 182 H488" marker-end="url(#arr-cdn-1)"/>
  <path class="line dashed" d="M420 282 L488 196" marker-end="url(#arr-cdn-1)"/>
  <text x="462" y="118" class="small">miss only</text>
  <path class="line dashed" d="M610 182 H658" marker-end="url(#arr-cdn-1)"/>
  <text x="635" y="232" text-anchor="middle" class="small">one fetch for</text>
  <text x="635" y="246" text-anchor="middle" class="small">many PoP misses</text>
</svg>
<figcaption>Solid green = every request (a short hop to a nearby PoP). Dashed = cache misses only. With a high hit ratio and a shield, the origin serves a tiny fraction of the traffic.</figcaption>
</figure>

<h3>Getting each user to the nearest edge</h3>
<p>There are two main techniques (the <a href="#dns">DNS</a> page covers the DNS mechanics):</p>
<ul>
  <li><strong>GeoDNS</strong>: each PoP has its own IP addresses. The CDN's DNS server looks at where the query came from (the user's resolver, or the client subnet if the resolver sends EDNS Client Subnet) and answers with the IP of a nearby, healthy PoP. Steering changes take effect as DNS TTLs expire.</li>
  <li><strong>Anycast</strong>: every PoP announces <em>the same</em> IP prefix over BGP. The internet's routing delivers each packet to the closest PoP in network terms. No DNS tricks needed, failover is fast (a PoP stops announcing and traffic flows to the next one), and attack traffic is split across all PoPs.</li>
</ul>

<figure class="diagram">
<svg viewBox="0 0 780 262" role="img" aria-label="Left, GeoDNS: the user asks the CDN's DNS for cdn.example.com and receives the address of PoP A, then connects to it. Each PoP has a different IP. Right, anycast: all three PoPs announce the same IP; BGP routing delivers the user's packets to the nearest PoP, and the farther PoPs are not used.">
  <defs><marker id="arr-cdn-2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <text x="195" y="22" text-anchor="middle" class="title">GeoDNS: different IP per PoP</text>
  <text x="590" y="22" text-anchor="middle" class="title">Anycast: same IP everywhere</text>
  <path class="line dashed" d="M390 10 V254"/>

  <rect class="box" x="20" y="110" width="90" height="44" rx="8"/><text x="65" y="137" text-anchor="middle">User</text>
  <rect class="box accent" x="150" y="40" width="120" height="44" rx="8"/><text x="210" y="60" text-anchor="middle">CDN DNS</text><text x="210" y="76" text-anchor="middle" class="small">picks by location</text>
  <path class="line" d="M80 108 L148 70" marker-end="url(#arr-cdn-2)"/>
  <text x="20" y="66" class="small">1 cdn.example.com?</text>
  <path class="line dashed" d="M160 86 L108 116" marker-end="url(#arr-cdn-2)"/>
  <text x="140" y="112" class="small">2 203.0.113.10</text>
  <rect class="box ok" x="230" y="130" width="140" height="34" rx="6"/><text x="300" y="152" text-anchor="middle" class="small">PoP A 203.0.113.10</text>
  <rect class="box muted" x="230" y="174" width="140" height="34" rx="6"/><text x="300" y="196" text-anchor="middle" class="small">PoP B 198.51.100.20</text>
  <rect class="box muted" x="230" y="218" width="140" height="34" rx="6"/><text x="300" y="240" text-anchor="middle" class="small">PoP C 192.0.2.30</text>
  <path class="line ok" d="M110 140 L228 146" marker-end="url(#arr-cdn-2)"/>
  <text x="150" y="168" class="small">3 connect</text>

  <rect class="box" x="420" y="110" width="90" height="44" rx="8"/><text x="465" y="137" text-anchor="middle">User</text>
  <text x="465" y="176" text-anchor="middle" class="small">connects to</text>
  <text x="465" y="190" text-anchor="middle" class="small">192.0.2.1</text>
  <rect class="box ok" x="600" y="50" width="160" height="34" rx="6"/><text x="680" y="72" text-anchor="middle" class="small">PoP A 192.0.2.1 (near)</text>
  <rect class="box muted" x="600" y="115" width="160" height="34" rx="6"/><text x="680" y="137" text-anchor="middle" class="small">PoP B 192.0.2.1</text>
  <rect class="box muted" x="600" y="180" width="160" height="34" rx="6"/><text x="680" y="202" text-anchor="middle" class="small">PoP C 192.0.2.1</text>
  <path class="line ok" d="M510 122 L598 74" marker-end="url(#arr-cdn-2)"/>
  <text x="606" y="104" class="small">BGP: shortest path</text>
  <path class="line dashed" d="M510 132 H598"/>
  <path class="line dashed" d="M510 142 L598 192"/>
  <text x="680" y="238" text-anchor="middle" class="small">if PoP A withdraws its route,</text>
  <text x="680" y="252" text-anchor="middle" class="small">packets flow to the next nearest</text>
</svg>
<figcaption>GeoDNS steers with the DNS answer, so it's only as fresh as the TTL and as accurate as the resolver's location. Anycast steers with routing, so it's "nearest by network path", which is usually but not always nearest by distance. Many CDNs combine both.</figcaption>
</figure>

<h3>Why it's faster even on a miss: TLS at the edge</h3>
<p>The edge terminates TCP and TLS. The handshakes happen over the short user-to-edge path, and the edge talks to the origin over connections it keeps open and warm, often over the CDN's own backbone. A rough model with TLS 1.3 (one round trip for the TLS handshake), a 200 ms round trip from the user to the origin, 20 ms to the edge, and 180 ms from the edge to the origin:</p>

<figure class="diagram">
<svg viewBox="0 0 780 214" role="img" aria-label="Time to first byte. Direct to origin: TCP handshake 200 ms, TLS 200 ms, request 200 ms, total 600 ms. Through the edge on a miss: 60 ms of handshakes and request near the user plus 180 ms to the origin over a warm connection, total 240 ms. Edge hit: 60 ms.">
  <text x="390" y="20" text-anchor="middle" class="small">scale: 0 to 600 ms · RTT user↔origin 200 ms, user↔edge 20 ms, edge↔origin 180 ms</text>
  <text x="170" y="62" text-anchor="end">Direct to origin</text>
  <rect class="box muted" x="180" y="44" width="160" height="28" rx="3"/><text x="260" y="63" text-anchor="middle" class="small">TCP 200</text>
  <rect class="box muted" x="340" y="44" width="160" height="28" rx="3"/><text x="420" y="63" text-anchor="middle" class="small">TLS 200</text>
  <rect class="box bad" x="500" y="44" width="160" height="28" rx="3"/><text x="580" y="63" text-anchor="middle" class="small">request 200</text>
  <text x="668" y="63" class="small">600 ms</text>

  <text x="170" y="112" text-anchor="end">Edge, cache miss</text>
  <rect class="box accent" x="180" y="94" width="48" height="28" rx="3"/>
  <rect class="box muted" x="228" y="94" width="144" height="28" rx="3"/><text x="300" y="113" text-anchor="middle" class="small">edge → origin 180</text>
  <text x="380" y="113" class="small">240 ms</text>

  <text x="170" y="162" text-anchor="end">Edge, cache hit</text>
  <rect class="box ok" x="180" y="144" width="48" height="28" rx="3"/>
  <text x="236" y="163" class="small">60 ms</text>
  <path class="line" d="M180 184 H660"/>
  <path class="line" d="M180 179 V189 M340 179 V189 M500 179 V189 M660 179 V189"/>
  <text x="180" y="204" text-anchor="middle" class="small">0</text><text x="340" y="204" text-anchor="middle" class="small">200</text><text x="500" y="204" text-anchor="middle" class="small">400</text><text x="660" y="204" text-anchor="middle" class="small">600</text>
</svg>
<figcaption>The two short bars are TCP + TLS + request near the user (3 × 20 ms). A model, not a benchmark: it ignores server time, and TLS 1.2 or a cold edge-to-origin connection adds round trips. Even uncacheable API calls gain from terminating TLS nearby.</figcaption>
</figure>

<h3>Pull, push and shields</h3>
<table>
  <tr><th>Model</th><th>How content gets to the edge</th><th>Good for</th><th>Watch out for</th></tr>
  <tr><td><strong>Origin pull</strong> (the default)</td><td>The edge fetches from your origin on the first miss and caches it per your headers</td><td>Websites, APIs, anything that changes; zero upload step</td><td>The first user per PoP pays for the miss; a purge sends every PoP back to the origin</td></tr>
  <tr><td><strong>Push / storage origin</strong></td><td>You upload files ahead of time to the CDN's storage (or an object store like S3 that the CDN reads from)</td><td>Large static files: video, installers, game patches</td><td>You manage uploads and deletes; it's really "pull from a bucket" on most CDNs</td></tr>
  <tr><td><strong>Origin shield / tiered cache</strong></td><td>PoPs pull from a regional mid-tier cache, which pulls from the origin</td><td>Many PoPs, a long tail of objects, a fragile origin</td><td>One more hop on a miss; usually priced per request (CloudFront Origin Shield, Cloudflare Tiered Cache, Fastly shielding)</td></tr>
  <tr><td><strong>Multi-CDN</strong></td><td>DNS or a steering service splits traffic between two or more CDNs</td><td>Very large sites that need to survive one CDN's outage, or want price leverage</td><td>Two configs, two purge APIs, two sets of certificates; you're limited to features both support</td></tr>
</table>

<h3>What to put on a CDN</h3>
<ul>
  <li><strong>Always</strong>: static assets with fingerprinted names (<code>app.3f9a1c.js</code>), images, fonts, video, downloads. Cache them for a year.</li>
  <li><strong>Usually</strong>: HTML and public API reads that are the same for everyone, with a short edge TTL (seconds to minutes). Some CDNs don't cache these by default; Cloudflare, for example, doesn't cache HTML or JSON until you add a cache rule.</li>
  <li><strong>Pass through</strong>: anything personalized (<code>/me</code>, cart, account pages) and all writes. They still get the TLS and routing benefits, just no caching.</li>
</ul>
<p>The headers that drive all of this (<code>Cache-Control</code>, <code>s-maxage</code>, <code>Vary</code>, <code>ETag</code>) are covered in <a href="#edge-caching">Edge Caching</a>.</p>

<h3>Hit ratio and cost</h3>
<p>Two different ratios matter:</p>
<ul>
  <li><strong>Request hit ratio</strong> = edge hits / all requests. Drives latency and origin request load.</li>
  <li><strong>Byte hit ratio</strong> = bytes served from cache / all bytes served. Drives origin egress cost. A site can have a 90% request hit ratio and a much lower byte hit ratio if its big video files miss.</li>
</ul>
<p>Worked example: you serve 50 TB a month. With a 95% byte hit ratio, the origin sends only 2.5 TB; the CDN delivers the other 47.5 TB, usually at a lower per-GB rate than raw cloud egress. Some pairings make the origin leg free: AWS doesn't charge for data transfer from AWS origins (S3, EC2, load balancers) to CloudFront. Drop to an 80% byte hit ratio and the origin sends 10 TB, four times as much, so the hit ratio is the number to watch on the CDN dashboard (see <a href="#metrics">Metrics</a>).</p>

<h3>DDoS absorption</h3>
<p>A CDN puts a very large, spread-out network in front of your origin. Volumetric floods land on the PoPs (with anycast, split across all of them), cached content keeps being served, and only cache misses that pass the CDN's filters reach your servers. That only works if attackers can't go around it: lock the origin so it accepts traffic only from the CDN. Details in <a href="#ddos-protection">DDoS Protection</a> and <a href="#waf">WAF</a>.</p>

<h2>Example</h2>
<p><strong>A two-tier CDN in about 100 lines of Go.</strong> Each <code>Cache</code> is one tier (an edge PoP or the shield). It keys on path + query, honours <code>s-maxage</code>/<code>max-age</code> and <code>private</code>/<code>no-store</code>, collapses concurrent misses with <code>singleflight</code> (CDNs call this <em>request collapsing</em>), and adds an <code>X-Cache</code> header like CloudFront's.</p>
<pre><code>package cdn

import (
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/sync/singleflight"
)

type entry struct {
	body    []byte
	ctype   string
	cc      string // passed downstream so the next tier can cache too
	expires time.Time
}

// Cache is one caching tier: an edge PoP or an origin shield.
// upstream is the next tier (the shield) or the origin itself.
type Cache struct {
	Name     string
	upstream string

	mu    sync.Mutex
	store map[string]entry
	group singleflight.Group

	Hits, Misses atomic.Int64
}

func NewCache(name, upstream string) *Cache {
	return &amp;Cache{Name: name, upstream: upstream, store: map[string]entry{}}
}

func (c *Cache) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	key := r.URL.RequestURI() // cache key: path + query string
	c.mu.Lock()
	e, ok := c.store[key]
	c.mu.Unlock()

	status := "HIT"
	if !ok || time.Now().After(e.expires) {
		status = "MISS"
		// Request collapsing: 100 concurrent misses for one key = 1 upstream fetch.
		v, err, _ := c.group.Do(key, func() (any, error) { return c.fetch(key) })
		if err != nil {
			http.Error(w, "upstream unavailable", http.StatusBadGateway)
			return
		}
		e = v.(entry)
		c.Misses.Add(1)
	} else {
		c.Hits.Add(1)
	}
	w.Header().Set("Content-Type", e.ctype)
	w.Header().Set("Cache-Control", e.cc)
	w.Header().Set("X-Cache", status+" from "+c.Name)
	w.Write(e.body)
}

func (c *Cache) fetch(key string) (entry, error) {
	resp, err := http.Get(c.upstream + key)
	if err != nil {
		return entry{}, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return entry{}, err
	}
	cc := resp.Header.Get("Cache-Control")
	ttl := sharedTTL(cc)
	e := entry{body: body, ctype: resp.Header.Get("Content-Type"), cc: cc, expires: time.Now().Add(ttl)}
	if resp.StatusCode == http.StatusOK &amp;&amp; ttl &gt; 0 {
		c.mu.Lock()
		c.store[key] = e
		c.mu.Unlock()
	}
	return e, nil
}

// sharedTTL is a tiny subset of RFC 9111: s-maxage wins over max-age
// for a shared cache; private and no-store mean "don't store".
func sharedTTL(cc string) time.Duration {
	var maxAge, sMaxAge time.Duration = -1, -1
	for _, d := range strings.Split(cc, ",") {
		d = strings.TrimSpace(strings.ToLower(d))
		name, val, _ := strings.Cut(d, "=")
		n, _ := strconv.Atoi(val)
		switch name {
		case "private", "no-store", "no-cache":
			return 0
		case "max-age":
			maxAge = time.Duration(n) * time.Second
		case "s-maxage":
			sMaxAge = time.Duration(n) * time.Second
		}
	}
	if sMaxAge &gt;= 0 {
		return sMaxAge
	}
	return max(maxAge, 0)
}</code></pre>

<p>The test puts three edges in front of an <code>httptest</code> origin, sends 990 requests round-robin (one in 33 is the personalized <code>/me</code>), and runs once without and once with a shield:</p>
<pre><code>package cdn

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func newOrigin(asset, me *atomic.Int64) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/me" {
			me.Add(1)
			w.Header().Set("Cache-Control", "private, no-store")
		} else {
			asset.Add(1)
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		fmt.Fprint(w, "body of "+r.URL.Path)
	}))
}

// 3 edge PoPs, 300 requests each for the same JS file, plus 30 for /me.
func run(t *testing.T, withShield bool) {
	var assetHits, meHits atomic.Int64
	origin := newOrigin(&amp;assetHits, &amp;meHits)
	defer origin.Close()

	next := origin.URL
	if withShield {
		shield := httptest.NewServer(NewCache("shield", origin.URL))
		defer shield.Close()
		next = shield.URL
	}
	var edges []*Cache
	for _, name := range []string{"edge-a", "edge-b", "edge-c"} {
		edges = append(edges, NewCache(name, next))
	}
	for i := range 990 {
		path := "/assets/app.3f9a1c.js"
		if i%33 == 0 {
			path = "/me"
		}
		rec := httptest.NewRecorder()
		edges[i%3].ServeHTTP(rec, httptest.NewRequest("GET", path, nil))
		if i &lt; 6 {
			t.Logf("req %d %-22s X-Cache: %s", i, path, rec.Header().Get("X-Cache"))
		}
		io.Copy(io.Discard, rec.Body)
	}
	var hits, total int64
	for _, e := range edges {
		hits += e.Hits.Load()
		total += e.Hits.Load() + e.Misses.Load()
	}
	t.Logf("shield=%v edge hit ratio=%.1f%% origin fetches: app.js=%d /me=%d",
		withShield, 100*float64(hits)/float64(total), assetHits.Load(), meHits.Load())
}

func TestNoShield(t *testing.T)   { run(t, false) }
func TestWithShield(t *testing.T) { run(t, true) }</code></pre>
<p>Real output of <code>go test -v</code>:</p>
<pre><code>req 0 /me                    X-Cache: MISS from edge-a
req 1 /assets/app.3f9a1c.js  X-Cache: MISS from edge-b
req 2 /assets/app.3f9a1c.js  X-Cache: MISS from edge-c
req 3 /assets/app.3f9a1c.js  X-Cache: MISS from edge-a
req 4 /assets/app.3f9a1c.js  X-Cache: HIT from edge-b
req 5 /assets/app.3f9a1c.js  X-Cache: HIT from edge-c
shield=false edge hit ratio=96.7% origin fetches: app.js=3 /me=30
--- PASS: TestNoShield (0.01s)
req 0 /me                    X-Cache: MISS from edge-a
req 1 /assets/app.3f9a1c.js  X-Cache: MISS from edge-b
req 2 /assets/app.3f9a1c.js  X-Cache: MISS from edge-c
req 3 /assets/app.3f9a1c.js  X-Cache: MISS from edge-a
req 4 /assets/app.3f9a1c.js  X-Cache: HIT from edge-b
req 5 /assets/app.3f9a1c.js  X-Cache: HIT from edge-c
shield=true edge hit ratio=96.7% origin fetches: app.js=1 /me=30
--- PASS: TestWithShield (0.01s)</code></pre>
<p>Each edge misses once on <code>app.js</code>, then hits forever. Without a shield the origin fetches it 3 times (once per PoP); with a shield, once. With 3 PoPs that's a small saving, with 300 PoPs and a purge at peak it's the difference between 300 origin requests per object and 1. <code>/me</code> is <code>private, no-store</code>, so all 30 requests correctly go to the origin.</p>

<p><strong>Checking a real CDN.</strong> Each CDN has its own debug header. CloudFront sends <code>X-Cache: Hit from cloudfront</code> (or <code>Miss</code>, <code>RefreshHit</code>); Cloudflare sends <code>cf-cache-status</code> with values such as <code>HIT</code>, <code>MISS</code>, <code>EXPIRED</code>, <code>BYPASS</code> and <code>DYNAMIC</code> (not eligible for caching at all). The standard <code>Age</code> header says how many seconds the copy has been cached:</p>
<pre><code>curl -sI https://cdn.example.com/assets/app.3f9a1c.js | grep -iE 'x-cache|cf-cache-status|^age'</code></pre>

<p><strong>Purging</strong> a file that must change <em>now</em> (better: fingerprint it, see <a href="#cache-invalidation">Cache Invalidation</a>). On CloudFront the first 1,000 invalidation paths per month are free; <code>/*</code> counts as one path but empties the whole distribution:</p>
<pre><code>aws cloudfront create-invalidation &#92;
    --distribution-id E1ABCDEF234567 &#92;
    --paths "/index.html" "/robots.txt"</code></pre>

<p><strong>Real-world scenario.</strong> A campaign sends 50× normal traffic to your landing page at 10:00. Without a CDN, every request hits two app servers and they fall over by 10:02. With HTML cached at the edge for 60 seconds, assets cached for a year and a shield in front of the origin, the origin sees roughly one request per page per minute, from the shield. Users everywhere get the page from a nearby PoP, and the app servers' CPU graph barely moves.</p>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>Caching private data is the worst CDN bug.</strong> A response that depends on the user (cookies, <code>Authorization</code>) marked cacheable can be served to every other user. Default authenticated routes to <code>private, no-store</code>; see the Steam incident in <a href="#edge-caching">Edge Caching</a>.</li>
  <li><strong>Origin still reachable directly.</strong> If the origin accepts traffic from anywhere, attackers and bots skip the CDN, its cache and its DDoS protection. Allow only the CDN's IP ranges or require a secret header or mTLS from the CDN.</li>
  <li><strong>Stale content after deploys.</strong> Long TTLs on un-fingerprinted files (<code>/app.js</code>) mean users keep the old version. Fingerprint filenames instead of purging after every deploy.</li>
  <li><strong>Cache key mistakes.</strong> Tracking params like <code>?utm_source=…</code> in the key split one object into thousands and kill the hit ratio. Strip them in the CDN's cache-key settings.</li>
  <li><strong>Purge everything = thundering herd.</strong> <code>/*</code> at peak sends every PoP back to the origin at once. Purge narrowly, and put a shield in front.</li>
  <li><strong>Low hit ratio, high bill.</strong> A CDN in front of mostly uncacheable traffic is an extra hop you pay for per request. Measure request and byte hit ratios before and after.</li>
  <li><strong>Another layer to debug.</strong> "Why am I seeing the old version?" now has browser, CDN, shield and app caches as suspects. Learn your CDN's debug headers early.</li>
</ul>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>A CDN serves content from PoPs near users: lower latency for them, less load and egress for your origin.</li>
  <li>Users reach the nearest edge through GeoDNS or anycast; TLS terminates there, which helps even uncacheable requests.</li>
  <li>Origin pull is the default; an origin shield turns N PoP misses into one origin fetch.</li>
  <li>Watch the request and byte hit ratios, and lock the origin so only the CDN can reach it.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#caching">Caching</a> · <a href="#edge-caching">Edge Caching</a> · <a href="#cache-invalidation">Cache Invalidation</a> · <a href="#dns">DNS</a> · <a href="#ddos-protection">DDoS Protection</a> · <a href="#real-world-caching-stack">Real-World Caching Stack</a></p>
`;
CONTENT["edge-caching"] = `
<p class="tldr"><strong>TL;DR</strong>: Edge caching is the set of rules a CDN edge, or any shared HTTP cache, follows to decide whether it may store a response, which requests it can reuse it for, and for how long. Your origin sets those rules with headers: <code>Cache-Control</code>, <code>Vary</code>, <code>ETag</code>. Think of the headers as the label on a food container: who may eat it, and the "best before" date.</p>

<h2>The problem it solves</h2>
<p>A <a href="#cdn">CDN</a> sits between millions of users and your origin, but it doesn't know your application. It can't tell that <code>/products/42</code> is the same for everyone while <code>/account</code> is different per user, or that a price may be 30 seconds old but never 30 minutes. Without clear instructions it either caches too little (every request goes to the origin and the CDN is an expensive proxy) or too much (stale prices, or worse, one user's page served to another).</p>
<p>HTTP caching, defined in <strong>RFC 9111</strong>, is that instruction language. One set of headers controls browsers, CDNs and reverse proxies at once, so learning it once pays off in every layer.</p>

<h2>How it works</h2>
<p>For each request, a shared cache runs roughly this decision:</p>

<figure class="diagram">
<svg viewBox="0 0 780 376" role="img" aria-label="Shared cache decision flow: build the cache key from method, host, path, query and the headers named in Vary. If nothing is stored, fetch from the origin and store it if allowed. If a stored copy is fresh, serve it as a hit. If it's stale but inside the stale-while-revalidate window, serve it and refresh in the background. Otherwise send a conditional request: 304 means reuse the copy, 200 means replace it, and an origin error inside stale-if-error means serve the stale copy.">
  <defs><marker id="arr-ec-1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <rect class="box" x="10" y="20" width="120" height="44" rx="8"/><text x="70" y="40" text-anchor="middle" class="title">GET request</text><text x="70" y="56" text-anchor="middle" class="small">arrives at edge</text>
  <rect class="box" x="160" y="20" width="260" height="44" rx="8"/><text x="290" y="40" text-anchor="middle">cache key = host + path + query</text><text x="290" y="56" text-anchor="middle" class="small">+ request headers named in Vary</text>
  <rect class="box accent" x="450" y="20" width="140" height="44" rx="22"/><text x="520" y="47" text-anchor="middle">stored copy?</text>
  <rect class="box" x="630" y="20" width="140" height="44" rx="8"/><text x="700" y="40" text-anchor="middle" class="small">fetch from origin,</text><text x="700" y="56" text-anchor="middle" class="small">store if allowed</text>
  <path class="line" d="M130 42 H158" marker-end="url(#arr-ec-1)"/>
  <path class="line" d="M420 42 H448" marker-end="url(#arr-ec-1)"/>
  <path class="line" d="M590 42 H628" marker-end="url(#arr-ec-1)"/><text x="609" y="34" text-anchor="middle" class="small">no</text>

  <rect class="box accent" x="450" y="110" width="140" height="44" rx="22"/><text x="520" y="130" text-anchor="middle">fresh?</text><text x="520" y="146" text-anchor="middle" class="small">Age &lt; s-maxage</text>
  <path class="line" d="M520 64 V108" marker-end="url(#arr-ec-1)"/><text x="530" y="91" class="small">yes</text>
  <rect class="box ok" x="230" y="110" width="170" height="44" rx="8"/><text x="315" y="130" text-anchor="middle" class="title">HIT</text><text x="315" y="146" text-anchor="middle" class="small">serve stored copy</text>
  <path class="line ok" d="M450 132 H402" marker-end="url(#arr-ec-1)"/><text x="426" y="124" text-anchor="middle" class="small">yes</text>

  <rect class="box accent" x="450" y="200" width="140" height="44" rx="22"/><text x="520" y="220" text-anchor="middle">in SWR window?</text><text x="520" y="236" text-anchor="middle" class="small">stale-while-revalidate</text>
  <path class="line" d="M520 154 V198" marker-end="url(#arr-ec-1)"/><text x="530" y="181" class="small">no</text>
  <rect class="box ok" x="180" y="200" width="220" height="44" rx="8"/><text x="290" y="220" text-anchor="middle">serve stale copy now,</text><text x="290" y="236" text-anchor="middle" class="small">refresh from origin in background</text>
  <path class="line ok" d="M450 222 H402" marker-end="url(#arr-ec-1)"/><text x="426" y="214" text-anchor="middle" class="small">yes</text>

  <rect class="box" x="430" y="290" width="180" height="44" rx="8"/><text x="520" y="310" text-anchor="middle">revalidate with origin</text><text x="520" y="326" text-anchor="middle" class="small">If-None-Match: "etag"</text>
  <path class="line" d="M520 244 V288" marker-end="url(#arr-ec-1)"/><text x="530" y="271" class="small">no</text>
  <rect class="box ok" x="640" y="250" width="130" height="34" rx="6"/><text x="705" y="271" text-anchor="middle" class="small">304: reuse, reset age</text>
  <rect class="box" x="640" y="295" width="130" height="34" rx="6"/><text x="705" y="316" text-anchor="middle" class="small">200: replace copy</text>
  <rect class="box bad" x="640" y="340" width="130" height="34" rx="6"/><text x="705" y="361" text-anchor="middle" class="small">5xx: stale-if-error</text>
  <path class="line" d="M610 304 L638 270" marker-end="url(#arr-ec-1)"/>
  <path class="line" d="M610 312 H638" marker-end="url(#arr-ec-1)"/>
  <path class="line" d="M610 320 L638 354" marker-end="url(#arr-ec-1)"/>
  <text x="20" y="300" class="small">"fresh" uses s-maxage, else max-age,</text>
  <text x="20" y="316" class="small">else Expires, else a heuristic guess.</text>
  <text x="20" y="340" class="small">private / no-store responses</text>
  <text x="20" y="356" class="small">never enter a shared cache.</text>
</svg>
<figcaption>Every box is driven by a header your origin sent. The cache key and <code>Vary</code> decide <em>which</em> stored copy matches; <code>Cache-Control</code> decides <em>whether</em> it may be used; <code>ETag</code> makes refreshing cheap.</figcaption>
</figure>

<h3>The directives that matter</h3>
<table>
  <tr><th>Directive (response)</th><th>Applies to</th><th>Meaning (RFC 9111 / 5861 / 8246)</th><th>Typical use</th></tr>
  <tr><td><code>public</code></td><td>all caches</td><td>Any cache may store it, even for a request with <code>Authorization</code></td><td>Public pages and assets</td></tr>
  <tr><td><code>private</code></td><td>shared caches</td><td>Only the user's own browser may store it; CDNs and proxies must not</td><td>Per-user pages that are fine to keep in the browser</td></tr>
  <tr><td><code>max-age=N</code></td><td>all caches</td><td>Fresh for N seconds after it was generated</td><td>Browser lifetime</td></tr>
  <tr><td><code>s-maxage=N</code></td><td>shared caches only</td><td>Overrides <code>max-age</code> and <code>Expires</code> for CDNs and proxies, and implies <code>proxy-revalidate</code> (no serving stale without permission)</td><td>Edge lifetime, different from the browser's</td></tr>
  <tr><td><code>no-cache</code></td><td>all caches</td><td>May be stored, but must be revalidated with the origin before <em>every</em> reuse</td><td>HTML that must always be current, cheap thanks to 304s</td></tr>
  <tr><td><code>no-store</code></td><td>all caches</td><td>Don't store it at all</td><td>Sensitive or per-user data</td></tr>
  <tr><td><code>immutable</code></td><td>browsers mostly</td><td>The body will never change while fresh; don't revalidate even on reload (RFC 8246)</td><td>Fingerprinted assets with a year-long <code>max-age</code></td></tr>
  <tr><td><code>stale-while-revalidate=N</code></td><td>all caches</td><td>After it goes stale, may be served for N more seconds while the cache revalidates in the background (RFC 5861)</td><td>Hide origin latency on popular objects</td></tr>
  <tr><td><code>stale-if-error=N</code></td><td>all caches</td><td>If revalidation hits a 500, 502, 503 or 504, may serve the stale copy for up to N seconds (RFC 5861)</td><td>Keep pages up while the origin is down</td></tr>
</table>
<p>Two rules that surprise people:</p>
<ul>
  <li><strong><code>no-cache</code> doesn't mean "don't cache".</strong> It means "check with me first". <code>no-store</code> is "don't cache". (Some CDNs are stricter than the RFC: Cloudflare, for example, doesn't cache <code>no-cache</code> responses at all.)</li>
  <li><strong>No headers is not "no caching".</strong> If a response has no <code>Cache-Control</code> or <code>Expires</code> but does have <code>Last-Modified</code>, caches may <em>guess</em> a freshness lifetime. RFC 9111 suggests a typical value of 10% of the time since the last modification. A file last changed 10 days ago could be cached for a day. Always send explicit headers.</li>
</ul>
<p>When one header must say different things to the browser and the CDN, use <code>max-age</code> + <code>s-maxage</code>, or the CDN-only header <code>CDN-Cache-Control</code> (RFC 9213), which a CDN that supports it uses instead of <code>Cache-Control</code>. Fastly's older <code>Surrogate-Control</code> serves the same purpose.</p>

<h3>The cache key and <code>Vary</code></h3>
<p>By default a CDN's key is roughly host + path + query string. <code>Vary</code> adds request headers to it: <code>Vary: Accept-Encoding</code> stores the gzip, brotli and plain copies separately, so a client that can't decode brotli never gets it. Every header in <code>Vary</code> multiplies the number of copies:</p>
<ul>
  <li><code>Vary: Accept-Language</code> sounds right, but browsers send hundreds of distinct values (<code>en-US,en;q=0.9</code>, <code>en-GB,en;q=0.8,fr;q=0.5</code>, …), so the hit ratio collapses. Normalize at the edge to a few supported languages first, or put the language in the URL.</li>
  <li><code>Vary: Cookie</code> or <code>Vary: User-Agent</code> usually means one copy per user or per browser build: effectively uncacheable.</li>
  <li><code>Vary: *</code> never matches anything, so the response can't be reused without revalidation.</li>
</ul>

<h3>Conditional requests and <code>Age</code></h3>
<p>When a copy goes stale, the cache doesn't have to download it again. It asks the origin "has it changed?" with the validators the origin sent before:</p>
<ul>
  <li><code>ETag: "5a49888fe81a7cc8"</code> → the cache sends <code>If-None-Match: "5a49888fe81a7cc8"</code>.</li>
  <li><code>Last-Modified: Thu, 12 Nov 2026 09:30:00 GMT</code> → the cache sends <code>If-Modified-Since</code> with that date. If both are present, <code>If-None-Match</code> wins.</li>
</ul>
<p>If nothing changed, the origin answers <code>304 Not Modified</code> with no body: a few hundred bytes instead of the whole object, and the copy is fresh again. A weak ETag (<code>W/"…"</code>) means "semantically the same", for example the same data with different whitespace. Every response a cache serves carries <code>Age</code>: the cache's estimate of how many seconds ago the origin generated or last validated it. <code>Age: 240</code> with <code>s-maxage=300</code> means 60 seconds of freshness left.</p>

<figure class="diagram">
<svg viewBox="0 0 780 236" role="img" aria-label="Lifetime of the product response. At the edge: fresh from 0 to 300 seconds, served stale while revalidating from 300 to 360, then must revalidate with the origin. A marker at 240 seconds shows Age 240. In the browser: fresh from 0 to 60 seconds, then each use revalidates with the edge, usually getting a 304.">
  <text x="390" y="20" text-anchor="middle" class="title">public, max-age=60, s-maxage=300, stale-while-revalidate=60</text>
  <text x="160" y="69" text-anchor="end">CDN edge</text>
  <rect class="box ok" x="170" y="50" width="420" height="30" rx="4"/><text x="380" y="70" text-anchor="middle" class="small">fresh: HIT, no origin traffic</text>
  <rect class="box accent" x="590" y="50" width="84" height="30" rx="4"/><text x="632" y="70" text-anchor="middle" class="small">serve stale</text>
  <rect class="box muted" x="674" y="50" width="96" height="30" rx="4"/><text x="722" y="70" text-anchor="middle" class="small">revalidate</text>
  <path class="line accent dashed" d="M506 44 V86"/>
  <text x="506" y="100" text-anchor="middle" class="small">Age: 240</text>

  <text x="160" y="139" text-anchor="end">Browser</text>
  <rect class="box ok" x="170" y="120" width="84" height="30" rx="4"/><text x="212" y="140" text-anchor="middle" class="small">fresh</text>
  <rect class="box muted" x="254" y="120" width="516" height="30" rx="4"/><text x="512" y="140" text-anchor="middle" class="small">each use: If-None-Match to the edge → usually a cheap 304</text>

  <path class="line" d="M170 172 H770"/>
  <path class="line" d="M170 166 V178 M254 166 V178 M590 166 V178 M674 166 V178"/>
  <text x="170" y="194" text-anchor="middle" class="small">0 s</text>
  <text x="254" y="194" text-anchor="middle" class="small">60 s</text>
  <text x="590" y="194" text-anchor="middle" class="small">300 s</text>
  <text x="674" y="194" text-anchor="middle" class="small">360 s</text>
  <text x="390" y="224" text-anchor="middle" class="small">With stale-if-error=86400 the edge may keep serving the old copy for a day if the origin returns 5xx.</text>
</svg>
<figcaption>One response, two lifetimes. The edge absorbs traffic for five minutes; browsers stay within a minute of the edge. A popular object is requested inside the stale window, gets refreshed in the background, and almost never makes a user wait for the origin.</figcaption>
</figure>

<h3>Caching dynamic and API responses</h3>
<p>"Dynamic" doesn't mean "uncacheable". The question is: <strong>is the response identical for everyone who sends this URL, and how stale may it be?</strong></p>
<ul>
  <li><strong>Public reads</strong> (<code>GET /products?category=keyboards</code>, a leaderboard, a news feed): <code>s-maxage</code> of a few seconds to a minute. Even <code>s-maxage=1</code> turns 5,000 requests per second for one URL into about one origin request per second per PoP (or per shield).</li>
  <li><strong>Normalize the key</strong>: sort query parameters, drop <code>utm_*</code> and other tracking parameters, lowercase where it's safe, so equivalent URLs share one copy.</li>
  <li><strong>Mixed pages</strong>: cache the public shell, and load the personalized parts (name, cart count) from a separate <code>private, no-store</code> API call in the browser.</li>
  <li><strong>Authorization</strong>: by RFC 9111 a shared cache must not reuse a response to a request with <code>Authorization</code> unless the response says <code>public</code>, <code>s-maxage</code> or <code>must-revalidate</code>. So adding <code>s-maxage</code> to an authenticated endpoint switches that protection off.</li>
</ul>

<div class="callout warn"><strong>The personalization leak.</strong> On Christmas Day 2015, during a DoS attack that raised Steam's store traffic by 2,000%, Valve changed its caching configuration with a CDN partner. The new config cached pages that belonged to logged-in users, and for a while visitors were served other people's account pages. Valve said about 34,000 users had personal information exposed. The fix is boring: personalized routes send <code>private, no-store</code> from the origin, and the CDN is configured to respect origin headers rather than override them.</div>

<h3>Edge compute (briefly)</h3>
<p>Most CDNs can run small functions at the edge: Cloudflare Workers, CloudFront Functions and Lambda@Edge, Fastly Compute. Typical caching uses are rewriting the cache key (normalizing query strings or languages), bucketing users for A/B tests into a small number of cacheable variants, verifying a signed token before serving cached content, and redirects. Keep them small: they run on every request and are harder to test than your origin.</p>

<h2>Example</h2>
<p><strong>A Go origin that speaks HTTP caching.</strong> The product endpoint is public and sets browser and edge lifetimes, stale rules, an <code>ETag</code> and <code>Vary</code>. <code>http.ServeContent</code> from the standard library does the conditional-request logic: it compares <code>If-None-Match</code> with the <code>ETag</code> header you set, falls back to <code>If-Modified-Since</code>, and sends the 304. The <code>/me</code> endpoint is per-user, so it's <code>private, no-store</code>.</p>
<pre><code>package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"time"
)

type Product struct {
	ID        string    &#96;json:"id"&#96;
	Name      string    &#96;json:"name"&#96;
	PriceCent int       &#96;json:"price_cents"&#96;
	UpdatedAt time.Time &#96;json:"updated_at"&#96;
}

var updated = time.Date(2026, 11, 12, 9, 30, 0, 0, time.UTC)

// Public, identical for every user: browsers keep it 60 s, the CDN 5 min,
// then the CDN may serve it stale for 60 s while it refetches, or for a day
// if the origin is returning 5xx.
func productHandler(w http.ResponseWriter, r *http.Request) {
	p := Product{ID: "p-42", Name: "Mechanical keyboard", PriceCent: 8900, UpdatedAt: updated}
	body, _ := json.Marshal(p)
	sum := sha256.Sum256(body)

	h := w.Header()
	h.Set("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=60, stale-if-error=86400")
	h.Set("ETag", &#96;"&#96;+hex.EncodeToString(sum[:8])+&#96;"&#96;)
	h.Set("Vary", "Accept-Encoding")
	h.Set("Content-Type", "application/json")
	// ServeContent answers If-None-Match / If-Modified-Since with a 304
	// and sets Last-Modified from p.UpdatedAt.
	http.ServeContent(w, r, "", p.UpdatedAt, bytes.NewReader(body))
}

// Depends on who is asking: no shared cache may store it.
func meHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(&#96;{"user":"from session cookie"}&#96;))
}

func routes() *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /products/p-42", productHandler)
	mux.HandleFunc("GET /me", meHandler)
	return mux
}

func main() {
	http.ListenAndServe(":8080", routes())
}</code></pre>

<p>A test that plays the part of a cache revalidating, with <code>httptest</code>:</p>
<pre><code>package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func show(t *testing.T, url string, hdr map[string]string) string {
	req, _ := http.NewRequest("GET", url, nil)
	for k, v := range hdr {
		req.Header.Set(k, v)
		t.Logf("&gt; %s: %s", k, v)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	t.Logf("&lt; %s", resp.Status)
	for _, k := range []string{"Cache-Control", "Etag", "Last-Modified", "Vary", "Content-Length"} {
		if v := resp.Header.Get(k); v != "" {
			t.Logf("&lt; %s: %s", k, v)
		}
	}
	t.Logf("&lt; body: %d bytes %s", len(body), body)
	return resp.Header.Get("ETag")
}

func TestConditional(t *testing.T) {
	srv := httptest.NewServer(routes())
	defer srv.Close()
	url := srv.URL + "/products/p-42"

	t.Log("--- 1. first request")
	etag := show(t, url, nil)
	t.Log("--- 2. revalidate with the ETag")
	show(t, url, map[string]string{"If-None-Match": etag})
	t.Log("--- 3. client holds an outdated ETag")
	show(t, url, map[string]string{"If-None-Match": &#96;"0000000000000000"&#96;})
	t.Log("--- 4. personalised route")
	show(t, srv.URL+"/me", nil)
}</code></pre>
<p>Real output of <code>go test -v</code> (<code>&gt;</code> = request header sent, <code>&lt;</code> = response):</p>
<pre><code>--- 1. first request
&lt; 200 OK
&lt; Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=60, stale-if-error=86400
&lt; Etag: "5a49888fe81a7cc8"
&lt; Last-Modified: Thu, 12 Nov 2026 09:30:00 GMT
&lt; Vary: Accept-Encoding
&lt; Content-Length: 97
&lt; body: 97 bytes {"id":"p-42","name":"Mechanical keyboard","price_cents":8900,"updated_at":"2026-11-12T09:30:00Z"}
--- 2. revalidate with the ETag
&gt; If-None-Match: "5a49888fe81a7cc8"
&lt; 304 Not Modified
&lt; Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=60, stale-if-error=86400
&lt; Etag: "5a49888fe81a7cc8"
&lt; Vary: Accept-Encoding
&lt; body: 0 bytes 
--- 3. client holds an outdated ETag
&gt; If-None-Match: "0000000000000000"
&lt; 200 OK
&lt; Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=60, stale-if-error=86400
&lt; Etag: "5a49888fe81a7cc8"
&lt; Last-Modified: Thu, 12 Nov 2026 09:30:00 GMT
&lt; Vary: Accept-Encoding
&lt; Content-Length: 97
&lt; body: 97 bytes {"id":"p-42","name":"Mechanical keyboard","price_cents":8900,"updated_at":"2026-11-12T09:30:00Z"}
--- 4. personalised route
&lt; 200 OK
&lt; Cache-Control: private, no-store
&lt; Content-Length: 30
&lt; body: 30 bytes {"user":"from session cookie"}</code></pre>
<p>Request 2 is what the edge sends after 300 seconds: the 304 has no body, and the copy is fresh for another 300 seconds. Request 3 shows the client with an outdated ETag getting the full 200 with the new one. Go writes the header as <code>Etag</code>; header names are case-insensitive.</p>

<p><strong>Real-world scenario.</strong> A shop's product API gets 3,000 requests per second for its top 500 products, served from 40 PoPs behind a shield. With <code>s-maxage=300, stale-while-revalidate=60</code>, the shield refreshes each product about once every 5 minutes: 500 products / 300 s ≈ 2 origin requests per second, and most of those are 304s. At 14:05 the origin's database stalls and returns 503s for four minutes. Because of <code>stale-if-error=86400</code>, users keep seeing product pages (prices up to a few minutes old), while checkout, which is never cached, shows the outage honestly.</p>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>Marking per-user responses cacheable.</strong> <code>public</code> or <code>s-maxage</code> on anything that reads a cookie or token can leak data between users. Make <code>private, no-store</code> the default for authenticated routes and opt in to caching per route.</li>
  <li><strong>Cookies on public responses.</strong> A <code>Set-Cookie</code> on a product page either stops caching (Cloudflare doesn't cache responses with <code>Set-Cookie</code> by default) or, with an override rule, hands one user's session cookie to everyone. Don't set cookies on cacheable responses.</li>
  <li><strong>Confusing <code>no-cache</code> and <code>no-store</code>.</strong> Use <code>no-store</code> for secrets, <code>no-cache</code> for "always fresh, but 304s are fine".</li>
  <li><strong>Missing headers.</strong> Caches will guess with heuristic freshness. Send <code>Cache-Control</code> on every response, even if it's <code>no-store</code>.</li>
  <li><strong>Exploding <code>Vary</code>.</strong> <code>Vary: User-Agent</code>, <code>Cookie</code> or raw <code>Accept-Language</code> gives each user their own copy. Normalize at the edge, then vary on the normalized value.</li>
  <li><strong>ETags that differ per server.</strong> If each instance computes ETags from something local (inode, mtime on its own disk), revalidation always returns 200. Derive the ETag from the content or from a version number.</li>
  <li><strong>Caching errors.</strong> A 404 or 500 cached for an hour outlives the bug. Give error responses short TTLs or none.</li>
  <li><strong>Long TTLs on mutable URLs.</strong> <code>max-age=31536000</code> on <code>/app.js</code> can't be undone in browsers; only purge reaches the CDN. Long TTLs belong on fingerprinted URLs (see <a href="#cache-invalidation">Cache Invalidation</a>).</li>
</ul>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li><code>Cache-Control</code> from the origin drives every cache: <code>max-age</code> for browsers, <code>s-maxage</code> for the edge, <code>private</code>/<code>no-store</code> for anything per-user.</li>
  <li>The cache key (URL + <code>Vary</code>) decides which copy matches; keep it small and normalized.</li>
  <li><code>ETag</code> + 304 makes revalidation cheap; <code>stale-while-revalidate</code> and <code>stale-if-error</code> hide origin latency and outages.</li>
  <li>Cache dynamic public data for seconds; never cache personalized responses in a shared cache.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#cdn">CDN</a> · <a href="#caching">Caching</a> · <a href="#cache-invalidation">Cache Invalidation</a> · <a href="#reverse-proxies">Reverse Proxies</a> · <a href="#real-world-caching-stack">Real-World Caching Stack</a></p>
`;
CONTENT["cache-invalidation"] = `
<p class="tldr"><strong>TL;DR</strong>: Cache invalidation is making sure cached copies stop being served once the real data changes. Caching is easy; knowing <em>when</em> a copy is wrong, and removing it everywhere without races, is the hard part. The usual tools are expiry by time (TTL), deleting on write, putting a version in the key, broadcasting change events, and purging the CDN. It's taking down every copy of an old poster, including the ones someone is putting back up as you walk past.</p>

<h2>The problem it solves</h2>
<p>The line usually attributed to Phil Karlton says there are only two hard things in computer science: cache invalidation and naming things. It is hard for concrete reasons:</p>
<ul>
  <li><strong>Copies are everywhere.</strong> One product price can be cached in each pod's memory, in Redis, in a reverse proxy, at many CDN edges and in thousands of browsers (see <a href="#caching">Caching</a>). An update has to reach all of them, or wait for them to expire.</li>
  <li><strong>The cache doesn't see writes.</strong> In cache-aside, the database changes and nobody tells the cache unless your code does, on every write path, including scripts, migrations and admin tools.</li>
  <li><strong>Concurrency.</strong> A reader that loaded an old value a millisecond before an update can write it into the cache a millisecond after the invalidation. The cache is now wrong with no write left to fix it.</li>
</ul>
<p>The cost of getting it wrong depends on the data: a stale avatar is harmless; a stale price, stock level or permission is a bug, a support ticket or a security issue.</p>

<h2>How it works</h2>
<figure class="diagram">
<svg viewBox="0 0 780 340" role="img" aria-label="Mind map of cache invalidation strategies: time (TTL expiry, jitter), write path (delete on write, write-through), key design (versioned keys, fingerprinted assets, generations), events (change data capture, pub/sub broadcast), CDN (purge by URL, purge by tag, soft purge), and race fixes (delayed double delete, leases).">
  <ellipse class="box accent" cx="390" cy="170" rx="95" ry="32"/><text x="390" y="175" text-anchor="middle" class="title">Cache invalidation</text>
  <path class="line" d="M330 148 L210 72"/><path class="line" d="M450 148 L570 72"/>
  <path class="line" d="M295 170 H190"/><path class="line" d="M485 170 H590"/>
  <path class="line" d="M330 194 L260 256"/><path class="line" d="M450 194 L520 256"/>

  <rect class="box" x="40" y="20" width="170" height="64" rx="8"/><text x="125" y="42" text-anchor="middle" class="title">Time</text>
  <text x="125" y="60" text-anchor="middle" class="small">TTL expiry: bounded staleness</text><text x="125" y="74" text-anchor="middle" class="small">jitter against mass expiry</text>
  <rect class="box" x="570" y="20" width="170" height="64" rx="8"/><text x="655" y="42" text-anchor="middle" class="title">Write path</text>
  <text x="655" y="60" text-anchor="middle" class="small">update DB, then delete key</text><text x="655" y="74" text-anchor="middle" class="small">or write-through update</text>
  <rect class="box" x="20" y="138" width="170" height="64" rx="8"/><text x="105" y="160" text-anchor="middle" class="title">Key design</text>
  <text x="105" y="178" text-anchor="middle" class="small">versioned / generation keys</text><text x="105" y="192" text-anchor="middle" class="small">fingerprinted asset names</text>
  <rect class="box" x="590" y="138" width="170" height="64" rx="8"/><text x="675" y="160" text-anchor="middle" class="title">Events</text>
  <text x="675" y="178" text-anchor="middle" class="small">CDC from WAL / binlog</text><text x="675" y="192" text-anchor="middle" class="small">pub/sub to every node</text>
  <rect class="box" x="90" y="256" width="170" height="64" rx="8"/><text x="175" y="278" text-anchor="middle" class="title">CDN</text>
  <text x="175" y="296" text-anchor="middle" class="small">purge by URL or by tag</text><text x="175" y="310" text-anchor="middle" class="small">soft purge: mark stale</text>
  <rect class="box bad" x="520" y="256" width="170" height="64" rx="8"/><text x="605" y="278" text-anchor="middle" class="title">Race fixes</text>
  <text x="605" y="296" text-anchor="middle" class="small">delayed double delete</text><text x="605" y="310" text-anchor="middle" class="small">leases (tokens on miss)</text>
</svg>
<figcaption>Real systems combine several: a TTL on everything as a safety net, delete-on-write for correctness, versioned names for static files, events to reach caches you can't call directly, and a purge for the CDN.</figcaption>
</figure>

<h3>The strategies</h3>
<ol>
  <li><strong>TTL expiry.</strong> Every entry dies after a fixed time. No coordination, and staleness is bounded by the TTL. Alone it means "wrong for up to N minutes". Always set one anyway: it is the safety net when every other mechanism fails.</li>
  <li><strong>Delete on write.</strong> After the database commit, delete the key; the next read reloads it. This is what cache-aside does.</li>
  <li><strong>Write-through update.</strong> After the commit, write the new value into the cache. The next read is a hit, but two concurrent writers can leave the older value in the cache (shown below).</li>
  <li><strong>Versioned keys.</strong> Put a version in the key, and a change makes a new key instead of fixing the old one. Three forms: a schema version (<code>product:v2:42</code>), a row version (<code>product:42:rev17</code>), or a <em>generation</em> counter per group (<code>category:lamps:g8:page:1</code>; one <code>INCR</code> abandons every page of the category). Old entries are never read again and age out by TTL or eviction.</li>
  <li><strong>Fingerprinted assets.</strong> The same idea for files: <code>app.3f9a1c.js</code> contains a hash of its content, so it can be cached for a year with <code>immutable</code>. A deploy produces a new name; only the HTML that references it must stay fresh (see <a href="#edge-caching">Edge Caching</a>).</li>
  <li><strong>Event-driven invalidation.</strong> Changes are published as events and a consumer deletes the affected keys everywhere: every region, every pod's local cache, the CDN. The most reliable source is the database's own change log (CDC), because it also sees writes that bypass your code.</li>
  <li><strong>CDN purge.</strong> Ask the CDN to drop content by URL, by prefix, or by <strong>tag</strong>: the origin labels responses (<code>Surrogate-Key</code> on Fastly, <code>Cache-Tag</code> on Cloudflare) and one call purges every URL with that tag, such as all pages showing product 42. A <strong>soft purge</strong> marks objects stale instead of removing them, so the edge can still serve the old copy while it fetches the new one, or if the origin is down.</li>
</ol>

<h3>The race that breaks naive invalidation</h3>
<p>Delete-on-write is not airtight. The classic failure needs only one slow reader:</p>

<figure class="diagram">
<svg viewBox="0 0 780 350" role="img" aria-label="Sequence diagram. A reader misses the cache and reads price 1000 from the database, then pauses. A writer updates the price to 1500 and deletes the cache key. The reader resumes and sets the cache to the old price 1000. The cache now disagrees with the database until the TTL expires or a second delete runs.">
  <defs><marker id="arr-ci-1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <rect class="box" x="50" y="10" width="120" height="34" rx="6"/><text x="110" y="32" text-anchor="middle" class="title">Reader</text>
  <rect class="box ok" x="240" y="10" width="120" height="34" rx="6"/><text x="300" y="32" text-anchor="middle" class="title">Cache</text>
  <rect class="box muted" x="430" y="10" width="120" height="34" rx="6"/><text x="490" y="32" text-anchor="middle" class="title">Database</text>
  <rect class="box" x="620" y="10" width="120" height="34" rx="6"/><text x="680" y="32" text-anchor="middle" class="title">Writer</text>
  <path class="line dashed" d="M110 44 V340"/><path class="line dashed" d="M300 44 V340"/><path class="line dashed" d="M490 44 V340"/><path class="line dashed" d="M680 44 V340"/>

  <path class="line" d="M110 72 H298" marker-end="url(#arr-ci-1)"/><text x="205" y="66" text-anchor="middle" class="small">1 GET → miss</text>
  <path class="line" d="M110 100 H488" marker-end="url(#arr-ci-1)"/><text x="395" y="94" text-anchor="middle" class="small">2 SELECT</text>
  <path class="line dashed" d="M490 126 H112" marker-end="url(#arr-ci-1)"/><text x="395" y="120" text-anchor="middle" class="small">3 price = 1000</text>
  <rect class="box muted" x="20" y="146" width="180" height="40" rx="6"/><text x="110" y="163" text-anchor="middle" class="small">reader pauses:</text><text x="110" y="177" text-anchor="middle" class="small">GC, slow network, CPU</text>
  <path class="line" d="M680 160 H492" marker-end="url(#arr-ci-1)"/><text x="585" y="154" text-anchor="middle" class="small">4 UPDATE 1500</text>
  <path class="line" d="M680 196 H302" marker-end="url(#arr-ci-1)"/><text x="585" y="190" text-anchor="middle" class="small">5 DEL key</text>
  <path class="line bad" d="M110 232 H298" marker-end="url(#arr-ci-1)"/><text x="205" y="226" text-anchor="middle" class="small">6 SET 1000 (old!)</text>
  <rect class="box bad" x="220" y="246" width="360" height="40" rx="6"/><text x="400" y="263" text-anchor="middle" class="small">cache = 1000, database = 1500</text><text x="400" y="278" text-anchor="middle" class="small">every reader gets the old price until the TTL ends</text>
  <path class="line accent dashed" d="M680 318 H302" marker-end="url(#arr-ci-1)"/><text x="500" y="300" class="small">7 fix: second DEL ~500 ms later,</text><text x="500" y="312" class="small">or a lease rejects step 6</text>
</svg>
<figcaption>The window is small (the read must start before the update and finish after the delete), but at thousands of reads per second on a hot key it happens. The fixes are a delayed second delete, a lease, or a short TTL to bound the damage.</figcaption>
</figure>

<p><strong>Why delete beats set-on-write.</strong> If writers <em>set</em> the new value, two concurrent updates can reach the cache in the opposite order from the database, and the older value wins with nothing left to correct it. A delete carries no value, so the order of two deletes doesn't matter: the next read loads whatever the database has <em>now</em>. Facebook's memcache paper gives the same reason: they delete instead of update "because deletes are idempotent", which also makes them safe to retry.</p>

<p><strong>Delayed double delete.</strong> Delete right after the commit, then delete again after a delay longer than a typical read-and-fill (a few hundred milliseconds). The second delete removes a stale value that a slow reader put back. It narrows the race; it doesn't close it, because a reader can pause longer than the delay.</p>

<p><strong>Leases.</strong> "Scaling Memcache at Facebook" (NSDI 2013) describes leases, which solve both stale sets and stampedes:</p>
<ul>
  <li>On a miss, the cache gives the client a 64-bit lease token bound to that key. The later <code>SET</code> must present the token.</li>
  <li>A delete for that key invalidates the token, so the slow reader's <code>SET</code> in step 6 is <strong>rejected</strong>.</li>
  <li>The cache hands out a token at most once every 10 seconds per key (their default). Other clients that miss in that window are told to wait briefly and retry, by which time the value is usually there.</li>
  <li>On a set of keys prone to thundering herds, they report the peak database query rate dropping from 17K/s to 1.3K/s.</li>
</ul>
<p>Redis has no built-in leases. You can approximate one with a token stored next to the key and a Lua script that only sets if the token still matches, or bound the problem with short TTLs.</p>

<h3>Event-driven invalidation</h3>
<figure class="diagram">
<svg viewBox="0 0 780 250" role="img" aria-label="Change data capture pipeline: the app commits an update to Postgres, a CDC connector such as Debezium reads the write-ahead log and publishes a change event to a Kafka topic, and an invalidator service maps the changed row to cache keys and tags, then deletes the keys in Redis in each region and purges the CDN by tag.">
  <defs><marker id="arr-ci-2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <rect class="box" x="20" y="40" width="110" height="44" rx="8"/><text x="75" y="67" text-anchor="middle" class="title">App</text>
  <rect class="box muted" x="160" y="40" width="110" height="44" rx="8"/><text x="215" y="67" text-anchor="middle" class="title">Postgres</text>
  <rect class="box" x="300" y="40" width="110" height="44" rx="8"/><text x="355" y="67" text-anchor="middle" class="title">CDC</text>
  <rect class="box" x="440" y="40" width="110" height="44" rx="8"/><text x="495" y="67" text-anchor="middle" class="title">Kafka</text>
  <rect class="box accent" x="580" y="40" width="120" height="44" rx="8"/><text x="640" y="59" text-anchor="middle" class="title">Invalidator</text><text x="640" y="76" text-anchor="middle" class="small">row → keys + tags</text>
  <path class="line" d="M130 62 H158" marker-end="url(#arr-ci-2)"/><path class="line" d="M270 62 H298" marker-end="url(#arr-ci-2)"/>
  <path class="line" d="M410 62 H438" marker-end="url(#arr-ci-2)"/><path class="line" d="M550 62 H578" marker-end="url(#arr-ci-2)"/>
  <text x="75" y="104" text-anchor="middle" class="small">UPDATE commits</text>
  <text x="215" y="104" text-anchor="middle" class="small">writes the WAL</text>
  <text x="355" y="104" text-anchor="middle" class="small">e.g. Debezium</text>
  <text x="495" y="104" text-anchor="middle" class="small">product-changes</text>

  <rect class="box ok" x="330" y="160" width="130" height="44" rx="8"/><text x="395" y="180" text-anchor="middle" class="title">Redis</text><text x="395" y="195" text-anchor="middle" class="small">region 1: DEL</text>
  <rect class="box ok" x="480" y="160" width="130" height="44" rx="8"/><text x="545" y="180" text-anchor="middle" class="title">Redis</text><text x="545" y="195" text-anchor="middle" class="small">region 2: DEL</text>
  <rect class="box ok" x="630" y="160" width="130" height="44" rx="8"/><text x="695" y="180" text-anchor="middle" class="title">CDN</text><text x="695" y="195" text-anchor="middle" class="small">purge tag product-42</text>
  <path class="line accent" d="M620 84 L410 158" marker-end="url(#arr-ci-2)"/>
  <path class="line accent" d="M630 84 L560 158" marker-end="url(#arr-ci-2)"/>
  <path class="line accent" d="M660 84 L690 158" marker-end="url(#arr-ci-2)"/>
  <text x="20" y="168" class="small">Sees every committed change,</text>
  <text x="20" y="184" class="small">including scripts and admin tools.</text>
  <text x="20" y="200" class="small">At-least-once delivery is fine:</text>
  <text x="20" y="216" class="small">deletes are idempotent.</text>
  <text x="390" y="238" text-anchor="middle" class="small">Adds seconds of lag, so pair it with delete-on-write where read-your-write matters.</text>
</svg>
<figcaption>Event-driven invalidation reaches caches the writer can't call directly: other regions, local caches in every pod (via pub/sub), the CDN. Facebook's version, <code>mcsqueal</code>, runs on every database, reads the committed SQL statements, extracts the keys to delete and broadcasts the deletes to the cache clusters in that region.</figcaption>
</figure>

<h3>Comparing the strategies</h3>
<table>
  <tr><th>Strategy</th><th>Staleness after a write</th><th>Complexity</th><th>Use for</th><th>Watch out for</th></tr>
  <tr><td>TTL only</td><td>up to the TTL</td><td>none</td><td>data where "a few minutes old" is fine; a safety net on everything</td><td>long TTLs on data that matters</td></tr>
  <tr><td>Delete on write</td><td>~0, except the race above</td><td>low; every write path must do it</td><td>the default for cache-aside</td><td>a forgotten write path; a failed delete</td></tr>
  <tr><td>Write-through update</td><td>~0, but writers can race</td><td>low</td><td>read-after-write data with one writer per key</td><td>concurrent writers leave the older value</td></tr>
  <tr><td>Versioned / generation keys</td><td>0: old keys are never read</td><td>low; the version must be known at read time</td><td>schema changes, groups of keys, list pages</td><td>orphaned keys use memory until evicted</td></tr>
  <tr><td>Fingerprinted file names</td><td>0 for the file; the HTML must be fresh</td><td>build tool does it</td><td>JS, CSS, images</td><td>caching the HTML that points to them</td></tr>
  <tr><td>Event-driven (CDC, pub/sub)</td><td>event lag: usually seconds</td><td>high: connector, topic, consumer</td><td>many regions, many caches, many writers</td><td>a stuck consumer silently stops invalidation</td></tr>
  <tr><td>CDN purge (URL, tag, soft)</td><td>propagation time of the purge</td><td>medium; needs tagging</td><td>HTML and API responses at the edge</td><td>purge rate limits; purging everything on each deploy</td></tr>
</table>

<h2>Example</h2>
<p><strong>Update the database, then delete the key</strong>, with a delayed second delete, a generation counter for a group of keys, and fingerprinted file names:</p>
<pre><code>package inval

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"log/slog"
	"path/filepath"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

type Catalog struct {
	db  *sql.DB
	rdb *redis.Client
}

func productKey(id string) string { return "product:" + id }

// UpdatePrice: write the source of truth FIRST, then delete the cached copy.
// The next read misses and loads the new row (cache-aside).
func (c *Catalog) UpdatePrice(ctx context.Context, id string, cents int) error {
	_, err := c.db.ExecContext(ctx,
		"UPDATE products SET price_cents = $1, updated_at = now() WHERE id = $2", cents, id)
	if err != nil {
		return err // DB failed: cache still matches DB, nothing to undo
	}
	if err := c.rdb.Del(ctx, productKey(id)).Err(); err != nil {
		// DB is updated but the cache is stale. The TTL is the safety net;
		// an outbox/CDC consumer can retry the delete (see below).
		slog.Warn("cache delete failed", "key", productKey(id), "err", err)
	}
	// Delayed double delete: removes a stale value that a slow reader may
	// have written back between our UPDATE and our first DEL.
	time.AfterFunc(500*time.Millisecond, func() {
		c.rdb.Del(context.Background(), productKey(id))
	})
	return nil
}

// Generation (namespace) keys: bump one counter and every key built from the
// old generation becomes unreachable. Old entries just age out by TTL.
func CategoryKey(ctx context.Context, rdb *redis.Client, category, page string) (string, error) {
	gen, err := rdb.Get(ctx, "gen:category:"+category).Int64()
	if err != nil &amp;&amp; err != redis.Nil {
		return "", err
	}
	return fmt.Sprintf("category:%s:g%d:page:%s", category, gen, page), nil
}

func InvalidateCategory(ctx context.Context, rdb *redis.Client, category string) error {
	return rdb.Incr(ctx, "gen:category:"+category).Err()
}

// Fingerprinted asset names: the content hash is in the URL, so a new deploy
// is a new URL and the old one never needs purging.
func Fingerprint(name string, content []byte) string {
	sum := sha256.Sum256(content)
	ext := filepath.Ext(name)
	return strings.TrimSuffix(name, ext) + "." + hex.EncodeToString(sum[:])[:8] + ext
}</code></pre>
<p>Real output from tests of the generation key and the fingerprint (the hash changes because the content changed):</p>
<pre><code>before: category:lamps:g0:page:1
after:  category:lamps:g1:page:1 exists: false
app.fc787e30.js
app.a23d0f93.js</code></pre>
<p>A test also replays the races step by step against a test Redis, with a map standing in for the database. Real output:</p>
<pre><code>set-on-write, two writers:
  A: UPDATE price=1200                         db=1200 cache=(empty)
  B: UPDATE price=1500                         db=1500 cache=(empty)
  B: SET cache=1500                            db=1500 cache=1500
  A (delayed): SET cache=1200  -&gt; stale        db=1500 cache=1200
delete-on-write, same two writers:
  A, B: UPDATE then DEL (any order)            db=1500 cache=(empty)
delete-on-write, slow reader:
  R: cache miss, reads db=1000                 db=1000 cache=(empty)
  W: UPDATE price=1500                         db=1500 cache=(empty)
  W: DEL                                       db=1500 cache=(empty)
  R (delayed): SET cache=1000  -&gt; stale        db=1500 cache=1000
  W: second DEL after 500 ms                   db=1500 cache=(empty)</code></pre>

<p><strong>Purging the CDN by tag.</strong> The origin labels each product page with the products it shows. After the update commits, one call purges them all (Fastly shown; Cloudflare's equivalent is the <code>Cache-Tag</code> header and its purge API with <code>"tags"</code>):</p>
<pre><code># Origin response for /products/42 and for every list page that shows it:
#   Surrogate-Key: product-42 category-lamps

# After the price update commits: mark everything tagged product-42 stale.
curl -X POST "https://api.fastly.com/service/$SERVICE_ID/purge/product-42" &#92;
  -H "Fastly-Key: $FASTLY_API_TOKEN" &#92;
  -H "Fastly-Soft-Purge: 1"</code></pre>

<p><strong>Real-world scenario: two prices on one screen.</strong> At 14:05 a merchandiser cuts a lamp from 29.99 to 19.99. The API deletes <code>product:42</code> in Redis, so the cart and checkout show 19.99 straight away. But the product page HTML is cached at the CDN for 10 minutes, and category pages in each pod's local cache for 60 seconds. Until 14:15, customers see 29.99 on the product page and 19.99 at checkout, and some complain. The fix: tag product and category pages with <code>product-42</code>, and have the invalidator (fed by CDC) soft-purge that tag and publish the change so every pod drops its local copy. The pages now update within seconds, and the 10-minute TTL remains only as a safety net.</p>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>Deleting before the commit.</strong> Delete-then-update lets a reader refill the cache with the old row before the update lands. Always commit first, then delete. If the delete must be guaranteed, write an outbox row in the same transaction or rely on CDC.</li>
  <li><strong>Invalidating inside the transaction.</strong> If the transaction then rolls back, you deleted for nothing (harmless). If you <em>set</em> the new value and it rolls back, the cache now holds data that never existed.</li>
  <li><strong>Forgetting a write path.</strong> Admin panels, batch jobs, migrations and manual SQL don't run your invalidation code. That is the strongest argument for CDC and for always having a TTL.</li>
  <li><strong>Not knowing which keys depend on a row.</strong> A product appears in its own key, in category lists, in search results and in recommendations. Keep the mapping explicit (tags, generation keys) or you will invalidate some copies and miss others.</li>
  <li><strong>Purging everything on each deploy.</strong> It empties every edge at once and sends a stampede to the origin. Use fingerprinted assets and targeted purges.</li>
  <li><strong>Assuming the delete worked.</strong> Redis can time out. Log it, retry it, and count failures as a <a href="#metrics">metric</a>; the TTL caps the damage.</li>
  <li><strong>Local caches in every pod.</strong> Deleting from Redis doesn't touch in-process copies. Broadcast invalidations (Redis pub/sub, Kafka) or keep local TTLs to a few seconds.</li>
</ul>

<div class="callout warn"><strong>Rule of thumb</strong>: commit to the database, then delete (don't set) the cache key, and always keep a TTL as the backstop for every failure you didn't think of.</div>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>Invalidation is hard because copies are everywhere, caches don't see writes, and readers race writers.</li>
  <li>Delete after commit beats set-on-write: deletes are idempotent and order-independent.</li>
  <li>A slow reader can still put an old value back: delayed double delete narrows the window, leases close it, TTLs bound it.</li>
  <li>Make change cheap by design: versioned keys, fingerprinted files, tags for CDN purges, CDC to catch every write.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#caching">Caching</a> · <a href="#edge-caching">Edge Caching</a> · <a href="#cdn">CDN</a> · <a href="#race-conditions">Race Conditions</a> · <a href="#event-driven-architecture">Event-Driven Architecture</a> · <a href="#real-world-caching-stack">Real-World Caching Stack</a></p>
`;
CONTENT["real-world-caching-stack"] = `
<p class="tldr"><strong>TL;DR</strong>: A real site doesn't have one cache. It has a chain of them: the browser, the CDN edge, an origin shield, the reverse proxy, a small in-process cache in each app pod, Redis, and finally the database. Each layer catches what the one before it missed. Most of the engineering is choosing what each layer may keep and for how long, and how a change in the database reaches every layer. This page wires one e-commerce product endpoint through all of them and walks through a deploy and a flash sale.</p>

<h2>Why combine them at all?</h2>
<p>Each layer is good at something different. The browser is free and instant but holds data for one user, and you can't purge it. The <a href="#cdn">CDN</a> is close to every user and absorbs floods, but it's shared, so it must never see personal data. Redis is shared by all your pods and easy to invalidate, but every read is still a network hop. An in-process cache is the fastest of all but every pod has its own copy, so it can only hold data that may be a second or two stale. No single layer gives you speed, low origin load and fresh data at once. The chain does, if every layer follows the same rules: the database is the truth, everything else is a copy with a lifetime and a way to be invalidated.</p>
<p>The risk is the opposite problem. Five layers with five TTLs and no plan for invalidation give you a site where a price change shows up "sometime in the next 20 minutes", and nobody can say which layer is still serving the old one.</p>

<h2>How it works: one request through the stack</h2>
<figure class="diagram">
<svg viewBox="0 0 780 348" role="img" aria-label="Seven cache layers in order: browser, CDN edge, origin shield, reverse proxy, app in-process LRU, Redis, database, each with a typical cost. Below, four requests stop at different layers: a repeat visit for a fingerprinted script stops in the browser, a new visitor stops at the edge, a request just after a purge passes the edge, shield, proxy and in-process cache and is answered by Redis, and the first read after a price change goes all the way to the database.">
  <defs><marker id="arr-rcs-1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <rect class="box accent" x="10" y="40" width="92" height="96" rx="10"/>
  <text x="56" y="62" text-anchor="middle" class="title">Browser</text>
  <text x="56" y="84" text-anchor="middle" class="small">HTTP cache</text>
  <text x="56" y="101" text-anchor="middle" class="small">per device</text>
  <text x="56" y="118" text-anchor="middle" class="small">hit: 0 ms</text>
  <path class="line" d="M102 88 H120" marker-end="url(#arr-rcs-1)"/>
  <rect class="box accent" x="122" y="40" width="92" height="96" rx="10"/>
  <text x="168" y="62" text-anchor="middle" class="title">CDN edge</text>
  <text x="168" y="84" text-anchor="middle" class="small">nearest PoP</text>
  <text x="168" y="101" text-anchor="middle" class="small">shared by many</text>
  <text x="168" y="118" text-anchor="middle" class="small">~10–30 ms</text>
  <path class="line" d="M214 88 H232" marker-end="url(#arr-rcs-1)"/>
  <rect class="box accent" x="234" y="40" width="92" height="96" rx="10"/>
  <text x="280" y="62" text-anchor="middle" class="title">Shield</text>
  <text x="280" y="84" text-anchor="middle" class="small">one PoP near</text>
  <text x="280" y="101" text-anchor="middle" class="small">the origin</text>
  <text x="280" y="118" text-anchor="middle" class="small">+10–80 ms</text>
  <path class="line" d="M326 88 H344" marker-end="url(#arr-rcs-1)"/>
  <rect class="box" x="346" y="40" width="92" height="96" rx="10"/>
  <text x="392" y="62" text-anchor="middle" class="title">Proxy</text>
  <text x="392" y="84" text-anchor="middle" class="small">nginx / LB</text>
  <text x="392" y="101" text-anchor="middle" class="small">micro-cache</text>
  <text x="392" y="118" text-anchor="middle" class="small">+1 ms</text>
  <path class="line" d="M438 88 H456" marker-end="url(#arr-rcs-1)"/>
  <rect class="box" x="458" y="40" width="92" height="96" rx="10"/>
  <text x="504" y="62" text-anchor="middle" class="title">App LRU</text>
  <text x="504" y="84" text-anchor="middle" class="small">in-process</text>
  <text x="504" y="101" text-anchor="middle" class="small">per pod</text>
  <text x="504" y="118" text-anchor="middle" class="small">~1 µs</text>
  <path class="line" d="M550 88 H568" marker-end="url(#arr-rcs-1)"/>
  <rect class="box" x="570" y="40" width="92" height="96" rx="10"/>
  <text x="616" y="62" text-anchor="middle" class="title">Redis</text>
  <text x="616" y="84" text-anchor="middle" class="small">shared by pods</text>
  <text x="616" y="101" text-anchor="middle" class="small">network hop</text>
  <text x="616" y="118" text-anchor="middle" class="small">~0.5–1 ms</text>
  <path class="line" d="M662 88 H680" marker-end="url(#arr-rcs-1)"/>
  <rect class="box ok" x="682" y="40" width="92" height="96" rx="10"/>
  <text x="728" y="62" text-anchor="middle" class="title">Database</text>
  <text x="728" y="84" text-anchor="middle" class="small">source of</text>
  <text x="728" y="101" text-anchor="middle" class="small">truth</text>
  <text x="728" y="118" text-anchor="middle" class="small">~2–50 ms</text>
  <text x="390" y="22" text-anchor="middle" class="small">client side · edge network · your region (shield ideally near origin) · inside the service</text>
  <text x="20" y="172">Repeat visit, app.3f9a1c.js: browser hit, no request sent at all · user waits 0 ms</text>
  <ellipse class="box ok" cx="56" cy="188" rx="7" ry="7"/>
  <text x="68" y="192" class="small">hit</text>
  <text x="20" y="216">New visitor, product page: edge hit · user waits ~20 ms</text>
  <path class="line accent" d="M56 232 H168"/>
  <ellipse class="box muted" cx="56" cy="232" rx="5" ry="5"/>
  <ellipse class="box ok" cx="168" cy="232" rx="7" ry="7"/>
  <text x="180" y="236" class="small">hit</text>
  <text x="20" y="260">Just after a purge: edge, shield, proxy and LRU miss; Redis has it · user waits ~100 ms</text>
  <path class="line accent" d="M56 276 H616"/>
  <ellipse class="box muted" cx="56" cy="276" rx="5" ry="5"/>
  <ellipse class="box muted" cx="168" cy="276" rx="5" ry="5"/>
  <ellipse class="box muted" cx="280" cy="276" rx="5" ry="5"/>
  <ellipse class="box muted" cx="392" cy="276" rx="5" ry="5"/>
  <ellipse class="box muted" cx="504" cy="276" rx="5" ry="5"/>
  <ellipse class="box ok" cx="616" cy="276" rx="7" ry="7"/>
  <text x="628" y="280" class="small">hit</text>
  <text x="20" y="304">First read after a price change: Redis key deleted, DB query · user waits ~130 ms</text>
  <path class="line accent" d="M56 320 H728"/>
  <ellipse class="box muted" cx="56" cy="320" rx="5" ry="5"/>
  <ellipse class="box muted" cx="168" cy="320" rx="5" ry="5"/>
  <ellipse class="box muted" cx="280" cy="320" rx="5" ry="5"/>
  <ellipse class="box muted" cx="392" cy="320" rx="5" ry="5"/>
  <ellipse class="box muted" cx="504" cy="320" rx="5" ry="5"/>
  <ellipse class="box muted" cx="616" cy="320" rx="5" ry="5"/>
  <ellipse class="box ok" cx="728" cy="320" rx="7" ry="7"/>
  <text x="716" y="314" text-anchor="end" class="small">answer</text>
</svg>
<figcaption>Every request goes left to right until some layer has a fresh copy. The costs are rough orders of magnitude for a user far from your region; measure your own. A hit at a layer means none of the layers to its right do any work.</figcaption>
</figure>

<p>Each sibling page owns one part of this picture:</p>
<ol>
  <li><strong>Where caches live and how they fill</strong>: <a href="#caching">Caching</a> covers cache-aside, eviction, hit-ratio math, stampedes and hot keys.</li>
  <li><strong>The edge network</strong>: <a href="#cdn">CDN</a> covers PoPs, how users reach the nearest one, origin shield and tiered caching.</li>
  <li><strong>What a shared HTTP cache may store</strong>: <a href="#edge-caching">Edge Caching</a> covers <code>Cache-Control</code>, <code>Vary</code>, <code>ETag</code> and 304s.</li>
  <li><strong>Keeping copies honest</strong>: <a href="#cache-invalidation">Cache Invalidation</a> covers delete-on-write, versioned keys, purges and the races between them.</li>
</ol>

<h3>What to cache where: an e-commerce site</h3>
<table>
  <tr><th>Content</th><th>Browser</th><th>CDN edge</th><th>Redis / in-process</th><th>How a change gets out</th></tr>
  <tr><td>JS, CSS, images with a hash in the name</td><td><code>public, max-age=31536000, immutable</code></td><td>same, 1 year</td><td>&ndash;</td><td>new file name; never purge</td></tr>
  <tr><td>HTML pages (home, category)</td><td><code>no-cache</code> + <code>ETag</code> (always revalidate)</td><td>60 s + <code>stale-while-revalidate</code></td><td>rendered fragments, minutes</td><td>purge on deploy or edit</td></tr>
  <tr><td>Product details (name, text, images)</td><td><code>no-cache</code> + <code>ETag</code></td><td>5 min + SWR + <code>stale-if-error</code></td><td>Redis 10 min</td><td>delete Redis key + purge tag <code>product-42</code></td></tr>
  <tr><td>Price and stock shown on the page</td><td><code>no-cache</code></td><td>1&ndash;5 s, or not at all</td><td>Redis, deleted on write; in-process 1 s</td><td>short TTL; checkout always re-reads the DB</td></tr>
  <tr><td>Search and category listings</td><td><code>no-cache</code></td><td>60 s, normalized query in the key</td><td>Redis 1&ndash;5 min</td><td>TTL; tolerate a minute of staleness</td></tr>
  <tr><td>Cart</td><td><code>private, no-store</code></td><td><strong>never</strong></td><td>Redis as the store, not as a cache</td><td>it <em>is</em> the data</td></tr>
  <tr><td>User profile, orders</td><td><code>private, no-cache</code></td><td><strong>never</strong></td><td>Redis per user, short TTL</td><td>delete on update</td></tr>
  <tr><td>Checkout, payment, errors (5xx)</td><td><code>no-store</code></td><td>never</td><td>never</td><td>&ndash;</td></tr>
</table>
<p>The rule of thumb: the more people share a response and the less it changes, the further left it can be cached. Anything tied to a logged-in user stops at the browser (<code>private</code>) or isn't cached at all.</p>

<h3>A deploy, step by step</h3>
<figure class="diagram">
<svg viewBox="0 0 780 326" role="img" aria-label="Deploy timeline. Build emits fingerprinted asset names. Upload new assets first and keep the old ones. Deploy new HTML with no-cache and a new ETag. Purge HTML at the CDN; assets need no purge. Next view: the browser revalidates HTML and gets new asset links, which miss once per edge then hit for a year. Old tabs still load the old script, which still exists. After a week, delete assets nothing references.">
  <path class="line" d="M90 24 V306"/>
  <ellipse class="box accent" cx="90" cy="38" rx="6" ry="6"/>
  <text x="76" y="42" text-anchor="end" class="title">build</text>
  <text x="106" y="42">Bundler emits app.3f9a1c.js and app.8d41e0.css: hash in the name.</text>
  <rect class="box muted" x="640" y="24" width="130" height="26" rx="13"/>
  <text x="705" y="42" text-anchor="middle" class="small">fingerprint</text>
  <ellipse class="box accent" cx="90" cy="80" rx="6" ry="6"/>
  <text x="76" y="84" text-anchor="end" class="title">upload</text>
  <text x="106" y="84">Upload new assets first. The old app.9b2e77.js stays where it is.</text>
  <rect class="box muted" x="640" y="66" width="130" height="26" rx="13"/>
  <text x="705" y="84" text-anchor="middle" class="small">origin / bucket</text>
  <ellipse class="box accent" cx="90" cy="122" rx="6" ry="6"/>
  <text x="76" y="126" text-anchor="end" class="title">deploy</text>
  <text x="106" y="126">New HTML goes live with Cache-Control: no-cache and a new ETag.</text>
  <rect class="box accent" x="640" y="108" width="130" height="26" rx="13"/>
  <text x="705" y="126" text-anchor="middle" class="small">HTML only</text>
  <ellipse class="box accent" cx="90" cy="164" rx="6" ry="6"/>
  <text x="76" y="168" text-anchor="end" class="title">purge</text>
  <text x="106" y="168">Purge the HTML URLs at the CDN. Assets need no purge.</text>
  <rect class="box accent" x="640" y="150" width="130" height="26" rx="13"/>
  <text x="705" y="168" text-anchor="middle" class="small">CDN</text>
  <ellipse class="box ok" cx="90" cy="206" rx="6" ry="6"/>
  <text x="76" y="210" text-anchor="end" class="title">browse</text>
  <text x="106" y="210">Browser revalidates HTML, gets new links; each asset misses once.</text>
  <rect class="box ok" x="640" y="192" width="130" height="26" rx="13"/>
  <text x="705" y="210" text-anchor="middle" class="small">1 year of hits</text>
  <ellipse class="box ok" cx="90" cy="248" rx="6" ry="6"/>
  <text x="76" y="252" text-anchor="end" class="title">old tab</text>
  <text x="106" y="252">A tab opened before the deploy still loads app.9b2e77.js. It exists.</text>
  <rect class="box ok" x="640" y="234" width="130" height="26" rx="13"/>
  <text x="705" y="252" text-anchor="middle" class="small">no 404s</text>
  <ellipse class="box accent" cx="90" cy="290" rx="6" ry="6"/>
  <text x="76" y="294" text-anchor="end" class="title">cleanup</text>
  <text x="106" y="294">A week later, delete assets that no live HTML references.</text>
  <rect class="box muted" x="640" y="276" width="130" height="26" rx="13"/>
  <text x="705" y="294" text-anchor="middle" class="small">storage</text>
</svg>
<figcaption>Fingerprinted names make assets safe to cache forever, because a new version is a new URL. Only the small HTML file needs revalidation or a purge. Order matters: assets before HTML, and old assets kept, or some users load HTML that points at files that don't exist yet or anymore.</figcaption>
</figure>

<h2>A flash sale, with numbers</h2>
<p>Say a sale on product 42 starts at 12:00. The product page and its stock widget together get 100,000 requests per second, spread over 100 edge PoPs. Add-to-cart, a POST that can't be cached, gets 5,000 per second. There are 40 app pods. At 12:00:00 an admin job sets the sale price, which deletes <code>product:42</code> in Redis and purges the tag <code>product-42</code> at the CDN, at the worst possible moment.</p>
<ul>
  <li><strong>The edge.</strong> The page has <code>max-age=300, stale-while-revalidate=60</code> for the CDN, and the stock widget a 1 s TTL. The shield collapses refetches, so the origin sees about one request per URL per refresh: around 2 per second instead of 100,000. If the CDN supports a soft purge (mark stale instead of delete), users keep getting the old page for the second it takes to refetch, instead of all waiting on the origin.</li>
  <li><strong>The stampede.</strong> With the Redis key gone, every add-to-cart request misses. At 5,000 per second and a 20 ms query, about 100 identical queries would be in flight at once. With <code>singleflight</code> each pod sends one, so at most 40, and then Redis is warm again. Better still: the job that changed the price writes the new value back right after the delete, so the first reader doesn't pay.</li>
  <li><strong>The hot key.</strong> Once warm, all 5,000 reads per second go to the one Redis shard that holds <code>product:42</code>. A 1-second in-process cache in each pod cuts that to 40 reads per second (one per pod per second), at the cost of up to 1 s of extra staleness.</li>
  <li><strong>What the DB does instead.</strong> It takes the ~500 order writes per second, which is the work only it can do. Checkout reads the price from the DB inside the order transaction; a cached price is for display, never for charging.</li>
</ul>
<figure class="diagram">
<svg viewBox="0 0 780 300" role="img" aria-label="Log-scale bar chart, requests per second with and without each cache layer during the flash sale. Origin requests for the page and stock widget: 100,000 without the CDN, 2 with edge, shield and stale-while-revalidate. Redis reads of product 42: 5,000 without an in-process cache, 40 with a one-second cache per pod. Identical database queries in flight at the refill: about 100 without singleflight, at most 40 with it.">
  <text x="20" y="44" class="title">Origin requests/s</text>
  <text x="20" y="62" class="small">page + stock widget</text>
  <rect class="box bad" x="300" y="28" width="450" height="22" rx="3"/>
  <rect class="box ok" x="300" y="56" width="27" height="22" rx="3"/>
  <text x="742" y="43" text-anchor="end" class="small">100,000 without CDN</text>
  <text x="335" y="71" class="small">2 with edge + shield + SWR</text>
  <text x="20" y="122" class="title">Redis reads/s</text>
  <text x="20" y="140" class="small">of product:42 (hot key)</text>
  <rect class="box bad" x="300" y="106" width="332" height="22" rx="3"/>
  <rect class="box ok" x="300" y="134" width="144" height="22" rx="3"/>
  <text x="624" y="121" text-anchor="end" class="small">5,000 without LRU</text>
  <text x="452" y="149" class="small">40 with 1 s LRU per pod</text>
  <text x="20" y="200" class="title">Identical DB queries</text>
  <text x="20" y="218" class="small">in flight at the refill</text>
  <rect class="box bad" x="300" y="184" width="180" height="22" rx="3"/>
  <rect class="box ok" x="300" y="212" width="144" height="22" rx="3"/>
  <text x="488" y="199" class="small">~100 without singleflight</text>
  <text x="452" y="227" class="small">≤ 40 with singleflight</text>
  <path class="line" d="M300 262 H750"/>
  <path class="line" d="M300 262 V268"/>
  <text x="300" y="282" text-anchor="middle" class="small">1</text>
  <path class="line" d="M390 262 V268"/>
  <text x="390" y="282" text-anchor="middle" class="small">10</text>
  <path class="line" d="M480 262 V268"/>
  <text x="480" y="282" text-anchor="middle" class="small">100</text>
  <path class="line" d="M570 262 V268"/>
  <text x="570" y="282" text-anchor="middle" class="small">1k</text>
  <path class="line" d="M660 262 V268"/>
  <text x="660" y="282" text-anchor="middle" class="small">10k</text>
  <path class="line" d="M750 262 V268"/>
  <text x="750" y="282" text-anchor="middle" class="small">100k</text>
  <text x="20" y="282" class="small">per second, log scale</text>
</svg>
<figcaption>Log scale. Each layer removes load for the one behind it: the edge for the origin, the in-process cache for Redis, <code>singleflight</code> for the database.</figcaption>
</figure>

<h3>How to measure it</h3>
<p>A cache you don't measure is a guess. Track the hit ratio per layer, plus origin load and the latency of misses, as <a href="#metrics">metrics</a> on the same dashboard.</p>
<table>
  <tr><th>Layer</th><th>How you see hits and misses</th><th>Watch</th></tr>
  <tr><td>Browser</td><td>Real-user monitoring: the Resource Timing API (a <code>transferSize</code> of 0 usually means it came from the browser cache)</td><td>repeat-visit load time</td></tr>
  <tr><td>CDN edge and shield</td><td>CDN logs and analytics; response headers such as <code>CF-Cache-Status</code> on Cloudflare (<code>HIT</code>, <code>MISS</code>, <code>EXPIRED</code>, <code>STALE</code>, <code>UPDATING</code>, &hellip;) or the standard <code>Cache-Status</code> header (RFC 9211), plus <code>Age</code></td><td>hit ratio by bytes and by requests, origin requests per second</td></tr>
  <tr><td>Reverse proxy</td><td>nginx <code>$upstream_cache_status</code> in the access log</td><td>hit ratio per route</td></tr>
  <tr><td>App in-process and Redis</td><td>your own counter, e.g. <code>cache_requests_total{layer, result}</code></td><td>hit ratio, Redis latency, evictions, memory</td></tr>
  <tr><td>Database</td><td>queries per second, slow-query log</td><td>reads that should have been cache hits</td></tr>
</table>
<pre><code># hit ratio per layer, over 5 minutes
sum by (layer) (rate(cache_requests_total{result="hit"}[5m]))
  /
sum by (layer) (rate(cache_requests_total[5m]))</code></pre>
<p>Read the ratios together. An edge hit ratio of 95% sounds good, but if the 5% that misses is your heaviest page, the origin still does most of the work. That's why byte hit ratio and origin requests per second matter as much as the request hit ratio.</p>

<h2>Example</h2>
<p><strong>One product endpoint, cached at every layer.</strong> The handler tells browsers to always revalidate (<code>Cache-Control: no-cache</code>) and tells the CDN to keep it for 5 minutes with <a href="#edge-caching">stale-while-revalidate and stale-if-error</a>, through <code>CDN-Cache-Control</code> (RFC 9213; Cloudflare, for example, uses it for its own cache and passes <code>Cache-Control</code> on to the browser). It sets an <code>ETag</code> from the product's version and a tag for purging. Behind it, Redis cache-aside with <code>singleflight</code> and a jittered TTL. The update path writes the DB, deletes the Redis key and purges the CDN tag, in that order (see <a href="#cache-invalidation">Cache Invalidation</a> for why delete beats set).</p>
<pre><code>package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"net/http"
	"time"

	"github.com/redis/go-redis/v9"
	"golang.org/x/sync/singleflight"
)

type Product struct {
	ID         string &#96;json:"id"&#96;
	Name       string &#96;json:"name"&#96;
	PriceCents int64  &#96;json:"price_cents"&#96;
	Version    int64  &#96;json:"version"&#96; // bumped on every write; feeds the ETag
}

var errNotFound = errors.New("not found")

// DB (in db.go) stands in for Postgres: Product(ctx, id) and SetPrice(ctx, id, cents),
// which bumps Version. It counts Queries.

type Server struct {
	db    *DB
	rdb   *redis.Client
	group singleflight.Group
	ttl   time.Duration
	purge func(ctx context.Context, tag string) error // CDN purge-by-tag API call
}

func cacheKey(id string) string { return "product:" + id }

// load is cache-aside: Redis first; on a miss, one DB query per key per pod
// (singleflight), then fill Redis with a jittered TTL.
func (s *Server) load(ctx context.Context, id string) (Product, string, error) {
	key := cacheKey(id)
	b, err := s.rdb.Get(ctx, key).Bytes()
	if err == nil {
		var p Product
		if json.Unmarshal(b, &amp;p) == nil {
			return p, "redis", nil
		}
	} else if !errors.Is(err, redis.Nil) {
		slog.Warn("redis get failed, reading db", "key", key, "err", err)
	}

	v, err, _ := s.group.Do(key, func() (any, error) {
		// Detach from the first caller's cancellation: the others share this result.
		ctx := context.WithoutCancel(ctx)
		p, err := s.db.Product(ctx, id)
		if err != nil {
			return Product{}, err
		}
		b, _ := json.Marshal(p)
		ttl := s.ttl + rand.N(s.ttl/10) // jitter so hot keys don't expire together
		if err := s.rdb.Set(ctx, key, b, ttl).Err(); err != nil {
			slog.Warn("redis set failed", "key", key, "err", err)
		}
		return p, nil
	})
	if err != nil {
		return Product{}, "", err
	}
	return v.(Product), "db", nil
}

func (s *Server) getProduct(w http.ResponseWriter, r *http.Request) {
	p, src, err := s.load(r.Context(), r.PathValue("id"))
	h := w.Header()
	switch {
	case errors.Is(err, errNotFound):
		h.Set("Cache-Control", "public, max-age=30") // short negative cache
		http.Error(w, "not found", http.StatusNotFound)
		return
	case err != nil:
		h.Set("Cache-Control", "no-store") // never cache a 5xx
		http.Error(w, "unavailable", http.StatusServiceUnavailable)
		return
	}

	etag := fmt.Sprintf(&#96;"p%s-v%d"&#96;, p.ID, p.Version)
	// Browsers revalidate every time (cheap 304s); the CDN keeps it 5 min and
	// serves stale while it refetches, or for a day if the origin is down.
	h.Set("Cache-Control", "no-cache")
	h.Set("CDN-Cache-Control", "max-age=300, stale-while-revalidate=60, stale-if-error=86400")
	h.Set("Surrogate-Key", "product-"+p.ID) // tag for purge; Cloudflare calls it Cache-Tag
	h.Set("ETag", etag)
	h.Set("X-Served-From", src)
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	h.Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(p)
}

func (s *Server) setPrice(w http.ResponseWriter, r *http.Request) {
	var in struct {
		PriceCents int64 &#96;json:"price_cents"&#96;
	}
	if err := json.NewDecoder(r.Body).Decode(&amp;in); err != nil || in.PriceCents &lt;= 0 {
		http.Error(w, "bad price", http.StatusBadRequest)
		return
	}
	id := r.PathValue("id")
	p, err := s.db.SetPrice(r.Context(), id, in.PriceCents) // 1. source of truth first
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	// 2. delete (not set) the Redis key; the next read refills it.
	if err := s.rdb.Del(r.Context(), cacheKey(id)).Err(); err != nil {
		slog.Error("redis del failed; TTL will expire it", "id", id, "err", err)
	}
	// 3. purge every CDN object tagged with this product.
	if err := s.purge(r.Context(), "product-"+id); err != nil {
		slog.Error("cdn purge failed; edge serves old price until max-age", "id", id, "err", err)
	}
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(p)
}

func (s *Server) routes() *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /products/{id}", s.getProduct)
	mux.HandleFunc("POST /products/{id}/price", s.setPrice)
	return mux
}

func main() {
	s := &amp;Server{
		db:    &amp;DB{rows: map[string]Product{"42": {ID: "42", Name: "Trail shoe", PriceCents: 12900, Version: 1}}},
		rdb:   redis.NewClient(&amp;redis.Options{Addr: "localhost:6379"}),
		ttl:   10 * time.Minute,
		purge: func(ctx context.Context, tag string) error { return nil },
	}
	http.ListenAndServe(":8080", s.routes())
}</code></pre>
<p>Real output from an <code>httptest</code> run against <code>miniredis</code>: 100 concurrent requests on a cold cache, a normal read, a conditional read, a price change, and a read with the old <code>ETag</code>:</p>
<pre><code>100 concurrent cold requests: db queries=1, served from map[db:100]
redis TTL product:42 = 10m47s

GET /products/42
200 OK
Cache-Control: no-cache
CDN-Cache-Control: max-age=300, stale-while-revalidate=60, stale-if-error=86400
Surrogate-Key: product-42
ETag: "p42-v1"
X-Served-From: redis
body: "{&#92;"id&#92;":&#92;"42&#92;",&#92;"name&#92;":&#92;"Trail shoe&#92;",&#92;"price_cents&#92;":12900,&#92;"version&#92;":1}"

GET /products/42  (If-None-Match: "p42-v1")
304 Not Modified
Cache-Control: no-cache
CDN-Cache-Control: max-age=300, stale-while-revalidate=60, stale-if-error=86400
Surrogate-Key: product-42
ETag: "p42-v1"
X-Served-From: redis
body: ""
CDN purge tag: product-42

POST /products/42/price
200 OK
Cache-Control: no-store
body: "{&#92;"id&#92;":&#92;"42&#92;",&#92;"name&#92;":&#92;"Trail shoe&#92;",&#92;"price_cents&#92;":9900,&#92;"version&#92;":2}"
redis has product:42 after update: false

GET /products/42  (If-None-Match: "p42-v1")
200 OK
Cache-Control: no-cache
CDN-Cache-Control: max-age=300, stale-while-revalidate=60, stale-if-error=86400
Surrogate-Key: product-42
ETag: "p42-v2"
X-Served-From: db
body: "{&#92;"id&#92;":&#92;"42&#92;",&#92;"name&#92;":&#92;"Trail shoe&#92;",&#92;"price_cents&#92;":9900,&#92;"version&#92;":2}"
db queries total: 2</code></pre>
<p>Things to notice: 100 cold requests cost 1 query. The 304 has no body but still carries the caching headers, so the CDN and browser refresh their copy's lifetime. After the update the old <code>ETag</code> no longer matches, so the client gets the new price with <code>v2</code>. The 304 still read Redis: conditional requests save bandwidth and rendering, not the lookup. In production, the CDN answers most of those itself.</p>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>Caching errors.</strong> A 500 or an empty result cached for 5 minutes at the edge turns a 2-second blip into a 5-minute outage. Send <code>no-store</code> on 5xx, cache 404s briefly at most, and check what your CDN does by default with error codes.</li>
  <li><strong>A personalized page leaking.</strong> A product page that shows "Hi, Alex" or a member price, cached at the edge with <code>public</code>, is now shown to everyone. Keep shared responses free of user data and load the personal parts with a separate <code>private</code> request. Watch for a <code>Set-Cookie</code> on a cacheable response, too.</li>
  <li><strong>Stale prices.</strong> TTLs stack. With 1 s in-process, 10 min Redis, 5 min at the shield and 5 min at the edge, a failed invalidation can leave an old price up for about 20 minutes. Invalidate every layer you can on write, keep layers that can't be invalidated (browser, in-process) short, and never charge from a cache.</li>
  <li><strong>Invalidating at peak.</strong> A purge or key delete in the middle of the sale sends the full load to the origin at once. Prefer soft purges, refill the key right after the write, and schedule big content changes off-peak when you can.</li>
  <li><strong>Too many layers.</strong> Every layer adds a TTL, a failure mode and a place to look when data is wrong. A small site with a CDN in front of static assets and Redis behind the app often needs nothing else. Add a layer when a metric says the one behind it is struggling.</li>
  <li><strong>A fragmented cache key.</strong> <code>?utm_source=…</code>, random query order or a <code>Vary: User-Agent</code> splits one page into thousands of cache entries and the hit ratio drops. Normalize the key at the edge and vary only on what changes the response.</li>
  <li><strong>Treating the cache as the database.</strong> If Redis is flushed and the DB can't take the full read load, the cache has become a dependency that must never fail. Know your cold-cache load, warm caches before sending traffic, and protect the DB with <a href="#rate-limiting">rate limits</a> or <a href="#backpressure">backpressure</a>.</li>
</ul>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>Shared, rarely changing content goes as far left as possible: fingerprinted assets for a year, public pages at the edge with stale-while-revalidate.</li>
  <li>Personal data stops at the browser (<code>private</code>) or isn't cached; prices are cached for display only.</li>
  <li>On every write: update the DB, delete the Redis key, purge the CDN tag. Keep layers you can't purge on short TTLs.</li>
  <li>Measure the hit ratio and the load behind each layer; that's how you know a layer earns its place.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#caching">Caching</a> · <a href="#cdn">CDN</a> · <a href="#edge-caching">Edge Caching</a> · <a href="#cache-invalidation">Cache Invalidation</a> · <a href="#real-world-traffic-stack">Real-World Traffic Stack</a> · <a href="#metrics">Metrics</a></p>
`;

