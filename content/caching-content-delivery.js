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
