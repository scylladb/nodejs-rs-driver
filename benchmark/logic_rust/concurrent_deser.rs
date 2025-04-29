use chrono::Local;
use futures::future::join_all;
use scylla::client::session::Session;
use scylla::client::session_builder::SessionBuilder;
use scylla::statement::prepared::PreparedStatement;
use scylla::value::CqlTimeuuid;
use std::env;
use std::net::{IpAddr, Ipv4Addr};
use std::str::FromStr;
use std::sync::Arc;
use uuid::Uuid;

const CONCURRENCY: usize = 2000;

async fn insert_data(
    session: Arc<Session>,
    start_index: usize,
    n: i32,
    insert_query: &PreparedStatement,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut index = start_index;

    while index < n as usize {
        let id = Uuid::new_v4();
        let tuuid = CqlTimeuuid::from_str("8e14e760-7fa8-11eb-bc66-000000000001")?;
        let ip: IpAddr = IpAddr::V4(Ipv4Addr::new(192, 168, 0, 1));
        let now = Local::now();
        let date = now.date_naive();
        let time = now.time();

        session
            .execute_unpaged(insert_query, (id, 100, tuuid, ip, date, time))
            .await?;
        index += CONCURRENCY;
    }

    Ok(())
}

async fn select_data(
    session: Arc<Session>,
    start_index: usize,
    n: i32,
    select_query: &PreparedStatement,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut index = start_index;

    while index < n as usize {
        session.execute_unpaged(select_query, &[]).await?;
        index += CONCURRENCY;
    }

    Ok(())
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let n: i32 = env::var("CNT")
        .ok()
        .and_then(|s: String| s.parse::<i32>().ok())
        .expect("CNT parameter is required.");

    let uri: String = env::var("SCYLLA_URI").unwrap_or_else(|_| "172.42.0.2:9042".to_string());

    let session = SessionBuilder::new().known_node(uri).build().await?;

    session
        .query_unpaged(
            "CREATE KEYSPACE IF NOT EXISTS benchmarks WITH replication = {'class': 'NetworkTopologyStrategy', 'replication_factor': '1' }", 
            &[],
        )
        .await?;

    session
        .query_unpaged("DROP TABLE IF EXISTS benchmarks.basic", &[])
        .await?;

    session
        .query_unpaged(
            "CREATE TABLE benchmarks.basic (id uuid, val int, tuuid timeuuid, ip inet, date date, time time, PRIMARY KEY(id))",
            &[],
        )
        .await?;

    let insert_query = session
        .prepare("INSERT INTO benchmarks.basic (id, val, tuuid, ip, date, time) VALUES (?, ?, ?, ?, ?, ?)")
        .await?;

    let mut handles = vec![];
    let session = Arc::new(session);

    for i in 0..CONCURRENCY {
        let session_clone = Arc::clone(&session);
        let insert_query_clone = insert_query.clone();
        handles.push(tokio::spawn(async move {
            insert_data(session_clone, i, n, &insert_query_clone)
                .await
                .unwrap();
        }));
    }

    let results = join_all(handles).await;

    for result in results {
        result.unwrap();
    }

    let select_query = session.prepare("SELECT * FROM benchmarks.basic").await?;

    let mut handles = vec![];

    for i in 0..CONCURRENCY {
        let session_clone = Arc::clone(&session);
        let select_query_clone = select_query.clone();
        handles.push(tokio::spawn(async move {
            select_data(session_clone, i, n, &select_query_clone)
                .await
                .unwrap();
        }));
    }

    let results = join_all(handles).await;

    for result in results {
        result.unwrap();
    }

    Ok(())
}
