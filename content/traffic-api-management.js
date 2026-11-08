CONTENT["rate-limiting"] = `
<p class="tldr"><strong>TL;DR</strong>: Rate limiting caps how many requests a client may make in a period, say 100 per minute per API key, and answers <code>429 Too Many Requests</code> beyond that. It's a bouncer at the door: it keeps one noisy client (or attacker) from crowding out everyone else and protects your servers, databases and wallet from overload.</p>

<h2>The problem it solves</h2>
<ul>
  <li><strong>Noisy neighbours</strong>: one customer's buggy script loops at 5,000 requests per second and slows the API for everyone.</li>
  <li><strong>Abuse</strong>: credential stuffing on <code>/login</code>, scraping, spam sign-ups, brute-forcing coupon codes.</li>
  <li><strong>Overload and cost</strong>: expensive endpoints (search, report generation, LLM calls) can melt a database or run up a bill.</li>
  <li><strong>Fair usage and pricing</strong>: free tier 60 requests/minute, paid tier 1,000.</li>
</ul>
<p>Without limits, your capacity is shared on a "whoever shouts loudest" basis.</p>

<h2>How it works</h2>
<p>Every request is tied to a <strong>key</strong> (API key, user ID, IP address, tenant), the limiter checks a counter for that key, and either lets the request through or rejects it with <code>429</code> plus a <code>Retry-After</code> header telling the client when to try again. The interesting part is the counting <em>algorithm</em>. The most common one is the <strong>token bucket</strong>:</p>

<figure class="diagram">
<svg viewBox="0 0 780 262" role="img" aria-label="Token bucket: tokens are added at 10 per second up to a capacity of 20. Each request takes one token and is allowed. When the bucket is empty, requests get 429 Too Many Requests with Retry-After.">
  <defs><marker id="arr-rl-1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <rect class="box muted" x="280" y="10" width="220" height="36" rx="8"/>
  <text x="390" y="33" text-anchor="middle">refill: +10 tokens per second</text>
  <path class="line" d="M390 46 V76" marker-end="url(#arr-rl-1)"/>
  <path class="line" d="M300 80 V200 H480 V80" style="stroke-width: 2.5"/>
  <circle class="box ok" cx="330" cy="185" r="9"/><circle class="box ok" cx="355" cy="185" r="9"/><circle class="box ok" cx="380" cy="185" r="9"/><circle class="box ok" cx="405" cy="185" r="9"/><circle class="box ok" cx="430" cy="185" r="9"/><circle class="box ok" cx="455" cy="185" r="9"/>
  <circle class="box ok" cx="342" cy="163" r="9"/><circle class="box ok" cx="367" cy="163" r="9"/><circle class="box ok" cx="392" cy="163" r="9"/><circle class="box ok" cx="417" cy="163" r="9"/>
  <text x="390" y="120" text-anchor="middle" class="small">capacity 20 = max burst</text>
  <text x="390" y="224" text-anchor="middle" class="small">10 tokens left</text>

  <rect class="box" x="20" y="90" width="120" height="30" rx="6"/><text x="80" y="110" text-anchor="middle" class="small">request</text>
  <rect class="box" x="20" y="128" width="120" height="30" rx="6"/><text x="80" y="148" text-anchor="middle" class="small">request</text>
  <rect class="box" x="20" y="166" width="120" height="30" rx="6"/><text x="80" y="186" text-anchor="middle" class="small">request</text>
  <path class="line" d="M140 143 H296" marker-end="url(#arr-rl-1)"/>
  <text x="218" y="135" text-anchor="middle" class="small">take 1 token</text>

  <rect class="box ok" x="580" y="70" width="180" height="44" rx="8"/>
  <text x="670" y="97" text-anchor="middle" class="title">allowed</text>
  <rect class="box bad" x="560" y="160" width="200" height="56" rx="8"/>
  <text x="660" y="184" text-anchor="middle" class="title">429 Too Many Requests</text>
  <text x="660" y="203" text-anchor="middle" class="small">Retry-After: 1</text>
  <path class="line ok" d="M480 110 L578 92" marker-end="url(#arr-rl-1)"/>
  <text x="528" y="92" text-anchor="middle" class="small">got one</text>
  <path class="line bad" d="M480 170 L558 186" marker-end="url(#arr-rl-1)"/>
  <text x="520" y="200" text-anchor="middle" class="small">empty</text>
</svg>
<figcaption>Token bucket with rate 10/s and burst 20. A quiet client saves up tokens and can burst; a constant flood is held to the refill rate.</figcaption>
</figure>

<h3>Why simple counters aren't enough: the window boundary</h3>
<p>The easiest implementation counts requests per calendar minute (<strong>fixed window</strong>). Its flaw: a client can send the whole quota at the end of one minute and again at the start of the next.</p>
<figure class="diagram">
<svg viewBox="0 0 780 192" role="img" aria-label="Fixed windows with a limit of 100 per minute: 100 requests at 12:00:59 and 100 at 12:01:01 fall into different windows, so 200 requests in 2 seconds are all allowed. A sliding window counting the last 60 seconds at 12:01:01 sees 200 and rejects the second burst.">
  <defs><marker id="arr-rl-2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <text x="390" y="22" text-anchor="middle" class="small">Fixed window: 100 at 12:00:59 + 100 at 12:01:01 = 200 requests in 2 seconds, all allowed</text>
  <rect class="box muted" x="60" y="36" width="340" height="74" rx="4"/>
  <rect class="box muted" x="400" y="36" width="340" height="74" rx="4"/>
  <text x="72" y="56" class="small">window 12:00 · limit 100</text>
  <text x="452" y="56" class="small">window 12:01 · limit 100</text>
  <rect class="box bad" x="374" y="62" width="22" height="48" rx="2"/>
  <rect class="box bad" x="404" y="62" width="22" height="48" rx="2"/>
  <text x="366" y="82" text-anchor="end" class="small">100 req</text>
  <text x="434" y="82" class="small">100 req</text>
  <text x="60" y="128" class="small">12:00:00</text>
  <text x="400" y="128" text-anchor="middle" class="small">12:01:00</text>
  <text x="740" y="128" text-anchor="end" class="small">12:02:00</text>
  <path class="line accent dashed" d="M70 150 H426" marker-end="url(#arr-rl-2)" marker-start="url(#arr-rl-2)"/>
  <text x="248" y="172" text-anchor="middle" class="small">sliding window at 12:01:01 counts the last 60 s: 200 &gt; 100, second burst rejected</text>
</svg>
<figcaption>Fixed windows allow up to twice the limit around the boundary. Sliding windows and token buckets don't.</figcaption>
</figure>

<h2>Algorithms compared</h2>
<table>
  <tr><th>Algorithm</th><th>How it works</th><th>Bursts</th><th>State per key</th><th>Seen in</th></tr>
  <tr><td>Fixed window</td><td>count requests per calendar window</td><td>up to 2× at window edges</td><td>1 counter</td><td>Redis <code>INCR</code> + <code>EXPIRE</code>, simple quotas</td></tr>
  <tr><td>Sliding window log</td><td>store a timestamp per request, count the last N seconds</td><td>none, exact</td><td>one entry per request</td><td>Redis sorted sets; precise but memory-hungry</td></tr>
  <tr><td>Sliding window counter</td><td>current window + previous window weighted by overlap</td><td>smoothed, approximate</td><td>2 counters</td><td>large-scale edges (Cloudflare has written about using it)</td></tr>
  <tr><td>Token bucket</td><td>tokens refill at rate <em>r</em> up to capacity <em>b</em>; each request spends one</td><td>allowed up to <em>b</em></td><td>tokens + last refill time</td><td>Go's <code>x/time/rate</code>, AWS API Gateway throttling</td></tr>
  <tr><td>Leaky bucket</td><td>requests queue and drain at a fixed rate</td><td>smoothed into a steady flow (adds delay)</td><td>queue / next-allowed time</td><td>nginx <code>limit_req</code></td></tr>
</table>
<p>A related variant, <strong>GCRA</strong>, gives token-bucket behaviour while storing a single timestamp per key, which is handy in Redis.</p>

<h3>Where to limit, and by what key</h3>
<ul>
  <li><strong>At the edge</strong> (CDN, WAF, load balancer): coarse per-IP limits that stop floods before they reach you.</li>
  <li><strong>At the <a href="#api-gateways">API gateway</a></strong>: per API key or plan ("free: 60/min, pro: 1,000/min").</li>
  <li><strong>In the service</strong>: per user or per expensive operation, where you know the real cost.</li>
  <li><strong>On the way out</strong>: limit your own calls to a fragile dependency or a third-party API with its own quota.</li>
</ul>
<p>Choose the key carefully: per-IP punishes offices and mobile carriers where thousands of users share one address; per-user or per-API-key is fairer once requests are authenticated.</p>

<h2>Example</h2>
<p><strong>Per-API-key token bucket middleware in Go</strong>, using <code>golang.org/x/time/rate</code>. It returns an accurate <code>Retry-After</code> instead of a guess:</p>
<pre><code>type client struct {
	limiter  *rate.Limiter
	lastSeen time.Time
}

type RateLimiter struct {
	mu      sync.Mutex
	clients map[string]*client
	rate    rate.Limit // tokens added per second
	burst   int        // bucket capacity
}

func NewRateLimiter(perSecond float64, burst int) *RateLimiter {
	rl := &amp;RateLimiter{clients: map[string]*client{}, rate: rate.Limit(perSecond), burst: burst}
	go rl.forgetIdle()
	return rl
}

func (rl *RateLimiter) limiter(key string) *rate.Limiter {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	c, ok := rl.clients[key]
	if !ok {
		c = &amp;client{limiter: rate.NewLimiter(rl.rate, rl.burst)}
		rl.clients[key] = c
	}
	c.lastSeen = time.Now()
	return c.limiter
}

// Drop clients idle for 10 minutes so the map doesn't grow forever.
func (rl *RateLimiter) forgetIdle() {
	for range time.Tick(time.Minute) {
		rl.mu.Lock()
		for key, c := range rl.clients {
			if time.Since(c.lastSeen) &gt; 10*time.Minute {
				delete(rl.clients, key)
			}
		}
		rl.mu.Unlock()
	}
}

func (rl *RateLimiter) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := r.Header.Get("X-API-Key") // per customer, not per IP
		if key == "" {
			http.Error(w, "missing API key", http.StatusUnauthorized)
			return
		}
		res := rl.limiter(key).Reserve()
		if wait := res.Delay(); wait &gt; 0 {
			res.Cancel() // we're rejecting, so give the token back
			w.Header().Set("Retry-After", strconv.Itoa(int(math.Ceil(wait.Seconds()))))
			http.Error(w, "rate limit exceeded", http.StatusTooManyRequests)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// 10 requests/second steady, bursts up to 20:
// http.ListenAndServe(":8080", NewRateLimiter(10, 20).Middleware(api))</code></pre>

<p><strong>Several instances?</strong> Each one above keeps its own counters, so with 4 instances a client effectively gets 4× the limit. Share the count in Redis. A fixed window is two commands:</p>
<pre><code>// One counter per key per minute, shared by every instance.
func Allow(ctx context.Context, rdb *redis.Client, key string, limit int64) (bool, error) {
	window := time.Now().Unix() / 60
	k := fmt.Sprintf("ratelimit:%s:%d", key, window)

	pipe := rdb.TxPipeline() // INCR and EXPIRE in one round trip
	count := pipe.Incr(ctx, k)
	pipe.Expire(ctx, k, 2*time.Minute)
	if _, err := pipe.Exec(ctx); err != nil {
		return true, err // fail open: a Redis outage shouldn't take the API down
	}
	return count.Val() &lt;= limit, nil
}</code></pre>

<p>What a client sees:</p>
<pre><code>$ for i in $(seq 1 25); do curl -s -o /dev/null -w '%{http_code} ' -H 'X-API-Key: demo' localhost:8080/orders; done
200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 429 429 429 429 429

$ curl -si -H 'X-API-Key: demo' localhost:8080/orders | head -3
HTTP/1.1 429 Too Many Requests
Content-Type: text/plain; charset=utf-8
Retry-After: 1</code></pre>

<p><strong>Real-world scenario.</strong> A partner's integration had a bug that retried every failed call immediately, in a loop, from 50 servers. Within minutes it was sending 8,000 requests per second, the database was saturated, and every other customer saw timeouts. With per-API-key limits at the gateway, that partner would have received 429s after their quota, the other customers wouldn't have noticed, and the partner's logs would have shown exactly what was wrong. Separately, the <code>/login</code> endpoint gets a strict per-IP and per-account limit (say 5 attempts per minute) to blunt credential stuffing.</p>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>Limiting by the wrong IP.</strong> Behind a load balancer, <code>RemoteAddr</code> is the load balancer, so everyone shares one bucket. Use the client IP from <code>X-Forwarded-For</code>, but only as set by your own proxy (see <a href="#reverse-proxies">Reverse Proxies</a>), or attackers will spoof it.</li>
  <li><strong>Per-instance counters.</strong> Limits multiply with instance count and shift during autoscaling. Use a shared store for anything that matters.</li>
  <li><strong>No <code>Retry-After</code>.</strong> Clients then retry immediately and make the overload worse. Tell them when, and expect well-behaved clients to back off with jitter (see <a href="#exponential-backoff">Exponential Backoff</a>).</li>
  <li><strong>All requests aren't equal.</strong> A search that scans millions of rows shouldn't cost the same as reading a profile. Weight expensive endpoints, or give them their own limits.</li>
  <li><strong>Fail open or fail closed?</strong> If Redis is down, rejecting everything takes your API down with it; allowing everything removes protection. Most APIs fail open with a local fallback limit, and alert.</li>
  <li><strong>Rate limits aren't load shedding.</strong> They cap each client, not total load. 10,000 well-behaved clients can still overload you; pair limits with concurrency limits and <a href="#backpressure">backpressure</a>.</li>
  <li><strong>Undocumented limits.</strong> Publish them and expose remaining quota (many APIs send <code>X-RateLimit-Limit</code>, <code>-Remaining</code>, <code>-Reset</code> headers) so clients can pace themselves.</li>
</ul>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>Rate limiting = a counter per key + an algorithm + a <code>429</code> with <code>Retry-After</code>.</li>
  <li>Token bucket is the usual default: steady rate, bounded bursts. Fixed windows allow 2× bursts at edges.</li>
  <li>Limit in layers (edge per IP, gateway per key, service per cost), with keys that match who should share a quota.</li>
  <li>With multiple instances, share counters (Redis) and decide up front whether to fail open or closed.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#api-gateways">API Gateways</a> · <a href="#load-balancing">Load Balancing</a> · <a href="#backpressure">Backpressure</a> · <a href="#exponential-backoff">Exponential Backoff</a> · <a href="#ddos-protection">DDoS Protection</a> · <a href="#real-world-traffic-stack">Real-World Traffic Stack</a></p>
`;


CONTENT["load-balancing"] = `
<p class="tldr"><strong>TL;DR</strong>: A load balancer sits in front of several copies of a service and spreads incoming traffic across them, skipping any copy that's unhealthy. Clients see one address; behind it you can add, remove, and restart servers freely. It's the host at a busy restaurant, seating each new guest at a table that's free.</p>

<h2>The problem it solves</h2>
<ul>
  <li><strong>One server isn't enough</strong>: to handle more traffic you run many copies (<a href="#horizontal-scaling">horizontal scaling</a>), and something has to split the work.</li>
  <li><strong>Servers fail</strong>: a crashed or overloaded instance must stop receiving traffic automatically, without clients noticing.</li>
  <li><strong>Deploys and scaling</strong>: instances come and go all day; clients shouldn't need to know their addresses.</li>
</ul>
<p>A load balancer gives clients one stable endpoint and turns a fleet of interchangeable servers into one reliable service.</p>

<h2>How it works</h2>
<ol>
  <li>Clients connect to the load balancer's address (often found through <a href="#dns">DNS</a>).</li>
  <li>For each new connection (layer 4) or request (layer 7), it <strong>picks a backend</strong> with an algorithm: round robin, least connections, and so on.</li>
  <li>It <strong>health-checks</strong> every backend (e.g. <code>GET /healthz</code> every few seconds) and only sends traffic to healthy ones. It can also notice failures passively, from errors in real traffic.</li>
  <li>When a backend is being removed, it <strong>drains</strong> it: no new requests, but in-flight ones may finish.</li>
</ol>

<figure class="diagram">
<svg viewBox="0 0 780 262" role="img" aria-label="Clients send requests to one load balancer address. The load balancer spreads them across server 1 and server 2 using round robin; server 3 fails its health check and receives no traffic.">
  <defs><marker id="arr-lb-1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <rect class="box" x="20" y="60" width="110" height="34" rx="8"/><text x="75" y="82" text-anchor="middle">client</text>
  <rect class="box" x="20" y="114" width="110" height="34" rx="8"/><text x="75" y="136" text-anchor="middle">client</text>
  <rect class="box" x="20" y="168" width="110" height="34" rx="8"/><text x="75" y="190" text-anchor="middle">client</text>
  <path class="line" d="M130 77 L228 120 M130 131 H228 M130 185 L228 142"/>
  <rect class="box accent" x="230" y="96" width="170" height="70" rx="10"/>
  <text x="315" y="122" text-anchor="middle" class="title">Load balancer</text>
  <text x="315" y="140" text-anchor="middle" class="small">api.example.com</text>
  <text x="315" y="156" text-anchor="middle" class="small">round robin</text>

  <rect class="box ok" x="560" y="30" width="200" height="50" rx="10"/>
  <text x="660" y="52" text-anchor="middle" class="title">server 1</text><text x="660" y="70" text-anchor="middle" class="small">healthy: requests 1, 3, 5…</text>
  <rect class="box ok" x="560" y="106" width="200" height="50" rx="10"/>
  <text x="660" y="128" text-anchor="middle" class="title">server 2</text><text x="660" y="146" text-anchor="middle" class="small">healthy: requests 2, 4, 6…</text>
  <rect class="box bad" x="560" y="182" width="200" height="50" rx="10"/>
  <text x="660" y="204" text-anchor="middle" class="title">server 3</text><text x="660" y="222" text-anchor="middle" class="small">failed /healthz: no traffic</text>
  <path class="line ok" d="M400 115 L558 58" marker-end="url(#arr-lb-1)"/>
  <path class="line ok" d="M400 131 H558" marker-end="url(#arr-lb-1)"/>
  <path class="line bad dashed" d="M400 150 L558 205"/>
  <text x="478" y="198" text-anchor="middle" class="small">✗ skipped</text>
  <text x="315" y="250" text-anchor="middle" class="small">health check every few seconds: GET /healthz on each server</text>
</svg>
<figcaption>Clients only know the load balancer. Failed servers drop out automatically and rejoin when their health checks pass again.</figcaption>
</figure>

<h3>Layer 4 vs layer 7</h3>
<figure class="diagram">
<svg viewBox="0 0 780 238" role="img" aria-label="Layer 4 load balancers see only IP addresses and ports and pick a backend per TCP connection. Layer 7 load balancers see HTTP: path, headers and cookies, and can route each request, for example /api to the API pool and /images to the static pool.">
  <defs><marker id="arr-lb-2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <text x="195" y="22" text-anchor="middle" class="title">Layer 4 (TCP/UDP)</text>
  <text x="590" y="22" text-anchor="middle" class="title">Layer 7 (HTTP)</text>
  <path class="line" d="M390 10 V230" style="stroke: var(--line)"/>
  <rect class="box muted" x="20" y="40" width="350" height="46" rx="8"/>
  <text x="195" y="60" text-anchor="middle" class="small">sees: 203.0.113.7:51234 → 10.0.0.5:443</text>
  <text x="195" y="77" text-anchor="middle" class="small">(encrypted bytes; no idea what's inside)</text>
  <rect class="box accent" x="120" y="104" width="150" height="40" rx="8"/><text x="195" y="129" text-anchor="middle">L4 LB</text>
  <path class="line" d="M170 144 L80 186 M195 144 V186 M220 144 L310 186" />
  <rect class="box" x="30" y="188" width="100" height="32" rx="6"/><text x="80" y="209" text-anchor="middle" class="small">server</text>
  <rect class="box" x="145" y="188" width="100" height="32" rx="6"/><text x="195" y="209" text-anchor="middle" class="small">server</text>
  <rect class="box" x="260" y="188" width="100" height="32" rx="6"/><text x="310" y="209" text-anchor="middle" class="small">server</text>

  <rect class="box muted" x="410" y="40" width="360" height="46" rx="8"/>
  <text x="590" y="60" text-anchor="middle" class="small">sees: GET /api/orders, Host, cookies, headers</text>
  <text x="590" y="77" text-anchor="middle" class="small">(terminates TLS to read the request)</text>
  <rect class="box accent" x="515" y="104" width="150" height="40" rx="8"/><text x="590" y="129" text-anchor="middle">L7 LB</text>
  <path class="line" d="M560 144 L490 186" marker-end="url(#arr-lb-2)"/>
  <path class="line" d="M620 144 L690 186" marker-end="url(#arr-lb-2)"/>
  <text x="500" y="168" text-anchor="end" class="small">/api/*</text>
  <text x="680" y="168" class="small">/images/*</text>
  <rect class="box" x="420" y="188" width="140" height="32" rx="6"/><text x="490" y="209" text-anchor="middle" class="small">API servers</text>
  <rect class="box" x="620" y="188" width="140" height="32" rx="6"/><text x="690" y="209" text-anchor="middle" class="small">static servers</text>
</svg>
<figcaption>L4 is fast and protocol-agnostic but balances whole connections. L7 understands HTTP, so it can route by path or header, retry, and balance per request.</figcaption>
</figure>
<p>On AWS, the Network Load Balancer is layer 4 and the Application Load Balancer is layer 7; nginx, HAProxy and Envoy can do both.</p>

<h2>Balancing algorithms</h2>
<table>
  <tr><th>Algorithm</th><th>How it picks</th><th>Good for</th><th>Watch out</th></tr>
  <tr><td>Round robin</td><td>next server in turn</td><td>identical servers, similar requests</td><td>ignores load: a slow server still gets its turn</td></tr>
  <tr><td>Weighted round robin</td><td>bigger servers get proportionally more</td><td>mixed instance sizes, canary at 5%</td><td>weights need maintaining</td></tr>
  <tr><td>Least connections / requests</td><td>server with the fewest in flight</td><td>uneven request durations</td><td>needs live counts; a fast-failing server looks "free"</td></tr>
  <tr><td>Power of two choices</td><td>pick 2 at random, send to the less busy one</td><td>large fleets, many load balancers</td><td>slightly random, but avoids herding</td></tr>
  <tr><td>Hash (IP, user, key)</td><td>same key → same server</td><td>caches, session affinity</td><td>hot keys; reshuffles when servers change (use consistent hashing)</td></tr>
</table>

<h2>Example</h2>
<p><strong>A tiny round-robin load balancer in Go</strong> with active health checks, built on the standard library's reverse proxy:</p>
<pre><code>type Backend struct {
	URL     *url.URL
	proxy   *httputil.ReverseProxy
	healthy atomic.Bool
}

type LoadBalancer struct {
	backends []*Backend
	next     atomic.Uint64
}

func NewLoadBalancer(urls ...string) *LoadBalancer {
	lb := &amp;LoadBalancer{}
	for _, raw := range urls {
		u, err := url.Parse(raw)
		if err != nil {
			log.Fatal(err)
		}
		b := &amp;Backend{URL: u, proxy: httputil.NewSingleHostReverseProxy(u)}
		b.healthy.Store(true)
		lb.backends = append(lb.backends, b)
	}
	return lb
}

// Round robin, skipping unhealthy backends.
func (lb *LoadBalancer) pick() *Backend {
	n := uint64(len(lb.backends))
	for range n {
		b := lb.backends[lb.next.Add(1)%n]
		if b.healthy.Load() {
			return b
		}
	}
	return nil
}

func (lb *LoadBalancer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	b := lb.pick()
	if b == nil {
		http.Error(w, "no healthy backend", http.StatusServiceUnavailable)
		return
	}
	b.proxy.ServeHTTP(w, r)
}

// Active health checks. Real load balancers also require N failures in a row.
func (lb *LoadBalancer) HealthCheck(ctx context.Context, every time.Duration) {
	client := &amp;http.Client{Timeout: 2 * time.Second}
	ticker := time.NewTicker(every)
	defer ticker.Stop()
	for {
		for _, b := range lb.backends {
			resp, err := client.Get(b.URL.String() + "/healthz")
			ok := err == nil &amp;&amp; resp.StatusCode == http.StatusOK
			if resp != nil {
				resp.Body.Close()
			}
			if ok != b.healthy.Load() {
				log.Printf("%s healthy=%v", b.URL, ok)
			}
			b.healthy.Store(ok)
		}
		select {
		case &lt;-ticker.C:
		case &lt;-ctx.Done():
			return
		}
	}
}

func main() {
	lb := NewLoadBalancer("http://10.0.1.10:8080", "http://10.0.1.11:8080", "http://10.0.1.12:8080")
	go lb.HealthCheck(context.Background(), 5*time.Second)
	log.Fatal(http.ListenAndServe(":80", lb))
}</code></pre>
<p>Kill one backend and watch requests keep succeeding once the next health check marks it down. Real load balancers add thresholds (e.g. AWS ALB checks every 30 seconds by default and needs 2 consecutive failures to mark a target unhealthy), passive failure detection, retries and connection draining.</p>

<p><strong>Real-world scenario: the deploy that dropped requests.</strong> A team's rolling deploy caused a burst of 502s every time. The new pods were fine; the problem was the old ones. Kubernetes sent SIGTERM and the app exited immediately, while the load balancer was still routing requests to it for a few more seconds. The fix: on SIGTERM, first fail the readiness check and keep serving for a short grace period so the load balancer stops sending new requests, then finish in-flight ones and exit. Load balancers call this <strong>connection draining</strong> or a <em>deregistration delay</em> (300 seconds by default on AWS target groups).</p>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>Sticky sessions fight balancing.</strong> Pinning users to a server (for in-memory sessions) breaks even distribution and loses sessions when that server dies. Keep servers stateless and put sessions in a shared store.</li>
  <li><strong>Long-lived connections stay put.</strong> WebSockets, gRPC and HTTP/2 hold one connection for a long time, so an L4 balancer can't rebalance them, and new servers sit idle (see <a href="#grpc">gRPC</a>).</li>
  <li><strong>Health checks that check too little or too much.</strong> "Process is up" misses a broken database connection; a check that calls every dependency can mark <em>all</em> servers unhealthy when one shared dependency blips. Check what this instance needs to serve traffic.</li>
  <li><strong>New servers get flattened.</strong> A cold instance (empty caches, JIT warming up) receiving a full share immediately can fall over. Use slow-start or ramp-up weights.</li>
  <li><strong>Retries at the load balancer amplify load.</strong> Retrying failed requests on another server helps for one bad instance, but during overload it multiplies traffic. Retry only idempotent requests, with a budget (see <a href="#retries">Retries</a>).</li>
  <li><strong>The load balancer itself is a single point of failure.</strong> Managed cloud load balancers are redundant across zones; self-hosted ones need a pair with failover.</li>
</ul>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>A load balancer = one address in front of many servers + an algorithm + health checks + draining.</li>
  <li>L4 balances connections and is protocol-agnostic; L7 understands HTTP and balances requests.</li>
  <li>Keep backends stateless, health checks meaningful, and drain servers before stopping them.</li>
  <li>Beware long-lived connections, retry storms, and cold servers.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#reverse-proxies">Reverse Proxies</a> · <a href="#health-checks">Health Checks</a> · <a href="#horizontal-scaling">Horizontal Scaling</a> · <a href="#service-discovery">Service Discovery</a> · <a href="#grpc">gRPC</a> · <a href="#real-world-traffic-stack">Real-World Traffic Stack</a></p>
`;


CONTENT["reverse-proxies"] = `
<p class="tldr"><strong>TL;DR</strong>: A reverse proxy is a server that stands in front of your application servers and receives every request on their behalf, then forwards it to the right one. Clients think they're talking to your app; they're actually talking to nginx, HAProxy, Envoy, Caddy or Traefik, which handles TLS, routing, buffering, caching and more, so your app doesn't have to.</p>

<h2>The problem it solves</h2>
<p>Exposing application servers directly to the internet means each one must handle TLS certificates, slow or malicious clients, compression, static files, request limits and routing between services. A reverse proxy does all of that once, in one hardened place:</p>
<ul>
  <li><strong>One front door</strong> for many backends: <code>api.example.com/orders</code> and <code>/users</code> can live on different services.</li>
  <li><strong>Protection</strong>: the app's real addresses stay private, and the proxy absorbs slow clients (it buffers a slow upload, then hands the app the full request in one go).</li>
  <li><strong>Offloading</strong>: TLS, compression and caching use battle-tested C code instead of your app's CPU.</li>
</ul>

<h2>How it works</h2>
<p>A <strong>forward</strong> proxy works for <em>clients</em> (a company proxy that all employees' traffic goes through). A <strong>reverse</strong> proxy works for <em>servers</em>: the client connects to the proxy, which opens its own connection to a backend, forwards the request, and relays the response back.</p>

<figure class="diagram">
<svg viewBox="0 0 780 214" role="img" aria-label="Forward proxy: several clients go through one proxy to reach many internet sites; it acts for the clients. Reverse proxy: many internet clients reach one proxy that forwards to several backend servers; it acts for the servers.">
  <defs><marker id="arr-rp-1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <text x="195" y="22" text-anchor="middle" class="title">Forward proxy (for clients)</text>
  <text x="590" y="22" text-anchor="middle" class="title">Reverse proxy (for servers)</text>
  <path class="line" d="M390 10 V206" style="stroke: var(--line)"/>
  <rect class="box" x="20" y="50" width="90" height="30" rx="6"/><text x="65" y="70" text-anchor="middle" class="small">laptop</text>
  <rect class="box" x="20" y="100" width="90" height="30" rx="6"/><text x="65" y="120" text-anchor="middle" class="small">laptop</text>
  <rect class="box" x="20" y="150" width="90" height="30" rx="6"/><text x="65" y="170" text-anchor="middle" class="small">laptop</text>
  <rect class="box accent" x="150" y="92" width="100" height="46" rx="8"/><text x="200" y="120" text-anchor="middle">proxy</text>
  <path class="line" d="M110 65 L148 105 M110 115 H148 M110 165 L148 125"/>
  <rect class="box muted" x="280" y="50" width="95" height="30" rx="6"/><text x="327" y="70" text-anchor="middle" class="small">site A</text>
  <rect class="box muted" x="280" y="100" width="95" height="30" rx="6"/><text x="327" y="120" text-anchor="middle" class="small">site B</text>
  <rect class="box muted" x="280" y="150" width="95" height="30" rx="6"/><text x="327" y="170" text-anchor="middle" class="small">site C</text>
  <path class="line" d="M250 105 L278 65 M250 115 H278 M250 125 L278 165"/>
  <text x="195" y="202" text-anchor="middle" class="small">company network: filtering, caching, one exit IP</text>

  <rect class="box muted" x="410" y="50" width="95" height="30" rx="6"/><text x="457" y="70" text-anchor="middle" class="small">user</text>
  <rect class="box muted" x="410" y="100" width="95" height="30" rx="6"/><text x="457" y="120" text-anchor="middle" class="small">user</text>
  <rect class="box muted" x="410" y="150" width="95" height="30" rx="6"/><text x="457" y="170" text-anchor="middle" class="small">user</text>
  <rect class="box accent" x="545" y="92" width="100" height="46" rx="8"/><text x="595" y="120" text-anchor="middle">proxy</text>
  <path class="line" d="M505 65 L543 105 M505 115 H543 M505 165 L543 125"/>
  <rect class="box" x="675" y="50" width="90" height="30" rx="6"/><text x="720" y="70" text-anchor="middle" class="small">orders</text>
  <rect class="box" x="675" y="100" width="90" height="30" rx="6"/><text x="720" y="120" text-anchor="middle" class="small">users</text>
  <rect class="box" x="675" y="150" width="90" height="30" rx="6"/><text x="720" y="170" text-anchor="middle" class="small">static</text>
  <path class="line" d="M645 105 L673 65 M645 115 H673 M645 125 L673 165"/>
  <text x="590" y="202" text-anchor="middle" class="small">your servers stay private behind one address</text>
</svg>
<figcaption>Same machinery, opposite sides. This concept is about the right-hand one.</figcaption>
</figure>

<h3>What a reverse proxy typically does</h3>
<figure class="diagram">
<svg viewBox="0 0 780 300" role="img" aria-label="Mindmap: a reverse proxy in the center, with TLS termination, routing by host and path, load balancing, caching, compression, buffering slow clients, request limits and timeouts, header handling with X-Forwarded-For, and serving static files.">
  <path class="line" d="M390 150 L150 50 M390 150 L150 150 M390 150 L150 250 M390 150 L630 50 M390 150 L630 150 M390 150 L630 250 M390 150 L390 40 M390 150 L390 262"/>
  <rect class="box accent" x="300" y="122" width="180" height="56" rx="12"/>
  <text x="390" y="148" text-anchor="middle" class="title">Reverse proxy</text>
  <text x="390" y="166" text-anchor="middle" class="small">nginx · HAProxy · Envoy · Caddy</text>
  <rect class="box" x="300" y="14" width="180" height="40" rx="8"/><text x="390" y="32" text-anchor="middle" class="title">TLS termination</text><text x="390" y="47" text-anchor="middle" class="small">certificates in one place</text>
  <rect class="box" x="300" y="246" width="180" height="40" rx="8"/><text x="390" y="264" text-anchor="middle" class="title">Static files</text><text x="390" y="279" text-anchor="middle" class="small">served without the app</text>
  <rect class="box" x="30" y="30" width="200" height="40" rx="8"/><text x="130" y="48" text-anchor="middle" class="title">Routing</text><text x="130" y="63" text-anchor="middle" class="small">by host and path</text>
  <rect class="box" x="30" y="130" width="200" height="40" rx="8"/><text x="130" y="148" text-anchor="middle" class="title">Load balancing</text><text x="130" y="163" text-anchor="middle" class="small">across backend copies</text>
  <rect class="box" x="30" y="230" width="200" height="40" rx="8"/><text x="130" y="248" text-anchor="middle" class="title">Caching + compression</text><text x="130" y="263" text-anchor="middle" class="small">gzip / brotli, cached responses</text>
  <rect class="box" x="550" y="30" width="200" height="40" rx="8"/><text x="650" y="48" text-anchor="middle" class="title">Buffering</text><text x="650" y="63" text-anchor="middle" class="small">absorbs slow clients</text>
  <rect class="box" x="550" y="130" width="200" height="40" rx="8"/><text x="650" y="148" text-anchor="middle" class="title">Limits + timeouts</text><text x="650" y="163" text-anchor="middle" class="small">body size, rate, idle time</text>
  <rect class="box" x="550" y="230" width="200" height="40" rx="8"/><text x="650" y="248" text-anchor="middle" class="title">Headers</text><text x="650" y="263" text-anchor="middle" class="small">X-Forwarded-For / -Proto</text>
</svg>
<figcaption>A load balancer and an API gateway are both specialised reverse proxies: one focuses on spreading load, the other on API concerns like auth and quotas.</figcaption>
</figure>

<h3>The forwarded headers</h3>
<p>The backend's TCP connection comes from the proxy, so it would see the proxy's IP and plain HTTP. The proxy passes the original details in headers: <code>X-Forwarded-For</code> (client IP, plus any earlier proxies), <code>X-Forwarded-Proto</code> (<code>https</code>), <code>X-Forwarded-Host</code>, or the standardised <code>Forwarded</code> header (RFC 7239). Your app should trust these <strong>only when the request came from your proxy</strong>.</p>

<table>
  <tr><th>Tool</th><th>Known for</th></tr>
  <tr><td>nginx</td><td>the classic: fast static files, TLS, caching, huge ecosystem</td></tr>
  <tr><td>HAProxy</td><td>high-performance L4/L7 load balancing, detailed stats</td></tr>
  <tr><td>Envoy</td><td>dynamic config via API (xDS); the data plane of most service meshes and many gateways</td></tr>
  <tr><td>Caddy</td><td>automatic HTTPS certificates out of the box, simple config</td></tr>
  <tr><td>Traefik</td><td>discovers routes from Docker/Kubernetes labels automatically</td></tr>
</table>

<h2>Example</h2>
<p><strong>nginx in front of two app instances</strong>: TLS, static files, upstream keepalive, forwarded headers, limits:</p>
<pre><code>upstream app {
  server 10.0.1.10:8080;
  server 10.0.1.11:8080;
  keepalive 32;                        # reuse connections to the app
}

server {
  listen 443 ssl;
  server_name api.example.com;
  ssl_certificate     /etc/ssl/api.crt;
  ssl_certificate_key /etc/ssl/api.key;

  client_max_body_size 10m;            # reject huge uploads at the door
  gzip on;

  location /static/ {
    root /var/www;                     # served by nginx, never reaches the app
    expires 7d;
  }

  location / {
    proxy_pass http://app;
    proxy_http_version 1.1;
    proxy_set_header Connection "";    # required for upstream keepalive
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 30s;            # keep the app's own timeout below this
  }
}</code></pre>

<p><strong>The same idea in Go</strong> with <code>httputil.ReverseProxy</code>. <code>SetXForwarded</code> adds the forwarded headers correctly:</p>
<pre><code>func main() {
	app, err := url.Parse("http://127.0.0.1:8080")
	if err != nil {
		log.Fatal(err)
	}
	proxy := &amp;httputil.ReverseProxy{
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.SetURL(app)     // send to the app, keep the path and query
			pr.SetXForwarded() // X-Forwarded-For, -Host, -Proto
		},
	}
	srv := &amp;http.Server{
		Addr:              ":443",
		Handler:           proxy,
		ReadHeaderTimeout: 5 * time.Second, // slow-header (slowloris) protection
	}
	log.Fatal(srv.ListenAndServeTLS("api.crt", "api.key"))
}</code></pre>

<p><strong>On the app side</strong>, find the real client IP without letting clients spoof it. Clients can send any <code>X-Forwarded-For</code> they like; only the entries added by <em>your</em> proxies are trustworthy, so read from the right:</p>
<pre><code>// trusted reports whether an address belongs to our own proxies / load balancers.
func ClientIP(r *http.Request, trusted func(netip.Addr) bool) string {
	host, _, _ := net.SplitHostPort(r.RemoteAddr)
	peer, err := netip.ParseAddr(host)
	if err != nil || !trusted(peer) {
		return host // not from our proxy: ignore X-Forwarded-For entirely
	}
	hops := strings.Split(r.Header.Get("X-Forwarded-For"), ",")
	for i := len(hops) - 1; i &gt;= 0; i-- { // right to left: nearest proxy first
		addr, err := netip.ParseAddr(strings.TrimSpace(hops[i]))
		if err != nil {
			break
		}
		if !trusted(addr) {
			return addr.String() // first address our proxies didn't add = the client
		}
	}
	return host
}</code></pre>

<p><strong>Real-world scenario: everyone was rate-limited at once.</strong> After moving an app behind a new proxy, the per-IP rate limiter started rejecting <em>everyone</em>. Every request now came from the proxy's IP, so all users shared one bucket. The first "fix", trusting <code>X-Forwarded-For</code> blindly, let attackers bypass the limit by sending a fake header with a random IP each time. The real fix: trust the header only from the proxy's address, and take the rightmost untrusted entry.</p>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>Blindly trusting forwarded headers.</strong> Anyone can send <code>X-Forwarded-For: 1.2.3.4</code>. Only honour it from known proxy addresses, or IP-based limits and audit logs become fiction.</li>
  <li><strong>Timeouts that don't line up.</strong> If the proxy gives up after 60 s but the app keeps working for 120 s, users see a 504 while the work still happens. Set the app's timeout below the proxy's (see <a href="#timeouts">Timeouts</a>).</li>
  <li><strong>Buffering breaks streaming.</strong> Response buffering is great for normal requests but turns SSE and long responses into one late blob (see <a href="#server-sent-events">Server-Sent Events</a>).</li>
  <li><strong>No upstream keepalive.</strong> By default nginx opens a new connection to the backend for every request. Enable <code>keepalive</code> on the upstream, or you pay connection setup each time and can run out of ports.</li>
  <li><strong>Request smuggling.</strong> If proxy and backend disagree about where a request ends (<code>Content-Length</code> vs <code>Transfer-Encoding</code>), an attacker can hide a second request inside the first. Keep proxies patched and reject ambiguous requests.</li>
  <li><strong>Another hop, another thing to run.</strong> A self-hosted proxy needs redundancy, monitoring and config management of its own.</li>
</ul>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>A reverse proxy receives requests on behalf of your servers and forwards them: one hardened front door.</li>
  <li>It centralises TLS, routing, buffering, compression, caching, limits and timeouts.</li>
  <li>Forwarded headers carry the client's IP and scheme; trust them only from your own proxies.</li>
  <li>Align timeouts, enable upstream keepalive, and turn off buffering for streaming endpoints.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#load-balancing">Load Balancing</a> · <a href="#api-gateways">API Gateways</a> · <a href="#tls">TLS</a> · <a href="#caching">Caching</a> · <a href="#rate-limiting">Rate Limiting</a> · <a href="#real-world-traffic-stack">Real-World Traffic Stack</a></p>
`;


CONTENT["api-gateways"] = `
<p class="tldr"><strong>TL;DR</strong>: An API gateway is the single entry point for all your API clients. It routes each request to the right backend service and handles the cross-cutting chores every service would otherwise repeat: <strong>authentication, rate limits and quotas, request IDs, logging, transformations, CORS</strong>. Think of a hotel front desk: guests talk to one desk, which checks who they are and sends each request to the right department.</p>

<h2>The problem it solves</h2>
<p>Once a backend is split into many services, every client would have to know every service's address, and every service would have to re-implement the same edge logic:</p>
<ul>
  <li>Verifying JWTs or API keys, in 20 services, in 3 languages, with 20 chances to get it wrong.</li>
  <li>Per-customer quotas ("free plan: 1,000 calls/day") that only make sense across <em>all</em> services.</li>
  <li>Mobile apps making 6 calls to 6 services to render one screen over a slow network.</li>
  <li>Internal structure leaking out: rename or split a service and every client breaks.</li>
</ul>
<p>The gateway gives clients one stable API and gives teams one place for edge policy.</p>

<h2>How it works</h2>
<ol>
  <li>A request arrives at <code>api.example.com</code>.</li>
  <li>The gateway runs a pipeline of <strong>policies</strong>: assign a request ID, authenticate the caller, check rate limits and quotas, maybe validate or transform the request.</li>
  <li>It <strong>routes</strong> by path, host, header or version (<code>/v2/orders/*</code> → orders service) to a backend found via <a href="#service-discovery">service discovery</a>.</li>
  <li>It returns the response, possibly transformed, and records metrics and logs for every call.</li>
</ol>

<figure class="diagram">
<svg viewBox="0 0 780 290" role="img" aria-label="Web, mobile and partner clients call one API gateway. The gateway runs request ID, authentication, rate limiting, routing and logging, then forwards to the orders, payments and users services.">
  <defs><marker id="arr-gw-1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <rect class="box" x="20" y="50" width="120" height="36" rx="8"/><text x="80" y="73" text-anchor="middle">web app</text>
  <rect class="box" x="20" y="125" width="120" height="36" rx="8"/><text x="80" y="148" text-anchor="middle">mobile app</text>
  <rect class="box" x="20" y="200" width="120" height="36" rx="8"/><text x="80" y="223" text-anchor="middle">partner API</text>
  <path class="line" d="M140 68 L228 120" marker-end="url(#arr-gw-1)"/>
  <path class="line" d="M140 143 H228" marker-end="url(#arr-gw-1)"/>
  <path class="line" d="M140 218 L228 166" marker-end="url(#arr-gw-1)"/>

  <rect class="box accent" x="230" y="20" width="250" height="250" rx="12"/>
  <text x="355" y="46" text-anchor="middle" class="title">API gateway</text>
  <rect class="box" x="250" y="60" width="210" height="30" rx="6"/><text x="355" y="80" text-anchor="middle" class="small">1 request ID + access log</text>
  <rect class="box" x="250" y="98" width="210" height="30" rx="6"/><text x="355" y="118" text-anchor="middle" class="small">2 authenticate (JWT / API key)</text>
  <rect class="box" x="250" y="136" width="210" height="30" rx="6"/><text x="355" y="156" text-anchor="middle" class="small">3 rate limit + quota per plan</text>
  <rect class="box" x="250" y="174" width="210" height="30" rx="6"/><text x="355" y="194" text-anchor="middle" class="small">4 transform / validate</text>
  <rect class="box" x="250" y="212" width="210" height="30" rx="6"/><text x="355" y="232" text-anchor="middle" class="small">5 route by path / version</text>

  <rect class="box ok" x="590" y="50" width="170" height="40" rx="8"/><text x="675" y="75" text-anchor="middle">orders service</text>
  <rect class="box ok" x="590" y="125" width="170" height="40" rx="8"/><text x="675" y="150" text-anchor="middle">payments service</text>
  <rect class="box ok" x="590" y="200" width="170" height="40" rx="8"/><text x="675" y="225" text-anchor="middle">users service</text>
  <path class="line" d="M480 210 L588 72" marker-end="url(#arr-gw-1)"/>
  <path class="line" d="M480 222 L588 147" marker-end="url(#arr-gw-1)"/>
  <path class="line" d="M480 232 L588 220" marker-end="url(#arr-gw-1)"/>
  <text x="584" y="64" text-anchor="end" class="small">/orders/*</text>
  <text x="584" y="139" text-anchor="end" class="small">/payments/*</text>
  <text x="584" y="211" text-anchor="end" class="small">/users/*</text>
</svg>
<figcaption>Policies run once at the edge, in order; services receive requests that are already authenticated, limited and tagged with an ID.</figcaption>
</figure>

<h3>Common gateway features</h3>
<ul>
  <li><strong>Routing and versioning</strong>: path, host and header rules; <code>/v1</code> and <code>/v2</code> to different backends (see <a href="#api-versioning">API Versioning</a>).</li>
  <li><strong>Security</strong>: JWT validation, API keys, OAuth scopes, mTLS to backends, CORS, IP allow lists.</li>
  <li><strong>Traffic control</strong>: <a href="#rate-limiting">rate limits</a>, quotas and usage plans per customer, timeouts, retries, circuit breaking.</li>
  <li><strong>Transformation</strong>: header injection, request/response rewriting, REST → gRPC translation.</li>
  <li><strong>Aggregation</strong>: one call fans out to several services and merges the results. When each client type gets its own tailored gateway, that's the <em>Backend for Frontend</em> (BFF) pattern.</li>
  <li><strong>Observability</strong>: one place for access logs, latency metrics per route and customer, and trace headers.</li>
</ul>

<h3>Gateway, load balancer, reverse proxy, service mesh</h3>
<figure class="diagram">
<svg viewBox="0 0 780 232" role="img" aria-label="North-south traffic from the internet enters through the API gateway at the edge of the cluster. East-west traffic between services inside the cluster goes through service mesh sidecars next to each service.">
  <defs><marker id="arr-gw-2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <rect class="box" x="20" y="96" width="110" height="40" rx="8"/><text x="75" y="121" text-anchor="middle">internet</text>
  <rect class="box muted" x="170" y="14" width="590" height="206" rx="12"/>
  <text x="465" y="34" text-anchor="middle" class="small">your cluster / VPC</text>
  <rect class="box accent" x="190" y="90" width="130" height="52" rx="10"/>
  <text x="255" y="113" text-anchor="middle" class="title">API gateway</text>
  <text x="255" y="130" text-anchor="middle" class="small">north-south</text>
  <path class="line accent" d="M130 116 H188" marker-end="url(#arr-gw-2)"/>

  <rect class="box" x="390" y="54" width="150" height="48" rx="8"/><text x="465" y="76" text-anchor="middle">orders</text><text x="465" y="93" text-anchor="middle" class="small">+ sidecar proxy</text>
  <rect class="box" x="390" y="148" width="150" height="48" rx="8"/><text x="465" y="170" text-anchor="middle">payments</text><text x="465" y="187" text-anchor="middle" class="small">+ sidecar proxy</text>
  <rect class="box" x="600" y="100" width="150" height="48" rx="8"/><text x="675" y="122" text-anchor="middle">inventory</text><text x="675" y="139" text-anchor="middle" class="small">+ sidecar proxy</text>
  <path class="line accent" d="M320 110 L388 80" marker-end="url(#arr-gw-2)"/>
  <path class="line ok dashed" d="M465 102 V146" marker-end="url(#arr-gw-2)"/>
  <path class="line ok dashed" d="M540 82 L598 116" marker-end="url(#arr-gw-2)"/>
  <text x="560" y="210" text-anchor="middle" class="small">east-west traffic between services: the service mesh (Istio, Linkerd)</text>
</svg>
<figcaption>The gateway guards the edge (north-south); a service mesh handles service-to-service traffic (east-west). Many systems have both.</figcaption>
</figure>
<table>
  <tr><th>Component</th><th>Main job</th><th>Knows about</th><th>Examples</th></tr>
  <tr><td>Load balancer</td><td>spread traffic across copies of one service</td><td>connections or requests, health</td><td>AWS ALB/NLB, HAProxy</td></tr>
  <tr><td>Reverse proxy</td><td>front door: TLS, routing, buffering, caching</td><td>HTTP</td><td>nginx, Caddy, Envoy</td></tr>
  <tr><td>API gateway</td><td>API products: auth, quotas, versions, keys, analytics</td><td>callers, plans, API routes</td><td>AWS API Gateway, Kong, Apigee, Tyk</td></tr>
  <tr><td>Service mesh</td><td>service-to-service: mTLS, retries, traffic splitting</td><td>every internal call</td><td>Istio, Linkerd</td></tr>
</table>
<p>The lines blur: Envoy can be all four, and many "gateways" are a reverse proxy plus plugins. Pick by the job, not the label.</p>

<h2>Example</h2>
<p><strong>A minimal gateway in Go</strong>: request IDs, JWT auth, per-key rate limiting (from <a href="#rate-limiting">Rate Limiting</a>) and prefix routing, all with the standard library's reverse proxy:</p>
<pre><code>func main() {
	routes := map[string]string{
		"/orders/":   "http://orders.internal:8080",
		"/payments/": "http://payments.internal:8080",
		"/users/":    "http://users.internal:8080",
	}
	mux := http.NewServeMux()
	for prefix, backend := range routes {
		target, err := url.Parse(backend)
		if err != nil {
			log.Fatal(err)
		}
		mux.Handle(prefix, &amp;httputil.ReverseProxy{
			Rewrite: func(pr *httputil.ProxyRequest) {
				pr.SetURL(target)
				pr.SetXForwarded()
			},
		})
	}

	limiter := NewRateLimiter(10, 20) // see Rate Limiting
	// Order matters: ID first (so even rejections are traceable), then auth, then limits.
	handler := withRequestID(authenticate(limiter.Middleware(mux)))

	srv := &amp;http.Server{Addr: ":8443", Handler: handler, ReadHeaderTimeout: 5 * time.Second}
	log.Fatal(srv.ListenAndServeTLS("gw.crt", "gw.key"))
}

func withRequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Request-ID")
		if id == "" {
			id = rand.Text() // Go 1.24+: random, URL-safe
		}
		r.Header.Set("X-Request-ID", id) // forwarded to the service
		w.Header().Set("X-Request-ID", id) // returned to the caller for support tickets
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("id=%s %s %s took=%s", id, r.Method, r.URL.Path, time.Since(start))
	})
}

func authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		claims, err := verifyJWT(token) // signature, expiry, audience
		if !ok || err != nil {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		// Set, not Add: overwrites any X-User-ID the client tried to sneak in.
		r.Header.Set("X-User-ID", claims.Subject)
		r.Header.Set("X-API-Key", claims.Subject) // rate-limit key for the next step
		next.ServeHTTP(w, r)
	})
}</code></pre>
<p>A real deployment would use an off-the-shelf gateway (Kong, Envoy Gateway, AWS API Gateway, KrakenD) configured declaratively, but they run exactly this kind of pipeline.</p>

<p><strong>Real-world scenario: launching a public API.</strong> A SaaS company wants to open its internal services to partners. Instead of hardening each service, it puts a gateway in front: partners get API keys tied to usage plans (free: 10 requests/second and 10,000/day; enterprise: much more), every call is logged per key for billing and support, <code>/v1</code> routes stay stable while internal services are refactored freely, and an abusive key can be revoked in one place. The services themselves only see requests that already passed auth and quotas, carrying an <code>X-Request-ID</code> and the caller's identity.</p>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>Business logic creeping into the gateway.</strong> Once teams start adding "just a little" logic in gateway scripts, it becomes a distributed monolith that every deploy depends on. Keep it to cross-cutting policy; domain logic belongs in services.</li>
  <li><strong>A single point of failure and an extra hop.</strong> Every request passes through it, so it needs redundancy, capacity headroom and tight latency budgets.</li>
  <li><strong>Trusting the edge only.</strong> If services accept any request because "the gateway checked it", anything inside the network can impersonate a user. Services should still verify identity (mTLS, signed headers or JWTs): zero trust.</li>
  <li><strong>Identity headers from clients.</strong> If the gateway forwards an <code>X-User-ID</code> the client sent, anyone can be anyone. The gateway must overwrite such headers itself.</li>
  <li><strong>Timeouts in the wrong order.</strong> The gateway's timeout must be longer than the backend's, or it returns 504 while the backend keeps working. Managed gateways have hard limits too (AWS API Gateway's integration timeout defaults to 29 seconds).</li>
  <li><strong>Chatty aggregation.</strong> Fan-out calls make the slowest backend set the response time and multiply failures; use timeouts and partial responses.</li>
</ul>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>An API gateway = one entry point + a policy pipeline (auth, limits, IDs, logging) + routing to services.</li>
  <li>It's for cross-cutting edge concerns, not business logic.</li>
  <li>Gateway = north-south (clients to services); service mesh = east-west (service to service).</li>
  <li>Make it redundant, overwrite identity headers, and still verify identity inside.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#reverse-proxies">Reverse Proxies</a> · <a href="#rate-limiting">Rate Limiting</a> · <a href="#api-versioning">API Versioning</a> · <a href="#service-discovery">Service Discovery</a> · <a href="#oauth">OAuth</a> · <a href="#real-world-traffic-stack">Real-World Traffic Stack</a></p>
`;


CONTENT["service-discovery"] = `
<p class="tldr"><strong>TL;DR</strong>: Service discovery is how a service finds the current network addresses of the services it calls, when those addresses keep changing. Instances register themselves (or are registered) in a <strong>registry</strong>, health checks remove dead ones, and callers look up a <em>name</em> like <code>orders</code> instead of hard-coding <code>10.0.1.17:8080</code>. It's a phone book that updates itself every few seconds.</p>

<h2>The problem it solves</h2>
<p>In the old world, a service lived on a known server for years and its IP went into a config file. Today:</p>
<ul>
  <li>Containers and pods get <strong>new IPs</strong> every time they restart or are rescheduled.</li>
  <li><strong>Autoscaling</strong> adds and removes instances all day.</li>
  <li>Instances <strong>fail</strong>, and callers must stop using them within seconds, not after someone edits a config file.</li>
</ul>
<p>Hard-coded addresses break on the next deploy. Service discovery keeps an always-current list of healthy instances per service.</p>

<h2>How it works</h2>
<ol>
  <li><strong>Register</strong>: when an instance starts, it's added to the registry with its address and port, either by the instance itself (self-registration) or by the platform (Kubernetes adds pod IPs to a Service's endpoints).</li>
  <li><strong>Health-check</strong>: the registry checks each instance (or expects heartbeats); failing instances are marked unhealthy and removed from answers.</li>
  <li><strong>Look up</strong>: a caller asks "where is <code>orders</code>?", through DNS, an API, or a local proxy, and gets healthy addresses.</li>
  <li><strong>Deregister</strong>: on shutdown the instance is removed, ideally <em>before</em> it stops serving.</li>
</ol>
<p>Who does the lookup and the choosing is the main design decision:</p>

<figure class="diagram">
<svg viewBox="0 0 780 262" role="img" aria-label="Client-side discovery: the caller queries the registry, gets the list of instances and picks one itself. Server-side discovery: the caller sends to a load balancer or virtual IP, which consults the registry and picks an instance.">
  <defs><marker id="arr-sd-1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <text x="195" y="22" text-anchor="middle" class="title">Client-side discovery</text>
  <text x="590" y="22" text-anchor="middle" class="title">Server-side discovery</text>
  <path class="line" d="M390 10 V254" style="stroke: var(--line)"/>

  <rect class="box accent" x="130" y="40" width="130" height="44" rx="8"/><text x="195" y="60" text-anchor="middle" class="title">Registry</text><text x="195" y="76" text-anchor="middle" class="small">Consul, Eureka</text>
  <rect class="box" x="20" y="130" width="120" height="44" rx="8"/><text x="80" y="150" text-anchor="middle" class="title">caller</text><text x="80" y="166" text-anchor="middle" class="small">picks an instance</text>
  <path class="line" d="M95 130 L150 86" marker-end="url(#arr-sd-1)"/>
  <text x="18" y="96" class="small">1 where is orders?</text>
  <path class="line dashed" d="M175 86 L120 128" marker-end="url(#arr-sd-1)"/>
  <text x="168" y="118" class="small">2 [a, b, c]</text>
  <rect class="box ok" x="250" y="120" width="120" height="30" rx="6"/><text x="310" y="140" text-anchor="middle" class="small">orders a</text>
  <rect class="box ok" x="250" y="160" width="120" height="30" rx="6"/><text x="310" y="180" text-anchor="middle" class="small">orders b</text>
  <rect class="box ok" x="250" y="200" width="120" height="30" rx="6"/><text x="310" y="220" text-anchor="middle" class="small">orders c</text>
  <path class="line accent" d="M140 160 L248 175" marker-end="url(#arr-sd-1)"/>
  <text x="140" y="204" class="small">3 call b directly</text>

  <rect class="box" x="410" y="130" width="110" height="44" rx="8"/><text x="465" y="150" text-anchor="middle" class="title">caller</text><text x="465" y="166" text-anchor="middle" class="small">calls one name</text>
  <rect class="box accent" x="550" y="40" width="130" height="44" rx="8"/><text x="615" y="60" text-anchor="middle" class="title">Registry</text><text x="615" y="76" text-anchor="middle" class="small">k8s API, Cloud Map</text>
  <rect class="box" x="550" y="130" width="100" height="44" rx="8"/><text x="600" y="150" text-anchor="middle" class="title">LB / VIP</text><text x="600" y="166" text-anchor="middle" class="small">picks one</text>
  <path class="line" d="M520 152 H548" marker-end="url(#arr-sd-1)"/>
  <path class="line dashed" d="M610 128 V86" marker-end="url(#arr-sd-1)"/>
  <rect class="box ok" x="680" y="120" width="85" height="30" rx="6"/><text x="722" y="140" text-anchor="middle" class="small">orders a</text>
  <rect class="box ok" x="680" y="160" width="85" height="30" rx="6"/><text x="722" y="180" text-anchor="middle" class="small">orders b</text>
  <rect class="box ok" x="680" y="200" width="85" height="30" rx="6"/><text x="722" y="220" text-anchor="middle" class="small">orders c</text>
  <path class="line accent" d="M650 160 L678 175" marker-end="url(#arr-sd-1)"/>
  <text x="590" y="248" text-anchor="middle" class="small">e.g. http://orders.shop.svc.cluster.local</text>
</svg>
<figcaption>Client-side: smarter callers, one less hop, but every language needs a client library. Server-side: dumb callers, one extra hop, the platform does the work. A service mesh is client-side discovery done by a sidecar proxy, so your code stays dumb.</figcaption>
</figure>

<h3>Life of an instance in the registry</h3>
<figure class="diagram">
<svg viewBox="0 0 780 196" role="img" aria-label="Timeline: an instance starts and registers, passes health checks and receives traffic. On graceful shutdown it deregisters first, drains in-flight requests, then stops. On a crash, health checks fail a few times before the registry removes it, and some requests fail in that window.">
  <text x="20" y="44" class="title">Graceful</text>
  <rect class="box muted" x="130" y="26" width="110" height="28" rx="4"/><text x="185" y="45" text-anchor="middle" class="small">start + register</text>
  <rect class="box ok" x="240" y="26" width="290" height="28" rx="4"/><text x="385" y="45" text-anchor="middle" class="small">healthy: receiving traffic</text>
  <rect class="box accent" x="530" y="26" width="90" height="28" rx="4"/><text x="575" y="45" text-anchor="middle" class="small">deregister</text>
  <rect class="box accent" x="620" y="26" width="80" height="28" rx="4"/><text x="660" y="45" text-anchor="middle" class="small">drain</text>
  <text x="710" y="45" class="small">stop</text>
  <text x="575" y="74" text-anchor="middle" class="small">callers stop picking it before it goes away</text>

  <text x="20" y="124" class="title">Crash</text>
  <rect class="box muted" x="130" y="106" width="110" height="28" rx="4"/><text x="185" y="125" text-anchor="middle" class="small">start + register</text>
  <rect class="box ok" x="240" y="106" width="210" height="28" rx="4"/><text x="345" y="125" text-anchor="middle" class="small">healthy: receiving traffic</text>
  <rect class="box bad" x="450" y="106" width="170" height="28" rx="4"/><text x="535" y="125" text-anchor="middle" class="small">dead, still listed ✗</text>
  <text x="630" y="125" class="small">removed</text>
  <text x="535" y="154" text-anchor="middle" class="small">failures until health checks catch up</text>
  <text x="535" y="170" text-anchor="middle" class="small">(interval × failure threshold, plus DNS / cache TTLs)</text>
</svg>
<figcaption>Graceful shutdown should never cause errors. Crashes always cause a short window of errors, so callers need timeouts and retries on another instance.</figcaption>
</figure>

<h2>Tools and approaches</h2>
<table>
  <tr><th>Approach</th><th>How callers find services</th><th>Health</th><th>Notes</th></tr>
  <tr><td>Kubernetes Services</td><td>DNS name → stable virtual IP; kube-proxy forwards to a ready pod</td><td>readiness probes</td><td>built in; a <em>headless</em> Service returns every pod IP instead</td></tr>
  <tr><td>DNS (A / SRV records)</td><td>standard DNS lookup; SRV adds ports and weights</td><td>depends on who updates DNS</td><td>works everywhere, but cached by TTL (see <a href="#dns">DNS</a>)</td></tr>
  <tr><td>HashiCorp Consul</td><td>HTTP API, DNS interface, or Connect sidecars</td><td>HTTP/TCP/script checks, TTL heartbeats</td><td>multi-platform: VMs, containers, multiple datacenters</td></tr>
  <tr><td>etcd / ZooKeeper</td><td>clients watch keys</td><td>leases / ephemeral nodes vanish when the client dies</td><td>building blocks; Kubernetes itself stores state in etcd</td></tr>
  <tr><td>Netflix Eureka</td><td>client library caches the registry</td><td>heartbeats</td><td>classic in Spring Cloud setups</td></tr>
  <tr><td>AWS Cloud Map / ECS Service Connect</td><td>DNS or API</td><td>Route 53 or ECS health checks</td><td>managed, for ECS and EC2</td></tr>
</table>

<h2>Example</h2>
<p><strong>Three ways a Go service finds <code>orders</code></strong>, from simplest to most explicit:</p>
<pre><code>// 1. Kubernetes: the Service name IS the discovery. kube-proxy (or the mesh)
//    picks a ready pod behind this stable name.
resp, err := http.Get("http://orders.shop.svc.cluster.local:8080/orders/42")

// 2. DNS SRV records: hosts AND ports, with priority and weight.
//    (Consul answers DNS on port 8600; forward the .consul domain to it.)
_, records, err := net.LookupSRV("", "", "orders.service.consul")
for _, rec := range records {
	fmt.Printf("%s:%d priority=%d weight=%d&#92;n", rec.Target, rec.Port, rec.Priority, rec.Weight)
}

// 3. Ask the registry's API for instances that pass their health checks.
type consulEntry struct {
	Node    struct{ Address string }
	Service struct {
		Address string
		Port    int
	}
}

func HealthyInstances(ctx context.Context, service string) ([]string, error) {
	u := "http://127.0.0.1:8500/v1/health/service/" + url.PathEscape(service) + "?passing=true"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err // caller should fall back to its last known good list
	}
	defer resp.Body.Close()

	var entries []consulEntry
	if err := json.NewDecoder(resp.Body).Decode(&amp;entries); err != nil {
		return nil, err
	}
	addrs := make([]string, 0, len(entries))
	for _, e := range entries {
		host := e.Service.Address
		if host == "" {
			host = e.Node.Address // Consul leaves it empty when it's the node's address
		}
		addrs = append(addrs, net.JoinHostPort(host, strconv.Itoa(e.Service.Port)))
	}
	return addrs, nil
}</code></pre>

<p><strong>Real-world scenario: the five-minute ghost.</strong> After scaling down, a payments service kept getting connection errors for several minutes, calling pods that no longer existed. Discovery was fine: the registry had removed them within seconds. But the calling service resolved the DNS name once at startup and kept the IPs in a long-lived connection pool, and one runtime cached DNS for far longer than the record's TTL. The fixes: respect DNS TTLs, cap connection lifetimes so pools periodically reconnect (and re-resolve), and retry failed calls on a different instance.</p>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>Stale answers.</strong> DNS TTLs, client caches and connection pools all keep using old addresses after the registry changed. Short TTLs, bounded connection lifetimes and retries on another instance close the gap.</li>
  <li><strong>The registry is now critical.</strong> If it's down and callers can't resolve anything, everything is down. Cache the last known good list and keep using it when the registry is unreachable.</li>
  <li><strong>Deregister before stopping.</strong> Stopping first and deregistering later causes errors on every deploy. Fail readiness, wait for callers to notice, drain, then exit (see <a href="#liveness-readiness-probes">Liveness &amp; Readiness Probes</a>).</li>
  <li><strong>Health checks that lie.</strong> "Port is open" isn't "can serve requests". A registered-but-broken instance attracts traffic and returns errors.</li>
  <li><strong>Client-side discovery in many languages.</strong> Every language needs a correct client with caching, health filtering and balancing. That's why meshes and platform-level discovery became popular.</li>
  <li><strong>Hard-coded IPs "just for now".</strong> They always outlive the "now". Use names from day one; on Kubernetes it costs nothing.</li>
</ul>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>Service discovery = a registry of healthy instances per service name, kept current automatically.</li>
  <li>Client-side (caller picks) vs server-side (LB/VIP picks); a mesh does client-side for you.</li>
  <li>On Kubernetes, a Service name is discovery; headless Services give you every pod IP.</li>
  <li>Plan for staleness: TTLs, cached lists, connection lifetimes, graceful deregistration.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#load-balancing">Load Balancing</a> · <a href="#dns">DNS</a> · <a href="#health-checks">Health Checks</a> · <a href="#kubernetes">Kubernetes</a> · <a href="#grpc">gRPC</a> · <a href="#real-world-traffic-stack">Real-World Traffic Stack</a></p>
`;


CONTENT["api-versioning"] = `
<p class="tldr"><strong>TL;DR</strong>: API versioning lets you change an API without breaking the clients already using it. Non-breaking changes (adding a field) ship freely; breaking changes (renaming or removing one) go into a new <strong>version</strong> that clients move to on their own schedule, while the old one keeps working until a published <strong>sunset</strong> date.</p>

<h2>The problem it solves</h2>
<p>Once an API is public, or even just used by a mobile app, you don't control when clients update. Mobile users run app versions from two years ago; partners integrated once and moved on. If you rename <code>total</code> to <code>total_cents</code>, every one of them breaks the moment you deploy. Versioning separates "we improved the API" from "everyone must change their code today".</p>

<h3>Breaking or not?</h3>
<table>
  <tr><th>Usually safe (no new version needed)</th><th>Breaking (needs a new version)</th></tr>
  <tr><td>adding a new endpoint</td><td>removing or renaming an endpoint or field</td></tr>
  <tr><td>adding an optional request field</td><td>making an optional field required</td></tr>
  <tr><td>adding a response field</td><td>changing a field's type or format (<code>"12.50"</code> → <code>1250</code>)</td></tr>
  <tr><td>adding a new enum value <em>if</em> clients were told to expect unknown values</td><td>changing meaning or defaults (amounts now in cents, not dollars)</td></tr>
  <tr><td>relaxing validation</td><td>tightening validation, changing error codes or auth rules</td></tr>
</table>
<p>"Safe" assumes <strong>tolerant readers</strong>: clients that ignore fields they don't know. Say so in your docs.</p>

<h2>How it works</h2>
<h3>Where to put the version</h3>
<table>
  <tr><th>Strategy</th><th>Looks like</th><th>Pros</th><th>Cons</th><th>Used by</th></tr>
  <tr><td>URL path</td><td><code>/v2/orders/42</code></td><td>obvious, easy to route, cache and test in a browser</td><td>versions the whole API at once</td><td>most public APIs, Google APIs</td></tr>
  <tr><td>Query parameter</td><td><code>/orders/42?api-version=2</code></td><td>easy to add</td><td>easy to forget; caching gets messy</td><td>Azure services</td></tr>
  <tr><td>Custom header</td><td><code>X-GitHub-Api-Version: 2022-11-28</code></td><td>clean URLs</td><td>invisible in links; caches need <code>Vary</code></td><td>GitHub REST API</td></tr>
  <tr><td>Media type</td><td><code>Accept: application/vnd.example.v2+json</code></td><td>"pure" HTTP content negotiation</td><td>awkward for clients and tools</td><td>some hypermedia APIs</td></tr>
  <tr><td>Date-based, pinned per account</td><td><code>Stripe-Version: 2024-06-20</code></td><td>small, frequent changes; each account keeps its version</td><td>you maintain many small transformations</td><td>Stripe</td></tr>
</table>
<p>For most teams, <strong>URL path versions with long-lived majors</strong> (<code>/v1</code>, <code>/v2</code>) are the pragmatic default. gRPC uses the same idea in the package name (<code>orders.v1</code>), and GraphQL APIs usually avoid versions entirely by only adding fields and deprecating old ones.</p>

<h3>One codebase, many versions</h3>
<p>Don't fork the code per version. Keep one core model and thin <strong>adapters</strong> that translate it to each version's shape:</p>
<figure class="diagram">
<svg viewBox="0 0 780 220" role="img" aria-label="Requests to /v1/orders and /v2/orders hit separate thin handlers that translate to and from one shared core order service and database. v1 returns total as a decimal string; v2 returns total_cents and currency.">
  <defs><marker id="arr-ver-1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <rect class="box muted" x="20" y="40" width="150" height="40" rx="8"/><text x="95" y="65" text-anchor="middle" class="small">GET /v1/orders/42</text>
  <rect class="box" x="20" y="140" width="150" height="40" rx="8"/><text x="95" y="165" text-anchor="middle" class="small">GET /v2/orders/42</text>
  <rect class="box muted" x="230" y="32" width="200" height="56" rx="8"/>
  <text x="330" y="55" text-anchor="middle" class="title">v1 adapter</text>
  <text x="330" y="74" text-anchor="middle" class="small">"total": "12.50" + Deprecation</text>
  <rect class="box" x="230" y="132" width="200" height="56" rx="8"/>
  <text x="330" y="155" text-anchor="middle" class="title">v2 adapter</text>
  <text x="330" y="174" text-anchor="middle" class="small">"total_cents": 1250, "currency"</text>
  <rect class="box accent" x="510" y="72" width="250" height="76" rx="10"/>
  <text x="635" y="100" text-anchor="middle" class="title">Core order service</text>
  <text x="635" y="120" text-anchor="middle" class="small">one model, one database,</text>
  <text x="635" y="136" text-anchor="middle" class="small">one set of business rules</text>
  <path class="line" d="M170 60 H228" marker-end="url(#arr-ver-1)"/>
  <path class="line" d="M170 160 H228" marker-end="url(#arr-ver-1)"/>
  <path class="line" d="M430 60 L508 95" marker-end="url(#arr-ver-1)"/>
  <path class="line" d="M430 160 L508 125" marker-end="url(#arr-ver-1)"/>
</svg>
<figcaption>Versions differ only at the edge. Bug fixes and new rules land once and every version gets them.</figcaption>
</figure>

<h3>The lifecycle: announce, deprecate, sunset</h3>
<figure class="diagram">
<svg viewBox="0 0 780 196" role="img" aria-label="Version lifecycle timeline: v1 is current; v2 is released and v1 is marked deprecated with Deprecation and Sunset headers; during the migration window traffic to v1 is monitored and heavy users are contacted; after the sunset date v1 returns 410 Gone and is removed.">
  <path class="line" d="M40 90 H750" style="stroke: var(--line)"/>
  <rect class="box ok" x="40" y="70" width="170" height="40" rx="6"/><text x="125" y="95" text-anchor="middle" class="small">v1 current</text>
  <rect class="box accent" x="210" y="70" width="340" height="40" rx="6"/><text x="380" y="95" text-anchor="middle" class="small">v1 deprecated: migration window (months)</text>
  <rect class="box bad" x="550" y="70" width="200" height="40" rx="6"/><text x="650" y="95" text-anchor="middle" class="small">v1 sunset: 410 Gone</text>
  <text x="210" y="50" text-anchor="middle" class="title">v2 released</text>
  <text x="210" y="140" text-anchor="middle" class="small">Deprecation + Sunset</text>
  <text x="210" y="155" text-anchor="middle" class="small">headers, emails</text>
  <text x="380" y="140" text-anchor="middle" class="small">watch v1 traffic per client,</text>
  <text x="380" y="155" text-anchor="middle" class="small">contact the biggest users</text>
  <text x="550" y="50" text-anchor="middle" class="title">sunset date</text>
  <text x="650" y="140" text-anchor="middle" class="small">delete the v1 adapter</text>
  <text x="650" y="155" text-anchor="middle" class="small">(the core stays)</text>
</svg>
<figcaption>Deprecation is a process, not a deploy. Measure who still calls the old version and tell them, in the response itself and out of band.</figcaption>
</figure>
<p>Two standard headers announce it machine-readably: <code>Deprecation</code> (RFC 9745, a timestamp like <code>@1767225600</code>) and <code>Sunset</code> (RFC 8594, an HTTP date after which the endpoint may stop working), plus a <code>Link</code> with <code>rel="deprecation"</code> pointing to the migration guide.</p>

<h2>Example</h2>
<p><strong>v1 and v2 side by side in Go</strong>, sharing one core <code>Order</code>. v1 formatted money as a decimal string (a classic mistake); v2 uses integer cents plus a currency:</p>
<pre><code>// The core model: one shape, used by every version.
type Order struct {
	ID         string
	TotalCents int64
	Currency   string
	Status     string
}

// v1: money as a decimal string. Kept only for old clients.
type orderV1 struct {
	ID     string &#96;json:"id"&#96;
	Total  string &#96;json:"total"&#96;
	Status string &#96;json:"status"&#96;
}

// v2: integer cents + currency.
type orderV2 struct {
	ID         string &#96;json:"id"&#96;
	TotalCents int64  &#96;json:"total_cents"&#96;
	Currency   string &#96;json:"currency"&#96;
	Status     string &#96;json:"status"&#96;
}

func routes(mux *http.ServeMux, orders OrderStore) {
	mux.HandleFunc("GET /v1/orders/{id}", func(w http.ResponseWriter, r *http.Request) {
		o, err := orders.Get(r.Context(), r.PathValue("id"))
		if err != nil {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		h := w.Header()
		h.Set("Deprecation", "@1767225600")             // deprecated since 2026-01-01 (RFC 9745)
		h.Set("Sunset", "Wed, 30 Jun 2027 23:59:59 GMT") // may stop working after this (RFC 8594)
		h.Set("Link", &#96;&lt;https://docs.example.com/migrate-to-v2&gt;; rel="deprecation"&#96;)
		writeJSON(w, orderV1{
			ID:     o.ID,
			Total:  fmt.Sprintf("%d.%02d", o.TotalCents/100, o.TotalCents%100),
			Status: o.Status,
		})
	})

	mux.HandleFunc("GET /v2/orders/{id}", func(w http.ResponseWriter, r *http.Request) {
		o, err := orders.Get(r.Context(), r.PathValue("id"))
		if err != nil {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		writeJSON(w, orderV2{ID: o.ID, TotalCents: o.TotalCents, Currency: o.Currency, Status: o.Status})
	})
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}</code></pre>
<p>Calling both:</p>
<pre><code>$ curl -si localhost:8080/v1/orders/42
HTTP/1.1 200 OK
Content-Type: application/json
Deprecation: @1767225600
Link: &lt;https://docs.example.com/migrate-to-v2&gt;; rel="deprecation"
Sunset: Wed, 30 Jun 2027 23:59:59 GMT

{"id":"42","total":"12.50","status":"paid"}

$ curl -s localhost:8080/v2/orders/42
{"id":"42","total_cents":1250,"currency":"USD","status":"paid"}</code></pre>

<p><strong>Real-world scenario: the mobile app you can't update.</strong> A food-delivery company shipped v2 of its API and turned off v1 after three months. Support tickets exploded: about 8% of users ran app versions that only knew v1, because many phones don't auto-update. The lesson the team took: log the API version and app version on every request, sunset only when old-version traffic is near zero (or force an app update screen first), and keep the v1 adapter around, which was cheap because it was only an adapter over the shared core.</p>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>Breaking without bumping.</strong> "Small" renames in place break someone. If you're unsure whether a change is breaking, assume it is, or add the new field alongside the old one (expand, then contract later).</li>
  <li><strong>Versioning too often.</strong> Every live version is code to test, document and secure. Batch breaking changes into rare major versions; ship additive changes continuously.</li>
  <li><strong>Forking the codebase per version.</strong> Copy-pasted handlers drift and bugs get fixed in one version only. Use adapters over one core.</li>
  <li><strong>Never sunsetting.</strong> Old versions accumulate forever. Publish a support policy (for example: at least 12 months after deprecation) and follow it with data.</li>
  <li><strong>No default for unversioned requests.</strong> With header versioning, decide what a request without the header gets, and never silently move it to a newer version.</li>
  <li><strong>Caches ignoring the version.</strong> If the version lives in a header, responses must send <code>Vary</code> on it, or a CDN may serve a v2 body to a v1 client.</li>
  <li><strong>Clients that crash on unknown fields or enum values.</strong> Write your own clients as tolerant readers, and document that you'll add fields and values over time.</li>
</ul>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>Additive changes don't need a version; breaking changes do.</li>
  <li>URL path majors (<code>/v1</code>, <code>/v2</code>) are the pragmatic default; date-pinned versions suit APIs with many small changes.</li>
  <li>Keep one core and thin per-version adapters.</li>
  <li>Deprecate with <code>Deprecation</code>/<code>Sunset</code> headers and data on who still calls the old version, then remove it.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#api-gateways">API Gateways</a> · <a href="#schema-versioning">Schema Versioning</a> · <a href="#semantic-versioning">Semantic Versioning</a> · <a href="#database-migrations">Database Migrations</a> · <a href="#grpc">gRPC</a> · <a href="#real-world-traffic-stack">Real-World Traffic Stack</a></p>
`;


