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
conn, err := net.Dial("tcp", "orders.internal:9000")
if err != nil {
	return err
}
defer conn.Close()

payload := []byte(&#96;{"orderId":42}&#96;)
frame := binary.BigEndian.AppendUint32(nil, uint32(len(payload)))
frame = append(frame, payload...)
if _, err := conn.Write(frame); err != nil {
	return err
}

var header [4]byte
if _, err := io.ReadFull(conn, header[:]); err != nil {
	return err
}
reply := make([]byte, binary.BigEndian.Uint32(header[:]))
if _, err := io.ReadFull(conn, reply); err != nil { // a single conn.Read might return only part
	return err
}</code></pre>

<p><strong>UDP is fire-and-forget.</strong> StatsD metrics are a classic use: losing one CPU sample is fine, and the app never blocks on a slow metrics server.</p>
<pre><code>// UDP: one send = one datagram, no connection, no confirmation
conn, err := net.Dial("udp", "statsd.internal:8125") // sends nothing yet: just remembers the address
if err != nil {
	return err
}
defer conn.Close()
conn.Write([]byte("api.requests:1|c")) // error ignored on purpose: losing one metric is fine</code></pre>

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

CONTENT["http-2-http-3"] = `
<p class="tldr"><strong>TL;DR</strong>: HTTP/2 and HTTP/3 keep the same HTTP you know (methods, headers, status codes) but change how it travels on the wire. <strong>HTTP/2</strong> sends many requests at once over <em>one</em> TCP connection using binary frames. <strong>HTTP/3</strong> moves to <strong>QUIC over UDP</strong>, so one lost packet no longer stalls every request, and connections start faster.</p>

<h2>The problem it solves</h2>
<p><strong>HTTP/1.1</strong> can only carry one request at a time per connection: send a request, wait for the whole response, then send the next. A modern page needs 50–100+ files, so:</p>
<ul>
  <li>Browsers open about <strong>6 parallel TCP connections per host</strong>, each paying its own TCP + TLS setup.</li>
  <li>Developers invented workarounds: <em>domain sharding</em> (static1/static2.example.com for more connections), image sprites, and concatenating all JS/CSS into one file.</li>
  <li>Headers are plain text and repeated on every request. Cookies and user agents alone can be hundreds of bytes, sent again and again.</li>
  <li>HTTP/1.1 <em>pipelining</em> (sending several requests without waiting) existed, but responses still had to come back in order, and buggy proxies broke it, so browsers never turned it on.</li>
</ul>
<p>HTTP/2 (2015) fixed the "one at a time" problem. HTTP/3 (2022) fixed the problem HTTP/2 inherited from TCP.</p>

<h2>How it works</h2>
<h3>HTTP/2: many streams, one connection</h3>
<ul>
  <li><strong>Binary framing</strong>: each request and response is split into small frames (HEADERS, DATA, …), each tagged with a <strong>stream ID</strong>.</li>
  <li><strong>Multiplexing</strong>: frames from many streams are interleaved on one TCP connection, so a slow response no longer blocks the others at the HTTP level.</li>
  <li><strong>HPACK header compression</strong>: both sides keep a table of headers already sent, so a repeated <code>cookie</code> or <code>user-agent</code> costs a few bytes instead of hundreds.</li>
  <li><strong>Per-stream flow control and priorities</strong>, so a big download doesn't starve the CSS the page needs first.</li>
  <li><strong>Negotiation</strong>: the client and server agree on HTTP/2 during the TLS handshake (ALPN, protocol id <code>h2</code>). Browsers only use HTTP/2 over TLS.</li>
</ul>

<figure class="diagram">
<svg viewBox="0 0 780 325" role="img" aria-label="Protocol stacks. HTTP/1.1: text messages over optional TLS over TCP. HTTP/2: binary frames and streams over TLS over TCP. HTTP/3: HTTP/3 frames over QUIC with built-in TLS 1.3 over UDP. All run over IP.">
  <text x="140" y="24" text-anchor="middle" class="title">HTTP/1.1</text>
  <text x="390" y="24" text-anchor="middle" class="title">HTTP/2</text>
  <text x="640" y="24" text-anchor="middle" class="title">HTTP/3</text>
  <rect class="box muted" x="30" y="40" width="720" height="36" rx="8"/>
  <text x="390" y="63" text-anchor="middle">HTTP semantics: GET/POST, headers, status codes (same in all three)</text>

  <rect class="box" x="30" y="90" width="220" height="50" rx="8"/>
  <text x="140" y="111" text-anchor="middle">text messages</text>
  <text x="140" y="129" text-anchor="middle" class="small">one request at a time</text>
  <rect class="box" x="280" y="90" width="220" height="50" rx="8"/>
  <text x="390" y="111" text-anchor="middle">binary frames + streams</text>
  <text x="390" y="129" text-anchor="middle" class="small">HPACK header compression</text>
  <rect class="box" x="530" y="90" width="220" height="50" rx="8"/>
  <text x="640" y="111" text-anchor="middle">HTTP/3 frames</text>
  <text x="640" y="129" text-anchor="middle" class="small">QPACK header compression</text>

  <rect class="box muted" x="30" y="150" width="220" height="40" rx="8"/>
  <text x="140" y="175" text-anchor="middle">TLS (optional)</text>
  <rect class="box" x="280" y="150" width="220" height="40" rx="8"/>
  <text x="390" y="175" text-anchor="middle">TLS (required by browsers)</text>
  <rect class="box accent" x="530" y="150" width="220" height="40" rx="8"/>
  <text x="640" y="175" text-anchor="middle">QUIC, with TLS 1.3 built in</text>

  <rect class="box" x="30" y="200" width="220" height="40" rx="8"/>
  <text x="140" y="225" text-anchor="middle">TCP</text>
  <rect class="box" x="280" y="200" width="220" height="40" rx="8"/>
  <text x="390" y="225" text-anchor="middle">TCP</text>
  <rect class="box accent" x="530" y="200" width="220" height="40" rx="8"/>
  <text x="640" y="225" text-anchor="middle">UDP</text>

  <rect class="box muted" x="30" y="250" width="720" height="34" rx="8"/>
  <text x="390" y="272" text-anchor="middle">IP</text>
  <text x="140" y="310" text-anchor="middle" class="small">~6 connections per host</text>
  <text x="390" y="310" text-anchor="middle" class="small">1 connection, many streams</text>
  <text x="640" y="310" text-anchor="middle" class="small">1 connection, independent streams</text>
</svg>
<figcaption>Your application code sees the same HTTP in every version. What changes is the framing and the transport underneath.</figcaption>
</figure>

<h3>The catch: TCP head-of-line blocking</h3>
<p>HTTP/2 multiplexes streams, but TCP only knows one ordered byte stream. If a single packet is lost, TCP holds back <em>everything</em> after it until the lost packet is re-sent, even frames from other streams that arrived fine. On a clean network this barely matters. On a lossy mobile network, one HTTP/2 connection can actually do worse than six HTTP/1.1 connections, because one loss now stalls every request instead of one.</p>

<figure class="diagram">
<svg viewBox="0 0 780 205" role="img" aria-label="Head-of-line blocking. Streams A, B and C share one connection and packet A2 is lost. Over TCP, B2 and C2 wait until A2 is re-sent. Over QUIC, B2 and C2 are delivered immediately and only stream A waits.">
  <defs><marker id="arr-h23-2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <text x="390" y="20" text-anchor="middle" class="small">A, B, C = three requests (streams) on one connection. Packet A2 is lost on the way.</text>

  <text x="20" y="62" class="title">HTTP/2 over TCP</text>
  <rect class="box" x="150" y="40" width="56" height="34" rx="6"/><text x="178" y="62" text-anchor="middle">A1</text>
  <rect class="box" x="220" y="40" width="56" height="34" rx="6"/><text x="248" y="62" text-anchor="middle">B1</text>
  <rect class="box" x="290" y="40" width="56" height="34" rx="6"/><text x="318" y="62" text-anchor="middle">C1</text>
  <rect class="box bad" x="360" y="40" width="56" height="34" rx="6"/><text x="388" y="62" text-anchor="middle">A2 ✗</text>
  <rect class="box muted" x="430" y="40" width="56" height="34" rx="6"/><text x="458" y="62" text-anchor="middle">B2</text>
  <rect class="box muted" x="500" y="40" width="56" height="34" rx="6"/><text x="528" y="62" text-anchor="middle">C2</text>
  <path class="line" d="M562 57 H618" marker-end="url(#arr-h23-2)"/>
  <rect class="box" x="620" y="40" width="140" height="34" rx="6"/><text x="690" y="62" text-anchor="middle">browser</text>
  <text x="150" y="96" class="small">TCP delivers bytes in order: B2 and C2 arrived, but sit in a buffer until A2 is re-sent.</text>

  <text x="20" y="152" class="title">HTTP/3 over QUIC</text>
  <rect class="box" x="150" y="130" width="56" height="34" rx="6"/><text x="178" y="152" text-anchor="middle">A1</text>
  <rect class="box" x="220" y="130" width="56" height="34" rx="6"/><text x="248" y="152" text-anchor="middle">B1</text>
  <rect class="box" x="290" y="130" width="56" height="34" rx="6"/><text x="318" y="152" text-anchor="middle">C1</text>
  <rect class="box bad" x="360" y="130" width="56" height="34" rx="6"/><text x="388" y="152" text-anchor="middle">A2 ✗</text>
  <rect class="box ok" x="430" y="130" width="56" height="34" rx="6"/><text x="458" y="152" text-anchor="middle">B2</text>
  <rect class="box ok" x="500" y="130" width="56" height="34" rx="6"/><text x="528" y="152" text-anchor="middle">C2</text>
  <path class="line" d="M562 147 H618" marker-end="url(#arr-h23-2)"/>
  <rect class="box" x="620" y="130" width="140" height="34" rx="6"/><text x="690" y="152" text-anchor="middle">browser</text>
  <text x="150" y="186" class="small">QUIC tracks loss per stream: B and C are delivered now, only stream A waits for A2.</text>
</svg>
<figcaption>HTTP/2 removed blocking between requests at the HTTP level, but TCP still blocks at the packet level. QUIC removes that too.</figcaption>
</figure>

<h3>HTTP/3: HTTP over QUIC</h3>
<p>Changing TCP itself is nearly impossible: it lives in every OS kernel and in millions of middleboxes. So QUIC rebuilds what HTTP needs on top of UDP, in user space:</p>
<ul>
  <li><strong>Independent streams</strong>: loss recovery is per stream, so no transport-level head-of-line blocking.</li>
  <li><strong>TLS 1.3 built in</strong>: the transport and crypto handshakes are combined, so a new connection is ready in <strong>1 round trip</strong> instead of 2 (TCP + TLS 1.3).</li>
  <li><strong>0-RTT resumption</strong>: when reconnecting to a server it has talked to before, the client can send the request in its very first packet.</li>
  <li><strong>Connection migration</strong>: a connection is identified by a <em>connection ID</em>, not by IP and port, so switching from Wi-Fi to 4G doesn't kill an in-progress download.</li>
  <li><strong>Always encrypted</strong>: even most of QUIC's own transport headers are encrypted, so middleboxes can't meddle with them.</li>
  <li><strong>QPACK</strong> replaces HPACK, because HPACK assumed in-order delivery.</li>
</ul>
<p><strong>How does a browser know to use HTTP/3?</strong> It usually first connects over TCP (HTTP/2), and the server answers with <code>alt-svc: h3=":443"; ma=86400</code> ("I also speak HTTP/3 on UDP 443, remember it for a day"). Later requests try QUIC. An <code>HTTPS</code> DNS record can advertise it before the first connection. If UDP is blocked, the browser silently falls back to TCP.</p>

<figure class="diagram">
<svg viewBox="0 0 780 222" role="img" aria-label="Round trips before the first request can be sent. TCP plus TLS 1.2: 3 round trips. TCP plus TLS 1.3: 2. QUIC: 1. QUIC 0-RTT resumption: 0.">
  <text x="20" y="51" class="title">TCP + TLS 1.2</text>
  <rect class="box muted" x="230" y="30" width="150" height="32" rx="6"/><text x="305" y="51" text-anchor="middle">TCP handshake</text>
  <rect class="box bad" x="380" y="30" width="300" height="32" rx="6"/><text x="530" y="51" text-anchor="middle">TLS 1.2 (2 round trips)</text>
  <rect class="box ok" x="680" y="30" width="80" height="32" rx="6"/><text x="720" y="51" text-anchor="middle">GET</text>

  <text x="20" y="96" class="title">TCP + TLS 1.3</text>
  <rect class="box muted" x="230" y="75" width="150" height="32" rx="6"/><text x="305" y="96" text-anchor="middle">TCP handshake</text>
  <rect class="box" x="380" y="75" width="150" height="32" rx="6"/><text x="455" y="96" text-anchor="middle">TLS 1.3</text>
  <rect class="box ok" x="530" y="75" width="80" height="32" rx="6"/><text x="570" y="96" text-anchor="middle">GET</text>

  <text x="20" y="141" class="title">QUIC (HTTP/3)</text>
  <rect class="box accent" x="230" y="120" width="150" height="32" rx="6"/><text x="305" y="141" text-anchor="middle">QUIC + TLS 1.3</text>
  <rect class="box ok" x="380" y="120" width="80" height="32" rx="6"/><text x="420" y="141" text-anchor="middle">GET</text>

  <text x="20" y="179" class="title">QUIC 0-RTT</text>
  <text x="20" y="195" class="small">(reconnecting)</text>
  <rect class="box ok" x="230" y="165" width="80" height="32" rx="6"/><text x="270" y="186" text-anchor="middle">GET</text>
  <text x="322" y="186" class="small">request rides in the very first packet</text>

  <path class="line" d="M230 206 H760" style="stroke: var(--line)"/>
  <text x="230" y="218" text-anchor="middle" class="small">0</text>
  <text x="380" y="218" text-anchor="middle" class="small">1 RTT</text>
  <text x="530" y="218" text-anchor="middle" class="small">2 RTT</text>
  <text x="680" y="218" text-anchor="middle" class="small">3 RTT</text>
</svg>
<figcaption>Round trips spent before the first request byte is sent. At 100 ms per round trip (a phone far from the server), going from TLS 1.2 over TCP to QUIC saves 200 ms on every new connection.</figcaption>
</figure>

<h2>HTTP/1.1 vs HTTP/2 vs HTTP/3</h2>
<table>
  <tr><th></th><th>HTTP/1.1</th><th>HTTP/2</th><th>HTTP/3</th></tr>
  <tr><td>Transport</td><td>TCP</td><td>TCP</td><td>QUIC over UDP</td></tr>
  <tr><td>Format</td><td>text</td><td>binary frames</td><td>binary frames</td></tr>
  <tr><td>Parallel requests</td><td>one per connection (so ~6 connections)</td><td>many streams on 1 connection</td><td>many independent streams on 1 connection</td></tr>
  <tr><td>Header compression</td><td>none</td><td>HPACK</td><td>QPACK</td></tr>
  <tr><td>Head-of-line blocking</td><td>per connection</td><td>at TCP level (one loss stalls all streams)</td><td>only the stream that lost data</td></tr>
  <tr><td>Encryption</td><td>optional</td><td>TLS in practice (browsers require it)</td><td>always, TLS 1.3 built in</td></tr>
  <tr><td>Round trips to first request</td><td>2 with TLS 1.3</td><td>2 with TLS 1.3</td><td>1, or 0 when resuming</td></tr>
  <tr><td>Survives network change</td><td>no</td><td>no</td><td>yes (connection IDs)</td></tr>
  <tr><td>Current spec</td><td>RFC 9112</td><td>RFC 9113</td><td>RFC 9114 (QUIC: RFC 9000)</td></tr>
</table>

<h2>Example</h2>
<p><strong>See which version you're getting.</strong> In Chrome DevTools, open the Network tab and right-click the column header to enable <em>Protocol</em>: you'll see <code>http/1.1</code>, <code>h2</code> or <code>h3</code>. From a terminal:</p>
<pre><code>$ curl -sI -o /dev/null -w '%{http_version}\\n' https://www.google.com
2

$ curl -sI https://www.cloudflare.com | grep -i alt-svc
alt-svc: h3=":443"; ma=86400          # "I also speak HTTP/3 on UDP 443"

$ curl --http3 -sI -o /dev/null -w '%{http_version}\\n' https://www.cloudflare.com
3                                     # needs a curl built with HTTP/3 support</code></pre>

<p><strong>Calling an API over HTTP/2 from Go.</strong> <code>net/http</code> negotiates HTTP/2 automatically for <code>https://</code> URLs (and falls back to HTTP/1.1 if the server doesn't support it). Concurrent requests to the same host become streams on a shared connection:</p>
<pre><code>client := &amp;http.Client{Timeout: 5 * time.Second}

var wg sync.WaitGroup
for _, path := range []string{"/users", "/orders", "/invoices"} {
	wg.Add(1)
	go func() {
		defer wg.Done()
		resp, err := client.Get("https://api.example.com" + path)
		if err != nil {
			log.Println(path, err)
			return
		}
		defer resp.Body.Close()
		log.Println(path, resp.Proto) // "HTTP/2.0"
	}()
}
wg.Wait()</code></pre>
<p>The server side is just as automatic: <code>http.ListenAndServeTLS</code> serves HTTP/2 with no extra code. HTTP/3 isn't in the standard library yet; the <code>quic-go</code> package is the usual choice.</p>

<p><strong>Turning on HTTP/2 and HTTP/3 in nginx</strong> (1.25.1+):</p>
<pre><code>server {
  listen 443 ssl;               # TCP: HTTP/1.1 and HTTP/2
  listen 443 quic reuseport;    # UDP: HTTP/3
  http2 on;

  ssl_certificate     /etc/ssl/example.crt;
  ssl_certificate_key /etc/ssl/example.key;

  # Tell browsers HTTP/3 is available; they switch on later requests
  add_header Alt-Svc 'h3=":443"; ma=86400';
}</code></pre>
<p>Remember to open <strong>UDP</strong> 443 in the firewall or security group. Without it, nothing breaks: browsers just keep using HTTP/2.</p>

<p><strong>Real-world scenario.</strong> A shopping app's users on mobile networks report slow product pages. The CDN already serves HTTP/2, but those networks lose 1–2% of packets, and each loss stalls all ~40 requests sharing the connection. Enabling HTTP/3 at the CDN (CloudFront, Cloudflare and Fastly all support it) means a loss only delays the image it belongs to, and users walking from Wi-Fi to 4G keep their connection. Nothing in the backend changes: the CDN terminates HTTP/3 and talks to the origin over HTTP/1.1 or HTTP/2 as before.</p>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>HTTP/1.1 hacks hurt under HTTP/2.</strong> Domain sharding forces extra connections and defeats multiplexing and header compression. Drop it when you move to HTTP/2. Bundling is still useful, but you no longer need one giant file.</li>
  <li><strong>HTTP/2 is not always faster.</strong> On lossy networks, TCP head-of-line blocking can make one HTTP/2 connection slower than six HTTP/1.1 connections. That's the problem HTTP/3 exists to fix.</li>
  <li><strong>Server push is dead.</strong> HTTP/2 push was hard to use well and often sent things the browser already had cached. Chrome removed it in 2022. Use <code>&lt;link rel="preload"&gt;</code> or the <code>103 Early Hints</code> response instead.</li>
  <li><strong>UDP is often blocked.</strong> Some corporate networks and firewalls block or throttle UDP 443. HTTP/3 is an upgrade on top of HTTP/2, never a replacement: always keep TCP working.</li>
  <li><strong>0-RTT can be replayed.</strong> An attacker can capture and resend a 0-RTT request. Only allow it for safe, idempotent requests (GET), never for "pay now". Servers can answer <code>425 Too Early</code> to force a full handshake.</li>
  <li><strong>QUIC costs more CPU.</strong> It runs in user space and gets less help from kernel and network-card offloads than TCP, so it uses more CPU per byte. That's one reason HTTP/3 mostly shows up at CDNs and big edges, not between internal services.</li>
  <li><strong>The edge protocol isn't end to end.</strong> A load balancer or CDN terminates the client's HTTP/2 or HTTP/3 and opens its own connection to your servers. AWS ALB, for example, talks HTTP/1.1 to targets unless you set the target group protocol version to HTTP/2 or gRPC. gRPC needs HTTP/2 all the way through.</li>
  <li><strong>Multiplexing has its own attacks.</strong> The HTTP/2 "Rapid Reset" attack (CVE-2023-44487, 2023) opened and cancelled streams in a tight loop to overload servers. Keep servers patched and cap concurrent streams per connection.</li>
  <li><strong>Harder to debug by eye.</strong> Binary frames and mandatory encryption mean no more reading raw traffic. Use browser DevTools, <code>curl -v</code>, or Wireshark with a TLS key log (<code>SSLKEYLOGFILE</code>).</li>
</ul>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>Same HTTP semantics in every version: only framing and transport change, so app code rarely needs to.</li>
  <li>HTTP/2 = many streams over one TCP connection, plus header compression. Remaining weakness: TCP head-of-line blocking.</li>
  <li>HTTP/3 = HTTP over QUIC (UDP): per-stream loss recovery, 1-RTT setup (0-RTT on resume), survives network changes.</li>
  <li>Deploy HTTP/3 as an upgrade with HTTP/2 fallback, usually at the CDN or edge first.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#tcp-vs-udp">TCP vs UDP</a> · <a href="#tls">TLS</a> · <a href="#grpc">gRPC</a> · <a href="#cdn">CDN</a> · <a href="#load-balancing">Load Balancing</a> · <a href="#websockets">WebSockets</a></p>
`;

CONTENT["grpc"] = `
<p class="tldr"><strong>TL;DR</strong>: gRPC lets one service call a function on another service as if it were a local function. You describe the API once in a <code>.proto</code> file, generate typed client and server code in any language, and calls travel as compact <strong>Protocol Buffers</strong> over <strong>HTTP/2</strong>, with streaming, deadlines and standard error codes built in.</p>

<h2>The problem it solves</h2>
<p>Inside a backend with dozens of services, plain REST + JSON between them gets painful:</p>
<ul>
  <li><strong>No enforced contract.</strong> The API lives in docs (or nowhere). A renamed field or a typo in <code>"totalCents"</code> vs <code>"total_cents"</code> only shows up at runtime.</li>
  <li><strong>Hand-written clients</strong> in every calling service and every language, each with its own bugs.</li>
  <li><strong>JSON is text</strong>: bigger on the wire and slower to parse than a binary format, which adds up at thousands of calls per second.</li>
  <li><strong>No standard for streaming, timeouts or errors</strong>: every team invents its own.</li>
</ul>
<p>gRPC (open-sourced by Google in 2015, based on its internal RPC system) makes the contract the source of truth and generates everything else from it.</p>

<h2>How it works</h2>
<ol>
  <li><strong>Define the contract</strong> in a <code>.proto</code> file: services, methods, and message types.</li>
  <li><strong>Generate code</strong> with <code>protoc</code> (or <code>buf</code>): a client <em>stub</em> for callers, a base class for the server. Go, Java, Python, TypeScript and more, all from the same file.</li>
  <li><strong>Call the stub</strong> like a normal function. It serializes the request to protobuf and sends it as one <strong>HTTP/2 stream</strong>, so many calls share one connection.</li>
  <li><strong>The server</strong> decodes the request, runs your handler, and replies with the response plus a <code>grpc-status</code> in the HTTP/2 trailers.</li>
</ol>

<figure class="diagram">
<svg viewBox="0 0 780 300" role="img" aria-label="A .proto file generates a client stub and a server base class. The stub calls the server over one HTTP/2 stream per call. On the stream: request headers with the method path and timeout, data frames with length-prefixed protobuf, and response trailers with grpc-status.">
  <defs><marker id="arr-grpc-1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <rect class="box accent" x="290" y="12" width="200" height="50" rx="10"/>
  <text x="390" y="34" text-anchor="middle" class="title">order.proto</text>
  <text x="390" y="52" text-anchor="middle" class="small">the contract</text>
  <path class="line dashed" d="M310 62 L160 108" marker-end="url(#arr-grpc-1)"/>
  <path class="line dashed" d="M470 62 L620 108" marker-end="url(#arr-grpc-1)"/>
  <text x="390" y="92" text-anchor="middle" class="small">protoc generates code</text>

  <rect class="box" x="30" y="110" width="220" height="54" rx="10"/>
  <text x="140" y="133" text-anchor="middle" class="title">Client stub</text>
  <text x="140" y="152" text-anchor="middle" class="small">you call client.GetOrder(ctx, req)</text>
  <rect class="box" x="530" y="110" width="220" height="54" rx="10"/>
  <text x="640" y="133" text-anchor="middle" class="title">Server base class</text>
  <text x="640" y="152" text-anchor="middle" class="small">you implement GetOrder()</text>
  <text x="390" y="128" text-anchor="middle">HTTP/2</text>
  <path class="line accent" d="M252 137 H526" marker-end="url(#arr-grpc-1)" marker-start="url(#arr-grpc-1)"/>
  <text x="390" y="156" text-anchor="middle" class="small">one stream per call</text>

  <text x="390" y="196" text-anchor="middle" class="small">what travels on that stream</text>
  <rect class="box" x="30" y="206" width="300" height="80" rx="8"/>
  <text x="180" y="226" text-anchor="middle" class="title">request HEADERS</text>
  <text x="180" y="244" text-anchor="middle" class="small">:path /orders.v1.OrderService/GetOrder</text>
  <text x="180" y="260" text-anchor="middle" class="small">content-type: application/grpc</text>
  <text x="180" y="276" text-anchor="middle" class="small">grpc-timeout: 300m</text>
  <rect class="box" x="345" y="206" width="200" height="80" rx="8"/>
  <text x="445" y="226" text-anchor="middle" class="title">DATA (both ways)</text>
  <text x="445" y="244" text-anchor="middle" class="small">[1-byte flag][4-byte length]</text>
  <text x="445" y="260" text-anchor="middle" class="small">[protobuf bytes]</text>
  <rect class="box" x="560" y="206" width="190" height="80" rx="8"/>
  <text x="655" y="226" text-anchor="middle" class="title">response trailers</text>
  <text x="655" y="244" text-anchor="middle" class="small">grpc-status: 0 (OK)</text>
  <text x="655" y="260" text-anchor="middle" class="small">grpc-message: …</text>
</svg>
<figcaption>One contract, generated code on both sides. A call is an HTTP/2 stream: a path naming the method, length-prefixed protobuf messages, and a status in the trailers.</figcaption>
</figure>

<h3>Protocol Buffers: why it's small and evolvable</h3>
<p>Protobuf identifies fields by <strong>number</strong>, not by name. A message with <code>id = 42</code> in field 1 encodes to 2 bytes (<code>08 2A</code>: "field 1, varint" then 42); the JSON <code>{"id":42}</code> is 9 bytes. Because readers skip field numbers they don't know, old and new versions can talk to each other: add a field, and old clients just ignore it. The flip side: <strong>field numbers are forever</strong>. Reusing or retyping one silently corrupts data between versions.</p>

<h3>Four kinds of calls</h3>
<figure class="diagram">
<svg viewBox="0 0 780 250" role="img" aria-label="Four call types. Unary: one request, one response. Server streaming: one request, many responses. Client streaming: many requests, one response. Bidirectional: both sides send messages independently.">
  <defs><marker id="arr-grpc-2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <path class="line" d="M200 10 V240 M395 10 V240 M590 10 V240" style="stroke: var(--line)"/>

  <text x="102" y="22" text-anchor="middle" class="title">Unary</text>
  <text x="50" y="44" text-anchor="middle" class="small">client</text><text x="155" y="44" text-anchor="middle" class="small">server</text>
  <path class="line dashed" d="M50 52 V190 M155 52 V190" style="stroke: var(--line)"/>
  <path class="line accent" d="M50 80 H153" marker-end="url(#arr-grpc-2)"/>
  <path class="line ok dashed" d="M155 120 H52" marker-end="url(#arr-grpc-2)"/>
  <text x="102" y="214" text-anchor="middle" class="small">GetOrder</text>
  <text x="102" y="230" text-anchor="middle" class="small">like a REST call</text>

  <text x="297" y="22" text-anchor="middle" class="title">Server streaming</text>
  <text x="245" y="44" text-anchor="middle" class="small">client</text><text x="350" y="44" text-anchor="middle" class="small">server</text>
  <path class="line dashed" d="M245 52 V190 M350 52 V190" style="stroke: var(--line)"/>
  <path class="line accent" d="M245 75 H348" marker-end="url(#arr-grpc-2)"/>
  <path class="line ok dashed" d="M350 105 H247" marker-end="url(#arr-grpc-2)"/>
  <path class="line ok dashed" d="M350 130 H247" marker-end="url(#arr-grpc-2)"/>
  <path class="line ok dashed" d="M350 155 H247" marker-end="url(#arr-grpc-2)"/>
  <text x="297" y="214" text-anchor="middle" class="small">WatchOrder</text>
  <text x="297" y="230" text-anchor="middle" class="small">status updates, price feed</text>

  <text x="492" y="22" text-anchor="middle" class="title">Client streaming</text>
  <text x="440" y="44" text-anchor="middle" class="small">client</text><text x="545" y="44" text-anchor="middle" class="small">server</text>
  <path class="line dashed" d="M440 52 V190 M545 52 V190" style="stroke: var(--line)"/>
  <path class="line accent" d="M440 75 H543" marker-end="url(#arr-grpc-2)"/>
  <path class="line accent" d="M440 100 H543" marker-end="url(#arr-grpc-2)"/>
  <path class="line accent" d="M440 125 H543" marker-end="url(#arr-grpc-2)"/>
  <path class="line ok dashed" d="M545 160 H442" marker-end="url(#arr-grpc-2)"/>
  <text x="492" y="214" text-anchor="middle" class="small">UploadEvents</text>
  <text x="492" y="230" text-anchor="middle" class="small">batch upload, one summary</text>

  <text x="685" y="22" text-anchor="middle" class="title">Bidirectional</text>
  <text x="635" y="44" text-anchor="middle" class="small">client</text><text x="740" y="44" text-anchor="middle" class="small">server</text>
  <path class="line dashed" d="M635 52 V190 M740 52 V190" style="stroke: var(--line)"/>
  <path class="line accent" d="M635 72 H738" marker-end="url(#arr-grpc-2)"/>
  <path class="line ok dashed" d="M740 94 H637" marker-end="url(#arr-grpc-2)"/>
  <path class="line accent" d="M635 116 H738" marker-end="url(#arr-grpc-2)"/>
  <path class="line accent" d="M635 138 H738" marker-end="url(#arr-grpc-2)"/>
  <path class="line ok dashed" d="M740 160 H637" marker-end="url(#arr-grpc-2)"/>
  <text x="687" y="214" text-anchor="middle" class="small">Chat, live sync</text>
  <text x="687" y="230" text-anchor="middle" class="small">both sides talk freely</text>
</svg>
<figcaption>Streaming comes for free from HTTP/2 streams. Solid arrows are client messages, dashed arrows are server messages.</figcaption>
</figure>

<p>In Go (<code>grpc-go</code>), each call type becomes a method that takes either a <code>context</code> or a stream object:</p>
<table>
  <tr><th>Call type</th><th>In the .proto</th><th>Generated Go server method</th></tr>
  <tr><td>Unary</td><td><code>rpc GetOrder(Req) returns (Order)</code></td><td><code>GetOrder(ctx context.Context, req *Req) (*Order, error)</code></td></tr>
  <tr><td>Server streaming</td><td><code>returns (stream Event)</code></td><td><code>WatchOrder(req *Req, stream grpc.ServerStreamingServer[Event]) error</code></td></tr>
  <tr><td>Client streaming</td><td><code>(stream Event) returns (Summary)</code></td><td><code>Upload(stream grpc.ClientStreamingServer[Event, Summary]) error</code></td></tr>
  <tr><td>Bidirectional</td><td><code>(stream Msg) returns (stream Msg)</code></td><td><code>Chat(stream grpc.BidiStreamingServer[Msg, Msg]) error</code></td></tr>
</table>

<h3>Deadlines and status codes</h3>
<p>Every call can carry a <strong>deadline</strong> ("give up 300 ms from now"), sent as the <code>grpc-timeout</code> header. The server can see how much time is left and pass the remaining budget on to the services it calls (in Go, just pass the incoming <code>ctx</code> to outgoing calls), so a whole chain gives up together instead of doing work nobody is waiting for. <strong>By default there is no deadline</strong>: a call can wait forever.</p>
<p>Errors use a fixed set of 17 status codes instead of HTTP statuses. The HTTP response itself is <code>200</code> even when the call failed; the real result is <code>grpc-status</code> in the trailers.</p>
<table>
  <tr><th>Code</th><th>Meaning</th><th>Closest HTTP</th><th>Retry?</th></tr>
  <tr><td><code>OK</code> (0)</td><td>success</td><td>200</td><td>–</td></tr>
  <tr><td><code>INVALID_ARGUMENT</code> (3)</td><td>bad input, whatever the system state</td><td>400</td><td>no</td></tr>
  <tr><td><code>DEADLINE_EXCEEDED</code> (4)</td><td>ran out of time (the work may still have happened)</td><td>504</td><td>only if idempotent</td></tr>
  <tr><td><code>NOT_FOUND</code> (5)</td><td>entity doesn't exist</td><td>404</td><td>no</td></tr>
  <tr><td><code>PERMISSION_DENIED</code> (7)</td><td>authenticated, but not allowed</td><td>403</td><td>no</td></tr>
  <tr><td><code>RESOURCE_EXHAUSTED</code> (8)</td><td>quota or rate limit hit</td><td>429</td><td>later, with backoff</td></tr>
  <tr><td><code>INTERNAL</code> (13)</td><td>bug or broken invariant on the server</td><td>500</td><td>usually no</td></tr>
  <tr><td><code>UNAVAILABLE</code> (14)</td><td>server down or overloaded, temporary</td><td>503</td><td><strong>yes</strong>, with backoff</td></tr>
  <tr><td><code>UNAUTHENTICATED</code> (16)</td><td>missing or invalid credentials</td><td>401</td><td>after re-auth</td></tr>
</table>

<h2>gRPC vs REST + JSON</h2>
<table>
  <tr><th></th><th>REST + JSON</th><th>gRPC</th></tr>
  <tr><td>Contract</td><td>optional (OpenAPI), often drifts from the code</td><td>required <code>.proto</code>; code is generated from it</td></tr>
  <tr><td>Payload</td><td>JSON text, human-readable</td><td>protobuf binary: smaller, faster to parse, not readable by eye</td></tr>
  <tr><td>Transport</td><td>HTTP/1.1 or HTTP/2</td><td>HTTP/2 only</td></tr>
  <tr><td>Streaming</td><td>bolt-ons (SSE, WebSockets)</td><td>built in, both directions</td></tr>
  <tr><td>Browser support</td><td>native</td><td>needs gRPC-Web or Connect plus a proxy</td></tr>
  <tr><td>Debugging</td><td>curl, browser DevTools</td><td>grpcurl, Postman, server reflection</td></tr>
  <tr><td>Caching</td><td>HTTP caches and CDNs work out of the box</td><td>everything is POST: no HTTP caching</td></tr>
  <tr><td>Best fit</td><td>public APIs, browsers, third parties</td><td>internal service-to-service, mobile apps, streaming</td></tr>
</table>

<h2>Example</h2>
<p><strong>The contract</strong> (<code>orders/v1/order.proto</code>):</p>
<pre><code>syntax = "proto3";
package orders.v1;

service OrderService {
  rpc GetOrder(GetOrderRequest) returns (Order);
  rpc WatchOrder(GetOrderRequest) returns (stream OrderEvent);
}

message GetOrderRequest {
  string id = 1;
}

message Order {
  enum Status { STATUS_UNSPECIFIED = 0; PAID = 1; SHIPPED = 2; }

  string id = 1;
  int64 total_cents = 2;
  Status status = 3;
  reserved 4;  // old "coupon" field: removed, and its number is never reused
}

message OrderEvent {
  Order.Status status = 1;
}</code></pre>

<p><strong>Server</strong> (Go, <code>grpc-go</code>): implement the generated interface.</p>
<pre><code>type orderServer struct {
	pb.UnimplementedOrderServiceServer // methods you don't write return UNIMPLEMENTED
	store *OrderStore
}

func (s *orderServer) GetOrder(ctx context.Context, req *pb.GetOrderRequest) (*pb.Order, error) {
	o, ok := s.store.Find(ctx, req.GetId())
	if !ok {
		return nil, status.Errorf(codes.NotFound, "order %s not found", req.GetId())
	}
	return &amp;pb.Order{Id: o.ID, TotalCents: o.TotalCents, Status: pb.Order_PAID}, nil
}

func (s *orderServer) WatchOrder(req *pb.GetOrderRequest, stream grpc.ServerStreamingServer[pb.OrderEvent]) error {
	for st := range s.store.StatusUpdates(stream.Context(), req.GetId()) {
		if err := stream.Send(&amp;pb.OrderEvent{Status: st}); err != nil {
			return err // client went away
		}
	}
	return nil
}

func main() {
	lis, err := net.Listen("tcp", ":50051")
	if err != nil {
		log.Fatal(err)
	}
	srv := grpc.NewServer()
	pb.RegisterOrderServiceServer(srv, &amp;orderServer{store: NewOrderStore()})
	reflection.Register(srv) // lets grpcurl discover the API
	log.Fatal(srv.Serve(lis))
}</code></pre>

<p><strong>Client</strong>: always set a deadline, and spread calls across every server.</p>
<pre><code>conn, err := grpc.NewClient("dns:///orders.internal:50051",
	grpc.WithTransportCredentials(insecure.NewCredentials()), // inside a mesh that adds TLS; use TLS otherwise
	grpc.WithDefaultServiceConfig(&#96;{"loadBalancingConfig": [{"round_robin": {}}]}&#96;), // one connection per resolved IP, calls rotated
)
if err != nil {
	log.Fatal(err)
}
defer conn.Close()
client := pb.NewOrderServiceClient(conn)

ctx, cancel := context.WithTimeout(ctx, 300*time.Millisecond) // the deadline travels with the call
defer cancel()

order, err := client.GetOrder(ctx, &amp;pb.GetOrderRequest{Id: "42"})
switch status.Code(err) {
case codes.OK:
	fmt.Println(order.GetTotalCents())
case codes.NotFound:
	// show "order not found"
case codes.DeadlineExceeded, codes.Unavailable:
	// retry with backoff, or degrade
default:
	return err
}</code></pre>

<p><strong>Poking a server from the terminal</strong> with <code>grpcurl</code> (needs server reflection enabled, or the .proto files):</p>
<pre><code>$ grpcurl -plaintext localhost:50051 list
orders.v1.OrderService

$ grpcurl -plaintext -d '{"id": "42"}' localhost:50051 orders.v1.OrderService/GetOrder
{
  "id": "42",
  "totalCents": "1999",
  "status": "PAID"
}</code></pre>
<p>Note <code>"1999"</code> is a string: protobuf's JSON form writes 64-bit integers as strings, because JavaScript numbers can't hold all of them exactly.</p>

<p><strong>Real-world scenario.</strong> A checkout service calls inventory, pricing and payments on every order. Moving those internal calls to gRPC gives each team a shared, versioned <code>.proto</code>, generated clients for every language in use, and a deadline that flows through the whole chain: if checkout has 800 ms left, pricing knows it and doesn't start work it can't finish. The public API for the web and partners stays REST + JSON, translated at the edge by an API gateway (Envoy's gRPC-JSON transcoder or <code>grpc-gateway</code>).</p>

<h2>Load balancing: the classic gRPC surprise</h2>
<p>gRPC keeps one long-lived HTTP/2 connection and sends every call over it. A <strong>layer-4</strong> load balancer (one that balances <em>connections</em>, like a plain Kubernetes <code>ClusterIP</code> Service or an AWS NLB) picks a backend once, when the connection opens. After that, every call goes to that one pod, and newly added pods get nothing.</p>

<figure class="diagram">
<svg viewBox="0 0 780 250" role="img" aria-label="Left: an L4 load balancer pins the client's single HTTP/2 connection to pod 1, while pods 2 and 3 sit idle. Right: client-side or L7 load balancing spreads calls across all three pods.">
  <defs><marker id="arr-grpc-3" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <text x="195" y="22" text-anchor="middle" class="title">L4 balancing: one connection, one pod</text>
  <text x="590" y="22" text-anchor="middle" class="title">Client-side or L7 balancing</text>
  <path class="line" d="M395 10 V240" style="stroke: var(--line)"/>

  <rect class="box" x="20" y="100" width="90" height="40" rx="8"/><text x="65" y="125" text-anchor="middle">client</text>
  <rect class="box" x="145" y="100" width="100" height="40" rx="8"/><text x="195" y="125" text-anchor="middle">L4 LB</text>
  <path class="line bad" d="M110 120 H143" marker-end="url(#arr-grpc-3)"/>
  <path class="line bad" d="M245 112 L278 62" marker-end="url(#arr-grpc-3)"/>
  <rect class="box bad" x="280" y="40" width="100" height="40" rx="8"/><text x="330" y="65" text-anchor="middle">pod 1: all</text>
  <rect class="box muted" x="280" y="100" width="100" height="40" rx="8"/><text x="330" y="125" text-anchor="middle">pod 2: idle</text>
  <rect class="box muted" x="280" y="160" width="100" height="40" rx="8"/><text x="330" y="185" text-anchor="middle">pod 3: idle</text>
  <text x="195" y="230" text-anchor="middle" class="small">the LB balanced the connection, not the calls</text>

  <rect class="box" x="420" y="95" width="120" height="50" rx="8"/>
  <text x="480" y="116" text-anchor="middle">client</text>
  <text x="480" y="134" text-anchor="middle" class="small">round_robin</text>
  <path class="line ok" d="M540 110 L638 62" marker-end="url(#arr-grpc-3)"/>
  <path class="line ok" d="M540 120 H638" marker-end="url(#arr-grpc-3)"/>
  <path class="line ok" d="M540 130 L638 178" marker-end="url(#arr-grpc-3)"/>
  <rect class="box ok" x="640" y="40" width="120" height="40" rx="8"/><text x="700" y="65" text-anchor="middle">pod 1: 1/3</text>
  <rect class="box ok" x="640" y="100" width="120" height="40" rx="8"/><text x="700" y="125" text-anchor="middle">pod 2: 1/3</text>
  <rect class="box ok" x="640" y="160" width="120" height="40" rx="8"/><text x="700" y="185" text-anchor="middle">pod 3: 1/3</text>
  <text x="590" y="230" text-anchor="middle" class="small">client knows every pod IP, or an L7 proxy balances each call</text>
</svg>
<figcaption>Fixes: client-side balancing (a Kubernetes <em>headless</em> Service so DNS returns every pod IP, plus <code>round_robin</code>), or an L7 proxy that understands HTTP/2 (Envoy, a service mesh like Istio or Linkerd, AWS ALB with a gRPC target group).</figcaption>
</figure>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>No deadline = waits forever.</strong> gRPC calls have no timeout by default. One slow dependency then piles up stuck calls until threads or memory run out. Set a deadline on every call (see <a href="#timeouts">Timeouts</a>).</li>
  <li><strong>Connection-level load balancing.</strong> Covered above: the most common production surprise. Watch for one hot pod after scaling up.</li>
  <li><strong>Breaking the contract.</strong> Never reuse or retype a field number; mark removed ones <code>reserved</code>. Renaming a field is safe on the wire but breaks the JSON form. Run <code>buf breaking</code> in CI to catch it.</li>
  <li><strong>proto3 can't tell "0" from "not set".</strong> Unset scalars read as their default (<code>0</code>, <code>""</code>, first enum value). Use <code>optional</code> when "missing" matters, and make enum value 0 an <code>UNSPECIFIED</code> placeholder.</li>
  <li><strong>Browsers can't call gRPC directly.</strong> They can't control HTTP/2 frames or read trailers. Use gRPC-Web or Connect with a proxy, or keep REST at the edge.</li>
  <li><strong>Monitoring that only reads HTTP status sees all green.</strong> Failed calls still return HTTP 200. Alert on <code>grpc-status</code> instead.</li>
  <li><strong>Message size limit.</strong> Most implementations reject incoming messages over 4 MB by default. For big payloads, stream chunks or upload to object storage and pass a link.</li>
  <li><strong>Long-lived streams vs idle timeouts.</strong> Proxies and load balancers cut quiet connections. Configure keepalive pings, and make stream consumers reconnect and resume.</li>
  <li><strong>Retry only what's safe.</strong> <code>UNAVAILABLE</code> is the one code that's generally safe to retry. Retrying after <code>DEADLINE_EXCEEDED</code> can run a non-idempotent action twice (see <a href="#idempotency">Idempotency</a>).</li>
</ul>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>gRPC = a <code>.proto</code> contract + generated clients and servers + protobuf over HTTP/2.</li>
  <li>Four call types: unary, server streaming, client streaming, bidirectional.</li>
  <li>Always set deadlines, handle status codes, and use L7 or client-side load balancing.</li>
  <li>Best for internal service-to-service traffic; keep REST/JSON for browsers and public APIs.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#http-2-http-3">HTTP/2 &amp; HTTP/3</a> · <a href="#load-balancing">Load Balancing</a> · <a href="#service-discovery">Service Discovery</a> · <a href="#timeouts">Timeouts</a> · <a href="#retries">Retries</a> · <a href="#api-gateways">API Gateways</a> · <a href="#schema-versioning">Schema Versioning</a></p>
`;

CONTENT["what-happens-when-you-type-google-com"] = `
<p class="tldr"><strong>TL;DR</strong>: Between pressing Enter and seeing the page, about ten systems work together in a few hundred milliseconds: the browser works out the URL and checks its caches, <a href="#dns">DNS</a> turns the name into an IP, <a href="#tcp-vs-udp">TCP</a> (or QUIC) connects, <a href="#tls">TLS</a> secures the line, an <a href="#http-2-http-3">HTTP</a> request travels to a nearby edge server and on to the backend, and the browser turns the HTML that comes back into pixels.</p>

<h2>Why this question matters</h2>
<p>It's the classic interview question because the answer touches every concept in this group, and it's the mental model you need when someone says "the site is slow". Slow <em>where</em>? Each step below has its own failure modes, its own tools, and shows up as its own bar in the browser's timing view. If you can name the step, you can fix it.</p>

<h2>How it works</h2>
<figure class="diagram">
<svg viewBox="0 0 780 268" role="img" aria-label="Ten steps: 1 parse the URL, 2 check caches, 3 DNS lookup, 4 connect with TCP or QUIC, 5 TLS handshake, 6 send the HTTP request, 7 Google's edge, 8 backend, 9 response, 10 render.">
  <defs><marker id="arr-gc-1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrowhead" d="M0,0 L10,5 L0,10z"/></marker></defs>
  <rect class="box accent" x="10" y="30" width="136" height="72" rx="10"/>
  <text x="78" y="56" text-anchor="middle" class="title">1 Parse URL</text>
  <text x="78" y="76" text-anchor="middle" class="small">add https://</text>
  <text x="78" y="91" text-anchor="middle" class="small">check HSTS list</text>
  <rect class="box accent" x="166" y="30" width="136" height="72" rx="10"/>
  <text x="234" y="56" text-anchor="middle" class="title">2 Caches</text>
  <text x="234" y="76" text-anchor="middle" class="small">service worker,</text>
  <text x="234" y="91" text-anchor="middle" class="small">HTTP cache</text>
  <rect class="box" x="322" y="30" width="136" height="72" rx="10"/>
  <text x="390" y="56" text-anchor="middle" class="title">3 DNS</text>
  <text x="390" y="76" text-anchor="middle" class="small">google.com → IP</text>
  <text x="390" y="91" text-anchor="middle" class="small">(usually cached)</text>
  <rect class="box" x="478" y="30" width="136" height="72" rx="10"/>
  <text x="546" y="56" text-anchor="middle" class="title">4 Connect</text>
  <text x="546" y="76" text-anchor="middle" class="small">TCP to port 443,</text>
  <text x="546" y="91" text-anchor="middle" class="small">or QUIC over UDP</text>
  <rect class="box" x="634" y="30" width="136" height="72" rx="10"/>
  <text x="702" y="56" text-anchor="middle" class="title">5 TLS 1.3</text>
  <text x="702" y="76" text-anchor="middle" class="small">verify certificate,</text>
  <text x="702" y="91" text-anchor="middle" class="small">agree on h2 / h3</text>
  <path class="line" d="M146 66 H164" marker-end="url(#arr-gc-1)"/>
  <path class="line" d="M302 66 H320" marker-end="url(#arr-gc-1)"/>
  <path class="line" d="M458 66 H476" marker-end="url(#arr-gc-1)"/>
  <path class="line" d="M614 66 H632" marker-end="url(#arr-gc-1)"/>
  <path class="line" d="M702 102 V148" marker-end="url(#arr-gc-1)"/>

  <rect class="box" x="634" y="150" width="136" height="72" rx="10"/>
  <text x="702" y="176" text-anchor="middle" class="title">6 HTTP request</text>
  <text x="702" y="196" text-anchor="middle" class="small">GET / → 301 to</text>
  <text x="702" y="211" text-anchor="middle" class="small">www.google.com</text>
  <rect class="box ok" x="478" y="150" width="136" height="72" rx="10"/>
  <text x="546" y="176" text-anchor="middle" class="title">7 Edge</text>
  <text x="546" y="196" text-anchor="middle" class="small">nearby server,</text>
  <text x="546" y="211" text-anchor="middle" class="small">TLS ends here</text>
  <rect class="box ok" x="322" y="150" width="136" height="72" rx="10"/>
  <text x="390" y="176" text-anchor="middle" class="title">8 Backend</text>
  <text x="390" y="196" text-anchor="middle" class="small">load balancer → app</text>
  <text x="390" y="211" text-anchor="middle" class="small">→ caches, services</text>
  <rect class="box ok" x="166" y="150" width="136" height="72" rx="10"/>
  <text x="234" y="176" text-anchor="middle" class="title">9 Response</text>
  <text x="234" y="196" text-anchor="middle" class="small">200 + compressed</text>
  <text x="234" y="211" text-anchor="middle" class="small">HTML, cookies</text>
  <rect class="box accent" x="10" y="150" width="136" height="72" rx="10"/>
  <text x="78" y="176" text-anchor="middle" class="title">10 Render</text>
  <text x="78" y="196" text-anchor="middle" class="small">DOM + CSSOM →</text>
  <text x="78" y="211" text-anchor="middle" class="small">layout → paint</text>
  <path class="line" d="M634 186 H616" marker-end="url(#arr-gc-1)"/>
  <path class="line" d="M478 186 H460" marker-end="url(#arr-gc-1)"/>
  <path class="line" d="M322 186 H304" marker-end="url(#arr-gc-1)"/>
  <path class="line" d="M166 186 H148" marker-end="url(#arr-gc-1)"/>

  <rect class="box accent" x="190" y="244" width="14" height="14" rx="3"/><text x="210" y="256" class="small">in the browser</text>
  <rect class="box" x="330" y="244" width="14" height="14" rx="3"/><text x="350" y="256" class="small">on the network</text>
  <rect class="box ok" x="470" y="244" width="14" height="14" rx="3"/><text x="490" y="256" class="small">Google's side</text>
</svg>
<figcaption>The whole journey. Steps 3–5 are paid once per new connection; steps 6–9 repeat for every request; step 10 triggers dozens more requests for CSS, JS and images.</figcaption>
</figure>

<h3>1. The browser works out what you meant</h3>
<p>"google.com" has no scheme, and it doesn't look like a search query, so the browser treats it as a site address. Modern browsers try <code>https://</code> first. If the site is on the browser's <strong>HSTS</strong> list (sites that said "only ever talk to me over HTTPS", or that are built into the browser's preload list), plain <code>http://</code> is never even attempted.</p>

<h3>2. Caches, before any network</h3>
<p>A service worker registered by the site can answer the request itself. Otherwise the browser checks its HTTP cache. A search homepage is usually marked as not cacheable, so the request goes out, but images, scripts and fonts often come straight from disk.</p>

<h3>3. DNS: name to IP address</h3>
<p>The browser asks its own DNS cache, then the operating system, then the configured recursive resolver (your ISP's, or 1.1.1.1 / 8.8.8.8). Only on a full miss does the resolver walk root → <code>.com</code> → Google's name servers. Most lookups are answered from a cache in a few milliseconds (see <a href="#dns">DNS</a> and its cache layers). The answer depends on where you are: Google hands out addresses of servers close to you.</p>

<h3>4–5. Connect and secure the line</h3>
<p>With an IP address, the browser opens a <strong>TCP</strong> connection to port 443 (3-way handshake, 1 round trip), then runs the <strong>TLS 1.3</strong> handshake (1 more round trip). During TLS:</p>
<ul>
  <li>The browser sends the hostname (<strong>SNI</strong>) so the server knows which certificate to present.</li>
  <li>It checks the certificate: signed by a trusted authority, not expired, and valid for <code>google.com</code>. If any check fails, you get the full-page warning.</li>
  <li>Both sides agree on the HTTP version (<strong>ALPN</strong>): usually <code>h2</code>.</li>
</ul>
<p>If the browser already knows the site speaks HTTP/3 (from an earlier <code>alt-svc</code> header or a DNS <code>HTTPS</code> record), it uses <strong>QUIC</strong> over UDP instead, combining both handshakes into one round trip (see <a href="#http-2-http-3">HTTP/2 &amp; HTTP/3</a>).</p>

<h3>6. The HTTP request, and a redirect</h3>
<p>The browser sends <code>GET /</code> with headers: <code>host</code>, <code>user-agent</code>, <code>accept-language</code>, cookies, and so on. For <code>google.com</code>, the answer is a <strong>301 redirect</strong> to <code>https://www.google.com/</code>, so the browser does it all again for <code>www</code>: another DNS lookup, and possibly another connection. One redirect easily costs a full round trip or more.</p>

<h3>7–8. Google's side</h3>
<p>The IP you connected to belongs to an <strong>edge</strong> server near you, not to the machine that builds the page. Google's edge (its "Google Front End") ends TLS close to you, absorbs attacks, and forwards the request over Google's private network to a <a href="#load-balancing">load balancer</a>, which picks a healthy web server. That server calls many internal services (search suggestions, your account, today's doodle) and assembles the HTML. Your own systems usually look the same, just smaller: <a href="#cdn">CDN</a> → load balancer → <a href="#reverse-proxies">reverse proxy</a> → app → cache and database.</p>

<h3>9–10. Response and rendering</h3>
<p>The response comes back <code>200 OK</code> with compressed HTML (<code>content-encoding: br</code> or <code>gzip</code>), cookies, and caching headers. The browser then:</p>
<ol>
  <li>Parses HTML into the <strong>DOM</strong>. A preload scanner spots CSS, JS and images early and requests them over the same connection.</li>
  <li>Parses CSS into the <strong>CSSOM</strong>. CSS blocks rendering, and a plain <code>&lt;script&gt;</code> blocks parsing until it has downloaded and run.</li>
  <li>Combines them, works out every element's size and position (<strong>layout</strong>), draws pixels (<strong>paint</strong>), and composites the layers on screen.</li>
</ol>

<h2>Where the time goes</h2>
<figure class="diagram">
<svg viewBox="0 0 780 262" role="img" aria-label="Example timing waterfall: DNS 20 ms, TCP 15 ms, TLS 15 ms, waiting for the first byte 60 ms, download 15 ms, then parse and render about 110 ms.">
  <text x="20" y="35" class="title">DNS lookup</text>
  <rect class="box" x="180" y="18" width="40" height="24" rx="4"/><text x="228" y="35" class="small">20 ms</text>
  <text x="20" y="70" class="title">TCP connect</text>
  <rect class="box" x="220" y="53" width="30" height="24" rx="4"/><text x="258" y="70" class="small">15 ms (1 round trip)</text>
  <text x="20" y="105" class="title">TLS handshake</text>
  <rect class="box" x="250" y="88" width="30" height="24" rx="4"/><text x="288" y="105" class="small">15 ms (1 round trip)</text>
  <text x="20" y="140" class="title">Waiting (TTFB)</text>
  <rect class="box accent" x="280" y="123" width="120" height="24" rx="4"/><text x="408" y="140" class="small">60 ms: network + server work</text>
  <text x="20" y="175" class="title">Download</text>
  <rect class="box" x="400" y="158" width="30" height="24" rx="4"/><text x="438" y="175" class="small">15 ms</text>
  <text x="20" y="210" class="title">Parse + render</text>
  <rect class="box ok" x="430" y="193" width="220" height="24" rx="4"/><text x="658" y="210" class="small">~110 ms</text>
  <path class="line" d="M180 230 H760" style="stroke: var(--line)"/>
  <text x="180" y="248" text-anchor="middle" class="small">0</text>
  <text x="280" y="248" text-anchor="middle" class="small">50 ms</text>
  <text x="380" y="248" text-anchor="middle" class="small">100 ms</text>
  <text x="480" y="248" text-anchor="middle" class="small">150 ms</text>
  <text x="580" y="248" text-anchor="middle" class="small">200 ms</text>
  <text x="680" y="248" text-anchor="middle" class="small">250 ms</text>
</svg>
<figcaption>Illustrative numbers for one request on a good connection (about 15 ms round trip). Chrome DevTools shows the real ones: Network tab → click a request → <em>Timing</em> (DNS Lookup, Initial connection, SSL, Waiting for server response, Content Download).</figcaption>
</figure>

<h2>Debugging map: which step is slow?</h2>
<table>
  <tr><th>Step</th><th>Typical problem</th><th>How to see it</th><th>Concept</th></tr>
  <tr><td>DNS</td><td>slow or stale resolver, cached old IP after a move</td><td><code>dig</code>, DevTools "DNS Lookup"</td><td><a href="#dns">DNS</a></td></tr>
  <tr><td>Connect</td><td>packet loss (dropped SYNs are retried after ~1 s), far-away server, firewall</td><td>DevTools "Initial connection", <code>curl -w</code></td><td><a href="#tcp-vs-udp">TCP vs UDP</a></td></tr>
  <tr><td>TLS</td><td>expired or wrong certificate, missing intermediate, old TLS version</td><td><code>openssl s_client -connect host:443</code></td><td><a href="#tls">TLS</a></td></tr>
  <tr><td>Redirects</td><td>http → https → www chains, each costing a round trip</td><td><code>curl -sIL</code>, DevTools 3xx rows</td><td><a href="#http-2-http-3">HTTP/2 &amp; HTTP/3</a></td></tr>
  <tr><td>Waiting (TTFB)</td><td>slow backend, cache misses, queueing at the load balancer</td><td>DevTools "Waiting", server traces</td><td><a href="#latency">Latency</a>, <a href="#caching">Caching</a></td></tr>
  <tr><td>Download</td><td>large uncompressed payloads, no CDN</td><td>DevTools size column, <code>content-encoding</code></td><td><a href="#cdn">CDN</a></td></tr>
  <tr><td>Render</td><td>render-blocking CSS and JS, huge DOM</td><td>DevTools Performance tab, Lighthouse</td><td>–</td></tr>
</table>

<h2>Example</h2>
<p><strong>Watch the steps happen with Go.</strong> <code>net/http/httptrace</code> lets you hook into each phase of a request. This program fetches <code>https://google.com</code> without following the redirect and prints where the time went:</p>
<pre><code>package main

import (
	"crypto/tls"
	"fmt"
	"log"
	"net/http"
	"net/http/httptrace"
	"time"
)

func main() {
	var start, dnsStart, connStart, tlsStart time.Time
	trace := &amp;httptrace.ClientTrace{
		DNSStart: func(httptrace.DNSStartInfo) { dnsStart = time.Now() },
		DNSDone: func(info httptrace.DNSDoneInfo) {
			fmt.Printf("DNS         %v  %d addresses&#92;n", time.Since(dnsStart), len(info.Addrs))
		},
		ConnectStart: func(network, addr string) { connStart = time.Now() },
		ConnectDone: func(network, addr string, err error) {
			fmt.Printf("TCP         %v  %s&#92;n", time.Since(connStart), addr)
		},
		TLSHandshakeStart: func() { tlsStart = time.Now() },
		TLSHandshakeDone: func(cs tls.ConnectionState, err error) {
			fmt.Printf("TLS         %v  %s, ALPN=%s&#92;n", time.Since(tlsStart), tls.VersionName(cs.Version), cs.NegotiatedProtocol)
		},
		GotFirstResponseByte: func() {
			fmt.Printf("first byte  %v  since start&#92;n", time.Since(start))
		},
	}

	client := &amp;http.Client{
		// stop at the first response so we can see the redirect
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	req, err := http.NewRequest(http.MethodGet, "https://google.com", nil)
	if err != nil {
		log.Fatal(err)
	}
	req = req.WithContext(httptrace.WithClientTrace(req.Context(), trace))

	start = time.Now()
	resp, err := client.Do(req)
	if err != nil {
		log.Fatal(err)
	}
	defer resp.Body.Close()
	fmt.Println(resp.Proto, resp.Status, "→", resp.Header.Get("Location"))
}</code></pre>
<p>A real run (your numbers will differ; here the server was far away, so each round trip cost about 57 ms):</p>
<pre><code>DNS         14.0825ms  5 addresses
TCP         57.071292ms  142.250.197.142:443
TLS         81.888417ms  TLS 1.3, ALPN=h2
first byte  232.027958ms  since start
HTTP/2.0 301 Moved Permanently → https://www.google.com/</code></pre>
<p>Go's standard client speaks HTTP/1.1 and HTTP/2 over TCP, so you'll always see the TCP path here. Chrome may use QUIC for the same site.</p>

<p><strong>The same from the terminal:</strong></p>
<pre><code>$ dig +short google.com                 # step 3: the IPs you're given (they vary by location)
$ curl -sI https://google.com | head -3  # step 6: the redirect
HTTP/2 301
location: https://www.google.com/
content-type: text/html; charset=UTF-8

$ curl -so /dev/null -w 'dns %{time_namelookup}  tcp %{time_connect}  tls %{time_appconnect}  ttfb %{time_starttransfer}  total %{time_total}&#92;n' https://www.google.com
dns 0.021  tcp 0.036  tls 0.052  ttfb 0.151  total 0.197</code></pre>
<p>curl's times are cumulative seconds since the start: TCP took 0.036 − 0.021 = 15 ms.</p>

<p><strong>Real-world scenario: "the site is slow, but only for some users".</strong> The backend dashboards look healthy. A user's DevTools timing shows about 1 s in "Initial connection" and normal times everywhere else. A delay of roughly one second in connect is the signature of a lost SYN being retried after TCP's initial retransmission timeout. Which leads to the real cause: a packet-dropping link or an overloaded load balancer in one region, not the application. Knowing the steps turned "it's slow" into "step 4 is slow in region X" in minutes.</p>

<h2>Trade-offs &amp; pitfalls</h2>
<ul>
  <li><strong>"DNS goes to the root every time."</strong> It almost never does: answers are cached at several layers. The flip side is that changes take up to the TTL to reach everyone.</li>
  <li><strong>Redirects aren't free.</strong> <code>http://example.com</code> → <code>https://example.com</code> → <code>https://www.example.com</code> can add hundreds of milliseconds on mobile. Link to the final URL and use HSTS so the http hop disappears.</li>
  <li><strong>Every new origin pays steps 3–5 again.</strong> Fonts from one domain, analytics from another, images from a third: each needs its own DNS, TCP and TLS. Use fewer origins, or <code>&lt;link rel="preconnect"&gt;</code> for the ones you must call.</li>
  <li><strong>TTFB is not "backend time".</strong> It includes a network round trip, load-balancer queueing, and the server's work. Compare it with server-side traces before blaming the code.</li>
  <li><strong>"It works for me."</strong> DNS and anycast send users in different places to different servers, so one region can be broken while yours is fine. Test from several locations.</li>
  <li><strong>Render-blocking resources.</strong> A fast server doesn't help if the page waits on a big CSS file or a synchronous script in <code>&lt;head&gt;</code>. Use <code>defer</code> or <code>async</code> on scripts and keep critical CSS small.</li>
  <li><strong>Connections are the expensive part, so reuse them.</strong> HTTP keep-alive and HTTP/2 let later requests skip steps 3–5 entirely. The same lesson applies between your own services: <a href="#connection-pooling">connection pooling</a>.</li>
</ul>

<div class="callout tip"><strong>Key takeaways</strong>
<ul>
  <li>URL → caches → DNS → TCP/QUIC → TLS → HTTP → edge → backend → response → render.</li>
  <li>Steps 3–5 are per connection and dominated by round trips: reuse connections, avoid extra origins and redirects.</li>
  <li>Use the DevTools timing bars or <code>curl -w</code> to find which step is slow before guessing.</li>
  <li>Every concept in this group (DNS, TCP/UDP, HTTP/2 and 3, gRPC) is one of these steps seen up close.</li>
</ul></div>

<p><strong>Related:</strong> <a href="#dns">DNS</a> · <a href="#tcp-vs-udp">TCP vs UDP</a> · <a href="#tls">TLS</a> · <a href="#http-2-http-3">HTTP/2 &amp; HTTP/3</a> · <a href="#cdn">CDN</a> · <a href="#load-balancing">Load Balancing</a> · <a href="#latency">Latency</a></p>
`;
