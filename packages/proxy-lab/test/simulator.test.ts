import { describe, expect, test } from "bun:test"
import {
  ProxySimulator,
  type SyntheticRequestJob,
  type CustomerPolicy,
} from "../src"

describe("ProxySimulator", () => {
  const customerId = "cust-1"
  const participantId = "part-1"
  const deviceId = "dev-1"

  const validPolicy: CustomerPolicy = {
    customerId,
    approvedUseCases: ["search-quality-research", "ad-verification"],
    deniedDestinations: ["forbidden.com", "malicious-site.net"],
  }

  const baseJob: SyntheticRequestJob = {
    id: "job-1",
    customerId,
    deviceId,
    destinationHost: "example.com",
    useCase: "search-quality-research",
    syntheticBytesUp: 1024,
    syntheticBytesDown: 4096,
  }

  test("consent required when no consent is registered", () => {
    const simulator = new ProxySimulator()
    simulator.setCustomerPolicy(validPolicy)

    const result = simulator.executeJob(baseJob)
    expect(result.allowed).toBe(false)
    expect(result.decision.code).toBe("consent-required")
    expect(result.decision.reason).toContain("not opted-in")
    expect(result.ledgerEntry).toBeNull()
  })

  test("successful simulation when consent is granted", () => {
    const simulator = new ProxySimulator()
    simulator.setCustomerPolicy(validPolicy)

    const consent = simulator.grantConsent(participantId, deviceId, "192.168.1.10")
    expect(consent.participantId).toBe(participantId)
    expect(consent.deviceId).toBe(deviceId)
    expect(consent.status).toBe("consented")
    expect(simulator.hasConsent(deviceId)).toBe(true)

    const result = simulator.executeJob(baseJob)
    expect(result.allowed).toBe(true)
    expect(result.decision.code).toBe("allowed")
    expect(result.ledgerEntry).not.toBeNull()
    expect(result.ledgerEntry?.billable).toBe(true)
    expect(result.ledgerEntry?.syntheticBytesUp).toBe(1024)
    expect(result.ledgerEntry?.syntheticBytesDown).toBe(4096)
  })

  test("revocation blocks subsequent requests", () => {
    const simulator = new ProxySimulator()
    simulator.setCustomerPolicy(validPolicy)

    simulator.grantConsent(participantId, deviceId, "192.168.1.10")
    expect(simulator.hasConsent(deviceId)).toBe(true)

    const result1 = simulator.executeJob(baseJob)
    expect(result1.allowed).toBe(true)

    const revoked = simulator.revokeConsent(participantId, deviceId)
    expect(revoked.status).toBe("revoked")
    expect(simulator.hasConsent(deviceId)).toBe(false)

    const result2 = simulator.executeJob({ ...baseJob, id: "job-2" })
    expect(result2.allowed).toBe(false)
    expect(result2.decision.code).toBe("consent-revoked")
    expect(result2.decision.reason).toContain("opted-out")
    expect(result2.ledgerEntry).toBeNull()
  })

  test("prohibited use cases are blocked and not billed", () => {
    const simulator = new ProxySimulator()
    // Even if approved by customer policy, prohibited list overrides
    const lenientPolicy: CustomerPolicy = {
      customerId,
      approvedUseCases: ["credential-stuffing", "search-quality-research"],
      deniedDestinations: [],
    }
    simulator.setCustomerPolicy(lenientPolicy)
    simulator.grantConsent(participantId, deviceId, "192.168.1.10")

    const prohibitedJob: SyntheticRequestJob = {
      ...baseJob,
      useCase: "credential-stuffing",
    }

    const result = simulator.executeJob(prohibitedJob)
    expect(result.allowed).toBe(false)
    expect(result.decision.code).toBe("prohibited-use-case")
    expect(result.ledgerEntry).not.toBeNull()
    expect(result.ledgerEntry?.billable).toBe(false)
    expect(result.ledgerEntry?.syntheticBytesUp).toBe(0)
    expect(result.ledgerEntry?.syntheticBytesDown).toBe(0)
  })

  test("destination deny is blocked and not billed", () => {
    const simulator = new ProxySimulator()
    simulator.setCustomerPolicy(validPolicy)
    simulator.grantConsent(participantId, deviceId, "192.168.1.10")

    const deniedJob: SyntheticRequestJob = {
      ...baseJob,
      destinationHost: "forbidden.com",
    }

    const result = simulator.executeJob(deniedJob)
    expect(result.allowed).toBe(false)
    expect(result.decision.code).toBe("destination-denied")
    expect(result.ledgerEntry).not.toBeNull()
    expect(result.ledgerEntry?.billable).toBe(false)
    expect(result.ledgerEntry?.syntheticBytesUp).toBe(0)
    expect(result.ledgerEntry?.syntheticBytesDown).toBe(0)
  })

  test("customer policy missing blocks requests", () => {
    const simulator = new ProxySimulator()
    simulator.grantConsent(participantId, deviceId, "192.168.1.10")

    const result = simulator.executeJob(baseJob)
    expect(result.allowed).toBe(false)
    expect(result.decision.code).toBe("customer-policy-missing")
    expect(result.ledgerEntry?.billable).toBe(false)
  })

  test("use case not approved by customer is blocked", () => {
    const simulator = new ProxySimulator()
    simulator.setCustomerPolicy(validPolicy) // approved: search-quality-research, ad-verification
    simulator.grantConsent(participantId, deviceId, "192.168.1.10")

    const unapprovedJob: SyntheticRequestJob = {
      ...baseJob,
      useCase: "availability-monitoring",
    }

    const result = simulator.executeJob(unapprovedJob)
    expect(result.allowed).toBe(false)
    expect(result.decision.code).toBe("use-case-not-approved")
    expect(result.ledgerEntry?.billable).toBe(false)
  })

  describe("Kill Switches", () => {
    test("global kill switch blocks all requests", () => {
      const simulator = new ProxySimulator({ global: true })
      simulator.setCustomerPolicy(validPolicy)
      simulator.grantConsent(participantId, deviceId, "192.168.1.10")

      const result = simulator.executeJob(baseJob)
      expect(result.allowed).toBe(false)
      expect(result.decision.code).toBe("global-kill-switch")
      expect(result.ledgerEntry?.billable).toBe(false)
    })

    test("customer kill switch blocks matching customer", () => {
      const simulator = new ProxySimulator({ customerIds: [customerId] })
      simulator.setCustomerPolicy(validPolicy)
      simulator.grantConsent(participantId, deviceId, "192.168.1.10")

      const result = simulator.executeJob(baseJob)
      expect(result.allowed).toBe(false)
      expect(result.decision.code).toBe("customer-kill-switch")
    })

    test("device kill switch blocks matching device", () => {
      const simulator = new ProxySimulator({ deviceIds: [deviceId] })
      simulator.setCustomerPolicy(validPolicy)
      simulator.grantConsent(participantId, deviceId, "192.168.1.10")

      const result = simulator.executeJob(baseJob)
      expect(result.allowed).toBe(false)
      expect(result.decision.code).toBe("device-kill-switch")
    })

    test("destination kill switch blocks matching host", () => {
      const simulator = new ProxySimulator({ destinationHosts: ["example.com"] })
      simulator.setCustomerPolicy(validPolicy)
      simulator.grantConsent(participantId, deviceId, "192.168.1.10")

      const result = simulator.executeJob(baseJob)
      expect(result.allowed).toBe(false)
      expect(result.decision.code).toBe("destination-kill-switch")
    })

    test("updating kill switches at runtime", () => {
      const simulator = new ProxySimulator()
      simulator.setCustomerPolicy(validPolicy)
      simulator.grantConsent(participantId, deviceId, "192.168.1.10")

      expect(simulator.executeJob(baseJob).allowed).toBe(true)

      simulator.updateKillSwitches({ global: true })
      expect(simulator.executeJob({ ...baseJob, id: "job-2" }).allowed).toBe(false)

      simulator.updateKillSwitches({ global: false, customerIds: [customerId] })
      expect(simulator.executeJob({ ...baseJob, id: "job-3" }).allowed).toBe(false)
    })
  })

  describe("Bandwidth Accounting & Compensation", () => {
    test("tracks and summarizes accounting and compensation accurately", () => {
      const simulator = new ProxySimulator()
      simulator.setCustomerPolicy(validPolicy)
      simulator.grantConsent(participantId, deviceId, "192.168.1.10")

      // 1 GiB = 1_073_741_824 bytes
      const oneGiB = 1_073_741_824

      // Run 1: Allowed, 0.4 GiB up, 0.6 GiB down = 1.0 GiB total
      simulator.executeJob({
        ...baseJob,
        id: "job-acc-1",
        syntheticBytesUp: 0.4 * oneGiB,
        syntheticBytesDown: 0.6 * oneGiB,
      })

      // Run 2: Blocked, should not count towards compensation
      simulator.executeJob({
        ...baseJob,
        id: "job-acc-2",
        destinationHost: "forbidden.com", // blocked
        syntheticBytesUp: 0.5 * oneGiB,
        syntheticBytesDown: 0.5 * oneGiB,
      })

      // Run 3: Allowed, 1.5 GiB up, 0.5 GiB down = 2.0 GiB total
      simulator.executeJob({
        ...baseJob,
        id: "job-acc-3",
        syntheticBytesUp: 1.5 * oneGiB,
        syntheticBytesDown: 0.5 * oneGiB,
      })

      const accounting = simulator.getParticipantAccounting(participantId, deviceId)

      // Total allowed = 1.0 GiB + 2.0 GiB = 3.0 GiB
      expect(accounting.syntheticBytesUp).toBe(1.9 * oneGiB)
      expect(accounting.syntheticBytesDown).toBe(1.1 * oneGiB)
      expect(accounting.totalSyntheticBytes).toBe(3 * oneGiB)

      // Compensation: default is 125 cents per GiB
      // 3.0 GiB * 125 cents = 375 cents
      expect(accounting.compensationEstimateCents).toBe(375)
    })
  })
})
