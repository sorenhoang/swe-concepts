CONTENT["message-queues"] = `
<p class="tldr"><strong>TL;DR</strong>: A message queue is a buffer between the code that creates work and the code that does it. The producer drops a message in and moves on; one of many consumers picks it up later, does the work and <strong>acks</strong> it. If the consumer dies before acking, the broker hands the message to someone else. Think of a restaurant ticket rail: waiters clip orders on, any free cook takes the next one, and a ticket only leaves the rail when the dish is done.</p>

<h2>The problem it solves</h2>
<p>Imagine a checkout handler that, after saving the order, calls the email service, the invoice generator and the warehouse system before it replies. Three problems follow:</p>
<ul>
  <li><strong>Coupling.</strong> If the invoice service is down, checkout is down. The customer cares about the order being placed, not about the PDF arriving in the next 200 ms.</li>
  <li><strong>Latency.</strong> The customer waits for the slowest of the three calls, plus <a href="#retries">retries</a>.</li>
  <li><strong>Bursts.</strong> Traffic is spiky. A flash sale can bring 4x the normal order rate for 15 minutes. Sizing the warehouse integration for the peak wastes money the rest of the day; sizing it for the average means the peak fails.</li>
</ul>
<p>A queue fixes all three. Checkout writes "order 42 placed, please invoice it" to a queue and returns. Workers drain the queue at the rate they can sustain. A burst becomes a temporary backlog instead of an outage: this is called <strong>load leveling</strong>. A downstream outage becomes a growing queue that drains when the service comes back, instead of failed checkouts.</p>

<h2>How it works</h2>
<figure class="diagram">
<svg viewBox="0 0 780 300" role="img" aria-label="Two checkout API producers send messages into an orders queue. The queue holds messages m3 to m7 waiting. Messages m1 and m2 are in flight to worker-A and worker-B; worker-C is idle and will take the next one. Each message goes to exactly one worker and stays in the queue, invisible, until that worker acks it.">
  <defs><marker id="arr-mq-1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <rect class="box" x="20" y="58" width="140" height="44" rx="8"/><text x="90" y="85" text-anchor="middle">Checkout API #1</text>
  <rect class="box" x="20" y="148" width="140" height="44" rx="8"/><text x="90" y="175" text-anchor="middle">Checkout API #2</text>
  <path class="line" d="M160 80 H228" marker-end="url(#arr-mq-1)"/><text x="194" y="72" text-anchor="middle" class="small">send</text>
  <path class="line" d="M160 170 H228" marker-end="url(#arr-mq-1)"/><text x="194" y="162" text-anchor="middle" class="small">send</text>

  <rect class="box accent" x="230" y="50" width="290" height="150" rx="10"/>
  <text x="375" y="74" text-anchor="middle" class="title">orders queue (broker)</text>
  <rect class="box" x="246" y="96" width="38" height="34" rx="4"/><text x="265" y="118" text-anchor="middle" class="small">m7</text>
  <rect class="box" x="292" y="96" width="38" height="34" rx="4"/><text x="311" y="118" text-anchor="middle" class="small">m6</text>
  <rect class="box" x="338" y="96" width="38" height="34" rx="4"/><text x="357" y="118" text-anchor="middle" class="small">m5</text>
  <rect class="box" x="384" y="96" width="38" height="34" rx="4"/><text x="403" y="118" text-anchor="middle" class="small">m4</text>
  <rect class="box" x="430" y="96" width="38" height="34" rx="4"/><text x="449" y="118" text-anchor="middle" class="small">m3</text>
  <text x="357" y="150" text-anchor="middle" class="small">ready: waiting for a worker</text>
  <rect class="box muted" x="246" y="160" width="84" height="30" rx="4"/><text x="288" y="179" text-anchor="middle" class="small">m1 in flight</text>
  <rect class="box muted" x="338" y="160" width="84" height="30" rx="4"/><text x="380" y="179" text-anchor="middle" class="small">m2 in flight</text>
  <text x="474" y="179" text-anchor="middle" class="small">hidden</text>

  <rect class="box ok" x="610" y="30" width="150" height="44" rx="8"/><text x="685" y="57" text-anchor="middle">worker-A</text>
  <rect class="box ok" x="610" y="110" width="150" height="44" rx="8"/><text x="685" y="137" text-anchor="middle">worker-B</text>
  <rect class="box" x="610" y="190" width="150" height="44" rx="8"/><text x="685" y="217" text-anchor="middle">worker-C (idle)</text>
  <path class="line" d="M520 100 L608 56" marker-end="url(#arr-mq-1)"/><text x="552" y="72" text-anchor="middle" class="small">m1</text>
  <path class="line" d="M520 132 H608" marker-end="url(#arr-mq-1)"/><text x="565" y="124" text-anchor="middle" class="small">m2</text>
  <path class="line dashed" d="M520 166 L608 208" marker-end="url(#arr-mq-1)"/><text x="548" y="204" text-anchor="middle" class="small">next: m3</text>

  <rect class="box muted" x="130" y="252" width="520" height="34" rx="6"/>
  <text x="390" y="274" text-anchor="middle" class="small">each message goes to ONE worker; it is deleted only when that worker acks it</text>
</svg>
<figcaption>Competing consumers: workers share one queue, and adding a worker adds throughput. The producer never knows which worker, or how many, exist.</figcaption>
</figure>

<h3>The life of a message</h3>
<p>The core contract is the same in every broker, even though the words differ (SQS says "visibility timeout" and "delete", RabbitMQ says "unacked" and "ack", Redis Streams says "pending entries list" and <code>XACK</code>):</p>
<figure class="diagram">
<svg viewBox="0 0 780 250" role="img" aria-label="Message state machine. A producer sends a message into the Ready state. Receive moves it to In flight, where it is hidden from other consumers and its receive count goes up by one. Ack moves it to Deleted. A timeout, nack or consumer crash moves it back to Ready. If the receive count passes the limit, it moves to a dead-letter queue.">
  <defs><marker id="arr-mq-2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <path class="line" d="M110 30 V96" marker-end="url(#arr-mq-2)"/><text x="118" y="60" class="small">producer sends</text>
  <rect class="box" x="40" y="98" width="140" height="50" rx="10"/><text x="110" y="128" text-anchor="middle" class="title">Ready</text>
  <rect class="box accent" x="320" y="98" width="140" height="50" rx="10"/><text x="390" y="128" text-anchor="middle" class="title">In flight</text>
  <text x="390" y="168" text-anchor="middle" class="small">hidden from others</text>
  <text x="390" y="182" text-anchor="middle" class="small">receive count + 1</text>
  <rect class="box ok" x="600" y="28" width="150" height="50" rx="10"/><text x="675" y="51" text-anchor="middle" class="title">Deleted</text><text x="675" y="67" text-anchor="middle" class="small">work is done</text>
  <rect class="box bad" x="600" y="170" width="150" height="50" rx="10"/><text x="675" y="193" text-anchor="middle" class="title">Dead-letter queue</text><text x="675" y="209" text-anchor="middle" class="small">set aside for a human</text>

  <path class="line" d="M180 112 H318" marker-end="url(#arr-mq-2)"/><text x="250" y="104" text-anchor="middle" class="small">receive / deliver</text>
  <path class="line bad" d="M320 136 H182" marker-end="url(#arr-mq-2)"/><text x="250" y="156" text-anchor="middle" class="small">timeout, nack, crash</text>
  <path class="line ok" d="M460 108 L598 60" marker-end="url(#arr-mq-2)"/><text x="520" y="72" text-anchor="middle" class="small">ack / delete</text>
  <path class="line bad" d="M460 140 L598 190" marker-end="url(#arr-mq-2)"/><text x="548" y="148" text-anchor="middle" class="small">count &gt; max</text>
</svg>
<figcaption>Only an explicit ack removes a message. Everything else (a crash, a missed deadline, a nack) puts it back, which is why consumers see duplicates and why <a href="#dead-letter-queues">dead-letter queues</a> exist.</figcaption>
</figure>
<ul>
  <li><strong>Ack / delete.</strong> The consumer tells the broker "done". Only then is the message gone.</li>
  <li><strong>Visibility timeout / ack deadline.</strong> While a message is in flight, other consumers can't see it. If the consumer doesn't ack in time, the broker assumes it died and makes the message available again. In SQS the default is 30 seconds and the maximum is 12 hours; a consumer can extend it with <code>ChangeMessageVisibility</code> as a heartbeat for long jobs. NATS JetStream's <code>AckWait</code> also defaults to 30 seconds. Redis Streams has no timer at all: messages stay pending until some consumer claims them with <code>XCLAIM</code> or <code>XAUTOCLAIM</code>, as the example below does.</li>
  <li><strong>Nack.</strong> "I can't do this now." The message goes back right away (or after a delay, e.g. JetStream's <code>NakWithDelay</code>). RabbitMQ's <code>basic.nack</code> with <code>requeue=false</code> drops it or sends it to a dead-letter exchange instead.</li>
  <li><strong>Prefetch.</strong> How many unacked messages a consumer may hold at once. RabbitMQ sets it with <code>basic.qos</code>; JetStream with <code>MaxAckPending</code> (default 1000). Too high, and one slow consumer hoards messages while others sit idle, and a crash returns a big batch at once. Too low, and the consumer waits a network round trip between messages. A reasonable start is a small multiple of how many messages one consumer works on concurrently, then tune by measuring.</li>
</ul>

<h3>Delivery semantics</h3>
<p>Where you ack decides what can go wrong:</p>
<table>
  <tr><th>Semantics</th><th>How you get it</th><th>On a consumer crash</th><th>Use for</th></tr>
  <tr><td>At-most-once</td><td>ack (or auto-ack) <em>before</em> processing</td><td>the message is lost</td><td>metrics samples, cache warmups: losing one is fine</td></tr>
  <tr><td>At-least-once</td><td>ack <em>after</em> processing</td><td>redelivered; the work may run twice</td><td>the default for almost everything</td></tr>
  <tr><td>Effectively-once</td><td>at-least-once + an <a href="#idempotency">idempotent</a> consumer</td><td>redelivered, but the duplicate has no effect</td><td>payments, stock, emails: anything a duplicate would hurt</td></tr>
</table>
<p>No broker can give you exactly-once <em>side effects</em> on its own. SQS FIFO queues drop duplicate <em>sends</em> within a 5-minute deduplication window, and Kafka transactions give exactly-once for read-process-write <em>within Kafka</em>. Neither covers the email your handler sends or the row it writes to your database. So: assume every message can arrive twice, and dedup in the consumer (a processed-message table, a unique constraint, an upsert).</p>

<h3>Ordering</h3>
<p>One queue with many competing consumers is <strong>not ordered</strong> in practice: m1 and m2 are processed in parallel, and if m1's consumer crashes, m1 comes back after m2 is done. SQS standard queues only promise best-effort ordering. When order matters, you need a key that pins related messages to one lane: an SQS FIFO <em>message group ID</em>, a Kafka <em>partition key</em>, or one stream per entity. Order is then guaranteed <em>per key</em>, and throughput comes from having many keys. Often the better fix is to not need order: carry a version number and let the consumer ignore anything older than what it has.</p>

<h3>Queue or log?</h3>
<p>Two families of tools are both called "queues". A <strong>queue</strong> (SQS, RabbitMQ classic and quorum queues) tracks each message and deletes it once acked. A <strong>log</strong> (Kafka, Redis Streams, NATS JetStream streams) appends messages and keeps them for a retention period; each consumer group just remembers a position. A log can replay history and serve many independent readers, which is what <a href="#pub-sub">pub/sub</a> needs. A queue gives per-message acks, redelivery and dead-lettering out of the box.</p>

<table>
  <tr><th></th><th>Amazon SQS</th><th>RabbitMQ</th><th>Kafka</th><th>Redis Streams</th><th>NATS JetStream</th></tr>
  <tr><td>Model</td><td>queue, managed</td><td>queue (exchanges route into queues)</td><td>partitioned log</td><td>log + consumer groups</td><td>log + consumers; work-queue retention option</td></tr>
  <tr><td>Done =</td><td><code>DeleteMessage</code></td><td><code>basic.ack</code></td><td>commit offset (per partition)</td><td><code>XACK</code></td><td><code>Ack</code> (also <code>Nak</code>, <code>InProgress</code>, <code>Term</code>)</td></tr>
  <tr><td>Redelivery</td><td>visibility timeout expires</td><td>channel closes, nack with requeue, ack timeout</td><td>restart from last committed offset</td><td>only when someone runs <code>XCLAIM</code> / <code>XAUTOCLAIM</code></td><td><code>AckWait</code> expires, or a nak</td></tr>
  <tr><td>Ordering</td><td>standard: best effort; FIFO: per message group</td><td>per queue, broken by redelivery and parallel consumers</td><td>per partition</td><td>per stream</td><td>per stream</td></tr>
  <tr><td>Parallel consumers</td><td>any number</td><td>any number, tuned by prefetch</td><td>at most one per partition per group (Kafka 4.2 share groups lift this)</td><td>any number in a group</td><td>any number pulling from one consumer</td></tr>
  <tr><td>Replay old messages</td><td>no</td><td>no (yes with RabbitMQ streams)</td><td>yes, seek to an offset</td><td>yes, read by ID</td><td>yes, by sequence or time</td></tr>
</table>

<h3>The metric that matters: depth and lag</h3>
<p>Queue <strong>depth</strong> (messages waiting) and <strong>age of the oldest message</strong> (SQS <code>ApproximateAgeOfOldestMessage</code>; in Kafka, <em>consumer lag</em> per partition) tell you whether consumers keep up. Depth alone is ambiguous: 50,000 messages is fine if consumers clear 100,000 a minute. Age is what users feel: "the confirmation email arrived 25 minutes late". Graph both, <a href="#alerts">alert</a> on age, and <a href="#autoscaling">autoscale</a> consumers on depth divided by per-worker throughput.</p>

<figure class="diagram">
<svg viewBox="0 0 780 280" role="img" aria-label="Chart of queue depth from 09:00 to 10:00. During a flash sale from 09:00 to 09:15, 4,000 orders per minute arrive and workers process 1,500, so depth rises linearly to 37,500. After 09:15 arrivals drop to 500 per minute, so the backlog drains at 1,000 per minute and reaches zero at about 09:52.">
  <path class="line" d="M70 230 H745"/><path class="line" d="M70 230 V36"/>
  <text x="62" y="234" text-anchor="end" class="small">0</text>
  <text x="62" y="186" text-anchor="end" class="small">10k</text><path class="line dashed" d="M70 182.5 H740" style="stroke: var(--line)"/>
  <text x="62" y="139" text-anchor="end" class="small">20k</text><path class="line dashed" d="M70 135 H740" style="stroke: var(--line)"/>
  <text x="62" y="91" text-anchor="end" class="small">30k</text><path class="line dashed" d="M70 87.5 H740" style="stroke: var(--line)"/>
  <text x="62" y="44" text-anchor="end" class="small">40k</text><path class="line dashed" d="M70 40 H740" style="stroke: var(--line)"/>
  <text x="70" y="248" text-anchor="middle" class="small">09:00</text>
  <text x="182" y="248" text-anchor="middle" class="small">09:10</text>
  <text x="293" y="248" text-anchor="middle" class="small">09:20</text>
  <text x="405" y="248" text-anchor="middle" class="small">09:30</text>
  <text x="517" y="248" text-anchor="middle" class="small">09:40</text>
  <text x="628" y="248" text-anchor="middle" class="small">09:50</text>
  <text x="740" y="248" text-anchor="middle" class="small">10:00</text>
  <text x="405" y="272" text-anchor="middle" class="small">queue depth (messages waiting); workers process 1,500/min throughout</text>
  <path class="line accent" d="M70 230 L237.5 51.9 L656 230 H740" style="stroke-width: 2.5"/>
  <path class="line dashed" d="M237.5 56 V230"/><text x="243" y="222" class="small">sale ends</text>
  <text x="250" y="44" class="small">peak: 37,500 waiting = 25 min of work</text>
  <text x="80" y="62" class="small">+2,500/min</text>
  <text x="80" y="76" class="small">4,000 in, 1,500 out</text>
  <text x="372" y="104" class="small">-1,000/min (500 in, 1,500 out)</text>
  <text x="660" y="222" class="small">empty 09:52</text>
</svg>
<figcaption>The flash-sale scenario from the example below. Nothing failed, but an order placed at 09:15 waited about 25 minutes. The queue turned an outage into a delay.</figcaption>
</figure>

<h2>Example</h2>
<p><strong>Scenario.</strong> At 09:00 a flash sale pushes 4,000 orders/min into the <code>orders</code> queue. Three workers each handle 500/min, so 1,500/min in total. The backlog grows by 2,500/min and peaks at 37,500 at 09:15, when the sale ends and traffic drops to 500/min. It then drains at 1,000/min and is empty around 09:52 (the chart above). Without the queue, 2,500 of every 4,000 calls a minute would have timed out; with it, every order is accepted in milliseconds and processed within 25 minutes. Nine workers (4,500/min) would have kept the backlog near zero.</p>
<p>During the sale, one worker is killed by a deploy while holding two messages. They must not be lost, and must not be processed twice by two live workers at the same time.</p>
<p><strong>Code.</strong> A Redis Streams consumer group: the group tracks which messages each consumer holds (its pending entries list). The test runs against miniredis, an in-process Redis, with a fake clock so idle times are exact.</p>
<pre><code>package mq

import (
	"context"
	"errors"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	stream = "orders"
	group  = "workers"
)

// Setup creates the stream and a consumer group that starts at the beginning.
func Setup(ctx context.Context, rdb *redis.Client) error {
	return rdb.XGroupCreateMkStream(ctx, stream, group, "0").Err()
}

func Publish(ctx context.Context, rdb *redis.Client, orderID string) error {
	return rdb.XAdd(ctx, &amp;redis.XAddArgs{
		Stream: stream,
		Values: map[string]any{"order_id": orderID},
	}).Err()
}

// Poll hands this consumer up to n messages that no one in the group has
// received yet ("&gt;"). They sit in the group's pending list until acked.
func Poll(ctx context.Context, rdb *redis.Client, consumer string, n int64) ([]redis.XMessage, error) {
	res, err := rdb.XReadGroup(ctx, &amp;redis.XReadGroupArgs{
		Group:    group,
		Consumer: consumer,
		Streams:  []string{stream, "&gt;"},
		Count:    n,
		Block:    -1, // don't block; a real worker would block for a few seconds
	}).Result()
	if errors.Is(err, redis.Nil) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return res[0].Messages, nil
}

// Ack removes messages from the pending list: "done, don't redeliver".
func Ack(ctx context.Context, rdb *redis.Client, ids ...string) error {
	return rdb.XAck(ctx, stream, group, ids...).Err()
}

// Reclaim takes over messages that another consumer received but has not
// acked for at least minIdle (it probably crashed). Each claim counts as
// another delivery.
func Reclaim(ctx context.Context, rdb *redis.Client, consumer string, minIdle time.Duration) ([]redis.XMessage, error) {
	msgs, _, err := rdb.XAutoClaim(ctx, &amp;redis.XAutoClaimArgs{
		Stream:   stream,
		Group:    group,
		Consumer: consumer,
		MinIdle:  minIdle,
		Start:    "0-0",
		Count:    100,
	}).Result()
	return msgs, err
}

// Pending returns how many messages are delivered but not yet acked.
func Pending(ctx context.Context, rdb *redis.Client) (int64, map[string]int64, error) {
	p, err := rdb.XPending(ctx, stream, group).Result()
	if err != nil {
		return 0, nil, err
	}
	return p.Count, p.Consumers, nil
}

// Deliveries reports how many times a pending message has been delivered.
func Deliveries(ctx context.Context, rdb *redis.Client, id string) (int64, error) {
	p, err := rdb.XPendingExt(ctx, &amp;redis.XPendingExtArgs{
		Stream: stream, Group: group, Start: id, End: id, Count: 1,
	}).Result()
	if err != nil || len(p) == 0 {
		return 0, err
	}
	return p[0].RetryCount, nil
}</code></pre>
<p>The test publishes 6 orders, lets <code>worker-B</code> take two and "crash", and has <code>worker-A</code> reclaim them once they have been idle for 30 seconds:</p>
<pre><code>package mq

import (
	"context"
	"fmt"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func Example() {
	ctx := context.Background()
	mr := miniredis.NewMiniRedis()
	if err := mr.Start(); err != nil {
		panic(err)
	}
	defer mr.Close()
	clock := time.Date(2026, 11, 15, 9, 0, 0, 0, time.UTC)
	mr.SetTime(clock) // a fake clock makes idle times exact
	rdb := redis.NewClient(&amp;redis.Options{Addr: mr.Addr()})

	must(Setup(ctx, rdb))
	for i := 1; i &lt;= 6; i++ {
		must(Publish(ctx, rdb, fmt.Sprintf("o-%d", i)))
	}

	// work receives messages, "processes" them and acks.
	work := func(consumer string, msgs []redis.XMessage) {
		for _, m := range msgs {
			n, _ := Deliveries(ctx, rdb, m.ID)
			fmt.Printf("%s  %s  delivery #%d  -&gt; processed, ack&#92;n", consumer, m.Values["order_id"], n)
			must(Ack(ctx, rdb, m.ID))
		}
	}

	// Two competing consumers in one group: each message goes to one of them.
	// They take turns here so the output is stable; in production they run
	// in parallel on different machines.
	msgs, _ := Poll(ctx, rdb, "worker-A", 2)
	work("worker-A", msgs)

	msgs, _ = Poll(ctx, rdb, "worker-B", 2)
	for _, m := range msgs {
		fmt.Printf("worker-B  %s  delivery #1  -&gt; received&#92;n", m.Values["order_id"])
	}
	fmt.Println("worker-B  crashes before acking")

	msgs, _ = Poll(ctx, rdb, "worker-A", 2)
	work("worker-A", msgs)

	msgs, _ = Poll(ctx, rdb, "worker-A", 2)
	fmt.Printf("worker-A  new messages left: %d&#92;n", len(msgs))
	n, per, _ := Pending(ctx, rdb)
	fmt.Printf("pending (delivered, not acked): %d %v&#92;n", n, per)

	mr.SetTime(clock.Add(10 * time.Second))
	msgs, _ = Reclaim(ctx, rdb, "worker-A", 30*time.Second)
	fmt.Printf("09:00:10  reclaim idle &gt;= 30s: %d messages&#92;n", len(msgs))

	mr.SetTime(clock.Add(45 * time.Second))
	msgs, _ = Reclaim(ctx, rdb, "worker-A", 30*time.Second)
	fmt.Printf("09:00:45  reclaim idle &gt;= 30s: %d messages&#92;n", len(msgs))
	work("worker-A", msgs)

	n, per, _ = Pending(ctx, rdb)
	fmt.Printf("pending (delivered, not acked): %d %v&#92;n", n, per)
}

func must(err error) {
	if err != nil {
		panic(err)
	}
}</code></pre>
<p>Real output from <code>go test</code> (pinned as the example's expected output; also passes under <code>-race</code>):</p>
<pre><code>worker-A  o-1  delivery #1  -&gt; processed, ack
worker-A  o-2  delivery #1  -&gt; processed, ack
worker-B  o-3  delivery #1  -&gt; received
worker-B  o-4  delivery #1  -&gt; received
worker-B  crashes before acking
worker-A  o-5  delivery #1  -&gt; processed, ack
worker-A  o-6  delivery #1  -&gt; processed, ack
worker-A  new messages left: 0
pending (delivered, not acked): 2 map[worker-B:2]
09:00:10  reclaim idle &gt;= 30s: 0 messages
09:00:45  reclaim idle &gt;= 30s: 2 messages
worker-A  o-3  delivery #2  -&gt; processed, ack
worker-A  o-4  delivery #2  -&gt; processed, ack
pending (delivered, not acked): 0 map[]</code></pre>
<p>Each message went to one consumer. <code>o-3</code> and <code>o-4</code> were not lost when <code>worker-B</code> died: they stayed pending under its name. At 09:00:10 they were not reclaimed, because <code>worker-B</code> might just be slow. At 09:00:45 they had been idle for over 30 seconds, so <code>worker-A</code> claimed them, and the delivery count says <code>#2</code>. Note what this means for your handler: <code>worker-B</code> might have charged the card for <code>o-3</code> before it crashed, and now <code>worker-A</code> processes it again. That's at-least-once, and why the handler must be <a href="#idempotency">idempotent</a>. Set the claim idle time well above your slowest normal processing time, or you will steal messages from consumers that are still working.</p>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>Non-idempotent consumers.</strong> Every broker redelivers: after a crash, a timeout, a rebalance, a network blip on the ack. A handler that sends an email or adds to a balance without a dedup check will do it twice, eventually. Make the effect idempotent, or record the message ID in the same transaction as the effect.</li>
  <li><strong>Visibility timeout shorter than the work.</strong> If processing takes 45 s and the timeout is 30 s, a second consumer gets the message while the first is still working, every time. Set the timeout above your p99 processing time, and extend it (heartbeat) for long jobs.</li>
  <li><strong>Acking too early.</strong> Acking on receipt and then processing silently turns your queue into at-most-once. A crash between the two loses the message with no trace.</li>
  <li><strong>Unbounded retries.</strong> A message that always fails ("poison message") comes back forever, burns consumer time and, in ordered queues, blocks everything behind it. Cap deliveries and move failures to a <a href="#dead-letter-queues">dead-letter queue</a>.</li>
  <li><strong>Assuming order.</strong> Parallel consumers and redelivery reorder messages. If "OrderCancelled" can be processed before "OrderPlaced", either key them to one ordered lane or make the consumer handle out-of-order events.</li>
  <li><strong>Watching depth, not age.</strong> A queue that is "only" 10,000 deep can hold an hour-old message if consumers are stuck. Alert on the age of the oldest message, and on consumers being absent.</li>
  <li><strong>A queue is not infinite.</strong> SQS keeps messages for 4 days by default (14 days at most), Kafka deletes by retention time or size, Redis keeps everything in memory. A backlog that grows for days becomes data loss or an out-of-memory error. Pair queues with <a href="#backpressure">backpressure</a> or autoscaling.</li>
</ul>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>A queue decouples producers from consumers and turns bursts into backlog: producers go at their speed, consumers at theirs.</li>
  <li>A message leaves the queue only when it is acked. Crashes, timeouts and nacks put it back, so delivery is at-least-once and consumers must be idempotent.</li>
  <li>Competing consumers scale throughput but give up global order; get order per key (message group, partition), not per queue.</li>
  <li>Watch the age of the oldest message, cap redeliveries with a DLQ, and size the visibility timeout above your slowest normal job.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#pub-sub">Pub/Sub</a> · <a href="#dead-letter-queues">Dead-Letter Queues</a> · <a href="#idempotency">Idempotency</a> · <a href="#backpressure">Backpressure</a> · <a href="#event-driven-architecture">Event-Driven Architecture</a> · <a href="#real-world-async-pipeline">Real-World Async Pipeline</a></p>
`;
