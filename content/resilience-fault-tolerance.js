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
