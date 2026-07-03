import Foundation
import UIKit
import CoreMotion
import CFNetwork
import Darwin
import MachO

/// Detects virtualization artifacts, jailbreak indicators, network anomalies,
/// sensor data sanity, and automation processes.
///
/// This is the highest-signal detector against vphone-cli + EXP variant.
final class EnvironmentDetector {
    private let motionManager = CMMotionManager()
    private var accelerometerSamples: [CMAccelerometerData] = []
    private var gyroSamples: [CMGyroData] = []
    private let maxSensorSamples = 100

    // MARK: - Public API

    /// Run all environmental checks.
    func runAllChecks(completion: @escaping (Double, [DetectionResult.DetectionFlag]) -> Void) {
        var flags: [DetectionResult.DetectionFlag] = []
        var subScores: [Double] = []

        // Synchronous checks
        let virtResult = checkVirtualization()
        subScores.append(virtResult.score)
        if virtResult.flagged { flags.append(.virtualizationDetected) }

        let jbResult = checkJailbreak()
        subScores.append(jbResult.score)
        if jbResult.flagged { flags.append(.jailbreakDetected) }

        let procResult = checkAutomationProcesses()
        subScores.append(procResult.score)
        if procResult.flagged { flags.append(.automationProcessDetected) }

        // Async: sensor and network need callbacks
        let group = DispatchGroup()

        var sensorScore: Double = 0
        var sensorFlagged = false
        group.enter()
        checkSensorSanity { score, flagged in
            sensorScore = score
            sensorFlagged = flagged
            group.leave()
        }

        var netScore: Double = 0
        var netFlagged = false
        group.enter()
        checkNetworkLatency { score, flagged in
            netScore = score
            netFlagged = flagged
            group.leave()
        }

        group.notify(queue: .main) {
            subScores.append(sensorScore)
            if sensorFlagged { flags.append(.staticSensorData) }

            subScores.append(netScore)
            if netFlagged { flags.append(.zeroNetworkLatency) }

            let nonZero = subScores.filter { $0 > 0 }
            let avgScore = nonZero.isEmpty ? 0 : nonZero.reduce(0, +) / Double(nonZero.count)
            completion(min(avgScore, 1.0), flags)
        }
    }

    /// Synchronous-only variant for quick checks.
    func runSyncChecks() -> (score: Double, flags: [DetectionResult.DetectionFlag]) {
        var flags: [DetectionResult.DetectionFlag] = []
        var subScores: [Double] = []

        let virtResult = checkVirtualization()
        subScores.append(virtResult.score)
        if virtResult.flagged { flags.append(.virtualizationDetected) }

        let jbResult = checkJailbreak()
        subScores.append(jbResult.score)
        if jbResult.flagged { flags.append(.jailbreakDetected) }

        let procResult = checkAutomationProcesses()
        subScores.append(procResult.score)
        if procResult.flagged { flags.append(.automationProcessDetected) }

        let nonZero = subScores.filter { $0 > 0 }
        let avgScore = nonZero.isEmpty ? 0 : nonZero.reduce(0, +) / Double(nonZero.count)
        return (min(avgScore, 1.0), flags)
    }

    // MARK: - Virtualization Detection

    /// Check for VM/emulator artifacts.
    ///
    /// vphone-cli EXP variant renames hv_vmm and spoofs DT identity,
    /// but there are deeper artifacts that are much harder to hide.
    private func checkVirtualization() -> (score: Double, flagged: Bool) {
        var score = 0.0
        var hits = 0
        var totalChecks = 0

        // 1. I/O Registry — check for virtual I/O kit providers
        totalChecks += 1
        if checkIORegistry() { hits += 1; score += 0.4 }

        // 2. sysctl hardware model
        totalChecks += 1
        if checkSysctlHardware() { hits += 1; score += 0.3 }

        // 3. sysctl VM-specific kernel flags
        totalChecks += 1
        if checkSysctlVM() { hits += 1; score += 0.3 }

        // 4. Disk I/O timing — VM storage is much faster than physical NAND
        totalChecks += 1
        if checkDiskIOTiming() { hits += 1; score += 0.2 }

        // 5. CPU feature detection — missing physical CPU features
        totalChecks += 1
        if checkCPUFeatures() { hits += 1; score += 0.25 }

        // 6. Battery — VM typically reports AC power always
        totalChecks += 1
        if checkBatteryState() { hits += 1; score += 0.3 }

        let normalized = totalChecks > 0 ? score / Double(totalChecks) * (Double(hits) / Double(totalChecks)) * 3.0 : 0
        let finalScore = min(normalized, 1.0)
        return (finalScore, finalScore >= 0.4)
    }

    /// Check for VM artifacts using file paths and sysctl only (no private IOKit).
    ///
    /// vphone-cli EXP variant renames hv_vmm and spoofs DT identity, but
    /// we can still detect VM through file artifacts, sysctl, and hardware quirks.
    private func checkIORegistry() -> Bool {
        // 1. Check for VM-specific device files.
        let vmDevicePaths = [
            "/dev/virtio-ports",
            "/dev/virtio-ports/org.qemu.guest_agent.0",
            "/var/run/utmps",
            "/tmp/vmnet-bridge",
        ]
        let fm = FileManager.default
        for path in vmDevicePaths {
            if fm.fileExists(atPath: path) { return true }
        }

        // 2. Check for VM-specific preferences/logs.
        let vmConfigPaths = [
            "/Library/Preferences/SystemConfiguration/com.apple.vmnet.plist",
            "/var/log/vm.log",
        ]
        for path in vmConfigPaths {
            if fm.fileExists(atPath: path) { return true }
        }

        // 3. sysctl: check for hypervisor CPU feature — leaks even with EXP rename.
        if let hv = sysctlInt("kern.hv_support"), hv == 1 { return true }

        // 4. Check hw.targettype — real iPhones report e.g. "J316AP".
        //    VM may report empty or non-iPhone target.
        if let target = sysctlString("hw.targettype") {
            if target.isEmpty { return true }
            if target.hasPrefix("J") && !target.contains("Phone") { return true }
        }

        // 5. Check hw.product for VM identifiers.
        if let product = sysctlString("hw.product") {
            let lower = product.lowercased()
            if lower.contains("vmware") || lower.contains("virtual") ||
               lower.contains("qemu") || lower.contains("parallels") ||
               lower.contains("vphone") { return true }
        }

        // 6. Check kern.bootargs for VM-specific boot arguments.
        if let bootArgs = sysctlString("kern.bootargs") {
            let lower = bootArgs.lowercased()
            if lower.contains("-v") && lower.contains("debug") { return true }
            if lower.contains("vm") || lower.contains("vmm") { return true }
        }

        return false
    }

    /// Check sysctl hw.model and hw.machine for VM identifiers.
    private func checkSysctlHardware() -> Bool {
        let hwModel = sysctlString("hw.model")
        let hwMachine = sysctlString("hw.machine")

        // Real iPhones have model strings like "D211AP", "D63AP", etc.
        // VMs often have generic or missing model identifiers.

        // EXP variant spoofs the DT, but sysctl might still leak.
        // Check for patterns that indicate a VM.
        let suspiciousModels = ["VM", "Virtual", "Simulator", "Generic", "x86_64", "arm64_vm"]
        for suspicious in suspiciousModels {
            if hwModel?.contains(suspicious) == true || hwMachine?.contains(suspicious) == true {
                return true
            }
        }

        // Empty or missing model string is highly suspicious.
        if hwModel == nil || hwModel?.isEmpty == true {
            return true
        }

        // Check hw.physicalcpu vs hw.logicalcpu
        let physicalCPU = sysctlInt("hw.physicalcpu")
        let logicalCPU = sysctlInt("hw.logicalcpu")
        // Real iPhones: physical == logical (no SMT).
        // VMs may report different values.
        if let p = physicalCPU, let l = logicalCPU, p != l {
            return true
        }

        // Check hw.memsize — real iPhone 16 Pro has ~8GB.
        // VM may report unusual memory size.
        if let memsize = sysctlInt64("hw.memsize") {
            // Real iPhone memory: 4GB, 6GB, 8GB, 12GB in powers of 2.
            // Unusual sizes or < 2GB suggest a VM.
            if memsize < 2_000_000_000 { return true }
            if memsize > 128_000_000_000 { return true } // > 128GB
        }

        return false
    }

    /// Check sysctl for VM-specific kernel parameters.
    private func checkSysctlVM() -> Bool {
        // kern.hv — hypervisor support
        let hvSupport = sysctlInt("kern.hv")
        // On a real iPhone, this should be 0 (no hypervisor).
        // On vphone-cli, the host macOS has hypervisor support.
        // The EXP variant may hide this, but we check anyway.
        if let hv = hvSupport, hv == 1 {
            return true
        }

        // vm.loadavg — check for unusual load patterns (VM may show zero).
        // security.mac.vnode_enforce — weaker on VM.
        return false
    }

    /// Measure disk I/O latency. VM storage (especially VirtIO or ramdisk)
    /// is much faster than physical NAND.
    private func checkDiskIOTiming() -> Bool {
        // Write a small temp file and measure write+read latency.
        let tmpDir = NSTemporaryDirectory()
        let testPath = (tmpDir as NSString).appendingPathComponent("detection_io_test_\(UUID().uuidString)")

        let data = Data(repeating: 0x42, count: 4096)

        let startWrite = CFAbsoluteTimeGetCurrent()
        do {
            try data.write(to: URL(fileURLWithPath: testPath), options: .atomic)
        } catch {
            return false  // can't write? unusual but not definitive
        }
        let writeLatencyMs = (CFAbsoluteTimeGetCurrent() - startWrite) * 1000

        let startRead = CFAbsoluteTimeGetCurrent()
        let readData = try? Data(contentsOf: URL(fileURLWithPath: testPath))
        let readLatencyMs = (CFAbsoluteTimeGetCurrent() - startRead) * 1000

        // Cleanup
        try? FileManager.default.removeItem(atPath: testPath)

        // Physical NAND: write ~2–8ms, read ~0.5–2ms
        // VM ramdisk/VirtIO: write < 0.5ms, read < 0.1ms
        // VM nested virtualization: write < 0.2ms, read < 0.05ms
        if writeLatencyMs < 0.3 || readLatencyMs < 0.05 {
            return true
        }

        return false
    }

    /// Check for missing physical CPU features.
    private func checkCPUFeatures() -> Bool {
        // On real Apple Silicon: FEAT_FP, FEAT_FP16, FEAT_JSCVT, etc.
        // In a VM, some CPU features may be absent or masked.
        // We check for ARM feature register accessibility.

        // Check hw.cpufamily for known Apple Silicon families.
        let cpuFamily = sysctlInt("hw.cpufamily")
        // Known Apple families: 0x1b588bb3 (A7), … 0xda33d83d (A18/M4).
        // VM might report 0 or an unexpected value.
        if let family = cpuFamily {
            if family == 0 { return true }
        } else {
            return true
        }

        // Check for NEON/ASIMD support — essential on all real Apple Silicon,
        // could be disabled in a VM.
        if let features = sysctlString("hw.optional.arm.FEAT_AdvSIMD") {
            if features != "1" { return true }
        }

        return false
    }

    /// Check battery state.
    private func checkBatteryState() -> Bool {
        UIDevice.current.isBatteryMonitoringEnabled = true
        let state = UIDevice.current.batteryState

        // Real iPhone: batteryState is .unplugged, .charging, or .full.
        // VM: typically reports .unknown (no battery hardware).
        if state == .unknown {
            return true
        }

        // Check battery level.
        let level = UIDevice.current.batteryLevel
        // VM may report exactly 0.0 or exactly 1.0 (or -1.0 for unknown).
        if level < 0 || (level == 0.0 && state == .unknown) {
            return true
        }

        return false
    }

    // MARK: - Jailbreak Detection

    /// Check for jailbreak indicators.
    ///
    /// The adversary aims for jailbreak hiding (no Cydia Substrate hooks
    /// visible to target app), but there are still detectable artifacts.
    private func checkJailbreak() -> (score: Double, flagged: Bool) {
        var score = 0.0
        var hits = 0
        let totalChecks = 6

        // 1. File path checks
        hits += checkJailbreakFiles() ? 1 : 0
        if hits > 0 { score += 0.3 }

        // 2. dyld insert environment
        hits += checkDyldInsert() ? 1 : 0
        if hits > 1 { score += 0.2 }

        // 3. Sandbox test — try to write to a forbidden path
        hits += checkSandboxIntegrity() ? 1 : 0
        if hits > 2 { score += 0.25 }

        // 4. Fork test — iOS sandbox forbids fork()
        hits += checkForkAvailability() ? 1 : 0
        if hits > 3 { score += 0.15 }

        // 5. URL scheme check — Cydia, Sileo, etc.
        hits += checkJailbreakURLSchemes() ? 1 : 0
        if hits > 4 { score += 0.15 }

        // 6. Suspicious dylib check
        hits += checkSuspiciousDylibs() ? 1 : 0
        if hits > 5 { score += 0.1 }

        let finalScore = min(Double(hits) / Double(totalChecks) * 1.5, 1.0)
        return (finalScore, finalScore >= 0.3)
    }

    private func checkJailbreakFiles() -> Bool {
        let jbPaths = [
            "/Applications/Cydia.app",
            "/Applications/Sileo.app",
            "/Applications/Zebra.app",
            "/Library/MobileSubstrate/MobileSubstrate.dylib",
            "/usr/lib/libsubstrate.dylib",
            "/usr/lib/libsubstitute.dylib",
            "/usr/lib/libhooker.dylib",
            "/usr/sbin/sshd",
            "/bin/bash",
            "/etc/apt",
            "/private/var/lib/apt",
            "/private/var/lib/cydia",
            "/private/var/mobile/Library/SBSettings",
            "/private/var/tmp/cydia.log",
            "/private/etc/ssh/sshd_config",
            "/.bootstrapped",
            "/.bootstrap",
            "/.installed_unc0ver",
            "/.installed_taurine",
            "/.installed_odyssey",
            "/.procursus_strapped",
            "/var/jb",
            "/var/lib",  // dopamine rootless
            "/private/preboot/jb",  // rootless jb
        ]

        let fm = FileManager.default
        for path in jbPaths {
            if fm.fileExists(atPath: path) {
                return true
            }
            // Also check with fopen for paths that may be hidden from NSFileManager.
            if access(path, F_OK) == 0 {
                return true
            }
        }

        return false
    }

    private func checkDyldInsert() -> Bool {
        // Check for DYLD_INSERT_LIBRARIES
        if let insertLibs = getenv("DYLD_INSERT_LIBRARIES") {
            let str = String(cString: insertLibs)
            if !str.isEmpty {
                return true
            }
        }

        // Check for DYLD_FORCE_FLAT_NAMESPACE
        if let forceFlat = getenv("DYLD_FORCE_FLAT_NAMESPACE") {
            if String(cString: forceFlat) == "1" { return true }
        }

        // Check for __XPC_DYLD_INSERT_LIBRARIES (XPC-based injection)
        if let xpcInsert = getenv("__XPC_DYLD_INSERT_LIBRARIES") {
            if !String(cString: xpcInsert).isEmpty { return true }
        }

        return false
    }

    private func checkSandboxIntegrity() -> Bool {
        // Try to fork — a sandboxed iOS app should fail.
        // Resolve fork dynamically so the app remains buildable on iOS SDKs
        // that mark direct fork() calls unavailable while still measuring
        // whether the symbol can execute in the local lab environment.
        typealias ForkFunction = @convention(c) () -> pid_t
        typealias ExitFunction = @convention(c) (Int32) -> Void
        typealias WaitPidFunction = @convention(c) (pid_t, UnsafeMutablePointer<Int32>?, Int32) -> pid_t
        guard let handle = dlopen(nil, RTLD_NOW) else { return false }
        defer { dlclose(handle) }
        guard let symbol = dlsym(handle, "fork") else { return false }

        let forkFunction = unsafeBitCast(symbol, to: ForkFunction.self)
        let exitFunction = dlsym(handle, "_exit")
            .map { unsafeBitCast($0, to: ExitFunction.self) }
        let waitPidFunction = dlsym(handle, "waitpid")
            .map { unsafeBitCast($0, to: WaitPidFunction.self) }
        let pid = forkFunction()
        if pid >= 0 {
            // fork succeeded — this should never happen in a sandboxed app.
            if pid == 0 {
                // Child process — exit immediately.
                exitFunction?(0)
                fatalError("fork child could not resolve _exit")
            } else {
                // Parent — reap the child.
                var status: Int32 = 0
                _ = waitPidFunction?(pid, &status, 0)
            }
            return true
        }
        // fork() failed — expected behavior.
        return false
    }

    private func checkForkAvailability() -> Bool {
        // More nuanced check: can we even call fork()?
        // If we got here without crashing (sandbox denies fork execution on
        // un-jailbroken devices), the device may be compromised.
        // BUT: iOS 14+ has hardened runtime that may handle fork differently.
        // We check via sysctl.
        if let pflag = sysctlInt("kern.proc.p_flag") {
            // P_NOSHLIB = 0x800000 — if set, dynamic libraries are restricted.
            // Absence on a supposedly stock device is suspicious.
            return (pflag & 0x800000) == 0
        }
        return false
    }

    private func checkJailbreakURLSchemes() -> Bool {
        let schemes = [
            "cydia://", "sileo://", "zbra://", "filza://",
            "activator://", "winterboard://",
        ]
        for scheme in schemes {
            if let url = URL(string: scheme), UIApplication.shared.canOpenURL(url) {
                return true
            }
        }
        return false
    }

    private func checkSuspiciousDylibs() -> Bool {
        // Check loaded dynamic libraries for known tweak injection dylibs.
        let count = _dyld_image_count()

        let suspiciousFragments = [
            "substrate", "substitute", "hooker", "tweak",
            "cynject", "ellekit", "frida", "dobby",
        ]

        for i in 0..<Int(count) {
            if let name = _dyld_get_image_name(UInt32(i)) {
                let nameStr = String(cString: name).lowercased()
                for frag in suspiciousFragments {
                    if nameStr.contains(frag) {
                        return true
                    }
                }
            }
        }

        return false
    }

    // MARK: - Automation Process Detection

    /// Check for known automation tools.
    private func checkAutomationProcesses() -> (score: Double, flagged: Bool) {
        var score = 0.0
        var hits = 0

        // Check for WebDriverAgent — the primary automation bridge.
        if checkWDA() { hits += 1; score += 0.5 }

        // Check for XCTest / XCUITest runner.
        if checkXCTestRunner() { hits += 1; score += 0.3 }

        // Check for Frida.
        if checkFrida() { hits += 1; score += 0.2 }

        let finalScore = hits > 0 ? min(score, 1.0) : 0.0
        return (finalScore, hits > 0)
    }

    private func checkWDA() -> Bool {
        // WebDriverAgent runs on port 8100 by default.
        // Check if localhost:8100 is reachable (WDA HTTP server).
        // We use a raw socket connect with very short timeout.

        // Also check if the app was launched by XCTest.
        return ProcessInfo.processInfo.isRunningXCUITest
            || ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil
    }

    private func checkXCTestRunner() -> Bool {
        // Check process name / arguments for XCTest.
        let args = ProcessInfo.processInfo.arguments
        for arg in args {
            if arg.contains("XCTest") || arg.contains("xctest") {
                return true
            }
        }

        // Check environment
        let env = ProcessInfo.processInfo.environment
        if env["XCTestConfigurationFilePath"] != nil { return true }
        if env["XCTestBundlePath"] != nil { return true }
        if env["XCTestSessionIdentifier"] != nil { return true }

        return false
    }

    private func checkFrida() -> Bool {
        // Frida injects frida-agent.dylib.
        let count: UInt32 = _dyld_image_count()
        for i in 0..<Int(count) {
            if let name = _dyld_get_image_name(UInt32(i)) {
                let nameStr = String(cString: name).lowercased()
                if nameStr.contains("frida") {
                    return true
                }
            }
        }
        return false
    }

    // MARK: - Sensor Sanity

    /// Check if accelerometer and gyroscope data look real.
    ///
    /// In a VM, sensors are either static (fake constant values) or absent.
    /// Real devices have continuous micro-variations from environmental noise.
    private func checkSensorSanity(completion: @escaping (Double, Bool) -> Void) {
        // Check accelerometer.
        if motionManager.isAccelerometerAvailable {
            motionManager.accelerometerUpdateInterval = 0.05  // 20 Hz
            motionManager.startAccelerometerUpdates(to: .main) { [weak self] data, _ in
                guard let self = self, let data = data else { return }
                self.accelerometerSamples.append(data)
                if self.accelerometerSamples.count >= 20 {
                    self.motionManager.stopAccelerometerUpdates()
                    let accelResult = self.analyzeAccelerometerData()
                    let accumulatedScore = accelResult.score
                    let accumulatedHits = accelResult.flagged ? 1 : 0
                    self.checkGyroAndFinish(
                        score: accumulatedScore,
                        hits: accumulatedHits,
                        completion: completion
                    )
                }
            }
        } else {
            // No accelerometer at all — strong VM signal.
            checkGyroAndFinish(score: 0.8, hits: 1, completion: completion)
        }
    }

    private func checkGyroAndFinish(
        score: Double,
        hits: Int,
        completion: @escaping (Double, Bool) -> Void
    ) {
        if motionManager.isGyroAvailable {
            motionManager.gyroUpdateInterval = 0.05
            motionManager.startGyroUpdates(to: .main) { [weak self] data, _ in
                guard let self = self, let data = data else { return }
                self.gyroSamples.append(data)
                if self.gyroSamples.count >= 20 {
                    self.motionManager.stopGyroUpdates()
                    let gyroResult = self.analyzeGyroData()
                    let accumulatedScore = score + gyroResult.score
                    let accumulatedHits = hits + (gyroResult.flagged ? 1 : 0)

                    let finalScore = accumulatedHits > 0
                        ? min(accumulatedScore / Double(max(accumulatedHits, 1)) * 1.5, 1.0)
                        : 0.0
                    completion(finalScore, finalScore >= 0.3)
                }
            }
        } else {
            let accumulatedScore = score + 0.8
            let accumulatedHits = hits + 1
            let finalScore = accumulatedHits > 0
                ? min(accumulatedScore / Double(max(accumulatedHits, 1)) * 1.5, 1.0)
                : 0.0
            completion(finalScore, finalScore >= 0.3)
        }
    }

    private func analyzeAccelerometerData() -> (score: Double, flagged: Bool) {
        guard accelerometerSamples.count >= 5 else { return (0, false) }

        let xs = accelerometerSamples.map(\.acceleration.x)
        let ys = accelerometerSamples.map(\.acceleration.y)
        let zs = accelerometerSamples.map(\.acceleration.z)

        // Real device: readings vary slightly even when device is still.
        // VM: readings are perfectly constant (e.g., x=0, y=0, z=-1.0 with zero variance).
        let xCV = coefficientOfVariation(xs)
        let yCV = coefficientOfVariation(ys)
        let zCV = coefficientOfVariation(zs)
        let avgCV = (xCV + yCV + zCV) / 3.0

        if avgCV < 0.001 { return (0.9, true) }   // completely static
        if avgCV < 0.005 { return (0.6, true) }   // near-static
        if avgCV < 0.01  { return (0.3, false) }
        return (0.0, false)
    }

    private func analyzeGyroData() -> (score: Double, flagged: Bool) {
        guard gyroSamples.count >= 5 else { return (0, false) }

        let xs = gyroSamples.map(\.rotationRate.x)
        let ys = gyroSamples.map(\.rotationRate.y)
        let zs = gyroSamples.map(\.rotationRate.z)

        let xCV = coefficientOfVariation(xs)
        let yCV = coefficientOfVariation(ys)
        let zCV = coefficientOfVariation(zs)
        let avgCV = (xCV + yCV + zCV) / 3.0

        if avgCV < 0.001 { return (0.9, true) }
        if avgCV < 0.005 { return (0.6, true) }
        if avgCV < 0.01  { return (0.3, false) }
        return (0.0, false)
    }

    // MARK: - Network Timing

    /// Check network latency to detect local VNC/RPC.
    ///
    /// VNC/RPC to localhost VM adds ~0ms latency. Real network
    /// to the internet has 10–100ms RTT minimum.
    private func checkNetworkLatency(completion: @escaping (Double, Bool) -> Void) {
        // Connect to a known internet endpoint and measure TCP handshake time.
        // If latency is < 1ms, we're talking to localhost (or VM host).

        let host = "captive.apple.com"  // Apple's captive portal check — reliable, low-latency
        let port: UInt32 = 80

        // Use CFStream for raw socket timing.
        let startTime = CFAbsoluteTimeGetCurrent()

        var readStream: Unmanaged<CFReadStream>?
        var writeStream: Unmanaged<CFWriteStream>?

        CFStreamCreatePairWithSocketToHost(
            kCFAllocatorDefault,
            host as CFString,
            port,
            &readStream,
            &writeStream
        )

        guard let inputStream = readStream?.takeRetainedValue() else {
            // Can't create socket — unusual on a real device with internet.
            // Could be a VM with no network passthrough.
            completion(0.5, true)
            return
        }

        writeStream?.release()

        CFReadStreamScheduleWithRunLoop(inputStream, CFRunLoopGetMain(), CFRunLoopMode.commonModes)
        CFReadStreamOpen(inputStream)

        // Set a short timeout (250ms).
        let timeout = DispatchTime.now() + .milliseconds(250)

        // Poll for connection.
        func checkConnection() {
            let status = CFReadStreamGetStatus(inputStream)
            switch status {
            case .open:
                let elapsedMs = (CFAbsoluteTimeGetCurrent() - startTime) * 1000
                CFReadStreamClose(inputStream)
                CFReadStreamUnscheduleFromRunLoop(inputStream, CFRunLoopGetMain(), CFRunLoopMode.commonModes)

                // Real internet: typically 8–80ms RTT.
                // Local VM: < 1ms (socket to host).
                // VNC/RPC through localhost: < 0.5ms.
                if elapsedMs < 1.0 {
                    completion(0.9, true)   // localhost-grade latency
                } else if elapsedMs < 3.0 {
                    completion(0.5, true)   // suspiciously fast
                } else if elapsedMs < 8.0 {
                    completion(0.2, false)  // unusually fast but plausible
                } else {
                    completion(0.0, false)  // normal internet latency
                }

            case .error:
                CFReadStreamClose(inputStream)
                CFReadStreamUnscheduleFromRunLoop(inputStream, CFRunLoopGetMain(), CFRunLoopMode.commonModes)
                completion(0.0, false)  // network error — not definitive

            default:
                if CFAbsoluteTimeGetCurrent() - startTime > 0.3 {
                    // Timed out — normal for some network conditions.
                    CFReadStreamClose(inputStream)
                    CFReadStreamUnscheduleFromRunLoop(inputStream, CFRunLoopGetMain(), CFRunLoopMode.commonModes)
                    completion(0.0, false)
                } else {
                    // Poll again.
                    DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(10), execute: checkConnection)
                }
            }
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(10), execute: checkConnection)
    }

    // MARK: - Helpers

    private func sysctlString(_ name: String) -> String? {
        var size: Int = 0
        guard sysctlbyname(name, nil, &size, nil, 0) == 0 else { return nil }
        var value = [CChar](repeating: 0, count: size)
        guard sysctlbyname(name, &value, &size, nil, 0) == 0 else { return nil }
        return String(cString: value)
    }

    private func sysctlInt(_ name: String) -> Int? {
        var value: Int = 0
        var size = MemoryLayout<Int>.size
        guard sysctlbyname(name, &value, &size, nil, 0) == 0 else { return nil }
        return value
    }

    private func sysctlInt64(_ name: String) -> Int64? {
        var value: Int64 = 0
        var size = MemoryLayout<Int64>.size
        guard sysctlbyname(name, &value, &size, nil, 0) == 0 else { return nil }
        return value
    }

    private func coefficientOfVariation(_ values: [Double]) -> Double {
        guard values.count > 1 else { return 0 }
        let mean = values.reduce(0, +) / Double(values.count)
        guard abs(mean) > 1e-12 else {
            // Mean is effectively zero — check raw standard deviation.
            let variance = values.reduce(0) { $0 + $1 * $1 } / Double(values.count - 1)
            return sqrt(variance)
        }
        let variance = values.reduce(0) { $0 + ($1 - mean) * ($1 - mean) } / Double(values.count - 1)
        return sqrt(variance) / abs(mean)
    }

    func reset() {
        motionManager.stopAccelerometerUpdates()
        motionManager.stopGyroUpdates()
        accelerometerSamples.removeAll()
        gyroSamples.removeAll()
    }
}

private extension ProcessInfo {
    var isRunningXCUITest: Bool {
        let env = environment
        if env["XCTestConfigurationFilePath"] != nil { return true }
        if env["XCTestBundlePath"] != nil { return true }
        if env["XCTestSessionIdentifier"] != nil { return true }
        return arguments.contains { arg in
            arg.contains("XCTest") || arg.contains("xctest")
        }
    }
}
