use scylla::client::session::Session;

use crate::session::SessionWrapper;

pub(crate) async fn supports_feature(session: &Session, feature: &str) -> bool {
    // Cassandra doesn't have a concept of features, so first detect
    // if there is the `supported_features` column in system.local

    let meta = session.get_cluster_state();
    let system_local = meta
        .get_keyspace("system")
        .unwrap()
        .tables
        .get("local")
        .unwrap();

    if !system_local.columns.contains_key("supported_features") {
        return false;
    }

    let result = session
        .query_unpaged(
            "SELECT supported_features FROM system.local WHERE key='local'",
            (),
        )
        .await
        .unwrap()
        .into_rows_result()
        .unwrap();

    let (features,): (Option<&str>,) = result.single_row().unwrap();

    features
        .unwrap_or_default()
        .split(',')
        .any(|f| f == feature)
}

#[napi]
pub async fn scylla_supports_tablets(session: &SessionWrapper) -> bool {
    supports_feature(session.inner.get_session(), "TABLETS").await
}
