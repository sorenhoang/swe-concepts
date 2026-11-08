CONTENT["websockets"] = `
<p class="tldr"><strong>TL;DR</strong>: A WebSocket turns one HTTP request into a permanent, two-way pipe between browser and server. After a quick "upgrade" handshake, <em>either side</em> can send a message at any moment, with only a few bytes of overhead, until someone closes it. Think of a phone line that stays open, instead of sending a new letter for every sentence.</p>

<h2>The problem it solves</h2>
<p>Plain HTTP is request → response: only the client can start a conversation. For chat, multiplayer games, live cursors in a shared document, or trading screens, the <em>server</em> needs to push data the moment it happens, and the client sends often too. The older workarounds all have costs:</p>
<ul>
  <li><strong>Polling</strong> ("anything new?" every few seconds): mostly empty responses, and data arrives up to one interval late.</li>
  <li><strong><a href="#long-polling">Long polling</a></strong>: better latency, but every message still costs a full HTTP request with headers, and the client can't send on the same channel.</li>
  <li><strong><a href="#server-sent-events">Server-Sent Events</a></strong>: great for server → client, but one-way only.</li>
</ul>
<p>WebSockets (RFC 6455, 2011) give a full-duplex, low-overhead channel that browsers support natively and that runs on the same ports as HTTPS.</p>

<h2>How it works</h2>
<ol>
  <li><strong>Upgrade handshake.</strong> The client sends a normal HTTP <code>GET</code> with <code>Upgrade: websocket</code> and a random <code>Sec-WebSocket-Key</code>. The server answers <code>101 Switching Protocols</code> with <code>Sec-WebSocket-Accept</code>, a hash of that key, proving it really speaks WebSocket (and isn't a confused cache replaying an old response).</li>
  <li><strong>Frames.</strong> The same TCP connection now carries WebSocket <em>frames</em>: text, binary, and control frames (ping, pong, close). A frame header is only 2–14 bytes, compared with hundreds of bytes of HTTP headers per request.</li>
  <li><strong>Either side sends any time.</strong> No request/response pairing: the server pushes when it has news, the client sends when the user acts.</li>
  <li><strong>Keepalive and close.</strong> Ping/pong frames check the other side is still there. A close frame with a code (<code>1000</code> = normal, <code>1001</code> = going away) ends it cleanly.</li>
</ol>
<p>URLs use <code>ws://</code> or, in practice always, <code>wss://</code> (WebSocket over TLS on port 443), which also gets through corporate proxies far more reliably.</p>

<figure class="diagram">
<svg viewBox="0 0 780 412" role="img" aria-label="WebSocket lifecycle: HTTP upgrade request, 101 Switching Protocols, then frames in both directions, ping and pong, and a close handshake">
  <defs><marker id="arr-ws-1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <rect class="box" x="80" y="16" width="140" height="36" rx="8"/><text x="150" y="39" text-anchor="middle">Browser</text>
  <rect class="box" x="560" y="16" width="140" height="36" rx="8"/><text x="630" y="39" text-anchor="middle">Server</text>
  <path class="line dashed" d="M150 52 V405 M630 52 V405" style="stroke: var(--line)"/>

  <text x="390" y="76" text-anchor="middle">GET /chat   Upgrade: websocket</text>
  <text x="390" y="92" text-anchor="middle" class="small">Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==</text>
  <path class="line" d="M150 100 H628" marker-end="url(#arr-ws-1)"/>
  <text x="390" y="128" text-anchor="middle">101 Switching Protocols</text>
  <text x="390" y="144" text-anchor="middle" class="small">Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=</text>
  <path class="line dashed" d="M630 152 H152" marker-end="url(#arr-ws-1)"/>

  <rect class="box muted" x="230" y="166" width="320" height="26" rx="6"/>
  <text x="390" y="184" text-anchor="middle" class="small">same TCP connection, now speaking WebSocket frames</text>

  <text x="390" y="214" text-anchor="middle" class="small">text frame: {"type":"send","text":"hi"}</text>
  <path class="line accent" d="M150 220 H628" marker-end="url(#arr-ws-1)"/>
  <text x="390" y="246" text-anchor="middle" class="small">text frame: new message from Bob</text>
  <path class="line ok dashed" d="M630 252 H152" marker-end="url(#arr-ws-1)"/>
  <text x="390" y="276" text-anchor="middle" class="small">text frame: "Carol is typing…"</text>
  <path class="line ok dashed" d="M630 282 H152" marker-end="url(#arr-ws-1)"/>
  <text x="390" y="308" text-anchor="middle" class="small">ping</text>
  <path class="line dashed" d="M630 314 H152" marker-end="url(#arr-ws-1)"/>
  <text x="390" y="334" text-anchor="middle" class="small">pong (I'm still here)</text>
  <path class="line" d="M150 340 H628" marker-end="url(#arr-ws-1)"/>
  <text x="390" y="366" text-anchor="middle" class="small">close 1000 (normal)</text>
  <path class="line" d="M150 372 H628" marker-end="url(#arr-ws-1)"/>
  <text x="390" y="392" text-anchor="middle" class="small">close 1000</text>
  <path class="line dashed" d="M630 398 H152" marker-end="url(#arr-ws-1)"/>
</svg>
<figcaption>One HTTP request upgrades into a long-lived, two-way channel. After the 101, there's no request/response pairing: either side sends whenever it wants. (Key and accept values are the example from RFC 6455.)</figcaption>
</figure>

<h3>The hard part: scaling stateful connections</h3>
<p>An HTTP request can go to any server. A WebSocket <em>lives on one server</em> for minutes or hours. With several servers, Alice may be connected to server A while Bob and Carol are on server B. When Alice sends to the room, server A must reach sockets it doesn't hold. The usual answer is a <a href="#pub-sub">pub/sub</a> layer (Redis, NATS, Kafka) between the servers.</p>

<figure class="diagram">
<svg viewBox="0 0 780 282" role="img" aria-label="Alice is connected to server A, Bob and Carol to server B. Server A publishes Alice's message to a Redis pub/sub channel; Redis delivers it to every subscribed server, and server B pushes it to Bob and Carol.">
  <defs><marker id="arr-ws-2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <rect class="box" x="20" y="40" width="100" height="36" rx="8"/><text x="70" y="63" text-anchor="middle">Alice</text>
  <rect class="box" x="20" y="120" width="100" height="36" rx="8"/><text x="70" y="143" text-anchor="middle">Bob</text>
  <rect class="box" x="20" y="200" width="100" height="36" rx="8"/><text x="70" y="223" text-anchor="middle">Carol</text>
  <rect class="box" x="165" y="110" width="120" height="56" rx="8"/>
  <text x="225" y="134" text-anchor="middle" class="title">Load</text><text x="225" y="152" text-anchor="middle" class="title">balancer</text>
  <path class="line" d="M120 58 L165 125 M120 138 H165 M120 218 L165 152"/>
  <rect class="box" x="335" y="30" width="140" height="56" rx="8"/>
  <text x="405" y="54" text-anchor="middle" class="title">Server A</text><text x="405" y="72" text-anchor="middle" class="small">holds Alice's socket</text>
  <rect class="box" x="335" y="190" width="140" height="56" rx="8"/>
  <text x="405" y="214" text-anchor="middle" class="title">Server B</text><text x="405" y="232" text-anchor="middle" class="small">holds Bob and Carol</text>
  <path class="line" d="M285 125 L335 70 M285 152 L335 205"/>
  <rect class="box accent" x="560" y="108" width="200" height="60" rx="10"/>
  <text x="660" y="134" text-anchor="middle" class="title">Pub/sub (Redis)</text>
  <text x="660" y="153" text-anchor="middle" class="small">channel room:42</text>
  <path class="line accent" d="M475 62 L558 118" marker-end="url(#arr-ws-2)"/>
  <text x="530" y="78" class="small">1 publish</text>
  <path class="line accent" d="M558 158 L477 212" marker-end="url(#arr-ws-2)"/>
  <text x="528" y="210" class="small">2 deliver</text>
  <text x="390" y="272" text-anchor="middle" class="small">3 server B writes the message to Bob's and Carol's sockets (server A gets it too, for Alice's other tabs)</text>
</svg>
<figcaption>Each server only knows its own sockets. Pub/sub lets every server hear every room's messages and forward them to the clients it holds.</figcaption>
</figure>

<h2>Real-time options compared</h2>
<table>
  <tr><th></th><th>Polling</th><th>Long polling</th><th>Server-Sent Events</th><th>WebSockets</th><th>Webhooks</th></tr>
  <tr><td>Direction</td><td>client asks</td><td>client asks, server answers when ready</td><td>server → client</td><td>both ways</td><td>server → server</td></tr>
  <tr><td>Connection</td><td>new request each time</td><td>new request per message</td><td>one long HTTP response</td><td>one upgraded connection</td><td>one request per event</td></tr>
  <tr><td>Latency</td><td>up to the interval</td><td>low</td><td>low</td><td>lowest</td><td>low</td></tr>
  <tr><td>Overhead per message</td><td>full HTTP request</td><td>full HTTP request</td><td>a few bytes</td><td>2–14 bytes</td><td>full HTTP request</td></tr>
  <tr><td>Reconnect / resume</td><td>n/a</td><td>you build it (cursor)</td><td>built in (<code>Last-Event-ID</code>)</td><td>you build it</td><td>provider retries</td></tr>
  <tr><td>Best for</td><td>rare updates</td><td>restricted networks, simple infra</td><td>feeds, notifications, AI token streams</td><td>chat, games, collaboration</td><td>integrations (payments, Git)</td></tr>
</table>

<h2>Example</h2>
<p><strong>A chat room server in Go</strong> with <code>gorilla/websocket</code> (the standard library has no WebSocket server). It follows the pattern of gorilla's own chat example: each client gets a <em>buffered send channel</em> and its own writer goroutine, so one slow client can't stall the whole room.</p>
<pre><code>const (
	pongWait     = 60 * time.Second    // no pong for this long = connection is dead
	pingInterval = pongWait * 9 / 10   // ping a bit more often than that
	writeWait    = 10 * time.Second
)

// The default CheckOrigin rejects handshakes from other sites. Keep it.
var upgrader = websocket.Upgrader{}

type client struct {
	conn *websocket.Conn
	send chan []byte // buffered: a slow client fills its own buffer, not the room's
}

type Room struct {
	mu      sync.Mutex
	clients map[*client]struct{}
}

func NewRoom() *Room { return &amp;Room{clients: map[*client]struct{}{}} }

func (rm *Room) Broadcast(msg []byte) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	for c := range rm.clients {
		select {
		case c.send &lt;- msg:
		default: // buffer full: this client can't keep up, drop it
			delete(rm.clients, c)
			close(c.send)
		}
	}
}

func (rm *Room) remove(c *client) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	if _, ok := rm.clients[c]; ok {
		delete(rm.clients, c)
		close(c.send)
	}
}

func (rm *Room) ServeWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil) // replies 101 Switching Protocols
	if err != nil {
		return // Upgrade already sent an HTTP error
	}
	c := &amp;client{conn: conn, send: make(chan []byte, 64)}
	rm.mu.Lock()
	rm.clients[c] = struct{}{}
	rm.mu.Unlock()

	go c.writeLoop()
	c.readLoop(rm) // blocks until the client goes away
}

func (c *client) readLoop(rm *Room) {
	defer func() {
		rm.remove(c)
		c.conn.Close()
	}()
	c.conn.SetReadLimit(64 &lt;&lt; 10) // 64 KB max per message
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		return c.conn.SetReadDeadline(time.Now().Add(pongWait)) // still alive
	})
	for {
		_, msg, err := c.conn.ReadMessage()
		if err != nil {
			return // closed, timed out, or broken
		}
		rm.Broadcast(msg)
	}
}

// The only goroutine that writes to conn: gorilla allows one writer at a time.
func (c *client) writeLoop() {
	ping := time.NewTicker(pingInterval)
	defer ping.Stop()
	for {
		select {
		case msg, ok := &lt;-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, nil)
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case &lt;-ping.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}</code></pre>
<p>The browser side is built in:</p>
<pre><code>const ws = new WebSocket("wss://chat.example.com/ws");
ws.onmessage = (e) =&gt; showMessage(e.data);
ws.onclose = () =&gt; setTimeout(connect, backoffWithJitter()); // no automatic reconnect
sendButton.onclick = () =&gt; ws.send(input.value);</code></pre>
<p>Try a server from the terminal with <a href="https://github.com/vi/websocat">websocat</a>: <code>websocat wss://chat.example.com/ws</code>, then type lines to send them.</p>

<p><strong>Real-world scenario: the deploy that took the site down.</strong> A live-score app holds 200,000 WebSocket connections. A deploy restarts every server, so all 200,000 clients disconnect at the same second, and every one reconnects immediately. The new servers (and the database behind the login check) get a wall of handshakes and fall over, which disconnects everyone again. The fixes: clients reconnect with <a href="#exponential-backoff">exponential backoff plus random jitter</a>, servers drain connections gradually on shutdown (close with <code>1001</code> over a few minutes, not all at once), and handshakes do as little work as possible.</p>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>You may not need it.</strong> If only the server pushes (notifications, dashboards, AI responses), <a href="#server-sent-events">SSE</a> is simpler and works with plain HTTP infrastructure.</li>
  <li><strong>Stateful connections change operations.</strong> Load balancers must allow upgrades and long-lived connections, deploys must drain sockets, and broadcasting needs pub/sub between servers.</li>
  <li><strong>No reconnect, no resume, no delivery guarantee.</strong> Browsers don't reconnect automatically, and anything sent while a client was disconnected is gone. Add sequence numbers so clients can ask for what they missed.</li>
  <li><strong>Reconnect storms.</strong> Always reconnect with backoff and jitter, never in a tight loop.</li>
  <li><strong>Check the <code>Origin</code> header.</strong> Browsers send cookies with the handshake, and WebSockets aren't covered by <a href="#cors">CORS</a>. A server that accepts any origin lets a malicious page open a socket as the logged-in user (cross-site WebSocket hijacking). gorilla rejects cross-origin handshakes by default; don't "fix" that with <code>CheckOrigin: return true</code>.</li>
  <li><strong>Auth is awkward.</strong> The browser API can't set an <code>Authorization</code> header. Use a cookie (plus the Origin check), or a short-lived token in the first message. Tokens in the query string end up in access logs.</li>
  <li><strong>Slow consumers.</strong> A client on a bad network can't read as fast as you write. Give each one a bounded buffer and disconnect it when full (see <a href="#backpressure">Backpressure</a>).</li>
  <li><strong>Idle connections get cut.</strong> Proxies and load balancers drop quiet connections (AWS ALB after 60 seconds by default). Send pings well within that window.</li>
  <li><strong>Limit message size.</strong> Without a read limit, one client can send a huge frame and exhaust memory (<code>SetReadLimit</code> in gorilla).</li>
</ul>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>WebSocket = HTTP upgrade into a persistent, full-duplex, low-overhead channel.</li>
  <li>Use it when both sides send often: chat, games, collaboration. For one-way pushes, prefer SSE.</li>
  <li>The hard parts are operational: scaling across servers with pub/sub, draining on deploy, reconnecting with jitter.</li>
  <li>Check Origin, bound buffers and message sizes, and keep connections alive with ping/pong.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#server-sent-events">Server-Sent Events</a> · <a href="#long-polling">Long Polling</a> · <a href="#pub-sub">Pub/Sub</a> · <a href="#load-balancing">Load Balancing</a> · <a href="#backpressure">Backpressure</a> · <a href="#exponential-backoff">Exponential Backoff</a> · <a href="#tcp-vs-udp">TCP vs UDP</a></p>
`;


CONTENT["long-polling"] = `
<p class="tldr"><strong>TL;DR</strong>: Long polling is "ask, and the server doesn't answer until it has something". The client sends a normal HTTP request; the server <em>holds it open</em> until new data arrives (or a timeout passes), responds, and the client immediately asks again. You get near-real-time updates using nothing but ordinary HTTP.</p>

<h2>The problem it solves</h2>
<p>Plain HTTP only lets the client start a conversation. The naive fix, <strong>short polling</strong> ("anything new?" every 5 seconds), has two problems:</p>
<ul>
  <li><strong>Wasted requests</strong>: almost every response is "no". 10,000 clients polling every 5 seconds is 2,000 requests per second, nearly all empty.</li>
  <li><strong>Latency</strong>: data that arrives just after a poll waits a whole interval. Poll faster and the waste grows.</li>
</ul>
<p>Long polling fixes both: no empty answers while nothing happens, and data goes out the moment it exists. It was the backbone of early web chat ("Comet") before WebSockets, and it's still used today where only plain request/response HTTP is available, or for APIs where a held request is simpler than a stream.</p>

<h2>How it works</h2>
<ol>
  <li>The client sends <code>GET /events?after=41</code>: "give me anything after the last event I saw".</li>
  <li>If there's already something newer, the server answers immediately.</li>
  <li>Otherwise it <strong>waits</strong>, holding the request open, until a new event arrives or a timeout (say 25 seconds) passes.</li>
  <li>It answers with the new events, or with <code>204 No Content</code> on timeout.</li>
  <li>The client handles the response and <strong>immediately</strong> sends the next request, with an updated cursor.</li>
</ol>

<figure class="diagram">
<svg viewBox="0 0 780 372" role="img" aria-label="Short polling: the client asks every 5 seconds and gets mostly empty answers; an event that happens between polls waits until the next poll. Long polling: the server holds the request until event 42 happens and answers at once, then the client asks again; a later request times out with 204 and is re-sent.">
  <defs><marker id="arr-lp-1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <text x="195" y="22" text-anchor="middle" class="title">Short polling (every 5 s)</text>
  <text x="585" y="22" text-anchor="middle" class="title">Long polling</text>
  <path class="line" d="M390 10 V365" style="stroke: var(--line)"/>

  <rect class="box" x="40" y="36" width="90" height="30" rx="8"/><text x="85" y="56" text-anchor="middle">Client</text>
  <rect class="box" x="255" y="36" width="90" height="30" rx="8"/><text x="300" y="56" text-anchor="middle">Server</text>
  <path class="line dashed" d="M85 66 V360 M300 66 V360" style="stroke: var(--line)"/>
  <text x="192" y="84" text-anchor="middle" class="small">anything new?</text>
  <path class="line" d="M85 90 H298" marker-end="url(#arr-lp-1)"/>
  <path class="line dashed" d="M300 104 H87" marker-end="url(#arr-lp-1)"/>
  <text x="192" y="120" text-anchor="middle" class="small">no</text>
  <text x="192" y="144" text-anchor="middle" class="small">anything new?</text>
  <path class="line" d="M85 150 H298" marker-end="url(#arr-lp-1)"/>
  <path class="line dashed" d="M300 164 H87" marker-end="url(#arr-lp-1)"/>
  <text x="192" y="180" text-anchor="middle" class="small">no</text>
  <text x="310" y="200" class="small">← event 42</text>
  <text x="192" y="224" text-anchor="middle" class="small">anything new?</text>
  <path class="line" d="M85 230 H298" marker-end="url(#arr-lp-1)"/>
  <path class="line ok dashed" d="M300 244 H87" marker-end="url(#arr-lp-1)"/>
  <text x="192" y="260" text-anchor="middle" class="small">event 42 (up to 5 s late)</text>
  <text x="192" y="284" text-anchor="middle" class="small">anything new?</text>
  <path class="line" d="M85 290 H298" marker-end="url(#arr-lp-1)"/>
  <path class="line dashed" d="M300 304 H87" marker-end="url(#arr-lp-1)"/>
  <text x="192" y="320" text-anchor="middle" class="small">no</text>
  <text x="192" y="350" text-anchor="middle" class="small">most answers are empty</text>

  <rect class="box" x="430" y="36" width="90" height="30" rx="8"/><text x="475" y="56" text-anchor="middle">Client</text>
  <rect class="box" x="645" y="36" width="90" height="30" rx="8"/><text x="690" y="56" text-anchor="middle">Server</text>
  <path class="line dashed" d="M475 66 V360 M690 66 V360" style="stroke: var(--line)"/>
  <text x="582" y="84" text-anchor="middle" class="small">GET /events?after=41</text>
  <path class="line" d="M475 90 H688" marker-end="url(#arr-lp-1)"/>
  <rect class="box accent" x="684" y="94" width="12" height="102" rx="3"/>
  <text x="676" y="148" text-anchor="end" class="small">held open…</text>
  <text x="702" y="194" class="small">event 42</text>
  <path class="line ok dashed" d="M684 200 H477" marker-end="url(#arr-lp-1)"/>
  <text x="582" y="216" text-anchor="middle" class="small">200 [event 42], instantly</text>
  <text x="582" y="238" text-anchor="middle" class="small">GET /events?after=42</text>
  <path class="line" d="M475 244 H688" marker-end="url(#arr-lp-1)"/>
  <rect class="box accent" x="684" y="248" width="12" height="52" rx="3"/>
  <path class="line dashed" d="M684 304 H477" marker-end="url(#arr-lp-1)"/>
  <text x="582" y="320" text-anchor="middle" class="small">204 after 25 s: nothing new</text>
  <text x="582" y="340" text-anchor="middle" class="small">GET /events?after=42 (again)</text>
  <path class="line" d="M475 346 H688" marker-end="url(#arr-lp-1)"/>
</svg>
<figcaption>Short polling asks on a timer and mostly hears "no". Long polling asks once and lets the server answer at the right moment.</figcaption>
</figure>

<h3>The cursor: don't lose events between requests</h3>
<p>There's always a small gap between one response and the next request. Events that happen in that gap must not be lost. So the server keeps a <strong>log</strong> of recent events with increasing IDs, and the client always says "everything <em>after</em> the last ID I saw". If something arrived in the gap, the next request returns it immediately.</p>

<figure class="diagram">
<svg viewBox="0 0 780 205" role="img" aria-label="Timeline: request after=41 is held until event 42 arrives. Event 43 happens while no request is open. The next request, after=42, returns event 43 immediately. Request after=43 is held until event 44.">
  <text x="20" y="64" class="title">Server events</text>
  <path class="line" d="M150 60 H760" style="stroke: var(--line)"/>
  <circle class="box accent" cx="180" cy="60" r="6"/><text x="180" y="42" text-anchor="middle" class="small">41</text>
  <circle class="box accent" cx="330" cy="60" r="6"/><text x="330" y="42" text-anchor="middle" class="small">42</text>
  <circle class="box accent" cx="362" cy="60" r="6"/><text x="362" y="42" text-anchor="middle" class="small">43</text>
  <circle class="box accent" cx="600" cy="60" r="6"/><text x="600" y="42" text-anchor="middle" class="small">44</text>
  <path class="line dashed" d="M330 66 V110 M362 66 V110 M600 66 V110"/>

  <text x="20" y="126" class="title">Client requests</text>
  <rect class="box ok" x="200" y="110" width="130" height="24" rx="4"/>
  <rect class="box ok" x="380" y="110" width="8" height="24" rx="2"/>
  <rect class="box ok" x="396" y="110" width="204" height="24" rx="4"/>
  <text x="265" y="156" text-anchor="middle" class="small">after=41 → [42]</text>
  <text x="384" y="174" text-anchor="middle" class="small">after=42 → [43] at once</text>
  <text x="498" y="156" text-anchor="middle" class="small">after=43 → [44]</text>
  <text x="390" y="198" text-anchor="middle" class="small">event 43 happened while no request was open, and it still wasn't lost</text>
</svg>
<figcaption>A cursor plus a server-side log makes long polling lossless. Without it, anything that happens between requests silently disappears.</figcaption>
</figure>

<h2>Where you'll meet long polling</h2>
<table>
  <tr><th>System</th><th>How it uses long polling</th></tr>
  <tr><td>AWS SQS</td><td><code>ReceiveMessage</code> with <code>WaitTimeSeconds</code> (up to 20 s) waits for messages instead of returning empty, cutting both empty responses and cost, since SQS bills per request</td></tr>
  <tr><td>Telegram Bot API</td><td><code>getUpdates</code> with a <code>timeout</code> and an <code>offset</code> cursor, as the alternative to webhooks</td></tr>
  <tr><td>HashiCorp Consul</td><td>"blocking queries": <code>?index=…&amp;wait=…</code> returns when the data changes past that index</td></tr>
  <tr><td>Browser apps on locked-down networks</td><td>fallback transport when WebSockets are blocked (libraries like Socket.IO start with long polling and upgrade if they can)</td></tr>
</table>

<h2>Example</h2>
<p><strong>Server in Go.</strong> An in-memory event log, and a handler that returns events after the cursor or waits for new ones. The trick for waking every waiting request at once: a channel that gets <em>closed</em> on each append (a closed channel unblocks all receivers), then replaced.</p>
<pre><code>type Event struct {
	ID   int    &#96;json:"id"&#96;
	Data string &#96;json:"data"&#96;
}

// In memory and single-instance; with several servers, keep the log in Redis or a database.
type Log struct {
	mu      sync.Mutex
	events  []Event
	changed chan struct{} // closed on every append: wakes all waiting requests at once
}

func NewLog() *Log { return &amp;Log{changed: make(chan struct{})} }

func (l *Log) Append(data string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.events = append(l.events, Event{ID: len(l.events) + 1, Data: data})
	close(l.changed)
	l.changed = make(chan struct{})
}

// After returns events with ID &gt; after, and a channel that closes when more arrive.
func (l *Log) After(after int) ([]Event, &lt;-chan struct{}) {
	l.mu.Lock()
	defer l.mu.Unlock()
	after = min(max(after, 0), len(l.events))
	return slices.Clone(l.events[after:]), l.changed
}

const holdFor = 25 * time.Second // below the 60 s idle timeout of typical proxies

func (l *Log) Poll(w http.ResponseWriter, r *http.Request) {
	after, _ := strconv.Atoi(r.URL.Query().Get("after"))
	w.Header().Set("Cache-Control", "no-store")
	timeout := time.NewTimer(holdFor)
	defer timeout.Stop()

	for {
		events, changed := l.After(after)
		if len(events) &gt; 0 {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(events)
			return
		}
		select {
		case &lt;-changed: // something new: loop and read it
		case &lt;-timeout.C:
			w.WriteHeader(http.StatusNoContent) // nothing new: the client asks again
			return
		case &lt;-r.Context().Done():
			return // the client went away
		}
	}
}</code></pre>

<p><strong>Client in Go</strong>: loop forever, keep the cursor, back off with jitter on errors.</p>
<pre><code>func Follow(ctx context.Context, baseURL string, handle func(Event)) error {
	client := &amp;http.Client{Timeout: holdFor + 10*time.Second} // longer than the server's hold
	after := 0
	for ctx.Err() == nil {
		url := fmt.Sprintf("%s/events?after=%d", baseURL, after)
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			return err
		}
		resp, err := client.Do(req)
		if err != nil {
			// jitter: thousands of clients must not retry in lockstep
			time.Sleep(time.Second + rand.N(time.Second))
			continue
		}
		if resp.StatusCode == http.StatusOK {
			var events []Event
			if json.NewDecoder(resp.Body).Decode(&amp;events) == nil {
				for _, e := range events {
					handle(e)
					after = e.ID // move the cursor only after handling
				}
			}
		}
		resp.Body.Close()
	}
	return ctx.Err()
}</code></pre>

<p>Watch it from a terminal:</p>
<pre><code>$ curl -i 'localhost:8080/events?after=0'   # hangs… until something is appended, or 25 s pass
HTTP/1.1 204 No Content</code></pre>

<p><strong>Real-world scenario.</strong> A job-status page polled <code>/jobs/123</code> every 2 seconds. With 5,000 people watching long builds, that was 2,500 requests per second, 99% of them answering "still running". Switching to long polling (<code>/jobs/123?version=7</code> waits up to 25 s for the status to change) cut traffic to roughly one request per client per 25 seconds plus one per real change, and status changes appeared instantly instead of up to 2 seconds late. No new infrastructure: the same load balancer, the same HTTP stack.</p>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>Hold time vs proxy timeouts.</strong> Every proxy on the path has an idle timeout: nginx's <code>proxy_read_timeout</code> and AWS ALB's idle timeout both default to 60 seconds. Hold requests well below that (20–30 s), and make the client's own timeout a bit longer than the server's hold.</li>
  <li><strong>Lost events without a cursor.</strong> Anything between response and next request disappears unless the server keeps a log and the client sends "after=ID".</li>
  <li><strong>Duplicates are possible.</strong> If a response is lost on the way, the client re-asks with the old cursor and gets the same events again. Make handling <a href="#idempotency">idempotent</a> by event ID.</li>
  <li><strong>Multiple servers need a shared log.</strong> The waiting request may be on server A while the event is written on server B. Use Redis, a database, or <a href="#pub-sub">pub/sub</a> to wake waiters everywhere.</li>
  <li><strong>Thundering herd.</strong> One event wakes 10,000 waiting clients, and all 10,000 re-request in the same millisecond. Fine for small fan-out; at scale, SSE or WebSockets fit better.</li>
  <li><strong>Each waiting client holds a connection.</strong> Cheap in Go (a goroutine per request), expensive on thread-per-request servers where 10,000 waiters means 10,000 blocked threads.</li>
  <li><strong>Browser connection limits.</strong> Over HTTP/1.1, browsers allow about 6 connections per host, and a held request uses one of them for its whole duration.</li>
  <li><strong>Caches must stay out.</strong> Send <code>Cache-Control: no-store</code> so no proxy or CDN serves a stale "nothing new".</li>
</ul>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>Long polling = request held open until there's data or a timeout, then immediately re-sent.</li>
  <li>Always pair it with a cursor (<code>after=ID</code>) and a server-side log, or events get lost.</li>
  <li>Keep the hold time under every proxy's idle timeout, and back off with jitter on errors.</li>
  <li>Great when you need only plain HTTP; for heavy fan-out or high message rates, use SSE or WebSockets.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#server-sent-events">Server-Sent Events</a> · <a href="#websockets">WebSockets</a> · <a href="#webhooks">Webhooks</a> · <a href="#message-queues">Message Queues</a> · <a href="#timeouts">Timeouts</a> · <a href="#idempotency">Idempotency</a></p>
`;


CONTENT["server-sent-events"] = `
<p class="tldr"><strong>TL;DR</strong>: Server-Sent Events (SSE) is a server-to-browser stream over a single, ordinary HTTP response that never ends. The server writes small text events whenever it has news; the browser's built-in <code>EventSource</code> parses them, and <strong>reconnects and resumes automatically</strong> if the connection drops. One-way, simple, and plain HTTP.</p>

<h2>The problem it solves</h2>
<p>Many "real-time" features only need data flowing <em>one</em> way, from server to client: notifications, live dashboards, stock tickers, build logs, progress bars, and the token-by-token answers of AI chat apps. For these:</p>
<ul>
  <li><strong>Polling</strong> wastes requests and adds delay.</li>
  <li><strong><a href="#long-polling">Long polling</a></strong> pays a full request for every message and needs a hand-built cursor.</li>
  <li><strong><a href="#websockets">WebSockets</a></strong> work, but bring a separate protocol, no automatic reconnect, and load balancers and proxies that must support upgrades, all for a channel you only use in one direction.</li>
</ul>
<p>SSE (part of the HTML standard) is "just HTTP": it passes through the same proxies, load balancers, auth and logging as your other endpoints, and works especially well over HTTP/2.</p>

<h2>How it works</h2>
<ol>
  <li>The browser opens <code>new EventSource("/prices")</code>, which sends a <code>GET</code> with <code>Accept: text/event-stream</code>.</li>
  <li>The server answers <code>200</code> with <code>Content-Type: text/event-stream</code> and <strong>never finishes the response</strong>. It writes events as plain text and flushes each one.</li>
  <li>Each event is a few <code>field: value</code> lines ending in a blank line: <code>data:</code> (the payload), optional <code>event:</code> (a type name), <code>id:</code> (for resuming), <code>retry:</code> (reconnect delay in ms). Lines starting with <code>:</code> are comments, handy as heartbeats.</li>
  <li>If the connection drops, the browser waits (a few seconds, or the <code>retry</code> value), reconnects, and sends <code>Last-Event-ID</code> with the last ID it saw, so the server can send only what was missed.</li>
</ol>

<figure class="diagram">
<svg viewBox="0 0 780 432" role="img" aria-label="SSE: the browser sends one GET with Accept text/event-stream; the server replies 200 text/event-stream and keeps writing events with id, event and data lines, plus comment heartbeats. The connection drops; the browser reconnects with Last-Event-ID 42 and the server resumes from event 43.">
  <defs><marker id="arr-sse-1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <rect class="box" x="40" y="16" width="140" height="36" rx="8"/><text x="110" y="39" text-anchor="middle">Browser</text>
  <rect class="box" x="600" y="16" width="140" height="36" rx="8"/><text x="670" y="39" text-anchor="middle">Server</text>
  <path class="line dashed" d="M110 52 V425 M670 52 V425" style="stroke: var(--line)"/>
  <text x="390" y="80" text-anchor="middle" class="small">GET /prices   Accept: text/event-stream</text>
  <path class="line" d="M110 88 H668" marker-end="url(#arr-sse-1)"/>
  <text x="390" y="112" text-anchor="middle" class="small">200   Content-Type: text/event-stream   (response never ends)</text>
  <path class="line dashed" d="M670 120 H112" marker-end="url(#arr-sse-1)"/>

  <rect class="box muted" x="200" y="134" width="380" height="160" rx="8"/>
  <text x="220" y="156">id: 41</text>
  <text x="220" y="174">event: price</text>
  <text x="220" y="192">data: {"sym":"AAPL","p":231.5}</text>
  <text x="220" y="210" class="small">(blank line = end of event)</text>
  <text x="220" y="232">: ping</text>
  <text x="330" y="232" class="small">comment: a heartbeat, ignored</text>
  <text x="220" y="254">id: 42</text>
  <text x="220" y="272">event: price</text>
  <text x="220" y="290" class="small">data: …</text>
  <path class="line ok dashed" d="M670 214 H582" marker-end="url(#arr-sse-1)"/>
  <path class="line ok dashed" d="M198 214 H112" marker-end="url(#arr-sse-1)"/>

  <path class="line bad" d="M670 318 H520"/>
  <text x="390" y="322" text-anchor="middle" class="small">✗ connection drops</text>
  <text x="390" y="344" text-anchor="middle" class="small">browser waits (retry), then reconnects by itself</text>
  <text x="390" y="368" text-anchor="middle" class="small">GET /prices   Last-Event-ID: 42</text>
  <path class="line accent" d="M110 376 H668" marker-end="url(#arr-sse-1)"/>
  <text x="390" y="400" text-anchor="middle" class="small">id: 43 …  resumes exactly where it left off</text>
  <path class="line ok dashed" d="M670 408 H112" marker-end="url(#arr-sse-1)"/>
</svg>
<figcaption>The whole protocol is text over one long HTTP response. Reconnect and resume (<code>Last-Event-ID</code>) are built into the browser; the server only has to honour the ID.</figcaption>
</figure>

<h3>SSE or something else?</h3>
<figure class="diagram">
<svg viewBox="0 0 780 345" role="img" aria-label="Decision ladder: if the receiver is another server, use webhooks. If the client also sends messages often, use WebSockets. If a streaming HTTP response can stay open end to end, use Server-Sent Events. Otherwise use long polling.">
  <defs><marker id="arr-sse-2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <rect class="box accent" x="20" y="15" width="390" height="44" rx="10"/>
  <text x="215" y="42" text-anchor="middle">Is the receiver another server, not a browser?</text>
  <rect class="box accent" x="20" y="95" width="390" height="44" rx="10"/>
  <text x="215" y="122" text-anchor="middle">Does the client also send messages often?</text>
  <rect class="box accent" x="20" y="175" width="390" height="44" rx="10"/>
  <text x="215" y="202" text-anchor="middle">Can a streaming response stay open end to end?</text>
  <rect class="box ok" x="20" y="255" width="390" height="50" rx="10"/>
  <text x="215" y="277" text-anchor="middle" class="title">Long polling</text>
  <text x="215" y="295" text-anchor="middle" class="small">works through anything that speaks HTTP</text>

  <rect class="box ok" x="500" y="12" width="260" height="50" rx="10"/>
  <text x="630" y="34" text-anchor="middle" class="title">Webhooks</text>
  <text x="630" y="52" text-anchor="middle" class="small">the provider POSTs to your URL</text>
  <rect class="box ok" x="500" y="92" width="260" height="50" rx="10"/>
  <text x="630" y="114" text-anchor="middle" class="title">WebSockets</text>
  <text x="630" y="132" text-anchor="middle" class="small">chat, games, collaboration</text>
  <rect class="box ok" x="500" y="172" width="260" height="50" rx="10"/>
  <text x="630" y="194" text-anchor="middle" class="title">Server-Sent Events</text>
  <text x="630" y="212" text-anchor="middle" class="small">feeds, notifications, AI token streams</text>

  <path class="line" d="M410 37 H498" marker-end="url(#arr-sse-2)"/><text x="454" y="30" text-anchor="middle" class="small">yes</text>
  <path class="line" d="M410 117 H498" marker-end="url(#arr-sse-2)"/><text x="454" y="110" text-anchor="middle" class="small">yes</text>
  <path class="line" d="M410 197 H498" marker-end="url(#arr-sse-2)"/><text x="454" y="190" text-anchor="middle" class="small">yes</text>
  <path class="line" d="M215 59 V93" marker-end="url(#arr-sse-2)"/><text x="225" y="81" class="small">no</text>
  <path class="line" d="M215 139 V173" marker-end="url(#arr-sse-2)"/><text x="225" y="161" class="small">no</text>
  <path class="line" d="M215 219 V253" marker-end="url(#arr-sse-2)"/><text x="225" y="241" class="small">no</text>
  <text x="390" y="335" text-anchor="middle" class="small">Updates rare, and a few seconds of delay is fine? Plain polling every N seconds beats all of these for simplicity.</text>
</svg>
<figcaption>Most "we need WebSockets" features are actually one-way, and SSE covers them with less machinery.</figcaption>
</figure>

<h2>SSE vs WebSockets</h2>
<table>
  <tr><th></th><th>Server-Sent Events</th><th>WebSockets</th></tr>
  <tr><td>Direction</td><td>server → client only (client uses normal requests to send)</td><td>both ways on one connection</td></tr>
  <tr><td>Protocol</td><td>plain HTTP response, text format</td><td>HTTP upgrade into a separate framed protocol</td></tr>
  <tr><td>Data</td><td>UTF-8 text (binary must be encoded, e.g. base64)</td><td>text and binary</td></tr>
  <tr><td>Reconnect and resume</td><td>automatic, with <code>Last-Event-ID</code></td><td>build it yourself</td></tr>
  <tr><td>Infrastructure</td><td>normal HTTP: proxies, auth, logging, HTTP/2 multiplexing</td><td>needs upgrade support and special handling</td></tr>
  <tr><td>Browser connection limit</td><td>about 6 per host on HTTP/1.1 (shared across tabs); plenty on HTTP/2</td><td>separate, much higher limit</td></tr>
</table>

<h2>Example</h2>
<p><strong>A price stream in Go.</strong> Nothing beyond the standard library: set the headers, write events, flush. The <code>Last-Event-ID</code> header tells us where a reconnecting client left off.</p>
<pre><code>func (b *Broker) ServePrices(w http.ResponseWriter, r *http.Request) {
	rc := http.NewResponseController(w)
	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-store")
	h.Set("X-Accel-Buffering", "no") // ask nginx not to buffer this response

	// 0 on first connect; on reconnect, the last id the browser saw
	lastID, _ := strconv.Atoi(r.Header.Get("Last-Event-ID"))
	updates, unsubscribe := b.Subscribe(lastID) // replays missed events, then live ones
	defer unsubscribe()

	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()

	msg := "retry: 3000&#92;n&#92;n" // reconnect 3 s after a drop
	for {
		// per-write deadline: the server-wide WriteTimeout would end the stream
		rc.SetWriteDeadline(time.Now().Add(10 * time.Second))
		if _, err := io.WriteString(w, msg); err != nil {
			return
		}
		if err := rc.Flush(); err != nil { // send it now, don't wait for a full buffer
			return
		}

		select {
		case p := &lt;-updates:
			msg = fmt.Sprintf("id: %d&#92;nevent: price&#92;ndata: %s&#92;n&#92;n", p.ID, p.JSON)
		case &lt;-heartbeat.C:
			msg = ": ping&#92;n&#92;n" // comment line: keeps idle-timeout proxies happy
		case &lt;-r.Context().Done():
			return // tab closed or connection lost
		}
	}
}</code></pre>
<p>The browser side is a few lines, and reconnect/resume come for free:</p>
<pre><code>const prices = new EventSource("/prices");
prices.addEventListener("price", (e) =&gt; updateTicker(JSON.parse(e.data)));
// Drops are handled for you: it reconnects and sends Last-Event-ID.</code></pre>
<p>See the raw stream from a terminal (<code>-N</code> turns off curl's buffering):</p>
<pre><code>$ curl -N localhost:8080/prices
retry: 3000

id: 41
event: price
data: {"sym":"AAPL","p":231.5}

: ping</code></pre>

<p><strong>Real-world scenario: "the AI answer appears all at once".</strong> LLM APIs (OpenAI's, Anthropic's) stream tokens as SSE, and so do most chat UIs built on them. A team's streaming endpoint worked locally, but in production users saw nothing for 15 seconds and then the whole answer at once. The culprit: nginx in front of the service buffers responses by default, and a gzip middleware also waited for a full buffer. The fix: <code>X-Accel-Buffering: no</code> (or <code>proxy_buffering off</code> for that location), no compression on <code>text/event-stream</code>, and an explicit flush after every event. Note that such clients often use <code>fetch()</code> and read the stream themselves instead of <code>EventSource</code>, because they need a <code>POST</code> body and an <code>Authorization</code> header, which <code>EventSource</code> can't send.</p>

<h2>Retries: when the server goes down or restarts</h2>
<p><code>EventSource</code> reconnects by itself, but <strong>not in every case</strong>, and that difference decides whether your users recover from a deploy or stare at a frozen page. It helps to know its three states:</p>

<figure class="diagram">
<svg viewBox="0 0 780 292" role="img" aria-label="EventSource states. CONNECTING goes to OPEN on a 200 response with text/event-stream. OPEN goes back to CONNECTING when the network drops or the stream ends, and the browser retries after the retry delay. CONNECTING goes to CLOSED on a non-200 status such as 502 or 503, or a wrong Content-Type. OPEN goes to CLOSED when your code calls close. From CLOSED the browser never retries; your code must create a new EventSource.">
  <defs><marker id="arr-sse-3" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <rect class="box accent" x="30" y="95" width="190" height="64" rx="10"/>
  <text x="125" y="122" text-anchor="middle" class="title">CONNECTING</text>
  <text x="125" y="142" text-anchor="middle" class="small">readyState 0</text>
  <rect class="box ok" x="560" y="95" width="190" height="64" rx="10"/>
  <text x="655" y="122" text-anchor="middle" class="title">OPEN</text>
  <text x="655" y="142" text-anchor="middle" class="small">readyState 1, events flowing</text>
  <rect class="box bad" x="295" y="200" width="190" height="56" rx="10"/>
  <text x="390" y="224" text-anchor="middle" class="title">CLOSED</text>
  <text x="390" y="243" text-anchor="middle" class="small">readyState 2, no more retries</text>

  <text x="390" y="104" text-anchor="middle" class="small">200 + Content-Type: text/event-stream</text>
  <path class="line ok" d="M220 112 H558" marker-end="url(#arr-sse-3)"/>
  <path class="line accent dashed" d="M560 142 H222" marker-end="url(#arr-sse-3)"/>
  <text x="390" y="160" text-anchor="middle" class="small">drop, crash or stream end: retry after "retry" ms</text>
  <path class="line bad" d="M150 159 L293 220" marker-end="url(#arr-sse-3)"/>
  <text x="20" y="252" class="small">non-200 (502, 503, 404…),</text>
  <text x="20" y="267" class="small">wrong Content-Type, or 204</text>
  <path class="line" d="M630 159 L487 220" marker-end="url(#arr-sse-3)"/>
  <text x="590" y="214" class="small">your code calls es.close()</text>
  <text x="390" y="284" text-anchor="middle" class="small">From CLOSED, only your code can start again: create a new EventSource (with backoff).</text>
</svg>
<figcaption>Dropped connections are retried automatically. An <em>error response</em> is not: a single 502 from the load balancer during a deploy stops the stream for good.</figcaption>
</figure>

<p>What happens in the common failure cases:</p>
<table>
  <tr><th>What happened</th><th>What the browser does</th><th>What you need</th></tr>
  <tr><td>Network blip, server process crashed, or the server ended the response</td><td>goes back to CONNECTING, waits the <code>retry</code> delay (a few seconds by default), reconnects with <code>Last-Event-ID</code></td><td>nothing, as long as the server can replay events after that ID</td></tr>
  <tr><td>Server restarting: load balancer answers <code>502</code> / <code>503</code></td><td><strong>gives up</strong>: CLOSED, one <code>error</code> event, no more retries</td><td>your own retry with exponential backoff and jitter</td></tr>
  <tr><td>Server down, nothing listening (connection refused)</td><td>keeps retrying at the <code>retry</code> interval, forever, with no backoff in practice</td><td>a sensible <code>retry</code> value; optionally your own backoff</td></tr>
  <tr><td>Connection silently dead (no FIN: Wi-Fi gone, NAT dropped it)</td><td>may not notice for minutes</td><td>a client-side watchdog on heartbeats</td></tr>
  <tr><td>Server wants clients to stop (feature off, logged out)</td><td>stops on <code>204 No Content</code></td><td>return 204 on purpose</td></tr>
</table>

<h3>Client: retry what the browser won't</h3>
<p>When the browser gives up (CLOSED), create a new <code>EventSource</code> with exponential backoff and jitter. One catch: a <em>new</em> <code>EventSource</code> doesn't send <code>Last-Event-ID</code>, so pass the last ID yourself in the URL. Heartbeats sent as SSE comments never reach JavaScript, so if you want a watchdog, send them as a named event instead (<code>event: ping</code> plus <code>data: {}</code>; an event with no data line is never delivered).</p>
<pre><code>let lastId = "";
let delay = 1000;

function connect() {
  const url = lastId ? &#96;/prices?lastEventId=&#36;{lastId}&#96; : "/prices";
  const es = new EventSource(url);
  let watchdog;
  const resetWatchdog = () =&gt; {
    clearTimeout(watchdog);
    watchdog = setTimeout(() =&gt; { es.close(); retry(); }, 45000); // no ping for 45 s: assume dead
  };

  es.onopen = () =&gt; { delay = 1000; resetWatchdog(); };  // healthy again: reset backoff
  es.addEventListener("ping", resetWatchdog);
  es.addEventListener("price", (e) =&gt; {
    lastId = e.lastEventId;
    resetWatchdog();
    updateTicker(JSON.parse(e.data));
  });
  es.onerror = () =&gt; {
    if (es.readyState === EventSource.CLOSED) {  // the browser gave up (e.g. a 502 during a deploy)
      clearTimeout(watchdog);
      retry();
    }
    // readyState CONNECTING: the browser is already retrying by itself
  };
}

function retry() {
  setTimeout(connect, delay / 2 + Math.random() * delay);  // jitter: don't reconnect in lockstep
  delay = Math.min(delay * 2, 30000);                      // exponential backoff, capped at 30 s
}

connect();</code></pre>

<h3>Server: restart without a stampede</h3>
<p>On a restart, two things go wrong by default. First, in Go, <code>http.Server.Shutdown</code> waits for active requests to finish, and an SSE stream never finishes, so shutdown just hangs until it's killed, and every stream dies abruptly at once. Second, all those clients reconnect at the same moment. The fix: on shutdown, tell each stream to end cleanly, and give each client a <em>random</em> <code>retry</code> so reconnects spread out over several seconds.</p>
<pre><code>func main() {
	broker := NewBroker()
	srv := &amp;http.Server{Addr: ":8080", Handler: routes(broker)}
	srv.RegisterOnShutdown(broker.Close) // runs when Shutdown starts: closes broker.done

	go func() {
		if err := srv.ListenAndServe(); err != http.ErrServerClosed {
			log.Fatal(err)
		}
	}()

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, os.Interrupt)
	defer stop()
	&lt;-ctx.Done() // Kubernetes / ECS sends SIGTERM before stopping the container

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	srv.Shutdown(shutdownCtx) // stop accepting; normal requests finish; streams end below
}

// Inside the stream loop of ServePrices, one more case:
case &lt;-b.done:
	// Server is going away: end the stream cleanly, and spread
	// the reconnects over 1–10 s so the new instances aren't stampeded.
	fmt.Fprintf(w, "retry: %d&#92;n&#92;n", 1000+rand.IntN(9000))
	rc.Flush()
	return</code></pre>
<p>Ending the response normally puts the browser back in CONNECTING (it will retry), unlike a 502. Two more things make restarts painless:</p>
<ul>
  <li><strong>Accept the ID from the URL too</strong>: read <code>Last-Event-ID</code> from the header, and fall back to <code>?lastEventId=</code> for clients that re-created their <code>EventSource</code>.</li>
  <li><strong>Keep event history outside the process.</strong> After a restart, an in-memory buffer is empty, so <code>Last-Event-ID: 42</code> means nothing. Store recent events in Redis Streams or a database, or send a full snapshot when the ID is unknown.</li>
</ul>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>Buffering anywhere breaks it.</strong> Proxies, CDNs and compression middleware that buffer responses turn a stream into one late blob. Disable buffering for the endpoint and flush after each event.</li>
  <li><strong>The 6-connection limit on HTTP/1.1.</strong> Each <code>EventSource</code> holds a connection, and the browser limit is per host across all tabs: the seventh tab hangs. Serve SSE over HTTP/2 (100+ streams on one connection) or share one stream between tabs.</li>
  <li><strong>Server timeouts kill streams.</strong> In Go, <code>http.Server.WriteTimeout</code> applies to the whole response, so a 30 s timeout ends every stream after 30 s. Extend it per write with <code>ResponseController.SetWriteDeadline</code>, as in the example.</li>
  <li><strong>Idle connections get cut.</strong> Load balancers drop quiet connections (AWS ALB after 60 s by default). Send a comment heartbeat (<code>: ping</code>) every 15–30 s.</li>
  <li><strong>Resuming needs history.</strong> <code>Last-Event-ID</code> only helps if the server can replay events after that ID. Keep a bounded buffer, and if the ID is too old, send a full snapshot instead.</li>
  <li><strong><code>EventSource</code> is limited.</strong> GET only, no custom headers (cookies via <code>withCredentials</code> are the auth option). Need POST or a bearer token? Use <code>fetch()</code> with a stream reader.</li>
  <li><strong>One-way and text-only.</strong> The client sends through normal requests; binary data needs encoding. If both directions are busy, use <a href="#websockets">WebSockets</a>.</li>
  <li><strong>Slow readers still need limits.</strong> Each subscriber needs a bounded buffer; drop or disconnect clients that fall too far behind (see <a href="#backpressure">Backpressure</a>).</li>
</ul>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>SSE = one never-ending HTTP response of small text events, server → client.</li>
  <li>Built-in reconnect and resume (<code>id:</code> + <code>Last-Event-ID</code>) make it more robust than hand-rolled alternatives.</li>
  <li>Disable buffering, flush every event, send heartbeats, and prefer HTTP/2.</li>
  <li>Dropped connections retry automatically, but a 502/503 closes <code>EventSource</code> for good: recreate it with backoff, and end streams cleanly with a random <code>retry</code> on shutdown.</li>
  <li>Default to SSE for one-way pushes; reach for WebSockets only when the client talks a lot too.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#websockets">WebSockets</a> · <a href="#long-polling">Long Polling</a> · <a href="#http-2-http-3">HTTP/2 &amp; HTTP/3</a> · <a href="#pub-sub">Pub/Sub</a> · <a href="#backpressure">Backpressure</a> · <a href="#timeouts">Timeouts</a></p>
`;


CONTENT["webhooks"] = `
<p class="tldr"><strong>TL;DR</strong>: A webhook is a "don't call us, we'll call you" between servers. You give a provider (Stripe, GitHub, Shopify…) a URL; when something happens on their side, they send an HTTP <code>POST</code> with the event to that URL. Your job is to <strong>verify</strong> it really came from them, <strong>store</strong> it, answer <strong>2xx quickly</strong>, and process it safely even when it arrives twice or out of order.</p>

<h2>The problem it solves</h2>
<p>Your system needs to know when something happens in <em>someone else's</em> system: a payment succeeded, a pull request was opened, an order shipped. Without webhooks, you'd poll their API:</p>
<ul>
  <li><strong>Wasteful</strong>: thousands of "any new payments?" calls, nearly all empty, often eating into the provider's rate limits.</li>
  <li><strong>Slow</strong>: you learn about events up to one polling interval late.</li>
  <li><strong>Doesn't scale</strong>: cost grows with customers × polling frequency, not with real activity.</li>
</ul>
<p>With a webhook, the provider tells you once, at the moment it happens. It's the server-to-server cousin of <a href="#server-sent-events">SSE</a> and <a href="#websockets">WebSockets</a>, built on plain HTTP requests.</p>

<figure class="diagram">
<svg viewBox="0 0 780 212" role="img" aria-label="Polling every 60 seconds: 11 requests, 10 of them empty, and the payment is found about 40 seconds late. Webhook: one request, sent the moment the payment succeeds.">
  <text x="410" y="16" text-anchor="middle" class="small">payment succeeds</text>
  <path class="line dashed accent" d="M410 22 V160"/>
  <text x="20" y="60" class="title">Polling</text><text x="20" y="77" class="small">every 60 s</text>
  <path class="line" d="M150 60 H760" style="stroke: var(--line)"/>
  <rect class="box muted" x="145" y="48" width="10" height="24" rx="2"/>
  <rect class="box muted" x="205" y="48" width="10" height="24" rx="2"/>
  <rect class="box muted" x="265" y="48" width="10" height="24" rx="2"/>
  <rect class="box muted" x="325" y="48" width="10" height="24" rx="2"/>
  <rect class="box muted" x="385" y="48" width="10" height="24" rx="2"/>
  <rect class="box ok" x="445" y="48" width="10" height="24" rx="2"/>
  <rect class="box muted" x="505" y="48" width="10" height="24" rx="2"/>
  <rect class="box muted" x="565" y="48" width="10" height="24" rx="2"/>
  <rect class="box muted" x="625" y="48" width="10" height="24" rx="2"/>
  <rect class="box muted" x="685" y="48" width="10" height="24" rx="2"/>
  <rect class="box muted" x="745" y="48" width="10" height="24" rx="2"/>
  <text x="442" y="94" class="small">found ~40 s late</text>
  <text x="150" y="94" class="small">11 requests, 10 empty</text>

  <text x="20" y="136" class="title">Webhook</text>
  <path class="line" d="M150 130 H760" style="stroke: var(--line)"/>
  <rect class="box ok" x="412" y="118" width="10" height="24" rx="2"/>
  <text x="432" y="135" class="small">1 request, the moment it happens</text>
  <text x="390" y="198" text-anchor="middle" class="small">Polling cost grows with customers × frequency; webhook cost grows only with real events.</text>
</svg>
<figcaption>Same 10 minutes, same single payment. Polling pays for every empty check and still finds out late.</figcaption>
</figure>

<h2>How it works</h2>
<ol>
  <li><strong>Register</strong> an HTTPS endpoint with the provider (e.g. <code>https://api.example.com/webhooks/stripe</code>), choose which events you want, and get a <strong>signing secret</strong>.</li>
  <li><strong>An event happens</strong>; the provider POSTs JSON describing it, with an event ID and a <strong>signature header</strong>: an HMAC of the raw body (often plus a timestamp) computed with the shared secret.</li>
  <li><strong>Your endpoint</strong> recomputes the HMAC over the exact bytes received and compares. No match → reject. Then it saves the event (deduplicated by ID) and returns <code>2xx</code> right away.</li>
  <li><strong>A worker</strong> processes the saved event in the background: mark the order paid, send the receipt, etc.</li>
  <li><strong>If you don't answer 2xx in time</strong>, the provider treats it as failed and, for most providers, <strong>retries with backoff</strong> (Stripe keeps trying for up to 3 days in live mode). GitHub doesn't retry automatically, but lets you redeliver by hand.</li>
</ol>

<figure class="diagram">
<svg viewBox="0 0 780 300" role="img" aria-label="Provider posts a signed event to your endpoint, which verifies the signature, stores the event in a queue or outbox and replies 200 quickly. A worker processes it. If the endpoint fails, the provider retries, so events may arrive twice or out of order.">
  <defs><marker id="arr-wh-1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <rect class="box" x="20" y="30" width="140" height="64" rx="10"/>
  <text x="90" y="56" text-anchor="middle" class="title">Provider</text>
  <text x="90" y="76" text-anchor="middle" class="small">Stripe, GitHub, …</text>
  <rect class="box accent" x="300" y="30" width="190" height="64" rx="10"/>
  <text x="395" y="56" text-anchor="middle" class="title">Your endpoint</text>
  <text x="395" y="76" text-anchor="middle" class="small">verify, store, reply</text>
  <rect class="box" x="580" y="30" width="180" height="64" rx="10"/>
  <text x="670" y="56" text-anchor="middle" class="title">Queue / outbox table</text>
  <text x="670" y="76" text-anchor="middle" class="small">deduped by event ID</text>
  <rect class="box ok" x="580" y="150" width="180" height="56" rx="10"/>
  <text x="670" y="174" text-anchor="middle" class="title">Worker</text>
  <text x="670" y="193" text-anchor="middle" class="small">does the slow work</text>

  <text x="230" y="44" text-anchor="middle" class="small">1 POST + signature</text>
  <path class="line" d="M160 52 H298" marker-end="url(#arr-wh-1)"/>
  <path class="line ok dashed" d="M300 76 H162" marker-end="url(#arr-wh-1)"/>
  <text x="230" y="92" text-anchor="middle" class="small">3 200, fast</text>
  <text x="535" y="56" text-anchor="middle" class="small">2 save</text>
  <path class="line" d="M490 62 H578" marker-end="url(#arr-wh-1)"/>
  <path class="line" d="M670 94 V148" marker-end="url(#arr-wh-1)"/>
  <text x="680" y="126" class="small">4 process</text>

  <rect class="box muted" x="20" y="150" width="470" height="120" rx="10"/>
  <text x="40" y="174" class="title">When your endpoint is slow or failing</text>
  <text x="40" y="198" class="small">• the provider retries with backoff, for hours or days</text>
  <text x="40" y="218" class="small">• the same event can arrive twice (or more)</text>
  <text x="40" y="238" class="small">• events can arrive out of order ("updated" before "created")</text>
  <text x="40" y="258" class="small">• so: dedupe by event ID, and never assume order</text>
</svg>
<figcaption>Verify, store, acknowledge, then process asynchronously. The endpoint's only job is to accept the event safely; the real work happens off the request path.</figcaption>
</figure>

<h2>How providers sign webhooks</h2>
<table>
  <tr><th>Provider</th><th>Header</th><th>What's signed (HMAC-SHA256)</th><th>Replay protection</th></tr>
  <tr><td>GitHub</td><td><code>X-Hub-Signature-256: sha256=&lt;hex&gt;</code></td><td>the raw body</td><td>none built in: dedupe on <code>X-GitHub-Delivery</code></td></tr>
  <tr><td>Stripe</td><td><code>Stripe-Signature: t=&lt;ts&gt;,v1=&lt;hex&gt;</code></td><td><code>timestamp + "." + body</code></td><td>reject old timestamps (the libraries default to 5 minutes)</td></tr>
  <tr><td>Slack</td><td><code>X-Slack-Signature: v0=&lt;hex&gt;</code> + <code>X-Slack-Request-Timestamp</code></td><td><code>"v0:" + timestamp + ":" + body</code></td><td>reject old timestamps</td></tr>
  <tr><td>Standard Webhooks spec</td><td><code>webhook-id</code>, <code>webhook-timestamp</code>, <code>webhook-signature</code></td><td><code>id + "." + timestamp + "." + body</code></td><td>timestamp window + ID dedupe</td></tr>
</table>
<p>The pattern is always the same: a shared secret, an HMAC over the <em>exact raw bytes</em>, a constant-time comparison, and ideally a timestamp so a captured request can't be replayed later.</p>

<h2>Example</h2>
<p><strong>A GitHub webhook receiver in Go</strong>: read raw bytes, verify, save once, acknowledge.</p>
<pre><code>func (h *Handler) GitHub(w http.ResponseWriter, r *http.Request) {
	// Read the RAW bytes: the signature covers them exactly. Cap the size.
	body, err := io.ReadAll(io.LimitReader(r.Body, 1&lt;&lt;20))
	if err != nil {
		http.Error(w, "read error", http.StatusBadRequest)
		return
	}
	if !validSignature(h.secret, body, r.Header.Get("X-Hub-Signature-256")) {
		http.Error(w, "bad signature", http.StatusUnauthorized)
		return
	}

	// Same ID when GitHub redelivers, so it doubles as the dedupe key.
	deliveryID := r.Header.Get("X-GitHub-Delivery")
	inserted, err := h.store.SaveOnce(r.Context(), deliveryID, r.Header.Get("X-GitHub-Event"), body)
	if err != nil {
		http.Error(w, "try again", http.StatusInternalServerError) // non-2xx = delivery failed
		return
	}
	if inserted {
		h.worker.Wake() // the slow work happens off the request path
	}
	w.WriteHeader(http.StatusAccepted) // 2xx for duplicates too: we already have it
}

func validSignature(secret, body []byte, header string) bool {
	hexSig, ok := strings.CutPrefix(header, "sha256=")
	if !ok {
		return false
	}
	got, err := hex.DecodeString(hexSig)
	if err != nil {
		return false
	}
	mac := hmac.New(sha256.New, secret)
	mac.Write(body)
	return hmac.Equal(got, mac.Sum(nil)) // constant-time comparison
}</code></pre>
<p>The "save once" is one SQL statement. The unique key on the delivery ID turns duplicates into no-ops:</p>
<pre><code>CREATE TABLE webhook_events (
  delivery_id  TEXT PRIMARY KEY,
  event_type   TEXT NOT NULL,
  payload      JSONB NOT NULL,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ          -- set by the worker when done
);

-- SaveOnce: 1 row affected = new event, 0 = duplicate
INSERT INTO webhook_events (delivery_id, event_type, payload)
VALUES ($1, $2, $3)
ON CONFLICT (delivery_id) DO NOTHING;</code></pre>
<p><strong>Testing locally.</strong> Providers can't reach <code>localhost</code>, so use a tunnel (<code>ngrok http 8080</code>) or the provider's CLI, e.g. <code>stripe listen --forward-to localhost:8080/webhooks/stripe</code>. Or sign a request yourself:</p>
<pre><code>$ body='{"action":"opened","number":7}'
$ sig=$(printf '%s' "$body" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | sed 's/^.* //')
$ curl -i localhost:8080/webhooks/github &#92;
    -H "X-Hub-Signature-256: sha256=$sig" &#92;
    -H "X-GitHub-Delivery: test-1" -H "X-GitHub-Event: pull_request" &#92;
    -d "$body"
HTTP/1.1 202 Accepted</code></pre>

<h3>If you're the one sending webhooks</h3>
<ul>
  <li><strong>Sign every request</strong> and include a timestamp and a unique event ID.</li>
  <li><strong>Retry with <a href="#exponential-backoff">exponential backoff</a></strong>, give up after a while, and keep failed events where customers can see and redeliver them (a <a href="#dead-letter-queues">dead-letter queue</a>). Disable endpoints that fail for days.</li>
  <li><strong>Protect yourself from <a href="#ssrf">SSRF</a></strong>: customers choose the URL, so block private and internal addresses (<code>10.x</code>, <code>169.254.169.254</code>, <code>localhost</code>), including after redirects and DNS changes.</li>
  <li><strong>Thin vs fat payloads.</strong> Sending only "order 123 changed" (thin) forces receivers to fetch the latest state, which also solves ordering problems. Sending the full object (fat) saves them a call but can be stale by the time it's processed.</li>
</ul>

<p><strong>Real-world scenario: three receipt emails.</strong> An endpoint for Stripe's <code>payment_intent.succeeded</code> did all the work inside the request: update the order, generate a PDF invoice, send the email. On a busy day this took longer than Stripe was willing to wait, so Stripe marked the delivery failed and retried. Each retry did the work again. Customers got three receipts, and some orders were fulfilled twice. The fix had two parts: the endpoint now only verifies, stores the event by its ID, and returns 200 within milliseconds; and the worker checks "already processed this event ID?" before doing anything (see <a href="#idempotency">Idempotency</a>).</p>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>Doing slow work before replying.</strong> Timeouts cause retries, retries cause duplicates. Acknowledge fast, process in the background (<a href="#message-queues">message queue</a> or outbox table).</li>
  <li><strong>Replying 200 before the event is safely stored.</strong> If the process crashes after replying, the event is gone for good. Persist first, then acknowledge.</li>
  <li><strong>Verifying the wrong bytes.</strong> Parse JSON and re-serialize it, and the bytes change, so the signature never matches. Always verify the raw body.</li>
  <li><strong>Comparing signatures with <code>==</code>.</strong> Normal comparison can leak timing information. Use <code>hmac.Equal</code> (constant-time).</li>
  <li><strong>Assuming exactly-once, in-order delivery.</strong> Webhooks are at-least-once and unordered. Dedupe by event ID, and when order matters, fetch the current state from the provider's API instead of trusting the payload.</li>
  <li><strong>Trusting webhooks as the only source of truth.</strong> Endpoints go down, events get dropped, retries run out. Run a periodic reconciliation job that lists recent objects from the API and fixes anything you missed.</li>
  <li><strong>Secret rotation.</strong> Rotating the signing secret without downtime means accepting both the old and new secret for a while.</li>
  <li><strong>IP allowlists alone aren't authentication.</strong> Providers publish their IP ranges, which is fine as an extra layer, but the signature is what proves authenticity.</li>
</ul>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>Webhook = the provider POSTs events to your URL; no polling.</li>
  <li>Verify the HMAC over the raw body, store the event, return 2xx fast, process asynchronously.</li>
  <li>Delivery is at-least-once and unordered: dedupe by event ID and don't rely on order.</li>
  <li>Back it up with a reconciliation job; when sending webhooks, sign, retry with backoff, and guard against SSRF.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#idempotency">Idempotency</a> · <a href="#retries">Retries</a> · <a href="#exponential-backoff">Exponential Backoff</a> · <a href="#message-queues">Message Queues</a> · <a href="#dead-letter-queues">Dead Letter Queues</a> · <a href="#ssrf">SSRF</a> · <a href="#event-driven-architecture">Event-Driven Architecture</a></p>
`;


CONTENT["real-time-trade-offs-use-cases"] = `
<p class="tldr"><strong>TL;DR</strong>: Long polling, SSE, WebSockets and webhooks all solve "tell me when something changes", but for different receivers and directions. Two questions decide most cases: <strong>who receives</strong> (a browser/app, or another server?) and <strong>who talks</strong> (only the server, or both sides?). After that, your infrastructure, scale, and how much missed data hurts decide the rest.</p>

<h2>The problem it solves</h2>
<p>Picking the wrong one is expensive in both directions:</p>
<ul>
  <li><strong>Over-engineering</strong>: teams reach for WebSockets for a notification bell, then spend months on sticky connections, deploy draining and custom reconnect logic that SSE gives for free.</li>
  <li><strong>Under-engineering</strong>: polling every second "because it's easy" until 50,000 users turn it into 50,000 requests per second of mostly empty answers.</li>
  <li><strong>Category errors</strong>: trying to send webhooks to browsers (browsers have no public URL), or using webhooks between your own microservices (where a queue is more reliable).</li>
</ul>
<p>This page puts the four concepts side by side: <a href="#long-polling">Long Polling</a>, <a href="#server-sent-events">Server-Sent Events</a>, <a href="#websockets">WebSockets</a> and <a href="#webhooks">Webhooks</a>.</p>

<h2>How to choose</h2>
<h3>The two questions that decide most cases</h3>
<figure class="diagram">
<svg viewBox="0 0 780 345" role="img" aria-label="Two by two grid. Browser or app receiving, only the server pushes: Server-Sent Events. Browser or app, both sides talk: WebSockets. Another server receiving, only the sender pushes: webhooks. Another server, both sides talk: not these four, use gRPC streaming or message queues.">
  <text x="315" y="40" text-anchor="middle" class="title">Receiver: a browser or app</text>
  <text x="620" y="40" text-anchor="middle" class="title">Receiver: another server</text>
  <text x="20" y="118" class="title">Only the</text><text x="20" y="136" class="title">server pushes</text>
  <text x="20" y="263" class="title">Both sides</text><text x="20" y="281" class="title">talk</text>

  <rect class="box ok" x="170" y="60" width="290" height="130" rx="10"/>
  <text x="315" y="92" text-anchor="middle" class="title">Server-Sent Events</text>
  <text x="315" y="116" text-anchor="middle" class="small">no streaming possible? long polling</text>
  <text x="315" y="136" text-anchor="middle" class="small">updates rare? plain polling</text>
  <text x="315" y="156" text-anchor="middle" class="small">app closed? mobile push (APNs / FCM)</text>

  <rect class="box ok" x="480" y="60" width="280" height="130" rx="10"/>
  <text x="620" y="92" text-anchor="middle" class="title">Webhooks</text>
  <text x="620" y="116" text-anchor="middle" class="small">payments, Git events, SaaS integrations</text>
  <text x="620" y="136" text-anchor="middle" class="small">receiver has no public URL?</text>
  <text x="620" y="152" text-anchor="middle" class="small">it long-polls the provider's API</text>

  <rect class="box ok" x="170" y="205" width="290" height="130" rx="10"/>
  <text x="315" y="237" text-anchor="middle" class="title">WebSockets</text>
  <text x="315" y="261" text-anchor="middle" class="small">chat, presence, collaborative editing</text>
  <text x="315" y="281" text-anchor="middle" class="small">fast action games: WebRTC / UDP</text>
  <text x="315" y="301" text-anchor="middle" class="small">blocked? long polling + normal POSTs</text>

  <rect class="box muted" x="480" y="205" width="280" height="130" rx="10"/>
  <text x="620" y="237" text-anchor="middle" class="title">Not these four</text>
  <text x="620" y="261" text-anchor="middle" class="small">gRPC streaming between services</text>
  <text x="620" y="281" text-anchor="middle" class="small">message queues or pub/sub for events</text>
  <text x="620" y="301" text-anchor="middle" class="small">(durable, internal, two-way)</text>
</svg>
<figcaption>Start here. The small lines are the usual adjustments: no streaming, rare updates, closed mobile apps, blocked networks. The detailed yes/no ladder is in <a href="#server-sent-events">Server-Sent Events</a>.</figcaption>
</figure>

<h3>Trade-offs side by side</h3>
<table>
  <tr><th></th><th>Long polling</th><th>SSE</th><th>WebSockets</th><th>Webhooks</th></tr>
  <tr><td>Receiver</td><td>any HTTP client</td><td>browser or app</td><td>browser or app</td><td>your server (needs a public URL)</td></tr>
  <tr><td>Direction</td><td>server → client (client sends with normal requests)</td><td>server → client</td><td>both ways</td><td>provider → your server</td></tr>
  <tr><td>Latency</td><td>low, plus a gap between requests</td><td>low</td><td>lowest</td><td>low, but retries can delay minutes or hours</td></tr>
  <tr><td>Idle cost</td><td>a held request per client, re-sent every ~25 s</td><td>one open connection + heartbeats</td><td>one open connection + pings</td><td>nothing</td></tr>
  <tr><td>Cost per message</td><td>a full HTTP request and response</td><td>a few bytes</td><td>2–14 bytes of framing</td><td>a full HTTP request</td></tr>
  <tr><td>Missed messages</td><td>you build a cursor (<code>after=ID</code>)</td><td>built in (<code>Last-Event-ID</code>), needs server history</td><td>you build it (sequence numbers)</td><td>provider retries; you reconcile via their API</td></tr>
  <tr><td>Duplicates and order</td><td>duplicates possible</td><td>duplicates possible on resume</td><td>whatever your protocol does</td><td>at-least-once, unordered</td></tr>
  <tr><td>Infrastructure</td><td>anything that speaks HTTP</td><td>plain HTTP, but buffering must be off</td><td>upgrade support, long-lived connections</td><td>a public HTTPS endpoint</td></tr>
  <tr><td>Scaling out</td><td>shared log so any server can wake waiters</td><td>pub/sub to every server</td><td>pub/sub, drain sockets on deploy</td><td>a queue behind the endpoint</td></tr>
  <tr><td>Auth</td><td>normal headers</td><td>cookies (<code>EventSource</code>) or <code>fetch</code> streaming</td><td>cookie + Origin check, or token in first message</td><td>HMAC signature</td></tr>
  <tr><td>Debugging</td><td>curl, DevTools</td><td><code>curl -N</code>, DevTools</td><td>websocat, DevTools WS view</td><td>request logs, provider's delivery dashboard</td></tr>
</table>

<h3>What it costs at scale</h3>
<p>Take 10,000 connected users who each get about one update per minute (about 167 updates per second in total). The cost doesn't disappear as you move right; it changes shape, from <em>requests per second</em> to <em>open connections</em>:</p>
<figure class="diagram">
<svg viewBox="0 0 780 230" role="img" aria-label="Ten thousand users, one update per minute each. Polling every 5 seconds: 2000 HTTP requests per second, almost no open connections, 2.5 seconds average delay. Long polling: about 500 requests per second, about 10000 open connections, near-zero delay. SSE and WebSockets: almost no HTTP requests, 10000 open connections, near-zero delay.">
  <text x="170" y="22" class="small">HTTP requests per second</text>
  <text x="630" y="22" text-anchor="middle" class="small">open connections</text>
  <text x="730" y="22" text-anchor="middle" class="small">avg delay</text>

  <text x="20" y="57" class="title">Polling (5 s)</text>
  <rect class="box accent" x="170" y="40" width="300" height="26" rx="4"/>
  <text x="480" y="58" class="small">2,000 req/s</text>
  <text x="630" y="58" text-anchor="middle">≈ 0</text>
  <text x="730" y="58" text-anchor="middle">2.5 s</text>

  <text x="20" y="102" class="title">Long polling</text>
  <rect class="box accent" x="170" y="85" width="75" height="26" rx="4"/>
  <text x="255" y="103" class="small">~500 req/s (2 timeouts + 1 update per user per minute)</text>
  <text x="630" y="103" text-anchor="middle">~10,000</text>
  <text x="730" y="103" text-anchor="middle">≈ 0</text>

  <text x="20" y="147" class="title">SSE</text>
  <rect class="box accent" x="170" y="130" width="3" height="26" rx="1"/>
  <text x="183" y="148" class="small">≈ 0: updates flow down open streams</text>
  <text x="630" y="148" text-anchor="middle">10,000</text>
  <text x="730" y="148" text-anchor="middle">≈ 0</text>

  <text x="20" y="192" class="title">WebSockets</text>
  <rect class="box accent" x="170" y="175" width="3" height="26" rx="1"/>
  <text x="183" y="193" class="small">≈ 0: updates flow down open sockets</text>
  <text x="630" y="193" text-anchor="middle">10,000</text>
  <text x="730" y="193" text-anchor="middle">≈ 0</text>
</svg>
<figcaption>Back-of-envelope numbers for the same workload. Polling burns requests and still lags; streaming approaches are cheap per message but make every user a long-lived connection your servers, load balancers and deploys must handle.</figcaption>
</figure>

<h2>Use cases</h2>
<table>
  <tr><th>Scenario</th><th>Pick</th><th>Why</th></tr>
  <tr><td>Team chat with typing indicators and presence</td><td>WebSockets</td><td>both sides send constantly, small messages, lowest latency</td></tr>
  <tr><td>Collaborative document or whiteboard</td><td>WebSockets</td><td>a stream of tiny edits in both directions</td></tr>
  <tr><td>Notification bell, activity feed</td><td>SSE</td><td>one-way, occasional, reconnects by itself</td></tr>
  <tr><td>AI assistant streaming its answer</td><td>SSE (often read with <code>fetch</code>)</td><td>one-way token stream; needs a POST body and auth header</td></tr>
  <tr><td>Live scores or stock ticker on a web page</td><td>SSE</td><td>one-way broadcast to many viewers, works with HTTP/2 and CDNs</td></tr>
  <tr><td>Tailing CI build logs</td><td>SSE</td><td>append-only text; resume from the last line with <code>Last-Event-ID</code></td></tr>
  <tr><td>Stripe confirms a payment</td><td>Webhooks, then SSE to the browser</td><td>the provider tells your server; your server tells the user's screen</td></tr>
  <tr><td>A push to GitHub triggers a deploy</td><td>Webhooks</td><td>server-to-server event from another company</td></tr>
  <tr><td>Workers reading jobs from AWS SQS</td><td>Long polling</td><td>built into the API (<code>WaitTimeSeconds</code>); fewer empty, billable requests</td></tr>
  <tr><td>Web app used behind strict corporate proxies</td><td>Long polling as a fallback</td><td>plain request/response gets through when upgrades and streams don't</td></tr>
  <tr><td>Fast multiplayer action game</td><td>WebSockets for the lobby, WebRTC/UDP for gameplay</td><td>for position updates, late data is worse than lost data (see <a href="#tcp-vs-udp">TCP vs UDP</a>)</td></tr>
  <tr><td>Admin dashboard that refreshes every minute</td><td>Plain polling</td><td>updates are rare, delay is fine, simplest to build and cache</td></tr>
  <tr><td>Mobile app is closed or the phone is locked</td><td>Push notifications (APNs, FCM)</td><td>none of the four can wake an app that isn't running</td></tr>
  <tr><td>One of your microservices notifies another</td><td><a href="#message-queues">Message queue</a> / <a href="#pub-sub">pub/sub</a>, or <a href="#grpc">gRPC</a> streaming</td><td>internal traffic needs durability and back-pressure, not public HTTP callbacks</td></tr>
</table>

<h3>They combine: a real checkout flow</h3>
<p>Real systems rarely use just one. Here's a checkout page waiting for "payment confirmed":</p>
<figure class="diagram">
<svg viewBox="0 0 780 262" role="img" aria-label="Checkout flow: the browser posts the checkout to your API and opens an SSE status stream. Stripe sends a signed webhook to your API when the payment succeeds. The API publishes to pub/sub, which pushes 'paid' down the SSE stream to the browser, and enqueues slow work such as the receipt email.">
  <defs><marker id="arr-rt-1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <rect class="box" x="20" y="95" width="130" height="60" rx="10"/>
  <text x="85" y="120" text-anchor="middle" class="title">Browser</text>
  <text x="85" y="139" text-anchor="middle" class="small">checkout page</text>
  <rect class="box accent" x="320" y="95" width="160" height="60" rx="10"/>
  <text x="400" y="120" text-anchor="middle" class="title">Your API</text>
  <text x="400" y="139" text-anchor="middle" class="small">orders service</text>
  <rect class="box" x="520" y="10" width="170" height="56" rx="10"/>
  <text x="605" y="34" text-anchor="middle" class="title">Stripe</text>
  <text x="605" y="53" text-anchor="middle" class="small">payment succeeds</text>
  <rect class="box" x="590" y="115" width="170" height="56" rx="10"/>
  <text x="675" y="139" text-anchor="middle" class="title">Queue → worker</text>
  <text x="675" y="158" text-anchor="middle" class="small">receipt email, fulfilment</text>
  <rect class="box" x="320" y="198" width="160" height="50" rx="10"/>
  <text x="400" y="220" text-anchor="middle" class="title">Pub/sub</text>
  <text x="400" y="238" text-anchor="middle" class="small">channel order:42</text>

  <text x="235" y="104" text-anchor="middle" class="small">1 POST /checkout</text>
  <path class="line" d="M150 110 H318" marker-end="url(#arr-rt-1)"/>
  <path class="line ok dashed" d="M320 138 H152" marker-end="url(#arr-rt-1)"/>
  <text x="235" y="128" text-anchor="middle" class="small">2 SSE status stream</text>
  <path class="line" d="M560 66 L470 95" marker-end="url(#arr-rt-1)"/>
  <text x="570" y="88" class="small">3 webhook (signed)</text>
  <path class="line" d="M480 140 H588" marker-end="url(#arr-rt-1)"/>
  <text x="534" y="134" text-anchor="middle" class="small">5 enqueue</text>
  <path class="line" d="M400 155 V196" marker-end="url(#arr-rt-1)"/>
  <text x="408" y="180" class="small">4 publish</text>
  <path class="line ok" d="M320 222 L100 158" marker-end="url(#arr-rt-1)"/>
  <text x="40" y="234" class="small">4 "paid" pushed to the page</text>
</svg>
<figcaption>Webhook in, SSE out, queue for the slow work. Each technique sits where it fits: server-to-server, server-to-browser, and server-to-worker.</figcaption>
</figure>

<div class="callout warn"><strong>The golden rule: the real-time channel is a hint, the API is the truth.</strong> Every approach on this page can miss or repeat messages: a socket drops, a stream reconnects, a webhook retry runs out. So on every (re)connect, fetch the current state from a normal API first, then apply live updates, and make handling idempotent by ID. Real-time makes it fast; the API makes it correct.</div>

<h2>Example</h2>
<p><strong>The checkout flow in Go</strong>: a webhook handler and an SSE handler joined by a tiny broker. Note the SSE handler sends the <em>current</em> status first, which follows the golden rule: if the payment landed before the page subscribed, the user still sees it.</p>
<pre><code>// Broker hands order updates from the webhook to any open status streams.
// In memory = one server only; use Redis pub/sub when you run several.
type Broker struct {
	mu   sync.Mutex
	subs map[string][]chan string // order ID -&gt; listeners
}

func (b *Broker) Subscribe(orderID string) (&lt;-chan string, func()) {
	ch := make(chan string, 4)
	b.mu.Lock()
	b.subs[orderID] = append(b.subs[orderID], ch)
	b.mu.Unlock()
	return ch, func() {
		b.mu.Lock()
		defer b.mu.Unlock()
		b.subs[orderID] = slices.DeleteFunc(b.subs[orderID], func(c chan string) bool { return c == ch })
	}
}

func (b *Broker) Publish(orderID, status string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for _, ch := range b.subs[orderID] {
		select {
		case ch &lt;- status:
		default: // listener is behind; it reads the current status when it reconnects
		}
	}
}

func routes(mux *http.ServeMux, broker *Broker, orders *OrderStore) {
	// Webhook in: Stripe tells our server the payment succeeded.
	mux.HandleFunc("POST /webhooks/stripe", func(w http.ResponseWriter, r *http.Request) {
		event, err := verifyAndStore(r) // signature check + save once (see Webhooks)
		if err != nil {
			http.Error(w, "rejected", http.StatusBadRequest)
			return
		}
		if event.Type == "payment_intent.succeeded" {
			orders.MarkPaid(r.Context(), event.OrderID)
			broker.Publish(event.OrderID, "paid")
		}
		w.WriteHeader(http.StatusOK)
	})

	// SSE out: the checkout page watches its order.
	mux.HandleFunc("GET /orders/{id}/status", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		updates, unsubscribe := broker.Subscribe(id) // subscribe BEFORE reading state: no gap
		defer unsubscribe()

		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-store")
		rc := http.NewResponseController(w)

		status := orders.Status(r.Context(), id) // the truth first, then live updates
		for {
			fmt.Fprintf(w, "event: status&#92;ndata: %s&#92;n&#92;n", status)
			if err := rc.Flush(); err != nil {
				return
			}
			select {
			case status = &lt;-updates:
			case &lt;-r.Context().Done():
				return
			}
		}
	})
}</code></pre>
<p>In production the in-memory <code>Broker</code> becomes Redis pub/sub (so the webhook can land on server A while the browser's stream is on server B), and the webhook handler stores the event before publishing, as described in <a href="#webhooks">Webhooks</a>.</p>

<p><strong>Real-world scenario: replacing WebSockets with SSE.</strong> A common story: a team builds in-app notifications on WebSockets. Then come the follow-ups: the load balancer's idle timeout kills quiet sockets, deploys drop every user at once, mobile clients need hand-written reconnect logic, and a corporate customer's proxy blocks the upgrade. Every message goes server → client anyway. Moving to SSE over HTTP/2 deletes the reconnect code (the browser does it), works through the customer's proxy, and runs on the same plain-HTTP stack as the rest of the API. Two-way features (like chat) keep WebSockets; everything one-way moves to SSE.</p>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>WebSockets for everything.</strong> Most "real-time" features are one-way. Start with SSE; move to WebSockets when the client genuinely sends a lot.</li>
  <li><strong>Fast polling because it's easy.</strong> Fine for a handful of users or rare updates; at scale it's the most expensive option per useful message, and still the slowest.</li>
  <li><strong>Webhooks to browsers.</strong> Impossible: browsers can't accept incoming requests. Webhooks reach your server; SSE or WebSockets carry it the last mile.</li>
  <li><strong>Webhooks between your own services.</strong> You'd be rebuilding retries, ordering and durability by hand. Use a <a href="#message-queues">message queue</a>.</li>
  <li><strong>Forgetting closed apps.</strong> Connections only exist while the app runs. For "your order shipped" on a locked phone, use platform push notifications.</li>
  <li><strong>No fallback plan.</strong> Some networks block WebSocket upgrades or buffer streams. Libraries like Socket.IO fall back to long polling automatically; if you build your own, decide what happens there.</li>
  <li><strong>Treating any of them as guaranteed delivery.</strong> None are. Fetch state on reconnect, dedupe by ID, and run reconciliation for webhooks.</li>
  <li><strong>Underestimating persistent connections.</strong> SSE and WebSockets move cost to open connections: load balancer limits, idle timeouts, file descriptors, deploy draining, and reconnect storms (use <a href="#exponential-backoff">backoff with jitter</a>).</li>
</ul>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>Ask two questions: who receives (browser/app vs server) and who talks (one-way vs both).</li>
  <li>Browser, one-way → SSE. Browser, two-way → WebSockets. Server, one-way → webhooks. Plain HTTP only → long polling.</li>
  <li>Polling is fine for rare updates; mobile push for closed apps; queues or gRPC between your own services.</li>
  <li>Combine them freely, and always treat the live channel as a hint backed by an API that tells the truth.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#websockets">WebSockets</a> · <a href="#long-polling">Long Polling</a> · <a href="#server-sent-events">Server-Sent Events</a> · <a href="#webhooks">Webhooks</a> · <a href="#message-queues">Message Queues</a> · <a href="#pub-sub">Pub/Sub</a> · <a href="#grpc">gRPC</a></p>
`;

