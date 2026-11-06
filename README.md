# swe-concepts

**Software Engineer Concept** is a single-page tracker for 111 software engineering concepts, grouped into 17 topics. The list comes from [@nataindata](https://www.instagram.com/nataindata/)'s "Who's gonna tell vibe coders about…".

## Usage

Open `index.html` in a browser. It has no build step and no dependencies.

- The left sidebar lists the groups. Expand one to see its concepts.
- Concepts are numbered 1–111 top-down in sidebar order.
- Click a group or a concept to open it. Links like `#c-1` and `#g-0` can be bookmarked.
- Concepts you haven't learned yet show **Coming soon**. The progress bar counts the learned ones.

## Adding content for a learned concept

Add a `<template>` keyed by the concept's slug (lowercase name, non-alphanumerics → `-`) to `index.html`, below the `LEARNED CONCEPTS` comment:

```html
<template id="concept-rate-limiting">
  <h2>What it is</h2>
  <p>…</p>
</template>
```

Once the template is there, the concept loses its "Coming soon" tag and the progress counts update.

## Groups

| Group | # |
|---|---|
| Networking & Protocols | 4 |
| Real-time & Integration | 4 |
| Traffic & API Management | 6 |
| Caching & Content Delivery | 4 |
| Resilience & Fault Tolerance | 6 |
| Messaging & Async Processing | 5 |
| Distributed Systems | 9 |
| Databases & Data Modeling | 9 |
| Concurrency & Memory | 7 |
| Scalability & Performance | 10 |
| Containers & Infrastructure as Code | 5 |
| CI/CD & Release Engineering | 9 |
| Observability & Reliability Targets | 11 |
| Security: Identity & Encryption | 7 |
| Security: Web Threats & Defense | 7 |
| Disaster Recovery & High Availability | 5 |
| Incident Management | 3 |
