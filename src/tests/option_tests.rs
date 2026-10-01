use crate::{
    session::config::{
        FixedAddressTranslatorConfig, LoadBalancingConfig, RetryPolicyKind, SessionOptions,
        SslOptions, TlsVersion,
    },
    types::type_helpers::SocketAddrWrapper,
};
use napi::bindgen_prelude::BigInt;

#[napi]
pub fn tests_check_client_option(options: SessionOptions, test_case: i32) {
    match test_case {
        1 => {
            assert_eq!(
                options,
                SessionOptions {
                    connect_points: Some(vec![
                        "Contact point 1".to_owned(),
                        "Contact point 2".to_owned()
                    ]),
                    keyspace: Some("keyspace name".to_owned()),
                    application_name: Some("App name".to_owned()),
                    application_version: Some("App version".to_owned()),
                    driver_config_reporting_enabled: Some(false),
                    client_id: Some("Client id".to_owned()),
                    credentials_username: Some("Unique username".to_owned()),
                    credentials_password: Some("Unique password".to_owned()),
                    cache_size: Some(2137),
                    schema_agreement_timeout_secs: Some(5),
                    auto_await_schema_agreement: Some(false),
                    metadata_request_serverside_timeout_secs: Some(7),
                    metadata_request_clientside_timeout_secs: Some(9),
                    ssl_options: Some(SslOptions {
                        reject_unauthorized: Some(false),
                        ca: Some(vec!["CA cert 1".to_owned(), "CA cert 2".to_owned()]),
                        cert: Some("Cert chain".to_owned()),
                        sigalgs: Some("RSA+SHA256".to_owned()),
                        ciphers: Some("TLS_AES_128_GCM_SHA256".to_owned()),
                        ecdh_curve: Some("P-256".to_owned()),
                        honor_cipher_order: Some(true),
                        key: Some("Private key".to_owned()),
                        max_version: Some(TlsVersion::Tlsv1_3),
                        min_version: Some(TlsVersion::Tlsv1_2),
                        secure_options: Some(BigInt {
                            sign_bit: false,
                            words: vec![123],
                        }),
                        passphrase: Some("Passphrase".to_owned()),
                        pfx: None
                    }),
                    load_balancing_config: Some(LoadBalancingConfig {
                        prefer_datacenter: Some("Magic DC".to_owned()),
                        prefer_rack: Some("Rack spec".to_owned()),
                        token_aware: Some(true),
                        permit_dc_failover: Some(false),
                        enable_shuffling_replicas: Some(false),
                        allow_list: Some(vec!["127.0.0.1:7312".to_owned()]),
                    }),
                    retry_policy: Some(RetryPolicyKind::Default),
                    address_translator_config: Some(FixedAddressTranslatorConfig {
                        address_mapping: Some(vec![(
                            SocketAddrWrapper {
                                socket: "2.1.3.7:690".parse().unwrap()
                            },
                            SocketAddrWrapper {
                                socket: "7.3.1.2:960".parse().unwrap()
                            }
                        )])
                    }),
                    client_routes_config: None
                }
            )
        }
        2 => {
            assert_eq!(
                options,
                SessionOptions {
                    connect_points: None,
                    keyspace: None,
                    application_name: None,
                    application_version: None,
                    driver_config_reporting_enabled: None,
                    client_id: None,
                    credentials_username: None,
                    credentials_password: None,
                    cache_size: None,
                    schema_agreement_timeout_secs: None,
                    auto_await_schema_agreement: None,
                    metadata_request_serverside_timeout_secs: None,
                    metadata_request_clientside_timeout_secs: None,
                    ssl_options: None,
                    load_balancing_config: None,
                    retry_policy: None,
                    address_translator_config: None,
                    client_routes_config: None
                }
            )
        }
        3 => {
            assert_eq!(
                options,
                SessionOptions {
                    connect_points: Some(vec!["192.168.0.1".to_owned()]),
                    keyspace: None,
                    application_name: None,
                    application_version: None,
                    driver_config_reporting_enabled: None,
                    client_id: Some("21377312-6969-4200-abcd-01234567890a".to_owned()),
                    credentials_username: Some("Unique username v2".to_owned()),
                    credentials_password: Some("Unique password v2".to_owned()),
                    cache_size: None,
                    schema_agreement_timeout_secs: None,
                    auto_await_schema_agreement: None,
                    metadata_request_serverside_timeout_secs: None,
                    metadata_request_clientside_timeout_secs: None,
                    ssl_options: None,
                    load_balancing_config: None,
                    retry_policy: None,
                    address_translator_config: None,
                    client_routes_config: None
                }
            )
        }
        _ => {}
    }
}
