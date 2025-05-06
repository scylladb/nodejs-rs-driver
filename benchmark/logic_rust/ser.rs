use chrono::Local;
use scylla::value::CqlTimeuuid;
use scylla::{
    client::{caching_session::CachingSession, session_builder::SessionBuilder},
    statement::Statement,
};
use std::env;
use std::net::{IpAddr, Ipv4Addr};
use std::str::FromStr;
use uuid::Uuid;

const DEFAULT_CACHE_SIZE: u32 = 512;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let n: i32 = env::var("CNT")
        .ok()
        .and_then(|s: String| s.parse::<i32>().ok())
        .expect("CNT parameter is required.");

    let uri: String = env::var("SCYLLA_URI").unwrap_or_else(|_| "172.42.0.2:9042".to_string());

    let session = SessionBuilder::new().known_node(uri).build().await?;

    let session: CachingSession = CachingSession::from(session, DEFAULT_CACHE_SIZE as usize);

    session
        .execute_unpaged(
            "CREATE KEYSPACE IF NOT EXISTS benchmarks WITH replication = {'class': 'NetworkTopologyStrategy', 'replication_factor': '1' }", 
            &[],
        )
        .await?;

    session
        .execute_unpaged("DROP TABLE IF EXISTS benchmarks.basic", &[])
        .await?;

    session
        .execute_unpaged(
            "CREATE TABLE benchmarks.basic (id uuid, val int, tuuid timeuuid, ip inet, date date, time time, PRIMARY KEY(id))",
            &[],
        )
        .await?;

    let insert_query =
        "INSERT INTO benchmarks.basic (id, val, tuuid, ip, date, time) VALUES (?, ?, ?, ?, ?, ?)";

    for _ in 0..n * n {
        let statement: Statement = insert_query.into();
        let prepared = session.add_prepared_statement(&statement).await?;

        let id = Uuid::new_v4();
        let tuuid = CqlTimeuuid::from_str("8e14e760-7fa8-11eb-bc66-000000000001")?;
        let ip: IpAddr = IpAddr::V4(Ipv4Addr::new(192, 168, 0, 1));
        let now = Local::now();
        let date = now.date_naive();
        let time = now.time();

        session
            .get_session()
            .execute_unpaged(&prepared, (id, 100, tuuid, ip, date, time))
            .await?;
    }

    Ok(())
}
