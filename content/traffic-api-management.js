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


