CONTENT["health-checks"] = `
<p class="tldr"><strong>TL;DR</strong>: A health check is a small endpoint, usually <code>GET /healthz</code>, that answers "can this instance take work right now?" with a status code. Load balancers, registries, orchestrators and uptime monitors call it every few seconds and act on the answer: stop sending traffic, deregister, restart, or page someone. It's a pulse check. A <strong>shallow</strong> check only looks for a pulse. A <strong>deep</strong> check also tests the instance's dependencies, which is more useful and much more dangerous.</p>

<h2>The problem it solves</h2>
<p>A process can be running and still be useless: port open, but a goroutine deadlocked, the connection pool empty, or the config never loaded. Without a check:</p>
<ul>
  <li>A <strong>load balancer</strong> keeps sending a third of all traffic to a broken instance, so a third of the requests fail.</li>
  <li>A <strong>registry</strong> keeps handing out the address of an instance that crashed a minute ago.</li>
  <li>An <strong>orchestrator</strong> doesn't know a container has deadlocked, so it never restarts it.</li>
  <li><strong>Nobody</strong> notices the whole site is down until customers complain.</li>
</ul>
<p>A health check gives each of these machines a cheap, standard question to ask, so a bad instance is taken out of rotation in seconds, without a human.</p>

<h2>How it works</h2>
<p>The instance exposes one or more HTTP endpoints (or a gRPC health service, or just an open TCP port). A caller polls it on an interval. A <code>2xx</code> means healthy; a <code>5xx</code>, a timeout or a refused connection means unhealthy. Callers don't act on one bad answer. They wait for several failures in a row before marking an instance unhealthy, and several successes before trusting it again. This damps flapping.</p>

<figure class="diagram">
<svg viewBox="0 0 780 300" role="img" aria-label="Four callers poll the orders service: a load balancer, a service registry, an orchestrator and an external uptime monitor. The service exposes a shallow GET /healthz that does no I/O and a deep GET /health that checks Postgres (critical), a Redis cache and a recommendations API (both non-critical) with timeouts and a cache.">
  <defs><marker id="arr-hc-1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <text x="105" y="22" text-anchor="middle" class="title">Who asks</text>
  <text x="400" y="22" text-anchor="middle" class="title">What it exposes</text>
  <text x="680" y="22" text-anchor="middle" class="title">What a deep check touches</text>

  <rect class="box" x="20" y="38" width="170" height="50" rx="8"/><text x="105" y="58" text-anchor="middle">Load balancer</text><text x="105" y="76" text-anchor="middle" class="small">fail → stop routing to it</text>
  <rect class="box" x="20" y="102" width="170" height="50" rx="8"/><text x="105" y="122" text-anchor="middle">Service registry</text><text x="105" y="140" text-anchor="middle" class="small">fail → hide from lookups</text>
  <rect class="box" x="20" y="166" width="170" height="50" rx="8"/><text x="105" y="186" text-anchor="middle">Orchestrator</text><text x="105" y="204" text-anchor="middle" class="small">fail → restart or unready</text>
  <rect class="box" x="20" y="230" width="170" height="50" rx="8"/><text x="105" y="250" text-anchor="middle">Uptime monitor</text><text x="105" y="268" text-anchor="middle" class="small">fail → page a human</text>

  <path class="line" d="M190 63 L298 110" marker-end="url(#arr-hc-1)"/>
  <path class="line" d="M190 127 L298 140" marker-end="url(#arr-hc-1)"/>
  <path class="line" d="M190 191 L298 190" marker-end="url(#arr-hc-1)"/>
  <path class="line dashed" d="M190 255 L298 220" marker-end="url(#arr-hc-1)"/>

  <rect class="box muted" x="300" y="40" width="200" height="240" rx="10"/>
  <text x="400" y="62" text-anchor="middle" class="title">orders service</text>
  <rect class="box ok" x="320" y="80" width="160" height="62" rx="8"/>
  <text x="400" y="102" text-anchor="middle">GET /healthz</text>
  <text x="400" y="119" text-anchor="middle" class="small">shallow: no I/O</text>
  <text x="400" y="133" text-anchor="middle" class="small">"the process answers"</text>
  <rect class="box accent" x="320" y="166" width="160" height="96" rx="8"/>
  <text x="400" y="188" text-anchor="middle">GET /health</text>
  <text x="400" y="205" text-anchor="middle" class="small">deep: pings dependencies</text>
  <text x="400" y="221" text-anchor="middle" class="small">parallel, 500 ms timeout</text>
  <text x="400" y="237" text-anchor="middle" class="small">result cached for 2 s</text>
  <text x="400" y="253" text-anchor="middle" class="small">pass / warn / fail</text>

  <rect class="box" x="600" y="48" width="160" height="50" rx="8"/><text x="680" y="68" text-anchor="middle">Postgres</text><text x="680" y="86" text-anchor="middle" class="small">critical: fail → 503</text>
  <rect class="box" x="600" y="128" width="160" height="50" rx="8"/><text x="680" y="148" text-anchor="middle">Redis cache</text><text x="680" y="166" text-anchor="middle" class="small">non-critical: warn</text>
  <rect class="box" x="600" y="208" width="160" height="50" rx="8"/><text x="680" y="228" text-anchor="middle">recommendations</text><text x="680" y="246" text-anchor="middle" class="small">non-critical: warn</text>
  <path class="line dashed" d="M480 190 L598 76" marker-end="url(#arr-hc-1)"/>
  <path class="line dashed" d="M480 205 L598 154" marker-end="url(#arr-hc-1)"/>
  <path class="line dashed" d="M480 225 L598 232" marker-end="url(#arr-hc-1)"/>
</svg>
<figcaption>Different callers ask the same question for different reasons, and act differently on "no". The uptime monitor sits outside your network, so it also catches DNS, TLS and network failures the others can't see.</figcaption>
</figure>

<h3>Shallow vs deep</h3>
<ul>
  <li><strong>Shallow</strong> (<code>/healthz</code>, "liveness-style"): returns <code>200 ok</code> if the HTTP server can run a handler. No database, no network. Cheap enough to call every second. It catches crashed and wedged processes, and nothing else.</li>
  <li><strong>Deep</strong> (<code>/health</code>, "readiness-style"): also pings the database, cache and key downstream APIs, each with a short timeout, and reports per-dependency results. It catches "running but can't do its job", for example a bad DB password after a secret rotation.</li>
</ul>
<p>The catch: a deep check makes an instance's health depend on <em>shared</em> things. When a shared dependency fails, every instance fails its check at the same moment.</p>

<h3>The cascading-failure trap</h3>
<figure class="diagram">
<svg viewBox="0 0 780 262" role="img" aria-label="Left: the load balancer uses a deep check. The recommendations API gets slow, all three cart instances fail their checks and are removed, leaving zero healthy instances and a total outage. Right: the load balancer uses a shallow check and each request calls recommendations with a timeout. All three instances stay in and carts load without recommendations.">
  <defs><marker id="arr-hc-2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <text x="190" y="20" text-anchor="middle" class="title">LB uses the deep check</text>
  <text x="590" y="20" text-anchor="middle" class="title">LB uses the shallow check</text>
  <path class="line" d="M390 8 V254" style="stroke: var(--line)"/>

  <rect class="box bad" x="115" y="34" width="150" height="40" rx="8"/><text x="190" y="59" text-anchor="middle">recs API slow</text>
  <path class="line bad dashed" d="M165 74 L80 124" marker-end="url(#arr-hc-2)"/>
  <path class="line bad dashed" d="M190 74 L190 124" marker-end="url(#arr-hc-2)"/>
  <path class="line bad dashed" d="M215 74 L300 124" marker-end="url(#arr-hc-2)"/>
  <rect class="box bad" x="25" y="126" width="110" height="44" rx="8"/><text x="80" y="145" text-anchor="middle">cart 1</text><text x="80" y="161" text-anchor="middle" class="small">check fails: out</text>
  <rect class="box bad" x="140" y="126" width="100" height="44" rx="8"/><text x="190" y="145" text-anchor="middle">cart 2</text><text x="190" y="161" text-anchor="middle" class="small">out</text>
  <rect class="box bad" x="250" y="126" width="110" height="44" rx="8"/><text x="305" y="145" text-anchor="middle">cart 3</text><text x="305" y="161" text-anchor="middle" class="small">out</text>
  <rect class="box bad" x="40" y="200" width="300" height="44" rx="8"/><text x="190" y="219" text-anchor="middle" class="title">0 healthy instances</text><text x="190" y="235" text-anchor="middle" class="small">a slow optional feature became a total outage</text>

  <rect class="box bad" x="515" y="34" width="150" height="40" rx="8"/><text x="590" y="59" text-anchor="middle">recs API slow</text>
  <path class="line dashed" d="M565 74 L480 124" marker-end="url(#arr-hc-2)"/>
  <path class="line dashed" d="M590 74 L590 124" marker-end="url(#arr-hc-2)"/>
  <path class="line dashed" d="M615 74 L700 124" marker-end="url(#arr-hc-2)"/>
  <rect class="box ok" x="425" y="126" width="110" height="44" rx="8"/><text x="480" y="145" text-anchor="middle">cart 1</text><text x="480" y="161" text-anchor="middle" class="small">still in</text>
  <rect class="box ok" x="540" y="126" width="100" height="44" rx="8"/><text x="590" y="145" text-anchor="middle">cart 2</text><text x="590" y="161" text-anchor="middle" class="small">still in</text>
  <rect class="box ok" x="645" y="126" width="110" height="44" rx="8"/><text x="700" y="145" text-anchor="middle">cart 3</text><text x="700" y="161" text-anchor="middle" class="small">still in</text>
  <rect class="box ok" x="440" y="200" width="300" height="44" rx="8"/><text x="590" y="219" text-anchor="middle" class="title">degraded, not down</text><text x="590" y="235" text-anchor="middle" class="small">300 ms timeout, carts load without recs</text>
</svg>
<figcaption>Removing an instance only helps if <em>other</em> instances are better. When the failure is shared, the health check takes them all out together. Handle shared dependencies inside each request (timeouts, fallbacks, <a href="#circuit-breakers">circuit breakers</a>), not in the check that routes traffic.</figcaption>
</figure>
<p>Some load balancers soften this. An AWS Application Load Balancer, for example, <strong>fails open</strong>: if every target in a group is unhealthy, it routes to all of them anyway. A Kubernetes Service does not: if every pod is unready, it has no endpoints and callers get errors.</p>

<h2>Kinds of checks compared</h2>
<table>
  <tr><th>Kind</th><th>What it proves</th><th>Cost</th><th>Good caller</th><th>Risk</th></tr>
  <tr><td>TCP port open</td><td>something is listening</td><td>tiny</td><td>L4 load balancers, legacy services</td><td>a wedged process still accepts connections</td></tr>
  <tr><td>Shallow HTTP <code>/healthz</code></td><td>the server can run a handler</td><td>tiny, no I/O</td><td>restarts (orchestrator), LB routing</td><td>misses broken config or credentials</td></tr>
  <tr><td>Deep HTTP <code>/health</code></td><td>it can reach what it needs</td><td>one round trip per dependency</td><td>dashboards, deploy gates, humans</td><td>shared dependency fails → every instance fails</td></tr>
  <tr><td>gRPC <code>grpc.health.v1.Health</code></td><td>per-service <code>SERVING</code> / <code>NOT_SERVING</code></td><td>tiny</td><td>gRPC load balancers, Kubernetes <code>grpc</code> probes</td><td>same as HTTP, depending on what you check</td></tr>
  <tr><td>Synthetic / black-box</td><td>a real user path works from outside</td><td>a full request</td><td>uptime monitors, status pages</td><td>slow to detect, can't tell you why</td></tr>
</table>

<h2>Example</h2>
<p><strong>A shallow and a deep check in Go.</strong> The deep check runs dependency checks in parallel, gives each its own timeout, marks dependencies critical or not, and caches the result so a burst of callers doesn't hammer the database. Only a critical failure returns <code>503</code>.</p>
<pre><code>type Check struct {
	Name     string
	Critical bool // false: a failure degrades the report to "warn", not "fail"
	Run      func(ctx context.Context) error
}

type Result struct {
	Status   string &#96;json:"status"&#96; // "pass" or "fail"
	Error    string &#96;json:"error,omitempty"&#96;
	Duration string &#96;json:"duration"&#96;
}

type Report struct {
	Status string            &#96;json:"status"&#96; // "pass", "warn" or "fail"
	Checks map[string]Result &#96;json:"checks"&#96;
}

type Health struct {
	Checks  []Check
	Timeout time.Duration // per check
	TTL     time.Duration // how long to reuse a report

	mu      sync.Mutex
	cached  Report
	expires time.Time
}

// Report runs every check in parallel, each under its own timeout. Holding mu
// while checking means 50 probes arriving together trigger ONE round of checks.
func (h *Health) Report(ctx context.Context) Report {
	h.mu.Lock()
	defer h.mu.Unlock()
	if time.Now().Before(h.expires) {
		return h.cached
	}

	rep := Report{Status: "pass", Checks: make(map[string]Result, len(h.Checks))}
	var wg sync.WaitGroup
	var rmu sync.Mutex
	for _, c := range h.Checks {
		wg.Go(func() {
			cctx, cancel := context.WithTimeout(ctx, h.Timeout)
			defer cancel()
			start := time.Now()
			err := c.Run(cctx)
			res := Result{Status: "pass", Duration: time.Since(start).Round(time.Millisecond).String()}

			rmu.Lock()
			defer rmu.Unlock()
			if err != nil {
				res.Status, res.Error = "fail", err.Error()
				if c.Critical {
					rep.Status = "fail"
				} else if rep.Status == "pass" {
					rep.Status = "warn"
				}
			}
			rep.Checks[c.Name] = res
		})
	}
	wg.Wait()

	h.cached, h.expires = rep, time.Now().Add(h.TTL)
	return rep
}

func (h *Health) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	rep := h.Report(r.Context())
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	if rep.Status == "fail" {
		w.WriteHeader(http.StatusServiceUnavailable) // only critical failures
	}
	json.NewEncoder(w).Encode(rep)
}

// HTTPCheck treats any 5xx or network error from a dependency as a failure.
func HTTPCheck(url string) func(context.Context) error {
	return func(ctx context.Context) error {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			return err
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return err
		}
		resp.Body.Close()
		if resp.StatusCode &gt;= 500 {
			return fmt.Errorf("status %d", resp.StatusCode)
		}
		return nil
	}
}

func routes(db *sql.DB) *http.ServeMux {
	health := &amp;Health{
		Timeout: 500 * time.Millisecond,
		TTL:     2 * time.Second,
		Checks: []Check{
			{Name: "postgres", Critical: true, Run: db.PingContext},
			{Name: "recommendations", Critical: false, Run: HTTPCheck("http://recs:8080/healthz")},
		},
	}

	mux := http.NewServeMux()
	// Shallow: "the process is up and the HTTP server answers". No I/O.
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("ok&#92;n"))
	})
	// Deep: "I can do my job". Expensive, cached, and NOT used for restarts.
	mux.Handle("GET /health", health)
	return mux
}</code></pre>

<p>Real responses from an <code>httptest</code> run. First the recommendations API hangs (non-critical, so <code>200</code> with <code>warn</code>), then Postgres refuses connections (critical, so <code>503</code>):</p>
<pre><code>$ GET /health        # recommendations hangs past its 500 ms timeout
HTTP 200
{"status":"warn","checks":{"postgres":{"status":"pass","duration":"3ms"},"recommendations":{"status":"fail","error":"context deadline exceeded","duration":"501ms"}}}

$ GET /health        # Postgres refuses connections
HTTP 503
{"status":"fail","checks":{"postgres":{"status":"fail","error":"dial tcp 10.0.3.7:5432: connect: connection refused","duration":"0s"},"recommendations":{"status":"pass","duration":"3ms"}}}

$ GET /healthz
HTTP 200
ok</code></pre>

<p><strong>Real-world scenario.</strong> A cart service runs 12 instances behind a load balancer that polls a deep <code>/health</code> every 10 s and marks an instance unhealthy after 3 failures. At 14:05 a bad deploy makes the recommendations API time out. Every cart instance's check now waits on recommendations and fails. By 14:05:30 all 12 instances are out of rotation and checkout is down site-wide, even though carts never needed recommendations to work. The fix took two lines: point the load balancer at the shallow <code>/healthz</code>, and mark recommendations as non-critical with a 300 ms timeout and an empty-list fallback in the request path. The deep <code>/health</code> stays, but for dashboards and humans.</p>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>Shared dependencies in routing checks.</strong> If every instance checks the same database, they all fail together and the check turns a partial problem into a total outage. Ask: "would sending traffic to a different instance fix this?" If no, it doesn't belong in a routing check.</li>
  <li><strong>Checks without timeouts.</strong> A dependency ping that hangs makes the health endpoint hang, and the caller's own timeout (often 1 to 5 s) counts it as a failure. Every check needs a timeout shorter than the caller's.</li>
  <li><strong>Health checks as a DDoS.</strong> 3 load balancer nodes × 200 instances × one DB query each, every few seconds, is real load. Cache results for a second or two, and keep the queries trivial (<code>SELECT 1</code> or a driver ping).</li>
  <li><strong>Always <code>200</code>.</strong> A handler that returns <code>200</code> before the app has loaded config or warmed caches lets traffic in too early. Report "not ready" until startup finishes.</li>
  <li><strong>Leaking internals.</strong> A public <code>/health</code> that prints hostnames, versions and error strings is free reconnaissance. Serve details on an internal port or behind auth, and give the outside a bare status code.</li>
  <li><strong>Flapping.</strong> One-strike thresholds bounce instances in and out on a single slow GC pause. Use consecutive-failure and consecutive-success thresholds.</li>
</ul>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>A health check is a cheap, standard "can you take work?" question that machines ask every few seconds.</li>
  <li>Shallow checks catch dead processes; deep checks catch broken dependencies but fail on every instance at once.</li>
  <li>Route traffic on checks that are specific to the instance; handle shared dependencies with timeouts and fallbacks per request.</li>
  <li>Give every check a timeout, cache deep results, and use failure and success thresholds.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#liveness-readiness-probes">Liveness &amp; Readiness Probes</a> · <a href="#load-balancing">Load Balancing</a> · <a href="#service-discovery">Service Discovery</a> · <a href="#circuit-breakers">Circuit Breakers</a> · <a href="#timeouts">Timeouts</a> · <a href="#monitoring">Monitoring</a></p>
`;

