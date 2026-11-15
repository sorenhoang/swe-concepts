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

