use futures::future::join_all;
use scylla::client::session::Session;
use scylla::statement::prepared::PreparedStatement;
use std::sync::Arc;
use uuid::Uuid;

use crate::common::SIMPLE_INSERT_QUERY;

mod common;

async fn insert_data(
    session: Arc<Session>,
    start_index: usize,
    n: i32,
    concurrency: usize,
    insert_query: &PreparedStatement,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut index = start_index;

    while index < n as usize {
        let id = Uuid::new_v4();
        session.execute_unpaged(insert_query, (id, 100)).await?;
        index += concurrency;
    }

    Ok(())
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // REMEMBER: update benchmark config.yml when changing the constant value.
    let n: i32 = common::get_cnt_with_default(4_000_000);
    let concurrency = common::get_concurrency(100);

    let session = common::init_simple_table().await?;

    let insert_query = session.prepare(SIMPLE_INSERT_QUERY).await?;

    let mut handles = vec![];
    let session = Arc::new(session);

    for i in 0..concurrency {
        let session_clone = Arc::clone(&session);
        let insert_query_clone = insert_query.clone();
        handles.push(tokio::spawn(async move {
            insert_data(session_clone, i, n, concurrency, &insert_query_clone)
                .await
                .unwrap();
        }));
    }

    join_all(handles).await;

    common::check_row_cnt(&session, n).await?;

    Ok(())
}
