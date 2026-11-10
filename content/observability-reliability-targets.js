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

CONTENT["liveness-readiness-probes"] = `
<p class="tldr"><strong>TL;DR</strong>: Kubernetes asks each container three different questions. <strong>Startup</strong>: "have you finished booting?" <strong>Liveness</strong>: "are you stuck?" If not alive, the kubelet <em>restarts</em> the container. <strong>Readiness</strong>: "should you get traffic right now?" If not ready, the pod is <em>removed from Service endpoints</em> but keeps running. Mixing up "restart me" and "don't send me traffic" is the source of most probe outages.</p>

<h2>The problem it solves</h2>
<p>A generic <a href="#health-checks">health check</a> gives one yes/no answer. An orchestrator needs to make three separate decisions, and each needs a different answer:</p>
<ul>
  <li><strong>A slow starter</strong> (loads a 2 GB model, warms caches) looks dead for 90 seconds. Judge it too early and Kubernetes kills it before it ever starts, forever: a crash loop.</li>
  <li><strong>A deadlocked process</strong> keeps its port open and answers nothing. Only a restart fixes it.</li>
  <li><strong>A healthy but busy or shutting-down pod</strong> should stop getting <em>new</em> requests, but must not be killed: killing it drops the requests it's already handling.</li>
</ul>
<p>Without probes, Kubernetes only knows "the process exited or it didn't". It sends traffic to pods that are still booting, never restarts wedged ones, and sends requests to pods in the middle of shutting down.</p>

<h2>How it works</h2>
<p>The <strong>kubelet</strong> on each node runs the probes against its own containers. Each probe uses one mechanism: <code>httpGet</code> (success is a status from 200 to 399), <code>tcpSocket</code> (port open), <code>grpc</code> (the standard gRPC health service answers <code>SERVING</code>; stable since Kubernetes 1.27), or <code>exec</code> (a command exits 0). The three probes differ in <em>when</em> they run and <em>what happens on failure</em>:</p>

<figure class="diagram">
<svg viewBox="0 0 780 262" role="img" aria-label="Timeline of one pod. The startup probe fails while the app warms up, then passes, and is never run again. Only then do liveness and readiness start. Liveness passes for the rest of the pod's life. Readiness passes, so the pod is in the Service endpoints and gets traffic, until SIGTERM, when readiness fails and the pod drains.">
  <text x="20" y="54" class="title">startup</text>
  <text x="20" y="99" class="title">liveness</text>
  <text x="20" y="144" class="title">readiness</text>
  <text x="20" y="189" class="title">gets traffic?</text>

  <rect class="box bad" x="150" y="36" width="190" height="28" rx="4"/><text x="245" y="55" text-anchor="middle" class="small">503 starting… (tolerated)</text>
  <rect class="box ok" x="340" y="36" width="50" height="28" rx="4"/><text x="365" y="55" text-anchor="middle" class="small">pass</text>
  <text x="400" y="55" class="small">done, never runs again</text>

  <rect class="box muted" x="150" y="81" width="240" height="28" rx="4"/><text x="270" y="100" text-anchor="middle" class="small">not run yet</text>
  <rect class="box ok" x="390" y="81" width="370" height="28" rx="4"/><text x="575" y="100" text-anchor="middle" class="small">pass every 10 s; 3 fails in a row → restart container</text>

  <rect class="box muted" x="150" y="126" width="240" height="28" rx="4"/><text x="270" y="145" text-anchor="middle" class="small">not run yet</text>
  <rect class="box ok" x="390" y="126" width="250" height="28" rx="4"/><text x="515" y="145" text-anchor="middle" class="small">pass: listed in EndpointSlices</text>
  <rect class="box bad" x="640" y="126" width="120" height="28" rx="4"/><text x="700" y="145" text-anchor="middle" class="small">503: removed</text>

  <rect class="box muted" x="150" y="171" width="250" height="28" rx="4"/><text x="275" y="190" text-anchor="middle" class="small">no</text>
  <rect class="box ok" x="400" y="171" width="240" height="28" rx="4"/><text x="520" y="190" text-anchor="middle" class="small">yes</text>
  <rect class="box accent" x="640" y="171" width="120" height="28" rx="4"/><text x="700" y="190" text-anchor="middle" class="small">drain in-flight</text>

  <path class="line" d="M150 222 H760"/>
  <path class="line" d="M150 216 V228 M390 216 V228 M640 216 V228"/>
  <text x="150" y="246" class="small">container starts</text>
  <text x="390" y="246" text-anchor="middle" class="small">app warmed up</text>
  <text x="640" y="246" text-anchor="middle" class="small">SIGTERM</text>
</svg>
<figcaption>The startup probe holds the other two back, so a slow boot isn't mistaken for a hang. Liveness and readiness then run independently for the rest of the pod's life.</figcaption>
</figure>

<h3>The fields, and their defaults</h3>
<p>Every probe takes the same timing fields. With the defaults, a pod is declared failed after about 30 seconds of failures (3 × 10 s):</p>
<table>
  <tr><th>Field</th><th>Default</th><th>Meaning</th></tr>
  <tr><td><code>initialDelaySeconds</code></td><td>0</td><td>wait before the first probe (prefer a startup probe)</td></tr>
  <tr><td><code>periodSeconds</code></td><td>10</td><td>how often to probe</td></tr>
  <tr><td><code>timeoutSeconds</code></td><td>1</td><td>no answer within this time counts as a failure</td></tr>
  <tr><td><code>failureThreshold</code></td><td>3</td><td>consecutive failures before acting</td></tr>
  <tr><td><code>successThreshold</code></td><td>1</td><td>consecutive successes to count as passing again; must be 1 for liveness and startup</td></tr>
  <tr><td><code>terminationGracePeriodSeconds</code></td><td>pod's value (30)</td><td>probe-level override: how long a container killed by a failed liveness or startup probe gets to shut down</td></tr>
</table>
<p>A startup probe's budget is <code>failureThreshold × periodSeconds</code>: 24 × 5 s gives a slow app two minutes to boot, while liveness keeps its tight 30-second reaction time afterwards.</p>

<h2>The three probes compared</h2>
<table>
  <tr><th></th><th>Startup</th><th>Liveness</th><th>Readiness</th></tr>
  <tr><td>Question</td><td>finished booting?</td><td>able to make progress?</td><td>should I get new requests?</td></tr>
  <tr><td>Runs</td><td>only at start, until it passes once</td><td>periodically, after startup</td><td>periodically, for the whole life</td></tr>
  <tr><td>On failure</td><td>kill; restart policy applies</td><td>kill and restart the container</td><td>remove the pod IP from Service endpoints; keep running and probing</td></tr>
  <tr><td>Should check</td><td>init finished (same endpoint as liveness)</td><td>only the process itself: event loop, worker heartbeat</td><td>started, not shutting down, not overloaded, own critical config</td></tr>
  <tr><td>Must not check</td><td>things that take longer than its budget</td><td>databases, caches, other services</td><td>shared dependencies that fail on every pod at once</td></tr>
  <tr><td>Skip it when</td><td>the app boots within the liveness window</td><td>the process crashes by itself when broken</td><td>never for pods behind a Service</td></tr>
</table>

<h3>Shutdown: the race readiness can't win alone</h3>
<p>When a pod is deleted (a rollout, a scale-down, a node drain), two things start <strong>at the same time</strong>: the kubelet begins stopping the container, and the control plane marks the endpoint not ready, which then has to reach kube-proxy on every node, ingress controllers and cloud load balancers. That takes a few seconds. If your app exits on SIGTERM immediately, proxies still send it new connections, and every deploy produces a burst of <code>502</code>s.</p>

<figure class="diagram">
<svg viewBox="0 0 780 232" role="img" aria-label="When a pod is deleted, two lanes start at once. Kubelet lane: SIGTERM reaches the app, which fails readiness, keeps serving for 5 seconds, then stops accepting and finishes in-flight requests, then exits. Control plane lane: the endpoint is marked not ready, then kube-proxy, ingress and load balancers update, then no new traffic arrives. The 5 second pause covers the propagation delay.">
  <defs><marker id="arr-probe-2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <rect class="box accent" x="20" y="86" width="120" height="50" rx="8"/><text x="80" y="107" text-anchor="middle" class="title">pod deleted</text><text x="80" y="124" text-anchor="middle" class="small">rollout, scale-in</text>
  <path class="line" d="M140 100 L178 60" marker-end="url(#arr-probe-2)"/>
  <path class="line" d="M140 122 L178 160" marker-end="url(#arr-probe-2)"/>

  <text x="190" y="28" class="small">kubelet → your container</text>
  <rect class="box" x="180" y="36" width="130" height="44" rx="6"/><text x="245" y="55" text-anchor="middle">SIGTERM</text><text x="245" y="71" text-anchor="middle" class="small">readiness → 503</text>
  <rect class="box ok" x="320" y="36" width="160" height="44" rx="6"/><text x="400" y="55" text-anchor="middle">keep serving 5 s</text><text x="400" y="71" text-anchor="middle" class="small">drainDelay</text>
  <rect class="box" x="490" y="36" width="190" height="44" rx="6"/><text x="585" y="55" text-anchor="middle">srv.Shutdown</text><text x="585" y="71" text-anchor="middle" class="small">finish in-flight requests</text>
  <rect class="box muted" x="690" y="36" width="70" height="44" rx="6"/><text x="725" y="63" text-anchor="middle">exit</text>

  <text x="190" y="128" class="small">control plane → every node and LB</text>
  <rect class="box" x="180" y="136" width="170" height="44" rx="6"/><text x="265" y="155" text-anchor="middle">endpoint not ready</text><text x="265" y="171" text-anchor="middle" class="small">EndpointSlice updated</text>
  <rect class="box bad" x="360" y="136" width="200" height="44" rx="6"/><text x="460" y="155" text-anchor="middle">proxies catch up</text><text x="460" y="171" text-anchor="middle" class="small">still sending for a few s</text>
  <rect class="box ok" x="570" y="136" width="190" height="44" rx="6"/><text x="665" y="155" text-anchor="middle">no new traffic</text><text x="665" y="171" text-anchor="middle" class="small">safe to stop</text>

  <path class="line dashed" d="M480 88 V128" style="stroke: var(--line)"/>
  <text x="390" y="214" text-anchor="middle" class="small">Without the pause the container exits during "proxies catch up", and those requests get connection refused / 502.</text>
</svg>
<figcaption>Fail readiness, keep serving for a few seconds, then shut down gracefully. Total time must fit in <code>terminationGracePeriodSeconds</code> (default 30 s), or the container is killed with SIGKILL. A <code>preStop</code> hook that sleeps does the same job when you can't change the app.</figcaption>
</figure>

<h2>Example</h2>
<p><strong>A Go service with the three probes and graceful shutdown.</strong> <code>/livez</code> touches nothing external. It fails only during startup, so the startup probe and liveness can share it. <code>/readyz</code> also fails while shutting down.</p>
<pre><code>const (
	drainDelay      = 5 * time.Second  // time for endpoints and proxies to drop us
	shutdownTimeout = 20 * time.Second // must fit inside terminationGracePeriodSeconds
)

var started, shuttingDown atomic.Bool

// /livez: "is this process able to make progress?" Never checks the DB.
// It fails only until startup is done, so the startup probe can share it.
func livez(w http.ResponseWriter, r *http.Request) {
	if !started.Load() {
		http.Error(w, "starting", http.StatusServiceUnavailable)
		return
	}
	w.Write([]byte("ok&#92;n"))
}

// /readyz: "should this pod get NEW requests right now?"
func readyz(w http.ResponseWriter, r *http.Request) {
	if !started.Load() || shuttingDown.Load() {
		http.Error(w, "not ready", http.StatusServiceUnavailable)
		return
	}
	w.Write([]byte("ok&#92;n"))
}

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /livez", livez)
	mux.HandleFunc("GET /readyz", readyz)
	mux.HandleFunc("GET /orders", func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(200 * time.Millisecond) // pretend work
		w.Write([]byte("[]&#92;n"))
	})
	srv := &amp;http.Server{Addr: ":8080", Handler: mux}

	// Listen first, so probes get a clear "503 starting" instead of
	// "connection refused" while we warm up.
	go func() {
		if err := srv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
			slog.Error("server failed", "err", err)
			os.Exit(1)
		}
	}()

	slog.Info("warming up: loading caches, running migrations check")
	time.Sleep(2 * time.Second) // stand-in for slow startup work
	started.Store(true)
	slog.Info("started")

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, os.Interrupt)
	defer stop()
	&lt;-ctx.Done()

	// 1. Fail readiness, but KEEP SERVING: proxies may still send us requests
	//    for a few seconds while the endpoint removal spreads.
	shuttingDown.Store(true)
	slog.Info("SIGTERM: readiness now failing, draining", "delay", drainDelay)
	time.Sleep(drainDelay)

	// 2. Stop accepting new connections and wait for in-flight requests.
	sctx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	if err := srv.Shutdown(sctx); err != nil {
		slog.Error("forced shutdown", "err", err)
	}
	slog.Info("shutdown complete")
}</code></pre>

<p>The matching probe config (with resource limits, so a memory leak is an OOM kill rather than a node problem):</p>
<pre><code>      terminationGracePeriodSeconds: 30  # &gt; 5 s drain + 20 s shutdown timeout
      containers:
      - name: orders
        image: registry.example.com/orders:1.8.0
        ports:
        - containerPort: 8080
        resources:
          requests: {cpu: 250m, memory: 256Mi}
          limits: {cpu: "1", memory: 256Mi}
        startupProbe:            # allows up to 24 × 5 s = 120 s to start
          httpGet: {path: /livez, port: 8080}
          periodSeconds: 5
          failureThreshold: 24
        livenessProbe:           # restart after ~30 s stuck (3 × 10 s)
          httpGet: {path: /livez, port: 8080}
          periodSeconds: 10
          timeoutSeconds: 2
          failureThreshold: 3
        readinessProbe:          # out of rotation after ~10 s (2 × 5 s)
          httpGet: {path: /readyz, port: 8080}
          periodSeconds: 5
          timeoutSeconds: 2
          failureThreshold: 2</code></pre>

<p>A real run: probes during warm-up, after startup, and right after SIGTERM. Readiness fails at once, but liveness and normal requests still succeed while the pod drains:</p>
<pre><code>$ curl -s -w " %{http_code}" localhost:8080/livez
starting  503
$ curl -s -w " %{http_code}" localhost:8080/readyz
not ready  503

# 2 s later
$ curl -s -w " %{http_code}" localhost:8080/livez
ok  200
$ curl -s -w " %{http_code}" localhost:8080/readyz
ok  200

$ kill -TERM $PID
$ curl -s -w " %{http_code}" localhost:8080/readyz
not ready  503
$ curl -s -w " %{http_code}" localhost:8080/livez
ok  200
$ curl -s -w " %{http_code}" localhost:8080/orders
[]  200

# app logs (stderr)
2026/11/08 19:31:08 INFO warming up: loading caches, running migrations check
2026/11/08 19:31:10 INFO started
2026/11/08 19:31:11 INFO SIGTERM: readiness now failing, draining delay=5s
2026/11/08 19:31:16 INFO shutdown complete</code></pre>

<p><strong>Real-world scenario.</strong> A team put a database ping in their liveness probe "to be safe": 20 pods, default timings. At 14:05 the Postgres primary fails over, which takes about 45 seconds. After 3 failed probes (30 s), the kubelet restarts all 20 pods at roughly the same moment. The database comes back at 14:05:45 to a herd of 20 cold pods opening connection pools at once, while their caches are empty. Customer-facing errors last around five minutes instead of 45 seconds, and the dashboard shows 20 restarts that look like a code crash. With liveness on <code>/livez</code>, the pods would have stayed up, returned errors (or served from cache) for 45 seconds, and recovered the moment the database did.</p>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>Dependencies in liveness.</strong> Restarting your pod never fixes someone else's database. It adds cold starts and connection storms to an outage. Keep liveness about your own process.</li>
  <li><strong>Liveness that fails under load.</strong> With the default <code>timeoutSeconds: 1</code>, a CPU-throttled pod or a long GC pause can miss probes. The kubelet restarts the busiest pods, the rest get even more load, and they fail too. Give liveness a generous timeout and a higher <code>failureThreshold</code> than readiness, so a pod is taken out of rotation long before it's killed.</li>
  <li><strong>No startup probe for a slow app.</strong> A big <code>initialDelaySeconds</code> slows every restart. Too small and the pod enters <code>CrashLoopBackOff</code>, killed before it finishes booting. A startup probe solves both.</li>
  <li><strong>The same check in readiness on every pod.</strong> A readiness check on a shared database marks <em>all</em> pods unready together. The Service then has zero endpoints, and callers get errors instead of a useful error message. See <a href="#health-checks">Health Checks</a>.</li>
  <li><strong>Exiting on SIGTERM immediately.</strong> This causes 502s on every rollout. Fail readiness, wait, then <code>Shutdown</code>.</li>
  <li><strong>Grace period too short.</strong> Drain delay + longest request + shutdown must fit in <code>terminationGracePeriodSeconds</code>. Anything left is killed with SIGKILL mid-request.</li>
  <li><strong>Probing through middleware.</strong> Auth, rate limiting or redirects on the probe path cause surprises: a redirect to a login page still ends in success, because the kubelet either follows it (same host, and the login page answers <code>200</code>) or treats an off-host redirect as a pass. Register probe handlers before the middleware, or on a separate port.</li>
</ul>

<div class="callout warn"><strong>If in doubt, leave liveness out.</strong> A missing liveness probe means a rare deadlock goes unnoticed until your alerts fire. A bad liveness probe can restart your whole fleet during someone else's outage. The Kubernetes docs themselves warn that a wrong liveness probe can cause cascading failures.</div>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>Startup = "booted yet?", liveness = "restart me", readiness = "don't send me traffic". Different failures, different actions.</li>
  <li>Liveness checks only the process itself, never dependencies; readiness gates traffic and drains shutdowns.</li>
  <li>Defaults react in about 30 s (3 × 10 s, 1 s timeout). Use startup probes for slow boots instead of long initial delays.</li>
  <li>Graceful shutdown: readiness 503, pause a few seconds, <code>srv.Shutdown</code>, all inside the grace period.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#health-checks">Health Checks</a> · <a href="#kubernetes">Kubernetes</a> · <a href="#rolling-deployments">Rolling Deployments</a> · <a href="#service-discovery">Service Discovery</a> · <a href="#cold-starts">Cold Starts</a> · <a href="#monitoring">Monitoring</a></p>
`;

CONTENT["monitoring"] = `
<p class="tldr"><strong>TL;DR</strong>: Monitoring means collecting numbers about a running system (request rate, error rate, latency, how full things are), graphing them on dashboards and alerting when they cross a line. It watches for <em>known</em> failure modes: you decide in advance what "broken" looks like. It's a car's dashboard: speed, fuel and engine temperature, plus a warning light. It tells you <em>something</em> is wrong, and roughly where to look.</p>

<h2>The problem it solves</h2>
<p>Without monitoring, the first signal of an outage is a customer. Nobody knows whether last night's deploy made checkout slower, whether the database disk will fill up this week, or whether errors went from 0.1% to 3% an hour ago. Logs alone don't answer these questions quickly: you can't eyeball a trend across ten million lines.</p>
<p>The Google SRE book defines monitoring as "collecting, processing, aggregating, and displaying real-time quantitative data about a system", and says it should answer two questions: <strong>what's broken</strong> (the symptom) and <strong>why</strong> (the cause).</p>

<h2>How it works</h2>
<ol>
  <li><strong>Instrument</strong>: code and infrastructure expose numbers, such as a request counter or a latency histogram. Exporters do it for things you didn't write (node exporter for CPU and disk, postgres exporter for the database).</li>
  <li><strong>Collect</strong>: a monitoring system gathers those numbers every 10 to 60 seconds and stores them as time series.</li>
  <li><strong>Visualize</strong>: dashboards graph the series so humans can spot changes and correlate them.</li>
  <li><strong>Alert</strong>: rules evaluate continuously; when one holds long enough, it notifies a human. See <a href="#alerts">Alerts</a>.</li>
</ol>

<figure class="diagram">
<svg viewBox="0 0 780 290" role="img" aria-label="Prometheus pulls metrics: it scrapes GET /metrics from checkout, payments and a node exporter every 15 seconds. A nightly batch job pushes to a Pushgateway, which Prometheus then scrapes. A blackbox exporter probes the public URL like a user, and Prometheus scrapes its results. Prometheus feeds Grafana dashboards and sends firing alerts to Alertmanager, which pages on-call.">
  <defs><marker id="arr-mon-1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <text x="95" y="22" text-anchor="middle" class="title">Targets</text>
  <rect class="box" x="20" y="36" width="150" height="44" rx="8"/><text x="95" y="55" text-anchor="middle">checkout</text><text x="95" y="71" text-anchor="middle" class="small">white-box: /metrics</text>
  <rect class="box" x="20" y="96" width="150" height="44" rx="8"/><text x="95" y="115" text-anchor="middle">payments</text><text x="95" y="131" text-anchor="middle" class="small">white-box: /metrics</text>
  <rect class="box" x="20" y="156" width="150" height="44" rx="8"/><text x="95" y="175" text-anchor="middle">node exporter</text><text x="95" y="191" text-anchor="middle" class="small">CPU, memory, disk</text>
  <rect class="box muted" x="20" y="226" width="150" height="44" rx="8"/><text x="95" y="245" text-anchor="middle">nightly batch job</text><text x="95" y="261" text-anchor="middle" class="small">exits in 2 minutes</text>

  <rect class="box accent" x="350" y="80" width="160" height="110" rx="10"/>
  <text x="430" y="106" text-anchor="middle" class="title">Prometheus</text>
  <text x="430" y="128" text-anchor="middle" class="small">scrapes every 15 s</text>
  <text x="430" y="145" text-anchor="middle" class="small">stores time series</text>
  <text x="430" y="162" text-anchor="middle" class="small">evaluates alert rules</text>

  <path class="line" d="M348 100 L172 60" marker-end="url(#arr-mon-1)"/>
  <path class="line" d="M348 125 L172 118" marker-end="url(#arr-mon-1)"/>
  <path class="line" d="M348 150 L172 178" marker-end="url(#arr-mon-1)"/>
  <text x="262" y="66" text-anchor="middle" class="small">pull: GET /metrics</text>

  <rect class="box" x="200" y="226" width="120" height="44" rx="8"/><text x="260" y="245" text-anchor="middle">Pushgateway</text><text x="260" y="261" text-anchor="middle" class="small">holds last value</text>
  <path class="line accent" d="M170 248 H198" marker-end="url(#arr-mon-1)"/>
  <text x="184" y="218" text-anchor="middle" class="small">push</text>
  <path class="line" d="M370 190 L300 224" marker-end="url(#arr-mon-1)"/>

  <rect class="box" x="350" y="226" width="160" height="44" rx="8"/><text x="430" y="245" text-anchor="middle">blackbox exporter</text><text x="430" y="261" text-anchor="middle" class="small">probes like a user</text>
  <path class="line" d="M450 190 V224" marker-end="url(#arr-mon-1)"/>
  <rect class="box muted" x="560" y="226" width="200" height="44" rx="8"/><text x="660" y="245" text-anchor="middle">https://shop.example.com</text><text x="660" y="261" text-anchor="middle" class="small">black-box: outside view</text>
  <path class="line dashed" d="M510 248 H558" marker-end="url(#arr-mon-1)"/>

  <rect class="box ok" x="590" y="30" width="170" height="44" rx="8"/><text x="675" y="49" text-anchor="middle">Grafana</text><text x="675" y="65" text-anchor="middle" class="small">dashboards (PromQL)</text>
  <rect class="box" x="590" y="100" width="170" height="44" rx="8"/><text x="675" y="119" text-anchor="middle">Alertmanager</text><text x="675" y="135" text-anchor="middle" class="small">group, route, silence</text>
  <rect class="box bad" x="590" y="166" width="170" height="36" rx="8"/><text x="675" y="189" text-anchor="middle">on-call pager</text>
  <path class="line" d="M590 60 L512 104" marker-end="url(#arr-mon-1)"/>
  <text x="565" y="98" text-anchor="middle" class="small">query</text>
  <path class="line" d="M512 140 L588 124" marker-end="url(#arr-mon-1)"/>
  <path class="line" d="M675 144 V164" marker-end="url(#arr-mon-1)"/>
</svg>
<figcaption>Arrows show who starts the connection. Prometheus <strong>pulls</strong> from long-running targets, so a target that stops answering shows up immediately as <code>up == 0</code>. Short-lived jobs <strong>push</strong> to a Pushgateway instead. The blackbox exporter adds the user's view from outside.</figcaption>
</figure>

<h3>What to watch: three checklists</h3>
<ul>
  <li><strong>The four golden signals</strong> (Google SRE book), for any user-facing system: <strong>latency</strong> (time to serve a request; track failed requests separately, since fast errors flatter the average), <strong>traffic</strong> (demand, such as requests per second), <strong>errors</strong> (the rate of failing requests), <strong>saturation</strong> (how "full" the service is: CPU, memory, connection pool, queue depth).</li>
  <li><strong>RED</strong> (popularised by Tom Wilkie), for every request-driven service: <strong>R</strong>ate, <strong>E</strong>rrors, <strong>D</strong>uration. It's the golden signals minus saturation, applied uniformly so every service dashboard looks the same.</li>
  <li><strong>USE</strong> (Brendan Gregg), for every <em>resource</em>: "For every resource, check utilization, saturation, and errors." Utilization is how busy it is, saturation is work queued that it can't serve yet, errors are error events. It finds bottlenecks in CPUs, disks, NICs and pools.</li>
</ul>
<p>RED tells you a service is unhappy; USE tells you which resource is the reason. Use both.</p>

<h3>Reading a golden-signals dashboard</h3>
<figure class="diagram">
<svg viewBox="0 0 780 214" role="img" aria-label="Four dashboard panels from 14:00 to 14:10 with a marker at 14:05. Traffic stays flat. Errors jump from near zero to about 4 percent. Latency p99 jumps from 180 milliseconds to 2 seconds while p50 barely moves. Database connection pool usage climbs to 100 percent of its limit.">
  <rect class="box muted" x="10" y="10" width="182" height="194" rx="8"/>
  <rect class="box muted" x="202" y="10" width="182" height="194" rx="8"/>
  <rect class="box muted" x="394" y="10" width="182" height="194" rx="8"/>
  <rect class="box muted" x="586" y="10" width="182" height="194" rx="8"/>
  <text x="101" y="32" text-anchor="middle" class="title">Traffic (req/s)</text>
  <text x="293" y="32" text-anchor="middle" class="title">Errors (5xx %)</text>
  <text x="485" y="32" text-anchor="middle" class="title">Latency</text>
  <text x="677" y="32" text-anchor="middle" class="title">Saturation</text>

  <path class="line" d="M22 170 H180 M22 50 V170"/>
  <path class="line" d="M214 170 H372 M214 50 V170"/>
  <path class="line" d="M406 170 H564 M406 50 V170"/>
  <path class="line" d="M598 170 H756 M598 50 V170"/>
  <path class="line accent dashed" d="M101 50 V170 M293 50 V170 M485 50 V170 M677 50 V170"/>

  <path class="line ok" d="M22 96 L38 92 L54 98 L70 94 L86 97 L101 93 L117 99 L133 95 L149 97 L165 92 L180 96"/>
  <text x="140" y="80" text-anchor="middle" class="small">~1,200 flat</text>

  <path class="line bad" d="M214 164 L240 165 L266 163 L293 164 L305 100 L320 86 L340 90 L356 84 L372 88"/>
  <text x="250" y="150" text-anchor="middle" class="small">0.1%</text>
  <text x="340" y="74" text-anchor="middle" class="small">4%</text>

  <path class="line bad" d="M406 140 L430 142 L456 139 L485 141 L497 72 L515 64 L535 68 L550 62 L564 66"/>
  <path class="line ok dashed" d="M406 158 L485 158 L500 155 L564 156"/>
  <text x="440" y="128" text-anchor="middle" class="small">p99 180 ms</text>
  <text x="528" y="54" text-anchor="middle" class="small">p99 2 s</text>
  <text x="440" y="150" text-anchor="middle" class="small">p50 flat</text>

  <path class="line bad dashed" d="M598 62 H756"/>
  <text x="628" y="58" text-anchor="middle" class="small">limit</text>
  <path class="line bad" d="M598 130 L620 128 L645 131 L677 129 L690 95 L705 70 L720 63 L740 62 L756 62"/>
  <text x="606" y="118" class="small">pool in use</text>

  <text x="22" y="188" class="small">14:00</text><text x="180" y="188" text-anchor="end" class="small">14:10</text>
  <text x="214" y="188" class="small">14:00</text><text x="372" y="188" text-anchor="end" class="small">14:10</text>
  <text x="406" y="188" class="small">14:00</text><text x="564" y="188" text-anchor="end" class="small">14:10</text>
  <text x="598" y="188" class="small">14:00</text><text x="756" y="188" text-anchor="end" class="small">14:10</text>
</svg>
<figcaption>Same traffic, more errors, slower tail, a full pool: the problem is inside, not a traffic spike. The p50 line shows why averages and medians hide trouble (see <a href="#p99-latency">p99 Latency</a>).</figcaption>
</figure>

<h2>Methods and models compared</h2>
<table>
  <tr><th></th><th>Golden signals</th><th>RED</th><th>USE</th></tr>
  <tr><td>Point of view</td><td>the user of a service</td><td>each request-driven service</td><td>each resource</td></tr>
  <tr><td>Signals</td><td>latency, traffic, errors, saturation</td><td>rate, errors, duration</td><td>utilization, saturation, errors</td></tr>
  <tr><td>Typical source</td><td>app metrics, load balancer, black-box probes</td><td>HTTP/gRPC middleware</td><td>node exporter, cAdvisor, DB and pool stats</td></tr>
  <tr><td>Answers</td><td>"are users hurting?"</td><td>"which service is unhappy?"</td><td>"which resource is the bottleneck?"</td></tr>
</table>
<p>And the two ways numbers get collected:</p>
<table>
  <tr><th></th><th>Pull (Prometheus scrape)</th><th>Push (OTLP, StatsD, Pushgateway, remote write)</th></tr>
  <tr><td>Who connects</td><td>the monitoring server calls each target</td><td>the app sends to a collector or backend</td></tr>
  <tr><td>Target down?</td><td>visible for free: the scrape fails, <code>up == 0</code></td><td>silence looks like "no traffic"; needs separate checks</td></tr>
  <tr><td>Needs</td><td>a list of targets (service discovery), reachability</td><td>only an outbound route to the collector</td></tr>
  <tr><td>Good for</td><td>long-running services on a network you control</td><td>short-lived jobs, serverless, devices behind NAT</td></tr>
</table>
<p><strong>White-box</strong> monitoring uses what the system reports about itself (the metrics above). <strong>Black-box</strong> monitoring tests what a user sees from outside. White-box catches problems early and explains them; black-box catches what white-box can't see, such as expired TLS certificates, DNS mistakes, or a dead load balancer in front of healthy pods.</p>

<h2>Example</h2>
<p><strong>RED metrics for a Go service</strong> using <code>client_golang</code>'s ready-made <code>promhttp</code> middleware, so there's no hand-written timing code:</p>
<pre><code>// RED per route: Rate and Errors from one counter, Duration from a histogram.
// The in-flight gauge is a cheap saturation signal.
var (
	requests = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "http_requests_total",
		Help: "HTTP requests by route and status code.",
	}, []string{"route", "code"})

	duration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "http_request_duration_seconds",
		Help:    "HTTP request latency by route.",
		Buckets: []float64{0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5},
	}, []string{"route"})

	inFlight = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "http_requests_in_flight",
		Help: "Requests currently being served.",
	})
)

// instrument wraps a handler with promhttp's ready-made middleware.
// route is the pattern ("/orders"), never the raw path ("/orders/8812"),
// or every ID becomes its own time series.
func instrument(route string, h http.Handler) http.Handler {
	l := prometheus.Labels{"route": route}
	return promhttp.InstrumentHandlerInFlight(inFlight,
		promhttp.InstrumentHandlerDuration(duration.MustCurryWith(l),
			promhttp.InstrumentHandlerCounter(requests.MustCurryWith(l), h)))
}

func checkout(w http.ResponseWriter, r *http.Request) {
	time.Sleep(time.Duration(20+rand.IntN(100)) * time.Millisecond)
	if rand.IntN(10) == 0 {
		http.Error(w, "payment provider timeout", http.StatusBadGateway)
		return
	}
	w.Write([]byte("ok&#92;n"))
}

func main() {
	mux := http.NewServeMux()
	mux.Handle("POST /checkout", instrument("/checkout", http.HandlerFunc(checkout)))
	mux.Handle("GET /metrics", promhttp.Handler()) // Prometheus pulls this
	http.ListenAndServe(":8080", mux)
}</code></pre>

<p>Real <code>/metrics</code> output after 50 requests (from an <code>httptest</code> run; the default registry also exports Go runtime and process metrics, trimmed here except one):</p>
<pre><code># HELP go_goroutines Number of goroutines that currently exist.
# TYPE go_goroutines gauge
go_goroutines 13
# HELP http_request_duration_seconds HTTP request latency by route.
# TYPE http_request_duration_seconds histogram
http_request_duration_seconds_bucket{route="/checkout",le="0.025"} 2
http_request_duration_seconds_bucket{route="/checkout",le="0.05"} 16
http_request_duration_seconds_bucket{route="/checkout",le="0.1"} 39
http_request_duration_seconds_bucket{route="/checkout",le="0.25"} 50
http_request_duration_seconds_bucket{route="/checkout",le="0.5"} 50
http_request_duration_seconds_bucket{route="/checkout",le="1"} 50
http_request_duration_seconds_bucket{route="/checkout",le="2.5"} 50
http_request_duration_seconds_bucket{route="/checkout",le="+Inf"} 50
http_request_duration_seconds_sum{route="/checkout"} 3.5481269199999996
http_request_duration_seconds_count{route="/checkout"} 50
# HELP http_requests_in_flight Requests currently being served.
# TYPE http_requests_in_flight gauge
http_requests_in_flight 0
# HELP http_requests_total HTTP requests by route and status code.
# TYPE http_requests_total counter
http_requests_total{code="200",route="/checkout"} 47
http_requests_total{code="502",route="/checkout"} 3</code></pre>

<p>Prometheus config: scrape the service, and probe the public site from outside with the blackbox exporter:</p>
<pre><code>scrape_configs:
  - job_name: checkout
    scrape_interval: 15s
    kubernetes_sd_configs:          # discover pods instead of listing IPs
      - role: pod
    relabel_configs:                # keep only pods labelled app=checkout
      - source_labels: [__meta_kubernetes_pod_label_app]
        regex: checkout
        action: keep

  - job_name: blackbox
    metrics_path: /probe
    params:
      module: [http_2xx]            # expect a 2xx from the URL below
    static_configs:
      - targets: ['https://shop.example.com/healthz']
    relabel_configs:                # turn the target into ?target=...
      - source_labels: [__address__]
        target_label: __param_target
      - source_labels: [__param_target]
        target_label: instance
      - target_label: __address__
        replacement: blackbox-exporter:9115</code></pre>

<p>The dashboard queries behind the four panels above (PromQL; <a href="#metrics">Metrics</a> explains <code>rate</code> and <code>histogram_quantile</code>):</p>
<pre><code># Traffic: requests per second, per route
sum by (route) (rate(http_requests_total[5m]))

# Errors: share of requests that returned 5xx
sum(rate(http_requests_total{code=~"5.."}[5m]))
  / sum(rate(http_requests_total[5m]))

# Latency: p99 and p50 from the histogram
histogram_quantile(0.99, sum by (le) (rate(http_request_duration_seconds_bucket[5m])))
histogram_quantile(0.50, sum by (le) (rate(http_request_duration_seconds_bucket[5m])))

# Saturation: DB pool usage vs its limit (from collectors.NewDBStatsCollector)
max by (pod) (go_sql_in_use_connections{db_name="checkout"}
  / go_sql_max_open_connections{db_name="checkout"})

# Black-box: 0 means the public URL failed its probe; up == 0 means a scrape failed
probe_success{job="blackbox"}
up{job="checkout"} == 0</code></pre>

<p><strong>Real-world scenario.</strong> It's 14:05. A page fires: the checkout error rate has been above 2% for 5 minutes. The on-call engineer opens the checkout dashboard. Traffic is flat at about 1,200 req/s, so it isn't a spike. The 5xx rate is 4% and p99 latency went from 180 ms to 2 s, while p50 barely moved, so only some requests are slow. The saturation panel shows the database connection pool pinned at its limit since 14:04. The USE panel for the database host shows normal CPU, so the database isn't overloaded; connections are being held too long. The deploy annotation at 14:03 points to a release that added a slow query inside a transaction. Rolling back clears all four panels within two minutes. Monitoring didn't name the query, but it narrowed the search from "everything" to "one service, one pool, one deploy". Traces and logs (see <a href="#observability">Observability</a>) find the rest.</p>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>Dashboards nobody reads.</strong> Forty panels per service hide the four that matter. Put the golden signals at the top of every service dashboard, in the same order, and add detail panels below.</li>
  <li><strong>Watching causes, paging on causes.</strong> "CPU at 90%" is worth a graph, not a 3 a.m. page; the SRE book recommends putting far more effort into catching symptoms than causes. Page on what users feel, and use cause metrics to diagnose.</li>
  <li><strong>Averages.</strong> A 50 ms average can hide a 3 s p99 that hits your best customers. Record histograms and graph p50, p95 and p99.</li>
  <li><strong>Only white-box.</strong> Every pod reports healthy while the certificate on the load balancer expired an hour ago. Add at least one black-box probe per public entry point.</li>
  <li><strong>Raw paths and user IDs as labels.</strong> <code>route="/orders/8812"</code> creates a new time series for every order and can take Prometheus down. Use route patterns (see <a href="#metrics">Metrics</a>).</li>
  <li><strong>Monitoring that shares the outage.</strong> If Prometheus runs in the same cluster that just failed, it goes dark when you need it most. Monitor the monitor from somewhere else, even if it's a single external uptime check.</li>
  <li><strong>Pushgateway as a general push endpoint.</strong> Prometheus's docs say its only valid use case is usually capturing the outcome of a service-level batch job. Used for services, it becomes a single point of failure, loses <code>up</code>, and remembers series forever.</li>
</ul>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>Monitoring watches known failure modes: collect numbers, graph them, alert on the ones users feel.</li>
  <li>Golden signals for user-facing health, RED per service, USE per resource.</li>
  <li>Pull makes "target down" visible for free; push suits short-lived and unreachable workloads.</li>
  <li>Combine white-box metrics (early, explanatory) with black-box probes (the user's real view).</li>
</ul></div>

<p><strong>Related:</strong> <a href="#metrics">Metrics</a> · <a href="#alerts">Alerts</a> · <a href="#observability">Observability</a> · <a href="#slis">SLIs</a> · <a href="#health-checks">Health Checks</a> · <a href="#p99-latency">p99 Latency</a></p>
`;

CONTENT["logging"] = `
<p class="tldr"><strong>TL;DR</strong>: A log is a timestamped record of one thing that happened, written by your code. Make each line <strong>structured</strong> (JSON key/value pairs, not prose), give it a <strong>level</strong>, stamp it with a <strong>request ID</strong> so every line of one request can be pulled together, and never put secrets or personal data in it. Logs are the flight recorder: metrics tell you <em>that</em> checkout is failing, logs tell you <em>which order failed and why</em>.</p>

<h2>The problem it solves</h2>
<p>In production you can't attach a debugger; you only have what the code wrote down at the time. Bad logging fails in predictable ways:</p>
<ul>
  <li><strong>Unsearchable text.</strong> <code>"user 42 failed to pay 19.99"</code> can only be grepped, not filtered by user, amount or provider.</li>
  <li><strong>No correlation.</strong> At 2,000 requests per second, lines from different requests interleave, and you can't follow one request into the next service.</li>
  <li><strong>Noise or silence.</strong> Debug spam buries the one useful line and costs a fortune; or the error path logs nothing useful.</li>
  <li><strong>Leaks.</strong> A logged password or card number is copied into every system the logs flow through.</li>
</ul>

<h2>How it works</h2>
<p>In a modern setup the application does one thing: write <strong>one JSON object per line to stdout</strong>. Everything else, shipping, enriching, storing and searching, is the platform's job:</p>

<figure class="diagram">
<svg viewBox="0 0 780 222" role="img" aria-label="Log pipeline: the service writes JSON lines to stdout; the container runtime writes them to files on the node; a node agent such as Fluent Bit, Vector or the OpenTelemetry Collector tails, parses, enriches and filters them; they are stored in Loki, Elasticsearch or CloudWatch; and queried in Grafana or Kibana.">
  <defs><marker id="arr-log-1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <text x="235" y="22" text-anchor="middle" class="small">inside the pod / VM</text>
  <path class="line dashed" d="M10 30 H460" style="stroke: var(--line)"/>
  <text x="625" y="22" text-anchor="middle" class="small">central, shared</text>
  <path class="line dashed" d="M475 30 H770" style="stroke: var(--line)"/>

  <rect class="box accent" x="10" y="44" width="140" height="80" rx="8"/>
  <text x="80" y="70" text-anchor="middle" class="title">your service</text>
  <text x="80" y="90" text-anchor="middle" class="small">slog JSON → stdout</text>
  <text x="80" y="106" text-anchor="middle" class="small">one event per line</text>

  <rect class="box" x="165" y="44" width="140" height="80" rx="8"/>
  <text x="235" y="70" text-anchor="middle" class="title">runtime</text>
  <text x="235" y="90" text-anchor="middle" class="small">writes to node disk</text>
  <text x="235" y="106" text-anchor="middle" class="small">/var/log/containers</text>

  <rect class="box" x="320" y="44" width="140" height="80" rx="8"/>
  <text x="390" y="70" text-anchor="middle" class="title">node agent</text>
  <text x="390" y="90" text-anchor="middle" class="small">Fluent Bit, Vector,</text>
  <text x="390" y="106" text-anchor="middle" class="small">OTel Collector</text>

  <rect class="box" x="475" y="44" width="140" height="80" rx="8"/>
  <text x="545" y="70" text-anchor="middle" class="title">log store</text>
  <text x="545" y="90" text-anchor="middle" class="small">Loki, Elasticsearch,</text>
  <text x="545" y="106" text-anchor="middle" class="small">CloudWatch Logs</text>

  <rect class="box ok" x="630" y="44" width="140" height="80" rx="8"/>
  <text x="700" y="70" text-anchor="middle" class="title">query</text>
  <text x="700" y="90" text-anchor="middle" class="small">Grafana, Kibana</text>
  <text x="700" y="106" text-anchor="middle" class="small">by request_id, level</text>

  <path class="line" d="M150 84 H163" marker-end="url(#arr-log-1)"/>
  <path class="line" d="M305 84 H318" marker-end="url(#arr-log-1)"/>
  <path class="line" d="M460 84 H473" marker-end="url(#arr-log-1)"/>
  <path class="line" d="M615 84 H628" marker-end="url(#arr-log-1)"/>

  <path class="line dashed" d="M390 124 V146"/>
  <rect class="box muted" x="190" y="146" width="400" height="58" rx="6"/>
  <text x="390" y="166" text-anchor="middle" class="small">tail files · parse JSON · add pod, namespace, node labels</text>
  <text x="390" y="182" text-anchor="middle" class="small">drop or sample noisy lines · redact · buffer and retry</text>
  <text x="390" y="198" text-anchor="middle" class="small">so an outage of the store never blocks your app</text>
</svg>
<figcaption>The app stays dumb: it writes to stdout and never knows where logs end up. Writing directly to a remote store from request handlers makes your latency depend on the log backend.</figcaption>
</figure>

<p>A useful line has a <strong>fixed message</strong> (<code>"charge failed"</code>) you can count and group, <strong>fields</strong> for the variables (<code>user_id</code>, <code>provider</code>, <code>err</code>), a <strong>level</strong>, <strong>context</strong> attached once per request (service, version, request ID, trace ID), and a <strong>UTC</strong> ISO 8601 timestamp so lines from many machines sort correctly.</p>

<table>
  <tr><th>Level</th><th>slog value</th><th>Use it for</th><th>Example</th></tr>
  <tr><td>DEBUG</td><td><code>-4</code></td><td>developer detail; off in production by default</td><td><code>"cache miss", "key", k</code></td></tr>
  <tr><td>INFO</td><td><code>0</code></td><td>normal, notable events: one per request, state changes</td><td><code>"order created"</code></td></tr>
  <tr><td>WARN</td><td><code>4</code></td><td>something odd that was handled; worth a look if it repeats</td><td><code>"retrying", "attempt", 2</code></td></tr>
  <tr><td>ERROR</td><td><code>8</code></td><td>an operation failed and someone may need to act</td><td><code>"charge failed", "err", err</code></td></tr>
</table>
<p>Go's <code>log/slog</code> has no FATAL level. Log at ERROR and return; let <code>main</code> decide to exit.</p>

<h3>Correlation: one ID, every service</h3>
<figure class="diagram">
<svg viewBox="0 0 780 270" role="img" aria-label="A request ID created at the gateway is passed in the X-Request-ID header to checkout and then payments. Each service writes log lines containing request_id 7f3a. A single query for that request_id returns all lines from all three services in time order.">
  <defs><marker id="arr-log-2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <rect class="box" x="30" y="20" width="160" height="44" rx="8"/><text x="110" y="47" text-anchor="middle" class="title">gateway</text>
  <rect class="box" x="310" y="20" width="160" height="44" rx="8"/><text x="390" y="47" text-anchor="middle" class="title">checkout</text>
  <rect class="box" x="590" y="20" width="160" height="44" rx="8"/><text x="670" y="47" text-anchor="middle" class="title">payments</text>
  <path class="line accent" d="M190 42 H308" marker-end="url(#arr-log-2)"/>
  <text x="249" y="34" text-anchor="middle" class="small">X-Request-ID: 7f3a</text>
  <path class="line accent" d="M470 42 H588" marker-end="url(#arr-log-2)"/>
  <text x="529" y="34" text-anchor="middle" class="small">X-Request-ID: 7f3a</text>

  <rect class="box muted" x="20" y="96" width="180" height="40" rx="4"/>
  <text x="110" y="113" text-anchor="middle" class="small">request_id=7f3a</text>
  <text x="110" y="128" text-anchor="middle" class="small">"route matched"</text>
  <rect class="box muted" x="300" y="96" width="180" height="40" rx="4"/>
  <text x="390" y="113" text-anchor="middle" class="small">request_id=7f3a</text>
  <text x="390" y="128" text-anchor="middle" class="small">"charge failed" 502</text>
  <rect class="box bad" x="580" y="96" width="180" height="40" rx="4"/>
  <text x="670" y="113" text-anchor="middle" class="small">request_id=7f3a</text>
  <text x="670" y="128" text-anchor="middle" class="small">"acme-pay timeout 2s"</text>
  <path class="line dashed" d="M110 64 V94"/>
  <path class="line dashed" d="M390 64 V94"/>
  <path class="line dashed" d="M670 64 V94"/>

  <path class="line" d="M110 136 L330 182" marker-end="url(#arr-log-2)"/>
  <path class="line" d="M390 136 V180" marker-end="url(#arr-log-2)"/>
  <path class="line" d="M670 136 L450 182" marker-end="url(#arr-log-2)"/>
  <rect class="box ok" x="190" y="184" width="400" height="66" rx="8"/>
  <text x="390" y="206" text-anchor="middle" class="title">one query, whole story</text>
  <text x="390" y="224" text-anchor="middle" class="small">{namespace="shop"} | json | request_id="7f3a9c0e5b21d4f8"</text>
  <text x="390" y="240" text-anchor="middle" class="small">3 services, 6 lines, in time order</text>
</svg>
<figcaption>Generate the ID at the edge (or accept a trusted one), pass it on every outgoing call, and put it on every log line and in error responses. With OpenTelemetry the trace ID plays the same role and also links logs to traces.</figcaption>
</figure>

<h3>What never goes in a log</h3>
<table>
  <tr><th>Never log</th><th>Why</th><th>Log instead</th></tr>
  <tr><td>passwords, API keys, tokens, session cookies, <code>Authorization</code> headers</td><td>anyone with log access can impersonate the user or service</td><td>nothing, or a key ID / last 4 characters</td></tr>
  <tr><td>full card numbers, bank details</td><td>payment card rules (PCI DSS) forbid storing them in logs</td><td>a payment token or the last 4 digits</td></tr>
  <tr><td>personal data: email, phone, address, ID numbers, health data</td><td>privacy laws in many countries; logs are copied widely and kept long</td><td>an internal user ID</td></tr>
  <tr><td>full request and response bodies</td><td>contain all of the above, and are huge</td><td>size, content type, a few chosen fields</td></tr>
</table>

<h2>Example</h2>
<p><strong>Structured logging in Go with <code>log/slog</code></strong>: a JSON handler, redaction, a runtime-adjustable level, and middleware that gives every request its own logger carrying a request ID.</p>
<pre><code>// Secret values redact themselves, whatever handler or key they end up under.
type Secret string

func (Secret) LogValue() slog.Value { return slog.StringValue("[REDACTED]") }

// Change at runtime (e.g. from an admin endpoint) without a restart.
var level = new(slog.LevelVar) // zero value = INFO

func NewLogger() *slog.Logger {
	h := slog.NewJSONHandler(os.Stdout, &amp;slog.HandlerOptions{
		Level: level,
		// Belt and braces: mask well-known sensitive keys at any depth.
		ReplaceAttr: func(groups []string, a slog.Attr) slog.Attr {
			if a.Key == slog.TimeKey &amp;&amp; len(groups) == 0 {
				a.Value = slog.TimeValue(a.Value.Time().UTC()) // logs in UTC, always
			}
			switch a.Key {
			case "password", "authorization", "token":
				return slog.String(a.Key, "[REDACTED]")
			}
			return a
		},
	})
	return slog.New(h).With("service", "checkout", "version", "1.4.2")
}

type ctxKey struct{}

// L returns the request-scoped logger, or the default one outside a request.
func L(ctx context.Context) *slog.Logger {
	if l, ok := ctx.Value(ctxKey{}).(*slog.Logger); ok {
		return l
	}
	return slog.Default()
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}

// Logging middleware: one request ID per request, reused by every log line,
// echoed back to the client. Copy it onto outgoing calls as well.
func WithRequestLog(base *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Request-ID")
		if id == "" {
			b := make([]byte, 8)
			rand.Read(b)
			id = hex.EncodeToString(b)
		}
		w.Header().Set("X-Request-ID", id)
		l := base.With("request_id", id)
		ctx := context.WithValue(r.Context(), ctxKey{}, l)

		sw := &amp;statusWriter{ResponseWriter: w, status: http.StatusOK}
		start := time.Now()
		next.ServeHTTP(sw, r.WithContext(ctx))

		lvl := slog.LevelInfo
		if sw.status &gt;= 500 {
			lvl = slog.LevelError
		}
		l.LogAttrs(ctx, lvl, "http request",
			slog.String("method", r.Method),
			slog.String("path", r.URL.Path),
			slog.Int("status", sw.status),
			slog.Int64("duration_ms", time.Since(start).Milliseconds()),
		)
	})
}

func createOrder(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	card := Secret(r.FormValue("card")) // never log the raw value
	L(ctx).Debug("validating cart", "items", 3) // dropped at INFO
	if r.FormValue("user") == "u_42" {
		L(ctx).Error("charge failed", "user_id", "u_42", "card", card,
			"provider", "acme-pay", "err", "upstream timeout after 2s")
		http.Error(w, "payment failed", http.StatusBadGateway)
		return
	}
	L(ctx).Info("order created", "user_id", r.FormValue("user"), "order_id", "o_981", "card", card)
	w.WriteHeader(http.StatusCreated)
}

func main() {
	logger := NewLogger()
	slog.SetDefault(logger)
	mux := http.NewServeMux()
	mux.HandleFunc("POST /orders", createOrder)
	http.ListenAndServe(":8080", WithRequestLog(logger, mux))
}</code></pre>

<p>Two requests (the second arrives with an ID from an upstream service) and a login attempt produce this real output. Note the missing DEBUG line, the redacted card and password, and the shared <code>request_id</code> per request:</p>
<pre><code>{"time":"2026-11-08T12:26:36.467084Z","level":"INFO","msg":"order created","service":"checkout","version":"1.4.2","request_id":"e16642bcd1eb8c63","user_id":"u_7","order_id":"o_981","card":"[REDACTED]"}
{"time":"2026-11-08T12:26:36.467429Z","level":"INFO","msg":"http request","service":"checkout","version":"1.4.2","request_id":"e16642bcd1eb8c63","method":"POST","path":"/orders","status":201,"duration_ms":0}
{"time":"2026-11-08T12:26:36.467475Z","level":"ERROR","msg":"charge failed","service":"checkout","version":"1.4.2","request_id":"7f3a9c0e5b21d4f8","user_id":"u_42","card":"[REDACTED]","provider":"acme-pay","err":"upstream timeout after 2s"}
{"time":"2026-11-08T12:26:36.467487Z","level":"ERROR","msg":"http request","service":"checkout","version":"1.4.2","request_id":"7f3a9c0e5b21d4f8","method":"POST","path":"/orders","status":502,"duration_ms":0}
{"time":"2026-11-08T12:26:36.467492Z","level":"INFO","msg":"login attempt","service":"checkout","version":"1.4.2","user_id":"u_7","password":"[REDACTED]"}</code></pre>
<p><code>slog.SetDefault</code> also routes the old <code>log.Printf</code> calls through the same JSON handler, so legacy code doesn't break the format.</p>

<p><strong>Real-world scenario.</strong> It's 14:05. Support forwards a customer complaint: "payment failed, reference 7f3a9c0e5b21d4f8". The error page showed the request ID, so on-call runs one query, <code>{namespace="shop"} | json | request_id="7f3a9c0e5b21d4f8"</code>, and in seconds sees the gateway, checkout and payments lines for that request: payments timed out calling acme-pay after 2 s. A second query, <code>{app="payments"} | json | level="ERROR" | provider="acme-pay"</code>, shows 300 similar errors since 13:58. That is a provider incident, not a bug. Without structure and IDs, the same investigation means grepping a time window across millions of interleaved lines.</p>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>Cost grows with traffic.</strong> 2,000 requests/s × 5 lines × 500 bytes is 5 MB/s, about 432 GB per day before indexing and replication. Log one summary line per request, keep DEBUG off, and set retention per level (errors longer, access logs shorter).</li>
  <li><strong>Sampling, carefully.</strong> <code>slog</code> has no built-in sampler; wrap a handler or let the agent drop lines. Keep 100% of WARN and ERROR, and sample successful access logs (say 1 in 100). Never sample away the evidence you'll need: errors and slow requests.</li>
  <li><strong>Variables in the message.</strong> <code>fmt.Sprintf("payment %s failed", id)</code> makes every message unique, so you can't group or count them. Fixed message, variables in fields.</li>
  <li><strong>Log-and-return.</strong> Logging an error and also returning it means every layer logs it again: one failure, five lines. Either handle (and log) it, or wrap and return it; log once at the boundary.</li>
  <li><strong>Logs as metrics.</strong> Counting errors per minute with log queries is slow and expensive. Use a counter (see <a href="#metrics">Metrics</a>) for rates and alerts, and logs for the details.</li>
  <li><strong>Trusting the client's request ID.</strong> Accept <code>X-Request-ID</code> only from your own gateway, and cap its length; otherwise anyone can inject arbitrary text into your logs.</li>
</ul>

<div class="callout warn"><strong>Redaction is a safety net, not a plan.</strong> Key-based scrubbing only catches the keys you thought of. A token pasted into an error string, or a whole struct logged with <code>"%+v"</code>, slips through. Decide what is logged at the call site, and give sensitive types a <code>LogValue</code> method so they redact themselves.</div>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>One JSON object per line to stdout; the platform ships, stores and indexes it.</li>
  <li>Fixed messages, variables in fields, a consistent level vocabulary, UTC timestamps.</li>
  <li>A request ID (or trace ID) on every line and every outgoing call turns scattered lines into one story.</li>
  <li>No secrets or personal data; budget volume and sample successes, never errors.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#metrics">Metrics</a> · <a href="#distributed-tracing">Distributed Tracing</a> · <a href="#observability">Observability</a> · <a href="#monitoring">Monitoring</a> · <a href="#secrets-management">Secrets Management</a> · <a href="#real-world-observability-stack">Real-World Observability Stack</a></p>
`;

CONTENT["metrics"] = `
<p class="tldr"><strong>TL;DR</strong>: A metric is a number measured over time: requests per second, error ratio, p99 latency, queue depth. Each one is cheap to collect and store because it's aggregated (a counter, not a line per request), so it's what dashboards and alerts are built on. Logs are the diary; metrics are the car's dashboard gauges.</p>

<h2>The problem it solves</h2>
<p>To know whether a service is healthy right now, and how that compares with yesterday, you need numbers you can graph and alert on. Logs can't do it cheaply: counting errors per minute by scanning millions of log lines is slow and expensive. A metric keeps a running total in memory, and the monitoring system samples it every few seconds. One counter costs the same at 10 or 10,000 requests per second.</p>
<p>Done badly, metrics fail in two ways: they <strong>mislead</strong> (an average that hides slow requests), or they <strong>explode</strong> (a label with millions of values that takes down the metrics database).</p>

<h2>How it works</h2>
<p>In the Prometheus model, which most tools now follow, your service keeps metrics in memory and exposes them as text on <code>/metrics</code>. Prometheus scrapes that endpoint on an interval (15 s is common) and stores each value as a sample in a <strong>time series</strong>. A series is identified by a metric name plus a set of labels:</p>

<figure class="diagram">
<svg viewBox="0 0 780 300" role="img" aria-label="A time series is a metric name, a set of labels and a value. Left chart: a counter climbs, drops to zero when the process restarts, and climbs again. Right chart: rate() of the same counter is a steady per-second line with a spike, and the restart is handled.">
  <rect class="box accent" x="20" y="14" width="210" height="44" rx="6"/>
  <text x="125" y="41" text-anchor="middle" class="title">http_requests_total</text>
  <rect class="box" x="240" y="14" width="380" height="44" rx="6"/>
  <text x="430" y="41" text-anchor="middle">{route="/orders/{id}", method="GET", code="500"}</text>
  <rect class="box ok" x="630" y="14" width="130" height="44" rx="6"/>
  <text x="695" y="41" text-anchor="middle" class="title">1027</text>
  <text x="125" y="76" text-anchor="middle" class="small">metric name: what</text>
  <text x="430" y="76" text-anchor="middle" class="small">labels: which slice; each unique set is its own series</text>
  <text x="695" y="76" text-anchor="middle" class="small">value at scrape time</text>

  <text x="220" y="116" text-anchor="middle" class="title">counter: raw value</text>
  <path class="line" d="M60 130 V250 H380"/>
  <path class="line accent" d="M60 240 L120 215 L180 190 L230 168 L230 245 L280 225 L330 200 L380 176"/>
  <text x="240" y="150" class="small">restart: back to 0</text>
  <text x="220" y="268" text-anchor="middle" class="small">time →</text>

  <text x="580" y="116" text-anchor="middle" class="title">rate(...[5m]): per second</text>
  <path class="line" d="M420 130 V250 H740"/>
  <path class="line ok" d="M420 202 L500 200 L580 203 L625 199 L645 160 L675 158 L695 200 L740 201"/>
  <text x="660" y="148" text-anchor="middle" class="small">traffic spike</text>
  <text x="520" y="222" text-anchor="middle" class="small">restart is invisible here</text>
  <text x="580" y="268" text-anchor="middle" class="small">time →</text>
  <text x="390" y="292" text-anchor="middle" class="small">Raw counters are meaningless on a graph; you almost always look at their rate.</text>
</svg>
<figcaption>Counters only go up and reset to zero when the process restarts. <code>rate()</code> turns them into "per second", detects resets, and averages over the window you choose.</figcaption>
</figure>

<h3>The four metric types</h3>
<table>
  <tr><th>Type</th><th>What it is</th><th>Examples</th><th>Query with</th><th>Aggregate across instances?</th></tr>
  <tr><td>Counter</td><td>monotonically increasing total; resets on restart</td><td>requests, errors, bytes sent</td><td><code>rate()</code>, <code>increase()</code></td><td>yes: <code>sum(rate(...))</code></td></tr>
  <tr><td>Gauge</td><td>current value; goes up and down</td><td>in-flight requests, queue depth, memory, temperature</td><td>the value, <code>avg_over_time()</code>, <code>max()</code></td><td>yes (sum, max, avg)</td></tr>
  <tr><td>Histogram</td><td>counts of observations per bucket (<code>le</code> = "less than or equal"), plus <code>_sum</code> and <code>_count</code></td><td>request latency, response size</td><td><code>histogram_quantile()</code> over <code>rate(..._bucket)</code></td><td>yes: sum buckets, then compute the quantile</td></tr>
  <tr><td>Summary</td><td>quantiles computed inside the process, plus <code>_sum</code> and <code>_count</code></td><td>latency in a single process</td><td>read the quantile series directly</td><td><strong>no</strong>: you can't average p99s</td></tr>
</table>
<p>Prefer histograms over summaries in services that run more than one instance. The price of a histogram is that quantiles are estimates: <code>histogram_quantile</code> interpolates linearly inside a bucket, so put bucket bounds near the values you care about, such as your latency SLO. Go's <code>prometheus.DefBuckets</code> are 5 ms to 10 s.</p>

<h3>Why averages lie</h3>
<figure class="diagram">
<svg viewBox="0 0 780 214" role="img" aria-label="1,000 requests: 950 take about 40 ms, 20 take 150 ms, 30 take 2 seconds. The median is 40 ms and the average is 101 ms, both well under the 300 ms target, but the p99 is 2,000 ms.">
  <text x="390" y="20" text-anchor="middle" class="small">1,000 requests: 950 take ~40 ms, 20 take ~150 ms, 30 take ~2 s (scale: 0 to 2,000 ms)</text>
  <path class="line accent dashed" d="M240 36 V178"/>
  <text x="240" y="194" text-anchor="middle" class="small">SLO 300 ms</text>
  <path class="line" d="M150 36 V178"/>

  <text x="140" y="62" text-anchor="end">p50 (median)</text>
  <rect class="box ok" x="150" y="46" width="12" height="24" rx="2"/>
  <text x="250" y="62" class="small">40 ms</text>

  <text x="140" y="104" text-anchor="end">average</text>
  <rect class="box ok" x="150" y="88" width="30" height="24" rx="2"/>
  <text x="250" y="104" class="small">101 ms: the dashboard says all is well</text>

  <text x="140" y="146" text-anchor="end">p99</text>
  <rect class="box bad" x="150" y="130" width="600" height="24" rx="2"/>
  <text x="495" y="146" text-anchor="middle" class="small">2,000 ms: 1 in every 100 requests waits at least this long</text>
</svg>
<figcaption>An average mixes the fast majority with the slow few and describes nobody. Percentiles (p50, p95, p99) describe what real users actually wait. See <a href="#p99-latency">p99 Latency</a>.</figcaption>
</figure>

<h3>Labels and cardinality</h3>
<p>Every unique combination of label values is a separate series, held in memory and stored on disk. The count multiplies:</p>
<ul>
  <li><code>route</code> (20) × <code>method</code> (4) × <code>code</code> (8) = 640 series per instance; × 50 pods = 32,000. Fine.</li>
  <li>Add <code>user_id</code> with 100,000 users and the same metric can grow to 3.2 billion series. Prometheus runs out of memory long before that.</li>
</ul>
<p>Good labels have a small, bounded set of values: route <em>pattern</em>, method, status code, region, a handful of tenants. Never user IDs, emails, raw URLs, request IDs or error messages; those belong in <a href="#logging">logs</a> and <a href="#distributed-tracing">traces</a>.</p>

<h2>Example</h2>
<p><strong>Instrumenting a Go HTTP service with <code>client_golang</code></strong>: a counter, a histogram and a gauge, labelled by route pattern.</p>
<pre><code>package main

import (
	"net/http"
	"strconv"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

type Metrics struct {
	requests *prometheus.CounterVec
	duration *prometheus.HistogramVec
	inFlight prometheus.Gauge
}

func NewMetrics(reg prometheus.Registerer) *Metrics {
	f := promauto.With(reg)
	return &amp;Metrics{
		// Counter: only goes up. Query it with rate().
		requests: f.NewCounterVec(prometheus.CounterOpts{
			Name: "http_requests_total",
			Help: "HTTP requests by route, method and status code.",
		}, []string{"route", "method", "code"}),
		// Histogram: counts per latency bucket, so p50/p99 can be computed
		// later, across every instance. Bounds sit around the SLO (300 ms).
		duration: f.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "http_request_duration_seconds",
			Help:    "HTTP request latency.",
			Buckets: []float64{0.05, 0.1, 0.3, 0.5, 1, 2.5},
		}, []string{"route"}),
		// Gauge: a value that goes up and down.
		inFlight: f.NewGauge(prometheus.GaugeOpts{
			Name: "http_requests_in_flight",
			Help: "Requests currently being served.",
		}),
	}
}

type statusWriter struct {
	http.ResponseWriter
	code int
}

func (w *statusWriter) WriteHeader(code int) {
	w.code = code
	w.ResponseWriter.WriteHeader(code)
}

// Instrument wraps one route. The label is the route PATTERN ("/orders/{id}"),
// never the raw URL: one series per route, not one per order ID.
func (m *Metrics) Instrument(route string, next http.HandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		m.inFlight.Inc()
		defer m.inFlight.Dec()
		start := time.Now()
		sw := &amp;statusWriter{ResponseWriter: w, code: http.StatusOK}
		next(sw, r)
		m.duration.WithLabelValues(route).Observe(time.Since(start).Seconds())
		m.requests.WithLabelValues(route, r.Method, strconv.Itoa(sw.code)).Inc()
	})
}

func getOrder(w http.ResponseWriter, r *http.Request) {
	if r.PathValue("id") == "slow" {
		time.Sleep(400 * time.Millisecond) // pretend a cold cache
	}
	if r.PathValue("id") == "missing" {
		http.NotFound(w, r)
		return
	}
	w.Write([]byte(&#96;{"id":"&#96; + r.PathValue("id") + &#96;"}&#96;))
}

func main() {
	reg := prometheus.NewRegistry() // only our metrics; add collectors.NewGoCollector() for runtime ones
	m := NewMetrics(reg)
	mux := http.NewServeMux()
	mux.Handle("GET /orders/{id}", m.Instrument("/orders/{id}", getOrder))
	mux.Handle("GET /metrics", promhttp.HandlerFor(reg, promhttp.HandlerOpts{}))
	http.ListenAndServe(":8080", mux)
}</code></pre>

<p>After 9 requests (7 fast, one 404, one slow at ~400 ms), <code>/metrics</code> returns this real output. Buckets are cumulative: <code>le="0.5"</code> counts everything up to 0.5 s, including the 8 fast ones.</p>
<pre><code># HELP http_request_duration_seconds HTTP request latency.
# TYPE http_request_duration_seconds histogram
http_request_duration_seconds_bucket{route="/orders/{id}",le="0.05"} 8
http_request_duration_seconds_bucket{route="/orders/{id}",le="0.1"} 8
http_request_duration_seconds_bucket{route="/orders/{id}",le="0.3"} 8
http_request_duration_seconds_bucket{route="/orders/{id}",le="0.5"} 9
http_request_duration_seconds_bucket{route="/orders/{id}",le="1"} 9
http_request_duration_seconds_bucket{route="/orders/{id}",le="2.5"} 9
http_request_duration_seconds_bucket{route="/orders/{id}",le="+Inf"} 9
http_request_duration_seconds_sum{route="/orders/{id}"} 0.400452333
http_request_duration_seconds_count{route="/orders/{id}"} 9
# HELP http_requests_in_flight Requests currently being served.
# TYPE http_requests_in_flight gauge
http_requests_in_flight 0
# HELP http_requests_total HTTP requests by route, method and status code.
# TYPE http_requests_total counter
http_requests_total{code="200",method="GET",route="/orders/{id}"} 8
http_requests_total{code="404",method="GET",route="/orders/{id}"} 1</code></pre>

<p><strong>PromQL basics</strong> against those metrics:</p>
<pre><code># Requests per second, per route (rate first, then sum)
sum by (route) (rate(http_requests_total[5m]))

# Error ratio: share of requests that returned 5xx
sum(rate(http_requests_total{code=~"5.."}[5m]))
  / sum(rate(http_requests_total[5m]))

# p99 latency per route, across all instances
histogram_quantile(0.99,
  sum by (le, route) (rate(http_request_duration_seconds_bucket[5m])))

# Share of requests slower than 300 ms (uses the le="0.3" bucket)
1 - sum(rate(http_request_duration_seconds_bucket{le="0.3"}[5m]))
      / sum(rate(http_request_duration_seconds_count[5m]))

# Average latency, for comparison (it hides the slow tail)
sum(rate(http_request_duration_seconds_sum[5m]))
  / sum(rate(http_request_duration_seconds_count[5m]))</code></pre>

<p><strong>Real-world scenario.</strong> It's 14:05. The "average latency" panel is flat at 80 ms and nobody notices anything. Support says some customers see order pages hang. The p99 query above, split by route, tells a different story: <code>/orders/{id}</code> p99 went from 250 ms to 1.8 s at 13:58, while p50 stayed at 35 ms. About 2% of requests (those missing the cache after a cache node restart) are slow; the average barely moves because 98% are still fast. The team replaces the average panel with p50/p95/p99 and alerts on the share of requests over 300 ms, which is a ratio of two counters and aggregates cleanly.</p>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>Unbounded labels.</strong> The most common way to break a metrics system: <code>r.URL.Path</code> instead of the route pattern, user IDs, error strings. Bound every label; when in doubt, leave it out.</li>
  <li><strong>Averaging percentiles.</strong> <code>avg(p99 of each pod)</code> is not the fleet's p99. Sum histogram buckets across pods first, then call <code>histogram_quantile</code>.</li>
  <li><strong><code>sum</code> before <code>rate</code>.</strong> Always <code>rate</code> then <code>sum</code>: <code>sum(rate(x[5m]))</code>. Summing raw counters first hides the resets that <code>rate</code> needs to see. And never <code>rate</code> a gauge.</li>
  <li><strong>Range too short.</strong> <code>rate(x[30s])</code> with a 15 s scrape has only one or two samples and returns gaps or noise. Use a window of several scrape intervals; 4× is a common rule of thumb.</li>
  <li><strong>Missing series aren't zero.</strong> A labelled counter appears only after its first <code>Inc()</code>. If <code>code="500"</code> has never happened, an error-ratio alert returns no data instead of 0 and silently never fires. Pre-create important series with <code>WithLabelValues(...)</code>.</li>
  <li><strong>Buckets that miss your target.</strong> With buckets at 0.25 s and 1 s, you can't tell whether p99 is 300 ms or 900 ms. Put a bound at your SLO threshold.</li>
  <li><strong>Units and names.</strong> Follow the conventions: base units (<code>_seconds</code>, <code>_bytes</code>), <code>_total</code> on counters. Mixing milliseconds and seconds across services makes every dashboard a trap.</li>
</ul>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>Counter for things that happen, gauge for current levels, histogram for latency and sizes; avoid summaries across many instances.</li>
  <li>Each label combination is a series: keep labels bounded, never per user or per request.</li>
  <li>Look at <code>rate()</code> of counters, and at percentiles, not averages, for latency.</li>
  <li><code>histogram_quantile(0.99, sum by (le) (rate(..._bucket[5m])))</code> is the pattern to memorize.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#monitoring">Monitoring</a> · <a href="#logging">Logging</a> · <a href="#slis">SLIs</a> · <a href="#p99-latency">p99 Latency</a> · <a href="#alerts">Alerts</a> · <a href="#real-world-observability-stack">Real-World Observability Stack</a></p>
`;

CONTENT["distributed-tracing"] = `
<p class="tldr"><strong>TL;DR</strong>: Distributed tracing follows one request through every service it touches. Each unit of work is a <strong>span</strong> (name, start, duration, parent); all spans of one request share a <strong>trace ID</strong>, which travels between services in the W3C <code>traceparent</code> header. The result is a waterfall that shows where the time went and where it failed. It's a parcel tracking number for a request.</p>

<h2>The problem it solves</h2>
<p>A checkout request touches a gateway, the checkout service, a database, an inventory service, a payments service and an external provider. When p99 latency doubles:</p>
<ul>
  <li><strong>Metrics</strong> tell you checkout is slow, but not which of its six downstream calls is responsible.</li>
  <li><strong>Logs</strong> from each service are separate; even with a shared request ID, reconstructing timing and nesting by hand is slow.</li>
  <li>Every team sees their own service as "fine", because each one only sees its part.</li>
</ul>
<p>A trace shows the whole call tree of one real request, with timings, in one picture.</p>

<h2>How it works</h2>
<p>A <strong>trace</strong> is a tree of <strong>spans</strong>. A span records one operation: an incoming HTTP request, a DB query, an outgoing call. It holds a name, start and end time, a span ID, its parent's span ID, a status (OK / Error / unset) and attributes such as <code>http.response.status_code</code> or <code>order.id</code>. Spans are sent to a backend (Jaeger, Grafana Tempo, Zipkin or a vendor), usually through an <a href="#observability">OpenTelemetry Collector</a>, which reassembles them by trace ID into a waterfall:</p>

<figure class="diagram">
<svg viewBox="0 0 780 258" role="img" aria-label="Trace waterfall for POST /checkout taking 420 ms. Child spans: SELECT cart 12 ms, GET /stock 35 ms, and a client span POST /charge of 355 ms. Inside it, the payments service server span takes 349 ms, of which 335 ms is waiting for the acme-pay provider.">
  <text x="20" y="24" class="small">trace 4bf92f35…</text>
  <path class="line" d="M250 34 H750"/>
  <text x="250" y="26" text-anchor="middle" class="small">0</text>
  <text x="369" y="26" text-anchor="middle" class="small">100 ms</text>
  <text x="488" y="26" text-anchor="middle" class="small">200 ms</text>
  <text x="607" y="26" text-anchor="middle" class="small">300 ms</text>
  <text x="726" y="26" text-anchor="middle" class="small">400 ms</text>
  <text x="20" y="61" class="small">checkout</text>
  <text x="90" y="61">POST /checkout</text>
  <rect class="box accent" x="250" y="46" width="500" height="22" rx="3"/>
  <text x="500" y="61" text-anchor="middle" class="small">420 ms</text>
  <text x="20" y="95" class="small">checkout</text>
  <text x="104" y="95">SELECT cart</text>
  <rect class="box ok" x="256" y="80" width="14" height="22" rx="3"/>
  <text x="276" y="95" class="small">12 ms</text>
  <text x="20" y="129" class="small">checkout</text>
  <text x="104" y="129">GET /stock</text>
  <rect class="box ok" x="274" y="114" width="42" height="22" rx="3"/>
  <text x="321" y="129" class="small">35 ms</text>
  <text x="20" y="163" class="small">checkout</text>
  <text x="104" y="163">POST /charge</text>
  <rect class="box" x="321" y="148" width="423" height="22" rx="3"/>
  <text x="533" y="163" text-anchor="middle" class="small">client span: 355 ms</text>
  <text x="20" y="197" class="small">payments</text>
  <text x="118" y="197">POST /charge</text>
  <rect class="box" x="325" y="182" width="415" height="22" rx="3"/>
  <text x="533" y="197" text-anchor="middle" class="small">server span: 349 ms</text>
  <text x="20" y="231" class="small">payments</text>
  <text x="132" y="231">POST acme-pay</text>
  <rect class="box bad" x="333" y="216" width="399" height="22" rx="3"/>
  <text x="533" y="231" text-anchor="middle" class="small">335 ms waiting on the provider</text>
</svg>
<figcaption>Read it top-down: indentation is the parent/child tree, bar position is time. The gap between the checkout client span (355 ms) and the payments server span (349 ms) is network time. 335 of the 420 ms are spent waiting for one external provider.</figcaption>
</figure>

<h3>Context propagation: how the trace crosses a network hop</h3>
<p>Spans in different processes join the same trace because the caller sends its trace context along with the request. The standard is the W3C Trace Context header <code>traceparent</code>:</p>
<figure class="diagram">
<svg viewBox="0 0 780 250" role="img" aria-label="Checkout calls payments with a traceparent header made of four dash-separated fields: version 00, a 32-hex-digit trace-id shared by the whole trace, a 16-hex-digit parent-id which is the caller's span ID, and trace-flags 01 meaning sampled. Payments starts a child span with the same trace-id.">
  <defs><marker id="arr-tr-2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <rect class="box" x="40" y="16" width="180" height="48" rx="8"/>
  <text x="130" y="38" text-anchor="middle" class="title">checkout</text>
  <text x="130" y="54" text-anchor="middle" class="small">client span 5682…</text>
  <rect class="box" x="560" y="16" width="180" height="48" rx="8"/>
  <text x="650" y="38" text-anchor="middle" class="title">payments</text>
  <text x="650" y="54" text-anchor="middle" class="small">new child span</text>
  <path class="line accent" d="M220 40 H558" marker-end="url(#arr-tr-2)"/>
  <text x="389" y="32" text-anchor="middle" class="small">POST /charge, with header:</text>

  <text x="20" y="114" class="title">traceparent:</text>
  <rect class="box muted" x="115" y="94" width="40" height="30" rx="4"/>
  <text x="135" y="114" text-anchor="middle">00</text>
  <rect class="box accent" x="165" y="94" width="270" height="30" rx="4"/>
  <text x="300" y="114" text-anchor="middle">4bf92f3577b34da6a3ce929d0e0e4736</text>
  <rect class="box ok" x="445" y="94" width="150" height="30" rx="4"/>
  <text x="520" y="114" text-anchor="middle">5682939d16e55a99</text>
  <rect class="box muted" x="605" y="94" width="40" height="30" rx="4"/>
  <text x="625" y="114" text-anchor="middle">01</text>
  <text x="135" y="144" text-anchor="middle" class="small">version</text>
  <text x="300" y="144" text-anchor="middle" class="small">trace-id: same for the whole trace</text>
  <text x="520" y="144" text-anchor="middle" class="small">parent-id: caller's span</text>
  <text x="605" y="162" class="small">trace-flags: 01 = sampled</text>
  <path class="line dashed" d="M130 64 V88 H515 V92"/>

  <rect class="box muted" x="120" y="184" width="540" height="50" rx="6"/>
  <text x="390" y="204" text-anchor="middle" class="small">payments extracts the header and starts its span with the same trace-id</text>
  <text x="390" y="222" text-anchor="middle" class="small">and parent = 5682939d16e55a99, so the backend can nest it under checkout</text>
</svg>
<figcaption>A companion header, <code>tracestate</code>, carries vendor-specific data. <code>baggage</code> carries your own key/values (e.g. tenant) to every downstream service. Message queues need the same context copied into message headers.</figcaption>
</figure>

<h3>Sampling: which traces to keep</h3>
<p>Recording every span of every request is expensive at scale, so most systems keep a subset. The key question is <em>when</em> you decide.</p>
<table>
  <tr><th>Strategy</th><th>Decided</th><th>Keeps all errors and slow requests?</th><th>Cost</th><th>Notes</th></tr>
  <tr><td>Always on</td><td>n/a</td><td>yes</td><td>highest</td><td>fine for low traffic and staging</td></tr>
  <tr><td>Head, ratio (<code>TraceIDRatioBased(0.1)</code>)</td><td>at the first service, before anything happens</td><td>no: 90% of failures are dropped too</td><td>low, predictable</td><td>decision is a function of the trace ID, so every service agrees</td></tr>
  <tr><td>Parent-based (<code>ParentBased(...)</code>)</td><td>follows the caller's sampled flag</td><td>same as the root's choice</td><td>low</td><td>the usual SDK setting, so traces aren't cut in half</td></tr>
  <tr><td>Tail (Collector <code>tail_sampling</code> processor)</td><td>after the trace finishes, in the Collector</td><td>yes: rules like "status = error" or "latency &gt; 1 s"</td><td>apps send 100% to the Collector; storage is reduced</td><td>all spans of a trace must reach the same Collector instance (route by trace ID)</td></tr>
</table>

<h2>Example</h2>
<p><strong>OpenTelemetry in Go</strong>: SDK setup with an OTLP exporter, a server middleware that continues incoming traces, a client call that injects <code>traceparent</code>, error status on spans, and the trace ID on log lines. In real code, <code>otelhttp</code> from opentelemetry-go-contrib wraps handlers and transports for you; it's written out here to show the mechanism.</p>
<pre><code>package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
	"go.opentelemetry.io/otel/trace"
)

// Setup: export spans over OTLP to a collector (OTEL_EXPORTER_OTLP_ENDPOINT,
// default localhost:4317), sample 10% of new traces, follow the caller's
// decision otherwise, and propagate context with W3C traceparent headers.
func InitTracing(ctx context.Context, service string) (func(context.Context) error, error) {
	exp, err := otlptracegrpc.New(ctx)
	if err != nil {
		return nil, err
	}
	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exp), // buffer and send in the background
		sdktrace.WithResource(resource.NewSchemaless(semconv.ServiceName(service))),
		sdktrace.WithSampler(sdktrace.ParentBased(sdktrace.TraceIDRatioBased(0.1))),
	)
	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.TraceContext{})
	return tp.Shutdown, nil // call on exit so buffered spans are flushed
}

var tracer = otel.Tracer("shop/checkout")

// Server side: continue the trace the caller started (if any).
// otelhttp.NewHandler from opentelemetry-go-contrib does this for you.
func Traced(name string, next http.HandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := otel.GetTextMapPropagator().Extract(r.Context(), propagation.HeaderCarrier(r.Header))
		ctx, span := tracer.Start(ctx, name, trace.WithSpanKind(trace.SpanKindServer))
		defer span.End()
		next(w, r.WithContext(ctx))
	})
}

// Client side: start a child span and inject traceparent into the request.
func callPayments(ctx context.Context, url string) error {
	ctx, span := tracer.Start(ctx, "POST /charge", trace.WithSpanKind(trace.SpanKindClient))
	defer span.End()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, nil)
	if err != nil {
		return err
	}
	otel.GetTextMapPropagator().Inject(ctx, propagation.HeaderCarrier(req.Header))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, "payments unreachable")
		return err
	}
	defer resp.Body.Close()
	span.SetAttributes(attribute.Int("http.response.status_code", resp.StatusCode))
	if resp.StatusCode &gt;= 500 {
		span.SetStatus(codes.Error, resp.Status)
		return errors.New(resp.Status)
	}
	return nil
}

func checkout(paymentsURL string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		span := trace.SpanFromContext(ctx)
		span.SetAttributes(attribute.String("order.id", "o_981"), attribute.Int("cart.items", 3))

		// Put the trace ID on log lines so logs and traces link both ways.
		log := slog.With("trace_id", span.SpanContext().TraceID().String())

		_, db := tracer.Start(ctx, "SELECT cart")
		time.Sleep(5 * time.Millisecond) // stand-in for the query
		db.End()

		if err := callPayments(ctx, paymentsURL); err != nil {
			span.SetStatus(codes.Error, "charge failed")
			log.Error("charge failed", "err", err)
			http.Error(w, "payment failed", http.StatusBadGateway)
			return
		}
		log.Info("order created")
	}
}

func main() {
	ctx := context.Background()
	shutdown, err := InitTracing(ctx, "checkout")
	if err != nil {
		panic(err)
	}
	defer shutdown(ctx)
	http.ListenAndServe(":8080", Traced("POST /checkout", checkout("http://payments:8080/charge")))
}</code></pre>

<p>A test wires checkout to a fake payments service that returns 503, sends a request carrying the spec's example <code>traceparent</code>, and collects spans with the SDK's in-memory exporter. Real output: payments receives the trace ID plus checkout's client span as parent, and the spans form the expected tree.</p>
<pre><code>payments got traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-5682939d16e55a99-01
2026/11/08 12:31:59 ERROR charge failed trace_id=4bf92f3577b34da6a3ce929d0e0e4736 err="503 Service Unavailable"
POST /checkout  span=b0d0fd000ba008c7 parent=00f067aa0ba902b7 status=Error
SELECT cart     span=202b3957043432bf parent=b0d0fd000ba008c7 status=Unset
POST /charge    span=5682939d16e55a99 parent=b0d0fd000ba008c7 status=Error
POST /charge    span=6dbd5c0af22fefa5 parent=5682939d16e55a99 status=Unset</code></pre>
<p>The root span's parent is <code>00f067aa0ba902b7</code>, the span ID from the incoming header: this service continued someone else's trace instead of starting its own. The payments server span is <code>Unset</code> because that handler never set a status; an instrumentation library like <code>otelhttp</code> marks server 5xx responses as errors for you.</p>

<p><strong>Real-world scenario.</strong> It's 14:05 and checkout p99 has gone from 400 ms to 1.9 s. The latency panel has exemplars (trace IDs attached to histogram samples), so on-call clicks a slow point and opens a trace: <code>POST acme-pay</code> shows three back-to-back attempts of about 500 ms each, all ending in timeouts, then a success. The retry policy (see <a href="#retries">Retries</a>) is multiplying the provider's slowness. Search for traces with <code>error=true</code> on that span: hundreds since 13:58, all in one region. Logs for one of those trace IDs show the provider's error body. Ten minutes from alert to cause, without anyone guessing.</p>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>Broken context.</strong> One function that uses <code>context.Background()</code> instead of the request's <code>ctx</code>, a goroutine that drops it, or a queue message without headers, and the trace splits in two. Pass <code>ctx</code> everywhere, and copy context into message headers.</li>
  <li><strong>Head sampling hides failures.</strong> At 1% sampling, 99% of error traces are thrown away. Use tail sampling, or at least always keep errors.</li>
  <li><strong>High-cardinality span names.</strong> Name spans by operation (<code>GET /orders/{id}</code>), and put IDs in attributes. Span names with IDs in them break grouping and per-operation stats.</li>
  <li><strong>Too many spans.</strong> A span per loop iteration or per cache lookup costs CPU, network and money. Trace network hops and meaningful work; use attributes or events for detail.</li>
  <li><strong>Lost spans on exit.</strong> The batch processor buffers spans; without <code>Shutdown</code> on exit, the last seconds before a crash or deploy, often the most interesting, never arrive.</li>
  <li><strong>Sensitive attributes.</strong> Spans are logs with a different shape: no tokens, card numbers or personal data in attributes or span events.</li>
  <li><strong>Untrusted <code>traceparent</code> at the edge.</strong> Clients on the internet can send any trace ID and force the sampled flag. Many teams start a fresh trace at the public edge and keep the client's ID only as an attribute or link.</li>
  <li><strong>Clock skew.</strong> Spans from different hosts use different clocks, so a child can appear to start before its parent. Keep NTP healthy and read small offsets with care (see <a href="#clock-skew">Clock Skew</a>).</li>
</ul>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>Trace = tree of spans sharing a trace ID; a span = one timed operation with a parent.</li>
  <li>Propagation is the whole trick: <code>traceparent</code> on every outgoing call, extracted on every incoming one, and <code>ctx</code> passed everywhere in between.</li>
  <li>OpenTelemetry is the vendor-neutral standard: SDK in the app, OTLP to a Collector, any backend behind it.</li>
  <li>Head sampling is cheap but blind; tail sampling keeps the errors and slow requests you actually need. Put the trace ID on logs to jump between the two.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#observability">Observability</a> · <a href="#logging">Logging</a> · <a href="#metrics">Metrics</a> · <a href="#tail-latency">Tail Latency</a> · <a href="#retries">Retries</a> · <a href="#real-world-observability-stack">Real-World Observability Stack</a></p>
`;

CONTENT["observability"] = `
<p class="tldr"><strong>TL;DR</strong>: Observability is how well you can work out what's happening inside a system from the data it emits, including problems <em>nobody predicted</em>. <a href="#monitoring">Monitoring</a> tells you <em>that</em> something you anticipated is wrong; observability lets you ask new questions, like "is it only big carts with the new pricing flag?", without shipping new code. A car's warning lights are monitoring. A mechanic's diagnostic port, which can read any sensor, is observability.</p>

<h2>The problem it solves</h2>
<p>The term comes from control theory: a system is observable if you can infer its internal state from its outputs. In software, the outputs are the telemetry you emit.</p>
<p>Dashboards and alerts cover <strong>known unknowns</strong>: failure modes you've seen before, so you graph and alert on them. Modern systems mostly fail in new ways, though. One tenant, one build, one feature flag, one region, one combination of all four. These are <strong>unknown unknowns</strong>, and they're often invisible in aggregates:</p>
<ul>
  <li>Error rate is 4%, but every host, every pod and every CPU graph looks normal.</li>
  <li>p99 doubled, but only for requests that touch one shard through one dependency.</li>
  <li>A customer says "it's slow for us", and no dashboard has a <code>tenant</code> dimension.</li>
</ul>
<p>Without observability you guess, add a log line, redeploy, wait, and guess again. With it, you slice the data you already have until the odd group shows up.</p>

<h2>How it works</h2>
<p>Code emits rich telemetry: <a href="#metrics">metrics</a>, structured <a href="#logging">logs</a> and <a href="#distributed-tracing">traces</a>, all sharing context such as <code>trace_id</code>, <code>service</code> and <code>version</code>. Today this usually goes through <strong>OpenTelemetry</strong> (OTel), a vendor-neutral set of APIs, SDKs, a wire protocol (<strong>OTLP</strong>) and the <strong>Collector</strong>. The Collector is a standalone process that receives telemetry, processes it, and exports it to one or more backends.</p>

<figure class="diagram">
<svg viewBox="0 0 780 300" role="img" aria-label="A Go service with the OpenTelemetry SDK sends OTLP to the OpenTelemetry Collector. Inside the collector, receivers feed processors, which feed exporters. Exporters send metrics, logs and traces to separate backends, which a query UI such as Grafana reads together.">
  <defs><marker id="arr-ob-1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <rect class="box" x="20" y="70" width="140" height="110" rx="8"/>
  <text x="90" y="94" text-anchor="middle" class="title">checkout (Go)</text>
  <text x="90" y="118" text-anchor="middle" class="small">OTel SDK: spans,</text>
  <text x="90" y="133" text-anchor="middle" class="small">metrics, logs</text>
  <text x="90" y="157" text-anchor="middle" class="small">shared trace_id,</text>
  <text x="90" y="171" text-anchor="middle" class="small">service, version</text>
  <path class="line accent" d="M160 125 H218" marker-end="url(#arr-ob-1)"/>
  <text x="189" y="117" text-anchor="middle" class="small">OTLP</text>
  <text x="20" y="204" class="small">OTLP ports: gRPC 4317,</text>
  <text x="20" y="218" class="small">HTTP 4318</text>

  <rect class="box muted" x="220" y="40" width="330" height="190" rx="10"/>
  <text x="385" y="62" text-anchor="middle" class="title">OpenTelemetry Collector</text>
  <rect class="box accent" x="230" y="80" width="94" height="110" rx="6"/>
  <text x="277" y="102" text-anchor="middle" class="title">receivers</text>
  <text x="277" y="126" text-anchor="middle" class="small">otlp</text>
  <text x="277" y="142" text-anchor="middle" class="small">prometheus</text>
  <text x="277" y="158" text-anchor="middle" class="small">filelog</text>
  <rect class="box accent" x="338" y="80" width="94" height="110" rx="6"/>
  <text x="385" y="102" text-anchor="middle" class="title">processors</text>
  <text x="385" y="126" text-anchor="middle" class="small">memory_limiter</text>
  <text x="385" y="142" text-anchor="middle" class="small">batch</text>
  <text x="385" y="158" text-anchor="middle" class="small">attributes</text>
  <text x="385" y="174" text-anchor="middle" class="small">tail sampling</text>
  <rect class="box accent" x="446" y="80" width="94" height="110" rx="6"/>
  <text x="493" y="102" text-anchor="middle" class="title">exporters</text>
  <text x="493" y="126" text-anchor="middle" class="small">otlp</text>
  <text x="493" y="142" text-anchor="middle" class="small">otlphttp</text>
  <text x="493" y="158" text-anchor="middle" class="small">remote write</text>
  <path class="line" d="M324 135 H336" marker-end="url(#arr-ob-1)"/>
  <path class="line" d="M432 135 H444" marker-end="url(#arr-ob-1)"/>
  <text x="385" y="214" text-anchor="middle" class="small">one pipeline per signal: traces, metrics, logs</text>

  <rect class="box ok" x="600" y="30" width="160" height="50" rx="8"/>
  <text x="680" y="51" text-anchor="middle" class="title">metrics</text>
  <text x="680" y="68" text-anchor="middle" class="small">Prometheus, Mimir</text>
  <rect class="box ok" x="600" y="100" width="160" height="50" rx="8"/>
  <text x="680" y="121" text-anchor="middle" class="title">logs</text>
  <text x="680" y="138" text-anchor="middle" class="small">Loki, Elasticsearch</text>
  <rect class="box ok" x="600" y="170" width="160" height="50" rx="8"/>
  <text x="680" y="191" text-anchor="middle" class="title">traces</text>
  <text x="680" y="208" text-anchor="middle" class="small">Tempo, Jaeger</text>
  <path class="line" d="M550 110 L598 58" marker-end="url(#arr-ob-1)"/>
  <path class="line" d="M550 128 H598" marker-end="url(#arr-ob-1)"/>
  <path class="line" d="M550 146 L598 192" marker-end="url(#arr-ob-1)"/>

  <rect class="box" x="220" y="250" width="540" height="40" rx="8"/>
  <text x="490" y="275" text-anchor="middle">Grafana or a vendor UI: query and jump between signals by trace_id</text>
  <path class="line dashed" d="M680 220 V248" marker-end="url(#arr-ob-1)"/>
</svg>
<figcaption>Instrument once with OpenTelemetry, send everything through a Collector, and choose (or change) backends in Collector config instead of in application code.</figcaption>
</figure>

<p>Two properties make telemetry observable rather than just monitored:</p>
<ul>
  <li><strong>High cardinality.</strong> Fields with many distinct values (<code>user_id</code>, <code>tenant</code>, <code>build</code>, <code>cart_items</code>) are what let you find "only these requests". Metrics can't hold them cheaply (see <a href="#metrics">Metrics</a>), so they live in events, logs and spans.</li>
  <li><strong>High dimensionality and correlation.</strong> Many fields on each event, and a shared <code>trace_id</code>, so you can go from a graph to an example trace to its logs.</li>
</ul>

<h3>An investigation, step by step</h3>
<figure class="diagram">
<svg viewBox="0 0 780 262" role="img" aria-label="Five investigation steps: a symptom alert shows checkout errors at 4 percent; slicing by dimensions; comparing groups shows flag new_pricing true has 38 percent errors versus 0.3 percent; an exemplar trace shows a slow pricing span; logs for that trace_id show payment timeout. A bar chart shows error rate 38 percent for new_pricing true and 0.3 percent for false.">
  <defs><marker id="arr-ob-2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <rect class="box bad" x="20" y="20" width="130" height="70" rx="8"/>
  <text x="85" y="42" text-anchor="middle" class="title">1 symptom</text>
  <text x="85" y="62" text-anchor="middle" class="small">SLO alert: checkout</text>
  <text x="85" y="77" text-anchor="middle" class="small">errors at 4%</text>
  <rect class="box" x="170" y="20" width="130" height="70" rx="8"/>
  <text x="235" y="42" text-anchor="middle" class="title">2 slice</text>
  <text x="235" y="62" text-anchor="middle" class="small">group by build,</text>
  <text x="235" y="77" text-anchor="middle" class="small">region, tenant, flag</text>
  <rect class="box accent" x="320" y="20" width="130" height="70" rx="8"/>
  <text x="385" y="42" text-anchor="middle" class="title">3 compare</text>
  <text x="385" y="62" text-anchor="middle" class="small">new_pricing=true:</text>
  <text x="385" y="77" text-anchor="middle" class="small">38% vs 0.3%</text>
  <rect class="box" x="470" y="20" width="130" height="70" rx="8"/>
  <text x="535" y="42" text-anchor="middle" class="title">4 trace</text>
  <text x="535" y="62" text-anchor="middle" class="small">open an exemplar:</text>
  <text x="535" y="77" text-anchor="middle" class="small">34 DB calls in pricing</text>
  <rect class="box" x="620" y="20" width="140" height="70" rx="8"/>
  <text x="690" y="42" text-anchor="middle" class="title">5 logs</text>
  <text x="690" y="62" text-anchor="middle" class="small">same trace_id:</text>
  <text x="690" y="77" text-anchor="middle" class="small">"payment timeout"</text>
  <path class="line" d="M150 55 H168" marker-end="url(#arr-ob-2)"/>
  <path class="line" d="M300 55 H318" marker-end="url(#arr-ob-2)"/>
  <path class="line" d="M450 55 H468" marker-end="url(#arr-ob-2)"/>
  <path class="line" d="M600 55 H618" marker-end="url(#arr-ob-2)"/>

  <text x="20" y="130" class="title">Step 3: checkout error rate grouped by flag.new_pricing</text>
  <text x="150" y="166" text-anchor="end" class="small">new_pricing=true</text>
  <rect class="box bad" x="160" y="152" width="456" height="22" rx="3"/>
  <text x="624" y="167" class="small">38%</text>
  <text x="150" y="202" text-anchor="end" class="small">new_pricing=false</text>
  <rect class="box ok" x="160" y="188" width="4" height="22" rx="1"/>
  <text x="172" y="203" class="small">0.3%</text>
  <path class="line" d="M160 140 V222"/>
  <text x="160" y="246" class="small">The flag is on for 10% of traffic: 10% × 38% ≈ 3.8% overall. No host-level graph would show this.</text>
</svg>
<figcaption>Start from a user-facing symptom, then slice by dimensions until one group stands out. Traces and logs explain <em>why</em> that group is different.</figcaption>
</figure>

<h2>Signals compared</h2>
<table>
  <tr><th>Signal</th><th>Best at</th><th>Weak at</th><th>High-cardinality fields</th></tr>
  <tr><td><a href="#metrics">Metrics</a></td><td>cheap trends, dashboards, alerting; years of retention</td><td>"which requests?"; aggregated before you ask</td><td>no: each label combination is a new time series</td></tr>
  <tr><td><a href="#logging">Logs</a></td><td>details of one event, error messages, audit trails</td><td>cost at volume; unstructured logs are hard to query</td><td>yes, if structured (JSON)</td></tr>
  <tr><td><a href="#distributed-tracing">Traces</a></td><td>where time goes across services; causality</td><td>sampled, so rare paths may be missing</td><td>yes, as span attributes</td></tr>
  <tr><td>Wide events</td><td>one rich record per request with dozens of fields; arbitrary group-by</td><td>needs a columnar store built for it; storage cost</td><td>yes, that's the point</td></tr>
  <tr><td>Profiles</td><td>which function burns CPU or memory</td><td>not per-request; newer tooling</td><td>limited</td></tr>
</table>
<p><strong>The debate, briefly.</strong> The classic framing is "three pillars": metrics, logs, traces. Critics, notably Charity Majors of Honeycomb, argue that three separately stored pillars are just three bills, and that observability really comes from <strong>wide, structured events</strong> you can slice in any direction, with metrics derived from them. In practice most teams run all three, linked by <code>trace_id</code>, and add wide events or richer spans where debugging hurts most. OpenTelemetry supports either approach. It is also adding profiles as a further signal.</p>

<h2>Example</h2>
<p><strong>Wide events in Go</strong>: handlers add whatever they learn to the request's event, and middleware writes one structured line per request with <code>log/slog</code>. (In a traced service the same fields go on the root span as attributes.)</p>
<pre><code>package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"time"
)

// One wide event per request: handlers add fields as they learn things,
// the middleware emits everything as a single structured log line.
type eventKey struct{}

type event struct{ attrs []slog.Attr }

// Add attaches fields to the current request's event. Safe to call
// from any handler or helper that has the request context.
func Add(ctx context.Context, attrs ...slog.Attr) {
	if ev, ok := ctx.Value(eventKey{}).(*event); ok {
		ev.attrs = append(ev.attrs, attrs...)
	}
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}

func WideEvents(log *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ev := &amp;event{}
		sw := &amp;statusWriter{ResponseWriter: w, status: http.StatusOK}
		r = r.WithContext(context.WithValue(r.Context(), eventKey{}, ev))
		next.ServeHTTP(sw, r) // the mux sets r.Pattern on this request

		attrs := append([]slog.Attr{
			slog.String("method", r.Method),
			slog.String("route", r.Pattern), // "POST /checkout", not the raw URL
			slog.Int("status", sw.status),
			slog.Int64("duration_ms", time.Since(start).Milliseconds()),
			slog.String("build", os.Getenv("BUILD_SHA")),
		}, ev.attrs...)
		log.LogAttrs(r.Context(), slog.LevelInfo, "request", attrs...)
	})
}

func checkout(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	Add(ctx,
		slog.String("user_id", "u_8412"),
		slog.String("tenant", "acme"),
		slog.Int("cart_items", 31),
		slog.Bool("flag.new_pricing", true),
	)
	// ... call pricing, payments ...
	Add(ctx, slog.String("payment_provider", "psp-b"), slog.Int("db_queries", 34))
	http.Error(w, "payment timeout", http.StatusGatewayTimeout)
}

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	mux := http.NewServeMux()
	mux.HandleFunc("POST /checkout", checkout)
	http.ListenAndServe(":8080", WideEvents(log, mux))
}</code></pre>
<p>The real output for one request (from an <code>httptest</code> run):</p>
<pre><code>{"time":"2026-11-08T12:26:31.673237Z","level":"INFO","msg":"request","method":"POST","route":"POST /checkout","status":504,"duration_ms":0,"build":"9f3c2e1","user_id":"u_8412","tenant":"acme","cart_items":31,"flag.new_pricing":true,"payment_provider":"psp-b","db_queries":34}</code></pre>
<p>A Collector config that receives OTLP and fans out to three backends:</p>
<pre><code>receivers:
  otlp:
    protocols:
      grpc: { endpoint: 0.0.0.0:4317 }
      http: { endpoint: 0.0.0.0:4318 }
processors:
  memory_limiter: { check_interval: 1s, limit_percentage: 80, spike_limit_percentage: 20 }
  batch: {}
exporters:
  otlp/tempo: { endpoint: "tempo:4317", tls: { insecure: true } }
  otlphttp/loki: { endpoint: "http://loki:3100/otlp" }
  prometheusremotewrite: { endpoint: "http://prometheus:9090/api/v1/write" }  # contrib build
service:
  pipelines:  # memory_limiter goes first, so overload is refused early
    traces:  { receivers: [otlp], processors: [memory_limiter, batch], exporters: [otlp/tempo] }
    logs:    { receivers: [otlp], processors: [memory_limiter, batch], exporters: [otlphttp/loki] }
    metrics: { receivers: [otlp], processors: [memory_limiter, batch], exporters: [prometheusremotewrite] }</code></pre>

<p><strong>Real-world scenario.</strong> At 14:05 the checkout SLO alert fires: errors went from 0.3% to 4%. Host dashboards are flat: CPU 40%, memory normal, no pod restarts. The on-call engineer groups the request events by <code>build</code> (nothing), <code>region</code> (nothing), then <code>flag.new_pricing</code>: requests with the flag on fail 38% of the time. Narrowing further, only carts with more than 25 items fail. An exemplar trace shows the pricing call making 34 sequential database queries (an <a href="#n-1-queries">N+1</a>), which pushes payment authorisation past its timeout. Turning the flag off restores the error rate within a minute. No new code or logging was needed to find it, because the fields were already on every event.</p>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>Buying a tool isn't observability.</strong> A vendor with poorly instrumented code gives you pretty graphs of the wrong thing. The value is in the fields your code emits.</li>
  <li><strong>High cardinality in the wrong place.</strong> <code>user_id</code> as a Prometheus label can melt your metrics backend. Put it on spans and events, not on metric labels.</li>
  <li><strong>Signals that can't be joined.</strong> Logs without <code>trace_id</code>, and services that disagree on whether the field is <code>service</code>, <code>svc</code> or <code>app</code>. Use OTel semantic conventions (<code>service.name</code>, <code>http.route</code>) and propagate context everywhere.</li>
  <li><strong>Cost runs away.</strong> Debug-level logs at full volume and 100% trace sampling get very expensive. Sample traces (keeping errors and slow ones), drop noisy fields in the Collector, and set retention per signal.</li>
  <li><strong>No Collector, hard-wired vendor SDKs.</strong> Switching vendors then means changing every service. Exporting OTLP to a Collector keeps that a config change.</li>
  <li><strong>Missing deploy and flag context.</strong> Most incidents start with a change. If events don't carry <code>build</code> and flag state, you can't slice by the most likely cause.</li>
</ul>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>Monitoring answers questions you planned for; observability lets you ask new ones of data you already have.</li>
  <li>The power comes from high-cardinality, high-dimensional, correlated telemetry, not from any one tool.</li>
  <li>OpenTelemetry plus a Collector: instrument once, route to any backend.</li>
  <li>Investigate symptom first, then slice, compare, trace, and read logs.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#monitoring">Monitoring</a> · <a href="#metrics">Metrics</a> · <a href="#logging">Logging</a> · <a href="#distributed-tracing">Distributed Tracing</a> · <a href="#slis">SLIs</a> · <a href="#real-world-observability-stack">Real-World Observability Stack</a></p>
`;

CONTENT["alerts"] = `
<p class="tldr"><strong>TL;DR</strong>: An alert is a rule that notifies a human when something needs attention. Good alerts fire on <strong>symptoms users feel</strong> (errors, latency, an SLO burning), not on every cause (CPU at 80%). They're routed by urgency: a <em>page</em> wakes someone for "act now", a <em>ticket</em> waits for working hours. Think of a smoke alarm: it should go off for a fire, not every time you make toast.</p>

<h2>The problem it solves</h2>
<p>Dashboards only help when someone is looking at them. Alerts turn <a href="#monitoring">monitoring</a> data into action when nobody is. Badly designed alerts cause the opposite problem:</p>
<ul>
  <li><strong>Missed outages</strong>: users notice before you do, because nothing watched what they experience.</li>
  <li><strong>Alert fatigue</strong>: 40 pages a week, most needing no action, so on-call starts ignoring them, including the real one.</li>
  <li><strong>Alert storms</strong>: one database failure triggers 300 notifications from every service that depends on it.</li>
  <li><strong>"Now what?"</strong>: a page at 03:00 with no context, no dashboard link and no runbook.</li>
</ul>
<p><strong>Symptoms vs causes.</strong> A symptom is what users feel: "checkout returns 5xx", "search p99 is 2 s". A cause is a possible reason: high CPU, a full disk, a restarted pod. Causes often don't hurt anyone (CPU at 90% may be fine), and the cause list is never complete. One symptom alert catches failures from causes you never thought of. Cause-based signals still belong on dashboards, or as tickets when they predict trouble ("disk full in 4 days").</p>

<h2>How it works</h2>
<p>In the Prometheus ecosystem, the work is split. <strong>Prometheus</strong> evaluates alerting rules (a PromQL expression plus a <code>for:</code> duration) and sends firing alerts to <strong>Alertmanager</strong>. Alertmanager deduplicates, groups, inhibits, silences and routes them to receivers. Hosted tools such as Grafana Alerting, Datadog and PagerDuty implement the same ideas under other names.</p>

<figure class="diagram">
<svg viewBox="0 0 780 272" role="img" aria-label="Prometheus evaluates rules and sends firing alerts to Alertmanager. Alertmanager dedupes and groups, applies inhibition and silences, then routes by labels: severity page goes to PagerDuty, severity ticket goes to Slack and a ticket queue.">
  <defs><marker id="arr-al-1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <rect class="box" x="20" y="70" width="170" height="110" rx="8"/>
  <text x="105" y="94" text-anchor="middle" class="title">Prometheus</text>
  <text x="105" y="118" text-anchor="middle" class="small">rule = PromQL expr</text>
  <text x="105" y="133" text-anchor="middle" class="small">+ for: 5m</text>
  <text x="105" y="157" text-anchor="middle" class="small">inactive → pending</text>
  <text x="105" y="171" text-anchor="middle" class="small">→ firing</text>
  <path class="line accent" d="M190 125 H238" marker-end="url(#arr-al-1)"/>
  <text x="214" y="117" text-anchor="middle" class="small">alerts</text>

  <rect class="box muted" x="240" y="30" width="300" height="200" rx="10"/>
  <text x="390" y="52" text-anchor="middle" class="title">Alertmanager</text>
  <rect class="box accent" x="260" y="64" width="260" height="30" rx="6"/>
  <text x="390" y="83" text-anchor="middle" class="small">dedupe + group (group_by: alertname, service)</text>
  <rect class="box accent" x="260" y="104" width="260" height="30" rx="6"/>
  <text x="390" y="123" text-anchor="middle" class="small">inhibit: mute tickets while a page fires</text>
  <rect class="box accent" x="260" y="144" width="260" height="30" rx="6"/>
  <text x="390" y="163" text-anchor="middle" class="small">silence: muted for planned maintenance</text>
  <rect class="box accent" x="260" y="184" width="260" height="30" rx="6"/>
  <text x="390" y="203" text-anchor="middle" class="small">route: match labels → receiver</text>

  <rect class="box bad" x="600" y="40" width="160" height="50" rx="8"/>
  <text x="680" y="61" text-anchor="middle" class="title">PagerDuty</text>
  <text x="680" y="78" text-anchor="middle" class="small">severity=page: phone</text>
  <rect class="box" x="600" y="110" width="160" height="50" rx="8"/>
  <text x="680" y="131" text-anchor="middle" class="title">Slack #payments</text>
  <text x="680" y="148" text-anchor="middle" class="small">severity=ticket</text>
  <rect class="box" x="600" y="180" width="160" height="50" rx="8"/>
  <text x="680" y="201" text-anchor="middle" class="title">ticket queue</text>
  <text x="680" y="218" text-anchor="middle" class="small">fix in working hours</text>
  <path class="line bad" d="M520 199 L598 66" marker-end="url(#arr-al-1)"/>
  <path class="line" d="M520 199 L598 136" marker-end="url(#arr-al-1)"/>
  <path class="line" d="M520 199 L598 204" marker-end="url(#arr-al-1)"/>

  <text x="390" y="258" text-anchor="middle" class="small">Defaults: group_wait 30s · group_interval 5m · repeat_interval 4h</text>
</svg>
<figcaption>Prometheus decides <em>whether</em> something is wrong. Alertmanager decides <em>who hears about it, how, and how often</em>.</figcaption>
</figure>

<ul>
  <li><strong>Grouping</strong>: alerts sharing the <code>group_by</code> labels become one notification. <code>group_wait</code> holds the first one briefly so related alerts arrive together. <code>group_interval</code> spaces out updates to a group, and <code>repeat_interval</code> re-sends while it's still firing.</li>
  <li><strong>Inhibition</strong>: while a source alert fires, matching target alerts are muted. Typical uses: "the whole cluster is down" mutes every per-service alert in it, or a page mutes the ticket for the same service.</li>
  <li><strong>Silences</strong>: time-boxed, manual mutes created in the UI or with <code>amtool</code>, for maintenance or a known issue.</li>
  <li><strong>Routing</strong>: a tree of label matchers. An alert stops at the first matching child route unless <code>continue: true</code> is set.</li>
</ul>

<h3>What <code>for:</code> does</h3>
<figure class="diagram">
<svg viewBox="0 0 780 262" role="img" aria-label="Error rate over 20 minutes with a 2 percent threshold. A one-minute spike at 14:03 crosses the threshold but the rule only reaches pending and never fires. From about 14:08 the error rate stays above threshold; after 5 minutes pending, at about 14:13 the alert fires and a notification is sent. At 14:15 the rate drops and the alert resolves.">
  <path class="line" d="M60 36 V200 H740"/>
  <text x="52" y="44" text-anchor="end" class="small">6%</text>
  <text x="52" y="204" text-anchor="end" class="small">0%</text>
  <path class="line bad dashed" d="M60 147 H740"/>
  <text x="736" y="140" text-anchor="end" class="small">threshold 2%</text>
  <path class="line accent" d="M60 192 L162 192 L179 93 L196 192 L332 192 L349 88 L570 88 L587 190 L740 190" style="stroke-width: 2"/>
  <text x="179" y="62" text-anchor="middle" class="small">1-min spike:</text>
  <text x="179" y="76" text-anchor="middle" class="small">never fires</text>
  <path class="line dashed" d="M513 88 V208"/>
  <text x="400" y="70" class="small">notified at ~14:13 (after for: + group_wait)</text>

  <rect class="box muted" x="60" y="210" width="110" height="24" rx="3"/>
  <text x="115" y="226" text-anchor="middle" class="small">inactive</text>
  <rect class="box accent" x="170" y="210" width="18" height="24" rx="3"/>
  <rect class="box muted" x="188" y="210" width="155" height="24" rx="3"/>
  <text x="265" y="226" text-anchor="middle" class="small">inactive</text>
  <rect class="box accent" x="343" y="210" width="170" height="24" rx="3"/>
  <text x="428" y="226" text-anchor="middle" class="small">pending (for: 5m)</text>
  <rect class="box bad" x="513" y="210" width="67" height="24" rx="3"/>
  <text x="546" y="226" text-anchor="middle" class="small">firing</text>
  <rect class="box muted" x="580" y="210" width="160" height="24" rx="3"/>
  <text x="660" y="226" text-anchor="middle" class="small">resolved</text>
  <text x="60" y="252" text-anchor="middle" class="small">14:00</text>
  <text x="230" y="252" text-anchor="middle" class="small">14:05</text>
  <text x="400" y="252" text-anchor="middle" class="small">14:10</text>
  <text x="570" y="252" text-anchor="middle" class="small">14:15</text>
  <text x="740" y="252" text-anchor="middle" class="small">14:20</text>
</svg>
<figcaption><code>for:</code> trades detection time for fewer false alarms. Too short and blips page people; too long and a real outage burns minutes before anyone knows.</figcaption>
</figure>

<h2>Page, ticket, or neither</h2>
<table>
  <tr><th>Class</th><th>Use when</th><th>Delivered to</th><th>Example</th></tr>
  <tr><td><strong>Page</strong></td><td>users are hurt now, or will be soon, and a human must act</td><td>on-call phone (PagerDuty, Opsgenie), any hour</td><td>checkout 5xx above 2% for 5 min; SLO burning fast</td></tr>
  <tr><td><strong>Ticket</strong></td><td>real problem, but it can wait hours or days</td><td>team channel, issue tracker</td><td>p99 slowly creeping up; disk full in 4 days; cert expires in 14 days</td></tr>
  <tr><td><strong>Dashboard only</strong></td><td>useful while debugging, not actionable alone</td><td>nobody is notified</td><td>CPU 85%, one pod restarted, GC pauses</td></tr>
  <tr><td><strong>Burn-rate alert</strong></td><td>you have an SLO and want urgency to match budget spend</td><td>fast burn pages, slow burn tickets</td><td>2% of a 30-day budget gone in 1 hour (burn rate 14.4)</td></tr>
</table>
<p>A useful test for every page: is it <strong>urgent</strong>, <strong>actionable</strong>, and <strong>user-visible</strong>? If any answer is no, it's a ticket or a dashboard panel. Burn-rate alerting is the most robust way to page on SLOs; the windows and numbers are in <a href="#error-budgets">Error Budgets</a>.</p>

<h2>Example</h2>
<p><strong>Prometheus rules</strong>: one symptom that pages, one that becomes a ticket. Every alert carries a <code>severity</code> label for routing and a <code>runbook_url</code>.</p>
<pre><code>groups:
  - name: checkout
    rules:
      - alert: CheckoutHighErrorRate
        expr: |
          sum(rate(http_requests_total{service="checkout", code=~"5.."}[5m]))
            / sum(rate(http_requests_total{service="checkout"}[5m])) &gt; 0.02
        for: 5m
        labels:
          severity: page
          team: payments
        annotations:
          summary: "Checkout 5xx ratio is {{ $value | humanizePercentage }}"
          runbook_url: https://runbooks.example.com/checkout-errors
          dashboard: https://grafana.example.com/d/checkout

      - alert: CheckoutHighLatency
        expr: |
          histogram_quantile(0.99,
            sum by (le) (rate(http_request_duration_seconds_bucket{service="checkout"}[5m]))
          ) &gt; 0.8
        for: 15m
        labels:
          severity: ticket
          team: payments
        annotations:
          summary: "p99 above 800ms for 15m"
          runbook_url: https://runbooks.example.com/checkout-latency</code></pre>
<p><strong>Alertmanager</strong>: group per service, route by severity, and mute tickets while a page is firing for the same service. Secrets are read from files, never written inline. The <code>ticket-queue</code> webhook points at a small bridge, like the Go one below, that posts to Slack and opens tickets.</p>
<pre><code>route:
  receiver: ticket-queue            # fallback when nothing below matches
  group_by: [alertname, service]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  routes:
    - matchers: [severity="page"]
      receiver: pagerduty-payments
    - matchers: [severity="ticket"]
      receiver: ticket-queue

inhibit_rules:
  - source_matchers: [severity="page"]
    target_matchers: [severity="ticket"]
    equal: [service]                # only within the same service

receivers:
  - name: pagerduty-payments
    pagerduty_configs:
      - routing_key_file: /etc/alertmanager/secrets/pagerduty-payments
  - name: ticket-queue
    webhook_configs:
      - url: http://alert-bridge:9095/alertmanager</code></pre>
<p><strong>A Go webhook receiver</strong>, for your own integrations (chat bot, auto-ticketing). Alertmanager POSTs JSON in its version 4 webhook format:</p>
<pre><code>package main

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"time"
)

// The subset of Alertmanager's webhook payload (version "4") we use.
type Notification struct {
	Version     string            &#96;json:"version"&#96;
	Status      string            &#96;json:"status"&#96; // "firing" or "resolved"
	Receiver    string            &#96;json:"receiver"&#96;
	GroupLabels map[string]string &#96;json:"groupLabels"&#96;
	Alerts      []Alert           &#96;json:"alerts"&#96;
}

type Alert struct {
	Status      string            &#96;json:"status"&#96;
	Labels      map[string]string &#96;json:"labels"&#96;
	Annotations map[string]string &#96;json:"annotations"&#96;
	StartsAt    time.Time         &#96;json:"startsAt"&#96;
	Fingerprint string            &#96;json:"fingerprint"&#96;
}

// Alertmanager retries failed webhooks, so the same alert can arrive more
// than once: key any side effect (ticket, chat message) on the fingerprint.
func webhook(w http.ResponseWriter, r *http.Request) {
	var n Notification
	if err := json.NewDecoder(r.Body).Decode(&amp;n); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	for _, a := range n.Alerts {
		msg := fmt.Sprintf("[%s] %s: %s (since %s) runbook: %s",
			a.Status, a.Labels["alertname"], a.Annotations["summary"],
			a.StartsAt.Format(time.RFC3339), a.Annotations["runbook_url"])
		slog.Info("alert", "receiver", n.Receiver, "fingerprint", a.Fingerprint, "text", msg)
	}
	w.WriteHeader(http.StatusOK) // anything else makes Alertmanager retry
}

func main() {
	http.HandleFunc("POST /alertmanager", webhook)
	http.ListenAndServe(":9095", nil)
}</code></pre>
<p>Real output when the test posts a firing alert:</p>
<pre><code>time=2026-11-08T12:26:44.883Z level=INFO msg=alert receiver=ticket-queue fingerprint=3b1f0c9a7d2e4f11 text="[firing] CheckoutHighLatency: p99 above 800ms for 15m (since 2026-11-08T14:05:00Z) runbook: https://runbooks.example.com/checkout-latency"</code></pre>

<p><strong>Real-world scenario.</strong> A team had 60 alerts, mostly on causes: CPU, memory, pod restarts, queue depth on every queue. On-call received about 30 pages a week, and fewer than one in ten needed action. When the database primary failed over at 02:10, 140 notifications arrived within two minutes and the one that mattered was buried. They replaced most of the alerts with two symptom alerts per service (error ratio and latency, later burn-rate alerts on their SLOs), moved cause alerts to dashboards or tickets, grouped by <code>service</code>, and added an inhibit rule so a "database down" alert mutes downstream alerts. Pages dropped to a few a week, and each one now links a runbook.</p>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>Paging on causes.</strong> "CPU &gt; 80%" pages at 03:00 while users are fine, and stays quiet during a real outage caused by something else.</li>
  <li><strong>No <code>for:</code>, or a huge one.</strong> Zero <code>for:</code> pages on every blip. Thirty minutes means users suffer for half an hour first. For flapping alerts, Prometheus also has <code>keep_firing_for</code>, which keeps an alert firing for a while after the condition clears.</li>
  <li><strong>Alerting on ratios at low traffic.</strong> One failure in 3 requests at 04:00 is "33% errors". Add a minimum-traffic condition, or use burn-rate alerts over longer windows.</li>
  <li><strong>Missing data never alerts.</strong> If the target stops being scraped, <code>rate(...) &gt; x</code> returns nothing, and nothing fires. Add <code>up == 0</code> or <code>absent()</code> alerts, and an external heartbeat ("dead man's switch") that pages if Alertmanager itself goes quiet.</li>
  <li><strong>No runbook, no owner.</strong> Every page needs a team label, a dashboard link and a runbook: what it means, how to check, how to mitigate.</li>
  <li><strong>Never deleting alerts.</strong> Review pages after each on-call shift. An alert that fired and needed no action should be fixed, downgraded or deleted.</li>
  <li><strong>Webhook receivers that aren't idempotent.</strong> Alertmanager retries on non-2xx responses, and runs in HA pairs, so duplicates happen. Deduplicate on the alert fingerprint.</li>
</ul>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>Page on symptoms users feel; put causes on dashboards or in tickets.</li>
  <li>Every page must be urgent, actionable and user-visible, with a runbook link.</li>
  <li>Alertmanager's grouping, inhibition and silences turn an alert storm into one useful notification.</li>
  <li>With SLOs in place, multi-window burn-rate alerts are the best default for paging.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#monitoring">Monitoring</a> · <a href="#slos">SLOs</a> · <a href="#error-budgets">Error Budgets</a> · <a href="#on-call">On-Call</a> · <a href="#production-incidents">Production Incidents</a> · <a href="#real-world-observability-stack">Real-World Observability Stack</a></p>
`;

CONTENT["slis"] = `
<p class="tldr"><strong>TL;DR</strong>: A Service Level Indicator (SLI) is a number that measures how well your service is doing <em>from the user's point of view</em>, usually expressed as <strong>good events ÷ valid events</strong>, e.g. "99.88% of checkout requests succeeded". It's the speedometer reading; the <a href="#slos">SLO</a> is the speed limit you compare it against.</p>

<h2>The problem it solves</h2>
<p>Teams argue about reliability using whatever numbers they happen to have: "CPU is fine", "uptime is 100%", "the pods are healthy". None of that says whether users can actually check out. Without an agreed SLI:</p>
<ul>
  <li>Each team measures something different, so "reliable" means nothing.</li>
  <li>You can't set an <a href="#slos">SLO</a>, compute an <a href="#error-budgets">error budget</a>, or write a symptom-based <a href="#alerts">alert</a>, because they all need an SLI underneath.</li>
  <li>"The server was up" hides failures users saw: requests that errored, timed out, or never reached the server at all.</li>
</ul>
<p>An SLI fixes the definition first: <em>which events count</em>, <em>what makes one good</em>, and <em>where it's measured</em>.</p>

<h2>How it works</h2>
<p>The Google SRE Workbook recommends expressing every SLI as a ratio, so it always runs from 0% (nothing works) to 100% (nothing is broken):</p>
<p style="text-align:center"><strong>SLI = good events ÷ valid events × 100%</strong></p>
<ul>
  <li><strong>Valid events</strong>: the ones that should count. Exclude health checks, your own load tests, and requests for routes that don't exist.</li>
  <li><strong>Good events</strong>: valid events that met the bar: not a 5xx, faster than 300 ms, fresher than 1 hour.</li>
</ul>
<p>The ratio form makes SLIs comparable across services, and it plugs straight into SLOs ("99.9% good") and error budgets ("0.1% may be bad").</p>

<figure class="diagram">
<svg viewBox="0 0 780 250" role="img" aria-label="Of 1,000,000 requests, 20,000 are not valid, such as health checks and load tests. Of the 980,000 valid requests, 978,800 are good, non-5xx responses, and 1,200 are 5xx. The SLI is 978,800 divided by 980,000, which is 99.88 percent.">
  <rect class="box muted" x="20" y="20" width="440" height="215" rx="10"/>
  <text x="36" y="42" class="title">all requests: 1,000,000</text>
  <rect class="box accent" x="40" y="56" width="400" height="140" rx="8"/>
  <text x="56" y="78" class="title">valid: 980,000</text>
  <rect class="box ok" x="60" y="92" width="300" height="88" rx="6"/>
  <text x="210" y="132" text-anchor="middle" class="title">good: 978,800</text>
  <text x="210" y="150" text-anchor="middle" class="small">non-5xx responses</text>
  <rect class="box bad" x="370" y="92" width="56" height="88" rx="6"/>
  <text x="398" y="132" text-anchor="middle" class="title">5xx</text>
  <text x="398" y="150" text-anchor="middle" class="small">1,200</text>
  <text x="36" y="220" class="small">not valid: health checks, load tests, unknown routes (20,000)</text>

  <text x="620" y="80" text-anchor="middle" class="title">SLI = good ÷ valid</text>
  <text x="620" y="110" text-anchor="middle">978,800 ÷ 980,000</text>
  <text x="620" y="142" text-anchor="middle" class="title">= 99.88%</text>
  <path class="line dashed" d="M500 164 H740"/>
  <text x="620" y="188" text-anchor="middle" class="small">compared with an SLO of 99.9%:</text>
  <text x="620" y="204" text-anchor="middle" class="small">just below target</text>
</svg>
<figcaption>Boxes are not to scale. Deciding what counts as valid is as important as deciding what counts as good.</figcaption>
</figure>

<h3>Where to measure</h3>
<p>The same SLI can be measured at different points. The closer to the user, the more accurate, and the harder to collect:</p>
<figure class="diagram">
<svg viewBox="0 0 780 262" role="img" aria-label="A request path from the user's browser through the internet and CDN, the load balancer, the app server and the database. Measurement points below: client-side instrumentation is closest to users; probers send synthetic requests and catch DNS and TLS outages; load balancer metrics see 502s from dead pods; app metrics have rich labels but miss requests that never arrive. The database is not an SLI source because users don't call it.">
  <defs><marker id="arr-sli-2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <text x="20" y="22" class="small">← closer to what users experience</text>
  <text x="760" y="22" text-anchor="end" class="small">easier to instrument →</text>
  <rect class="box" x="20" y="36" width="130" height="50" rx="8"/><text x="85" y="66" text-anchor="middle" class="title">user's browser</text>
  <rect class="box" x="175" y="36" width="130" height="50" rx="8"/><text x="240" y="66" text-anchor="middle" class="title">internet / CDN</text>
  <rect class="box" x="330" y="36" width="130" height="50" rx="8"/><text x="395" y="66" text-anchor="middle" class="title">load balancer</text>
  <rect class="box" x="485" y="36" width="130" height="50" rx="8"/><text x="550" y="66" text-anchor="middle" class="title">app server</text>
  <rect class="box muted" x="640" y="36" width="120" height="50" rx="8"/><text x="700" y="66" text-anchor="middle" class="title">database</text>
  <path class="line" d="M150 61 H173" marker-end="url(#arr-sli-2)"/>
  <path class="line" d="M305 61 H328" marker-end="url(#arr-sli-2)"/>
  <path class="line" d="M460 61 H483" marker-end="url(#arr-sli-2)"/>
  <path class="line" d="M615 61 H638" marker-end="url(#arr-sli-2)"/>

  <rect class="box ok" x="20" y="150" width="130" height="96" rx="8"/>
  <text x="85" y="172" text-anchor="middle" class="title">client-side</text>
  <text x="85" y="194" text-anchor="middle" class="small">closest to users</text>
  <text x="85" y="210" text-anchor="middle" class="small">needs an SDK and</text>
  <text x="85" y="226" text-anchor="middle" class="small">its own pipeline</text>
  <rect class="box ok" x="175" y="150" width="130" height="96" rx="8"/>
  <text x="240" y="172" text-anchor="middle" class="title">prober</text>
  <text x="240" y="194" text-anchor="middle" class="small">synthetic requests</text>
  <text x="240" y="210" text-anchor="middle" class="small">catch DNS/TLS</text>
  <text x="240" y="226" text-anchor="middle" class="small">outages; few paths</text>
  <rect class="box ok" x="330" y="150" width="130" height="96" rx="8"/>
  <text x="395" y="172" text-anchor="middle" class="title">LB metrics</text>
  <text x="395" y="194" text-anchor="middle" class="small">sees 502s from</text>
  <text x="395" y="210" text-anchor="middle" class="small">dead or full pods</text>
  <text x="395" y="226" text-anchor="middle" class="small">few labels</text>
  <rect class="box ok" x="485" y="150" width="130" height="96" rx="8"/>
  <text x="550" y="172" text-anchor="middle" class="title">app metrics</text>
  <text x="550" y="194" text-anchor="middle" class="small">rich labels (route)</text>
  <text x="550" y="210" text-anchor="middle" class="small">misses requests</text>
  <text x="550" y="226" text-anchor="middle" class="small">that never arrive</text>
  <rect class="box muted" x="640" y="150" width="120" height="96" rx="8"/>
  <text x="700" y="172" text-anchor="middle" class="title">not an SLI</text>
  <text x="700" y="194" text-anchor="middle" class="small">users don't call</text>
  <text x="700" y="210" text-anchor="middle" class="small">it; it's a cause,</text>
  <text x="700" y="226" text-anchor="middle" class="small">not a symptom</text>
  <path class="line dashed" d="M85 148 V90" marker-end="url(#arr-sli-2)"/>
  <path class="line dashed" d="M240 148 V90" marker-end="url(#arr-sli-2)"/>
  <path class="line dashed" d="M395 148 V90" marker-end="url(#arr-sli-2)"/>
  <path class="line dashed" d="M550 148 V90" marker-end="url(#arr-sli-2)"/>
  <text x="96" y="124" class="small">measured here</text>
</svg>
<figcaption>Many teams start with load balancer or app metrics because they already exist, and add probers to catch "the whole site is unreachable".</figcaption>
</figure>

<h2>Choosing SLIs by service type</h2>
<p>The SRE Workbook groups SLIs by what the service does. Pick one or two per user journey, not twenty.</p>
<table>
  <tr><th>Service type</th><th>SLI</th><th>Good event</th><th>Valid event</th></tr>
  <tr><td rowspan="3">Request-driven<br>(API, website)</td><td>Availability</td><td>response that isn't a 5xx</td><td>requests, excluding health checks</td></tr>
  <tr><td>Latency</td><td>response faster than 300 ms</td><td>same</td></tr>
  <tr><td>Quality</td><td>full answer, not a degraded fallback (e.g. results without recommendations)</td><td>same</td></tr>
  <tr><td rowspan="3">Pipeline<br>(batch, stream)</td><td>Freshness</td><td>reads served from data updated less than 1 hour ago</td><td>reads (or minutes, if measured over time)</td></tr>
  <tr><td>Correctness</td><td>output records that pass verification</td><td>records checked</td></tr>
  <tr><td>Coverage</td><td>input records processed</td><td>input records received</td></tr>
  <tr><td>Storage</td><td>Durability</td><td>written objects that can be read back</td><td>objects written</td></tr>
</table>
<p><strong>What about 4xx?</strong> Usually they count as good: the service correctly rejected a bad request. Exceptions are worth thinking about: a <code>429</code> from your own overload protection, or a <code>404</code> caused by a bug, is your failure, not the client's.</p>

<h2>Example</h2>
<p><strong>Instrumenting a Go service for SLIs</strong> with <code>prometheus/client_golang</code>. Two details matter: the route label is the pattern (low cardinality), and the latency threshold, 300 ms, is an exact histogram bucket boundary.</p>
<pre><code>package main

import (
	"net/http"
	"strconv"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

var (
	requests = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "http_requests_total",
		Help: "Requests by route and status code.",
	}, []string{"route", "code"})

	// 0.3 must be a bucket boundary: the latency SLI counts requests
	// "faster than 300 ms", and PromQL can only read exact bucket edges.
	duration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "http_request_duration_seconds",
		Help:    "Request latency.",
		Buckets: []float64{0.05, 0.1, 0.3, 1, 3},
	}, []string{"route"})
)

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}

func Instrument(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sw := &amp;statusWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(sw, r)
		route := r.Pattern // low cardinality: "GET /orders/{id}", never the raw path
		requests.WithLabelValues(route, strconv.Itoa(sw.status)).Inc()
		duration.WithLabelValues(route).Observe(time.Since(start).Seconds())
	})
}

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /orders/{id}", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(&#96;{"id":"&#96; + r.PathValue("id") + &#96;"}&#96;))
	})
	http.Handle("/", Instrument(mux))
	http.Handle("GET /metrics", promhttp.Handler()) // not instrumented: not a user request
	http.ListenAndServe(":8080", nil)
}</code></pre>
<p>After three successful requests and one 500 (from an <code>httptest</code> run), <code>/metrics</code> really contains:</p>
<pre><code># TYPE http_request_duration_seconds histogram
http_request_duration_seconds_bucket{route="GET /orders/{id}",le="0.05"} 4
http_request_duration_seconds_bucket{route="GET /orders/{id}",le="0.1"} 4
http_request_duration_seconds_bucket{route="GET /orders/{id}",le="0.3"} 4
http_request_duration_seconds_bucket{route="GET /orders/{id}",le="1"} 4
http_request_duration_seconds_bucket{route="GET /orders/{id}",le="3"} 4
http_request_duration_seconds_bucket{route="GET /orders/{id}",le="+Inf"} 4
http_request_duration_seconds_sum{route="GET /orders/{id}"} 7.716800000000002e-05
http_request_duration_seconds_count{route="GET /orders/{id}"} 4
# TYPE http_requests_total counter
http_requests_total{code="200",route="GET /orders/{id}"} 3
http_requests_total{code="500",route="GET /orders/{id}"} 1</code></pre>
<p>Here availability is 3 ÷ 4 = 75%, and the latency SLI is 4 ÷ 4 = 100% (all four were under 0.3 s). In PromQL:</p>
<pre><code># Availability SLI, last 5 minutes: non-5xx ÷ all instrumented requests
sum(rate(http_requests_total{code!~"5.."}[5m]))
  / sum(rate(http_requests_total[5m]))

# Latency SLI: requests under 300 ms ÷ all requests (needs the le="0.3" bucket)
sum(rate(http_request_duration_seconds_bucket{le="0.3"}[5m]))
  / sum(rate(http_request_duration_seconds_count[5m]))

# The same availability SLI over a 30-day SLO window
sum(increase(http_requests_total{code!~"5.."}[30d]))
  / sum(increase(http_requests_total[30d]))

# Pipeline freshness: fraction of minutes in 30 days where data was under 1 hour old
# (the job sets this gauge when a run succeeds)
avg_over_time((time() - pipeline_last_success_timestamp_seconds &lt; bool 3600)[30d:1m])</code></pre>

<p><strong>Real-world scenario.</strong> A team defined checkout availability from app metrics, and it read 99.97% for the month. Yet support saw complaints after every deploy. The load balancer's metrics explained it: during each rolling deploy, pods were killed before they were removed from the load balancer, and for about 10 minutes the LB returned 502 for roughly 1,800 of 120,000 requests, around 1.5%. None of those requests reached the app, so app metrics never counted them. Measuring the SLI at the load balancer exposed the gap. The fix was graceful shutdown (see <a href="#liveness-readiness-probes">Liveness &amp; Readiness Probes</a>), and the SLI moved to the LB permanently.</p>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>Measuring what's easy instead of what users feel.</strong> CPU, memory and "pod is up" are not SLIs. Ask: if this number gets worse, does a user notice?</li>
  <li><strong>Averages as latency SLIs.</strong> Mean latency hides the slow tail. Use "fraction of requests faster than X", which is also a proper good/valid ratio (see <a href="#p99-latency">p99 Latency</a>).</li>
  <li><strong>Thresholds that don't match buckets.</strong> If 300 ms isn't a bucket boundary, you can't count requests under 300 ms exactly. Choose buckets after choosing the SLI.</li>
  <li><strong>Counting health checks and synthetic traffic.</strong> Thousands of cheap <code>/healthz</code> hits inflate the SLI. Exclude them in the valid-events selector, or keep them off the instrumented handler as the example does.</li>
  <li><strong>One SLI for the whole service.</strong> A 99.95% overall ratio can hide a broken checkout behind millions of healthy product-page reads. Define SLIs per critical user journey.</li>
  <li><strong>Too many SLIs.</strong> Twenty indicators per service means nobody watches any of them. Start with availability and latency for your top journeys.</li>
  <li><strong>Low traffic.</strong> At 50 requests an hour, one failure moves the ratio 2%. Use longer windows, or add probers to create a steady baseline of events.</li>
</ul>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>An SLI is good events ÷ valid events, measured from the user's point of view.</li>
  <li>Request services: availability and latency (plus quality). Pipelines: freshness, correctness, coverage. Storage: durability.</li>
  <li>Where you measure changes what you see: LB and client-side catch failures app metrics miss.</li>
  <li>Design instrumentation for the SLI: low-cardinality labels and a bucket at the latency threshold.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#slos">SLOs</a> · <a href="#error-budgets">Error Budgets</a> · <a href="#metrics">Metrics</a> · <a href="#alerts">Alerts</a> · <a href="#p99-latency">p99 Latency</a> · <a href="#real-world-observability-stack">Real-World Observability Stack</a></p>
`;

CONTENT["slos"] = `
<p class="tldr"><strong>TL;DR</strong>: A Service Level Objective (SLO) is a target for an SLI over a time window, for example "99.9% of checkout requests succeed in under 300 ms, measured over a rolling 30 days". It turns "be reliable" into a number the team can check, plan against and argue about. Think of it as the speed limit for unreliability: you don't have to drive at zero, you have to stay under the line.</p>

<h2>The problem it solves</h2>
<p>Without an explicit target, reliability is a feeling. Product wants features, operations wants stability, and nobody can say whether last week's 12 minutes of errors was fine or a disaster. Common symptoms:</p>
<ul>
  <li><strong>Everything is urgent.</strong> Every blip pages someone, because there's no line between "normal noise" and "users are hurting".</li>
  <li><strong>100% as the implicit goal.</strong> It's impossible, and chasing it freezes releases. Users can't tell 99.999% from 100% anyway: their own Wi-Fi, phone and ISP fail more often than that.</li>
  <li><strong>No shared language.</strong> "Is the API reliable enough to build on?" has no answer until someone writes the number down.</li>
</ul>
<p>The Google SRE book defines an SLO as "a target value or range of values for a service level that is measured by an SLI". The SLI (see <a href="#slis">SLIs</a>) is the measurement; the SLO is the line you hold it to.</p>

<h2>How it works</h2>
<p>An SLO has three parts. Leave one out and it can't be checked:</p>
<ol>
  <li><strong>An SLI</strong>: what you count, usually <em>good events / valid events</em>.</li>
  <li><strong>A target</strong>: the fraction that must be good, such as 99.9%.</li>
  <li><strong>A window</strong>: the period you measure over, such as a rolling 30 days.</li>
</ol>
<figure class="diagram">
<svg viewBox="0 0 780 206" role="img" aria-label="Anatomy of an SLO: an SLI of good over valid requests, a target of at least 99.9 percent and a rolling 30-day window combine into a met or missed result. The result is used by the error budget, burn-rate alerts, release decisions and reliability reviews.">
  <defs><marker id="arr-slo-1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <text x="295" y="20" text-anchor="middle" class="small">"99.9% of checkout requests succeed in under 300 ms, over a rolling 30 days"</text>
  <path class="line" d="M10 40 V32 H580 V40"/>
  <rect class="box" x="10" y="50" width="170" height="80" rx="10"/>
  <text x="95" y="74" text-anchor="middle" class="title">SLI</text>
  <text x="95" y="94" text-anchor="middle" class="small">good ÷ valid requests</text>
  <text x="95" y="110" text-anchor="middle" class="small">good = non-5xx, &lt; 300 ms</text>
  <rect class="box accent" x="210" y="50" width="170" height="80" rx="10"/>
  <text x="295" y="74" text-anchor="middle" class="title">Target</text>
  <text x="295" y="94" text-anchor="middle" class="small">≥ 99.9% good</text>
  <text x="295" y="110" text-anchor="middle" class="small">(0.1% may be bad)</text>
  <rect class="box accent" x="410" y="50" width="170" height="80" rx="10"/>
  <text x="495" y="74" text-anchor="middle" class="title">Window</text>
  <text x="495" y="94" text-anchor="middle" class="small">rolling 30 days</text>
  <text x="495" y="110" text-anchor="middle" class="small">or a calendar month</text>
  <rect class="box ok" x="610" y="50" width="160" height="80" rx="10"/>
  <text x="690" y="74" text-anchor="middle" class="title">Met / missed</text>
  <text x="690" y="94" text-anchor="middle" class="small">99.94% ≥ 99.9% ✓</text>
  <text x="690" y="110" text-anchor="middle" class="small">checked continuously</text>
  <path class="line" d="M180 90 H208" marker-end="url(#arr-slo-1)"/>
  <path class="line" d="M380 90 H408" marker-end="url(#arr-slo-1)"/>
  <path class="line" d="M580 90 H608" marker-end="url(#arr-slo-1)"/>
  <path class="line" d="M690 130 V156" marker-end="url(#arr-slo-1)"/>
  <rect class="box muted" x="10" y="158" width="760" height="40" rx="8"/>
  <text x="390" y="183" text-anchor="middle" class="small">used by: error budget (1 − target) · burn-rate alerts · release decisions · reliability reviews</text>
</svg>
<figcaption>The SLI is a measurement, the SLO is a promise about it. "99.9%" alone is not an SLO: 99.9% of what, measured where, over how long?</figcaption>
</figure>

<h3>The nines: what a target allows</h3>
<p>Every target implies how much "bad" you may have. For a time-based SLI ("minutes the service was up"), that's downtime. For a request-based SLI it's the same fraction of requests. These numbers come from the Go program below, plus simple multiplication for the day and year columns.</p>
<table>
  <tr><th>Target</th><th>Bad allowed per day</th><th>Per 30 days</th><th>Per year (365 d)</th><th>What it usually takes</th></tr>
  <tr><td>99%</td><td>14 min 24 s</td><td>7 h 12 min</td><td>3.65 days</td><td>business hours fixes, manual deploys can be fine</td></tr>
  <tr><td>99.5%</td><td>7 min 12 s</td><td>3 h 36 min</td><td>43.8 h</td><td>someone reachable out of hours</td></tr>
  <tr><td>99.9%</td><td>1 min 26 s</td><td>43 min 12 s</td><td>8.76 h</td><td>on-call, alerts on symptoms, quick rollback</td></tr>
  <tr><td>99.95%</td><td>43 s</td><td>21 min 36 s</td><td>4.38 h</td><td>automated rollback, redundancy in every layer</td></tr>
  <tr><td>99.99%</td><td>8.6 s</td><td>4 min 19 s</td><td>52.6 min</td><td>failover without humans; a human can barely log in that fast</td></tr>
  <tr><td>99.999%</td><td>0.86 s</td><td>26 s</td><td>5.3 min</td><td>multi-region, automated everything, very few changes</td></tr>
</table>
<p>Each extra nine cuts the allowance by 10× and usually costs far more than 10× the effort. Also note the ceiling from dependencies: a request that needs three services in series, each at 99.9%, succeeds at best 0.999³ ≈ 99.7% of the time if they fail independently. You can't promise more than your critical path delivers.</p>

<h3>Rolling vs calendar windows</h3>
<p>A <strong>calendar</strong> window (this month, this quarter) resets on a fixed date. A <strong>rolling</strong> window (the last 30 days) slides forward every day, so a bad day counts for exactly 30 days and then drops out. The chart uses the real output from the Go example: 1M requests a day, and an outage on day 30 that fails 40,000 of them.</p>
<figure class="diagram">
<svg viewBox="0 0 780 304" role="img" aria-label="Two charts of the same 60 days. Rolling 30-day window: after the outage on day 30, compliance drops below the 99.9 percent target and stays there until day 60. Calendar window: compliance drops on day 30 but resets to 100 percent on day 31 when month 2 starts.">
  <text x="70" y="22" class="title">Rolling 30 days</text>
  <text x="411" y="22" class="small">month 2 starts →</text>
  <path class="line dashed" d="M405 30 V276"/>
  <text x="64" y="54" text-anchor="end" class="small">100%</text>
  <text x="64" y="94" text-anchor="end" class="small">99.9%</text>
  <path class="line bad dashed" d="M70 90 H740"/>
  <path class="line" d="M70 136 H740"/>
  <path class="line accent" d="M70 50 H388 L399 103 H729 L740 50"/>
  <text x="570" y="74" text-anchor="middle" class="small">the day-30 outage still counts on day 59</text>
  <text x="300" y="118" text-anchor="middle" class="small">day 30: 99.867% (missed)</text>
  <text x="64" y="140" text-anchor="end" class="small">99.8%</text>

  <text x="70" y="162" class="title">Calendar month</text>
  <text x="64" y="194" text-anchor="end" class="small">100%</text>
  <text x="64" y="234" text-anchor="end" class="small">99.9%</text>
  <path class="line bad dashed" d="M70 230 H740"/>
  <path class="line" d="M70 276 H740"/>
  <path class="line accent" d="M70 190 H388 L399 243 L411 190 H740"/>
  <text x="575" y="212" text-anchor="middle" class="small">day 31: a fresh month, 100% again</text>
  <text x="300" y="258" text-anchor="middle" class="small">day 30: 99.867% (missed)</text>
  <text x="64" y="280" text-anchor="end" class="small">99.8%</text>
  <text x="70" y="294" class="small">day 1</text>
  <text x="399" y="294" text-anchor="middle" class="small">day 30</text>
  <text x="740" y="294" text-anchor="end" class="small">day 60</text>
</svg>
<figcaption>Same data, two verdicts. A rolling window always reflects what users felt in the last 30 days, whatever the date. A calendar window lines up with billing and SLAs, but a bad day just before the reset is forgotten a day later.</figcaption>
</figure>

<h3>Choosing a target</h3>
<ul>
  <li><strong>Start from users, not from your graphs.</strong> The SRE book's advice is "don't pick a target based on current performance": if today's system happens to do 99.99%, adopting that can lock you into heroics to keep it.</li>
  <li><strong>Different journeys, different targets.</strong> Checkout at 99.9%, the recommendations widget at 99%, the nightly report "finished by 06:00 on 99% of days". Batch and pipeline SLOs often target freshness or completion time, not availability.</li>
  <li><strong>Few SLOs.</strong> Two or three per service (availability, latency, maybe freshness) beat twenty nobody reads.</li>
  <li><strong>Start loose, then tighten.</strong> "Perfection can wait": you can raise a target once you know what it costs. Lowering one later feels like failure.</li>
</ul>

<h3>SLA, external SLO, internal SLO</h3>
<figure class="diagram">
<svg viewBox="0 0 780 220" role="img" aria-label="Nested targets: the SLA at 99.5 percent, with service credits on breach, contains the external SLO at 99.9 percent published to customers, which contains the internal SLO at 99.95 percent that the team plans and alerts on.">
  <rect class="box bad" x="20" y="14" width="740" height="196" rx="12"/>
  <text x="36" y="36" class="title">SLA: 99.5% per month, breach → service credits (a contract, owned with legal and sales)</text>
  <rect class="box accent" x="60" y="50" width="660" height="150" rx="10"/>
  <text x="76" y="72" class="title">External SLO: 99.9% (published to customers, e.g. on a status page)</text>
  <rect class="box ok" x="100" y="86" width="580" height="104" rx="10"/>
  <text x="116" y="108" class="title">Internal SLO: 99.95% (what the team alerts and plans on)</text>
  <text x="116" y="134" class="small">missed first, so the team reacts while customers are still inside the promise</text>
  <text x="116" y="154" class="small">measured over the last 30 days: 99.97% ✓</text>
  <text x="116" y="174" class="small">each ring is looser than the one inside it: that gap is the safety margin</text>
</svg>
<figcaption>The SRE book recommends "using a tighter internal SLO than the SLO advertised to users". The SLA is the loosest of all, because breaking it costs money.</figcaption>
</figure>
<table>
  <tr><th></th><th>Internal SLO</th><th>External SLO</th><th>SLA</th></tr>
  <tr><td>Audience</td><td>the owning team</td><td>customers, other teams</td><td>customers, lawyers</td></tr>
  <tr><td>Typical tightness</td><td>tightest</td><td>middle</td><td>loosest</td></tr>
  <tr><td>Missed means</td><td>slow down releases, fix reliability</td><td>trust drops, status page update</td><td>refunds or credits, contract terms</td></tr>
  <tr><td>Window</td><td>usually rolling</td><td>rolling or calendar</td><td>usually calendar (matches billing)</td></tr>
</table>

<h2>Example</h2>
<p><strong>An SLO in Go: allowed bad time, and rolling vs calendar compliance.</strong></p>
<pre><code>package main

import (
	"fmt"
	"time"
)

// An SLO is a target for an SLI over a window.
type SLO struct {
	Name   string
	Target float64       // 0.999 means 99.9%
	Window time.Duration // e.g. 30 days
}

// AllowedBad is the bad time a time-based SLI may have in one window.
func (s SLO) AllowedBad() time.Duration {
	return time.Duration((1 - s.Target) * float64(s.Window)).Round(time.Second)
}

// Day holds one day of a request-based SLI: good and valid events.
type Day struct{ Good, Valid int64 }

// Ratio is good / valid. No valid traffic means nothing failed.
func Ratio(days []Day) float64 {
	var good, valid int64
	for _, d := range days {
		good += d.Good
		valid += d.Valid
	}
	if valid == 0 {
		return 1
	}
	return float64(good) / float64(valid)
}

// Rolling: the n days that end on day i (inclusive).
func Rolling(days []Day, i, n int) []Day {
	return days[max(0, i-n+1) : i+1]
}

// Calendar: from the first day of the month up to day i.
func Calendar(days []Day, i, monthStart int) []Day {
	return days[monthStart : i+1]
}

func main() {
	month := 30 * 24 * time.Hour
	for _, t := range []float64{0.99, 0.995, 0.999, 0.9995, 0.9999, 0.99999} {
		s := SLO{Target: t, Window: month}
		fmt.Printf("%-8s allows %v per 30 days&#92;n", fmt.Sprintf("%.3f%%", t*100), s.AllowedBad())
	}

	// 60 days of 1M requests/day. Day 30 (index 29, the last day of month 1) has an
	// outage that fails 40,000 requests. Month 2 starts at index 30.
	days := make([]Day, 60)
	for i := range days {
		days[i] = Day{Good: 1_000_000, Valid: 1_000_000}
	}
	days[29].Good -= 40_000

	slo := SLO{Name: "checkout availability", Target: 0.999, Window: month}
	fmt.Println()
	for _, i := range []int{29, 30, 45, 58, 59} {
		r := Ratio(Rolling(days, i, 30))
		monthStart := 0
		if i &gt;= 30 {
			monthStart = 30
		}
		c := Ratio(Calendar(days, i, monthStart))
		fmt.Printf("day %2d  rolling-30d %.4f%% met=%-5v  calendar %.4f%% met=%v&#92;n",
			i+1, r*100, r &gt;= slo.Target, c*100, c &gt;= slo.Target)
	}
}</code></pre>
<p>Real output of <code>go run .</code>:</p>
<pre><code>99.000%  allows 7h12m0s per 30 days
99.500%  allows 3h36m0s per 30 days
99.900%  allows 43m12s per 30 days
99.950%  allows 21m36s per 30 days
99.990%  allows 4m19s per 30 days
99.999%  allows 26s per 30 days

day 30  rolling-30d 99.8667% met=false  calendar 99.8667% met=false
day 31  rolling-30d 99.8667% met=false  calendar 100.0000% met=true
day 46  rolling-30d 99.8667% met=false  calendar 100.0000% met=true
day 59  rolling-30d 99.8667% met=false  calendar 100.0000% met=true
day 60  rolling-30d 100.0000% met=true   calendar 100.0000% met=true</code></pre>
<p><strong>The same SLO in PromQL</strong>, as a ratio over 30 days. A 30-day range over raw counters is expensive, so in practice you build it from recording rules (the SLI page shows how; see <a href="#slis">SLIs</a>):</p>
<pre><code># fraction of checkout requests in the last 30 days that were not 5xx
sum(increase(http_requests_total{job="checkout", code!~"5.."}[30d]))
/
sum(increase(http_requests_total{job="checkout"}[30d]))</code></pre>

<p><strong>Real-world scenario: the target copied from a dashboard.</strong> A team launches an internal payments API. Its dashboard shows 99.995% over the last quarter, so they publish a 99.99% SLO: 4 min 19 s of bad per 30 days. It's 14:05 on a Tuesday when the primary database fails over. The failover itself takes 90 seconds, but clients hold dead connections for another 4 minutes until their pools recycle. One routine event has spent more than the whole month's allowance. The SLO is now "missed" for the next 30 days, and the error budget policy says freeze releases. The fix was not heroics: they moved the external SLO to 99.9% (43 min), kept 99.95% internally, and put connection lifetime limits on the pool, which a 99.9% target gave them room to ship.</p>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>Aiming for 100%.</strong> It forbids change, because every deploy is a risk. It also hides the real question: how unreliable can we be before users care?</li>
  <li><strong>Copying current performance.</strong> A lucky quarter becomes an obligation. Set targets from user needs and dependency limits.</li>
  <li><strong>An SLO without a window or SLI definition.</strong> "99.9% uptime" measured how, from where, over what period? Two people will compute two different numbers.</li>
  <li><strong>Too many SLOs.</strong> Twenty SLOs per service means none of them drive decisions. Cover what users notice: availability, latency, freshness.</li>
  <li><strong>Averaging away the pain.</strong> One global SLO hides a region or a big customer having a terrible week. Split by user-visible dimension when it matters, or add a separate SLO for it.</li>
  <li><strong>The SLA tighter than the SLO.</strong> Then you pay credits before your own alarms think anything is wrong. Keep the order: internal SLO &gt; external SLO &gt; SLA.</li>
  <li><strong>An SLO nobody acts on.</strong> A target with no consequence is a dashboard decoration. Tie it to an error budget policy (see <a href="#error-budgets">Error Budgets</a>).</li>
</ul>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>SLO = SLI + target + window. All three must be written down.</li>
  <li>Each nine is 10× less room: 99.9% is 43 min 12 s per 30 days, 99.99% is 4 min 19 s.</li>
  <li>Rolling windows show what users felt recently; calendar windows match contracts and billing.</li>
  <li>Internal SLO tighter than external SLO, external tighter than SLA.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#slis">SLIs</a> · <a href="#error-budgets">Error Budgets</a> · <a href="#alerts">Alerts</a> · <a href="#monitoring">Monitoring</a> · <a href="#metrics">Metrics</a> · <a href="#real-world-observability-stack">Real-World Observability Stack</a></p>
`;

