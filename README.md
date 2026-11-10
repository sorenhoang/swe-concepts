# swe-concepts

**Software Engineer Concept** is a single-page tracker for 115 software engineering concepts, grouped into 17 topics. The original 111 come from [@nataindata](https://www.instagram.com/nataindata/)'s "Who's gonna tell vibe coders about…".

**Live:** https://sorenhoang.github.io/swe-concepts/

## Usage

Open `index.html` in a browser. It has no build step and no dependencies.

- The left sidebar lists the groups. Expand one to see its concepts.
- Concepts are numbered top-down in sidebar order.
- Click a group or a concept to open it. Links like `#c-1` and `#g-0` can be bookmarked.
- Concepts you haven't learned yet show **Coming soon**. The progress bar counts the learned ones.

## Adding content for a learned concept

Content lives in one file per group, `content/<group-slug>.js`, and each concept is registered by its slug:

```js
CONTENT["rate-limiting"] = `
  <p class="tldr">…</p>
  <h2>How it works</h2>
  <figure class="diagram"><svg viewBox="0 0 780 300">…</svg></figure>
`;
```

Load the file in `index.html` with `<script src="content/<group-slug>.js"></script>`, next to the comment that explains it. Once a concept has content, it switches from "Coming soon" to "Learned" and the progress counts update. Inline SVG diagrams use the `.diagram` classes in `index.html`, so they work in both light and dark mode.

## Groups

| Group | # |
|---|---|
| Networking & Protocols | 5 |
| Real-time & Integration | 5 |
| Traffic & API Management | 7 |
| Caching & Content Delivery | 4 |
| Resilience & Fault Tolerance | 6 |
| Messaging & Async Processing | 5 |
| Distributed Systems | 9 |
| Databases & Data Modeling | 9 |
| Concurrency & Memory | 7 |
| Scalability & Performance | 10 |
| Containers & Infrastructure as Code | 5 |
| CI/CD & Release Engineering | 9 |
| Observability & Reliability Targets | 12 |
| Security: Identity & Encryption | 7 |
| Security: Web Threats & Defense | 7 |
| Disaster Recovery & High Availability | 5 |
| Incident Management | 3 |
