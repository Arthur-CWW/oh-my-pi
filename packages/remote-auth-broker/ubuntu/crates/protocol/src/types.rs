use serde::{Deserialize, Deserializer, Serialize, Serializer};

fn required_option<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ProtocolVersion;

impl Serialize for ProtocolVersion {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_u8(1)
    }
}

impl<'de> Deserialize<'de> for ProtocolVersion {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = u8::deserialize(deserializer)?;
        if value == 1 {
            Ok(Self)
        } else {
            Err(serde::de::Error::custom("unsupported protocol version"))
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Domain {
    DesktopBrowser,
    Sudo,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Operation {
    GdmLogin,
    BitwardenUnlock,
    WebsiteAutofill,
    Sudo,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AuthorizationMode {
    Delegated,
    BiometricOneShot,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Risk {
    Low,
    Medium,
    High,
    Critical,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PublicError {
    Inactive,
    Disabled,
    Unavailable,
    Timeout,
    Cancelled,
    ProtocolInvalid,
    FrameInvalid,
    ExcessField,
    NoncanonicalValue,
    PrincipalInvalid,
    OwnerStale,
    PeerMismatch,
    RequestExpired,
    RequestReplayed,
    BodyConflict,
    GrantRequired,
    GrantForbidden,
    GrantInvalid,
    PolicyMismatch,
    DomainMismatch,
    TargetMismatch,
    ReviewBlocked,
    SignatureInvalid,
    CiphertextInvalid,
    ChallengeInvalid,
    ClaimRejected,
    ExecutionFailed,
    IntegrityFailure,
    Internal,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Principal {
    pub session_id: String,
    pub owner_epoch: String,
    pub pid: u32,
    pub uid: u32,
    pub code_identity: String,
    pub build_digest: String,
    pub runner_instance_identity: String,
    pub ownership_socket_path: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PamService {
    #[serde(rename = "gdm-password")]
    GdmPassword,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RemoteHost {
    Empty,
    Local,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ExtensionSource {
    #[serde(rename = "official-chrome-web-store")]
    OfficialChromeWebStore,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Target {
    Gdm {
        #[serde(rename = "sshHostKeyDigest")]
        ssh_host_key_digest: String,
        #[serde(rename = "machineId")]
        machine_id: String,
        #[serde(rename = "bootId")]
        boot_id: String,
        username: String,
        uid: u32,
        #[serde(rename = "pamService")]
        pam_service: PamService,
        seat: String,
        tty: String,
        rhost: RemoteHost,
        #[serde(rename = "greeterGeneration")]
        greeter_generation: u64,
        #[serde(rename = "jetkvmDeviceId")]
        jetkvm_device_id: String,
        #[serde(rename = "controllerGeneration")]
        controller_generation: u64,
    },
    Bitwarden {
        #[serde(rename = "hostIdentity")]
        host_identity: String,
        #[serde(rename = "graphicalSessionId")]
        graphical_session_id: String,
        #[serde(rename = "chromeService")]
        chrome_service: String,
        #[serde(rename = "chromeExecutableDigest")]
        chrome_executable_digest: String,
        #[serde(rename = "chromePid")]
        chrome_pid: u32,
        #[serde(rename = "profileIdentity")]
        profile_identity: String,
        #[serde(rename = "browserTargetId")]
        browser_target_id: String,
        #[serde(rename = "windowId")]
        window_id: String,
        #[serde(rename = "extensionId")]
        extension_id: String,
        #[serde(rename = "extensionVersion")]
        extension_version: String,
        #[serde(rename = "extensionSource")]
        extension_source: ExtensionSource,
        #[serde(rename = "manifestDigest")]
        manifest_digest: String,
        #[serde(rename = "uiTarget")]
        ui_target: String,
    },
    Website {
        #[serde(rename = "hostIdentity")]
        host_identity: String,
        #[serde(rename = "graphicalSessionId")]
        graphical_session_id: String,
        #[serde(rename = "chromeService")]
        chrome_service: String,
        #[serde(rename = "chromeExecutableDigest")]
        chrome_executable_digest: String,
        #[serde(rename = "chromePid")]
        chrome_pid: u32,
        #[serde(rename = "profileIdentity")]
        profile_identity: String,
        #[serde(rename = "browserTargetId")]
        browser_target_id: String,
        #[serde(rename = "windowId")]
        window_id: String,
        #[serde(rename = "extensionId")]
        extension_id: String,
        #[serde(rename = "extensionVersion")]
        extension_version: String,
        #[serde(rename = "extensionSource")]
        extension_source: ExtensionSource,
        #[serde(rename = "manifestDigest")]
        manifest_digest: String,
        #[serde(rename = "uiTarget")]
        ui_target: String,
        #[serde(rename = "originSet")]
        origin_set: Vec<String>,
        #[serde(rename = "activeTabId")]
        active_tab_id: String,
        #[serde(rename = "frameId")]
        frame_id: String,
        #[serde(rename = "formActionOrigin")]
        form_action_origin: String,
        #[serde(rename = "foregroundWindowId")]
        foreground_window_id: String,
        #[serde(rename = "credentialPairingId")]
        credential_pairing_id: String,
    },
    Sudo {
        #[serde(rename = "sshHostKeyDigest")]
        ssh_host_key_digest: String,
        #[serde(rename = "machineId")]
        machine_id: String,
        #[serde(rename = "bootId")]
        boot_id: String,
        username: String,
        uid: u32,
        #[serde(rename = "sudoPolicyDigest")]
        sudo_policy_digest: String,
        #[serde(rename = "actionId")]
        action_id: String,
        executable: String,
        #[serde(rename = "argvDigest")]
        argv_digest: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ExecutionRequest {
    pub protocol_version: ProtocolVersion,
    pub request_id: String,
    pub nonce: String,
    pub created_at: u64,
    pub expires_at: u64,
    pub principal: Principal,
    pub authorization_mode_requested: AuthorizationMode,
    pub domain: Domain,
    pub operation: Operation,
    pub target: Target,
    pub purpose: String,
    #[serde(deserialize_with = "required_option")]
    pub grant_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PrincipalSelector {
    pub session_id: String,
    pub owner_epoch: String,
    pub uid: u32,
    pub code_identity: String,
    pub build_digest: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum GrantLifecycleState {
    Active,
    Consumed,
    Expired,
    Revoked,
    Invalidated,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Grant {
    pub protocol_version: ProtocolVersion,
    pub grant_id: String,
    pub principal_selector: PrincipalSelector,
    pub domain: Domain,
    pub operation: Operation,
    pub target_predicate: Target,
    pub risk_ceiling: Risk,
    pub issued_at: u64,
    pub expires_at: u64,
    #[serde(deserialize_with = "required_option")]
    pub revoked_at: Option<u64>,
    #[serde(deserialize_with = "required_option")]
    pub consumed_at: Option<u64>,
    pub policy_digest: String,
    pub broker_build_digest: String,
    pub broker_code_identity: String,
    pub biometric_evidence_id: String,
    pub biometric_issued_at: u64,
    pub lifecycle_state: GrantLifecycleState,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ReceiptEvents {
    pub requested_at: u64,
    #[serde(deserialize_with = "required_option")]
    pub authorized_at: Option<u64>,
    #[serde(deserialize_with = "required_option")]
    pub executing_at: Option<u64>,
    #[serde(deserialize_with = "required_option")]
    pub terminal_at: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ReceiptState {
    Requested,
    Authorized,
    Executing,
    Succeeded,
    Failed,
    Cancelled,
    Expired,
    Revoked,
    Disabled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TargetReleaseDisposition {
    NotApplicable,
    Quarantined,
    Destroyed,
    Closed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Receipt {
    pub protocol_version: ProtocolVersion,
    pub receipt_id: String,
    pub request_id: String,
    #[serde(deserialize_with = "required_option")]
    pub grant_id: Option<String>,
    pub domain: Domain,
    pub operation: Operation,
    pub authorization_mode_used: AuthorizationMode,
    pub target_fingerprint: String,
    pub state: ReceiptState,
    #[serde(deserialize_with = "required_option")]
    pub error_code: Option<PublicError>,
    pub events: ReceiptEvents,
    pub policy_digest: String,
    pub broker_build_digest: String,
    pub broker_code_digest: String,
    pub target_release_disposition: TargetReleaseDisposition,
    #[serde(deserialize_with = "required_option")]
    pub browser_target_generation: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct EndpointStatus {
    pub ready: bool,
    #[serde(deserialize_with = "required_option")]
    pub error_code: Option<PublicError>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CanonicalStatus {
    #[serde(rename = "DESIGN/INACTIVE")]
    DesignInactive,
    #[serde(rename = "ACTIVE")]
    Active,
    #[serde(rename = "DISABLED")]
    Disabled,
    #[serde(rename = "DEGRADED")]
    Degraded,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SocketPosture {
    Absent,
    OwnerOnly,
    Invalid,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PublicStatus {
    pub protocol_version: ProtocolVersion,
    pub canonical_status: CanonicalStatus,
    #[serde(deserialize_with = "required_option")]
    pub policy_digest: Option<String>,
    #[serde(deserialize_with = "required_option")]
    pub installed_build_digest: Option<String>,
    #[serde(deserialize_with = "required_option")]
    pub running_build_digest: Option<String>,
    #[serde(deserialize_with = "required_option")]
    pub code_identity: Option<String>,
    #[serde(deserialize_with = "required_option")]
    pub pid: Option<u32>,
    pub socket_posture: SocketPosture,
    #[serde(deserialize_with = "required_option")]
    pub jetkvm_controller_generation: Option<u64>,
    pub gdm: EndpointStatus,
    pub browser: EndpointStatus,
    pub sudo: EndpointStatus,
    pub errors: Vec<PublicError>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "kebab-case", deny_unknown_fields)]
pub enum ControlRequest {
    RequestState { #[serde(rename = "requestId")] request_id: String },
    Cancel { #[serde(rename = "requestId")] request_id: String },
    GrantList {},
    GrantRevoke { #[serde(rename = "grantId")] grant_id: String },
    GrantExpire { #[serde(rename = "grantId")] grant_id: String },
    CredentialForget { #[serde(rename = "credentialId")] credential_id: String },
    EmergencyDisable { reason: String },
    ReEnable {},
    Status {},
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct GdmChallenge {
    pub protocol_version: ProtocolVersion,
    pub challenge_id: String,
    pub challenge: String,
    pub boot_id: String,
    pub issued_boottime_ms: u64,
    pub expires_boottime_ms: u64,
    pub policy_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct GdmEnvelope {
    pub protocol_version: ProtocolVersion,
    pub request: ExecutionRequest,
    pub challenge: GdmChallenge,
    pub issue_id: String,
    pub sentinel_hash: String,
    pub hpke_enc: String,
    pub ciphertext: String,
    pub signing_key_id: String,
    pub signature: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct GdmClaim {
    pub protocol_version: ProtocolVersion,
    pub request_id: String,
    pub nonce: String,
    pub issue_id: String,
    pub sentinel: String,
    pub username: String,
    pub uid: u32,
    pub pam_service: PamService,
    pub seat: String,
    pub tty: String,
    pub rhost: RemoteHost,
    pub greeter_generation: u64,
    pub controller_generation: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SudoSignedRequest {
    pub protocol_version: ProtocolVersion,
    pub request: ExecutionRequest,
    pub canonical_body_digest: String,
    pub signing_key_id: String,
    pub signature: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReviewerReason {
    SemanticAllow,
    SemanticDeny,
    SemanticEscalate,
    Timeout,
    Cancelled,
    ModelFailure,
    SessionFailure,
    ProviderFailure,
    TransportFailure,
    ParseFailure,
    MissingEvidence,
    PromptInjection,
    DigestMismatch,
    TruncatedInput,
    OmittedSecurityField,
    CanonicalActionUnreconstructable,
    ReviewerSetupFailure,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum UserAuthorization {
    Unknown,
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ReviewerStatus {
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ReviewerOutcome {
    Allow,
    Deny,
    Escalate,
    Blocked,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ReviewerResult {
    pub protocol_version: ProtocolVersion,
    pub review_id: String,
    pub canonical_request_digest: String,
    pub reviewer_model: String,
    pub reviewer_build_digest: String,
    pub prompt_policy_digest: String,
    pub risk: Risk,
    pub user_authorization: UserAuthorization,
    pub status: ReviewerStatus,
    pub outcome: ReviewerOutcome,
    pub reason_code: ReviewerReason,
    pub reason: String,
    pub rationale: String,
    pub attempt_count: u8,
    pub started_at: u64,
    pub completed_at: u64,
    pub expires_at: u64,
}
