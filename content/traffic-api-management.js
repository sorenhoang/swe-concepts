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


