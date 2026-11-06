CONTENT["dns"] = `
<p class="tldr"><strong>TL;DR</strong> — DNS is the internet's phone book: it turns a name people can remember (<code>api.example.com</code>) into an IP address machines can route to (<code>93.184.215.14</code>), using a distributed, heavily cached hierarchy of servers.</p>

<h2>The problem it solves</h2>
<p>Computers talk to IP addresses, but IPs are hard to remember and they <em>change</em> — servers move, scale out, fail over to another region. If clients hard-coded IPs, every change would break them. DNS adds a level of indirection: clients ask for a <strong>name</strong>, and whoever owns that name decides which IP(s) it points to right now.</p>

<h2>How it works</h2>
<p>When your app calls <code>api.example.com</code>, the OS asks a <strong>recursive resolver</strong> (your ISP's, or a public one like <code>1.1.1.1</code> / <code>8.8.8.8</code>). If the answer isn't cached, the resolver walks the hierarchy from the top: root servers → the TLD servers for <code>.com</code> → the domain's <strong>authoritative</strong> name server, which holds the real record.</p>

<figure class="diagram">
<svg viewBox="0 0 780 420" role="img" aria-label="DNS resolution sequence: client asks resolver, resolver asks root, TLD and authoritative servers, then answers the client">
  <defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <rect class="box" x="10" y="10" width="120" height="40" rx="8"/><text x="70" y="35" text-anchor="middle" class="title">Client</text>
  <rect class="box accent" x="170" y="10" width="140" height="40" rx="8"/><text x="240" y="35" text-anchor="middle" class="title">Resolver</text>
  <rect class="box" x="350" y="10" width="120" height="40" rx="8"/><text x="410" y="35" text-anchor="middle" class="title">Root (.)</text>
  <rect class="box" x="500" y="10" width="120" height="40" rx="8"/><text x="560" y="35" text-anchor="middle" class="title">TLD (.com)</text>
  <rect class="box ok" x="640" y="10" width="130" height="40" rx="8"/><text x="705" y="35" text-anchor="middle" class="title">Authoritative</text>
  <path class="line dashed" d="M70 50 V405 M240 50 V405 M410 50 V405 M560 50 V405 M705 50 V405" style="stroke: var(--line)"/>

  <text x="155" y="79" text-anchor="middle">① A? api.example.com</text>
  <path class="line accent" d="M70 85 H238" marker-end="url(#arr)"/>
  <text x="325" y="121" text-anchor="middle">② A? api.example.com</text>
  <path class="line" d="M240 127 H408" marker-end="url(#arr)"/>
  <text x="325" y="163" text-anchor="middle" class="small">③ "ask the .com servers"</text>
  <path class="line dashed" d="M410 169 H242" marker-end="url(#arr)"/>
  <text x="400" y="205" text-anchor="middle">④ A? api.example.com</text>
  <path class="line" d="M240 211 H558" marker-end="url(#arr)"/>
  <text x="400" y="247" text-anchor="middle" class="small">⑤ "ask ns1.example.com"</text>
  <path class="line dashed" d="M560 253 H242" marker-end="url(#arr)"/>
  <text x="472" y="289" text-anchor="middle">⑥ A? api.example.com</text>
  <path class="line" d="M240 295 H703" marker-end="url(#arr)"/>
  <text x="472" y="331" text-anchor="middle">⑦ A 93.184.215.14 · TTL 300</text>
  <path class="line ok" d="M705 337 H242" marker-end="url(#arr)"/>
  <text x="155" y="373" text-anchor="middle">⑧ 93.184.215.14</text>
  <path class="line ok" d="M240 379 H72" marker-end="url(#arr)"/>
  <text x="240" y="402" text-anchor="middle" class="small">resolver caches the answer for 300s</text>
</svg>
<figcaption>A cold lookup: steps ②–⑦ only happen on a cache miss. Next time, the resolver answers ① directly from cache.</figcaption>
</figure>

<p>Every answer carries a <strong>TTL</strong> (time to live, in seconds). Browsers, the OS, and resolvers all cache answers until the TTL expires, so most lookups never leave your machine or your ISP. This caching is why DNS scales to the whole internet, and also why DNS changes are not instant.</p>

<h2>The cache layers</h2>
<p>There isn't one DNS cache. There's a <strong>stack</strong> of them between your code and the authoritative server. A lookup walks down the stack and stops at the first layer that has an unexpired answer. On the way back up, each layer that missed stores the answer for (at most) its TTL.</p>

<figure class="diagram">
<svg viewBox="0 0 780 400" role="img" aria-label="DNS cache layers from top to bottom: application runtime, browser, OS resolver, router, recursive resolver, authoritative server">
  <defs><marker id="arr-dns-3" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <rect class="box accent" x="30" y="20" width="270" height="44" rx="8"/><text x="165" y="47" text-anchor="middle" class="title">① App / runtime</text>
  <text x="330" y="39">JVM caches lookups (networkaddress.cache.ttl, 30s default)</text>
  <text x="330" y="56" class="small">Node.js: no built-in cache, but open connections keep using the old IP</text>

  <rect class="box accent" x="30" y="82" width="270" height="44" rx="8"/><text x="165" y="109" text-anchor="middle" class="title">② Browser</text>
  <text x="330" y="101">Chrome and Firefox keep their own host cache</text>
  <text x="330" y="118" class="small">inspect: chrome://net-internals/#dns · about:networking#dns</text>

  <rect class="box accent" x="30" y="144" width="270" height="44" rx="8"/><text x="165" y="171" text-anchor="middle" class="title">③ OS resolver</text>
  <text x="330" y="163">hosts file is checked first, then the OS cache</text>
  <text x="330" y="180" class="small">macOS mDNSResponder · Windows DNS Client · Linux systemd-resolved</text>

  <rect class="box" x="30" y="206" width="270" height="44" rx="8"/><text x="165" y="233" text-anchor="middle" class="title">④ Router / forwarder</text>
  <text x="330" y="225">home router or office DNS forwarder (e.g. dnsmasq)</text>
  <text x="330" y="242" class="small">shared by every device on that network</text>

  <rect class="box" x="30" y="268" width="270" height="44" rx="8"/><text x="165" y="295" text-anchor="middle" class="title">⑤ Recursive resolver</text>
  <text x="330" y="287">ISP, 1.1.1.1, 8.8.8.8, AWS VPC resolver</text>
  <text x="330" y="304" class="small">caches answers and referrals, so root and TLD servers are rarely asked</text>

  <rect class="box ok" x="30" y="330" width="270" height="44" rx="8"/><text x="165" y="357" text-anchor="middle" class="title">⑥ Authoritative server</text>
  <text x="330" y="349">source of truth: owns the record and sets its TTL</text>
  <text x="330" y="366" class="small">only reached when every layer above missed</text>

  <path class="line dashed" d="M165 64 V80" marker-end="url(#arr-dns-3)"/>
  <path class="line dashed" d="M165 126 V142" marker-end="url(#arr-dns-3)"/>
  <path class="line dashed" d="M165 188 V204" marker-end="url(#arr-dns-3)"/>
  <path class="line dashed" d="M165 250 V266" marker-end="url(#arr-dns-3)"/>
  <path class="line dashed" d="M165 312 V328" marker-end="url(#arr-dns-3)"/>
  <text x="175" y="76" class="small">miss</text>
</svg>
<figcaption>Each arrow down is a cache miss. Layers ①–③ live on your machine; ④–⑤ are shared with other users; ⑥ is the owner of the record.</figcaption>
</figure>

<table>
  <tr><th>Layer</th><th>How long it caches</th><th>Inspect / flush</th></tr>
  <tr><td>① App runtime (JVM)</td><td>30s by default when no SecurityManager is set; failed lookups 10s (<code>networkaddress.cache.negative.ttl</code>)</td><td>set <code>networkaddress.cache.ttl</code> in <code>java.security</code> or via <code>Security.setProperty</code> at startup; restart to clear</td></tr>
  <tr><td>② Browser</td><td>its own short-lived cache, separate from the OS</td><td>Chrome: <code>chrome://net-internals/#dns</code> → <em>Clear host cache</em></td></tr>
  <tr><td>③ OS (macOS)</td><td>up to the record's TTL</td><td><code>dscacheutil -q host -a name api.example.com</code><br><code>sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder</code></td></tr>
  <tr><td>③ OS (Windows)</td><td>up to the record's TTL</td><td><code>ipconfig /displaydns</code> · <code>ipconfig /flushdns</code></td></tr>
  <tr><td>③ OS (Linux)</td><td>only if a caching service runs (systemd-resolved, nscd, dnsmasq); many servers and containers have none</td><td><code>resolvectl statistics</code> · <code>resolvectl flush-caches</code></td></tr>
  <tr><td>④ Router</td><td>up to the record's TTL</td><td>router admin page or reboot</td></tr>
  <tr><td>⑤ Recursive resolver</td><td>up to the record's TTL (some resolvers clamp very low or very high values)</td><td>you can't flush your ISP's; Cloudflare and Google public DNS have web pages to purge a name</td></tr>
</table>

<div class="callout warn"><strong>Negative answers are cached too.</strong> If something looks up <code>new.example.com</code> <em>before</em> you create the record, resolvers cache the "does not exist" (NXDOMAIN) answer for the time set in the zone's SOA record (RFC 2308). Create records before you start using them.</div>

<h3>Debugging "I changed the record but still see the old IP"</h3>
<p>Walk the layers from the source of truth upward, and find the first one that disagrees:</p>
<pre><code># 1. Authoritative: is the change really published?
$ dig @ns1.example-dns.com api.example.com +short

# 2. A public recursive resolver: has its cached copy expired yet? (2nd column = TTL left)
$ dig @1.1.1.1 api.example.com +noall +answer

# 3. Your OS: dig bypasses the OS cache, so ask the OS resolver itself (macOS)
$ dscacheutil -q host -a name api.example.com

# 4. Flush the layers on your machine: OS, then the browser host cache
$ sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder

# 5. Still old inside your service? The runtime cache or a pooled connection is holding it: restart or recycle</code></pre>

<h3>Mindmap</h3>
<figure class="diagram">
<svg viewBox="0 0 780 280" role="img" aria-label="DNS mindmap: records, resolution, caching, uses, security">
  <path class="line" d="M390 140 L150 50 M390 140 L150 230 M390 140 L630 50 M390 140 L630 230 M390 140 L390 250"/>
  <ellipse class="box accent" cx="390" cy="140" rx="70" ry="32"/><text x="390" y="145" text-anchor="middle" class="title">DNS</text>
  <rect class="box" x="40" y="22" width="220" height="56" rx="10"/><text x="150" y="45" text-anchor="middle" class="title">Records</text><text x="150" y="64" text-anchor="middle" class="small">A · AAAA · CNAME · MX · TXT · NS · SRV</text>
  <rect class="box" x="40" y="202" width="220" height="56" rx="10"/><text x="150" y="225" text-anchor="middle" class="title">Resolution</text><text x="150" y="244" text-anchor="middle" class="small">recursive resolver → root → TLD → auth</text>
  <rect class="box" x="520" y="22" width="220" height="56" rx="10"/><text x="630" y="45" text-anchor="middle" class="title">Caching</text><text x="630" y="64" text-anchor="middle" class="small">TTL · negative caching · stale records</text>
  <rect class="box" x="520" y="202" width="220" height="56" rx="10"/><text x="630" y="225" text-anchor="middle" class="title">Uses</text><text x="630" y="244" text-anchor="middle" class="small">GeoDNS · failover · service discovery</text>
  <rect class="box ok" x="300" y="232" width="180" height="44" rx="10"/><text x="390" y="252" text-anchor="middle" class="title">Security</text><text x="390" y="268" text-anchor="middle" class="small">DNSSEC · DoH / DoT</text>
</svg>
</figure>

<h2>Common record types</h2>
<table>
  <tr><th>Type</th><th>Maps</th><th>Example</th></tr>
  <tr><td><code>A</code> / <code>AAAA</code></td><td>name → IPv4 / IPv6</td><td><code>api.example.com → 93.184.215.14</code></td></tr>
  <tr><td><code>CNAME</code></td><td>name → another name (alias)</td><td><code>www → example.com</code>, <code>app → myapp.vercel.app</code></td></tr>
  <tr><td><code>MX</code></td><td>domain → mail servers</td><td><code>example.com → 10 mx1.mail.com</code></td></tr>
  <tr><td><code>TXT</code></td><td>arbitrary text</td><td>SPF/DKIM email auth, domain ownership verification</td></tr>
  <tr><td><code>NS</code></td><td>zone → its authoritative servers</td><td><code>example.com → ns1.cloudflare.com</code></td></tr>
  <tr><td><code>SRV</code></td><td>service → host + port</td><td>used by some service-discovery systems</td></tr>
</table>

<h2>Example</h2>
<p>Inspect a lookup with <code>dig</code> — the number after the name is the remaining TTL:</p>
<pre><code>$ dig api.example.com +noall +answer
api.example.com.   300   IN   CNAME   lb-prod.example.net.
lb-prod.example.net. 60  IN   A       10.0.4.21
lb-prod.example.net. 60  IN   A       10.0.4.22

$ dig +trace api.example.com    # walk root → TLD → authoritative yourself</code></pre>
<p>Real-world scenario: you are moving your API to a new load balancer. A day before the cutover you lower the record's TTL from <code>3600</code> to <code>60</code>. Once old caches expire, you change the record; clients pick up the new IP within about a minute. After it's stable, raise the TTL again to reduce lookup load.</p>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>Propagation isn't instant.</strong> Changes are visible only after cached copies expire. A high TTL means slow failover; a very low TTL means more lookups and latency.</li>
  <li><strong>Long-lived clients ignore changes.</strong> Some runtimes cache DNS forever (older JVMs, connection pools that never reconnect). Set a sane DNS cache TTL in the runtime and recycle connections.</li>
  <li><strong>DNS is a dependency.</strong> If your DNS provider is down, your service is "down" even though servers are healthy. Big outages (e.g. Dyn 2016) were DNS outages.</li>
  <li><strong>No CNAME at the zone apex.</strong> <code>example.com</code> itself can't be a CNAME; providers offer ALIAS/ANAME/flattening for this.</li>
  <li><strong>Plain DNS is unencrypted and spoofable.</strong> DNSSEC signs records; DoH/DoT encrypt the query.</li>
</ul>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>DNS = name → address indirection, so infrastructure can change without clients changing.</li>
  <li>Resolution is hierarchical (root → TLD → authoritative) and cached everywhere by TTL.</li>
  <li>Caches stack up: app runtime → browser → OS → router → recursive resolver. When debugging, start at the authoritative server and walk up until you find the stale layer.</li>
  <li>Lower TTLs before migrations; respect that changes take up to one TTL to propagate.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#load-balancing">Load Balancing</a> · <a href="#cdn">CDN</a> · <a href="#service-discovery">Service Discovery</a> · <a href="#failover">Failover</a> · <a href="#multi-region-deployment">Multi-Region Deployment</a></p>
`;

CONTENT["tcp-vs-udp"] = `
<p class="tldr"><strong>TL;DR</strong>: TCP and UDP are the two main ways to send data between programs over IP. <strong>TCP</strong> is a phone call: you connect first, everything arrives complete and in order, and lost pieces are re-sent. <strong>UDP</strong> is a postcard: no connection, no confirmation, and no guarantee it arrives, but it's fast and simple.</p>

<h2>The problem it solves</h2>
<p>IP, the layer below, only moves individual <strong>packets</strong> from one machine to another, on a best-effort basis. Packets can be lost, duplicated, delayed, or arrive out of order, and IP doesn't care which <em>program</em> on the machine they're for.</p>
<p>The transport layer adds <strong>ports</strong> (so the packet reaches the right process, e.g. <code>:443</code> for HTTPS) and then makes a choice:</p>
<ul>
  <li><strong>TCP</strong> builds a reliable, ordered <em>byte stream</em> on top of unreliable packets. Perfect when every byte matters: web pages, API calls, database queries, file transfers.</li>
  <li><strong>UDP</strong> adds almost nothing: ports, a length, and a checksum. Each message (a <em>datagram</em>) is sent on its own. Perfect when speed matters more than completeness, or when the application wants to handle reliability itself.</li>
</ul>

<h2>How it works</h2>
<p><strong>TCP</strong> starts with a <strong>3-way handshake</strong> (SYN → SYN-ACK → ACK) so both sides agree on starting sequence numbers. After that, every byte is numbered; the receiver acknowledges (ACKs) what it got, and the sender re-sends anything not acknowledged in time. Closing is its own exchange (FIN/ACK in each direction). <strong>UDP</strong> skips all of it: the first packet already carries data.</p>

<figure class="diagram">
<svg viewBox="0 0 780 430" role="img" aria-label="TCP: three-way handshake, data with acknowledgement, then connection close. UDP: datagrams sent without handshake, one is lost and never re-sent">
  <defs><marker id="arr-tcp-1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <text x="185" y="22" text-anchor="middle" class="title">TCP</text>
  <text x="605" y="22" text-anchor="middle" class="title">UDP</text>
  <path class="line" d="M390 10 V420" style="stroke: var(--line)"/>

  <rect class="box" x="20" y="34" width="100" height="36" rx="8"/><text x="70" y="57" text-anchor="middle">Client</text>
  <rect class="box" x="250" y="34" width="100" height="36" rx="8"/><text x="300" y="57" text-anchor="middle">Server</text>
  <path class="line dashed" d="M70 70 V420 M300 70 V420" style="stroke: var(--line)"/>
  <text x="185" y="96" text-anchor="middle" class="small">SYN</text>
  <path class="line accent" d="M70 102 H298" marker-end="url(#arr-tcp-1)"/>
  <text x="185" y="130" text-anchor="middle" class="small">SYN-ACK</text>
  <path class="line accent" d="M300 136 H72" marker-end="url(#arr-tcp-1)"/>
  <text x="185" y="164" text-anchor="middle" class="small">ACK</text>
  <path class="line accent" d="M70 170 H298" marker-end="url(#arr-tcp-1)"/>
  <text x="185" y="190" text-anchor="middle" class="small">connected: 1 round trip spent</text>
  <text x="185" y="222" text-anchor="middle">data (bytes 1–1460)</text>
  <path class="line ok" d="M70 228 H298" marker-end="url(#arr-tcp-1)"/>
  <text x="185" y="256" text-anchor="middle" class="small">ACK 1461 (got it)</text>
  <path class="line dashed" d="M300 262 H72" marker-end="url(#arr-tcp-1)"/>
  <text x="185" y="300" text-anchor="middle" class="small">FIN</text>
  <path class="line" d="M70 306 H298" marker-end="url(#arr-tcp-1)"/>
  <text x="185" y="334" text-anchor="middle" class="small">ACK, then FIN</text>
  <path class="line" d="M300 340 H72" marker-end="url(#arr-tcp-1)"/>
  <text x="185" y="368" text-anchor="middle" class="small">ACK</text>
  <path class="line" d="M70 374 H298" marker-end="url(#arr-tcp-1)"/>
  <text x="185" y="404" text-anchor="middle" class="small">client waits in TIME_WAIT before the port is reused</text>

  <rect class="box" x="440" y="34" width="100" height="36" rx="8"/><text x="490" y="57" text-anchor="middle">Client</text>
  <rect class="box" x="670" y="34" width="100" height="36" rx="8"/><text x="720" y="57" text-anchor="middle">Server</text>
  <path class="line dashed" d="M490 70 V420 M720 70 V420" style="stroke: var(--line)"/>
  <text x="605" y="96" text-anchor="middle">datagram 1</text>
  <path class="line ok" d="M490 102 H718" marker-end="url(#arr-tcp-1)"/>
  <text x="605" y="130" text-anchor="middle">datagram 2</text>
  <path class="line ok" d="M490 136 H718" marker-end="url(#arr-tcp-1)"/>
  <text x="545" y="164" text-anchor="middle">datagram 3</text>
  <path class="line bad" d="M490 170 H600"/>
  <text x="612" y="175" class="small">✗ lost</text>
  <text x="605" y="198" text-anchor="middle">datagram 4</text>
  <path class="line ok" d="M490 204 H718" marker-end="url(#arr-tcp-1)"/>
  <rect class="box muted" x="450" y="250" width="310" height="96" rx="10"/>
  <text x="605" y="276" text-anchor="middle">no handshake, data from packet one</text>
  <text x="605" y="298" text-anchor="middle">no ACK, no retransmit, no ordering</text>
  <text x="605" y="320" text-anchor="middle">nobody knows datagram 3 is gone</text>
  <text x="605" y="338" text-anchor="middle" class="small">(unless the application checks itself)</text>
</svg>
<figcaption>TCP spends a round trip to connect and confirms delivery. UDP just sends; a lost datagram is simply gone.</figcaption>
</figure>

<h3>What TCP does for you after the handshake</h3>
<ul>
  <li><strong>Reliability</strong>: unacknowledged segments are re-sent after a timeout, or sooner after duplicate ACKs (fast retransmit).</li>
  <li><strong>Ordering</strong>: sequence numbers let the receiver put segments back in order and drop duplicates before your app sees them.</li>
  <li><strong>Flow control</strong>: the receiver advertises a <em>window</em> (how much it can buffer), so a fast sender can't overwhelm a slow reader.</li>
  <li><strong>Congestion control</strong>: the sender starts slow (<em>slow start</em>) and backs off when packets are lost or delayed, so it doesn't overload the network. Linux defaults to the CUBIC algorithm; Google's BBR is a common alternative.</li>
</ul>

<h2>TCP vs UDP at a glance</h2>
<table>
  <tr><th></th><th>TCP</th><th>UDP</th></tr>
  <tr><td>Connection</td><td>yes: handshake before data, explicit close</td><td>none: each datagram is independent</td></tr>
  <tr><td>Delivery</td><td>guaranteed, or the connection reports an error</td><td>best effort: may be lost, duplicated, reordered</td></tr>
  <tr><td>Ordering</td><td>in order</td><td>no guarantee</td></tr>
  <tr><td>Data shape</td><td><strong>byte stream</strong>: no message boundaries</td><td><strong>messages</strong>: one send = one datagram</td></tr>
  <tr><td>Flow / congestion control</td><td>built in</td><td>none (the app must behave)</td></tr>
  <tr><td>Header size</td><td>20–60 bytes</td><td>8 bytes</td></tr>
  <tr><td>Broadcast / multicast</td><td>no (one-to-one only)</td><td>yes</td></tr>
  <tr><td>Typical uses</td><td>HTTP/1.1 and HTTP/2, databases, SSH, SMTP, gRPC</td><td>DNS queries, voice/video (WebRTC), games, metrics (StatsD), QUIC / HTTP/3</td></tr>
</table>

<h3>Which one should I use?</h3>
<figure class="diagram">
<svg viewBox="0 0 780 300" role="img" aria-label="Decision tree: if every byte must arrive in order, use TCP. Otherwise, if late data is worse than lost data, use plain UDP; if you need reliability without head-of-line blocking, use QUIC over UDP">
  <path class="line" d="M330 61 L180 120 M450 61 L600 120 M560 166 L505 230 M640 166 L685 230"/>
  <rect class="box accent" x="230" y="15" width="320" height="46" rx="10"/>
  <text x="390" y="43" text-anchor="middle" class="title">Must every byte arrive, in order?</text>
  <text x="246" y="84" text-anchor="end" class="small">yes</text>
  <text x="545" y="84" class="small">no</text>
  <rect class="box ok" x="30" y="120" width="300" height="64" rx="10"/>
  <text x="180" y="146" text-anchor="middle" class="title">TCP</text>
  <text x="180" y="166" text-anchor="middle" class="small">web/API traffic, databases, SSH, file transfer</text>
  <rect class="box" x="450" y="120" width="300" height="46" rx="10"/>
  <text x="600" y="148" text-anchor="middle" class="title">Is late data worse than lost data?</text>
  <text x="512" y="204" text-anchor="end" class="small">yes</text>
  <text x="678" y="200" class="small">no</text>
  <rect class="box ok" x="420" y="230" width="170" height="60" rx="10"/>
  <text x="505" y="255" text-anchor="middle" class="title">Plain UDP</text>
  <text x="505" y="274" text-anchor="middle" class="small">voice, video, games</text>
  <rect class="box ok" x="600" y="230" width="170" height="60" rx="10"/>
  <text x="685" y="255" text-anchor="middle" class="title">QUIC (on UDP)</text>
  <text x="685" y="274" text-anchor="middle" class="small">HTTP/3: reliable streams</text>
</svg>
<figcaption>In a video call, a 300 ms-old audio packet is useless, so re-sending it only causes stutter. QUIC rebuilds reliability on top of UDP to avoid TCP's head-of-line blocking (see <a href="#http-2-http-3">HTTP/2 &amp; HTTP/3</a>).</figcaption>
</figure>

<h2>Example</h2>
<p><strong>TCP is a stream, so you must frame messages.</strong> One <code>write()</code> on the sender does <em>not</em> equal one <code>read()</code> on the receiver: TCP may split or merge your bytes. A common fix is a length prefix (gRPC and many database protocols do a version of this):</p>
<pre><code>// TCP: send one message as [4-byte length][payload]
Socket("orders.internal", 9000).use { socket -&gt;
  val out = DataOutputStream(socket.getOutputStream())
  val payload = """{"orderId":42}""".toByteArray()
  out.writeInt(payload.size)
  out.write(payload)
  out.flush()

  val input = DataInputStream(socket.getInputStream())
  val reply = ByteArray(input.readInt())
  input.readFully(reply)  // keeps reading until all bytes arrive; a single read() might not
}</code></pre>

<p><strong>UDP is fire-and-forget.</strong> StatsD metrics are a classic use: losing one CPU sample is fine, and the app never blocks on a slow metrics server.</p>
<pre><code>// UDP: one send = one datagram, no connection, no confirmation
DatagramSocket().use { socket -&gt;
  val payload = "api.requests:1|c".toByteArray()
  socket.send(DatagramPacket(payload, payload.size, InetAddress.getByName("statsd.internal"), 8125))
}</code></pre>

<p>Try both from a terminal (macOS/BSD <code>nc</code> syntax):</p>
<pre><code>$ nc -l 9000              # TCP server
$ nc localhost 9000       # TCP client: handshake happens, then type to send

$ nc -u -l 9000           # UDP server
$ nc -u localhost 9000    # UDP client: no connection, each line is a datagram

$ ss -tan state time-wait | wc -l   # Linux: count sockets stuck in TIME_WAIT</code></pre>

<p><strong>Real-world scenario: DNS uses both.</strong> A normal lookup is one small question and one small answer, so it goes over UDP port 53: no handshake, one round trip. If the answer is too big for a UDP response, the server sets the "truncated" flag and the resolver retries over TCP. Zone transfers between DNS servers always use TCP. Same service, two transports, each where it fits.</p>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>Forgetting TCP has no message boundaries.</strong> Code that assumes "one read = one message" works on localhost and breaks under real network conditions. Always frame (length prefix, delimiter) or use a protocol that does (HTTP, gRPC).</li>
  <li><strong>Head-of-line blocking.</strong> One lost TCP segment stalls everything behind it until it's re-sent, even data for unrelated requests sharing the connection. This is the main reason HTTP/3 moved to QUIC over UDP.</li>
  <li><strong>Connection setup is expensive.</strong> 1 round trip for TCP, plus 1 for TLS 1.3, before the first request. Reuse connections (HTTP keep-alive, <a href="#connection-pooling">connection pools</a>) instead of opening one per request.</li>
  <li><strong>TIME_WAIT and port exhaustion.</strong> Opening and closing many short connections to the same destination can run out of local ports. Pooling fixes it.</li>
  <li><strong>Idle connections get cut silently.</strong> NATs, firewalls and load balancers drop idle TCP connections (AWS ALB's default idle timeout is 60 seconds). The next write then fails. Use keepalives or heartbeats, and handle connection resets with retries.</li>
  <li><strong>Small-message latency (Nagle's algorithm).</strong> TCP may hold tiny writes to batch them. For interactive protocols, set <code>TCP_NODELAY</code>; most HTTP clients and database drivers already do.</li>
  <li><strong>UDP has no brakes.</strong> No congestion control means a careless sender can flood the network and lose most of its own packets. Keep datagrams below the path MTU (about 1500 bytes on Ethernet, minus headers) to avoid fragmentation.</li>
  <li><strong>UDP source addresses are easy to spoof.</strong> That's what makes DNS/NTP reflection and amplification attacks possible (see <a href="#ddos-protection">DDoS Protection</a>).</li>
</ul>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>TCP = connection + reliable, ordered byte stream + flow and congestion control. UDP = ports + checksum, nothing more.</li>
  <li>Use TCP when every byte matters; UDP when late data is useless or when you build your own reliability (QUIC).</li>
  <li>TCP is a stream, not messages: always frame your data.</li>
  <li>TCP connections are costly to open: reuse them, and expect idle ones to be cut.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#dns">DNS</a> · <a href="#http-2-http-3">HTTP/2 &amp; HTTP/3</a> · <a href="#grpc">gRPC</a> · <a href="#websockets">WebSockets</a> · <a href="#connection-pooling">Connection Pooling</a> · <a href="#ddos-protection">DDoS Protection</a></p>
`;
