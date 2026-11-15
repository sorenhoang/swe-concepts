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
CONTENT["pub-sub"] = `
<p class="tldr"><strong>TL;DR</strong>: In publish/subscribe, a publisher sends a message to a <strong>topic</strong>, and <em>every</em> subscriber to that topic gets its own copy. The publisher doesn't know who is listening. It's a radio station, not a phone call. The key question for any pub/sub system is what happens to a subscriber that is offline: some forget it (fire-and-forget), others keep its messages until it comes back (durable subscriptions).</p>

<h2>The problem it solves</h2>
<p>When an order is placed, several teams care: email sends a confirmation, inventory reserves stock, analytics counts revenue, fraud scores the payment. With direct calls, the order service has to know all of them, call each one, and handle each one failing. Every new consumer means a change and a deploy of the order service.</p>
<p>A <a href="#message-queues">message queue</a> doesn't fix this on its own: a queue gives each message to <em>one</em> consumer, and here every interested service needs <em>its own</em> copy. Pub/sub inverts the dependency. The order service publishes one <code>orders.placed</code> message and is done. Each interested service subscribes. Adding a fraud check next quarter is a new subscription, with no change to the publisher. This is the transport under <a href="#event-driven-architecture">event-driven architecture</a>.</p>

<h2>How it works</h2>
<figure class="diagram">
<svg viewBox="0 0 780 320" role="img" aria-label="The order service publishes one message to the orders.placed topic. The topic fans it out to three subscriptions: email, inventory and analytics. Each subscription keeps its own copy and its own position. The inventory subscription has two competing consumers that share its messages; email and analytics have one consumer each.">
  <defs><marker id="arr-ps-1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <rect class="box" x="15" y="128" width="140" height="54" rx="8"/><text x="85" y="151" text-anchor="middle" class="title">Order service</text><text x="85" y="169" text-anchor="middle" class="small">publisher</text>
  <rect class="box accent" x="210" y="118" width="150" height="74" rx="10"/><text x="285" y="146" text-anchor="middle" class="title">topic</text><text x="285" y="166" text-anchor="middle">orders.placed</text>
  <path class="line" d="M155 155 H208" marker-end="url(#arr-ps-1)"/><text x="182" y="146" text-anchor="middle" class="small">1 msg</text>

  <rect class="box" x="420" y="22" width="150" height="54" rx="8"/><text x="495" y="45" text-anchor="middle">sub: email</text><text x="495" y="63" text-anchor="middle" class="small">own copy, own cursor</text>
  <rect class="box" x="420" y="128" width="150" height="54" rx="8"/><text x="495" y="151" text-anchor="middle">sub: inventory</text><text x="495" y="169" text-anchor="middle" class="small">own copy, own cursor</text>
  <rect class="box" x="420" y="234" width="150" height="54" rx="8"/><text x="495" y="257" text-anchor="middle">sub: analytics</text><text x="495" y="275" text-anchor="middle" class="small">own copy, own cursor</text>
  <path class="line accent" d="M360 140 L418 52" marker-end="url(#arr-ps-1)"/>
  <path class="line accent" d="M360 155 H418" marker-end="url(#arr-ps-1)"/>
  <path class="line accent" d="M360 170 L418 258" marker-end="url(#arr-ps-1)"/>
  <text x="330" y="222" text-anchor="middle" class="small">3 copies</text>

  <rect class="box ok" x="630" y="27" width="135" height="44" rx="8"/><text x="697" y="54" text-anchor="middle">email worker</text>
  <rect class="box ok" x="630" y="110" width="135" height="38" rx="8"/><text x="697" y="134" text-anchor="middle">inventory #1</text>
  <rect class="box ok" x="630" y="162" width="135" height="38" rx="8"/><text x="697" y="186" text-anchor="middle">inventory #2</text>
  <rect class="box ok" x="630" y="239" width="135" height="44" rx="8"/><text x="697" y="266" text-anchor="middle">analytics job</text>
  <path class="line" d="M570 49 H628" marker-end="url(#arr-ps-1)"/>
  <path class="line" d="M570 148 L628 130" marker-end="url(#arr-ps-1)"/>
  <path class="line" d="M570 162 L628 180" marker-end="url(#arr-ps-1)"/>
  <path class="line" d="M570 261 H628" marker-end="url(#arr-ps-1)"/>
  <text x="600" y="222" text-anchor="middle" class="small">competing consumers</text>
</svg>
<figcaption>Fan-out between subscriptions, a queue inside each one. Every subscription gets every message; within a subscription, its consumers split the work. Kafka calls a subscription a <em>consumer group</em>, JetStream a <em>durable consumer</em>, Google Pub/Sub a <em>subscription</em>.</figcaption>
</figure>

<p>Most real systems combine the two patterns this way. Pub/sub decides <em>who</em> gets a copy; each subscription then behaves like a queue, with acks, redelivery and competing consumers, as in <a href="#message-queues">message queues</a>.</p>

<table>
  <tr><th></th><th>Queue (point-to-point)</th><th>Pub/sub (fan-out)</th></tr>
  <tr><td>Who gets a message</td><td>exactly one consumer</td><td>every subscription; one consumer inside each</td></tr>
  <tr><td>Sender's intent</td><td>"someone, do this job"</td><td>"this happened; whoever cares, react"</td></tr>
  <tr><td>Message naming</td><td>commands: <code>SendInvoice</code></td><td>events (facts): <code>OrderPlaced</code></td></tr>
  <tr><td>Adding a consumer type</td><td>a new queue, and the producer must send to it</td><td>a new subscription; publisher unchanged</td></tr>
  <tr><td>Scaling one consumer type</td><td>add competing consumers</td><td>add consumers to that subscription</td></tr>
  <tr><td>Typical tools</td><td>SQS, RabbitMQ queue, Redis Streams group</td><td>SNS, Google Pub/Sub, Kafka topics, NATS subjects, RabbitMQ fanout/topic exchanges</td></tr>
</table>

<h3>Fire-and-forget vs durable</h3>
<p>The biggest difference between pub/sub systems is whether the broker <em>stores</em> messages for subscribers:</p>
<ul>
  <li><strong>Fire-and-forget</strong> (Redis Pub/Sub, core NATS). The broker pushes each message to whoever is connected <em>right now</em> and forgets it. Redis documents its Pub/Sub as at-most-once: if the subscriber is disconnected or fails to handle the message, it is lost forever. A subscriber that starts late never sees what was published before. Fast and simple, and fine for data that is replaced by the next message: live prices, presence, cache-invalidation hints, <a href="#server-sent-events">SSE</a> or <a href="#websockets">WebSocket</a> fan-out to connected browsers.</li>
  <li><strong>Durable</strong> (Kafka consumer groups, JetStream durable consumers, Google Pub/Sub subscriptions, SNS delivering into SQS queues). The broker stores messages, and each subscription has a position that survives restarts. A subscriber that is down for 10 minutes catches up when it comes back. Redis's own docs point to Redis Streams when you need this.</li>
</ul>

<figure class="diagram">
<svg viewBox="0 0 780 250" role="img" aria-label="Timeline of six messages published while a subscriber is offline between m3 and m4. With fire-and-forget pub/sub, m1, m2, m5 and m6 arrive, and m3 and m4 are lost. With a durable subscription, m3 and m4 are stored and delivered in a catch-up burst when the subscriber reconnects, followed by m5 and m6.">
  <defs><marker id="arr-ps-2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <text x="20" y="44" class="title">published</text>
  <path class="line" d="M170 40 H760" marker-end="url(#arr-ps-2)"/>
  <rect class="box accent" x="190" y="26" width="38" height="28" rx="4"/><text x="209" y="45" text-anchor="middle" class="small">m1</text>
  <rect class="box accent" x="270" y="26" width="38" height="28" rx="4"/><text x="289" y="45" text-anchor="middle" class="small">m2</text>
  <rect class="box accent" x="350" y="26" width="38" height="28" rx="4"/><text x="369" y="45" text-anchor="middle" class="small">m3</text>
  <rect class="box accent" x="430" y="26" width="38" height="28" rx="4"/><text x="449" y="45" text-anchor="middle" class="small">m4</text>
  <rect class="box accent" x="590" y="26" width="38" height="28" rx="4"/><text x="609" y="45" text-anchor="middle" class="small">m5</text>
  <rect class="box accent" x="670" y="26" width="38" height="28" rx="4"/><text x="689" y="45" text-anchor="middle" class="small">m6</text>

  <rect class="box bad" x="335" y="66" width="190" height="24" rx="4"/><text x="430" y="82" text-anchor="middle" class="small">subscriber offline (deploy)</text>

  <text x="20" y="124" class="title">fire-and-forget</text>
  <text x="20" y="140" class="small">Redis Pub/Sub, core NATS</text>
  <path class="line" d="M170 126 H760" style="stroke: var(--line)"/>
  <rect class="box ok" x="190" y="112" width="38" height="28" rx="4"/><text x="209" y="131" text-anchor="middle" class="small">m1</text>
  <rect class="box ok" x="270" y="112" width="38" height="28" rx="4"/><text x="289" y="131" text-anchor="middle" class="small">m2</text>
  <rect class="box bad" x="350" y="112" width="38" height="28" rx="4"/><text x="369" y="131" text-anchor="middle" class="small">lost</text>
  <rect class="box bad" x="430" y="112" width="38" height="28" rx="4"/><text x="449" y="131" text-anchor="middle" class="small">lost</text>
  <rect class="box ok" x="590" y="112" width="38" height="28" rx="4"/><text x="609" y="131" text-anchor="middle" class="small">m5</text>
  <rect class="box ok" x="670" y="112" width="38" height="28" rx="4"/><text x="689" y="131" text-anchor="middle" class="small">m6</text>

  <text x="20" y="194" class="title">durable</text>
  <text x="20" y="210" class="small">Kafka, JetStream, GCP</text>
  <path class="line" d="M170 196 H760" style="stroke: var(--line)"/>
  <rect class="box ok" x="190" y="182" width="38" height="28" rx="4"/><text x="209" y="201" text-anchor="middle" class="small">m1</text>
  <rect class="box ok" x="270" y="182" width="38" height="28" rx="4"/><text x="289" y="201" text-anchor="middle" class="small">m2</text>
  <rect class="box ok" x="530" y="182" width="38" height="28" rx="4"/><text x="549" y="201" text-anchor="middle" class="small">m3</text>
  <rect class="box ok" x="572" y="182" width="38" height="28" rx="4"/><text x="591" y="201" text-anchor="middle" class="small">m4</text>
  <rect class="box ok" x="630" y="182" width="38" height="28" rx="4"/><text x="649" y="201" text-anchor="middle" class="small">m5</text>
  <rect class="box ok" x="690" y="182" width="38" height="28" rx="4"/><text x="709" y="201" text-anchor="middle" class="small">m6</text>
  <text x="570" y="232" text-anchor="middle" class="small">stored while offline, delivered as a catch-up burst</text>
</svg>
<figcaption>Same publisher, same outage. The durable subscriber gets everything, a little late; the fire-and-forget one has a silent gap. Note the burst: a durable subscriber must be able to process a backlog faster than real time to catch up.</figcaption>
</figure>

<p>Durable subscriptions have their own rules to know:</p>
<ul>
  <li><strong>A subscription only sees messages from when it was created.</strong> Google Pub/Sub's docs: only messages published after the subscription exists are available to it (topic retention plus <em>seek</em> can go back further). A JetStream consumer or a Kafka consumer group can instead start from the beginning of what the stream still retains, as the example shows.</li>
  <li><strong>Delivery is at-least-once.</strong> Google Pub/Sub's default, Kafka's normal mode and JetStream's explicit-ack consumers all redeliver after crashes. Subscribers need to be <a href="#idempotency">idempotent</a>.</li>
  <li><strong>Retention is finite.</strong> A subscriber that is down longer than the retention period comes back to a gap, just like fire-and-forget, only later.</li>
</ul>

<h3>Topics, subjects and filtering</h3>
<p>Subscribers rarely want everything. Systems filter in different places:</p>
<ul>
  <li><strong>Subject wildcards</strong> (NATS). Subjects are dot-separated tokens. <code>orders.*</code> matches exactly one token (<code>orders.placed</code>, <code>orders.cancelled</code>); <code>orders.&gt;</code> matches one or more (<code>orders.eu.placed</code> too). Redis has glob patterns with <code>PSUBSCRIBE news.*</code>.</li>
  <li><strong>Attribute filters on the subscription</strong>. SNS subscriptions take a filter policy, Google Pub/Sub subscriptions a filter on message attributes. The broker only delivers matching messages.</li>
  <li><strong>Topic per event type</strong> (Kafka). Kafka brokers don't filter; a consumer reads the whole topic and skips what it doesn't need. So topic design matters: one topic per event type, or per domain with a <code>type</code> field.</li>
</ul>
<p>Name topics after <em>what happened</em> (<code>orders.placed</code>), not after who consumes it (<code>email-queue</code>). The second ties the publisher to its consumers again.</p>

<table>
  <tr><th>System</th><th>Subscriber offline</th><th>Late subscriber</th><th>Filtering</th><th>Scaling one subscriber</th></tr>
  <tr><td>Redis Pub/Sub</td><td>messages lost</td><td>sees only new messages</td><td>channel name, glob patterns</td><td>every connection gets a copy</td></tr>
  <tr><td>Core NATS</td><td>messages lost</td><td>sees only new messages</td><td>subject wildcards <code>*</code>, <code>&gt;</code></td><td>queue groups: one member gets each message</td></tr>
  <tr><td>NATS JetStream</td><td>stored in the stream</td><td>can replay from start, a sequence or a time</td><td>filter subjects on the consumer</td><td>many clients pull from one durable consumer</td></tr>
  <tr><td>Kafka</td><td>stored until retention</td><td>new group can start at earliest or latest offset</td><td>by topic; consumer-side otherwise</td><td>consumers in a group split partitions</td></tr>
  <tr><td>SNS + SQS</td><td>waits in the subscriber's SQS queue</td><td>gets messages from subscription onwards</td><td>subscription filter policies</td><td>competing consumers on the SQS queue</td></tr>
  <tr><td>Google Pub/Sub</td><td>kept for the subscription</td><td>from subscription onwards (or seek)</td><td>subscription filter on attributes</td><td>many subscribers on one subscription</td></tr>
</table>

<h3>The slow subscriber</h3>
<p>Fan-out means one publisher rate hits every subscriber. If analytics handles 200 messages/s and the topic carries 1,000/s, something has to give:</p>
<ul>
  <li><strong>Fire-and-forget brokers protect themselves by dropping the subscriber.</strong> Redis buffers output for each Pub/Sub client and, with the default <code>client-output-buffer-limit pubsub 32mb 8mb 60</code>, disconnects a client whose buffer passes 32 MB, or stays above 8 MB for 60 seconds. The NATS server marks a client that can't keep up as a <em>slow consumer</em> and disconnects it (its default max pending is 64 MB per client). Either way, the subscriber silently loses messages.</li>
  <li><strong>Durable brokers let the subscription fall behind.</strong> Lag grows for that one subscription, while the others stay current: this isolation is the point. But lag that grows for hours runs into retention, and then you lose data anyway. Watch lag per subscription and scale its consumers (see <a href="#backpressure">backpressure</a>).</li>
</ul>

<h2>Example</h2>
<p><strong>Scenario.</strong> The order service publishes about 600 <code>orders.*</code> events a minute. A new audit service, required for compliance, is deployed at 10:00, and its pods restart for 3 minutes during a 14:00 deploy. On core NATS it would have missed everything before 10:00 and about 1,800 events during the restart, with no error anywhere. On a JetStream durable consumer it reads the history the stream still holds on first start, and after the restart it resumes at the next unread message and works through the 1,800-message backlog.</p>
<p><strong>Code.</strong> An embedded NATS server with JetStream, started inside the test. A stream named <code>ORDERS</code> records everything on <code>orders.&gt;</code>. Core subscriptions show fan-out and the late-subscriber gap; a durable consumer shows replay and resuming.</p>
<pre><code>package pubsub

import (
	"context"
	"fmt"
	"time"

	"github.com/nats-io/nats-server/v2/server"
	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
)

// StartServer runs a NATS server with JetStream inside this process.
func StartServer(storeDir string) (*server.Server, error) {
	ns, err := server.NewServer(&amp;server.Options{Port: -1, JetStream: true, StoreDir: storeDir})
	if err != nil {
		return nil, err
	}
	ns.Start()
	if !ns.ReadyForConnections(5 * time.Second) {
		return nil, context.DeadlineExceeded
	}
	return ns, nil
}

// Drain returns every message already waiting on a core subscription.
func Drain(sub *nats.Subscription) []string {
	var out []string
	for {
		m, err := sub.NextMsg(50 * time.Millisecond)
		if err != nil {
			return out
		}
		out = append(out, m.Subject+" "+string(m.Data))
	}
}

// Replay fetches up to n messages for a durable JetStream consumer and acks
// them. The server stores the consumer's position, so a subscriber that
// restarts with the same name continues where it left off.
func Replay(ctx context.Context, js jetstream.JetStream, durable string, n int) ([]string, error) {
	cons, err := js.CreateOrUpdateConsumer(ctx, "ORDERS", jetstream.ConsumerConfig{
		Durable:       durable,
		AckPolicy:     jetstream.AckExplicitPolicy,
		DeliverPolicy: jetstream.DeliverAllPolicy, // used only when it is first created
	})
	if err != nil {
		return nil, err
	}
	batch, err := cons.Fetch(n, jetstream.FetchMaxWait(200*time.Millisecond))
	if err != nil {
		return nil, err
	}
	var out []string
	for m := range batch.Messages() {
		meta, _ := m.Metadata()
		out = append(out, fmt.Sprintf("%s %s seq=%d", m.Subject(), m.Data(), meta.Sequence.Stream))
		if err := m.Ack(); err != nil {
			return out, err
		}
	}
	return out, batch.Error()
}</code></pre>
<pre><code>package pubsub

import (
	"context"
	"fmt"
	"os"
	"strings"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
)

func Example() {
	ctx := context.Background()
	dir, _ := os.MkdirTemp("", "js")
	defer os.RemoveAll(dir)
	ns, err := StartServer(dir)
	if err != nil {
		panic(err)
	}
	defer ns.Shutdown()
	nc, _ := nats.Connect(ns.ClientURL())
	defer nc.Close()
	js, _ := jetstream.New(nc)

	// A stream records everything published on orders.&gt; (used in part 2).
	_, err = js.CreateStream(ctx, jetstream.StreamConfig{Name: "ORDERS", Subjects: []string{"orders.&gt;"}})
	if err != nil {
		panic(err)
	}

	// Part 1: core NATS. Every subscriber gets its own copy; no one stores it.
	email, _ := nc.SubscribeSync("orders.placed") // exact subject
	analytics, _ := nc.SubscribeSync("orders.*")  // wildcard: one token
	nc.Publish("orders.placed", []byte("o-1"))
	nc.Publish("orders.cancelled", []byte("o-2"))
	nc.Flush()

	audit, _ := nc.SubscribeSync("orders.&gt;") // subscribes late
	nc.Publish("orders.placed", []byte("o-3"))
	nc.Flush()

	fmt.Println("email     |", strings.Join(Drain(email), ", "))
	fmt.Println("analytics |", strings.Join(Drain(analytics), ", "))
	fmt.Println("audit     |", strings.Join(Drain(audit), ", "), " &lt;- missed o-1, o-2")

	// Part 2: JetStream durable consumer. The stream kept every message, so a
	// subscriber created late can still read from the start.
	got, _ := Replay(ctx, js, "audit", 10)
	fmt.Println("durable audit, first run     |", strings.Join(got, ", "))

	// The audit service goes offline; orders keep coming.
	js.Publish(ctx, "orders.placed", []byte("o-4"))
	js.Publish(ctx, "orders.placed", []byte("o-5"))

	got, _ = Replay(ctx, js, "audit", 10)
	fmt.Println("durable audit, after restart |", strings.Join(got, ", "))
}</code></pre>
<p>Real output from <code>go test</code> (pinned as the example's expected output; also passes under <code>-race</code>):</p>
<pre><code>email     | orders.placed o-1, orders.placed o-3
analytics | orders.placed o-1, orders.cancelled o-2, orders.placed o-3
audit     | orders.placed o-3  &lt;- missed o-1, o-2
durable audit, first run     | orders.placed o-1 seq=1, orders.cancelled o-2 seq=2, orders.placed o-3 seq=3
durable audit, after restart | orders.placed o-4 seq=4, orders.placed o-5 seq=5</code></pre>
<p>Reading it line by line:</p>
<ul>
  <li><strong>Fan-out.</strong> One publish of <code>o-1</code> reached both <code>email</code> and <code>analytics</code>. Each got its own copy.</li>
  <li><strong>Filtering.</strong> <code>email</code> subscribed to the exact subject and did not get <code>orders.cancelled</code>; <code>analytics</code> used <code>orders.*</code> and did.</li>
  <li><strong>Fire-and-forget.</strong> <code>audit</code> subscribed after <code>o-1</code> and <code>o-2</code> were published and never saw them. Nothing failed; they simply had no listener.</li>
  <li><strong>Durable replay.</strong> The JetStream consumer named <code>audit</code> was created later still, but the stream had kept all three messages, so it read them from sequence 1.</li>
  <li><strong>Resume.</strong> On the second run with the same durable name, the server remembered the position: only <code>o-4</code> and <code>o-5</code>, published while it was "offline", were delivered.</li>
</ul>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>Using fire-and-forget for data that matters.</strong> Redis Pub/Sub or core NATS for "order placed" means every subscriber restart or network blip silently drops orders. Use them for data the next message replaces; use a durable subscription for facts.</li>
  <li><strong>One shared subscription for different services.</strong> If email and inventory join the same consumer group, they <em>compete</em> for messages, and each gets about half. Every independent consumer type needs its own subscription.</li>
  <li><strong>No owner for the subscriber list.</strong> The publisher doesn't know who listens, which is the point, but someone must. Before changing or removing an event, you need to know its subscribers. Keep a schema registry or a catalog, and version events (see <a href="#schema-versioning">schema versioning</a>).</li>
  <li><strong>Assuming order across subscribers.</strong> Email may process <code>o-7</code> before inventory does. Subscribers are independent; don't build logic that needs them to be in step.</li>
  <li><strong>Not planning for catch-up.</strong> After an outage, a durable subscriber gets a burst. If its downstream (a database, an email provider with a rate limit) can't take it, the catch-up causes the next incident. Limit consumer concurrency and use <a href="#rate-limiting">rate limiting</a> on the way out.</li>
  <li><strong>Retention shorter than your worst outage.</strong> A 24-hour retention and a subscriber broken over a long weekend means data loss on Monday. Size retention for how long a subscriber can realistically be down, and alert on lag well before that.</li>
</ul>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>Pub/sub sends one message to every subscription; inside a subscription, consumers compete like a queue.</li>
  <li>Fire-and-forget (Redis Pub/Sub, core NATS) loses messages for anyone not connected; durable subscriptions (Kafka, JetStream, Google Pub/Sub, SNS to SQS) keep them per subscriber.</li>
  <li>Each independent consumer type needs its own subscription, its own lag metric and an idempotent handler.</li>
  <li>A slow subscriber is dropped by fire-and-forget brokers and falls behind on durable ones; watch lag against retention.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#message-queues">Message Queues</a> · <a href="#event-driven-architecture">Event-Driven Architecture</a> · <a href="#dead-letter-queues">Dead-Letter Queues</a> · <a href="#backpressure">Backpressure</a> · <a href="#server-sent-events">Server-Sent Events</a> · <a href="#real-world-async-pipeline">Real-World Async Pipeline</a></p>
`;
