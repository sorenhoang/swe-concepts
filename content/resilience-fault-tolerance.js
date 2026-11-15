CONTENT["circuit-breakers"] = `
<p class="tldr"><strong>TL;DR</strong>: A circuit breaker sits in front of a call to a dependency and counts failures. When too many calls fail, it <strong>opens</strong> and rejects calls instantly for a while, instead of letting every request wait on a service that is down. After a pause it lets a few trial calls through (<strong>half-open</strong>), and closes again if they succeed. It works like the breaker in your house: it trips so one faulty appliance can't burn the whole building down.</p>

<h2>The problem it solves</h2>
<p>When a dependency gets slow or starts failing, the callers suffer more than the dependency does:</p>
<ul>
  <li><strong>Resource exhaustion.</strong> Each call to a slow service holds a goroutine, a connection from the pool, memory and often a database transaction while it waits. If the payments provider goes from 200 ms to 8 s, your API holds 40 times more in-flight requests for the same traffic. Thread pools, connection pools and file descriptors run out.</li>
  <li><strong>Cascading failure.</strong> Once those resources are gone, endpoints that never touch payments (search, product pages) fail too. One sick dependency takes down a healthy service, and that service's callers next.</li>
  <li><strong>Kicking a service while it's down.</strong> A dependency that is failing because it's overloaded gets the same traffic (plus retries), so it can't recover.</li>
</ul>
<p>A <a href="#timeouts">timeout</a> limits how long <em>one</em> call can hang. A breaker adds memory across calls: after enough evidence, it stops making the call at all, and gives the dependency room to recover.</p>

<h2>How it works</h2>
<p>A breaker is a small state machine wrapped around one dependency. Every call goes through it, and it records the result.</p>
<figure class="diagram">
<svg viewBox="0 0 780 330" role="img" aria-label="Circuit breaker state machine. Closed: calls pass through and failures are counted. When failures cross the threshold it trips to Open: calls fail fast and return a fallback. After the open timeout it moves to Half-open: a few trial calls are let in. If they succeed it goes back to Closed; if any trial fails it goes back to Open.">
  <defs><marker id="arr-cb-1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <rect class="box ok" x="40" y="120" width="190" height="80" rx="10"/>
  <text x="135" y="146" text-anchor="middle" class="title">Closed</text>
  <text x="135" y="166" text-anchor="middle" class="small">calls pass through</text>
  <text x="135" y="182" text-anchor="middle" class="small">results are counted</text>

  <rect class="box bad" x="550" y="120" width="190" height="80" rx="10"/>
  <text x="645" y="146" text-anchor="middle" class="title">Open</text>
  <text x="645" y="166" text-anchor="middle" class="small">fail fast: no call is sent</text>
  <text x="645" y="182" text-anchor="middle" class="small">return error or fallback</text>

  <rect class="box accent" x="295" y="236" width="190" height="80" rx="10"/>
  <text x="390" y="262" text-anchor="middle" class="title">Half-open</text>
  <text x="390" y="282" text-anchor="middle" class="small">let N trial calls through</text>
  <text x="390" y="298" text-anchor="middle" class="small">reject the rest</text>

  <path class="line bad" d="M150 118 C 260 30, 530 30, 635 118" marker-end="url(#arr-cb-1)"/>
  <text x="390" y="40" text-anchor="middle" class="small">trip: failure rate, consecutive failures or slow calls over threshold</text>

  <path class="line" d="M680 202 Q 690 280 489 282" marker-end="url(#arr-cb-1)"/>
  <text x="700" y="262" text-anchor="middle" class="small">open timeout</text>
  <text x="700" y="276" text-anchor="middle" class="small">elapses</text>

  <path class="line bad" d="M480 238 L586 204" marker-end="url(#arr-cb-1)"/>
  <text x="520" y="208" text-anchor="end" class="small">a trial call fails</text>

  <path class="line ok" d="M293 282 Q 110 282 110 204" marker-end="url(#arr-cb-1)"/>
  <text x="200" y="300" text-anchor="middle" class="small">N trials succeed: reset counts</text>

</svg>
<figcaption>The three states. Closed is normal operation, Open protects both sides, Half-open is a careful probe to find out whether the dependency has recovered.</figcaption>
</figure>

<h3>The three states</h3>
<ol>
  <li><strong>Closed</strong> (normal). Calls go through. The breaker records successes and failures in a window: the last N calls (count-based) or the last N seconds (time-based). Old results fall out of the window, so a burst of errors last Tuesday doesn't count today.</li>
  <li><strong>Open</strong> (tripped). When the trip condition is met, the breaker opens. For a fixed period (the <em>open timeout</em>, or <em>wait duration</em>) every call is rejected immediately with an error such as <code>gobreaker.ErrOpenState</code>. No network call is made. The caller returns a fallback or a quick error.</li>
  <li><strong>Half-open</strong> (probing). After the open timeout, the breaker lets a limited number of trial calls through and rejects the rest. If the trials succeed, it closes and resets its counts. If one fails, it opens again for another full period.</li>
</ol>
<p>Important detail: a breaker does not need a background timer. Most libraries switch from Open to Half-open lazily, on the first call that arrives after the timeout. That is why the state you read can lag behind the clock.</p>

<h3>When to trip</h3>
<table>
  <tr><th>Trip condition</th><th>Example</th><th>Good at</th><th>Watch out for</th></tr>
  <tr><td>Consecutive failures</td><td>open after 5 failures in a row (gobreaker's default trips at more than 5)</td><td>simple; reacts fast to a hard outage</td><td>never trips if 1 in 3 calls succeeds, even at a 66% error rate</td></tr>
  <tr><td>Failure ratio over a window</td><td>open when &ge; 50% of the last 100 calls failed</td><td>catches partial outages</td><td>needs a <strong>minimum number of calls</strong>, or 1 failure out of 1 call at 3 a.m. is a "100% error rate"</td></tr>
  <tr><td>Slow-call ratio</td><td>open when &ge; 80% of calls take longer than 2 s</td><td>catches the dependency that is "up" but useless</td><td>not every library has it; in others, a tight timeout turns slow calls into failures instead</td></tr>
  <tr><td>Concurrency limit</td><td>reject when 100 calls are already in flight</td><td>caps resources held by one dependency (a <em>bulkhead</em>)</td><td>a different tool; often combined with the breaker (see <a href="#backpressure">Backpressure</a>)</td></tr>
</table>
<p>Only count failures that say something about the dependency's health: connection errors, timeouts, <code>5xx</code>, <code>429</code>. A <code>404</code> or a validation error is the caller's problem. A request the caller cancelled says nothing at all. Counting these trips breakers on healthy services.</p>

<h3>Fallbacks: what to return when the breaker is open</h3>
<ul>
  <li><strong>A degraded answer</strong>: popular items instead of personalised recommendations, the default shipping estimate, a feature hidden from the page.</li>
  <li><strong>A cached value</strong>: the last known exchange rate or user profile, marked as possibly stale (see <a href="#caching">Caching</a>).</li>
  <li><strong>Accept now, finish later</strong>: "payment pending", with the work put on a queue for when the dependency is back (see <a href="#message-queues">Message Queues</a>).</li>
  <li><strong>A fast, clear error</strong>: a <code>503</code> with <code>Retry-After</code> is a valid fallback. Failing in 1 ms is far better than failing in 10 s.</li>
</ul>

<h3>One breaker per dependency</h3>
<p>The point of a breaker is isolation, so its scope matters. Use one breaker <strong>per dependency</strong> (payments, inventory, recommendations), and sometimes per endpoint or per host if they fail independently. A single global breaker would let a broken recommendations service block payments too.</p>

<figure class="diagram">
<svg viewBox="0 0 780 420" role="img" aria-label="Two panels. Without breakers: payments slows to 8 seconds, all 200 API threads wait on it, inventory is healthy but starved, and the whole API fails. With a breaker per dependency: the payments breaker is open and fails fast, the API uses 40 of 200 threads, inventory is served normally, and checkout shows payment pending.">
  <defs><marker id="arr-cb-2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <text x="20" y="24" class="title">Without breakers</text>
  <rect class="box" x="20" y="80" width="100" height="44" rx="8"/><text x="70" y="107" text-anchor="middle">clients</text>
  <rect class="box bad" x="180" y="60" width="160" height="84" rx="8"/>
  <text x="260" y="86" text-anchor="middle" class="title">API</text>
  <text x="260" y="106" text-anchor="middle" class="small">200 / 200 threads busy</text>
  <text x="260" y="122" text-anchor="middle" class="small">all waiting on payments</text>
  <rect class="box bad" x="600" y="30" width="160" height="56" rx="8"/>
  <text x="680" y="53" text-anchor="middle" class="title">Payments</text>
  <text x="680" y="72" text-anchor="middle" class="small">p99: 200 ms to 8 s</text>
  <rect class="box muted" x="600" y="118" width="160" height="56" rx="8"/>
  <text x="680" y="141" text-anchor="middle" class="title">Inventory</text>
  <text x="680" y="160" text-anchor="middle" class="small">healthy, but starved</text>
  <path class="line" d="M120 102 H178" marker-end="url(#arr-cb-2)"/>
  <path class="line bad" d="M340 86 L598 60" marker-end="url(#arr-cb-2)"/>
  <text x="440" y="62" text-anchor="middle" class="small">every call waits 8 s</text>
  <path class="line dashed" d="M340 118 L598 144" marker-end="url(#arr-cb-2)"/>
  <text x="460" y="150" text-anchor="middle" class="small">no free thread to call it</text>
  <text x="20" y="196" class="small">Result: search and cart fail too. One slow dependency took the whole API down.</text>

  <path class="line dashed" d="M20 212 H760" style="stroke: var(--line)"/>

  <text x="20" y="244" class="title">With a breaker per dependency</text>
  <rect class="box" x="20" y="300" width="100" height="44" rx="8"/><text x="70" y="327" text-anchor="middle">clients</text>
  <rect class="box ok" x="180" y="280" width="160" height="84" rx="8"/>
  <text x="260" y="306" text-anchor="middle" class="title">API</text>
  <text x="260" y="326" text-anchor="middle" class="small">40 / 200 threads busy</text>
  <text x="260" y="342" text-anchor="middle" class="small">fallback for payments</text>
  <rect class="box bad" x="410" y="262" width="120" height="40" rx="8"/><text x="470" y="287" text-anchor="middle" class="title">breaker: open</text>
  <rect class="box ok" x="410" y="340" width="120" height="40" rx="8"/><text x="470" y="365" text-anchor="middle" class="title">breaker: closed</text>
  <rect class="box bad" x="600" y="254" width="160" height="56" rx="8"/>
  <text x="680" y="277" text-anchor="middle" class="title">Payments</text>
  <text x="680" y="296" text-anchor="middle" class="small">slow, but not called</text>
  <rect class="box ok" x="600" y="332" width="160" height="56" rx="8"/>
  <text x="680" y="355" text-anchor="middle" class="title">Inventory</text>
  <text x="680" y="374" text-anchor="middle" class="small">healthy, served</text>
  <path class="line" d="M120 322 H178" marker-end="url(#arr-cb-2)"/>
  <path class="line" d="M340 306 L408 286" marker-end="url(#arr-cb-2)"/>
  <path class="line" d="M340 338 L408 356" marker-end="url(#arr-cb-2)"/>
  <path class="line bad dashed" d="M530 282 H598"/>
  <text x="565" y="274" text-anchor="middle" class="small">no calls</text>
  <path class="line ok" d="M530 360 H598" marker-end="url(#arr-cb-2)"/>
  <text x="20" y="410" class="small">Result: checkout says "payment pending"; every other endpoint keeps its normal latency.</text>
</svg>
<figcaption>A breaker turns a slow failure (hold a thread for 8 s) into a fast one (reject in microseconds), so a sick dependency can only hurt the features that need it.</figcaption>
</figure>

<h3>Breaker, retry, timeout: different jobs</h3>
<table>
  <tr><th>Pattern</th><th>Question it answers</th><th>Scope</th><th>Alone, it fails because…</th></tr>
  <tr><td><a href="#timeouts">Timeout</a></td><td>How long will I wait for this one call?</td><td>one call</td><td>every call still waits the full timeout during an outage</td></tr>
  <tr><td><a href="#retries">Retry</a></td><td>Is this failure a blip worth trying again?</td><td>one logical request</td><td>multiplies load on a service that is already struggling</td></tr>
  <tr><td>Circuit breaker</td><td>Has this dependency been failing enough to stop calling it?</td><td>all calls to one dependency, over time</td><td>without a timeout, a hanging call is never recorded as a failure</td></tr>
  <tr><td><a href="#backpressure">Bulkhead / concurrency limit</a></td><td>How much of my capacity may this dependency hold?</td><td>in-flight calls right now</td><td>doesn't stop calls; it only caps how many wait at once</td></tr>
</table>
<p>They stack. The usual order, from the outside in: deadline for the whole request, then retry with backoff, then the breaker, then the call with its own timeout. The retry loop must <strong>not</strong> retry an "open" rejection, and each attempt counts as a separate result in the breaker. <a href="#real-world-resilience-playbook">Real-World Resilience Playbook</a> puts them together.</p>

<h3>Libraries and built-in options</h3>
<table>
  <tr><th>Tool</th><th>Where it runs</th><th>States and defaults</th><th>Notes</th></tr>
  <tr><td>Netflix Hystrix (Java)</td><td>in process</td><td>trips at 50% errors once 20 requests are seen in a 10 s rolling window; sleeps 5 s before a probe</td><td>made the pattern popular; <strong>in maintenance mode</strong>. Its README points new projects to resilience4j.</td></tr>
  <tr><td>resilience4j (Java)</td><td>in process</td><td><code>CLOSED</code>, <code>OPEN</code>, <code>HALF_OPEN</code>, plus <code>DISABLED</code>, <code>FORCED_OPEN</code>, <code>METRICS_ONLY</code>. Defaults: 50% failure rate, window of 100 calls, minimum 100 calls, 60 s open, 10 trial calls</td><td>has a slow-call rate threshold; also offers retry, bulkhead and rate limiter modules</td></tr>
  <tr><td><code>sony/gobreaker</code> (Go)</td><td>in process</td><td><code>closed</code>, <code>open</code>, <code>half-open</code>. Defaults: trip at more than 5 consecutive failures, 60 s open, 1 trial call, counts never cleared while closed</td><td>v2 is generic: <code>CircuitBreaker[T]</code>. Custom <code>ReadyToTrip</code>, <code>IsSuccessful</code>, <code>IsExcluded</code>. No slow-call rule.</td></tr>
  <tr><td>Envoy / service mesh</td><td>sidecar or proxy</td><td><strong>Outlier detection</strong> ejects a single host from the pool: by default after 5 consecutive 5xx, checked every 10 s, ejected for 30 s, at most 10% of hosts. Envoy's separate "circuit breaking" settings are concurrency limits (max connections, pending requests, retries).</td><td>no code changes, works per host; but the app can't return a domain-specific fallback</td></tr>
</table>
<p>In-process and proxy breakers aren't rivals. A mesh is good at ejecting one bad pod; your code is the only place that knows "show popular items instead".</p>

<h2>Example</h2>
<p><strong>A breaker around an HTTP call in Go</strong>, with <code>github.com/sony/gobreaker/v2</code> (v2.4.0). The client fetches personalised recommendations and falls back to a "popular" list. It trips on a failure ratio rather than the default consecutive-failures rule, does not count <code>404</code>s against the service, and ignores calls the caller cancelled.</p>
<pre><code>package recs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/sony/gobreaker/v2"
)

var (
	errServer   = errors.New("recommendations: server error")
	errNotFound = errors.New("recommendations: unknown user")
)

// Shown when the recommendations service is unavailable.
var popular = []string{"best-sellers", "new-arrivals"}

type Client struct {
	http *http.Client
	base string
	cb   *gobreaker.CircuitBreaker[[]string]
}

func New(base string, openFor time.Duration, logf func(string, ...any)) *Client {
	st := gobreaker.Settings{
		Name:        "recommendations",
		MaxRequests: 3,                // half-open: let 3 trial calls through
		Interval:    30 * time.Second, // closed: reset the counts every 30 s
		Timeout:     openFor,          // open: fail fast for this long, then half-open
		ReadyToTrip: func(c gobreaker.Counts) bool {
			// Trip at &gt;= 50% failures, but only once we have 10 calls to judge.
			return c.Requests &gt;= 10 &amp;&amp; c.TotalFailures*2 &gt;= c.Requests
		},
		// A 404 is the caller's problem, not a sign the service is sick.
		IsSuccessful: func(err error) bool { return err == nil || errors.Is(err, errNotFound) },
		// The caller gave up: says nothing about the dependency's health.
		IsExcluded: func(err error) bool { return errors.Is(err, context.Canceled) },
		OnStateChange: func(name string, from, to gobreaker.State) {
			logf("breaker %s: %s -&gt; %s", name, from, to)
		},
	}
	return &amp;Client{
		http: &amp;http.Client{Timeout: 2 * time.Second},
		base: base,
		cb:   gobreaker.NewCircuitBreaker[[]string](st),
	}
}

// For returns recommendations, or the popular list if the breaker is open
// or the call fails. fromFallback tells the caller which one it got.
func (c *Client) For(ctx context.Context, userID string) (items []string, fromFallback bool, err error) {
	items, err = c.cb.Execute(func() ([]string, error) { return c.fetch(ctx, userID) })
	switch {
	case err == nil:
		return items, false, nil
	case errors.Is(err, errNotFound):
		return nil, false, err
	default: // gobreaker.ErrOpenState, ErrTooManyRequests, 5xx, timeouts
		return popular, true, err
	}
}

func (c *Client) fetch(ctx context.Context, userID string) ([]string, error) {
	ctx, cancel := context.WithTimeout(ctx, 300*time.Millisecond)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+"/recs?user="+userID, nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err // timeout, connection refused: counts as a failure
	}
	defer resp.Body.Close()
	switch {
	case resp.StatusCode == http.StatusNotFound:
		return nil, errNotFound
	case resp.StatusCode &gt;= 500:
		return nil, fmt.Errorf("%w: %d", errServer, resp.StatusCode)
	}
	var items []string
	return items, json.NewDecoder(resp.Body).Decode(&amp;items)
}

func (c *Client) State() gobreaker.State { return c.cb.State() }</code></pre>

<p>A test drives it through a full cycle against an <code>httptest</code> server that we switch between healthy and failing. Note the <code>server hits</code> counter: it stops moving while the breaker is open.</p>
<pre><code>func Example() {
	var healthy atomic.Bool
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		if !healthy.Load() {
			http.Error(w, "db overloaded", http.StatusServiceUnavailable)
			return
		}
		fmt.Fprint(w, &#96;["socks","boots"]&#96;)
	}))
	defer srv.Close()

	log := func(f string, a ...any) { fmt.Printf("  ** "+f+"&#92;n", a...) }
	c := New(srv.URL, 200*time.Millisecond, log)
	call := func(n int) {
		items, fb, err := c.For(context.Background(), "u42")
		why := "ok"
		switch {
		case errors.Is(err, gobreaker.ErrOpenState):
			why = "rejected, breaker open"
		case errors.Is(err, gobreaker.ErrTooManyRequests):
			why = "rejected, half-open full"
		case err != nil:
			why = "failed: 503"
		}
		served := fmt.Sprint(items)
		if fb {
			served = "fallback"
		}
		fmt.Printf("call %2d  %-9s  %-13s  %-24s  server hits: %d&#92;n", n, c.State(), served, why, hits.Load())
	}

	healthy.Store(true)
	for i := 1; i &lt;= 5; i++ {
		call(i)
	}
	healthy.Store(false) // 14:05 the dependency starts failing
	for i := 6; i &lt;= 13; i++ {
		call(i)
	}
	time.Sleep(250 * time.Millisecond) // open period over, still broken
	call(14)
	time.Sleep(250 * time.Millisecond)
	healthy.Store(true) // dependency recovered
	for i := 15; i &lt;= 18; i++ {
		call(i)
	}
}</code></pre>

<p>Real output from <code>go test</code> (the test pins it as the example's expected output, so it passes only if this is exactly what happens):</p>
<pre><code>call  1  closed     [socks boots]  ok                        server hits: 1
call  2  closed     [socks boots]  ok                        server hits: 2
call  3  closed     [socks boots]  ok                        server hits: 3
call  4  closed     [socks boots]  ok                        server hits: 4
call  5  closed     [socks boots]  ok                        server hits: 5
call  6  closed     fallback       failed: 503               server hits: 6
call  7  closed     fallback       failed: 503               server hits: 7
call  8  closed     fallback       failed: 503               server hits: 8
call  9  closed     fallback       failed: 503               server hits: 9
  ** breaker recommendations: closed -&gt; open
call 10  open       fallback       failed: 503               server hits: 10
call 11  open       fallback       rejected, breaker open    server hits: 10
call 12  open       fallback       rejected, breaker open    server hits: 10
call 13  open       fallback       rejected, breaker open    server hits: 10
  ** breaker recommendations: open -&gt; half-open
  ** breaker recommendations: half-open -&gt; open
call 14  open       fallback       failed: 503               server hits: 11
  ** breaker recommendations: open -&gt; half-open
call 15  half-open  [socks boots]  ok                        server hits: 12
call 16  half-open  [socks boots]  ok                        server hits: 13
  ** breaker recommendations: half-open -&gt; closed
call 17  closed     [socks boots]  ok                        server hits: 14
call 18  closed     [socks boots]  ok                        server hits: 15</code></pre>
<p>Reading it:</p>
<ul>
  <li><strong>Calls 6 to 10</strong>: the service returns <code>503</code>. The fallback is served, but the call still costs a round trip. At call 10 the window holds 10 calls with 5 failures (50%), so the breaker trips.</li>
  <li><strong>Calls 11 to 13</strong>: rejected instantly with <code>ErrOpenState</code>. The server hit count stays at 10: the dependency gets a break.</li>
  <li><strong>Call 14</strong>: after the 200 ms open period, the breaker goes half-open and lets one call in. It fails, so the breaker opens again straight away.</li>
  <li><strong>Calls 15 to 17</strong>: the service has recovered. With <code>MaxRequests: 3</code>, gobreaker needs 3 consecutive successful trials; the third one (call 17) closes the circuit.</li>
</ul>

<p><strong>Real-world scenario.</strong> A shop's product page calls a recommendations service, normally in 80 ms. At 14:05 that service's database is overloaded and it starts returning <code>503</code> after 2 to 3 s. Without a breaker, each product page request now waits up to the 300 ms per-call timeout, the page's latency budget is blown, and at 2,000 page views per second the recommendations service receives the full load it can't serve. With the breaker above, it trips within the first 10 calls on each API instance. From then on the page renders in its usual time with the popular-items block, the recommendations service receives only a few probes per instance per open period, and its database recovers. A dashboard panel and an alert on "breaker state changed" tell on-call what happened. Users see a slightly less personal page instead of an error.</p>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>No timeout underneath.</strong> A breaker only learns from finished calls. A call that hangs forever is never counted, so the breaker never trips. Always pair it with a per-call timeout or a <code>context</code> deadline.</li>
  <li><strong>Counting the wrong errors.</strong> Treating <code>4xx</code>, "not found" or a cancelled request as failures trips breakers on healthy services. One bad client sending invalid input can then cut everybody off.</li>
  <li><strong>No minimum volume.</strong> A ratio rule without a minimum call count opens on 1 failure out of 1 call. Low-traffic endpoints flap between open and closed.</li>
  <li><strong>Many instances, many breakers.</strong> Each of your 50 pods has its own breaker, with its own view. They trip at slightly different times and all probe in half-open. That is usually fine. Shared (distributed) breaker state adds a network dependency to protect you from a network dependency; most teams don't need it.</li>
  <li><strong>Retrying open rejections.</strong> If the retry loop treats <code>ErrOpenState</code> as retryable, it spins and burns CPU without reaching the dependency. Mark it non-retryable and fail fast.</li>
  <li><strong>A fallback that hides the outage.</strong> If "popular items" looks fine, nobody notices recommendations has been down for two days. Emit a metric for state changes and for every fallback served, and alert on it (see <a href="#alerts">Alerts</a>).</li>
  <li><strong>Untested.</strong> Breakers are only exercised during outages. Force them open in staging and check the fallback actually works (see <a href="#chaos-engineering">Chaos Engineering</a>).</li>
</ul>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>A breaker is a per-dependency state machine: closed (count), open (fail fast), half-open (probe a few calls).</li>
  <li>It protects your resources from a slow dependency, and gives that dependency room to recover.</li>
  <li>Trip on a failure or slow-call ratio with a minimum volume; count only errors that reflect the dependency's health.</li>
  <li>Always combine it with timeouts, a real fallback, and a metric or alert on state changes.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#timeouts">Timeouts</a> · <a href="#retries">Retries</a> · <a href="#backpressure">Backpressure</a> · <a href="#health-checks">Health Checks</a> · <a href="#load-balancing">Load Balancing</a> · <a href="#real-world-resilience-playbook">Real-World Resilience Playbook</a></p>
`;
CONTENT["timeouts"] = `
<p class="tldr"><strong>TL;DR</strong>: A timeout is the longest you are willing to wait for something before giving up and doing something else. Without one, a single slow dependency can hold your goroutines, connections and memory forever. It's the kitchen timer on a pot: you don't stand there all night because the stove might be broken.</p>

<h2>The problem it solves</h2>
<p>A network call can fail in two ways. A <strong>fast failure</strong> (connection refused, <code>503</code>) is easy: you get an error and move on. A <strong>slow failure</strong> is the dangerous one: the other side accepted the connection but never answers, or answers one byte per minute. Nothing returns an error. Your code just waits.</p>
<ul>
  <li><strong>Resources pile up.</strong> Every waiting request holds a goroutine, a socket, a pooled connection and its buffers. By <a href="#throughput">Little's law</a>, requests in flight = arrival rate × time each one takes. At 500 requests per second and 200 ms each, about 100 requests are in flight. If the dependency starts taking 8 s, that becomes about 4,000.</li>
  <li><strong>The slowness spreads upstream.</strong> Your callers are now waiting on you, so their goroutines and threads pile up too. One slow database turns into a slow website.</li>
  <li><strong>Users wait for nothing.</strong> A load balancer in front of you typically gives up after some fixed time and returns <code>504</code>, while your service keeps working on a request nobody is waiting for.</li>
</ul>
<p>A timeout turns a slow failure into a fast one. Then the other patterns can act on it: <a href="#retries">retry</a> it, count it in a <a href="#circuit-breakers">circuit breaker</a>, or serve a fallback.</p>

<div class="callout warn"><strong>The defaults wait forever.</strong> In Go, <code>http.DefaultClient</code> (used by <code>http.Get</code>) has <code>Timeout: 0</code>, which means no limit. <code>DefaultTransport</code> limits only the TCP connect (30 s) and the TLS handshake (10 s), not the wait for a response. A zero-value <code>http.Server</code> has no read, write or idle timeouts at all. Most database and RPC clients in other languages are similar. Never ship a network call that relies on defaults.</div>

<h2>How it works</h2>
<p>"The request timed out" can mean several different limits. An outbound HTTP call goes through phases, and each phase can hang for a different reason:</p>

<figure class="diagram">
<svg viewBox="0 0 780 196" role="img" aria-label="Phases of an HTTP call: DNS and TCP connect, TLS handshake, sending the request, waiting for response headers, reading the body. Dialer.Timeout covers the connect, TLSHandshakeTimeout the handshake, ResponseHeaderTimeout the wait for headers. http.Client.Timeout covers the whole exchange including the body, and a context deadline covers the whole call.">
  <defs><marker id="arr-to-1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <text x="390" y="18" text-anchor="middle" class="small">context deadline: the whole call, and anything else the request does after it</text>
  <path class="line accent" d="M22 28 H758" marker-start="url(#arr-to-1)" marker-end="url(#arr-to-1)"/>
  <text x="390" y="50" text-anchor="middle" class="small">http.Client.Timeout: connect + TLS + request + headers + reading the whole body</text>
  <path class="line" d="M22 60 H758" marker-start="url(#arr-to-1)" marker-end="url(#arr-to-1)"/>

  <rect class="box" x="20" y="76" width="130" height="40" rx="6"/><text x="85" y="101" text-anchor="middle">DNS + connect</text>
  <rect class="box" x="154" y="76" width="96" height="40" rx="6"/><text x="202" y="101" text-anchor="middle">TLS</text>
  <rect class="box" x="254" y="76" width="96" height="40" rx="6"/><text x="302" y="101" text-anchor="middle" class="small">send request</text>
  <rect class="box bad" x="354" y="76" width="226" height="40" rx="6"/><text x="467" y="101" text-anchor="middle">wait for response headers</text>
  <rect class="box" x="584" y="76" width="176" height="40" rx="6"/><text x="672" y="101" text-anchor="middle">read body</text>

  <path class="line ok" d="M22 130 H148"/><path class="line ok" d="M22 125 V135"/><path class="line ok" d="M148 125 V135"/>
  <text x="85" y="150" text-anchor="middle" class="small">Dialer.Timeout</text>
  <path class="line ok" d="M156 130 H248"/><path class="line ok" d="M156 125 V135"/><path class="line ok" d="M248 125 V135"/>
  <text x="202" y="168" text-anchor="middle" class="small">TLSHandshakeTimeout</text>
  <path class="line ok" d="M356 130 H578"/><path class="line ok" d="M356 125 V135"/><path class="line ok" d="M578 125 V135"/>
  <text x="467" y="150" text-anchor="middle" class="small">ResponseHeaderTimeout</text>
  <text x="672" y="150" text-anchor="middle" class="small">no per-phase field:</text>
  <text x="672" y="166" text-anchor="middle" class="small">Client.Timeout or ctx</text>
  <text x="467" y="186" text-anchor="middle" class="small">a slow or overloaded server usually hangs here</text>
</svg>
<figcaption>Per-phase limits (green) catch a specific hang early. <code>Client.Timeout</code> and the context deadline (top) cap the total, whatever phase is stuck.</figcaption>
</figure>

<h3>The four kinds of timeout</h3>
<ul>
  <li><strong>Connect timeout</strong>: how long to wait for the TCP (and TLS) handshake. It should be short, often well under a second inside a data centre, because a healthy host answers a SYN almost immediately. A long connect usually means the host is gone.</li>
  <li><strong>Read timeout</strong>: how long to wait for data once connected, either the first byte of the response (<code>ResponseHeaderTimeout</code>) or the gap between reads. It catches a server that accepted the request and then went quiet.</li>
  <li><strong>Write timeout</strong>: how long sending the request (or, on a server, the response) may take. It catches a peer that stopped reading.</li>
  <li><strong>Total timeout / deadline</strong>: one budget for the whole operation, including retries. This is the one the user actually feels, and the one that should be <em>propagated</em> to downstream calls.</li>
</ul>
<p>In Go the total is usually a <code>context</code>: <code>context.WithTimeout(ctx, 2*time.Second)</code> returns a context whose <code>Done()</code> channel closes after 2 s. Everything that accepts a <code>ctx</code> (<code>http.NewRequestWithContext</code>, <code>db.QueryContext</code>, gRPC calls, <code>errgroup</code>) stops and returns <code>context.DeadlineExceeded</code>. A context deadline can only get <em>earlier</em> as you derive children: <code>WithTimeout</code> on a parent with a sooner deadline keeps the parent's deadline.</p>

<h3>Deadline propagation: inner budgets are smaller</h3>
<p>A request crosses several services. Each hop should know how much time the original caller has left, and spend less than that. Otherwise the outer layer gives up first, returns <code>504</code>, and the inner layers keep working (and retrying) on a request nobody is waiting for. The rule:</p>
<ul>
  <li>Each downstream call gets <code>min(its own limit, remaining budget − a small reserve)</code>. The reserve leaves time to log, fall back and write the error response.</li>
  <li>If the remaining budget is already zero or negative, <strong>don't make the call</strong>. Fail fast.</li>
  <li>gRPC does this for you: the client sends the remaining time in the <code>grpc-timeout</code> header, converted to a relative timeout so clock differences between machines don't matter, and Go and Java servers turn it into the server-side context deadline by default. Plain HTTP has no standard header, so you send one yourself (the example below uses <code>X-Request-Budget-Ms</code>).</li>
</ul>

<figure class="diagram">
<svg viewBox="0 0 780 320" role="img" aria-label="Timeline of the Go example. The edge sends checkout a 1000 millisecond budget. Checkout keeps 100 milliseconds in reserve and sends payment an 899 millisecond budget. Payment needs 3 seconds, so at 900 milliseconds its context ends and it stops working. Checkout's call fails with context deadline exceeded and it returns 504 to the edge at 900 milliseconds, before the edge's own 1000 millisecond deadline.">
  <defs><marker id="arr-to-2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <rect class="box" x="50" y="14" width="120" height="36" rx="8"/><text x="110" y="37" text-anchor="middle" class="title">edge</text>
  <rect class="box accent" x="330" y="14" width="120" height="36" rx="8"/><text x="390" y="37" text-anchor="middle" class="title">checkout</text>
  <rect class="box" x="610" y="14" width="120" height="36" rx="8"/><text x="670" y="37" text-anchor="middle" class="title">payment</text>
  <path d="M110 50 V306" style="stroke: var(--line)"/>
  <path d="M390 50 V306" style="stroke: var(--line)"/>
  <path d="M670 50 V306" style="stroke: var(--line)"/>
  <text x="22" y="84" class="small">0 ms</text>
  <text x="22" y="264" class="small">900 ms</text>
  <text x="22" y="284" class="small">1000 ms</text>

  <path class="line" d="M110 80 H386" marker-end="url(#arr-to-2)"/>
  <text x="250" y="72" text-anchor="middle" class="small">budget 1000 ms</text>
  <path class="line" d="M390 96 H662" marker-end="url(#arr-to-2)"/>
  <text x="530" y="88" text-anchor="middle" class="small">budget 899 ms (100 ms kept in reserve)</text>
  <rect class="box accent" x="662" y="100" width="16" height="156" rx="3"/>
  <text x="648" y="170" text-anchor="end" class="small">working; needs 3 s today</text>
  <text x="648" y="186" text-anchor="end" class="small">select on r.Context().Done()</text>

  <path class="line bad dashed" d="M662 260 H394" marker-end="url(#arr-to-2)"/>
  <text x="530" y="252" text-anchor="middle" class="small">context deadline exceeded</text>
  <path class="line bad" d="M390 262 H114" marker-end="url(#arr-to-2)"/>
  <text x="250" y="254" text-anchor="middle" class="small">504 at 900 ms</text>
  <text x="670" y="276" text-anchor="middle" class="small">work stopped</text>
  <path class="line dashed" d="M84 280 H136"/>
  <text x="110" y="298" text-anchor="middle" class="small">edge deadline, never reached</text>
</svg>
<figcaption>The real run of the Go example below. Every layer's deadline sits inside its caller's, so the innermost layer gives up first and everyone gets a clear answer before the edge's own limit.</figcaption>
</figure>

<h3>Choosing a value</h3>
<p>Don't guess "30 seconds". Base timeouts on the dependency's measured latency (see <a href="#p99-latency">p99 Latency</a>):</p>
<ul>
  <li><strong>Pick an acceptable false-timeout rate</strong>, then use that percentile. AWS's Builders' Library describes exactly this: if timing out 0.1% of healthy requests is acceptable, set the timeout near the downstream's <strong>p99.9</strong> latency, plus some padding. A p50-based timeout fails a large share of perfectly healthy requests.</li>
  <li><strong>Measure from the client side</strong>. The server's own latency metric doesn't include the network, TLS or queueing in your connection pool.</li>
  <li><strong>Fit it in the caller's budget</strong>. If you will retry once, each attempt needs to fit in roughly half of what remains.</li>
  <li><strong>Revisit it.</strong> A timeout chosen two years ago is either too tight (latency grew) or so loose that it no longer protects anything.</li>
</ul>

<h3>What happens on the other side</h3>
<p>A timeout only stops <em>your</em> waiting. The server may still be working, and it may finish the job:</p>
<ul>
  <li>A Go server cancels <code>r.Context()</code> when the client's connection closes, when an HTTP/2 stream is reset, or when the handler returns. Work stops only if your handler and the code it calls <strong>check the context</strong>: <code>db.QueryContext</code>, outgoing requests built with the same <code>ctx</code>, <code>select</code> on <code>ctx.Done()</code> in long loops.</li>
  <li>Work that ignores the context runs to completion, uses capacity, and its result is thrown away.</li>
  <li>For writes, a timeout means <strong>"unknown outcome"</strong>, not "failed". The payment may have gone through. The safe follow-up is to retry with the same <a href="#idempotency">idempotency key</a> or look the result up, never to blindly try again.</li>
</ul>

<h2>Every timeout in Go's net/http</h2>
<table>
  <tr><th>Field</th><th>Side</th><th>What it limits</th><th>Default</th><th>Starting point</th></tr>
  <tr><td><code>net.Dialer.Timeout</code></td><td>client</td><td>TCP connect (incl. DNS)</td><td>30 s in <code>DefaultTransport</code></td><td>0.5–2 s</td></tr>
  <tr><td><code>Transport.TLSHandshakeTimeout</code></td><td>client</td><td>TLS handshake</td><td>10 s in <code>DefaultTransport</code></td><td>1–2 s</td></tr>
  <tr><td><code>Transport.ResponseHeaderTimeout</code></td><td>client</td><td>request fully sent → response headers received</td><td>none</td><td>near the dependency's p99.9</td></tr>
  <tr><td><code>Transport.IdleConnTimeout</code></td><td>client</td><td>how long an unused pooled connection is kept</td><td>90 s in <code>DefaultTransport</code></td><td>below the server's idle timeout</td></tr>
  <tr><td><code>Client.Timeout</code></td><td>client</td><td>whole exchange, including reading the body</td><td>none</td><td>hard cap; not for streaming downloads</td></tr>
  <tr><td><code>context.WithTimeout</code></td><td>both</td><td>everything that takes the <code>ctx</code>, across calls</td><td>none</td><td>per request, from the caller's budget</td></tr>
  <tr><td><code>Server.ReadHeaderTimeout</code></td><td>server</td><td>reading request headers</td><td>none (falls back to <code>ReadTimeout</code>)</td><td>a few seconds; blocks slowloris</td></tr>
  <tr><td><code>Server.ReadTimeout</code></td><td>server</td><td>reading headers + body</td><td>none</td><td>depends on upload sizes</td></tr>
  <tr><td><code>Server.WriteTimeout</code></td><td>server</td><td>end of request headers → response written</td><td>none</td><td>longer than your slowest handler</td></tr>
  <tr><td><code>Server.IdleTimeout</code></td><td>server</td><td>keep-alive connection waiting for its next request</td><td>none (falls back to <code>ReadTimeout</code>)</td><td>30–120 s</td></tr>
  <tr><td><code>http.TimeoutHandler</code></td><td>server</td><td>one handler; replies <code>503</code> and cancels its context</td><td>not used</td><td>per route, below the edge's timeout</td></tr>
</table>
<p>The "starting points" are reasonable first values, not standards. Replace them with numbers from your own latency data.</p>

<h2>Example</h2>
<p><strong>A client and server with explicit timeouts, plus deadline propagation over HTTP.</strong> <code>ChildContext</code> applies the "inner budget is smaller" rule, and <code>Call</code> sends the remaining budget downstream so the next service can set the same deadline:</p>
<pre><code>package timeouts

import (
	"context"
	"errors"
	"net"
	"net/http"
	"strconv"
	"time"
)

// NewClient gives every phase of an outbound call its own limit,
// plus Client.Timeout as a hard cap on the whole exchange.
func NewClient() *http.Client {
	tr := &amp;http.Transport{
		DialContext: (&amp;net.Dialer{
			Timeout:   1 * time.Second, // TCP connect
			KeepAlive: 30 * time.Second,
		}).DialContext,
		TLSHandshakeTimeout:   1 * time.Second,
		ResponseHeaderTimeout: 2 * time.Second, // request sent -&gt; response headers
		IdleConnTimeout:       90 * time.Second,
		MaxIdleConnsPerHost:   100,
	}
	return &amp;http.Client{
		Transport: tr,
		Timeout:   3 * time.Second, // dial + TLS + headers + reading the body
	}
}

// NewServer protects the server from slow or idle clients.
func NewServer(addr string, h http.Handler) *http.Server {
	return &amp;http.Server{
		Addr:              addr,
		Handler:           h,
		ReadHeaderTimeout: 2 * time.Second,  // slowloris: headers must arrive quickly
		ReadTimeout:       10 * time.Second, // headers + body
		WriteTimeout:      15 * time.Second, // from end of headers until the response is written
		IdleTimeout:       60 * time.Second, // keep-alive connection waiting for the next request
	}
}

// HTTP has no standard deadline header (gRPC sends grpc-timeout for you),
// so we propagate the remaining budget in our own header.
const budgetHeader = "X-Request-Budget-Ms"

// WithBudget turns an incoming budget header into a context deadline.
func WithBudget(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if ms, err := strconv.Atoi(r.Header.Get(budgetHeader)); err == nil &amp;&amp; ms &gt; 0 {
			ctx, cancel := context.WithTimeout(r.Context(), time.Duration(ms)*time.Millisecond)
			defer cancel()
			r = r.WithContext(ctx)
		}
		next.ServeHTTP(w, r)
	})
}

// ChildContext picks the deadline for one downstream call: our own limit,
// or the caller's deadline minus a reserve kept for answering, whichever is earlier.
func ChildContext(parent context.Context, own, reserve time.Duration) (context.Context, context.CancelFunc) {
	deadline := time.Now().Add(own)
	if d, ok := parent.Deadline(); ok &amp;&amp; d.Add(-reserve).Before(deadline) {
		deadline = d.Add(-reserve)
	}
	return context.WithDeadline(parent, deadline)
}

var ErrNoBudget = errors.New("no time budget left")

// Call sends a request that carries its own remaining budget downstream.
func Call(ctx context.Context, c *http.Client, url string) (*http.Response, error) {
	d, ok := ctx.Deadline()
	if ok &amp;&amp; time.Until(d) &lt;= 0 {
		return nil, ErrNoBudget // fail fast: the caller has already given up
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	if ok {
		req.Header.Set(budgetHeader, strconv.FormatInt(time.Until(d).Milliseconds(), 10))
	}
	return c.Do(req)
}</code></pre>

<p>A test wires three layers together: the edge gives checkout 1 s, checkout calls payment, and payment needs 3 s today. Payment's handler watches its context, so it stops as soon as the budget runs out:</p>
<pre><code>// payment: needs 3 s today, but stops as soon as its context ends.
payment := httptest.NewServer(WithBudget(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
	logf("payment:  got request, budget header %sms", r.Header.Get(budgetHeader))
	select {
	case &lt;-time.After(3 * time.Second):
		fmt.Fprint(w, "charged")
	case &lt;-r.Context().Done():
		logf("payment:  stopping work: %v", r.Context().Err())
	}
})))
defer payment.Close()

client := NewClient()
// checkout: calls payment with its budget minus a 100 ms reserve.
checkout := httptest.NewServer(WithBudget(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := ChildContext(r.Context(), 2*time.Second, 100*time.Millisecond)
	defer cancel()
	resp, err := Call(ctx, client, payment.URL)
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, ErrNoBudget) {
		logf("checkout: payment call failed: %v", err)
		http.Error(w, "payment timed out, try again", http.StatusGatewayTimeout)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	io.Copy(w, resp.Body)
})))</code></pre>
<p>Real output (port replaced; the budget header is 898–899 ms depending on scheduling):</p>
<pre><code>$ go test -v -run TestDeadlinePropagation
=== RUN   TestDeadlinePropagation
t=   0ms  payment:  got request, budget header 899ms
t= 900ms  payment:  stopping work: context deadline exceeded
t= 900ms  checkout: payment call failed: Get "http://127.0.0.1:PORT": context deadline exceeded
t= 900ms  edge:     504 payment timed out, try again
--- PASS: TestDeadlinePropagation (1.11s)</code></pre>
<p>The edge got a clear <code>504</code> at 900 ms, inside its own 1 s limit, and payment stopped working at the same moment instead of burning 3 s on an abandoned request. A second test shows the two client-side limits. Without a context, <code>ResponseHeaderTimeout</code> (2 s) fires before <code>Client.Timeout</code> (3 s) because the server never sends headers. With a 500 ms context, the context wins:</p>
<pre><code>=== RUN   TestClientTimeout
t=2000ms  no context, client caps it: Get "http://127.0.0.1:PORT": net/http: timeout awaiting response headers
t= 500ms  ctx 500ms: Get "http://127.0.0.1:PORT": context deadline exceeded (DeadlineExceeded=true)
--- PASS: TestClientTimeout (2.51s)</code></pre>
<p>Note the error types: a context deadline gives <code>errors.Is(err, context.DeadlineExceeded) == true</code>, which is what your code should branch on. Transport timeouts produce a <code>net.Error</code> whose <code>Timeout()</code> method returns true.</p>

<p><strong>Real-world scenario.</strong> A shop's checkout API serves 500 requests per second and calls a payment provider whose p99 is normally 200 ms. Its HTTP client was <code>http.DefaultClient</code>. At 14:05 the provider has a partial outage and its p99 jumps to 8 s, with some requests never answering. In-flight calls climb from about 100 to several thousand. Goroutines, connections and memory grow until the pods are killed for using too much memory, and even the product pages (which never touch payments) start failing because they share the same pods. With a 1.5 s deadline on the payment call (above the provider's healthy p99.9), in-flight payment calls are capped at about 500 × 1.5 = 750. Checkout fails fast with "payment is slow, try again", and a <a href="#circuit-breakers">circuit breaker</a> can then stop calling the provider altogether until it recovers.</p>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>No timeout at all.</strong> The most common bug. <code>http.Get</code>, a zero-value <code>http.Server</code>, a database driver without a <code>ctx</code>. Search your code base for them.</li>
  <li><strong>Inner timeouts longer than outer ones.</strong> If the gateway gives up at 10 s but your service waits 30 s for the database, users get <code>504</code>s while your service keeps working. Every layer's limit must sit inside its caller's (see <a href="#real-world-traffic-stack">Real-World Traffic Stack</a>).</li>
  <li><strong>Timeouts that are too tight.</strong> A timeout at p50 or p90 fails healthy requests all day, and if those are retried you have doubled your load for nothing. Base it on p99.9 and watch the timeout rate as a <a href="#metrics">metric</a>.</li>
  <li><strong>Forgetting the body.</strong> <code>ResponseHeaderTimeout</code> stops at the headers; a server that sends headers and then trickles the body is caught only by <code>Client.Timeout</code> or the context. Conversely, <code>Client.Timeout</code> will kill a legitimately long download or stream.</li>
  <li><strong><code>WriteTimeout</code> doesn't stop your handler.</strong> It sets a deadline on the connection, so writes fail afterwards, but the handler keeps running. To stop the work, use a context (<code>http.TimeoutHandler</code> or your own <code>WithTimeout</code>). For long-lived responses such as <a href="#server-sent-events">server-sent events</a>, a server-wide <code>WriteTimeout</code> will cut the stream; extend it per request with <code>http.NewResponseController(w).SetWriteDeadline</code>.</li>
  <li><strong>Treating a timeout as "it failed".</strong> For writes the outcome is unknown. Retrying a charge after a timeout without an <a href="#idempotency">idempotency key</a> is how customers get billed twice.</li>
  <li><strong>Retries that ignore the deadline.</strong> Three attempts of 2 s each don't fit in a 3 s budget. A retry loop must check the time left before sleeping and before each attempt (see <a href="#retries">Retries</a>).</li>
</ul>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>Every network call needs a timeout. Defaults in Go's <code>net/http</code> wait forever for a response.</li>
  <li>Use per-phase limits (connect, headers) to catch specific hangs, and a context deadline as the overall budget.</li>
  <li>Propagate the deadline: each hop gets less time than its caller, and no time left means don't call.</li>
  <li>Pick values from client-side p99.9 latency. A timeout on a write means "unknown outcome", so pair it with idempotency.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#retries">Retries</a> · <a href="#circuit-breakers">Circuit Breakers</a> · <a href="#idempotency">Idempotency</a> · <a href="#p99-latency">p99 Latency</a> · <a href="#real-world-traffic-stack">Real-World Traffic Stack</a> · <a href="#real-world-resilience-playbook">Real-World Resilience Playbook</a></p>
`;

CONTENT["retries"] = `
<p class="tldr"><strong>TL;DR</strong>: A retry sends a failed request again, betting that the failure was a blip: a dropped connection, a restarting pod, a moment of overload. Done right, retries hide most transient errors from users. Done wrong, they double-charge customers and multiply load on a system that is already struggling. Like redialling a call that dropped: fine once or twice, harmful if a thousand people all redial at once, forever.</p>

<h2>The problem it solves</h2>
<p>In a distributed system, some requests fail for reasons that have nothing to do with the request itself:</p>
<ul>
  <li>a pod is being replaced during a <a href="#rolling-deployments">rolling deployment</a> and resets its connections;</li>
  <li>a <a href="#load-balancing">load balancer</a> sent the request to an instance that just died;</li>
  <li>a pooled keep-alive connection was closed by the server a moment before you reused it;</li>
  <li>a dependency is briefly overloaded and answers <code>503</code> or <code>429</code>.</li>
</ul>
<p>Each of these is likely to succeed if you simply try again a moment later, often on a different instance. Without retries, every one of them becomes an error page. With retries, a dependency that fails 1% of requests independently looks, to your users, like one that fails 0.01% (two attempts) or 0.0001% (three).</p>
<p>That multiplication only works when failures are <strong>independent and short</strong>. When the dependency is down or overloaded, failures are correlated, and every retry is extra load on the thing that is already failing. Most of this page is about telling those two cases apart.</p>

<h2>How it works</h2>
<p>A good retry loop asks four questions before every new attempt:</p>

<figure class="diagram">
<svg viewBox="0 0 780 290" role="img" aria-label="Retry decision flow. After an attempt: if the failure is not transient, return the result. If the request is not safe to repeat, return without retrying. If attempts or the retry budget are used up, return the last error. Otherwise wait using Retry-After or backoff with jitter; if the wait still fits the deadline, make the next attempt, otherwise fail fast.">
  <defs><marker id="arr-re-1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <rect class="box ok" x="165" y="10" width="160" height="50" rx="8"/><text x="245" y="31" text-anchor="middle" class="title">return it</text><text x="245" y="49" text-anchor="middle" class="small">2xx, 400, 404, most 500s</text>
  <rect class="box bad" x="350" y="10" width="150" height="50" rx="8"/><text x="425" y="31" text-anchor="middle" class="title">return, no retry</text><text x="425" y="49" text-anchor="middle" class="small">POST without a key</text>
  <rect class="box bad" x="530" y="10" width="230" height="50" rx="8"/><text x="645" y="31" text-anchor="middle" class="title">return last error</text><text x="645" y="49" text-anchor="middle" class="small">out of attempts or budget</text>

  <rect class="box accent" x="20" y="110" width="120" height="44" rx="8"/><text x="80" y="137" text-anchor="middle" class="title">attempt n</text>
  <rect class="box" x="170" y="110" width="150" height="44" rx="8"/><text x="245" y="137" text-anchor="middle">transient failure?</text>
  <rect class="box" x="350" y="110" width="150" height="44" rx="8"/><text x="425" y="137" text-anchor="middle">safe to repeat?</text>
  <rect class="box" x="530" y="110" width="230" height="44" rx="8"/><text x="645" y="137" text-anchor="middle">attempts and budget left?</text>
  <path class="line" d="M140 132 H168" marker-end="url(#arr-re-1)"/>
  <path class="line" d="M320 132 H348" marker-end="url(#arr-re-1)"/><text x="334" y="124" text-anchor="middle" class="small">yes</text>
  <path class="line" d="M500 132 H528" marker-end="url(#arr-re-1)"/><text x="514" y="124" text-anchor="middle" class="small">yes</text>
  <path class="line ok" d="M245 110 V62" marker-end="url(#arr-re-1)"/><text x="253" y="90" class="small">no</text>
  <path class="line bad" d="M425 110 V62" marker-end="url(#arr-re-1)"/><text x="433" y="90" class="small">no</text>
  <path class="line bad" d="M645 110 V62" marker-end="url(#arr-re-1)"/><text x="653" y="90" class="small">no</text>

  <rect class="box bad" x="170" y="210" width="150" height="44" rx="8"/><text x="245" y="229" text-anchor="middle" class="title">fail fast</text><text x="245" y="246" text-anchor="middle" class="small">would miss deadline</text>
  <rect class="box" x="350" y="210" width="150" height="44" rx="8"/><text x="425" y="237" text-anchor="middle">fits the deadline?</text>
  <rect class="box accent" x="530" y="210" width="230" height="44" rx="8"/><text x="645" y="229" text-anchor="middle" class="title">wait</text><text x="645" y="246" text-anchor="middle" class="small">Retry-After, else backoff + jitter</text>
  <path class="line" d="M645 154 V208" marker-end="url(#arr-re-1)"/><text x="653" y="186" class="small">yes</text>
  <path class="line" d="M530 232 H502" marker-end="url(#arr-re-1)"/>
  <path class="line bad" d="M350 232 H322" marker-end="url(#arr-re-1)"/><text x="336" y="224" text-anchor="middle" class="small">no</text>
  <path class="line accent" d="M425 254 V276 H80 V156" marker-end="url(#arr-re-1)"/><text x="300" y="270" text-anchor="middle" class="small">yes: attempt n + 1</text>
</svg>
<figcaption>Retry only what is transient, safe to repeat, within limits and within the deadline. Every other path returns.</figcaption>
</figure>

<h3>1. Is the failure transient?</h3>
<p>Retry errors that say "not right now", never errors that say "this request is wrong". A <code>400</code> or <code>404</code> will fail the same way every time; retrying it only adds load and delay.</p>
<table>
  <tr><th>Result</th><th>Retry?</th><th>Why</th></tr>
  <tr><td>connection refused / reset, DNS failure</td><td>yes</td><td>instance gone or restarting; another may answer</td></tr>
  <tr><td><code>503 Service Unavailable</code></td><td>yes, honour <code>Retry-After</code></td><td>the server says it is temporarily unable to handle the request</td></tr>
  <tr><td><code>429 Too Many Requests</code></td><td>yes, honour <code>Retry-After</code></td><td>you hit a <a href="#rate-limiting">rate limit</a>; retrying sooner just gets another 429</td></tr>
  <tr><td><code>502</code>, <code>504</code></td><td>yes, if idempotent</td><td>a proxy couldn't reach or wait for the backend; the backend may have done the work</td></tr>
  <tr><td>your own timeout</td><td>maybe, if idempotent and time is left</td><td>the outcome is unknown, see <a href="#timeouts">Timeouts</a></td></tr>
  <tr><td>context cancelled / deadline exceeded</td><td>no</td><td>the caller has given up; nobody is waiting for the answer</td></tr>
  <tr><td><code>500 Internal Server Error</code></td><td>usually no</td><td>often a bug that fails deterministically; retry only if you know that service's 500s are transient</td></tr>
  <tr><td><code>400</code>, <code>401</code>, <code>403</code>, <code>404</code>, <code>409</code>, <code>422</code></td><td>no</td><td>the request itself is wrong; it will fail the same way</td></tr>
  <tr><td>gRPC <code>UNAVAILABLE</code></td><td>yes</td><td>the gRPC equivalent of "try again"; most other codes are not retryable by default</td></tr>
</table>
<p><code>Retry-After</code> (RFC 9110) is either a number of seconds or an HTTP date. When the server sends it, it knows more about its own recovery than your formula does, so use it.</p>

<h3>2. Is it safe to repeat?</h3>
<p>A retry after a timeout or a <code>502</code> may run the operation <strong>twice</strong>: the first attempt might have succeeded and only the response was lost. That is harmless for reads and for <strong>idempotent</strong> operations, where doing it twice has the same effect as once. HTTP defines <code>GET</code>, <code>HEAD</code>, <code>OPTIONS</code>, <code>TRACE</code>, <code>PUT</code> and <code>DELETE</code> as idempotent. <code>POST</code> and <code>PATCH</code> are not, unless the server deduplicates them with an <a href="#idempotency">idempotency key</a>. "Charge the card" without a key is the classic double-billing bug.</p>

<h3>3. Are there attempts and budget left?</h3>
<ul>
  <li><strong>Max attempts</strong>: 2 or 3 total attempts is typical. Beyond that you rarely recover anything, and you hold the caller longer.</li>
  <li><strong>A retry budget</strong> limits retries across <em>all</em> calls to a dependency, not per call. When a dependency is healthy, failures are rare and retries are cheap. When it is down, nearly every call fails, and per-call limits still triple the traffic. A budget notices that "most calls are failing" and stops retrying. gRPC's <em>retry throttling</em> is a token bucket: each failure costs 1 token, each success earns back <code>tokenRatio</code>, and retries stop while the bucket is at or below half full. The AWS SDKs have used a similar local token bucket since 2016, according to the AWS Builders' Library.</li>
</ul>

<h3>4. Does the wait fit the deadline?</h3>
<p>Wait between attempts, using <code>Retry-After</code> or an exponentially growing, randomised delay (see <a href="#exponential-backoff">Exponential Backoff</a> for the formula and why jitter matters). Before sleeping, check the remaining <a href="#timeouts">deadline</a>: if the next attempt can't finish in time, return the error now instead of sleeping just to fail later.</p>

<h3>Retry amplification: retry at one layer</h3>
<p>Retries multiply across layers. If every layer in a call chain retries 3 times, the bottom of the chain sees 3<sup>depth</sup> attempts for one user request, exactly when it is weakest:</p>

<figure class="diagram">
<svg viewBox="0 0 780 250" role="img" aria-label="Retry amplification. Top row: retrying at every layer, one client request becomes 3 calls to orders, 9 calls to inventory and 27 queries on the database. Bottom row: retrying only at the gateway, the database sees at most 3 queries.">
  <defs><marker id="arr-re-2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <text x="20" y="22" class="title">Every layer retries, 3 attempts each</text>
  <rect class="box" x="20" y="36" width="120" height="50" rx="8"/><text x="80" y="57" text-anchor="middle" class="title">client</text><text x="80" y="75" text-anchor="middle" class="small">1 request</text>
  <rect class="box accent" x="180" y="36" width="120" height="50" rx="8"/><text x="240" y="57" text-anchor="middle" class="title">gateway</text><text x="240" y="75" text-anchor="middle" class="small">retries ×3</text>
  <rect class="box accent" x="340" y="36" width="120" height="50" rx="8"/><text x="400" y="57" text-anchor="middle" class="title">orders</text><text x="400" y="75" text-anchor="middle" class="small">3 calls, retries ×3</text>
  <rect class="box accent" x="500" y="36" width="120" height="50" rx="8"/><text x="560" y="57" text-anchor="middle" class="title">inventory</text><text x="560" y="75" text-anchor="middle" class="small">9 calls, retries ×3</text>
  <rect class="box bad" x="660" y="36" width="100" height="50" rx="8"/><text x="710" y="57" text-anchor="middle" class="title">database</text><text x="710" y="75" text-anchor="middle" class="small">27 queries</text>
  <path class="line" d="M140 61 H178" marker-end="url(#arr-re-2)"/>
  <path class="line bad" d="M300 61 H338" marker-end="url(#arr-re-2)"/>
  <path class="line bad" d="M460 61 H498" marker-end="url(#arr-re-2)"/>
  <path class="line bad" d="M620 61 H658" marker-end="url(#arr-re-2)"/>

  <text x="20" y="140" class="title">Only the gateway retries</text>
  <rect class="box" x="20" y="154" width="120" height="50" rx="8"/><text x="80" y="175" text-anchor="middle" class="title">client</text><text x="80" y="193" text-anchor="middle" class="small">1 request</text>
  <rect class="box accent" x="180" y="154" width="120" height="50" rx="8"/><text x="240" y="175" text-anchor="middle" class="title">gateway</text><text x="240" y="193" text-anchor="middle" class="small">retries ×3</text>
  <rect class="box" x="340" y="154" width="120" height="50" rx="8"/><text x="400" y="175" text-anchor="middle" class="title">orders</text><text x="400" y="193" text-anchor="middle" class="small">3 calls, no retry</text>
  <rect class="box" x="500" y="154" width="120" height="50" rx="8"/><text x="560" y="175" text-anchor="middle" class="title">inventory</text><text x="560" y="193" text-anchor="middle" class="small">3 calls, no retry</text>
  <rect class="box ok" x="660" y="154" width="100" height="50" rx="8"/><text x="710" y="175" text-anchor="middle" class="title">database</text><text x="710" y="193" text-anchor="middle" class="small">3 queries</text>
  <path class="line" d="M140 179 H178" marker-end="url(#arr-re-2)"/>
  <path class="line ok" d="M300 179 H338" marker-end="url(#arr-re-2)"/>
  <path class="line ok" d="M460 179 H498" marker-end="url(#arr-re-2)"/>
  <path class="line ok" d="M620 179 H658" marker-end="url(#arr-re-2)"/>
  <text x="390" y="236" text-anchor="middle" class="small">the inner layers fail fast and report; one layer decides whether to try again</text>
</svg>
<figcaption>Three layers of 3 attempts turn one request into 27 database queries. The AWS Builders' Library gives a five-layer example: 3<sup>5</sup> = 243× the load on the database.</figcaption>
</figure>
<p>Pick <strong>one</strong> layer to retry, usually the one closest to the failure that still knows whether the call is safe to repeat (often the immediate caller, or the service mesh), and make the others fail fast. Watch for retries you didn't write: client libraries, SDKs, service meshes and load balancers often retry by default. Even Go's <code>http.Transport</code> silently retries a request once when a <em>reused</em> keep-alive connection fails before any response arrives, if the request is replayable (<code>GET</code>, <code>HEAD</code>, <code>OPTIONS</code>, <code>TRACE</code>, or one carrying an <code>Idempotency-Key</code> header).</p>

<h3>Hedged requests</h3>
<p>A different use of "send it again": instead of waiting for a failure, send a <strong>second copy</strong> of a slow request to another replica and use whichever answers first. In <em>The Tail at Scale</em> (2013), Dean and Barroso describe waiting until the first request has been outstanding longer than the 95th-percentile latency before hedging. Only about 5% of requests ever wait that long, so the extra load stays small while the <a href="#tail-latency">latency tail</a> shrinks. Hedge only reads or idempotent calls, and cancel the loser. gRPC supports it with a <code>hedgingPolicy</code> (<code>maxAttempts</code>, <code>hedgingDelay</code>, <code>nonFatalStatusCodes</code>) as an alternative to <code>retryPolicy</code>.</p>

<h3>Retries in gRPC</h3>
<p>gRPC clients can retry transparently from a <strong>service config</strong>. The retry design (gRFC A6) caps <code>maxAttempts</code> at 5, waits <code>min(initialBackoff × backoffMultiplier<sup>n−1</sup>, maxBackoff)</code> multiplied by a random factor between 0.8 and 1.2, retries only the listed status codes, and honours server pushback sent as <code>grpc-retry-pushback-ms</code> response metadata. <code>retryThrottling</code> is the token-bucket budget described above:</p>
<pre><code>{
  "methodConfig": [{
    "name": [{"service": "inventory.Inventory", "method": "GetStock"}],
    "retryPolicy": {
      "maxAttempts": 3,
      "initialBackoff": "0.1s",
      "maxBackoff": "1s",
      "backoffMultiplier": 2,
      "retryableStatusCodes": ["UNAVAILABLE"]
    }
  }],
  "retryThrottling": {"maxTokens": 10, "tokenRatio": 0.1}
}</code></pre>
<pre><code>conn, err := grpc.NewClient("dns:///inventory:50051",
	grpc.WithTransportCredentials(creds),
	grpc.WithDefaultServiceConfig(serviceConfigJSON),
)</code></pre>
<p>gRPC only retries a call if no response headers have arrived yet, and calls that keep failing still count against the overall <a href="#timeouts">deadline</a>.</p>

<h2>Example</h2>
<p><strong>A retry loop for <code>net/http</code></strong> that classifies errors, refuses to repeat non-idempotent calls, honours <code>Retry-After</code>, respects the context deadline, and shares a retry budget per dependency. Backoff uses full jitter (explained in <a href="#exponential-backoff">Exponential Backoff</a>):</p>
<pre><code>package retries

import (
	"context"
	"errors"
	"fmt"
	"io"
	"math/rand/v2"
	"net/http"
	"strconv"
	"sync"
	"time"
)

type Policy struct {
	MaxAttempts int           // including the first try
	Base, Cap   time.Duration // backoff range, see Exponential Backoff
	Budget      *Budget       // shared by every call to this dependency
}

// Do sends the request built by newReq, retrying transient failures.
// newReq must build a fresh request each time: a body can only be read once.
func Do(
	ctx context.Context, c *http.Client, p Policy,
	newReq func(context.Context) (*http.Request, error),
) (*http.Response, error) {
	for attempt := 1; ; attempt++ {
		req, err := newReq(ctx)
		if err != nil {
			return nil, err
		}
		if !idempotent(req) {
			return c.Do(req) // never retry what might charge a card twice
		}
		resp, err := c.Do(req)
		if !retryable(resp, err) {
			p.Budget.Success()
			return resp, err
		}
		if !p.Budget.Failure() || attempt == p.MaxAttempts {
			return resp, err // out of attempts or budget: return the last result as is
		}
		wait := backoff(p.Base, p.Cap, attempt)
		if resp != nil {
			if ra, ok := retryAfter(resp); ok {
				wait = ra // the server knows better than our formula
			}
			io.Copy(io.Discard, resp.Body) // drain so the connection can be reused
			resp.Body.Close()
		}
		if d, ok := ctx.Deadline(); ok &amp;&amp; time.Until(d) &lt; wait {
			return nil, fmt.Errorf("attempt %d: %w (no time left to retry)",
				attempt, errOrStatus(resp, err))
		}
		select {
		case &lt;-time.After(wait):
		case &lt;-ctx.Done():
			return nil, ctx.Err()
		}
	}
}

func idempotent(r *http.Request) bool {
	switch r.Method {
	case http.MethodGet, http.MethodHead, http.MethodOptions, http.MethodPut, http.MethodDelete:
		return true
	}
	return r.Header.Get("Idempotency-Key") != "" // the server deduplicates for us
}

func retryable(resp *http.Response, err error) bool {
	if err != nil {
		// Our own deadline or cancellation: the caller gave up, so stop.
		return !errors.Is(err, context.Canceled) &amp;&amp; !errors.Is(err, context.DeadlineExceeded)
	}
	switch resp.StatusCode {
	case http.StatusTooManyRequests, http.StatusBadGateway,
		http.StatusServiceUnavailable, http.StatusGatewayTimeout:
		return true
	}
	return false // 2xx, 3xx, other 4xx (a bad request stays bad), 500 (often a bug)
}

// retryAfter reads the delay-seconds form; the HTTP-date form is left out.
func retryAfter(resp *http.Response) (time.Duration, bool) {
	s, err := strconv.Atoi(resp.Header.Get("Retry-After"))
	if err != nil || s &lt; 0 {
		return 0, false
	}
	return time.Duration(s) * time.Second, true
}

// Full jitter: a random wait between 0 and min(cap, base*2^(attempt-1)).
func backoff(base, cap time.Duration, attempt int) time.Duration {
	d := cap
	if attempt &lt; 31 &amp;&amp; base&lt;&lt;(attempt-1) &lt; cap {
		d = base &lt;&lt; (attempt - 1)
	}
	return rand.N(d)
}

func errOrStatus(resp *http.Response, err error) error {
	if err != nil {
		return err
	}
	return errors.New(resp.Status)
}

// Budget is a retry token bucket in the style of gRPC retry throttling:
// failures cost 1 token, successes earn back ratio, and retries stop
// while the bucket is at or below half full.
type Budget struct {
	mu                 sync.Mutex
	tokens, max, ratio float64
}

func NewBudget(max, ratio float64) *Budget {
	return &amp;Budget{tokens: max, max: max, ratio: ratio}
}

// Failure records a failed attempt and reports whether a retry is allowed.
func (b *Budget) Failure() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.tokens = max(b.tokens-1, 0)
	return b.tokens &gt; b.max/2
}

func (b *Budget) Success() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.tokens = min(b.tokens+b.ratio, b.max)
}</code></pre>
<p>The test runs it against <code>httptest</code> servers. The first <code>503</code> carries <code>Retry-After: 1</code>, so the loop waits a full second; the second <code>503</code> has no header, so it backs off for a few milliseconds (base 20 ms in the test). Real output:</p>
<pre><code>$ go test -v
=== RUN   TestRetries
GET, two 503s then 200:
  server: GET attempt 1 at t=0.0s -&gt; 503
  server: GET attempt 2 at t=1.0s -&gt; 503
  server: GET attempt 3 at t=1.0s -&gt; 200
  result: 200 OK
GET, 400 Bad Request:
  server: GET attempt 1 at t=0.0s -&gt; 400
  result: 400 Bad Request
POST without Idempotency-Key, 503:
  server: POST attempt 1 at t=0.0s -&gt; 503
  result: 503 Service Unavailable
POST with Idempotency-Key, 503:
  server: POST attempt 1 at t=0.0s -&gt; 503
  server: POST attempt 2 at t=1.0s -&gt; 200
  result: 200 OK
--- PASS: TestRetries (2.03s)
=== RUN   TestBudget
20 calls to a dead dependency, max 3 attempts each:
  server saw 23 requests (60 without a budget)
--- PASS: TestBudget (0.01s)</code></pre>
<p>The <code>400</code> is returned at once, the <code>POST</code> without a key is never repeated, and the same <code>POST</code> with an <code>Idempotency-Key</code> is. Against a dependency that is completely down, the budget lets the first two calls retry and then stops retrying: 23 requests instead of 60.</p>

<p><strong>Real-world scenario.</strong> An inventory service runs on 6 pods behind a load balancer, and the orders service calls it 2,000 times per second. During a deploy, each pod restart resets a few hundred in-flight connections. With a single retry on <code>GET /stock</code>, those requests land on another pod and users never notice. A week later the inventory database runs out of connections at 09:12 and every query fails for 4 minutes. The gateway, the orders service and an SDK inside orders each retry 3 times, so the 2,000 requests per second become up to 2,000 × 27 = 54,000 attempts per second against inventory, and the database can't recover even after the connection leak is fixed. The fix from the postmortem: retries only in orders, at most 3 attempts with jittered backoff, a retry budget, and a <a href="#circuit-breakers">circuit breaker</a> that stops calling inventory while it's failing.</p>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>Retrying non-idempotent operations.</strong> A timed-out <code>POST /charges</code> may have succeeded. Retry it only with an <a href="#idempotency">idempotency key</a> the server deduplicates on.</li>
  <li><strong>Retrying at every layer.</strong> Amplification is exponential in depth. Retry at one layer and make sure libraries, meshes and gateways aren't also retrying.</li>
  <li><strong>Retrying without a budget.</strong> Per-call limits still multiply traffic when everything fails. Use a budget (gRPC <code>retryThrottling</code>, a token bucket) or a <a href="#circuit-breakers">circuit breaker</a>.</li>
  <li><strong>Retrying immediately, in sync.</strong> Thousands of clients that failed together retry together. Add exponential backoff with jitter, and honour <code>Retry-After</code>.</li>
  <li><strong>Retrying permanent errors.</strong> A <code>400</code> or a validation error will never succeed. Retrying it hides the bug and burns capacity.</li>
  <li><strong>Ignoring the deadline.</strong> Sleeping 2 s before an attempt that has 500 ms left wastes resources and the user's time. Stop when the context is done.</li>
  <li><strong>Reusing a consumed request body.</strong> An <code>http.Request</code> body is a stream; after the first attempt it is empty. Build a new request per attempt (as above) or set <code>GetBody</code>.</li>
  <li><strong>Not draining the response.</strong> Close (and ideally drain) the body of a failed response before retrying, or the connection can't go back to the pool.</li>
  <li><strong>Invisible retries.</strong> Log or count every retry as a <a href="#metrics">metric</a>. A rising retry rate is often the first sign that a dependency is degrading, long before errors reach users.</li>
</ul>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>Retry only transient failures (network errors, <code>429</code>, <code>502</code>–<code>504</code>, gRPC <code>UNAVAILABLE</code>), and only operations that are safe to repeat.</li>
  <li>Cap attempts per call (2–3) <em>and</em> retries across calls (a budget), and wait with jittered backoff or <code>Retry-After</code>.</li>
  <li>Retry at one layer only; 3 attempts at 3 layers is 27× load at the bottom.</li>
  <li>Stay inside the caller's deadline, and stop as soon as the context is done.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#exponential-backoff">Exponential Backoff</a> · <a href="#idempotency">Idempotency</a> · <a href="#timeouts">Timeouts</a> · <a href="#circuit-breakers">Circuit Breakers</a> · <a href="#rate-limiting">Rate Limiting</a> · <a href="#real-world-resilience-playbook">Real-World Resilience Playbook</a></p>
`;

CONTENT["exponential-backoff"] = `
<p class="tldr"><strong>TL;DR</strong>: Exponential backoff makes each retry wait longer than the last (100 ms, 200 ms, 400 ms…, up to a cap), so a struggling service gets room to recover. <strong>Jitter</strong> randomises each wait so that thousands of clients that failed at the same moment don't all retry at the same moment. Like a crowd leaving a stadium: staggered exits flow, everyone through one door at once is a crush.</p>

<h2>The problem it solves</h2>
<p>A <a href="#retries">retry</a> needs a pause before it. The two naive choices both fail:</p>
<ul>
  <li><strong>No wait.</strong> A client retrying in a tight loop sends hundreds of requests per second at a service that is already failing. Multiply by every client and you've built a denial-of-service attack against yourself.</li>
  <li><strong>A fixed wait</strong> (say 1 s). Better for one client, but if the service is down for a minute every client still hammers it once per second, and clients that failed together stay in lockstep forever.</li>
</ul>
<p>The second problem is the <strong>thundering herd</strong>. When a shared dependency fails, it fails for everyone at the same instant: all requests in flight error out together, or all WebSocket connections drop together when a gateway restarts. If every client then follows the same deterministic schedule, their retries arrive as synchronized waves. Each wave is far bigger than what the recovering service can handle, so most of it fails, which schedules the next wave, again all at the same time. The service can be healthy and still never catch up.</p>
<p>Exponential growth fixes the first problem (the total retry rate falls quickly while the outage lasts). Jitter fixes the second (it spreads the herd out in time).</p>

<h2>How it works</h2>
<h3>The formula</h3>
<p>With a base delay <code>base</code>, a cap <code>cap</code>, and retry number <code>n</code> (starting at 0):</p>
<pre><code>wait = min(cap, base × 2^n)                      // exponential backoff, no jitter</code></pre>
<p>With <code>base = 100 ms</code> that gives 100, 200, 400, 800 ms, 1.6 s, 3.2 s… The <strong>cap</strong> stops it growing without bound (a client waiting an hour to retry is effectively broken), and a <strong>maximum number of attempts</strong> or an overall deadline stops it retrying forever. The multiplier doesn't have to be 2: gRPC's connection backoff uses 1.6.</p>
<p>Jitter replaces the exact value with a random one. The AWS Architecture Blog post <em>Exponential Backoff and Jitter</em> (Marc Brooker, 2015) compares three variants, with <code>random_between</code> uniform:</p>
<pre><code>full:         wait = random_between(0, min(cap, base × 2^n))
equal:        t = min(cap, base × 2^n);  wait = t/2 + random_between(0, t/2)
decorrelated: wait = min(cap, random_between(base, previous_wait × 3))</code></pre>

<figure class="diagram">
<svg viewBox="0 0 780 290" role="img" aria-label="Backoff waits for 7 retries with base 100 milliseconds and cap 2 seconds. Without jitter the wait is the top of each bar: 100, 200, 400, 800 milliseconds, 1.6 seconds, then 2 seconds twice at the cap. With full jitter the wait is a random point inside the bar; the real draws were 100, 0, 300, 120, 380, 600 and 1620 milliseconds.">
  <path class="line" d="M100 30 V230 H760"/>
  <text x="92" y="234" text-anchor="end" class="small">0</text>
  <text x="92" y="134" text-anchor="end" class="small">1 s</text>
  <text x="92" y="34" text-anchor="end" class="small">2 s</text>
  <path class="line bad dashed" d="M100 30 H760"/>
  <text x="104" y="24" class="small">cap = 2 s</text>
  <rect class="box muted" x="125" y="220" width="50" height="10"/>
  <path class="line" d="M125 220 H175" style="stroke-width: 3"/>
  <circle class="box accent" cx="150" cy="220" r="5"/>
  <text x="150" y="248" text-anchor="middle" class="small">retry 1</text>
  <rect class="box muted" x="217" y="210" width="50" height="20"/>
  <path class="line" d="M217 210 H267" style="stroke-width: 3"/>
  <circle class="box accent" cx="242" cy="230" r="5"/>
  <text x="242" y="248" text-anchor="middle" class="small">retry 2</text>
  <rect class="box muted" x="309" y="190" width="50" height="40"/>
  <path class="line" d="M309 190 H359" style="stroke-width: 3"/>
  <circle class="box accent" cx="334" cy="200" r="5"/>
  <text x="334" y="248" text-anchor="middle" class="small">retry 3</text>
  <rect class="box muted" x="401" y="150" width="50" height="80"/>
  <path class="line" d="M401 150 H451" style="stroke-width: 3"/>
  <circle class="box accent" cx="426" cy="218" r="5"/>
  <text x="426" y="248" text-anchor="middle" class="small">retry 4</text>
  <rect class="box muted" x="493" y="70" width="50" height="160"/>
  <path class="line" d="M493 70 H543" style="stroke-width: 3"/>
  <circle class="box accent" cx="518" cy="192" r="5"/>
  <text x="518" y="248" text-anchor="middle" class="small">retry 5</text>
  <rect class="box muted" x="585" y="30" width="50" height="200"/>
  <path class="line" d="M585 30 H635" style="stroke-width: 3"/>
  <circle class="box accent" cx="610" cy="170" r="5"/>
  <text x="610" y="248" text-anchor="middle" class="small">retry 6</text>
  <rect class="box muted" x="677" y="30" width="50" height="200"/>
  <path class="line" d="M677 30 H727" style="stroke-width: 3"/>
  <circle class="box accent" cx="702" cy="68" r="5"/>
  <text x="702" y="248" text-anchor="middle" class="small">retry 7</text>
  <rect class="box muted" x="110" y="264" width="22" height="14"/><text x="140" y="276" class="small">full jitter: anywhere in [0, top)</text>
  <path class="line" d="M350 271 H380" style="stroke-width: 3"/><text x="388" y="276" class="small">no jitter: always the top</text>
  <circle class="box accent" cx="570" cy="271" r="5"/><text x="582" y="276" class="small">one real full-jitter draw</text>
</svg>
<figcaption>Base 100 ms, cap 2 s. The ceiling doubles until it hits the cap; full jitter picks a random point below it each time (dots: real values from the test below).</figcaption>
</figure>

<h3>Why jitter matters: synchronized vs spread retries</h3>
<p>The simulation in the example below starts 1,000 clients whose requests all fail at the same moment, when a dependency comes back after an outage. The recovering server can handle 10 requests per 10 ms; everything above that is rejected and retried. Same base (100 ms) and cap (10 s), different jitter:</p>
<figure class="diagram">
<svg viewBox="0 0 780 300" role="img" aria-label="Requests per 50 milliseconds after a dependency recovers, from the Go simulation. Without jitter, about 1,000 clients retry in synchronized spikes of 990, 980, 970, 960 and 950 requests at 0.1, 0.3, 0.7, 1.5 and 3.1 seconds, far above the server capacity of 50 per 50 milliseconds, with nothing in between. With full jitter the same clients spread out: load starts high and decays smoothly to near zero by about 2 seconds.">
  <text x="70" y="22" class="small">requests per 50 ms</text>
  <rect class="box bad" x="420" y="12" width="8" height="14"/><text x="436" y="24" class="small">no jitter: synchronized waves</text>
  <path class="line accent" d="M600 19 H630" style="stroke-width: 2"/><text x="638" y="24" class="small">full jitter</text>
  <path class="line" d="M70 50 V250 H750"/>
  <text x="62" y="254" text-anchor="end" class="small">0</text>
  <text x="62" y="154" text-anchor="end" class="small">500</text>
  <text x="62" y="54" text-anchor="end" class="small">1,000</text>
  <path class="line dashed" d="M70 150 H750" style="stroke: var(--line)"/>
  <path class="line dashed" d="M70 50 H750" style="stroke: var(--line)"/>
  <rect class="box bad" x="71.8" y="50.0" width="6" height="200.0"/>
  <rect class="box bad" x="91.2" y="52.0" width="6" height="198.0"/>
  <rect class="box bad" x="130.1" y="54.0" width="6" height="196.0"/>
  <rect class="box bad" x="207.8" y="56.0" width="6" height="194.0"/>
  <rect class="box bad" x="363.2" y="58.0" width="6" height="192.0"/>
  <rect class="box bad" x="674.1" y="60.0" width="6" height="190.0"/>
  <path class="line accent" d="M74.9 50.0 L84.6 114.2 L94.3 189.2 L104.0 198.4 L113.7 191.0 L123.4 216.4 L133.1 222.8 L142.9 223.6 L152.6 227.0 L162.3 228.0 L172.0 231.0 L181.7 234.0 L191.4 242.6 L201.1 242.6 L210.9 244.8 L220.6 243.8 L230.3 242.6 L240.0 246.0 L249.7 244.0 L259.4 243.8 L269.1 244.8 L278.9 245.2 L288.6 244.0 L298.3 248.2 L308.0 248.4 L317.7 248.2 L327.4 249.0 L337.1 249.2 L346.9 249.2 L356.6 249.0 L366.3 249.6 L376.0 249.6 L385.7 249.2 L395.4 248.8 L405.1 248.6 L414.9 249.6 L424.6 249.8 L434.3 250.0 L444.0 249.8 L453.7 249.6 L463.4 249.6 L473.1 249.6 L482.9 250.0 L492.6 250.0 L502.3 250.0 L512.0 250.0 L521.7 250.0 L531.4 250.0 L541.1 250.0 L550.9 249.8 L560.6 250.0 L570.3 250.0 L580.0 250.0 L589.7 249.8 L599.4 250.0 L609.1 250.0 L618.9 250.0 L628.6 249.8 L638.3 250.0 L648.0 249.8 L657.7 250.0 L667.4 250.0 L677.1 250.0 L686.9 250.0 L696.6 250.0 L706.3 250.0 L716.0 250.0 L725.7 249.8 L735.4 250.0 L745.1 250.0" style="stroke-width: 2"/>
  <text x="142" y="44" class="small">full jitter, first 50 ms: 1,489 (off scale)</text>
  <path class="line ok dashed" d="M70 243.3 H750"/>
  <text x="420" y="235" class="small">server capacity: 50 per 50 ms</text>
  <text x="70.0" y="268" text-anchor="middle" class="small">0 s</text>
  <text x="264.3" y="268" text-anchor="middle" class="small">1 s</text>
  <text x="458.6" y="268" text-anchor="middle" class="small">2 s</text>
  <text x="652.9" y="268" text-anchor="middle" class="small">3 s</text>
  <text x="410" y="290" text-anchor="middle" class="small">time since the dependency came back (real output of the simulation below, seed 42)</text>
</svg>
<figcaption>Without jitter, every rejected client retries at exactly the same instant, so the server sees a wave of ~1,000 requests, serves 10 and rejects the rest, over and over. With full jitter the same clients arrive spread out and the backlog drains in a few seconds.</figcaption>
</figure>
<p>Without jitter, the server is idle between waves and drowning during them. Average load looks fine on a per-minute dashboard; per-second load is a series of spikes. That is why "the service is up but nobody can get in" incidents often follow a restart.</p>

<h3>What the AWS post found</h3>
<p>Brooker simulated clients contending to update the same database row with optimistic concurrency (100 contending clients in the main case). Un-jittered exponential backoff was the clear loser on both total calls and completion time. Full and equal jitter made a similar number of calls, with equal jitter doing slightly more work; decorrelated jitter made more calls than both. On completion time, decorrelated was slightly faster than full jitter, and equal jitter was much slower. The post recommends full jitter as the usual choice and concludes that jittered backoff "should be considered a standard approach for remote clients". A 2023 update notes that most AWS SDKs now support backoff with jitter.</p>
<p>The exact ranking depends on the workload: in our capacity-limited simulation below, decorrelated jitter happened to make the fewest calls. What doesn't change is the gap between "no jitter" and any jitter.</p>

<h2>Variants compared</h2>
<table>
  <tr><th>Strategy</th><th>Wait before retry n</th><th>Spread</th><th>Notes</th></tr>
  <tr><td>Constant</td><td><code>d</code></td><td>none</td><td>fine for a single background job; synchronizes herds</td></tr>
  <tr><td>Exponential, no jitter</td><td><code>min(cap, base·2^n)</code></td><td>none</td><td>backs off but keeps clients in lockstep</td></tr>
  <tr><td>Full jitter</td><td><code>rand[0, min(cap, base·2^n))</code></td><td>widest</td><td>the usual default; some waits are near zero</td></tr>
  <tr><td>Equal jitter</td><td>half fixed + <code>rand[0, half)</code></td><td>half as wide</td><td>guarantees a minimum wait; slower to drain in AWS's results</td></tr>
  <tr><td>Decorrelated jitter</td><td><code>min(cap, rand[base, 3·prev))</code></td><td>wide, depends on the last wait</td><td>needs state (the previous wait); can shrink as well as grow</td></tr>
  <tr><td>Proportional jitter (±x%)</td><td><code>min(cap, base·m^n) × rand[1−x, 1+x]</code></td><td>narrow</td><td>gRPC: ±20% on connection backoff (base 1 s, ×1.6, max 120 s) and on call retries</td></tr>
  <tr><td>Server-directed</td><td><code>Retry-After</code> / pushback value</td><td>set by server</td><td>prefer it when present; add a little jitter if many clients get the same value</td></tr>
</table>
<p>Defaults in real clients: the AWS SDK for Go v2's standard retryer makes at most 3 attempts with a maximum backoff of 20 s, with a client-side retry token bucket on top. gRPC's connection backoff starts at 1 s, multiplies by 1.6, caps at 120 s and adds ±20% jitter.</p>

<h2>Example</h2>
<p><strong>A backoff type with the four variants.</strong> One <code>Backoff</code> value per operation (it counts attempts); pass a seeded <code>*rand.Rand</code> only when you need reproducible output, as in tests:</p>
<pre><code>package backoff

import (
	"math/rand/v2"
	"time"
)

type Jitter int

const (
	None         Jitter = iota // base * 2^n, capped
	Full                       // random in [0, base * 2^n)
	Equal                      // half fixed + half random
	Decorrelated               // random in [base, 3 * previous wait)
)

// Backoff hands out the wait before each retry. Use one per call, not one per client.
type Backoff struct {
	Base, Cap time.Duration
	Jitter    Jitter
	Rand      *rand.Rand // nil: the global, auto-seeded source

	attempt int
	prev    time.Duration
}

func (b *Backoff) Next() time.Duration {
	exp := b.Base
	for i := 0; i &lt; b.attempt &amp;&amp; exp &lt; b.Cap; i++ {
		exp *= 2 // doubling in a loop can't overflow the way base&lt;&lt;attempt can
	}
	exp = min(exp, b.Cap)
	b.attempt++

	switch b.Jitter {
	case Full:
		return b.random(exp)
	case Equal:
		return exp/2 + b.random(exp/2)
	case Decorrelated:
		prev := max(b.prev, b.Base)
		b.prev = min(b.Cap, b.Base+b.random(3*prev-b.Base))
		return b.prev
	default:
		return exp
	}
}

func (b *Backoff) Reset() { b.attempt, b.prev = 0, 0 }

// random returns a duration in [0, n).
func (b *Backoff) random(n time.Duration) time.Duration {
	if n &lt;= 0 {
		return 0
	}
	if b.Rand != nil {
		return time.Duration(b.Rand.Int64N(int64(n)))
	}
	return rand.N(n)
}</code></pre>
<p>Seven consecutive waits from each variant with base 100 ms and cap 2 s (real output, rounded to 10 ms; the dots in the first chart are the <code>full</code> row):</p>
<pre><code>=== RUN   TestSequence     (base 100 ms, cap 2 s, 7 retries)
none          [100ms 200ms 400ms 800ms 1.6s 2s 2s]
full          [100ms 0s 300ms 120ms 380ms 600ms 1.62s]
equal         [60ms 140ms 310ms 610ms 1.07s 1.19s 1.48s]
decorrelated  [240ms 330ms 640ms 470ms 1.22s 2s 340ms]</code></pre>
<p><strong>The thundering-herd simulation.</strong> 1,000 clients fail at <code>t = 0</code>; each 10 ms tick the server serves 10 requests in random order and rejects the rest, and each rejected client schedules its next try with its own <code>Backoff</code>:</p>
<pre><code>// simulate: every client's request fails at t=0 when the dependency comes back.
// In each tick the server serves &#96;capacity&#96; requests in random order and rejects the rest.
func simulate(j Jitter, seed uint64) result {
	r := rand.New(rand.NewPCG(seed, 1))
	next := make([]time.Duration, clients) // when each client sends next; -1 = done
	offs := make([]*Backoff, clients)
	for i := range offs {
		offs[i] = &amp;Backoff{Base: 100 * time.Millisecond, Cap: 10 * time.Second, Jitter: j, Rand: r}
	}
	res := result{series: make([]int, 70)}
	left := clients
	for now := time.Duration(0); left &gt; 0; now += tick {
		var sending []int
		for i, t := range next {
			if t &gt;= 0 &amp;&amp; t &lt;= now {
				sending = append(sending, i)
			}
		}
		res.calls += len(sending)
		if now &gt; 0 {
			res.peak = max(res.peak, len(sending)) // largest retry burst after the first wave
		}
		if b := int(now / (50 * time.Millisecond)); b &lt; len(res.series) {
			res.series[b] += len(sending)
		}
		r.Shuffle(len(sending), func(a, b int) { sending[a], sending[b] = sending[b], sending[a] })
		for k, i := range sending {
			if k &lt; capacity {
				next[i] = -1
				left--
				continue
			}
			next[i] = now + offs[i].Next().Round(tick)
		}
		res.done = now
	}
	return res
}</code></pre>
<p>Real output (<code>retry peak</code> is the largest number of retries arriving in one 10 ms tick, after the initial wave):</p>
<pre><code>=== RUN   TestSimulation   (1,000 clients, server serves 10 per 10 ms, base 100 ms, cap 10 s)
jitter           calls  retry peak/10ms    all done at
none             50500              990         932.7s
full              4270              157           3.4s
equal             4265              203           2.9s
decorrelated      3161               67           2.3s</code></pre>
<p>Without jitter, each wave serves only 10 clients and the next wave comes 2× later, until the 10 s cap: 50,500 calls and over 15 minutes to serve everyone, against a server that was healthy the whole time. Every jittered variant finishes in 2–4 seconds with 3,000–4,300 calls and retry peaks 5–15× lower. The results are similar with other seeds.</p>

<p><strong>Reconnecting clients.</strong> The same rules apply to long-lived connections. A client that reconnects a dropped <a href="#websockets">WebSocket</a> or <a href="#server-sent-events">server-sent events</a> stream should back off with jitter (SSE servers can also suggest a delay with the <code>retry:</code> field):</p>
<pre><code>package backoff

import (
	"context"
	"time"
)

// Reconnect dials until it succeeds or ctx ends, sleeping a jittered backoff between tries.
func Reconnect(ctx context.Context, dial func(context.Context) error) error {
	b := &amp;Backoff{Base: 500 * time.Millisecond, Cap: 30 * time.Second, Jitter: Full}
	for {
		if err := dial(ctx); err == nil {
			return nil
		}
		t := time.NewTimer(b.Next())
		select {
		case &lt;-ctx.Done():
			t.Stop()
			return ctx.Err()
		case &lt;-t.C:
		}
	}
}</code></pre>
<p><strong>Real-world scenario.</strong> A chat app keeps 200,000 mobile clients connected to a WebSocket gateway. At 14:05 a gateway deploy drops every connection, and the app reconnects after a fixed 1 s. At 14:05:01 the gateway receives 200,000 TLS handshakes and connection requests at once; it can complete a few thousand per second, the rest time out, and those clients retry at 14:05:02, together again. The gateway's CPU sits at 100% for twenty minutes while most users see "connecting…". With full-jitter backoff (base 500 ms, cap 30 s) and a 0–5 s random delay before the very first reconnect, the same 200,000 clients arrive spread over the first several seconds, and the gateway reconnects them in a minute or two.</p>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>Backoff without jitter.</strong> It reduces total load but keeps clients synchronized. Always add jitter; full jitter is a good default.</li>
  <li><strong>No cap, or a cap that's too high.</strong> Waits of minutes make a recovered service look down to the user. Cap the wait, and cap total time with the caller's <a href="#timeouts">deadline</a>.</li>
  <li><strong>No attempt limit.</strong> Backoff slows retries; it doesn't stop them. Pair it with max attempts, a retry budget or a <a href="#circuit-breakers">circuit breaker</a>.</li>
  <li><strong>Sharing one backoff counter across requests.</strong> Backoff state belongs to one operation. A process-wide counter makes unrelated requests wait because of each other.</li>
  <li><strong>Resetting too eagerly.</strong> A reconnect loop that resets backoff as soon as the connection opens will hammer a server that accepts connections and then drops them. Reset only after the connection has been healthy for a while.</li>
  <li><strong>Identical random seeds.</strong> Jitter from a generator seeded with a constant, or with the same value on every device, is not jitter. Go's top-level <code>math/rand/v2</code> functions are seeded randomly; use a fixed seed only in tests.</li>
  <li><strong>Overflow.</strong> <code>base &lt;&lt; n</code> overflows <code>time.Duration</code> for large <code>n</code> and can become negative. Clamp before shifting, or double in a loop up to the cap as above.</li>
  <li><strong>Ignoring the server.</strong> When a <code>429</code> or <code>503</code> carries <code>Retry-After</code>, that value beats your formula (see <a href="#rate-limiting">Rate Limiting</a>).</li>
</ul>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>Exponential backoff: <code>min(cap, base·2^n)</code>, so the retry rate drops fast during an outage.</li>
  <li>Jitter breaks up the thundering herd. Without it, clients that failed together retry together, in waves.</li>
  <li>Full jitter, <code>rand[0, min(cap, base·2^n))</code>, is the usual default; always bound it with a cap, attempts and a deadline.</li>
  <li>Prefer the server's <code>Retry-After</code> when it sends one, and use the same rules for reconnecting clients.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#retries">Retries</a> · <a href="#timeouts">Timeouts</a> · <a href="#circuit-breakers">Circuit Breakers</a> · <a href="#rate-limiting">Rate Limiting</a> · <a href="#websockets">WebSockets</a> · <a href="#server-sent-events">Server-Sent Events</a></p>
`;

CONTENT["idempotency"] = `
<p class="tldr"><strong>TL;DR</strong>: An operation is idempotent if doing it twice has the same effect as doing it once. "Set the light to on" is idempotent; "toggle the light" is not. Retries are only safe on idempotent operations, so for things like payments the client sends a unique <strong>idempotency key</strong>, and the server remembers the result per key and returns the same answer to every retry instead of charging again.</p>

<h2>The problem it solves</h2>
<p>A network call can end in three ways: it worked, it failed, or <strong>you don't know</strong>. The third case is the dangerous one:</p>
<ul>
  <li>The client sends "charge 50.00". The server charges the card and commits. The response is lost: a timeout, a dropped mobile connection, a load balancer restart.</li>
  <li>The client can't tell "failed before charging" from "charged, but the reply got lost". If it gives up, a real order may be lost. If it retries, the customer may be charged twice.</li>
</ul>
<p>The same thing happens everywhere work is retried: <a href="#retries">client retries</a>, a proxy retrying an upstream, a user double-clicking "Pay", a queue redelivering a message after a consumer crash, a <a href="#webhooks">webhook</a> sent again because your 200 arrived late. You can't make the network reliable. You can make <strong>repeats harmless</strong>, and then "when in doubt, retry" becomes a safe rule.</p>

<h2>How it works</h2>
<h3>Idempotent vs safe HTTP methods</h3>
<p>HTTP (RFC 9110) defines two properties. A <strong>safe</strong> method doesn't change server state, it only reads. An <strong>idempotent</strong> method may change state, but sending it N times leaves the same state as sending it once. The response can differ (a second <code>DELETE</code> may return <code>404</code>); what matters is the effect.</p>
<table>
  <tr><th>Method</th><th>Safe</th><th>Idempotent</th><th>Why</th><th>Retry without a key?</th></tr>
  <tr><td><code>GET</code>, <code>HEAD</code>, <code>OPTIONS</code></td><td>yes</td><td>yes</td><td>read only</td><td>yes</td></tr>
  <tr><td><code>PUT</code></td><td>no</td><td>yes</td><td>"replace the resource with this": the second time sets the same value</td><td>yes, if implemented as a full replace</td></tr>
  <tr><td><code>DELETE</code></td><td>no</td><td>yes</td><td>after the first, the resource is already gone</td><td>yes</td></tr>
  <tr><td><code>POST</code></td><td>no</td><td>no</td><td>"create a new one" or "do this action": each call can do it again</td><td>only with an idempotency key</td></tr>
  <tr><td><code>PATCH</code></td><td>no</td><td>not guaranteed</td><td>"set name = X" is idempotent, "add 1 to count" is not</td><td>only if you know the patch is</td></tr>
</table>
<p>These are promises your implementation has to keep. A <code>PUT</code> handler that appends to a list, or a <code>GET</code> that increments a counter, breaks them, and every proxy and client library that retries "idempotent" methods will now corrupt your data.</p>

<h3>Idempotency keys</h3>
<p>For non-idempotent operations, the client makes them idempotent by naming the attempt. It generates a unique key (a random UUID) <strong>once per logical operation</strong>, sends it in the <code>Idempotency-Key</code> header, and reuses the same key on every retry. The server stores, per key: a fingerprint of the request, a status (in progress or done), and the response it returned.</p>

<figure class="diagram">
<svg viewBox="0 0 780 390" role="img" aria-label="Sequence: the client posts a payment with Idempotency-Key K. The API claims K in the key store, charges the payment provider, saves the 201 response under K, but the reply to the client is lost. The client retries with the same key and body. The API finds K done with a matching hash and replays the saved 201. The provider is not charged again.">
  <defs><marker id="arr-id-1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <rect class="box" x="15" y="10" width="150" height="34" rx="6"/><text x="90" y="32" text-anchor="middle" class="title">Client</text>
  <rect class="box accent" x="225" y="10" width="150" height="34" rx="6"/><text x="300" y="32" text-anchor="middle" class="title">API + key check</text>
  <rect class="box" x="425" y="10" width="150" height="34" rx="6"/><text x="500" y="32" text-anchor="middle" class="title">Key store</text>
  <rect class="box" x="615" y="10" width="150" height="34" rx="6"/><text x="690" y="32" text-anchor="middle" class="title">Payment provider</text>
  <path class="line dashed" d="M90 44 V385" style="stroke: var(--line)"/><path class="line dashed" d="M300 44 V385" style="stroke: var(--line)"/>
  <path class="line dashed" d="M500 44 V385" style="stroke: var(--line)"/><path class="line dashed" d="M690 44 V385" style="stroke: var(--line)"/>

  <path class="line" d="M90 76 H298" marker-end="url(#arr-id-1)"/><text x="195" y="68" text-anchor="middle" class="small">1 POST, Idempotency-Key: K</text>
  <path class="line" d="M300 104 H498" marker-end="url(#arr-id-1)"/><text x="400" y="96" text-anchor="middle" class="small">2 claim K: in progress</text>
  <path class="line" d="M300 134 H688" marker-end="url(#arr-id-1)"/><text x="595" y="126" text-anchor="middle" class="small">3 charge 50.00</text>
  <path class="line dashed" d="M690 162 H302" marker-end="url(#arr-id-1)"/><text x="595" y="156" text-anchor="middle" class="small">charged</text>
  <path class="line" d="M300 192 H498" marker-end="url(#arr-id-1)"/><text x="400" y="184" text-anchor="middle" class="small">4 save 201 + body under K</text>
  <path class="line bad" d="M300 222 H160"/>
  <path class="line bad" d="M146 214 L160 230 M160 214 L146 230"/>
  <text x="230" y="214" text-anchor="middle" class="small">5 201 lost</text>

  <rect class="box muted" x="190" y="246" width="400" height="26" rx="6"/>
  <text x="390" y="264" text-anchor="middle" class="small">client times out, retries with the SAME key and body</text>

  <path class="line" d="M90 302 H298" marker-end="url(#arr-id-1)"/><text x="195" y="294" text-anchor="middle" class="small">6 POST, same K, same body</text>
  <path class="line" d="M300 332 H498" marker-end="url(#arr-id-1)"/><text x="400" y="324" text-anchor="middle" class="small">7 K is done, hash matches</text>
  <path class="line ok" d="M298 362 H92" marker-end="url(#arr-id-1)"/><text x="195" y="354" text-anchor="middle" class="small">8 the same 201, replayed</text>
  <rect class="box ok" x="620" y="318" width="140" height="28" rx="6"/><text x="690" y="337" text-anchor="middle" class="small">not charged again</text>
</svg>
<figcaption>The key turns "maybe it happened" into a question the server can answer. The retry gets the original result, and the side effect happens exactly once.</figcaption>
</figure>

<p>When a request with a key arrives, the server has four possible answers:</p>
<figure class="diagram">
<svg viewBox="0 0 780 300" role="img" aria-label="Decision flow for a request with an idempotency key. No key: 400. Key not in store: claim it, run the handler, save the response. Key in store with a different request hash: 422. Same hash but still in progress: 409. Same hash and done: replay the saved response.">
  <defs><marker id="arr-id-2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <rect class="box" x="20" y="128" width="150" height="44" rx="8"/><text x="95" y="155" text-anchor="middle">POST arrives</text>
  <rect class="box accent" x="215" y="128" width="150" height="44" rx="8"/><text x="290" y="155" text-anchor="middle">K in store?</text>
  <rect class="box accent" x="410" y="128" width="150" height="44" rx="8"/><text x="485" y="155" text-anchor="middle">same body hash?</text>
  <rect class="box accent" x="605" y="128" width="150" height="44" rx="8"/><text x="680" y="155" text-anchor="middle">finished?</text>

  <rect class="box bad" x="20" y="228" width="150" height="50" rx="8"/><text x="95" y="250" text-anchor="middle" class="title">400</text><text x="95" y="268" text-anchor="middle" class="small">key required</text>
  <rect class="box ok" x="215" y="228" width="150" height="50" rx="8"/><text x="290" y="248" text-anchor="middle" class="small">claim K, run handler,</text><text x="290" y="264" text-anchor="middle" class="small">save the response</text>
  <rect class="box bad" x="410" y="22" width="150" height="50" rx="8"/><text x="485" y="44" text-anchor="middle" class="title">422</text><text x="485" y="62" text-anchor="middle" class="small">key reused, new body</text>
  <rect class="box bad" x="605" y="22" width="150" height="50" rx="8"/><text x="680" y="44" text-anchor="middle" class="title">409</text><text x="680" y="62" text-anchor="middle" class="small">first one still running</text>
  <rect class="box ok" x="605" y="228" width="150" height="50" rx="8"/><text x="680" y="248" text-anchor="middle" class="small">replay saved status,</text><text x="680" y="264" text-anchor="middle" class="small">headers and body</text>

  <path class="line" d="M170 150 H213" marker-end="url(#arr-id-2)"/><text x="192" y="142" text-anchor="middle" class="small">key</text>
  <path class="line bad" d="M95 172 V226" marker-end="url(#arr-id-2)"/><text x="102" y="203" class="small">no key</text>
  <path class="line ok" d="M290 172 V226" marker-end="url(#arr-id-2)"/><text x="297" y="203" class="small">no</text>
  <path class="line" d="M365 150 H408" marker-end="url(#arr-id-2)"/><text x="387" y="142" text-anchor="middle" class="small">yes</text>
  <path class="line bad" d="M485 128 V74" marker-end="url(#arr-id-2)"/><text x="492" y="105" class="small">no</text>
  <path class="line" d="M560 150 H603" marker-end="url(#arr-id-2)"/><text x="582" y="142" text-anchor="middle" class="small">yes</text>
  <path class="line bad" d="M680 128 V74" marker-end="url(#arr-id-2)"/><text x="687" y="105" class="small">no</text>
  <path class="line ok" d="M680 172 V226" marker-end="url(#arr-id-2)"/><text x="687" y="203" class="small">yes</text>
</svg>
<figcaption>The status codes follow the IETF draft for the <code>Idempotency-Key</code> header: 400 when a required key is missing, 422 when a key is reused with a different payload, 409 while the original request is still being processed.</figcaption>
</figure>

<h3>What real APIs do</h3>
<ul>
  <li><strong>Stripe</strong> (API v1) accepts an <code>Idempotency-Key</code> on every <code>POST</code>; keys can be up to 255 characters and are suggested to be V4 UUIDs. It saves the status code and body of the first request once the endpoint has started executing, and replays them for retries with the same key, <em>including <code>500</code> errors</em>. If the parameters differ from the original, it returns an error. Requests that fail validation, or that collide with a concurrent request using the same key, are not saved, so they can be retried. Keys can be pruned once they are at least 24 hours old, after which a reuse counts as a new request. Replayed responses carry <code>Idempotent-Replayed: true</code>.</li>
  <li><strong>The IETF draft</strong> <code>draft-ietf-httpapi-idempotency-key-header</code> (an Internet-Draft, not yet an RFC) standardises the header as a Structured Field string, e.g. <code>Idempotency-Key: "8e03978e-40d5-43e8-bc93-6894a57f9324"</code>. It asks servers to publish their idempotency rules and key expiry policy, and defines the 400 / 422 / 409 responses above. It doesn't prescribe a key lifetime.</li>
</ul>

<h3>"Exactly once" is at-least-once plus dedup</h3>
<p>Over an unreliable network, no protocol can guarantee a message is <em>delivered</em> exactly once. What systems actually do is deliver <strong>at least once</strong> (retry until acknowledged) and make the receiver <strong>deduplicate</strong>, so the <em>effect</em> happens once. When a broker or framework advertises "exactly-once", look for where the dedup happens and what it covers. It usually stops at the edge of that system: an email sent or an HTTP call made from inside the handler is outside it.</p>

<h3>Ways to make an operation idempotent</h3>
<table>
  <tr><th>Technique</th><th>How</th><th>Good for</th><th>Limits</th></tr>
  <tr><td>Idempotency key + stored response</td><td>client sends a key; server stores request hash and response per key</td><td>public APIs, payments, any <code>POST</code> that creates something</td><td>needs a shared store, expiry, and handling of in-flight requests</td></tr>
  <tr><td>Natural key + unique constraint</td><td>one payment per <code>order_id</code>, enforced by a <code>UNIQUE</code> index</td><td>"at most one X per Y" rules</td><td>only works when such a key exists in the domain</td></tr>
  <tr><td>Upsert / set absolute values</td><td><code>INSERT … ON CONFLICT DO UPDATE</code>; "set balance to 70" instead of "subtract 30"</td><td>sync jobs, state replication, PUT-style APIs</td><td>last write wins; deltas need another technique</td></tr>
  <tr><td>Conditional write</td><td>update only if <code>version = 7</code> or <code>If-Match: "etag"</code></td><td>edits to existing records</td><td>a retry after success sees a version conflict; the client must treat it as "probably mine" (see <a href="#optimistic-locking">Optimistic Locking</a>)</td></tr>
  <tr><td>Processed-message table</td><td>consumer records each message ID in the same DB transaction as its effect</td><td><a href="#message-queues">queue</a> consumers, <a href="#webhooks">webhook</a> receivers</td><td>the effect must live in the same database as the dedup record</td></tr>
</table>

<h2>Example</h2>
<p><strong>Idempotency-key middleware in Go.</strong> It applies to <code>POST</code> and <code>PATCH</code>, scopes each key to the caller and endpoint, fingerprints the body with SHA-256, claims the key <em>before</em> running the handler, and replays the stored response on a retry. The store is a map behind a mutex, which is enough to show the logic; with several instances, the same steps run against Redis (<code>SET key value NX EX 86400</code> to claim) or a database table.</p>
<pre><code>package idem

import (
	"bytes"
	"crypto/sha256"
	"io"
	"net/http"
	"sync"
	"time"
)

type record struct {
	reqHash [32]byte
	done    bool // false while the first request is still running
	status  int
	header  http.Header
	body    []byte
	expires time.Time
}

// Store keeps one record per key. In production this is Redis or a DB
// table shared by every instance; a map only works for a single process.
type Store struct {
	mu   sync.Mutex
	recs map[string]*record
	ttl  time.Duration
}

func NewStore(ttl time.Duration) *Store {
	return &amp;Store{recs: map[string]*record{}, ttl: ttl}
}

func (s *Store) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost &amp;&amp; r.Method != http.MethodPatch {
			next.ServeHTTP(w, r) // GET, PUT, DELETE are idempotent by definition
			return
		}
		key := r.Header.Get("Idempotency-Key")
		if key == "" {
			http.Error(w, "Idempotency-Key header required", http.StatusBadRequest)
			return
		}
		body, err := io.ReadAll(io.LimitReader(r.Body, 1&lt;&lt;20))
		if err != nil {
			http.Error(w, "cannot read body", http.StatusBadRequest)
			return
		}
		r.Body = io.NopCloser(bytes.NewReader(body))
		// Scope the key to the caller and the endpoint, then fingerprint the request.
		scoped := r.Header.Get("X-API-Key") + " " + r.Method + " " + r.URL.Path + " " + key
		hash := sha256.Sum256(body)

		s.mu.Lock()
		rec, seen := s.recs[scoped]
		if seen &amp;&amp; time.Now().After(rec.expires) {
			seen = false // expired: treat as a brand new request
		}
		switch {
		case seen &amp;&amp; rec.reqHash != hash:
			s.mu.Unlock()
			http.Error(w, "Idempotency-Key reused with a different request", http.StatusUnprocessableEntity)
			return
		case seen &amp;&amp; !rec.done:
			s.mu.Unlock()
			http.Error(w, "a request with this Idempotency-Key is in progress", http.StatusConflict)
			return
		case seen:
			s.mu.Unlock()
			for k, v := range rec.header {
				w.Header()[k] = v
			}
			w.Header().Set("Idempotent-Replayed", "true")
			w.WriteHeader(rec.status)
			w.Write(rec.body)
			return
		}
		// First time: claim the key before doing any work, so a concurrent
		// duplicate sees "in progress" instead of running the handler too.
		rec = &amp;record{reqHash: hash, expires: time.Now().Add(s.ttl)}
		s.recs[scoped] = rec
		s.mu.Unlock()

		cw := &amp;captureWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(cw, r)

		s.mu.Lock()
		defer s.mu.Unlock()
		if cw.status &gt;= 500 {
			delete(s.recs, scoped) // nothing was committed; let the client retry
			return
		}
		rec.done, rec.status, rec.header, rec.body = true, cw.status, w.Header().Clone(), cw.buf.Bytes()
	})
}

// captureWriter passes the response through and keeps a copy of it.
type captureWriter struct {
	http.ResponseWriter
	status int
	buf    bytes.Buffer
}

func (c *captureWriter) WriteHeader(code int) {
	c.status = code
	c.ResponseWriter.WriteHeader(code)
}

func (c *captureWriter) Write(b []byte) (int, error) {
	c.buf.Write(b)
	return c.ResponseWriter.Write(b)
}</code></pre>

<p>A test drives it with a payment handler that counts real charges:</p>
<pre><code>func Example() {
	var charges atomic.Int32
	release := make(chan struct{})
	pay := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		if strings.Contains(string(body), "slow") {
			&lt;-release // keep this request in flight for the 409 demo
		}
		n := charges.Add(1) // the side effect we must not repeat
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		fmt.Fprintf(w, &#96;{"id":"pay_%d","status":"succeeded"}&#96;, n)
	})
	srv := httptest.NewServer(NewStore(24 * time.Hour).Middleware(pay))
	defer srv.Close()

	post := func(label, key, body string) {
		req, _ := http.NewRequest(http.MethodPost, srv.URL+"/payments", strings.NewReader(body))
		req.Header.Set("X-API-Key", "shop_1")
		if key != "" {
			req.Header.Set("Idempotency-Key", key)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			panic(err)
		}
		b, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		replayed := resp.Header.Get("Idempotent-Replayed")
		fmt.Printf("%-22s %d  replayed=%-4s  %s&#92;n", label, resp.StatusCode, replayed, strings.TrimSpace(string(b)))
	}

	post("first attempt", "order-7-pay", &#96;{"amount":5000}&#96;)
	post("retry, same key", "order-7-pay", &#96;{"amount":5000}&#96;)
	post("same key, new amount", "order-7-pay", &#96;{"amount":9000}&#96;)
	post("no key", "", &#96;{"amount":5000}&#96;)

	done := make(chan struct{})
	go func() { post("slow original", "order-8-pay", &#96;{"amount":700,"note":"slow"}&#96;); close(done) }()
	time.Sleep(50 * time.Millisecond)
	post("duplicate in flight", "order-8-pay", &#96;{"amount":700,"note":"slow"}&#96;)
	close(release)
	&lt;-done
	post("retry after it ends", "order-8-pay", &#96;{"amount":700,"note":"slow"}&#96;)

	fmt.Println("payments actually charged:", charges.Load())
}</code></pre>

<p>Real output from <code>go test</code> (pinned as the example's expected output; it also passes under <code>-race</code>):</p>
<pre><code>first attempt          201  replayed=      {"id":"pay_1","status":"succeeded"}
retry, same key        201  replayed=true  {"id":"pay_1","status":"succeeded"}
same key, new amount   422  replayed=      Idempotency-Key reused with a different request
no key                 400  replayed=      Idempotency-Key header required
duplicate in flight    409  replayed=      a request with this Idempotency-Key is in progress
slow original          201  replayed=      {"id":"pay_2","status":"succeeded"}
retry after it ends    201  replayed=true  {"id":"pay_2","status":"succeeded"}
payments actually charged: 2</code></pre>
<p>Seven requests, two charges. The retry gets <code>pay_1</code> back instead of creating <code>pay_2</code>; the reused key with a different amount is refused rather than silently replaying the old charge; and the duplicate that arrives while the original is still running gets <code>409</code> instead of running the handler a second time.</p>

<p><strong>The database is the last line of defence.</strong> The middleware handles retries of one HTTP request. A unique constraint handles every path that could create a duplicate, including a second code path, a batch job, or a bug in the middleware:</p>
<pre><code>// Schema: payments(id, order_id UNIQUE, amount, created_at).
// The UNIQUE constraint is the real guarantee: two racing inserts
// for the same order cannot both succeed, whatever the app does.
func ChargeOnce(ctx context.Context, db *sql.DB, orderID string, amount int64) (paymentID string, created bool, err error) {
	err = db.QueryRowContext(ctx, &#96;
		INSERT INTO payments (order_id, amount) VALUES ($1, $2)
		ON CONFLICT (order_id) DO NOTHING
		RETURNING id&#96;, orderID, amount).Scan(&amp;paymentID)
	if errors.Is(err, sql.ErrNoRows) { // conflict: it already exists
		err = db.QueryRowContext(ctx,
			&#96;SELECT id FROM payments WHERE order_id = $1&#96;, orderID).Scan(&amp;paymentID)
		return paymentID, false, err
	}
	return paymentID, err == nil, err
}</code></pre>

<p><strong>Real-world scenario.</strong> A mobile checkout calls <code>POST /payments</code> with a 5 s client timeout. At 14:05 the payment provider's p99 goes from 400 ms to 7 s. Many requests still succeed on the server, after the app has already given up, and the app retries. Without keys, every "timed out but actually charged" request becomes a double charge: support tickets, refunds, and chargebacks. With a key generated when the user taps "Pay" (and saved on the device so it survives an app restart), a retry gets <code>409</code> while the first attempt is still running, and the original <code>201</code> once it has finished. The customer is charged once, and sees one receipt.</p>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>A new key per attempt.</strong> Generating the UUID inside the retry loop makes every retry look new, which defeats the point. Create the key once per user intent, before the first attempt, and keep it until you get a definite answer.</li>
  <li><strong>Check-then-insert races.</strong> "Look up the key; if absent, run the handler" lets two concurrent duplicates both see "absent". Claim the key atomically first (<code>SET NX</code>, <code>INSERT</code> into a table with a unique key), as the middleware does under its mutex.</li>
  <li><strong>Stuck "in progress" records.</strong> If the process crashes after claiming a key, every retry gets <code>409</code> forever. Give in-progress claims a lease (an expiry) or a recovery step, and make the work behind them transactional so a crash leaves nothing half-done.</li>
  <li><strong>Which responses to store.</strong> Stripe replays <code>500</code>s; the example instead forgets the key on <code>5xx</code> so the client can retry. Forgetting is only safe if a <code>5xx</code> really means nothing was committed. Never store a response for a request that failed validation before doing any work.</li>
  <li><strong>Unscoped keys.</strong> Keys must be unique per client, and usually per endpoint. Otherwise two customers' UUIDs could collide (unlikely) or a bug that reuses keys leaks one customer's response to another (bad).</li>
  <li><strong>Expiry shorter than the retry window.</strong> If keys are pruned after 1 hour but a queue can redeliver after 2, the duplicate is processed as new. Keep keys longer than any retry path can last.</li>
  <li><strong>Side effects outside the transaction.</strong> Sending an email or calling another API inside the handler isn't covered by your database's dedup. Pass the key downstream (many payment APIs accept one), or record the side effect in an outbox processed separately.</li>
</ul>

<div class="callout warn"><strong>Retries without idempotency are a data bug waiting for a slow day.</strong> Every layer that retries (client SDK, service mesh, load balancer, queue) assumes the operation is safe to repeat. Check that each non-idempotent call in a retry path has a key or a unique constraint behind it.</div>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>Idempotent = repeating the operation has no extra effect. <code>GET</code>, <code>PUT</code>, <code>DELETE</code> should be; <code>POST</code> is not.</li>
  <li>Make <code>POST</code> retryable with an idempotency key: store request hash + response, replay on retry, 422 on a mismatched body, 409 while in flight.</li>
  <li>"Exactly once" in practice means at-least-once delivery plus deduplication of the effect.</li>
  <li>Back the API-level check with a database unique constraint or upsert, which also catches duplicates from other paths.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#retries">Retries</a> · <a href="#message-queues">Message Queues</a> · <a href="#webhooks">Webhooks</a> · <a href="#distributed-transactions">Distributed Transactions</a> · <a href="#optimistic-locking">Optimistic Locking</a> · <a href="#real-world-resilience-playbook">Real-World Resilience Playbook</a></p>
`;
CONTENT["backpressure"] = `
<p class="tldr"><strong>TL;DR</strong>: Backpressure is how a system that can't keep up tells the sender to slow down, instead of silently piling work into a queue until it runs out of memory or every request is late. Think of a kitchen that stops taking orders when every burner is busy and the ticket rail is full, rather than accepting 300 orders it will serve cold an hour later.</p>

<h2>The problem it solves</h2>
<p>Whenever a producer can send work faster than a consumer can finish it, the difference has to go somewhere. If nothing pushes back, it goes into a queue: a channel, a goroutine per request, a socket buffer, a Kafka topic, a thread pool's task list.</p>
<ul>
  <li><strong>Unbounded queues turn overload into latency.</strong> If 80 requests per second arrive and you can serve 40, the queue grows by 40 every second. After 10 seconds, a new request waits 10 seconds before anyone looks at it.</li>
  <li><strong>Then into memory.</strong> Every queued item holds memory: a goroutine stack, a request body, a buffer. A long enough spike ends with the process being OOM-killed, which drops <em>everything</em> in the queue.</li>
  <li><strong>Work for nobody.</strong> Clients time out after a few seconds and retry, but the server still works through the old, abandoned requests. Throughput looks fine on a graph while <em>goodput</em> (useful completed work) falls towards zero.</li>
  <li><strong>Slow recovery.</strong> Even after traffic drops back, the backlog takes minutes to drain, and every request in that time is slow.</li>
</ul>
<p>Backpressure makes the limit explicit: bounded buffers, and a clear decision about what happens when they are full.</p>

<h2>How it works</h2>
<p>Every backpressure design has the same three parts: a <strong>bounded</strong> buffer between producer and consumer, a <strong>signal</strong> when it fills up, and a <strong>policy</strong> for what to do with the extra work.</p>
<figure class="diagram">
<svg viewBox="0 0 780 330" role="img" aria-label="A producer sends 80 items per second into a bounded queue with 6 slots, all full. A consumer drains 40 per second. When the queue is full there are five options: block the producer, drop items, shed load with 429 or 503, buffer somewhere bigger, or signal the producer to send less.">
  <defs><marker id="arr-bp-1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <rect class="box" x="30" y="56" width="150" height="56" rx="8"/>
  <text x="105" y="80" text-anchor="middle" class="title">Producer</text>
  <text x="105" y="98" text-anchor="middle" class="small">sends 80 / s</text>
  <rect class="box muted" x="290" y="54" width="190" height="60" rx="6"/>
  <rect class="box accent" x="300" y="64" width="26" height="40" rx="3"/><rect class="box accent" x="330" y="64" width="26" height="40" rx="3"/><rect class="box accent" x="360" y="64" width="26" height="40" rx="3"/><rect class="box accent" x="390" y="64" width="26" height="40" rx="3"/><rect class="box accent" x="420" y="64" width="26" height="40" rx="3"/><rect class="box accent" x="450" y="64" width="26" height="40" rx="3"/>
  <text x="385" y="40" text-anchor="middle" class="small">bounded queue: 6 of 6 slots used</text>
  <rect class="box" x="600" y="56" width="150" height="56" rx="8"/>
  <text x="675" y="80" text-anchor="middle" class="title">Consumer</text>
  <text x="675" y="98" text-anchor="middle" class="small">handles 40 / s</text>
  <path class="line" d="M180 84 H288" marker-end="url(#arr-bp-1)"/>
  <path class="line" d="M480 84 H598" marker-end="url(#arr-bp-1)"/>
  <path class="line bad dashed" d="M385 114 V152" marker-end="url(#arr-bp-1)"/>
  <text x="395" y="138" class="small">full: what now?</text>

  <rect class="box" x="10" y="160" width="142" height="62" rx="8"/>
  <text x="81" y="184" text-anchor="middle" class="title">Block</text>
  <text x="81" y="204" text-anchor="middle" class="small">producer waits</text>
  <rect class="box" x="164" y="160" width="142" height="62" rx="8"/>
  <text x="235" y="184" text-anchor="middle" class="title">Drop</text>
  <text x="235" y="204" text-anchor="middle" class="small">newest or oldest</text>
  <rect class="box bad" x="318" y="160" width="142" height="62" rx="8"/>
  <text x="389" y="184" text-anchor="middle" class="title">Shed load</text>
  <text x="389" y="204" text-anchor="middle" class="small">fast 429 / 503</text>
  <rect class="box" x="472" y="160" width="142" height="62" rx="8"/>
  <text x="543" y="184" text-anchor="middle" class="title">Buffer</text>
  <text x="543" y="204" text-anchor="middle" class="small">disk, broker, bigger</text>
  <rect class="box ok" x="626" y="160" width="142" height="62" rx="8"/>
  <text x="697" y="184" text-anchor="middle" class="title">Signal</text>
  <text x="697" y="204" text-anchor="middle" class="small">"send me N more"</text>

  <path class="line ok dashed" d="M697 222 V290 H158 V114" marker-end="url(#arr-bp-1)"/>
  <text x="400" y="284" text-anchor="middle" class="small">credits / window updates flow back to the producer, which sends only what was asked for</text>
  <text x="400" y="316" text-anchor="middle" class="small">Block and Signal slow the producer down; Drop and Shed refuse work; Buffer only postpones the decision.</text>
</svg>
<figcaption>A queue only helps with short bursts. For sustained overload you must slow the producer down or refuse some work; a bigger buffer just moves the problem.</figcaption>
</figure>

<h3>Why the bound matters: latency under sustained overload</h3>
<p>Take the numbers above: 80 requests per second arrive for 10 seconds, the service handles 40. With an unbounded queue the backlog grows by 40 every second, so the wait grows by one second every second. With a bounded queue of 40 items (one second of work), the wait is capped at about one second and the excess is refused immediately.</p>
<figure class="diagram">
<svg viewBox="0 0 780 300" role="img" aria-label="Chart of queueing delay over time. Overload from second 2 to second 12. With an unbounded queue, the wait climbs linearly from 0 to 10 seconds and is still 9 seconds at second 14. With a bounded queue of 40 items, the wait rises to about 1 second and stays there, then falls to zero once the overload ends.">
  <path class="line" d="M70 30 V250 H724"/>
  <path class="line dashed" d="M70 210 H714" style="stroke: var(--line)"/><text x="62" y="214" text-anchor="end" class="small">2 s</text><path class="line dashed" d="M70 170 H714" style="stroke: var(--line)"/><text x="62" y="174" text-anchor="end" class="small">4 s</text><path class="line dashed" d="M70 130 H714" style="stroke: var(--line)"/><text x="62" y="134" text-anchor="end" class="small">6 s</text><path class="line dashed" d="M70 90 H714" style="stroke: var(--line)"/><text x="62" y="94" text-anchor="end" class="small">8 s</text><path class="line dashed" d="M70 50 H714" style="stroke: var(--line)"/><text x="62" y="54" text-anchor="end" class="small">10 s</text><text x="70" y="268" text-anchor="middle" class="small">0</text><text x="162" y="268" text-anchor="middle" class="small">2</text><text x="254" y="268" text-anchor="middle" class="small">4</text><text x="346" y="268" text-anchor="middle" class="small">6</text><text x="438" y="268" text-anchor="middle" class="small">8</text><text x="530" y="268" text-anchor="middle" class="small">10</text><text x="622" y="268" text-anchor="middle" class="small">12</text><text x="714" y="268" text-anchor="middle" class="small">14</text>
  <text x="392" y="290" text-anchor="middle" class="small">time (s): 80 req/s arrive from 2 s to 12 s, capacity 40 req/s, then arrivals drop to 20 req/s</text>
  <text x="20" y="22" class="small">wait in queue</text>
  <path class="line bad dashed" d="M162 30 V250"/><path class="line bad dashed" d="M622 30 V250"/>
  <text x="392" y="24" text-anchor="middle" class="small">overload: 80 req/s in, 40 req/s served</text>
  <path class="line bad" d="M70 250 L162 250 L622 50 L714 70" style="stroke-width: 2.5"/>
  <path class="line ok" d="M70 250 L162 250 L208 230 L622 230 L714 250" style="stroke-width: 2.5"/>
  <text x="172" y="126" class="small">unbounded queue: +1 s of wait every second</text>
  <text x="484" y="222" text-anchor="middle" class="small">bounded queue (40 items): capped near 1 s</text>
  <text x="668" y="88" text-anchor="middle" class="small">still 9 s</text>
</svg>
<figcaption>Simple arithmetic, not a measurement: with no bound, every request during and after the spike is late, and the backlog outlives the spike. The bound trades a fast 503 for the excess against every accepted request staying fast.</figcaption>
</figure>
<p>This is Little's law at work: items in the system = arrival rate × time in the system. If you cap the number in the system and the service rate is fixed, you cap the time. A queue's job is to absorb <em>bursts</em> shorter than its size, not to hide a capacity shortfall.</p>

<h3>The strategies</h3>
<table>
  <tr><th>Strategy</th><th>What happens when full</th><th>Good for</th><th>Cost</th></tr>
  <tr><td>Block the producer</td><td>the send waits until there is room</td><td>in-process pipelines, batch jobs, reading a file faster than you can write it</td><td>blocking propagates upstream; needs a timeout or it can deadlock</td></tr>
  <tr><td>Drop newest / oldest</td><td>discard the new item, or evict the oldest one</td><td>metrics, telemetry, live video frames, UI updates where only the latest matters</td><td>silent data loss; count what you drop</td></tr>
  <tr><td>Shed load</td><td>reject immediately with <code>503</code> (server overloaded) or <code>429</code> (this client over its quota) plus <code>Retry-After</code></td><td>request/response APIs</td><td>some users see errors; clients must back off, not retry at once</td></tr>
  <tr><td>Buffer elsewhere</td><td>spill to disk or a durable broker (Kafka, SQS) and process later</td><td>work that may be late but must not be lost: orders, emails, events</td><td>only absorbs; if consumers stay too slow, lag grows forever. Monitor it.</td></tr>
  <tr><td>Signal / pull-based flow</td><td>the consumer grants credit ("send 64 KB more", <code>request(n)</code>), the producer never exceeds it</td><td>streams: TCP, HTTP/2, gRPC streaming, Reactive Streams</td><td>needs protocol support on both sides</td></tr>
  <tr><td>Sample / aggregate</td><td>keep 1 in N, or merge items into one</td><td>logs, traces, counters</td><td>loses detail by design</td></tr>
</table>

<h3>Backpressure is built into the layers below you</h3>
<ul>
  <li><strong>TCP flow control.</strong> Every ACK carries the receiver's free buffer space, the <em>receive window</em>. The sender may only have that many unacknowledged bytes in flight. If your Go server stops reading a request body, its kernel buffer fills, the window drops to zero, and the client's writes block. (Congestion control is a separate mechanism that protects the network, not the receiver.)</li>
  <li><strong>HTTP/2 flow control.</strong> Because many streams share one TCP connection, HTTP/2 adds its own windows per stream and per connection (65,535 bytes initially), refilled with <code>WINDOW_UPDATE</code> frames. One slow stream can't starve the others. gRPC streaming relies on this (see <a href="#http-2-http-3">HTTP/2 &amp; HTTP/3</a>, <a href="#grpc">gRPC</a>).</li>
  <li><strong>Reactive Streams</strong> (Java's <code>Flow</code>, RxJava, Project Reactor) make it an API rule: a subscriber calls <code>request(n)</code>, and the publisher may send at most n items until asked again.</li>
  <li><strong>Go channels.</strong> A buffered channel is a bounded queue, and a send on a full channel blocks. That is backpressure for free, as long as you don't hide it behind an unbounded slice or one goroutine per item.</li>
</ul>
<p>The gap is usually in your own code: an HTTP server that starts a goroutine for every request with no limit, or a consumer that reads from Kafka as fast as possible into an in-memory slice. Those layers absorb load without pushing back.</p>

<h3>Concurrency limits and adaptive limits</h3>
<p>For request/response services, the simplest useful bound is the number of requests <strong>in flight</strong>, not requests per second. By Little's law, a service that answers in 50 ms and should handle 2,000 requests/s needs about 100 in flight; if latency rises, a fixed in-flight cap automatically admits fewer requests per second. That is different from <a href="#rate-limiting">rate limiting</a>, which caps each client but not total load.</p>
<p>Picking the number by hand is hard, and it changes with every deploy. <strong>Adaptive concurrency limits</strong> find it at runtime, borrowing ideas from TCP congestion control: raise the limit while latency stays flat, cut it when latency rises (queuing) or requests time out. Netflix's <code>concurrency-limits</code> library (Java) is the best-known example, with algorithms such as Vegas and Gradient2, and rejects excess requests with <code>429</code> in its servlet filter or <code>UNAVAILABLE</code> in gRPC.</p>

<h2>Example</h2>
<p>Two tools in Go: a <strong>bounded worker pool</strong> (a buffered channel with fixed workers, offering both "block" and "reject" when full) and <strong>load-shedding middleware</strong> that caps requests in flight with <code>golang.org/x/sync/semaphore</code>, lets a request wait briefly for a slot, then returns a fast <code>503</code>.</p>
<pre><code>package bp

import (
	"context"
	"errors"
	"net/http"
	"time"

	"golang.org/x/sync/semaphore"
)

var ErrQueueFull = errors.New("queue full")

// Pool runs jobs on a fixed number of workers. The buffered channel is
// the bounded queue: once it is full, producers must wait or give up.
type Pool struct {
	jobs chan func()
}

func NewPool(workers, queueSize int) *Pool {
	p := &amp;Pool{jobs: make(chan func(), queueSize)}
	for range workers {
		go func() {
			for job := range p.jobs {
				job()
			}
		}()
	}
	return p
}

// TrySubmit never blocks: when the queue is full, the caller hears "no" now.
func (p *Pool) TrySubmit(job func()) error {
	select {
	case p.jobs &lt;- job:
		return nil
	default:
		return ErrQueueFull
	}
}

// Submit blocks the producer until there is room or ctx is done.
// Blocking is backpressure: a slow consumer slows the producer down.
func (p *Pool) Submit(ctx context.Context, job func()) error {
	select {
	case p.jobs &lt;- job:
		return nil
	case &lt;-ctx.Done():
		return ctx.Err()
	}
}

func (p *Pool) Close() { close(p.jobs) }

// Shed lets at most maxInFlight requests run at once. A request may wait
// up to maxWait for a slot; after that it gets a fast 503 instead of
// joining an ever-growing queue.
func Shed(maxInFlight int64, maxWait time.Duration, next http.Handler) http.Handler {
	sem := semaphore.NewWeighted(maxInFlight)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), maxWait)
		err := sem.Acquire(ctx, 1)
		cancel()
		if err != nil {
			w.Header().Set("Retry-After", "1")
			http.Error(w, "overloaded, try again shortly", http.StatusServiceUnavailable)
			return
		}
		defer sem.Release(1)
		next.ServeHTTP(w, r)
	})
}</code></pre>

<p>The tests: 12 jobs submitted to a pool with 2 workers and 5 queue slots, then a burst of 10 simultaneous requests at an API whose database pool allows 4 queries at a time (100 ms each), first without and then with <code>Shed</code>:</p>
<pre><code>func ExamplePool() {
	gate := make(chan struct{}) // holds the workers busy until we say so
	var wg sync.WaitGroup
	p := NewPool(2, 5)                // 2 workers, room for 5 waiting jobs
	time.Sleep(10 * time.Millisecond) // let both workers start and wait for jobs

	accepted, rejected := 0, 0
	for range 12 {
		wg.Add(1)
		if err := p.TrySubmit(func() { &lt;-gate; wg.Done() }); err != nil {
			wg.Done()
			rejected++
			continue
		}
		accepted++
	}
	fmt.Printf("TrySubmit x12: accepted %d (2 running + 5 queued), rejected %d&#92;n", accepted, rejected)

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	start := time.Now()
	err := p.Submit(ctx, func() {})
	fmt.Printf("Submit while full: blocked %v, then: %v&#92;n", time.Since(start).Round(50*time.Millisecond), err)

	close(gate)
	wg.Wait()
	p.Close()
	fmt.Println("all accepted jobs finished; nothing was lost silently")
}

func ExampleShed() {
	// The bottleneck: a database pool with 4 connections, 100 ms per query.
	db := semaphore.NewWeighted(4)
	api := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := db.Acquire(r.Context(), 1); err != nil {
			return
		}
		time.Sleep(100 * time.Millisecond)
		db.Release(1)
		fmt.Fprintln(w, "ok")
	})

	burst := func(name string, h http.Handler) {
		srv := httptest.NewServer(h)
		defer srv.Close()
		type result struct {
			code int
			took time.Duration
		}
		var mu sync.Mutex
		var results []result
		var wg sync.WaitGroup
		for range 10 { // 10 requests arrive at the same moment
			wg.Add(1)
			go func() {
				defer wg.Done()
				start := time.Now()
				resp, err := http.Get(srv.URL)
				if err != nil {
					panic(err)
				}
				resp.Body.Close()
				mu.Lock()
				results = append(results, result{resp.StatusCode, time.Since(start)})
				mu.Unlock()
			}()
		}
		wg.Wait()
		sort.Slice(results, func(i, j int) bool { return results[i].took &lt; results[j].took })
		// Group by status and latency, truncated to 100 ms so runs compare.
		fmt.Println(name)
		for i := 0; i &lt; len(results); {
			r, n := results[i], 0
			bucket := r.took.Truncate(100 * time.Millisecond)
			for ; i &lt; len(results) &amp;&amp; results[i].code == r.code &amp;&amp;
				results[i].took.Truncate(100*time.Millisecond) == bucket; i++ {
				n++
			}
			when := fmt.Sprintf("in %v-%v", bucket, bucket+100*time.Millisecond)
			if bucket == 0 {
				when = "in under 100ms"
			}
			fmt.Printf("  %2d x %d  %s&#92;n", n, r.code, when)
		}
	}

	burst("no limit: everyone queues for the 4 DB connections", api)
	burst("Shed(4 in flight, wait up to 20ms):", Shed(4, 20*time.Millisecond, api))
}</code></pre>

<p>Real output from <code>go test</code> (latencies grouped into 100 ms buckets so the run is repeatable; the test pins this output):</p>
<pre><code>TrySubmit x12: accepted 7 (2 running + 5 queued), rejected 5
Submit while full: blocked 50ms, then: context deadline exceeded
all accepted jobs finished; nothing was lost silently

no limit: everyone queues for the 4 DB connections
   4 x 200  in 100ms-200ms
   4 x 200  in 200ms-300ms
   2 x 200  in 300ms-400ms
Shed(4 in flight, wait up to 20ms):
   6 x 503  in under 100ms
   4 x 200  in 100ms-200ms</code></pre>
<ul>
  <li><strong>The pool</strong> accepts exactly what it can hold: 2 jobs running and 5 queued. The other 5 producers are told "queue full" at once and can choose to retry later, drop the job, or report an error. <code>Submit</code> instead blocks the producer and gives up when its context expires.</li>
  <li><strong>Without a limit</strong>, all 10 requests are accepted and queue for the 4 database connections. The last two wait 300 ms or more. Scale that to thousands of requests and the tail is seconds long.</li>
  <li><strong>With <code>Shed</code></strong>, 4 requests run and finish in about 100 ms. The other 6 wait at most 20 ms and get a <code>503</code> with <code>Retry-After: 1</code>. Nobody waits in a hidden queue.</li>
</ul>

<p><strong>Real-world scenario.</strong> At 09:00 a marketing email lands and traffic to an API jumps from 300 to 1,200 requests per second. The database can serve about 600 per second. Without backpressure, the Go server accepts everything: goroutines and memory climb, p99 latency goes from 120 ms to many seconds, mobile clients time out at 5 s and retry, and the server spends its database time on requests whose clients have already gone. With an in-flight cap sized to what the database can do, roughly half the requests get a fast <code>503</code> during the peak, the clients back off with jitter (see <a href="#exponential-backoff">Exponential Backoff</a>), and every accepted request keeps its normal latency. Meanwhile <a href="#autoscaling">autoscaling</a> adds capacity, and the shed rate falls back to zero.</p>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>Unbounded anything.</strong> <code>go handle(req)</code> for every request, a slice used as a queue, a channel "big enough for any load". Each one removes backpressure. Every queue needs a bound and a policy for when it is reached.</li>
  <li><strong>Buffers that are too big.</strong> A 100,000-item queue in front of a service that does 100 items/s is a 1,000-second wait. Size queues in <em>time</em> ("at most 1 s of work"), not in items.</li>
  <li><strong>Shedding too late.</strong> Rejecting a request after parsing it, authenticating it and opening a DB transaction saves little. Shed as early and as cheaply as possible: at the load balancer, gateway, or first middleware.</li>
  <li><strong>Shedding the wrong work.</strong> When you must drop, drop the cheap-to-retry and less important work first: background sync and batch jobs before checkout. Prioritised limits do this explicitly.</li>
  <li><strong>Clients that retry instantly.</strong> A <code>503</code> answered with an immediate retry doubles the load. Send <code>Retry-After</code>, and make clients use backoff with jitter and a retry budget (see <a href="#retries">Retries</a>).</li>
  <li><strong>Blocking without a timeout.</strong> A producer blocked forever on a full channel is a goroutine leak or a deadlock. Pair every blocking send with a <code>context</code>.</li>
  <li><strong>Dropping silently.</strong> Dropped items and shed requests must be counted and graphed (see <a href="#metrics">Metrics</a>). A rising shed rate is your earliest signal that you need more capacity.</li>
</ul>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>When producers outrun consumers, the excess becomes queue, then latency, then memory. Backpressure makes the limit explicit.</li>
  <li>Bound every queue, sized in time, and choose a policy: block, drop, shed, buffer durably, or signal the producer.</li>
  <li>For APIs, cap requests in flight and shed early with a fast <code>503</code> + <code>Retry-After</code>; consider adaptive limits.</li>
  <li>TCP, HTTP/2 and Go channels already push back. Don't defeat them with unbounded goroutines or buffers in your own code.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#rate-limiting">Rate Limiting</a> · <a href="#message-queues">Message Queues</a> · <a href="#circuit-breakers">Circuit Breakers</a> · <a href="#autoscaling">Autoscaling</a> · <a href="#throughput">Throughput</a> · <a href="#real-world-resilience-playbook">Real-World Resilience Playbook</a></p>
`;
CONTENT["real-world-resilience-playbook"] = `
<p class="tldr"><strong>TL;DR</strong>: Each resilience pattern answers one kind of failure. Timeouts bound how long you wait. Retries with jittered backoff absorb short blips. A circuit breaker stops you from calling something that is down. An idempotency key makes a retried payment safe. Load shedding at the front door keeps a spike from sinking everything. This page wires all of them into one checkout call and replays an incident with and without them. Think of a ship: bulkheads, pumps and lifeboats each handle a different emergency, and they only help if they're in the right place before the storm.</p>

<h2>The problem it solves</h2>
<p>A checkout is a chain of remote calls: the client calls your API, the API reserves stock in the inventory service, and then charges the card through an external payments provider. Every link can fail in a different way. It can be slow or refuse connections. It can return a 503 for one second. It can time out <em>after</em> doing the work. Or it can be buried under more traffic than it can take. Each sibling page in this group fixes one of these. In production you need all of them at once, and they interact. If retries sit at the wrong layer, they multiply. A breaker that counts the wrong errors trips for no reason. A timeout longer than its caller's does work nobody is waiting for. And a fallback can hide an outage from the people who should be fixing it.</p>
<p>The worst failures come from slowness, not from errors. A provider that answers "no" in 5 ms is easy. A provider that takes 8 seconds to answer holds a goroutine, a connection and maybe a database transaction for each request, and those pile up until the service runs out of them. Then pages that have nothing to do with payments start failing too. That's a <strong>cascading failure</strong>, and stopping it is what this playbook is for.</p>

<h2>How it works: one checkout through the patterns</h2>
<figure class="diagram">
<svg viewBox="0 0 780 300" role="img" aria-label="Checkout call chain. The client calls the API entry, which sheds load above 64 requests in flight and sets a 5 second deadline. The checkout handler calls an inventory client with its own breaker and 300 millisecond timeout, and a payments client with its own breaker, up to 3 jittered attempts, a 2 second timeout per attempt and an Idempotency-Key, which calls the external provider. On failure, the order goes to a payment pending queue whose worker retries later through the payments client with the same key.">
  <defs><marker id="arr-rrp-1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <rect class="box" x="10" y="60" width="120" height="90" rx="10"/>
  <text x="70" y="84" text-anchor="middle" class="title">1 Client</text>
  <text x="70" y="104" text-anchor="middle" class="small">mobile app</text>
  <text x="70" y="119" text-anchor="middle" class="small">10 s timeout</text>
  <text x="70" y="134" text-anchor="middle" class="small">retries 503 only</text>
  <path class="line" d="M130 105 H148" marker-end="url(#arr-rrp-1)"/>
  <rect class="box accent" x="150" y="60" width="140" height="90" rx="10"/>
  <text x="220" y="84" text-anchor="middle" class="title">2 API entry</text>
  <text x="220" y="104" text-anchor="middle" class="small">shed above 64</text>
  <text x="220" y="119" text-anchor="middle" class="small">in flight: 503</text>
  <text x="220" y="134" text-anchor="middle" class="small">deadline: 5 s</text>
  <path class="line" d="M290 105 H308" marker-end="url(#arr-rrp-1)"/>
  <rect class="box" x="310" y="60" width="140" height="90" rx="10"/>
  <text x="380" y="84" text-anchor="middle" class="title">3 Checkout</text>
  <text x="380" y="104" text-anchor="middle" class="small">reserve stock</text>
  <text x="380" y="119" text-anchor="middle" class="small">charge card</text>
  <text x="380" y="134" text-anchor="middle" class="small">else: pending</text>
  <path class="line" d="M450 80 H468 V55 H488" marker-end="url(#arr-rrp-1)"/>
  <path class="line" d="M450 130 H468 V160 H488" marker-end="url(#arr-rrp-1)"/>
  <rect class="box accent" x="490" y="20" width="140" height="70" rx="10"/>
  <text x="560" y="42" text-anchor="middle" class="title">inventory client</text>
  <text x="560" y="62" text-anchor="middle" class="small">breaker · 300 ms</text>
  <text x="560" y="77" text-anchor="middle" class="small">1 retry, keyed</text>
  <path class="line" d="M630 55 H658" marker-end="url(#arr-rrp-1)"/>
  <rect class="box ok" x="660" y="20" width="110" height="70" rx="10"/>
  <text x="715" y="50" text-anchor="middle" class="title">Inventory</text>
  <text x="715" y="70" text-anchor="middle" class="small">internal service</text>
  <rect class="box accent" x="490" y="108" width="140" height="112" rx="10"/>
  <text x="560" y="130" text-anchor="middle" class="title">payments client</text>
  <text x="560" y="150" text-anchor="middle" class="small">breaker "payments"</text>
  <text x="560" y="166" text-anchor="middle" class="small">≤ 3 attempts, jittered</text>
  <text x="560" y="182" text-anchor="middle" class="small">2 s per attempt</text>
  <text x="560" y="198" text-anchor="middle" class="small">Idempotency-Key</text>
  <path class="line" d="M630 164 H658" marker-end="url(#arr-rrp-1)"/>
  <rect class="box ok" x="660" y="129" width="110" height="70" rx="10"/>
  <text x="715" y="159" text-anchor="middle" class="title">Provider</text>
  <text x="715" y="179" text-anchor="middle" class="small">external API</text>
  <path class="line dashed" d="M380 150 V198" marker-end="url(#arr-rrp-1)"/>
  <text x="388" y="180" class="small">on failure</text>
  <rect class="box muted" x="310" y="200" width="140" height="60" rx="10"/>
  <text x="380" y="222" text-anchor="middle" class="title">pending queue</text>
  <text x="380" y="242" text-anchor="middle" class="small">worker, same key</text>
  <path class="line dashed" d="M450 210 H488" marker-end="url(#arr-rrp-1)"/>
  <text x="390" y="288" text-anchor="middle" class="small">Each failure is retried by one layer only: the client retries the API's 503s, the payments client retries the provider's.</text>
</svg>
<figcaption>Load shedding and the deadline live at the entry. Breakers, retries and per-attempt timeouts live in the client of each dependency, one set per dependency. The idempotency key belongs to the order, so every attempt and the later worker retry send the same one.</figcaption>
</figure>

<p>Each sibling page owns one part of this picture:</p>
<ol>
  <li><strong>How long to wait</strong>: <a href="#timeouts">Timeouts</a> covers connect, read and total timeouts, Go's <code>http.Client</code> and <code>http.Server</code> fields, and passing a deadline down with <code>context</code>.</li>
  <li><strong>When to try again</strong>: <a href="#retries">Retries</a> covers which errors are transient, retry budgets and amplification across layers.</li>
  <li><strong>How long to wait between tries</strong>: <a href="#exponential-backoff">Exponential Backoff</a> covers the formula, the cap and full, equal and decorrelated jitter.</li>
  <li><strong>When to stop trying</strong>: <a href="#circuit-breakers">Circuit Breakers</a> covers the closed, open and half-open states, trip conditions and fallbacks.</li>
  <li><strong>Making a repeat harmless</strong>: <a href="#idempotency">Idempotency</a> covers idempotency keys, request hashes and replayed responses.</li>
  <li><strong>Saying no when full</strong>: <a href="#backpressure">Backpressure</a> covers bounded queues, concurrency limits and load shedding.</li>
</ol>

<h3>The order of the wrappers</h3>
<p>Inside the payments client, the patterns wrap each other in a fixed order. Change the order and the behaviour changes, so pick one on purpose.</p>
<figure class="diagram">
<svg viewBox="0 0 780 250" role="img" aria-label="Nested wrappers. The outer box is the request deadline of 5 seconds, set at the entry. Inside it, the payments circuit breaker, which counts one sample per checkout and makes zero attempts when open. Inside that, the retry loop with up to 3 attempts, full-jitter backoff, stopping when the remaining budget can't fit another attempt. Inside that, attempt 1 and attempt 2, each with a 2 second timeout and the same Idempotency-Key header.">
  <rect class="box muted" x="20" y="14" width="740" height="222" rx="12"/>
  <text x="36" y="36" class="title">Request deadline: 5 s (context.WithTimeout at the entry)</text>
  <rect class="box bad" x="50" y="48" width="680" height="178" rx="10"/>
  <text x="66" y="70" class="title">Circuit breaker "payments": one sample per checkout; open → 0 attempts</text>
  <rect class="box accent" x="80" y="82" width="620" height="134" rx="10"/>
  <text x="96" y="104" class="title">Retry loop: ≤ 3 attempts, full-jitter backoff</text>
  <text x="96" y="122" class="small">stops early when the time left can't fit backoff + one more attempt</text>
  <rect class="box ok" x="110" y="136" width="270" height="66" rx="8"/>
  <text x="245" y="158" text-anchor="middle" class="title">attempt 1: 2 s timeout</text>
  <text x="245" y="178" text-anchor="middle" class="small">POST /charges</text>
  <text x="245" y="193" text-anchor="middle" class="small">Idempotency-Key: order-2001</text>
  <path class="line dashed" d="M380 169 H408" marker-end="url(#arr-rrp-2)"/>
  <text x="394" y="160" text-anchor="middle" class="small">wait</text>
  <rect class="box ok" x="410" y="136" width="270" height="66" rx="8"/>
  <text x="545" y="158" text-anchor="middle" class="title">attempt 2: 2 s timeout</text>
  <text x="545" y="178" text-anchor="middle" class="small">POST /charges</text>
  <text x="545" y="193" text-anchor="middle" class="small">Idempotency-Key: order-2001 (same)</text>
  <defs><marker id="arr-rrp-2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
</svg>
<figcaption>Outside in: the deadline caps everything, the breaker decides whether to try at all, the retry loop decides how many times, and each attempt has its own smaller timeout. Two 2 s attempts plus backoff fit inside 5 s; a third only runs if the first two failed fast.</figcaption>
</figure>
<p>Here the breaker sits <em>outside</em> the retry loop. A checkout that needed three attempts counts as one failure or one success, and an open breaker means no attempts at all. The other common order, retry outside the breaker, is the default aspect order in resilience4j (<code>Retry(CircuitBreaker(…))</code>). There every attempt is a sample, and the retry policy must treat "breaker open" as a final answer, or it just burns its attempts against the open breaker. Both orders work. The bug is not knowing which one you have.</p>

<h3>Which pattern answers which failure</h3>
<table>
  <tr><th>Failure</th><th>What you see</th><th>Pattern that answers it</th><th>Without it</th></tr>
  <tr><td>A dependency gets slow</td><td>p99 goes from 200 ms to 8 s</td><td><a href="#timeouts">Timeout</a> per attempt, deadline per request; then a <a href="#circuit-breakers">breaker</a> on slow calls</td><td>goroutines, connections and DB transactions pile up; unrelated pages fail</td></tr>
  <tr><td>A dependency is down</td><td>connection refused, 5xx on every call</td><td><a href="#circuit-breakers">Breaker</a> + a fallback</td><td>every request pays a timeout to learn the same thing</td></tr>
  <tr><td>A brief blip</td><td>one 503, a reset connection</td><td><a href="#retries">Retry</a> with <a href="#exponential-backoff">jittered backoff</a></td><td>users see errors for a 100 ms hiccup</td></tr>
  <tr><td>An unknown outcome</td><td>timeout after the provider charged the card</td><td><a href="#idempotency">Idempotency key</a> + retry or reconcile with the same key</td><td>a retry charges twice; no retry loses the order</td></tr>
  <tr><td>More traffic than capacity</td><td>in-flight count and latency climb together</td><td><a href="#backpressure">Load shedding</a> at the entry; <a href="#rate-limiting">rate limits</a> per client</td><td>queues grow, every request gets slow, then memory runs out</td></tr>
  <tr><td>Everyone retries at once</td><td>load spikes right after an outage ends</td><td>Jitter, a retry budget, few half-open probes</td><td>the recovering service gets knocked over again</td></tr>
  <tr><td>The caller already gave up</td><td>work continues for a request with no one waiting</td><td>Deadline propagation through <code>context</code></td><td>capacity spent on answers nobody reads</td></tr>
</table>

<h2>An incident, with and without the playbook</h2>
<p>Say checkout gets 200 requests per second across 4 API pods, 50 per pod. Normally the payments provider answers in about 150 ms on average, so each pod has around 50 × 0.15 ≈ 8 checkouts in flight (Little's law: in flight = rate × latency). At 14:05:00 the provider's p99 goes from 200 ms to 8 s. At 8 s, the same pod would need 50 × 8 = 400 checkouts in flight to keep up.</p>
<figure class="diagram">
<svg viewBox="0 0 780 404" role="img" aria-label="Incident timeline comparing two versions of the same service after the payments provider slows to 8 seconds at 14:05. Without patterns: calls hang, the database pool is exhausted, client and API retries multiply calls by 9, pods restart, recovery is slow and some customers are charged twice. With patterns: attempts time out at 2 seconds, load shedding caps in-flight work at 64 per pod, the breaker opens at about 14:05:10 and checkouts return payment pending, a half-open probe fails and it reopens, at 14:20 the probe succeeds and the breaker closes, and the pending worker replays the same keys so no one is charged twice.">
  <rect class="box bad" x="100" y="14" width="330" height="30" rx="8"/>
  <text x="265" y="34" text-anchor="middle" class="title">Without the playbook</text>
  <rect class="box ok" x="450" y="14" width="320" height="30" rx="8"/>
  <text x="610" y="34" text-anchor="middle" class="title">With the playbook</text>
  <path class="line" d="M50 84 V392"/>
  <text x="50" y="70" text-anchor="middle" class="title">14:05:00</text>
  <text x="440" y="70" text-anchor="middle">The payments provider's p99 goes from 200 ms to 8 s.</text>
  <ellipse class="box accent" cx="50" cy="104" rx="6" ry="6"/>
  <text x="62" y="96" class="small">:01</text>
  <text x="110" y="100" class="small">Calls hang: a zero-value http.Client has no</text>
  <text x="110" y="115" class="small">timeout. Each one holds a DB transaction open.</text>
  <text x="460" y="100" class="small">Each attempt gives up at 2 s, waits a jittered</text>
  <text x="460" y="115" class="small">backoff, tries once more with the same key.</text>
  <ellipse class="box accent" cx="50" cy="154" rx="6" ry="6"/>
  <text x="62" y="146" class="small">:03</text>
  <text x="110" y="150" class="small">The 50-connection DB pool is used up. Product</text>
  <text x="110" y="165" class="small">pages wait for the pool too: the site is down.</text>
  <text x="460" y="150" class="small">In flight hits 64 per pod. Extra checkouts get</text>
  <text x="460" y="165" class="small">503 + Retry-After in a few ms. Browsing is fine.</text>
  <ellipse class="box accent" cx="50" cy="204" rx="6" ry="6"/>
  <text x="62" y="196" class="small">:10</text>
  <text x="110" y="200" class="small">Apps time out at 10 s and retry 3×, the API</text>
  <text x="110" y="215" class="small">retries 3×: up to 9 provider calls per tap.</text>
  <text x="460" y="200" class="small">≥ 50% of 20+ calls failed: the breaker opens.</text>
  <text x="460" y="215" class="small">Checkout answers 202 payment_pending in ~1 ms.</text>
  <ellipse class="box accent" cx="50" cy="254" rx="6" ry="6"/>
  <text x="62" y="246" class="small">:40</text>
  <text x="110" y="250" class="small">The provider drowns in retries. Pods fail health</text>
  <text x="110" y="265" class="small">checks and restart, dropping in-flight orders.</text>
  <text x="460" y="250" class="small">Half-open: one probe, still slow, so the breaker</text>
  <text x="460" y="265" class="small">opens for another 30 s. Repeats until recovery.</text>
  <ellipse class="box ok" cx="50" cy="304" rx="6" ry="6"/>
  <text x="62" y="296" class="small">14:20</text>
  <text x="110" y="300" class="small">The provider recovers, then is hit by restarted</text>
  <text x="110" y="315" class="small">pods and every app retrying in sync.</text>
  <text x="460" y="300" class="small">A probe succeeds: the breaker closes. The worker</text>
  <text x="460" y="315" class="small">drains the pending queue at a fixed, slow rate.</text>
  <ellipse class="box ok" cx="50" cy="354" rx="6" ry="6"/>
  <text x="62" y="346" class="small">after</text>
  <text x="110" y="350" class="small">Retries without a key charged some customers</text>
  <text x="110" y="365" class="small">twice. Support issues refunds by hand.</text>
  <text x="460" y="350" class="small">Timed-out orders replay their key: the provider</text>
  <text x="460" y="365" class="small">returns the existing charge. One charge per order.</text>
  <path d="M440 84 V384" style="stroke: var(--line)"/>
</svg>
<figcaption>The same 15-minute provider slowdown. Without limits, slowness spreads: a payments problem becomes a database problem, then a whole-site outage, then duplicate charges. With the playbook it stays a payments problem: checkouts are delayed, not lost, and the rest of the site never notices.</figcaption>
</figure>
<p>The first 10 seconds are the hard part even with the playbook. Until the breaker has seen enough failures, each checkout costs two 2-second attempts, so a pod needs about 50 × 4 = 200 slots and has 64. For those seconds, shedding rejects roughly two thirds of checkouts with a fast 503. That's the point: a fast "try again in a second" from 4 pods is far better than a slow "maybe" that takes the database down with it. A breaker that also trips on slow calls (resilience4j can trip on a slow-call rate, for example) shortens this window.</p>
<div class="callout warn"><strong>A fallback only works if the business accepts it.</strong> "Payment pending, we'll email you" is fine for a shop that ships the next day. It is not fine for a concert ticket that must be paid before it's issued. There the honest fallback is a fast "payments are down, try again in a few minutes", and the breaker still saves you from the cascade.</div>

<h3>Defaults to start with</h3>
<p>These are starting points to tune from your own <a href="#metrics">metrics</a>, not universal truths. The ones that come from a named source say so.</p>
<table>
  <tr><th>Setting</th><th>Start with</th><th>Why, and how to tune</th></tr>
  <tr><td>Client timeout</td><td>longer than the API's deadline (e.g. 10 s)</td><td>the outer layer must wait longer than the inner one, or it gives up on work that is still running</td></tr>
  <tr><td>Request deadline at the entry</td><td>e.g. 5 s for checkout, set once with <code>context.WithTimeout</code></td><td>everything below gets what's left of it; inner budgets are always smaller</td></tr>
  <tr><td>Per-attempt timeout</td><td>near the dependency's p99.9</td><td>the AWS Builders' Library picks an acceptable false-timeout rate (their example: 0.1%) and uses that percentile of the downstream latency</td></tr>
  <tr><td>Attempts per call</td><td>3 at most, including the first</td><td>Google's SRE book uses "up to three attempts" per request; gRPC caps <code>maxAttempts</code> at 5</td></tr>
  <tr><td>Backoff</td><td>base 100 ms, cap 1 s, full jitter</td><td>spreads retries out; see <a href="#exponential-backoff">Exponential Backoff</a></td></tr>
  <tr><td>Retry budget</td><td>retries ≤ 10% of requests</td><td>the SRE book only retries while the retry ratio stays below 10%; the AWS SDKs use a token bucket for the same reason</td></tr>
  <tr><td>Breaker trip</td><td>≥ 50% failures over ≥ 20 calls in a 10 s window</td><td>the minimum call count stops 1 failure out of 2 from tripping it at night. gobreaker's default is more than 5 consecutive failures</td></tr>
  <tr><td>Breaker open period</td><td>10–30 s, then 1–3 half-open probes</td><td>gobreaker defaults to 60 s open and 1 half-open request; shorter means faster recovery, more probes against a sick service</td></tr>
  <tr><td>Max in flight per pod</td><td>≈ peak rate per pod × p99 latency × 2</td><td>Little's law plus headroom; shed above it with 503 + <code>Retry-After</code></td></tr>
  <tr><td>Idempotency key</td><td>one per order, not per attempt; keep it ≥ 24 h</td><td>Stripe keeps keys for at least 24 hours and accepts up to 255 characters</td></tr>
</table>

<h2>Example</h2>
<p><strong>The checkout service in Go.</strong> The entry sheds load with a buffered channel used as a semaphore and sets the request deadline. The payments client composes the rest: deadline → breaker (<code>github.com/sony/gobreaker/v2</code>) → retry loop with full-jitter backoff → one HTTP attempt with its own timeout and the order's <code>Idempotency-Key</code>. A declined card (4xx) counts as a <em>success</em> for the breaker, because the provider worked fine. A cancelled request is excluded, because the client left, not the provider. When the charge fails for any other reason, the order goes to a pending queue and the client gets <code>202 payment_pending</code>.</p>
<pre><code>package checkout

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand/v2"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/sony/gobreaker/v2"
)

type Config struct {
	RequestBudget  time.Duration // whole checkout, set once at the entry
	AttemptTimeout time.Duration // one HTTP attempt to the provider
	MaxAttempts    int
	BaseBackoff    time.Duration
	MaxBackoff     time.Duration
	BreakerOpenFor time.Duration
	MaxInFlight    int // entry load shedding
}

var (
	errRetryable = errors.New("retryable")
	errDeclined  = errors.New("card declined") // a 4xx: our answer, not an outage
)

type PaymentClient struct {
	cfg  Config
	url  string
	http *http.Client
	cb   *gobreaker.CircuitBreaker[string]
}

func NewPaymentClient(url string, cfg Config, onState func(from, to gobreaker.State)) *PaymentClient {
	cb := gobreaker.NewCircuitBreaker[string](gobreaker.Settings{
		Name:        "payments",
		MaxRequests: 1,                // half-open: one probe at a time
		Interval:    10 * time.Second, // closed-state counting window
		Timeout:     cfg.BreakerOpenFor,
		ReadyToTrip: func(c gobreaker.Counts) bool {
			return c.Requests &gt;= 5 &amp;&amp; c.TotalFailures*2 &gt;= c.Requests // ≥50% of ≥5 calls
		},
		IsSuccessful: func(err error) bool { return err == nil || errors.Is(err, errDeclined) },
		IsExcluded:   func(err error) bool { return errors.Is(err, context.Canceled) }, // caller left
		OnStateChange: func(_ string, from, to gobreaker.State) {
			if onState != nil {
				onState(from, to)
			}
		},
	})
	return &amp;PaymentClient{cfg: cfg, url: url, http: &amp;http.Client{}, cb: cb}
}

// Charge: breaker outside, retries inside. One checkout = one breaker sample,
// and an open breaker means zero attempts, not three fast failures.
func (p *PaymentClient) Charge(ctx context.Context, orderID string, cents int64) (string, error) {
	return p.cb.Execute(func() (string, error) {
		return p.chargeWithRetry(ctx, "order-"+orderID, cents)
	})
}

func (p *PaymentClient) chargeWithRetry(ctx context.Context, key string, cents int64) (string, error) {
	var err error
	for attempt := 1; attempt &lt;= p.cfg.MaxAttempts; attempt++ {
		var id string
		var retryAfter time.Duration
		id, retryAfter, err = p.once(ctx, key, cents) // same key on every attempt
		if err == nil {
			return id, nil
		}
		if !errors.Is(err, errRetryable) || attempt == p.cfg.MaxAttempts {
			return "", err
		}
		wait := max(retryAfter, fullJitter(p.cfg.BaseBackoff, p.cfg.MaxBackoff, attempt))
		if dl, ok := ctx.Deadline(); ok &amp;&amp; time.Until(dl) &lt; wait+p.cfg.AttemptTimeout {
			return "", err // not enough budget left for a whole attempt: stop now
		}
		select {
		case &lt;-time.After(wait):
		case &lt;-ctx.Done():
			return "", ctx.Err()
		}
	}
	return "", err
}

// fullJitter: random in [0, min(cap, base·2^(attempt-1))).
func fullJitter(base, maxBackoff time.Duration, attempt int) time.Duration {
	return rand.N(min(maxBackoff, base&lt;&lt;(attempt-1)))
}

func (p *PaymentClient) once(ctx context.Context, key string, cents int64) (string, time.Duration, error) {
	actx, cancel := context.WithTimeout(ctx, p.cfg.AttemptTimeout)
	defer cancel()
	body := strings.NewReader(fmt.Sprintf(&#96;{"amount":%d,"currency":"usd"}&#96;, cents))
	req, err := http.NewRequestWithContext(actx, http.MethodPost, p.url+"/charges", body)
	if err != nil {
		return "", 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", key)
	resp, err := p.http.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return "", 0, ctx.Err() // the whole budget is gone, not just this attempt
		}
		return "", 0, fmt.Errorf("%w: %w", errRetryable, err) // attempt timeout, conn reset
	}
	defer resp.Body.Close()
	switch {
	case resp.StatusCode &lt; 300:
		var out struct{ ID string }
		err := json.NewDecoder(resp.Body).Decode(&amp;out)
		return out.ID, 0, err
	case resp.StatusCode == 409 || resp.StatusCode == 429 || // 409: same key still in flight
		resp.StatusCode == 502 || resp.StatusCode == 503 || resp.StatusCode == 504:
		secs, _ := strconv.Atoi(resp.Header.Get("Retry-After"))
		return "", time.Duration(secs) * time.Second,
			fmt.Errorf("%w: status %d", errRetryable, resp.StatusCode)
	case resp.StatusCode &lt; 500:
		return "", 0, errDeclined
	default:
		return "", 0, fmt.Errorf("payments: status %d", resp.StatusCode)
	}
}

type Server struct {
	cfg     Config
	slots   chan struct{}
	pay     *PaymentClient
	pending func(orderID string) // queue: a worker charges later with the same key
}

func NewServer(cfg Config, pay *PaymentClient, pending func(string)) *Server {
	return &amp;Server{cfg: cfg, slots: make(chan struct{}, cfg.MaxInFlight), pay: pay, pending: pending}
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	select { // backpressure at the door: reject fast instead of queueing forever
	case s.slots &lt;- struct{}{}:
		defer func() { &lt;-s.slots }()
	default:
		w.Header().Set("Retry-After", "1")
		http.Error(w, "overloaded", http.StatusServiceUnavailable)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.RequestBudget)
	defer cancel()

	orderID := r.URL.Query().Get("order")
	// Inventory reservation goes here, with its own breaker and timeout.
	chargeID, err := s.pay.Charge(ctx, orderID, 4999)
	w.Header().Set("Content-Type", "application/json")
	switch {
	case err == nil:
		json.NewEncoder(w).Encode(map[string]string{"status": "paid", "charge": chargeID})
	case errors.Is(err, errDeclined):
		w.WriteHeader(http.StatusPaymentRequired)
		json.NewEncoder(w).Encode(map[string]string{"status": "declined"})
	default: // breaker open, timeout, provider down: outcome unknown or not tried
		s.pending(orderID)
		w.WriteHeader(http.StatusAccepted)
		json.NewEncoder(w).Encode(map[string]string{"status": "payment_pending", "reason": reason(err)})
	}
}

func reason(err error) string {
	switch {
	case errors.Is(err, gobreaker.ErrOpenState), errors.Is(err, gobreaker.ErrTooManyRequests):
		return "breaker_open"
	case errors.Is(err, context.DeadlineExceeded):
		return "timeout"
	default:
		return "provider_error"
	}
}</code></pre>

<p><strong>The test.</strong> A fake provider built on <code>httptest</code> behaves like a real payments API. It stores one charge per <code>Idempotency-Key</code> and replays it on a repeat. It records the charge <em>before</em> sending its reply, so a slow reply means "charged, but the caller doesn't know yet". Timings are scaled down so the test runs in a few seconds:</p>
<pre><code>var cfg = Config{
	RequestBudget:  600 * time.Millisecond,
	AttemptTimeout: 200 * time.Millisecond,
	MaxAttempts:    3,
	BaseBackoff:    20 * time.Millisecond,
	MaxBackoff:     100 * time.Millisecond,
	BreakerOpenFor: 500 * time.Millisecond,
	MaxInFlight:    4,
}</code></pre>
<p>Real output of <code>go test -v</code>. It covers a transient 503, a reply that arrives after the attempt timeout, a provider that slows to 2 s per call, its recovery, the pending worker, and a burst of 10 concurrent checkouts:</p>
<pre><code>== a 503, then success
  200 {"charge":"ch_1","status":"paid"}  provider requests=2 charges=1
== provider charged, but the reply came after our 200 ms attempt timeout
  200 {"charge":"ch_2","status":"paid"}  provider requests=4 charges=2
== provider slows to 2 s per call
  order 2001: 202 {"reason":"timeout","status":"payment_pending"}  took=400ms attempts=2
  order 2002: 202 {"reason":"timeout","status":"payment_pending"}  took=400ms attempts=2
  order 2003: 202 {"reason":"timeout","status":"payment_pending"}  took=400ms attempts=2
  order 2004: 202 {"reason":"timeout","status":"payment_pending"}  took=400ms attempts=2
  [t=2.1s] breaker payments: closed -&gt; open
  order 2005: 202 {"reason":"timeout","status":"payment_pending"}  took=400ms attempts=2
  order 2006: 202 {"reason":"breaker_open","status":"payment_pending"}  took=0ms attempts=0
  order 2007: 202 {"reason":"breaker_open","status":"payment_pending"}  took=0ms attempts=0
  order 2008: 202 {"reason":"breaker_open","status":"payment_pending"}  took=0ms attempts=0
== provider recovers; wait out the open period
  [t=2.7s] breaker payments: open -&gt; half-open
  [t=2.7s] breaker payments: half-open -&gt; closed
  order 2009: 200 {"charge":"ch_6","status":"paid"}
== pending worker retries 8 orders with their original keys
  order 2001 -&gt; ch_1 ok
  order 2002 -&gt; ch_2 ok
  order 2003 -&gt; ch_3 ok
  order 2004 -&gt; ch_4 ok
  order 2005 -&gt; ch_5 ok
  order 2006 -&gt; ch_7 ok
  order 2007 -&gt; ch_8 ok
  order 2008 -&gt; ch_9 ok
  unique charges: 6 before the worker, 9 after (one per order)
== 10 concurrent checkouts, MaxInFlight=4, provider takes 100 ms
  map[200 in 100ms:4 503 in 0ms:6]</code></pre>
<p>Things to notice:</p>
<ul>
  <li><strong>The retry used the same key.</strong> Order 1002's first attempt timed out after the provider had already charged. The second attempt replayed the key and got <code>ch_2</code> back: 2 requests, 1 charge.</li>
  <li><strong>Slowness became fast failure.</strong> While the breaker was closed, each checkout spent about 400 ms (two 200 ms attempts) and then gave up with budget left over, because a third attempt wouldn't fit. Once 5 calls had failed (the trip rule uses 5 calls so the test stays short; production would use the 20 from the table above), the breaker opened and checkouts answered in under a millisecond without touching the provider.</li>
  <li><strong>The half-open probe is lazy.</strong> gobreaker moves from open to half-open when the next call arrives after the open period, not on a timer. That one call was the probe; it succeeded, so the breaker closed.</li>
  <li><strong>No double charges.</strong> Orders 2001–2005 had timed out, but the provider had charged them. The worker's retries with the original keys got <code>ch_1</code>–<code>ch_5</code> back. Only 2006–2008, which never reached the provider, created new charges.</li>
  <li><strong>Shedding is instant.</strong> With 4 slots, 4 checkouts took 100 ms and 6 were rejected in 0 ms with a 503, instead of queueing behind them.</li>
</ul>


<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>Retry and breaker fighting each other.</strong> If the retry loop is outside the breaker and treats "breaker open" as retryable, every request spins through its attempts against an open breaker. If the breaker is outside, one checkout is one sample, so it trips after more failed attempts. Choose an order, and never retry <code>ErrOpenState</code>.</li>
  <li><strong>Timeouts longer than the caller's.</strong> An API that waits 30 s on a provider while the app gives up at 10 s keeps working for nobody. Set the deadline once at the entry and derive every inner timeout from what's left (<code>ctx</code> does this for you).</li>
  <li><strong>Retrying non-idempotent calls.</strong> A POST that creates a charge is only safe to retry with an idempotency key. The key must be fixed per order. A new UUID per attempt protects nothing. A 409 for that key usually means the first attempt is still running, so wait and retry; it is not a decline.</li>
  <li><strong>Retrying at every layer.</strong> The app, the API and the HTTP library each retrying 3 times means 9 or 27 calls per click. The AWS Builders' Library shows 3 retries at each of 5 layers giving 243× the load on the database. Retry at one layer per failure, with a budget.</li>
  <li><strong>A fallback that hides the outage.</strong> <code>202 payment_pending</code> looks like success on a dashboard of status codes. Count fallbacks as their own metric and alert on them. Also cap the pending queue, because a fallback that grows forever is just a slower outage.</li>
  <li><strong>The breaker counting the wrong things.</strong> A burst of declined cards or users closing the app should not trip it. Count 5xx, timeouts and connection errors; treat 4xx as success and cancellations as excluded.</li>
  <li><strong>Holding scarce resources across a remote call.</strong> A DB transaction or a pooled connection held open while you wait on a provider turns their latency into your outage. Commit, call, then write the result.</li>
  <li><strong>Modes that never run.</strong> Breakers and fallbacks only run during incidents, so they are the least tested code you have. The AWS Builders' Library warns that circuit breakers add modal behaviour that is hard to test. Inject latency, not just errors, in staging and game days (see <a href="#chaos-engineering">Chaos Engineering</a>).</li>
</ul>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>Match each failure to its pattern: slow → timeout and breaker, blip → retry with jitter, unknown outcome → idempotency key, too much traffic → shed at the entry.</li>
  <li>Set one deadline at the entry and shrink it inward. Retry at one layer per failure, with a cap and a budget.</li>
  <li>One breaker per dependency, counting only real dependency failures, with a fallback the business has agreed to and an alert on every use of it.</li>
  <li>Test the failure paths on purpose: slow dependencies, not just dead ones.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#timeouts">Timeouts</a> · <a href="#retries">Retries</a> · <a href="#exponential-backoff">Exponential Backoff</a> · <a href="#circuit-breakers">Circuit Breakers</a> · <a href="#idempotency">Idempotency</a> · <a href="#backpressure">Backpressure</a></p>
`;
