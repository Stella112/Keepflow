export const landingPageHtml = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#09101f">
    <meta name="description" content="KeepFlow is a lifestyle-continuity companion that turns disruptions into access-aware action plans, messages, delegated tasks, reminders, and downloadable briefs.">
    <meta property="og:title" content="KeepFlow — Keep moving when life shifts">
    <meta property="og:description" content="Calm, structured next steps for everyday routines and disruptive moments.">
    <meta property="og:type" content="website">
    <meta property="og:image" content="https://keepflow.site/assets/keepflow-logo.jpeg">
    <meta property="og:url" content="https://keepflow.site/">
    <title>KeepFlow — Lifestyle continuity, on demand</title>
    <link rel="icon" type="image/jpeg" href="/assets/keepflow-logo.jpeg">
    <link rel="stylesheet" href="/assets/keepflow.css">
  </head>
  <body>
    <a class="skip-link" href="#main">Skip to content</a>
    <div class="page-glow page-glow-one" aria-hidden="true"></div>
    <div class="page-glow page-glow-two" aria-hidden="true"></div>

    <header class="site-header">
      <nav class="nav shell" aria-label="Primary navigation">
        <a class="brand" href="#top" aria-label="KeepFlow home">
          <span class="brand-mark"><img src="/assets/keepflow-logo.jpeg" alt=""></span>
          <span>Keep<span>Flow</span></span>
        </a>
        <div class="nav-links">
          <a href="#services">Services</a>
          <a href="#continuity-demo">Demo</a>
          <a href="#how-it-works">How it works</a>
          <a href="#safety">Safety</a>
          <a href="#developers">API</a>
        </div>
        <a class="live-pill" href="/health"><span class="live-dot" aria-hidden="true"></span>Live service</a>
        <details class="mobile-menu">
          <summary aria-label="Open navigation">Menu</summary>
          <div>
            <a href="#services">Services</a><a href="#continuity-demo">Demo</a><a href="#how-it-works">How it works</a><a href="#safety">Safety</a><a href="#developers">API</a><a href="/health">Service status</a>
          </div>
        </details>
      </nav>
    </header>

    <main id="main">
      <section class="hero shell" id="top">
        <div class="hero-copy">
          <p class="eyebrow"><span></span>Lifestyle continuity, on demand</p>
          <h1>When life shifts,<br><em>keep moving.</em></h1>
          <p class="hero-lede">KeepFlow brings calm, clarity, and the next right step to everyday routines and disruptive moments—then packages the work into actions, messages, reminders, and documents you can actually use.</p>
          <div class="hero-actions">
            <a class="button button-primary" href="#services">Explore KeepFlow <span aria-hidden="true">↗</span></a>
            <a class="button button-secondary" href="#developers">View the API</a>
          </div>
          <div class="hero-notes" aria-label="Service highlights">
            <span><i aria-hidden="true">✓</i> Stateless by design</span><span><i aria-hidden="true">✓</i> Schema-validated</span><span><i aria-hidden="true">✓</i> 0.05 USDT per call</span>
          </div>
        </div>

        <div class="hero-visual" aria-label="KeepFlow brand visual">
          <div class="visual-orbit orbit-one" aria-hidden="true"></div><div class="visual-orbit orbit-two" aria-hidden="true"></div>
          <div class="logo-card">
            <span class="logo-card-label">CONTINUITY / 01</span>
            <img src="/assets/keepflow-logo.jpeg" alt="KeepFlow arrow logo">
            <p>Your next safe step—clear, ordered, and ready to use.</p>
          </div>
          <div class="floating-card floating-top"><span class="mini-icon">→</span><span><small>NEXT MOVE</small><strong>Clear direction</strong></span></div>
          <div class="floating-card floating-bottom"><span class="signal-bars" aria-hidden="true"><i></i><i></i><i></i></span><span><small>SERVICE</small><strong>Online now</strong></span></div>
        </div>
      </section>

      <section class="proof-strip" aria-label="KeepFlow at a glance">
        <div class="shell proof-grid"><div><strong>4</strong><span>core life services</span></div><div><strong>8</strong><span>paid capabilities</span></div><div><strong>24/7</strong><span>agent-ready endpoint</span></div><div><strong>X Layer</strong><span>x402 payments</span></div></div>
      </section>

      <section class="section shell continuity-feature" id="continuity-demo">
        <div class="section-heading">
          <div><p class="eyebrow"><span></span>Flagship continuity pack</p><h2>One hard moment.<br>One usable pack.</h2></div>
          <p>KeepFlow checks what the person can actually access, removes impossible assumptions, and returns the work in formats they can follow, share, and schedule.</p>
        </div>
        <div class="demo-shell">
          <div class="demo-story">
            <p class="demo-label">PRODUCT WALKTHROUGH / SAMPLE</p>
            <h3>A solo traveller's phone and wallet are stolen.</h3>
            <p>Choose the missing resource to see how the same continuity workflow changes. This preview is illustrative; the paid endpoint validates the caller's complete access profile.</p>
            <input type="radio" name="access-demo" id="demo-phone" checked>
            <input type="radio" name="access-demo" id="demo-internet">
            <input type="radio" name="access-demo" id="demo-identity">
            <div class="demo-tabs" role="group" aria-label="Choose unavailable access">
              <label for="demo-phone">No phone</label>
              <label for="demo-internet">No internet</label>
              <label for="demo-identity">No cash or ID</label>
            </div>
            <div class="demo-results" aria-live="polite">
              <article class="demo-result result-phone"><span>ACCESS-AWARE ALTERNATIVE</span><strong>Use verified in-person bank and carrier support, or ask a trusted person to place calls.</strong><p>Never assumes the stolen phone is available. Never asks the helper for passwords, PINs, OTPs, recovery codes, seed phrases, or private keys.</p></article>
              <article class="demo-result result-internet"><span>ACCESS-AWARE ALTERNATIVE</span><strong>Move provider recovery to a verified branch, carrier store, accommodation desk, or authority.</strong><p>Avoids public computers for sensitive recovery and turns every provider interaction into a reference-number checkpoint.</p></article>
              <article class="demo-result result-identity"><span>ACCESS-AWARE ALTERNATIVE</span><strong>Use safe copies, booking references, a police report, or the issuer's accepted alternative proof.</strong><p>Explains that acceptance varies and routes the traveller to the relevant bank, carrier, embassy, consulate, or authority.</p></article>
            </div>
          </div>
          <div class="demo-output" aria-label="Continuity Pack output preview">
            <div class="demo-output-head"><span>KEEPFLOW / CONTINUITY PACK</span><em>0.05 USDT</em></div>
            <div class="demo-window"><small>NEXT 15 MINUTES</small><p>Reach staffed safety. Freeze payment access. Suspend the missing line.</p></div>
            <div class="demo-window"><small>TODAY</small><p>Secure recovery channels, preserve references, file the appropriate report, notify affected people.</p></div>
            <div class="demo-window"><small>NEXT 7 DAYS</small><p>Replace documents and access methods in dependency order. Review activity and close temporary workarounds.</p></div>
            <div class="artifact-row"><span>PDF</span><span>DOCX</span><span>ICS</span><span>MESSAGES</span><span>DELEGATION</span></div>
          </div>
        </div>
      </section>

      <section class="section shell" id="services">
        <div class="section-heading">
          <div><p class="eyebrow"><span></span>One companion, four dimensions</p><h2>Built around the way<br>life actually happens.</h2></div>
          <p>From the rhythm of an ordinary day to the first hour of a crisis, KeepFlow turns uncertainty into an ordered plan.</p>
        </div>

        <div class="service-grid">
          <article class="service-card daily-card">
            <div class="service-top"><span class="service-number">01</span><span class="service-glyph">D</span></div>
            <div><p class="service-kicker">DAILY FLOW</p><h3>Make the everyday feel manageable.</h3><p>Constraint-aware meal, movement, and routine checklists shaped around the time, foods, and options you actually have.</p><div class="chips"><span>Meals</span><span>Movement</span><span>Routines</span></div></div>
          </article>

          <article class="service-card first-card">
            <div class="service-top"><span class="service-number">02</span><span class="service-glyph">F</span></div>
            <div><p class="service-kicker">FIRST MOVE</p><h3>Know what to do when things go wrong.</h3><p>Ordered, safety-first recovery after a stolen phone, account takeover, lost authenticator, or exposed wallet secret.</p><div class="chips"><span>Prioritized</span><span>Conditional</span><span>Safety-first</span></div></div>
          </article>

          <article class="service-card study-card">
            <div class="service-top"><span class="service-number">03</span><span class="service-glyph">S</span></div>
            <div class="study-copy">
              <p class="service-kicker">KEEPFLOW STUDY</p><h3>Turn academic pressure into a plan you can finish.</h3><p>Prioritized study sessions, grounded explanations from uploaded materials, practice support, and credible research-source discovery.</p>
              <div class="study-features"><span><i>01</i>Execution planning</span><span><i>02</i>Material explanation</span><span><i>03</i>Research discovery</span></div>
            </div>
          </article>

          <article class="service-card work-card">
            <div class="service-top"><span class="service-number">04</span><span class="service-glyph">W</span></div>
            <div><p class="service-kicker">KEEPFLOW WORK</p><h3>Hand work over without losing the thread.</h3><p>Operational handovers that preserve ownership, priorities, blockers, dependencies, risks, decisions, and next actions.</p><div class="chips"><span>Ownership</span><span>Risks</span><span>Next actions</span></div></div>
          </article>
        </div>

        <aside class="companion-band">
          <div class="companion-icon" aria-hidden="true"><span>⌁</span></div>
          <div><p class="service-kicker">COMPANION CAPABILITY</p><h3>Plans that can follow you into your calendar.</h3><p>Reminder Pack converts future actions from any KeepFlow service into importable calendar events with alerts—without storing a reminder history.</p></div>
          <a href="#developers">Calendar Reminder Pack <span aria-hidden="true">→</span></a>
        </aside>
        <aside class="companion-band flagship-band">
          <div class="companion-icon" aria-hidden="true"><span>K</span></div>
          <div><p class="service-kicker">FLAGSHIP ORCHESTRATION</p><h3>Continuity Pack handles the workflow, not just the explanation.</h3><p>One access-aware request returns immediate actions, message scripts, delegation cards, importable reminders, and printable PDF/DOCX briefs.</p></div>
          <a href="#continuity-demo">See the scenario <span aria-hidden="true">→</span></a>
        </aside>
        <aside class="companion-band">
          <div class="companion-icon" aria-hidden="true"><span>↗</span></div>
          <div><p class="service-kicker">CONTEXT &amp; ROUTING</p><h3>Know where to go, not only what to do.</h3><p>With explicit location permission, KeepFlow can rank nearby real-world places and provider routes while clearly labeling live facts, timestamps, and anything it could not verify.</p></div>
          <a href="#developers">Real-world discovery <span aria-hidden="true">→</span></a>
        </aside>
      </section>

      <section class="section process-section" id="how-it-works">
        <div class="shell">
          <div class="section-heading compact"><div><p class="eyebrow"><span></span>How it works</p><h2>Less conversation.<br>More forward motion.</h2></div><p>KeepFlow is designed to return usable structure—not a wall of generic advice.</p></div>
          <div class="process-grid">
            <article><span>01</span><div><h3>Share the situation</h3><p>Provide the goal, constraints, tasks, or incident context the selected service needs.</p></div></article>
            <article><span>02</span><div><h3>KeepFlow checks reality</h3><p>Unavailable devices, internet, money, ID, transport, or trusted contacts trigger safer alternatives before the pack is returned.</p></div></article>
            <article><span>03</span><div><h3>Use the finished workflow</h3><p>Act from the timeline, send the bounded scripts, delegate safe tasks, import the reminders, and print or edit the brief.</p></div></article>
          </div>
        </div>
      </section>

      <section class="section shell safety-section" id="safety">
        <div class="safety-panel">
          <div class="safety-copy"><p class="eyebrow"><span></span>Built for trust</p><h2>Helpful enough to guide.<br>Disciplined enough not to guess.</h2><p>KeepFlow is explicit about unknowns, screens sensitive input, and returns bounded plans instead of pretending certainty.</p><a class="text-link" href="https://github.com/Stella112/Keepflow">Review the open source project <span aria-hidden="true">↗</span></a></div>
          <div class="safety-list">
            <div><span>01</span><p><strong>Stateless by design</strong>No personal profiles or reminder histories are retained by the service.</p></div>
            <div><span>02</span><p><strong>Credentials stay out</strong>Secret-shaped input is rejected or redacted before plan generation.</p></div>
            <div><span>03</span><p><strong>Unknown means unknown</strong>Missing facts remain explicit instead of being silently invented.</p></div>
            <div><span>04</span><p><strong>Structured and checked</strong>Outputs are schema-validated before they are returned to the caller.</p></div>
          </div>
        </div>
      </section>

      <section class="section shell developer-section" id="developers">
        <div class="developer-copy"><p class="eyebrow"><span></span>Built for people. Callable by agents.</p><h2>Eight focused endpoints.<br>One consistent standard.</h2><p>Every paid capability is available as a public HTTPS API protected by OKX x402 payments on X Layer. Agents can inspect the complete request contracts before paying.</p><div class="developer-actions"><a class="button button-primary" href="/openapi.json">OpenAPI contracts</a><a class="button button-secondary" href="/service.json">Service JSON</a><a class="button button-secondary" href="https://github.com/Stella112/Keepflow">View source</a></div></div>
        <div class="endpoint-panel" aria-label="KeepFlow API endpoints">
          <div class="endpoint-head"><span>ENDPOINT</span><span>PER CALL</span></div><div class="endpoint-featured"><code>POST /v1/continuity-pack</code><span>0.05 USDT</span></div><div><code>POST /v1/daily-flow</code><span>0.05 USDT</span></div><div><code>POST /v1/first-move</code><span>0.05 USDT</span></div><div><code>POST /v1/study-flow</code><span>0.05 USDT</span></div><div><code>POST /v1/study-assist</code><span>0.05 USDT</span></div><div><code>POST /v1/work-handover</code><span>0.05 USDT</span></div><div><code>POST /v1/reminder-pack</code><span>0.05 USDT</span></div><div><code>POST /v1/presentation-pack</code><span>0.05 USDT</span></div>
        </div>
      </section>

      <section class="shell closing-section">
        <div class="closing-card"><img src="/assets/keepflow-logo.jpeg" alt="KeepFlow logo"><div><p class="eyebrow"><span></span>Keep your life in motion</p><h2>The next right step<br>starts here.</h2></div><a class="button button-light" href="#services">Find your flow <span aria-hidden="true">→</span></a></div>
      </section>
    </main>

    <footer>
      <div class="shell footer-grid"><a class="brand" href="#top"><span class="brand-mark"><img src="/assets/keepflow-logo.jpeg" alt=""></span><span>Keep<span>Flow</span></span></a><p>A lifestyle-continuity companion for everyday routines and disruptive moments.</p><div><a href="/ready">Readiness</a><a href="/openapi.json">OpenAPI</a><a href="/service.json">Service JSON</a><a href="https://github.com/Stella112/Keepflow">GitHub</a></div></div>
      <div class="shell footer-bottom"><span>© 2026 KeepFlow</span><span>Structured plans · Explicit unknowns · No credentials</span></div>
    </footer>
  </body>
</html>`;
