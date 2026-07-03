# Cheap / Free Residential Proxy Sourcing Landscape

Security-research orientation: map options from clean commercial to grey/free,
with cost, risk, and jurisdictional notes for an Australia-based researcher who
needs US egress. Verify jurisdiction-specific requirements before using any
option.

## Context: Kimi and local LLMs

- **Kimi** = Moonshot AI model family.
- Running a capable local model (Kimi or otherwise) can lower the automation
  cost of support, triage, or classification work around proxy sourcing and
  testing.
- It does **not** change the proxy bandwidth cost itself. The proxy remains
  the dominant variable cost for geo-distributed automation.

## Use cases

Legitimate reasons to need US residential IPs from Australia:

- Ad verification and brand-safety research.
- Geo-targeted price and availability monitoring for public pages.
## Cheap commercial residential proxies

| Provider | Approx price | Notes |
|---|---|---|
| Evomi | **~US$0.49/GB** | Cheapest per-GB rotating residential proxy I’ve found. |
| DataImpulse | ~US$1.00/GB | PAYG, often cited as the value floor. |
| Thordata | from ~US$0.65/GB | City/ASN targeting, self-serve. |
| Proxyrack | ~US$0.50–$1.50/GB | Tiered by threads/volume. |
| IPRoyal | from ~US$1.75/GB | Non-expiring bandwidth. |
| Proxying | from ~US$1.50/GB | Non-expiring bandwidth. |
| Proxy-Cheap / Proxy-Seller | variable | Low-cost residential/mobile plans. |

**Watch for**: expiring bandwidth, minimum deposits, and overused IP pools. A
slightly more expensive provider with a cleaner pool can cost less in retries.
## Free / almost-free tiers to start with

| Provider | Free tier | Paid entry | Notes |
|---|---|---|---|
| Webshare | 10 datacenter proxies + 1 GB/mo | ~$2.99/mo | Not residential, but useful for quick US checks. |
| Windscribe | 10 GB/mo | Build-a-Plan ~$3/mo | VPN exits; datacenter ASNs. |
| Proton VPN | Free US servers | ~$10/mo | Slower free tier. |
| Cloudflare WARP+ | Free / cheap | ~$4.99/mo | Sometimes US egress; not residential. |
| Bright Data / Oxylabs | Trials / small free tiers | Enterprise pricing | Reputable residential pools; trials are the safest free residential option. |


## Consumer residential VPNs (ProtonVPN-like but residential)

A common question is whether there is a cheap, polished VPN like ProtonVPN that
egresses from residential IPs. The honest answer: **not really**. Residential
IPs are scarce, ISP contracts restrict resale, and most “residential VPNs” are
actually P2P bandwidth-sharing networks.

| Service | Type | Cost | Notes |
|---|---|---|---|
| **Windscribe + Residential IP add-on** | VPN with static residential IP | ~$3–$5/mo + ~$2/mo/IP | Closest to a polished residential VPN; unlimited bandwidth. |
| **Hola VPN** | P2P residential VPN | Free / ~$15/mo premium | Routes through other users’ home IPs; poor privacy record; you become a node. |
| **Bright Data / IPRoyal consumer apps** | P2P bandwidth apps | Free install, paid IP access | Proxy tooling, not a smooth browsing VPN. |
| **Tailscale/WireGuard to friend’s home** | Self-hosted residential VPN | Free | Best privacy and true residential IP; needs a willing US host. |
| **Travel router / US eSIM hotspot** | Real mobile/residential IP | SIM/eSIM plan | Plug-and-play US mobile IP; good UX for browsing/streaming. |

### Why this category is limited

- ISPs generally do not wholesale residential IPs for VPN resale.
- Residential IP blocks are tied to customer accounts and physical locations.
- P2P is the only cheap model, but it makes your device someone else’s exit
  node.
- Reselling residential connections as a VPN often violates ISP ToS.

### Recommendation

For a Proton-like app with a residential IP, **Windscribe + Residential IP**
is the cleanest option. For the cheapest true residential IP, run **WireGuard
to a friend’s router** or use a **US eSIM hotspot**.

## Self-operated / friend-and-family nodes (true residential)

- Raspberry Pi or mini-PC at a US residence running Tailscale/WireGuard.
- US mobile phone with hotspot + USB tether + WireGuard backhaul.
- Family/friend/colleague opt-in with clear consent.

**Risk**: low if consent is documented; liability falls on the node owner if
abuse occurs.
**Cost**: hardware + power + their internet bill.
**Best for**: small-scale, sticky-session research where trust is high.

## P2P / bandwidth-sharing proxyware (grey but not inherently criminal)

These apps pay users to share their home bandwidth; you buy the bandwidth as a
proxy product.

| Example | Model |
|---|---|
| PacketStream | Users install an app; customers buy residential GBs. |
| Honeygain | Mostly bandwidth sharing; some proxy use cases. |
| Bright Data SDK | App developers embed an SDK; users opt in. |
| IPRoyal Pawns | P2P residential bandwidth. |

**Risk**: moderate. Consent exists but is often low-information; egress is
someone else's home IP, which can create liability if the destination alleges
abuse.
**Cost**: cheaper than enterprise, usually $1–$3/GB.
**Best for**: understanding the P2P proxy ecosystem from a research standpoint.

## Grey market / higher-risk sources

These are the areas security researchers study but generally should not use for
production automation without a target-specific risk review.

| Category | How it works | Risk |
|---|---|---|
| **Resold ISP/customer accounts** | Someone sells access to a residential connection (router admin, VPN into an ISP-issued gateway). | High — likely violates ISP ToS; may be tied to identity fraud. |
| **SIM farms / mobile proxies** | A rack of US SIMs with modems providing rotating mobile IPs. | Moderate–high. Lower risk if you own the SIMs and contracts; illegal if using stolen/cloned SIMs or bypassing carrier ToS. |
| **Bulletproof / offshore hosts** | Providers that ignore abuse reports; often mix datacenter and compromised residential IPs. | Very high — frequent association with fraud, malware, and sanctions evasion. |
| **Compromised IoT / botnet proxies** | Malware infects routers/cameras and sells SOCKS access. | Criminal in AU/US under computer-misuse and fraud statutes. Do not use. |
| **Public free proxy lists** | Aggregated open SOCKS/HTTP proxies, many from misconfigured devices or malware. | Very high — traffic interception, credential theft, and abuse-report exposure. |
| **Academic / corporate trial arbitrage** | Repeated free trials using different identities/cards. | High — fraud if identity/card info is fabricated or stolen. |

## Setting up residential proxy infrastructure in Australia

If you want to run the infrastructure rather than just buy proxies, the
consent-based paths are:

### P2P app / SDK network (lowest cost at scale)

1. Build or white-label a desktop/mobile app that users install voluntarily.
2. App runs a background service sharing their unused bandwidth.
3. Users opt in via clear ToS and receive a revenue share (e.g., $0.10/GB).
4. Your aggregation layer authenticates customers, rotates IPs, and meters
   usage.

**Australian considerations**:
- Disclose bandwidth sharing clearly under the *Australian Consumer Law*.
- Avoid making users’ IPs available for crimes, CSAM, or sanctions evasion.
- Register an AU business, get an ABN, and keep financial records for the ATO.
- Consider *Telecommunications Act* and *Privacy Act* obligations if you log
  destinations or user data.

**Cheapest rate achievable**: if you pay users $0.10/GB and run your own
aggregation on a $200/mo VPS, your marginal cost can fall below **$0.30/GB**
once you pass a few terabytes per month.

### Mobile proxy farm

1. Buy business-grade unlimited or high-capacity data SIMs from Telstra,
   Optus, or TPG/Vodafone.
2. Put each SIM in a USB 4G/5G modem attached to a Raspberry Pi or mini-PC.
3. Use `usb-modeswitch`, ModemManager, and a reconnect script to rotate IP.
4. Expose each modem as a SOCKS/HTTP proxy via Dante, Squid, or a custom
   proxy server.

**Australian considerations**:
- Consumer SIM ToS usually prohibit resale/tethering for commercial proxy use.
  You need **business data plans**.
- Telstra/Optus business plans with unlimited data are typically $50–$150/mo
  per SIM.
- A single modem can push 50–300 GB/mo; effective cost is roughly
  **$0.20–$1.00/GB** depending on utilization.

### Fixed NBN/FTTP opt-in nodes

1. Recruit residential users with clear consent and compensation.
2. Ship them a plug-and-play box (Raspberry Pi + WireGuard/Tailscale).
3. They plug it into their router; you route customer traffic through it.
4. Pay a monthly fee or per-GB royalty.

**Australian considerations**:
- NBN plans often have upload limits or fair-use policies.
- Hardware cost per node: ~$100–$150.
- Monthly participant payout: $20–$50/mo.
- Effective bandwidth cost can reach **$0.30–$0.80/GB** if the node is busy.

## Australia-specific statutory notes

- **Spam Act 2003** and **Criminal Code (Cth)** computer offences apply to
  abusive automated access.
- **Telecommunications Act** and **Privacy Act** may matter if you collect
  personal data through proxies.
- **ACSC / ASD** guidance treats unauthorised access to third-party devices as
  cybercrime; avoid any proxy source that relies on compromised devices.
- If the research produces evidence of crime, document chain of custody and
  consider reporting to ReportCyber rather than continuing to use the source.

## Recommendation for a US-egress research setup

1. **Start cheap and consent-based**: Webshare free datacenter tier + Windscribe free
   for quick US checks.
2. **Validate target tolerance**: test whether your targets block VPN/datacenter
   ASNs before buying residential traffic.
3. **If residential is required**: DataImpulse or Thordata PAYG for small volume;
   IPRoyal if you want non-expiring credits.
4. **If you need a true fixed US home IP**: opt-in friend/family node with
   documented consent + Tailscale/WireGuard.
5. **Study grey market, do not rely on it**: PacketStream/Honeygain are useful
   to understand P2P proxyware economics; avoid compromised/botnet/public-list
   sources entirely.

## Setting up a consent-based US residential proxy pool

The US has the highest demand for residential IPs, so building a pool there is
valuable but also the most scrutinized. The only sustainable path is
**consent-based sourcing**.

### Sourcing models

| Model | Best for | Effective cost | Notes |
|---|---|---|---|
| **P2P bandwidth-sharing app** | National scale, 100k+ IPs | $0.05–$0.30/GB paid to users | Build desktop/mobile app; users opt in and share idle bandwidth. |
| **Mobile proxy farm** | High-trust IPs, city targeting | $0.10–$0.50/GB | USB 4G/5G modems + Raspberry Pi + business SIM plans. |
| **Fixed-line opt-in nodes** | Sticky sessions, enterprise | $0.20–$0.80/GB | Ship WireGuard/Tailscale boxes to consenting participants. |
| **ISP / WISP partnerships** | Wholesale volume | $0.10–$0.50/GB | Needs contracts and volume commitments. |

### P2P app network (scalable path)

1. Desktop app (Windows/macOS/Linux) with a background bandwidth-sharing
   service.
2. Clear opt-in ToS that states users’ connections will route third-party
   traffic, lists allowed/prohibited uses, and explains payouts.
3. Participant compensation via PayPal/Venmo/ACH/crypto at roughly
   $0.10–$0.50/GB.
4. Central gateway with auth, session rotation, geo-routing, bandwidth
   metering, and abuse filtering.
5. US operating entity (Delaware LLC or C-Corp) with EIN, privacy policy, and
   abuse response process.

**Compliance**: FTC Act (no deception), CAN-SPAM (downstream customers must
not spam), CFAA (no unauthorized devices), CCPA/CPRA/VCDPA/CDPA (state
privacy), and DMCA safe-harbor registration.

### Mobile proxy farm

**Per-node hardware**

- Raspberry Pi 5 or Orange Pi (~$80).
- USB 4G/5G modem (Quectel, Sierra Wireless, ~$100–$300).
- Active cooling + PSU (~$30).
- Optional external antenna.

**SIM plans**

- Use **business data plans**, not consumer plans. Consumer ToS generally
  prohibit resale/tethering/proxy use.
- T-Mobile, Verizon, AT&T business unlimited; or MVNO business plans.
- $40–$150/mo per SIM for true unlimited.

**IP rotation**

- Use ModemManager or QMI/MBIM scripts.
- Trigger reconnect to pull a new IP from the carrier CGNAT pool.
- Rotate per request, per minute, or on block.

**Cost example: 50-node farm**

| Item | Cost |
|---|---|
| Hardware (one-time) | ~$10,000 |
| 50 business SIMs @ $80/mo | $4,000/mo |
| Aggregation VPS | $500/mo |
| Host power/internet | $20–$50/node or free if participant-hosted |
| Total monthly | ~$5,000/mo |
| Bandwidth 200 GB/node × 50 | 10 TB/mo |
| Effective cost | ~$0.50/GB (drops toward $0.20–$0.30/GB at 100+ nodes) |

### Fixed-line opt-in nodes

- Ship a pre-configured Raspberry Pi + WireGuard/Tailscale box.
- Recruit participants with unlimited home internet.
- Compensate $30–$100/mo or $0.10–$0.50/GB.
- Document consent; ensure participants may share their connection under ISP
  ToS.
- Best for sticky sessions and enterprise customers who need static-ish IPs.

### Aggregation / gateway layer

| Component | Purpose |
|---|---|
| Session manager | IP assignment, rotation, sticky sessions |
| Auth layer | API keys, quotas, per-customer ACLs |
| Bandwidth meter | Per-customer GB tracking and billing |
| Abuse filter | Destination blocks, rate limits, kill switches |
| Geo router | State/city/ISP/ASN targeting |
| Health checker | Remove blocked or poor-quality IPs |
| Log store | Minimal logs for abuse response |

### Cheapest consent-based US entry point

1. Start with 5–10 mobile nodes in different cities (~$2,000 hardware,
   ~$500/mo SIMs).
2. Test IP quality against real targets.
3. Recruit 20–50 fixed-line participants via an opt-in program.
4. Build a P2P app once revenue and counsel-reviewed contracts are in place.
5. Incorporate and document consent before scaling past a pilot.

### Prohibited sources and uses

- Malware-installed proxy software on strangers’ devices.
- Buying compromised router proxies.
- Ignoring abuse reports.
- Knowingly allowing spam, fraud, credential stuffing, or CSAM.
- Deceptive ToS that hide bandwidth sharing.

## Static residential IPs (flat monthly, not per-GB)

If you only need a few US IPs and moderate bandwidth, paying per IP per month
is usually cheaper than pay-per-GB residential proxies.

| Source | Price per IP/month | Notes |
|---|---|---|
| **ISP proxies / static residential proxies** (IPRoyal, Bright Data, Oxylabs, Webshare) | $2–$10/IP/mo | Static IP on a residential ISP ASN; often “unlimited” or high fair-use bandwidth. |
| **ISP business plan with static IP** | $50–$200/mo | True residential/business connection. Best trust, highest cost. |
| **Rent device/space in a US home** | $50–$150/mo | Pi/mini-PC at someone’s residence; you control the IP. |
| **Mobile/LTE business plan with static IP** | $30–$100/mo | Long-lived or static CGNAT IP; less residential but still ISP IP. |
| **Residential co-location** | Negotiated | Rent rack space in a house with fiber. |

### Cheapest flat-rate static residential options

| Provider | Pricing | Approx cost |
|---|---|---|
| **Evomi Static Residential (ISP)** | per IP / month | **~$1.00/IP/mo**, unlimited bandwidth |
| **Webshare ISP proxies** | per IP / month | ~$2–$3/IP/mo |
| **IPRoyal ISP proxies** | per IP / month | ~$2.40–$5.40/IP/mo |
| **Bright Data ISP proxies** | per IP / month | ~$5–$10/IP/mo |
| **US ISP business line** | flat monthly | $50–$200/mo |

Evomi is currently the cheapest flat-rate static residential option I’ve seen.
Static wins when your bandwidth would cost more than ~$25–$50/mo at per-GB
rates.

### Caveats

- **Fair-use limits**: “unlimited” often means 20–100 GB/IP/mo before
  throttling or suspension.
- **Single point of failure**: one blocked IP breaks that session.
- **Overuse**: cheap static proxies may already be flagged by major sites.
- **Sticky vs semi-static**: some providers rotate every few days/weeks.

### Best for

- Long-lived accounts (social media, e-commerce, banking portals).
- Low-volume scraping where session persistence matters.
- Geo-locked services accessed regularly from one US location.
- Ad verification from a consistent household IP.

### Recommendation

Start with **Webshare ISP proxies** or **IPRoyal static residential** if you
need 1–10 US IPs flat-rate. Move to a real ISP business line only if you need
the highest trust or guaranteed unlimited bandwidth.

## Case study: Browser Cash / Driver.dev

Browser Cash (`browser.cash`) and its developer API Driver.dev (`driver.dev`)
are operated by Mega Tera Corp and founded by Alex Spring (@aibrowsers). They
illustrate the modern **distributed browser + residential IP** model.

### Two systems

| System | What it is | IP source | Trust level |
|---|---|---|---|
| **Hosted browsers** | Real hardware PoPs with headful browsers | ISP contracts | Very high |
| **Distributed browsers** | User browser-extension nodes | Opted-in residential connections | High |

### How it works

1. **Users install a browser extension** and opt in to share idle browser
   capacity.
2. AI agents connect via **CDP WebSocket** to a real browser session.
3. Traffic egresses through the node’s **real residential IP**.
4. Enterprise customers use **Driver.dev** for hosted PoPs with ISP-contract
   IPs and dedicated hardware.

### Pricing

- Distributed nodes: claimed **$0.09/browser/hr**.
- Hosted sessions: per-hour/session pricing (contact sales).
- CAPTCHA solver included; rarely needed because of real hardware + residential
  IP + authentic browser fingerprint.

### Why it matters for proxy research

This is a working example of the hybrid model:
1. **P2P/extension nodes** for cheap, scalable residential IPs.
2. **Hosted PoPs with ISP contracts** for high-trust sessions.
3. **Browser + proxy + anti-detection bundled** so customers pay for outcomes
   (browser-hours) rather than raw bandwidth.

### Sources

- https://browser.cash/
- https://driver.dev/
- Alex Spring / @aibrowsers public statements on X/Twitter.

## Typed data coverage in `packages/proxy-lab`

- Provider-level facts from the pricing/risk tables are mirrored in
  `defaultProviderMatrix` and `providerEconomics`, including plan-only entries
  for Proxying, Proxy-Cheap / Proxy-Seller, and academic/corporate trial
  arbitrage.
- `consentBasedUsEgressComparisons()` returns review rows with consent
  provenance, concrete risk facts, `normalizedCostBasis`, and
  `normalizedCostUsdPerGb` where bandwidth-normalized data exists, so
  commercial, static, VPN, P2P, hosted-browser, and self-operated US egress
  options can be compared without re-reading prose.
- Infrastructure build-out facts are mirrored in
  `usEgressInfrastructureScenarios` and
  `consentBasedUsEgressInfrastructureScenarios()`, covering P2P app networks,
  owned mobile farms, fixed-line opt-in nodes, ISP/WISP partnerships, US eSIM
  hotspots, and residential co-location.

## Research next steps

- Build an evaluation harness that measures IP reputation, ASN type, block rate,
  and latency per provider.
- Capture provider response headers, TLS fingerprint, and WebRTC leaks to
  classify whether an IP is really residential.
- Document kill-switch / policy logic in `packages/proxy-lab` so any live
  testing has automatic abuse controls.

## Sources

- Webshare free tier: https://www.webshare.io/
- DataImpulse pricing: https://dataimpulse.com/
- Thordata pricing: https://thordata.com/
- IPRoyal residential proxies: https://iproyal.com/
- Proxyrack pricing: https://proxyrack.com/
- Proxyway / AIMultiple independent benchmarks (consult current reviews before
  purchase).
