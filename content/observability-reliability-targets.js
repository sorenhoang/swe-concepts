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

