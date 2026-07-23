use std::collections::BTreeSet;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};

use remote_auth_broker_protocol::{
    decode_control_frame, decode_execution_request_frame, decode_frame_payload,
    decode_public_status_frame, decode_receipt_frame, encode_execution_request_frame,
    encode_frame_payload, encode_public_status_frame, encode_receipt_frame,
    execution_request_transcript, gdm_envelope_signature_transcript, gdm_hpke_aad_transcript,
    gdm_hpke_info_transcript, open_hpke_base, sha256_hex, validate_sentinel, verify_ed25519,
    CryptoError, Ed25519PublicKey, Ed25519Signature, EndpointStatus, ExecutionRequest,
    FrameDecoder, FrameError, GdmEnvelope, HpkeCiphertext, HpkeEncapsulatedKey, HpkeInfo,
    HpkePrivateKey, HpkePublicKey, Principal, PrincipalSelector, PublicError, PublicStatus, Receipt,
    ReviewerResult, SudoSignedRequest, Validate, WireError, MAX_FRAME_BYTES,
};
use serde::Deserialize;
use serde_json::{json, Value};

const FIXTURE_JSON: &str = include_str!("../../../../contracts/fixtures/v1/protocol-vectors.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    fixture_version: u32,
    credential_free: bool,
    encoding: Encoding,
    request_vectors: Vec<RequestVector>,
    gdm_crypto_vector: GdmCryptoVector,
    sentinel_cases: Vec<SentinelCase>,
    malformed_request_cases: Vec<MalformedRequestCase>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Encoding {
    magic_hex: String,
    length_framing: String,
    max_frame_bytes: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RequestVector {
    name: String,
    request: Value,
    transcript_hex: String,
    sha256: String,
    #[serde(default)]
    ed25519_signature: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GdmCryptoVector {
    challenge: Value,
    issue_id: String,
    sentinel: String,
    sentinel_hash: String,
    recipient_key_id: String,
    hpke_info_transcript_hex: String,
    hpke_aad_transcript_hex: String,
    recipient_private_key_test_only: String,
    recipient_public_key: String,
    encapsulated_key: String,
    plaintext_test_payload_hex: String,
    ciphertext: String,
    signing_key_id: String,
    ed25519_public_key: String,
    signature_transcript_hex: String,
    signature: String,
}

#[derive(Debug, Deserialize)]
struct SentinelCase {
    value: String,
    valid: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MalformedRequestCase {
    case: String,
    base: String,
    mutation: Mutation,
    expected_error: String,
}

#[derive(Debug, Deserialize)]
struct Mutation {
    path: String,
    value: Value,
}

fn fixture() -> Fixture {
    serde_json::from_str(FIXTURE_JSON).expect("shared protocol fixture must decode")
}

fn frame_json(value: &Value) -> Vec<u8> {
    let payload = serde_json::to_vec(value).expect("test JSON must encode");
    encode_frame_payload(&payload).expect("test JSON must fit in one frame")
}

fn request_vector<'a>(fixture: &'a Fixture, name: &str) -> &'a RequestVector {
    fixture
        .request_vectors
        .iter()
        .find(|vector| vector.name == name)
        .expect("named request vector must exist")
}

fn public_error(value: &str) -> PublicError {
    serde_json::from_value(Value::String(value.to_owned())).expect("fixture error must be public")
}

fn principal_json(owner_epoch: Value) -> Value {
    json!({
        "sessionId": "session-fixture-v1",
        "ownerEpoch": owner_epoch,
        "pid": 4242,
        "uid": 501,
        "codeIdentity": "com.openai.omp.fixture",
        "buildDigest": "1111111111111111111111111111111111111111111111111111111111111111",
        "runnerInstanceIdentity": "runner-fixture-v1",
        "ownershipSocketPath": "/tmp/owners-v1/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/claim/owner.sock"
    })
}

fn principal_selector_json(owner_epoch: Value) -> Value {
    json!({
        "sessionId": "session-fixture-v1",
        "ownerEpoch": owner_epoch,
        "uid": 501,
        "codeIdentity": "com.openai.omp.fixture",
        "buildDigest": "1111111111111111111111111111111111111111111111111111111111111111"
    })
}

fn receipt_json(
    state: &str,
    error_code: Option<&str>,
    events: (Option<u64>, Option<u64>, Option<u64>),
) -> Value {
    let (authorized_at, executing_at, terminal_at) = events;
    json!({
        "protocolVersion": 1,
        "receiptId": "AAECAwQFBgcICQoLDA0ODw",
        "requestId": "gIGCg4SFhoeIiYqLjI2Ojw",
        "grantId": null,
        "domain": "sudo",
        "operation": "sudo",
        "authorizationModeUsed": "biometric-one-shot",
        "targetFingerprint": "1111111111111111111111111111111111111111111111111111111111111111",
        "state": state,
        "errorCode": error_code,
        "events": {
            "requestedAt": 1,
            "authorizedAt": authorized_at,
            "executingAt": executing_at,
            "terminalAt": terminal_at
        },
        "policyDigest": "2222222222222222222222222222222222222222222222222222222222222222",
        "brokerBuildDigest": "3333333333333333333333333333333333333333333333333333333333333333",
        "brokerCodeDigest": "4444444444444444444444444444444444444444444444444444444444444444",
        "targetReleaseDisposition": "not-applicable",
        "browserTargetGeneration": null
    })
}

fn website_request_json(origin: &str) -> Value {
    let shared = fixture();
    let mut request = request_vector(&shared, "gdm-delegated").request.clone();
    request["authorizationModeRequested"] = json!("biometric-one-shot");
    request["operation"] = json!("website-autofill");
    request["grantId"] = Value::Null;
    request["target"] = json!({
        "kind": "website",
        "hostIdentity": "fixture-host",
        "graphicalSessionId": "fixture-session",
        "chromeService": "fixture-chrome",
        "chromeExecutableDigest": "2222222222222222222222222222222222222222222222222222222222222222",
        "chromePid": 4242,
        "profileIdentity": "fixture-profile",
        "browserTargetId": "fixture-target",
        "windowId": "fixture-window",
        "extensionId": "fixture-extension",
        "extensionVersion": "1.0.0",
        "extensionSource": "official-chrome-web-store",
        "manifestDigest": "3333333333333333333333333333333333333333333333333333333333333333",
        "uiTarget": "fixture-ui",
        "originSet": [origin],
        "activeTabId": "fixture-tab",
        "frameId": "fixture-frame",
        "formActionOrigin": origin,
        "foregroundWindowId": "fixture-foreground-window",
        "credentialPairingId": "fixture-pairing"
    });
    request
}

fn gdm_envelope_json(ciphertext_decoded_len: usize) -> Value {
    let shared = fixture();
    let crypto = &shared.gdm_crypto_vector;
    json!({
        "protocolVersion": 1,
        "request": request_vector(&shared, "gdm-delegated").request.clone(),
        "challenge": crypto.challenge.clone(),
        "issueId": crypto.issue_id.as_str(),
        "sentinelHash": crypto.sentinel_hash.as_str(),
        "hpkeEnc": crypto.encapsulated_key.as_str(),
        "ciphertext": URL_SAFE_NO_PAD.encode(vec![0_u8; ciphertext_decoded_len]),
        "signingKeyId": crypto.signing_key_id.as_str(),
        "signature": crypto.signature.as_str()
    })
}

fn reviewer_result_json(completed_at: u64, expires_at: u64) -> Value {
    json!({
        "protocolVersion": 1,
        "reviewId": "AAECAwQFBgcICQoLDA0ODw",
        "canonicalRequestDigest": "1111111111111111111111111111111111111111111111111111111111111111",
        "reviewerModel": "fixture-reviewer",
        "reviewerBuildDigest": "2222222222222222222222222222222222222222222222222222222222222222",
        "promptPolicyDigest": "3333333333333333333333333333333333333333333333333333333333333333",
        "risk": "low",
        "userAuthorization": "high",
        "status": "completed",
        "outcome": "allow",
        "reasonCode": "semantic_allow",
        "reason": "fixture semantic allow",
        "rationale": "fixture rationale",
        "attemptCount": 1,
        "startedAt": 100,
        "completedAt": completed_at,
        "expiresAt": expires_at
    })
}

fn assert_zeroizing_plaintext(_: &zeroize::Zeroizing<Vec<u8>>) {}

#[test]
fn shared_request_transcripts_digests_and_frames_match() {
    let fixture = fixture();
    assert_eq!(fixture.fixture_version, 1);
    assert!(fixture.credential_free);
    assert_eq!(fixture.encoding.magic_hex, "52414231");
    assert_eq!(fixture.encoding.length_framing, "u32be JSON byte length");
    assert_eq!(fixture.encoding.max_frame_bytes, MAX_FRAME_BYTES);

    for vector in &fixture.request_vectors {
        assert!(
            vector.request["principal"]["ownerEpoch"].is_string(),
            "{}",
            vector.name
        );
        let request: ExecutionRequest =
            serde_json::from_value(vector.request.clone()).expect("fixture request must decode");
        request.validate().expect("fixture request must validate");
        let transcript = execution_request_transcript(&request).expect("transcript must build");
        assert_eq!(hex::encode(&transcript), vector.transcript_hex, "{}", vector.name);
        assert_eq!(sha256_hex(&transcript), vector.sha256, "{}", vector.name);

        let frame = encode_execution_request_frame(&request).expect("request must frame");
        assert_eq!(u32::from_be_bytes(frame[..4].try_into().unwrap()) as usize, frame.len() - 4);
        assert_eq!(decode_execution_request_frame(&frame).unwrap(), request);
    }
}

#[test]
fn shared_malformed_requests_return_exact_public_errors() {
    let fixture = fixture();
    for malformed in &fixture.malformed_request_cases {
        let mut request = request_vector(&fixture, &malformed.base).request.clone();
        request[&malformed.mutation.path] = malformed.mutation.value.clone();
        let error = decode_execution_request_frame(&frame_json(&request)).unwrap_err();
        assert_eq!(
            error.public_error(),
            public_error(&malformed.expected_error),
            "{}",
            malformed.case
        );
    }
}

#[test]
fn strict_request_decoding_rejects_nested_excess_missing_and_invalid_values() {
    let fixture = fixture();
    let base = &request_vector(&fixture, "gdm-delegated").request;

    let mut nested_excess = base.clone();
    nested_excess["target"]["unexpected"] = json!(true);
    assert_eq!(
        decode_execution_request_frame(&frame_json(&nested_excess))
            .unwrap_err()
            .public_error(),
        PublicError::ExcessField
    );

    let mut missing_required_null = base.clone();
    missing_required_null
        .as_object_mut()
        .unwrap()
        .remove("grantId");
    assert_eq!(
        decode_execution_request_frame(&frame_json(&missing_required_null))
            .unwrap_err()
            .public_error(),
        PublicError::NoncanonicalValue
    );

    let mut target_mismatch = base.clone();
    target_mismatch["operation"] = json!("bitwarden-unlock");
    assert_eq!(
        decode_execution_request_frame(&frame_json(&target_mismatch))
            .unwrap_err()
            .public_error(),
        PublicError::TargetMismatch
    );

    let mut invalid_grant_id = base.clone();
    invalid_grant_id["grantId"] = json!("grant-v1:short");
    assert_eq!(
        decode_execution_request_frame(&frame_json(&invalid_grant_id))
            .unwrap_err()
            .public_error(),
        PublicError::GrantInvalid
    );

    let mut unsafe_time = base.clone();
    unsafe_time["createdAt"] = json!(9_007_199_254_740_992_u64);
    assert_eq!(
        decode_execution_request_frame(&frame_json(&unsafe_time))
            .unwrap_err()
            .public_error(),
        PublicError::NoncanonicalValue
    );

    let mut delete_control = base.clone();
    delete_control["purpose"] = json!("bad\u{7f}control");
    assert_eq!(
        decode_execution_request_frame(&frame_json(&delete_control))
            .unwrap_err()
            .public_error(),
        PublicError::NoncanonicalValue
    );
}

#[test]
fn owner_epoch_uuid_is_canonical_for_principal_and_selector() {
    for owner_epoch in [
        "00112233-4455-1677-8899-aabbccddeeff",
        "00112233-4455-8677-b899-aabbccddeeff",
    ] {
        let principal: Principal =
            serde_json::from_value(principal_json(json!(owner_epoch))).unwrap();
        assert_eq!(principal.owner_epoch.as_str(), owner_epoch);
        assert_eq!(principal.validate(), Ok(()));

        let selector: PrincipalSelector =
            serde_json::from_value(principal_selector_json(json!(owner_epoch))).unwrap();
        assert_eq!(selector.owner_epoch.as_str(), owner_epoch);
        assert_eq!(selector.validate(), Ok(()));
    }

    for (case, owner_epoch) in [
        ("uppercase", "00112233-4455-4677-8899-AABBCCDDEEFF"),
        ("version-zero", "00112233-4455-0677-8899-aabbccddeeff"),
        ("version-nine", "00112233-4455-9677-8899-aabbccddeeff"),
        ("variant-seven", "00112233-4455-4677-7899-aabbccddeeff"),
        ("variant-c", "00112233-4455-4677-c899-aabbccddeeff"),
    ] {
        let principal: Principal =
            serde_json::from_value(principal_json(json!(owner_epoch))).unwrap();
        assert_eq!(
            principal.validate(),
            Err(PublicError::PrincipalInvalid),
            "{case}"
        );

        let selector: PrincipalSelector =
            serde_json::from_value(principal_selector_json(json!(owner_epoch))).unwrap();
        assert_eq!(
            selector.validate(),
            Err(PublicError::GrantInvalid),
            "{case}"
        );
    }

    assert!(serde_json::from_value::<Principal>(principal_json(json!(1_700_000_000_000_u64)))
        .is_err());
    assert!(serde_json::from_value::<PrincipalSelector>(principal_selector_json(json!(
        1_700_000_000_000_u64
    )))
    .is_err());
}

#[test]
fn unicode_control_scalars_are_rejected_from_text_fields() {
    let shared = fixture();
    for purpose in ["bad\u{0085}control", "bad\u{009f}control"] {
        let mut request = request_vector(&shared, "gdm-delegated").request.clone();
        request["purpose"] = json!(purpose);
        assert_eq!(
            decode_execution_request_frame(&frame_json(&request))
                .unwrap_err()
                .public_error(),
            PublicError::NoncanonicalValue,
            "{purpose:?}"
        );
    }
}

#[test]
fn https_origins_enforce_canonical_labels_total_length_and_port() {
    let host_245 = format!(
        "{}.{}.{}.{}",
        "a".repeat(63),
        "b".repeat(63),
        "c".repeat(63),
        "d".repeat(53)
    );
    for origin in [
        "https://example.com".to_owned(),
        "https://example.com:8443".to_owned(),
        format!("https://{host_245}"),
    ] {
        decode_execution_request_frame(&frame_json(&website_request_json(&origin)))
            .unwrap_or_else(|error| panic!("{origin}: {error:?}"));
    }

    let host_246 = format!(
        "{}.{}.{}.{}",
        "a".repeat(63),
        "b".repeat(63),
        "c".repeat(63),
        "d".repeat(54)
    );
    for origin in [
        format!("https://{}.example", "a".repeat(64)),
        "https://Example.com".to_owned(),
        "https://-example.com".to_owned(),
        "https://example-.com".to_owned(),
        "https://example..com".to_owned(),
        format!("https://{host_246}"),
        "https://example.com:443".to_owned(),
        "https://example.com:08443".to_owned(),
    ] {
        assert_eq!(
            decode_execution_request_frame(&frame_json(&website_request_json(&origin)))
                .unwrap_err()
                .public_error(),
            PublicError::NoncanonicalValue,
            "{origin}"
        );
    }
}

#[test]
fn receipt_error_codes_exactly_follow_terminal_outcomes() {
    for (state, events) in [
        ("requested", (None, None, None)),
        ("authorized", (Some(2), None, None)),
        ("executing", (Some(2), Some(3), None)),
        ("succeeded", (Some(2), Some(3), Some(4))),
    ] {
        let canonical = receipt_json(state, None, events);
        decode_receipt_frame(&frame_json(&canonical))
            .unwrap_or_else(|error| panic!("{state}: {error:?}"));

        let mut with_error = canonical;
        with_error["errorCode"] = json!("internal");
        assert_eq!(
            decode_receipt_frame(&frame_json(&with_error))
                .unwrap_err()
                .public_error(),
            PublicError::NoncanonicalValue,
            "{state}"
        );
    }

    for state in ["failed", "cancelled", "expired", "revoked", "disabled"] {
        let events = (Some(2), Some(3), Some(4));
        decode_receipt_frame(&frame_json(&receipt_json(state, Some("internal"), events)))
            .unwrap_or_else(|error| panic!("{state}: {error:?}"));
        assert_eq!(
            decode_receipt_frame(&frame_json(&receipt_json(state, None, events)))
                .unwrap_err()
                .public_error(),
            PublicError::NoncanonicalValue,
            "{state}"
        );
    }
}


#[test]
fn browser_secret_receipts_require_a_release_and_target_generation() {
    for operation in ["bitwarden-unlock", "website-autofill"] {
        let mut valid = receipt_json("succeeded", None, (Some(2), Some(3), Some(4)));
        valid["domain"] = json!("desktop-browser");
        valid["operation"] = json!(operation);
        valid["targetReleaseDisposition"] = json!("quarantined");
        valid["browserTargetGeneration"] = json!(5);
        decode_receipt_frame(&frame_json(&valid))
            .unwrap_or_else(|error| panic!("{operation}: {error:?}"));

        let mut not_released = valid.clone();
        not_released["targetReleaseDisposition"] = json!("not-applicable");
        assert_eq!(
            decode_receipt_frame(&frame_json(&not_released))
                .unwrap_err()
                .public_error(),
            PublicError::NoncanonicalValue,
            "{operation} with not-applicable release"
        );

        valid["browserTargetGeneration"] = Value::Null;
        assert_eq!(
            decode_receipt_frame(&frame_json(&valid))
                .unwrap_err()
                .public_error(),
            PublicError::NoncanonicalValue,
            "{operation} without browser target generation"
        );
    }
}

#[test]
fn non_browser_receipts_forbid_release_and_target_generation() {
    for (operation, domain) in [("gdm-login", "desktop-browser"), ("sudo", "sudo")] {
        let mut valid = receipt_json("succeeded", None, (Some(2), Some(3), Some(4)));
        valid["domain"] = json!(domain);
        valid["operation"] = json!(operation);
        decode_receipt_frame(&frame_json(&valid))
            .unwrap_or_else(|error| panic!("{operation}: {error:?}"));

        for disposition in ["quarantined", "destroyed", "closed"] {
            let mut released = valid.clone();
            released["targetReleaseDisposition"] = json!(disposition);
            assert_eq!(
                decode_receipt_frame(&frame_json(&released))
                    .unwrap_err()
                    .public_error(),
                PublicError::NoncanonicalValue,
                "{operation} with {disposition} release"
            );
        }

        valid["browserTargetGeneration"] = json!(5);
        assert_eq!(
            decode_receipt_frame(&frame_json(&valid))
                .unwrap_err()
                .public_error(),
            PublicError::NoncanonicalValue,
            "{operation} with browser target generation"
        );
    }
}

#[test]
fn endpoint_ready_is_exactly_equivalent_to_no_error() {
    for (ready, error_code) in [(true, None), (false, Some("inactive"))] {
        let status: EndpointStatus = serde_json::from_value(json!({
            "ready": ready,
            "errorCode": error_code
        }))
        .unwrap();
        assert_eq!(status.validate(), Ok(()));
    }

    for (ready, error_code) in [(true, Some("inactive")), (false, None)] {
        let status: EndpointStatus = serde_json::from_value(json!({
            "ready": ready,
            "errorCode": error_code
        }))
        .unwrap();
        assert_eq!(
            status.validate(),
            Err(PublicError::NoncanonicalValue),
            "ready={ready}, error={error_code:?}"
        );
    }
}

#[test]
fn gdm_ciphertext_enforces_exact_decoded_byte_bounds() {
    for decoded_len in [16, 393_216] {
        let envelope: GdmEnvelope =
            serde_json::from_value(gdm_envelope_json(decoded_len)).unwrap();
        assert_eq!(envelope.validate(), Ok(()), "{decoded_len}");
    }

    for decoded_len in [15, 393_217] {
        let envelope: GdmEnvelope =
            serde_json::from_value(gdm_envelope_json(decoded_len)).unwrap();
        assert_eq!(
            envelope.validate(),
            Err(PublicError::NoncanonicalValue),
            "{decoded_len}"
        );
    }
}

#[test]
fn reviewer_expiry_is_strictly_after_completion() {
    let valid: ReviewerResult = serde_json::from_value(reviewer_result_json(200, 201)).unwrap();
    assert_eq!(valid.validate(), Ok(()));

    for expires_at in [199, 200] {
        let invalid: ReviewerResult =
            serde_json::from_value(reviewer_result_json(200, expires_at)).unwrap();
        assert_eq!(
            invalid.validate(),
            Err(PublicError::ReviewBlocked),
            "{expires_at}"
        );
    }
}

#[test]
fn sudo_signed_request_recomputes_canonical_body_digest() {
    let shared = fixture();
    let vector = request_vector(&shared, "sudo-biometric-one-shot");
    let request: ExecutionRequest = serde_json::from_value(vector.request.clone()).unwrap();
    let recomputed_digest = sha256_hex(&execution_request_transcript(&request).unwrap());
    assert_eq!(recomputed_digest, vector.sha256);

    let mut signed: SudoSignedRequest = serde_json::from_value(json!({
        "protocolVersion": 1,
        "request": vector.request.clone(),
        "canonicalBodyDigest": recomputed_digest,
        "signingKeyId": shared.gdm_crypto_vector.signing_key_id.as_str(),
        "signature": vector
            .ed25519_signature
            .as_deref()
            .expect("sudo vector must carry a signature")
    }))
    .unwrap();
    assert_eq!(signed.validate(), Ok(()));

    signed.canonical_body_digest =
        "0000000000000000000000000000000000000000000000000000000000000000".to_owned();
    assert_eq!(signed.validate(), Err(PublicError::IntegrityFailure));
}

#[test]
fn sentinel_cases_match_shared_vectors() {
    for case in fixture().sentinel_cases {
        assert_eq!(validate_sentinel(&case.value), case.valid, "{}", case.value);
    }
}

#[test]
fn shared_ed25519_and_hpke_vectors_verify() {
    let fixture = fixture();
    let crypto = &fixture.gdm_crypto_vector;
    assert!(validate_sentinel(&crypto.sentinel));
    let gdm_request: ExecutionRequest = serde_json::from_value(
        request_vector(&fixture, "gdm-delegated").request.clone(),
    )
    .unwrap();
    let challenge = serde_json::from_value(crypto.challenge.clone()).unwrap();

    let info_transcript = gdm_hpke_info_transcript(&crypto.recipient_key_id).unwrap();
    assert_eq!(hex::encode(&info_transcript), crypto.hpke_info_transcript_hex);
    let aad_transcript = gdm_hpke_aad_transcript(
        &gdm_request,
        &challenge,
        &crypto.issue_id,
        &crypto.sentinel_hash,
    )
    .unwrap();
    assert_eq!(hex::encode(&aad_transcript), crypto.hpke_aad_transcript_hex);

    let private_key =
        HpkePrivateKey::from_base64url(&crypto.recipient_private_key_test_only).unwrap();
    HpkePublicKey::from_base64url(&crypto.recipient_public_key).unwrap();
    let encapsulated_key =
        HpkeEncapsulatedKey::from_base64url(&crypto.encapsulated_key).unwrap();
    let ciphertext = HpkeCiphertext::from_base64url(&crypto.ciphertext).unwrap();
    let info = HpkeInfo::new(&crypto.recipient_key_id).unwrap();
    let plaintext = open_hpke_base(
        &private_key,
        &encapsulated_key,
        &info,
        &aad_transcript,
        &ciphertext,
    )
    .unwrap();
    assert_zeroizing_plaintext(&plaintext);
    assert_eq!(
        hex::encode(plaintext.as_slice()),
        crypto.plaintext_test_payload_hex
    );

    let signature_transcript = gdm_envelope_signature_transcript(
        &aad_transcript,
        &encapsulated_key,
        &ciphertext,
        &crypto.signing_key_id,
    )
    .unwrap();
    assert_eq!(hex::encode(&signature_transcript), crypto.signature_transcript_hex);
    let public_key = Ed25519PublicKey::from_base64url(&crypto.ed25519_public_key).unwrap();
    let signature = Ed25519Signature::from_base64url(&crypto.signature).unwrap();
    verify_ed25519(&public_key, &signature_transcript, &signature).unwrap();

    let sudo_vector = request_vector(&fixture, "sudo-biometric-one-shot");
    let sudo_request: ExecutionRequest =
        serde_json::from_value(sudo_vector.request.clone()).unwrap();
    let sudo_transcript = execution_request_transcript(&sudo_request).unwrap();
    let sudo_signature = Ed25519Signature::from_base64url(
        sudo_vector
            .ed25519_signature
            .as_deref()
            .expect("sudo vector must carry a signature"),
    )
    .unwrap();
    verify_ed25519(&public_key, &sudo_transcript, &sudo_signature).unwrap();
}

#[test]
fn hpke_rejects_ciphertext_tampering_with_a_bounded_error() {
    let fixture = fixture();
    let crypto = &fixture.gdm_crypto_vector;
    let request: ExecutionRequest = serde_json::from_value(
        request_vector(&fixture, "gdm-delegated").request.clone(),
    )
    .unwrap();
    let challenge = serde_json::from_value(crypto.challenge.clone()).unwrap();
    let aad = gdm_hpke_aad_transcript(
        &request,
        &challenge,
        &crypto.issue_id,
        &crypto.sentinel_hash,
    )
    .unwrap();
    let private_key =
        HpkePrivateKey::from_base64url(&crypto.recipient_private_key_test_only).unwrap();
    let encapsulated_key =
        HpkeEncapsulatedKey::from_base64url(&crypto.encapsulated_key).unwrap();
    let info = HpkeInfo::new(&crypto.recipient_key_id).unwrap();
    let ciphertext = HpkeCiphertext::from_base64url(&crypto.ciphertext).unwrap();
    let mut tampered = ciphertext.as_bytes().to_vec();
    tampered[0] ^= 1;
    let tampered = HpkeCiphertext::from_bytes(tampered).unwrap();
    assert_eq!(
        open_hpke_base(&private_key, &encapsulated_key, &info, &aad, &tampered).unwrap_err(),
        CryptoError::CiphertextInvalid
    );
}

#[test]
fn frame_codec_rejects_truncation_excess_and_invalid_payloads() {
    let fixture = fixture();
    let request = &request_vector(&fixture, "gdm-delegated").request;
    let frame = frame_json(request);
    let payload = decode_frame_payload(&frame).unwrap();
    assert_eq!(payload, serde_json::to_vec(request).unwrap());

    assert_eq!(decode_frame_payload(&frame[..3]), Err(FrameError::Truncated));
    assert_eq!(
        decode_frame_payload(&frame[..frame.len() - 1]),
        Err(FrameError::Truncated)
    );
    let mut trailing = frame.clone();
    trailing.push(0);
    assert_eq!(decode_frame_payload(&trailing), Err(FrameError::Trailing));

    let oversize = ((MAX_FRAME_BYTES + 1) as u32).to_be_bytes();
    assert_eq!(decode_frame_payload(&oversize), Err(FrameError::Oversize));
    assert_eq!(
        encode_frame_payload(&vec![0; MAX_FRAME_BYTES + 1]),
        Err(FrameError::Oversize)
    );

    let invalid_utf8 = encode_frame_payload(&[0xff]).unwrap();
    assert_eq!(
        decode_execution_request_frame(&invalid_utf8),
        Err(WireError::Frame(FrameError::InvalidUtf8))
    );
    let invalid_json = encode_frame_payload(b"{").unwrap();
    assert_eq!(
        decode_execution_request_frame(&invalid_json),
        Err(WireError::Frame(FrameError::InvalidJson))
    );
}

#[test]
fn incremental_frame_decoder_handles_fragmented_and_concatenated_frames() {
    let first = encode_frame_payload(b"first").unwrap();
    let second = encode_frame_payload(b"second").unwrap();
    let mut stream = first.clone();
    stream.extend_from_slice(&second);

    let mut decoder = FrameDecoder::new();
    assert!(decoder.push(&stream[..2]).unwrap().is_empty());
    assert_eq!(
        decoder.push(&stream[2..first.len() + 3]).unwrap(),
        vec![b"first".to_vec()]
    );
    assert_eq!(
        decoder.push(&stream[first.len() + 3..]).unwrap(),
        vec![b"second".to_vec()]
    );
    decoder.finish().unwrap();

    let mut truncated = FrameDecoder::new();
    truncated.push(&first[..first.len() - 1]).unwrap();
    assert_eq!(truncated.finish(), Err(FrameError::Truncated));
    assert_eq!(truncated.push(&first), Err(FrameError::Truncated));

    let mut oversize = FrameDecoder::new();
    assert_eq!(
        oversize.push(&((MAX_FRAME_BYTES + 1) as u32).to_be_bytes()),
        Err(FrameError::Oversize)
    );
}

#[test]
fn receipts_and_status_frames_are_closed_metadata_only_shapes() {
    let receipt_value = receipt_json("succeeded", None, (Some(2), Some(3), Some(4)));
    let receipt: Receipt = decode_receipt_frame(&frame_json(&receipt_value)).unwrap();
    let receipt_frame = encode_receipt_frame(&receipt).unwrap();
    let encoded_receipt: Value =
        serde_json::from_slice(decode_frame_payload(&receipt_frame).unwrap()).unwrap();
    let receipt_keys: BTreeSet<_> = encoded_receipt.as_object().unwrap().keys().map(String::as_str).collect();
    assert_eq!(
        receipt_keys,
        BTreeSet::from([
            "authorizationModeUsed", "brokerBuildDigest", "brokerCodeDigest",
            "browserTargetGeneration", "domain", "errorCode", "events", "grantId",
            "operation", "policyDigest", "protocolVersion", "receiptId", "requestId", "state",
            "targetFingerprint", "targetReleaseDisposition"
        ])
    );

    let status_value = json!({
        "protocolVersion": 1,
        "canonicalStatus": "DESIGN/INACTIVE",
        "policyDigest": null,
        "installedBuildDigest": null,
        "runningBuildDigest": null,
        "codeIdentity": null,
        "pid": null,
        "socketPosture": "absent",
        "jetkvmControllerGeneration": null,
        "gdm": { "ready": false, "errorCode": "inactive" },
        "browser": { "ready": false, "errorCode": "inactive" },
        "sudo": { "ready": false, "errorCode": "inactive" },
        "errors": ["inactive"]
    });
    let status: PublicStatus = decode_public_status_frame(&frame_json(&status_value)).unwrap();
    let status_frame = encode_public_status_frame(&status).unwrap();
    let encoded_status: Value =
        serde_json::from_slice(decode_frame_payload(&status_frame).unwrap()).unwrap();
    let status_keys: BTreeSet<_> = encoded_status.as_object().unwrap().keys().map(String::as_str).collect();
    assert_eq!(
        status_keys,
        BTreeSet::from([
            "browser", "canonicalStatus", "codeIdentity", "errors", "gdm",
            "installedBuildDigest", "jetkvmControllerGeneration", "pid", "policyDigest",
            "protocolVersion", "runningBuildDigest", "socketPosture", "sudo"
        ])
    );

    let mut excess = status_value.clone();
    excess["sentinel"] = json!("must-not-appear");
    assert_eq!(
        decode_public_status_frame(&frame_json(&excess))
            .unwrap_err()
            .public_error(),
        PublicError::ExcessField
    );

    let mut unbounded = status_value;
    unbounded["errors"] = json!([
        "inactive", "disabled", "unavailable", "timeout", "cancelled", "protocol-invalid",
        "frame-invalid", "excess-field", "noncanonical-value"
    ]);
    assert_eq!(
        decode_public_status_frame(&frame_json(&unbounded))
            .unwrap_err()
            .public_error(),
        PublicError::NoncanonicalValue
    );
}

#[test]
fn control_frames_reject_excess_fields_and_control_characters() {
    let excess = json!({ "action": "status", "requestId": "AAECAwQFBgcICQoLDA0ODw" });
    assert_eq!(
        decode_control_frame(&frame_json(&excess))
            .unwrap_err()
            .public_error(),
        PublicError::ExcessField
    );

    let control = json!({ "action": "emergency-disable", "reason": "bad\nreason" });
    assert_eq!(
        decode_control_frame(&frame_json(&control))
            .unwrap_err()
            .public_error(),
        PublicError::NoncanonicalValue
    );
}
