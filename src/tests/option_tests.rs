use crate::session::{LoadBalancingConfig, SessionOptions, SslOptions};

#[napi]
pub fn tests_check_client_option(options: SessionOptions, case: i32) {
    match case {
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
                    client_id: Some("Client id".to_owned()),
                    credentials_username: Some("Unique username".to_owned()),
                    credentials_password: Some("Unique password".to_owned()),
                    cache_size: Some(2137),
                    ssl_options: Some(SslOptions {
                        reject_unauthorized: Some(false),
                        ca: None,
                        cert: None,
                        sigalgs: None,
                        ciphers: None,
                        ecdh_curve: None,
                        honor_cipher_order: None,
                        key: None,
                        max_version: None,
                        min_version: None,
                        secure_options: None,
                        session_id_context: None,
                        passphrase: None,
                        pfx: None
                    }),
                    load_balancing_config: Some(LoadBalancingConfig {
                        prefer_datacenter: Some("Magic DC".to_owned()),
                        prefer_rack: Some("Rack spec".to_owned()),
                        token_aware: Some(true),
                        permit_dc_failover: Some(false),
                        enable_shuffling_replicas: Some(false),
                        allow_list: Some(vec!["127.0.0.1:7312".to_owned()]),
                    })
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
                    client_id: None,
                    credentials_username: None,
                    credentials_password: None,
                    cache_size: None,
                    ssl_options: None,
                    load_balancing_config: None
                }
            )
        }
        _ => {}
    }
}
